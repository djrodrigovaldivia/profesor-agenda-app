import type {
  CalendarSyncDependencies,
  CalendarSyncProcessResult,
} from "./googleCalendarSync";
import { processCalendarSyncJob } from "./googleCalendarSync";
import type { GoogleCalendarSyncJob } from "../types";

export interface CalendarSyncWorkerOptions {
  deps: CalendarSyncDependencies;
  uid: string;
  isTokenAvailable: () => boolean;
}

/**
 * Client-side worker that coordinates execution of Google Calendar synchronization jobs.
 * Ensures:
 * - No duplicate concurrent runs of the same job within the tab.
 * - Multi-tab coordination via atomic lease reservation in Firestore.
 * - Backoff retries for transient errors up to the maximum bounded attempts.
 * - Clean disposal and timer cancellation on unmount.
 */
export class CalendarSyncWorker {
  private inProgressJobIds = new Set<string>();
  private scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private isDisposed = false;
  private readonly leaseOwner: string;
  private readonly deps: CalendarSyncDependencies;
  private readonly uid: string;
  private readonly isTokenAvailable: () => boolean;

  constructor(options: CalendarSyncWorkerOptions) {
    this.deps = options.deps;
    this.uid = options.uid;
    this.isTokenAvailable = options.isTokenAvailable;
    this.leaseOwner = `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  public getLeaseOwner(): string {
    return this.leaseOwner;
  }

  public isJobInProgress(jobId: string): boolean {
    return this.inProgressJobIds.has(jobId);
  }

  /**
   * Processes a single job by ID.
   * Safe to call multiple times; duplicate executions are rejected.
   */
  public async processJob(jobId: string): Promise<CalendarSyncProcessResult | null> {
    if (this.isDisposed) return null;
    if (!this.isTokenAvailable()) {
      return null;
    }
    if (this.inProgressJobIds.has(jobId)) {
      return null;
    }

    this.inProgressJobIds.add(jobId);
    try {
      const result = await processCalendarSyncJob(
        this.deps,
        this.uid,
        jobId,
        this.leaseOwner
      );
      return result;
    } catch (err: unknown) {
      // Errors are caught and handled inside processCalendarSyncJob; this catches unexpected runtime defects.
      const safeMessage = err instanceof Error ? err.message : "Error desconocido";
      console.warn(`[CalendarSyncWorker] Fallo inesperado en trabajo ${jobId}: ${safeMessage}`);
      return null;
    } finally {
      this.inProgressJobIds.delete(jobId);
    }
  }

  /**
   * Evaluates a collection of jobs (e.g. from Firestore onSnapshot) and triggers
   * execution of pending or due retryable jobs.
   */
  public handleJobsUpdated(jobs: GoogleCalendarSyncJob[]): void {
    if (this.isDisposed) return;
    if (!this.isTokenAvailable()) return;

    const now = this.deps.now();

    for (const job of jobs) {
      // Completed jobs do not need further work; remove any stale timers
      if (job.status === "completed") {
        const existingTimer = this.scheduledTimers.get(job.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.scheduledTimers.delete(job.id);
        }
        continue;
      }

      // Check if job is immediately pending
      if (job.status === "pending") {
        if (!this.inProgressJobIds.has(job.id)) {
          void this.processJob(job.id);
        }
        continue;
      }

      // Check if job is in error and eligible for retry
      if (job.status === "error" && job.lastError?.retryable) {
        if (job.nextAttemptAt) {
          const attemptTime = Date.parse(job.nextAttemptAt);
          if (attemptTime <= now) {
            if (!this.inProgressJobIds.has(job.id)) {
              void this.processJob(job.id);
            }
          } else {
            // Schedule future retry if not already scheduled
            if (!this.scheduledTimers.has(job.id)) {
              const delay = Math.max(100, Math.min(600_000, attemptTime - now));
              const timer = setTimeout(() => {
                this.scheduledTimers.delete(job.id);
                if (!this.isDisposed && this.isTokenAvailable()) {
                  void this.processJob(job.id);
                }
              }, delay);
              this.scheduledTimers.set(job.id, timer);
            }
          }
        }
      }
    }
  }

  /**
   * Triggers immediate processing for all pending jobs when authorization becomes available.
   */
  public triggerPendingJobs(jobs: GoogleCalendarSyncJob[]): void {
    if (this.isDisposed || !this.isTokenAvailable()) return;
    this.handleJobsUpdated(jobs);
  }

  /**
   * Clean up all timers and in-memory state.
   */
  public dispose(): void {
    this.isDisposed = true;
    for (const timer of this.scheduledTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
    this.inProgressJobIds.clear();
  }
}
