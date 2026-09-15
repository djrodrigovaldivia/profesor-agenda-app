import type {
  Clase, Tocata, GoogleCalendarSyncJob, GoogleCalendarSyncError,
  GoogleCalendarSyncMetadata,
} from "../types";
import type { GoogleCalendarEventPayload } from "../utils/googleCalendarMapping";
import type { GoogleCalendarLinkMetadata } from "./googleCalendarService";
import { mapClaseToGoogleCalendarEvent, mapTocataToGoogleCalendarEvent } from "../utils/googleCalendarMapping.ts";

export const CALENDAR_SYNC_MAX_ATTEMPTS = 5;
export const CALENDAR_SYNC_LEASE_MS = 60_000;

export interface CalendarSyncBinding {
  entityType: "clase" | "tocata";
  entityId: string;
  googleAccountId: string;
  calendarId: "primary";
}

/** Explicit user scope; authorization must be validated by the future caller. */
export interface CalendarSyncScope extends CalendarSyncBinding {
  uid: string;
}

export interface CalendarSyncTransaction {
  getJob(): Promise<GoogleCalendarSyncJob | null>;
  getEntity(binding: CalendarSyncBinding): Promise<Clase | Tocata | null>;
  setJob(job: GoogleCalendarSyncJob): void;
  setMetadata(binding: CalendarSyncBinding, metadata: GoogleCalendarSyncMetadata): void;
}

/**
 * Future Firestore adapter contract, not an implementation.
 * Jobs: users/{uid}/calendarSyncJobs/{jobId}.
 * Entities: users/{uid}/clases|tocatas/{entityId}.
 * Must atomically reserve leaseOwner/leaseUntil and compare the current revision
 * before completing both job and metadata. Read all documents before writes.
 * Callbacks may repeat: never call Calendar/HTTP inside a callback.
 */
export interface CalendarSyncStore {
  transaction<T>(uid: string, jobId: string,
    callback: (tx: CalendarSyncTransaction) => Promise<T>): Promise<T>;
}

export type CalendarSyncPayload = Omit<GoogleCalendarEventPayload, "extendedProperties"> & {
  extendedProperties: {
    private: GoogleCalendarEventPayload["extendedProperties"]["private"] & GoogleCalendarLinkMetadata;
  };
};

export interface CalendarSyncRemoteEvent extends Partial<CalendarSyncPayload> {
  id: string;
  etag?: string;
}

/** A 404 is evidence for the upper layer, never proof of successful deletion. */
export type CalendarSyncLookup =
  | { status: "found"; event: CalendarSyncRemoteEvent }
  | { status: "not_found"; requiresAccountValidation: true };

export type CalendarSyncDeleteResult =
  | { status: "deleted" }
  | { status: "not_found"; requiresAccountValidation: true };

/**
 * Contract only: no adapter instance or network calls in Phase A.
 * Resolve authorization for scope.uid + scope.googleAccountId outside this core.
 * create MUST send eventId as the POST body's id; every retry keeps that ID.
 * Preserve syncJobId to verify link ownership; patch/delete must honor If-Match.
 *
 * Calendar service now supports caller IDs, link metadata and DELETE If-Match.
 * A future adapter must still validate scope and translate typed 404 errors;
 * no adapter is connected by this type contract.
 */
export interface CalendarSyncCalendar {
  get(scope: CalendarSyncScope, eventId: string): Promise<CalendarSyncLookup>;
  create(scope: CalendarSyncScope, eventId: string, payload: CalendarSyncPayload): Promise<void | CalendarSyncRemoteEvent>;
  patch(scope: CalendarSyncScope, eventId: string, payload: CalendarSyncPayload, etag?: string): Promise<void | CalendarSyncRemoteEvent>;
  delete(scope: CalendarSyncScope, eventId: string, etag?: string): Promise<CalendarSyncDeleteResult>;
}

export interface CalendarSyncDependencies {
  store: CalendarSyncStore;
  calendar: CalendarSyncCalendar;
  now: () => number;
}

function identifier(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.includes("/") ||
    value === "." || value === ".." || value.length > 512 ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) {
    throw new Error("Identificador inválido.");
  }
}

/**
 * Versioned JSON tuple + SHA-256: no delimiter collisions, clocks or randomness.
 * uid and Google account are part of the link. Operation/revision are not.
 * Web Crypto hashes locally; it performs no network or persistence operations.
 * Event IDs use hexadecimal (a subset of Calendar's base32hex alphabet).
 */
export async function createCalendarSyncIds(uid: string, binding: CalendarSyncBinding):
  Promise<{ jobId: string; googleCalendarEventId: string }> {
  for (const id of [uid, binding.entityId, binding.googleAccountId]) identifier(id);
  if (!["clase", "tocata"].includes(binding.entityType) || binding.calendarId !== "primary") {
    throw new Error("Vínculo inválido.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify([
    "profesor-agenda-sync-v1", uid, binding.entityType, binding.entityId, binding.googleAccountId, "primary",
  ]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { jobId: `pa_${hash}`, googleCalendarEventId: `pa${hash}` };
}

export type CalendarSyncErrorCode =
  | "requires_reauthorization" | "delete_not_found" | "not_found"
  | "conflict" | "precondition_failed" | "rate_limited" | "server_error"
  | "uncertain_result" | "invalid_request" | "unknown_error";

export interface CalendarSyncClassifiedError extends GoogleCalendarSyncError {
  code: CalendarSyncErrorCode;
}

const messages: Record<CalendarSyncErrorCode, string> = {
  requires_reauthorization: "Se requiere validar la cuenta y renovar la autorización.",
  delete_not_found: "Evento no encontrado; la capa superior debe validar cuenta y autorización.",
  not_found: "Evento no encontrado; se requiere reconciliación del vínculo.",
  conflict: "Conflicto; consultar el mismo evento antes de reintentar.",
  precondition_failed: "El evento cambió; consultar su versión antes de reintentar.",
  rate_limited: "Límite temporal de solicitudes.",
  server_error: "Fallo temporal del servicio.",
  uncertain_result: "Resultado incierto; consultar el mismo evento antes de reintentar.",
  invalid_request: "Solicitud inválida; se requiere revisión manual.",
  unknown_error: "No se pudo sincronizar; se requiere revisión manual.",
};

/** Only own data fields; do not invoke getters or stringify arbitrary errors. */
function errorField(error: unknown, key: string): unknown {
  if (error === null || typeof error !== "object") return undefined;
  try {
    const value: unknown = Object.getOwnPropertyDescriptor(error, key)?.value;
    return value;
  } catch {
    return undefined;
  }
}

/** Persist only a fixed code/message, never a transport message/body/token/stack. */
export function classifyCalendarSyncError(
  error: unknown, at: string, operation: GoogleCalendarSyncJob["operation"] = "upsert",
): CalendarSyncClassifiedError {
  const timestamp = new Date(at).toISOString();
  const status = errorField(error, "status");
  const remoteCode = errorField(error, "code");
  const name = errorField(error, "name");
  const reason = errorField(error, "reason");
  let code: CalendarSyncErrorCode = "unknown_error";
  // HTTP status is authoritative; contradictory adapter fields cannot trigger retries.
  if (status === 401) code = "requires_reauthorization";
  else if (status === 403) code =
    reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"
      ? "rate_limited" : "requires_reauthorization";
  else if (status === 404) code = operation === "delete" ? "delete_not_found" : "not_found";
  else if (status === 409) code = "conflict";
  else if (status === 412) code = "precondition_failed";
  else if (status === 429) code = "rate_limited";
  else if (typeof status === "number" && status >= 500 && status <= 599 && Number.isInteger(status)) code = "server_error";
  else if (status === 400) code = "invalid_request";
  else if (status === undefined) {
    if (remoteCode === "unauthorized" || remoteCode === "forbidden") code = "requires_reauthorization";
    else if (remoteCode === "not_found") code = operation === "delete" ? "delete_not_found" : "not_found";
    else if (remoteCode === "conflict") code = "conflict";
    else if (remoteCode === "precondition_failed") code = "precondition_failed";
    else if (remoteCode === "rate_limited") code = "rate_limited";
    else if (remoteCode === "server_error") code = "server_error";
    else if (remoteCode === "invalid_request") code = "invalid_request";
    else if (remoteCode === "network_error" || remoteCode === "timeout" ||
      remoteCode === "invalid_response" || name === "TimeoutError" || name === "AbortError") code = "uncertain_result";
  }
  return {
    code, message: messages[code], at: timestamp,
    retryable: ["conflict", "precondition_failed", "rate_limited", "server_error", "uncertain_result"].includes(code),
  };
}

/** attempts counts attempts already made (including the failed one). null = stop. */
export function calendarSyncBackoff(attempts: number): number | null {
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("Intento inválido.");
  if (attempts >= CALENDAR_SYNC_MAX_ATTEMPTS) return null;
  return Math.min(60_000, 1_000 * 2 ** (attempts - 1));
}

/** Pure retry decision: authorization/404/terminal errors must never be scheduled. */
export function calendarSyncRetryDelay(error: GoogleCalendarSyncError, attempts: number): number | null {
  const delay = calendarSyncBackoff(attempts);
  return error.retryable ? delay : null;
}

const terminalMessages = {
  foreign_event: "El evento no pertenece exactamente al vínculo esperado.",
  not_found_requires_upper_decision: "Evento no encontrado; se requiere decisión superior sobre cuenta y autorización.",
  attempts_exhausted: "Se agotaron cinco intentos; se requiere revisión manual.",
  invalid_job: "La tarea contiene datos de coordinación inválidos.",
  invalid_source: "La entidad no coincide con la revisión y vínculo de la tarea.",
  confirmation_required: "La fecha u hora requiere confirmación antes de sincronizar.",
} as const;

type TerminalCode = keyof typeof terminalMessages;
class CalendarSyncFailure extends Error {
  readonly code: TerminalCode;
  constructor(code: TerminalCode) { super(terminalMessages[code]); this.code = code; }
}

function terminal(code: TerminalCode, at: string): GoogleCalendarSyncError {
  return { code, message: terminalMessages[code], at, retryable: false };
}

/** Canonical UTC ISO only: reject ambiguous local times and normalized invalid dates. */
function timestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new CalendarSyncFailure("invalid_job");
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new CalendarSyncFailure("invalid_job");
  return ms;
}

function instant(value: number): string {
  if (!Number.isSafeInteger(value)) throw new CalendarSyncFailure("invalid_job");
  const text = new Date(value).toISOString();
  timestamp(text);
  return text;
}

function bindingData(binding: CalendarSyncBinding): CalendarSyncBinding {
  return { entityType: binding.entityType, entityId: binding.entityId,
    googleAccountId: binding.googleAccountId, calendarId: binding.calendarId };
}

function isTerminalCode(value: unknown): value is TerminalCode {
  return typeof value === "string" && Object.hasOwn(terminalMessages, value);
}

function isClassifiedCode(value: unknown): value is CalendarSyncErrorCode {
  return typeof value === "string" && Object.hasOwn(messages, value);
}

function persistedError(error: GoogleCalendarSyncError | null, fallbackAt: string): GoogleCalendarSyncError | null {
  if (!error) return null;
  const code = errorField(error, "code");
  const at = errorField(error, "at");
  let safeAt = fallbackAt;
  try { if (typeof at === "string") { timestamp(at); safeAt = at; } } catch { /* use validated job timestamp */ }
  if (isTerminalCode(code)) return terminal(code, safeAt);
  if (isClassifiedCode(code)) return { code, message: messages[code], at: safeAt,
    retryable: errorField(error, "retryable") === true &&
      ["rate_limited", "server_error", "uncertain_result"].includes(code) };
  return { code: "unknown_error", message: messages.unknown_error, at: safeAt, retryable: false };
}

function metadataData(metadata: GoogleCalendarSyncMetadata): GoogleCalendarSyncMetadata {
  return {
    enabled: metadata.enabled, status: metadata.status, calendarId: metadata.calendarId,
    revision: metadata.revision, syncedRevision: metadata.syncedRevision,
    ...(metadata.googleAccountId === undefined ? {} : { googleAccountId: metadata.googleAccountId }),
    ...(metadata.googleCalendarEventId === undefined ? {} : { googleCalendarEventId: metadata.googleCalendarEventId }),
    ...(metadata.lastSyncedAt === undefined ? {} : { lastSyncedAt: metadata.lastSyncedAt }),
    ...(metadata.etag === undefined ? {} : { etag: metadata.etag }),
  };
}

/** Explicit projection prevents runtime extras from entering persisted jobs. */
function jobData(job: GoogleCalendarSyncJob): GoogleCalendarSyncJob {
  return {
    id: job.id, ...bindingData(job), googleCalendarEventId: job.googleCalendarEventId,
    operation: job.operation, revision: job.revision, status: job.status, attempts: job.attempts,
    nextAttemptAt: job.nextAttemptAt, lastError: persistedError(job.lastError, job.updatedAt),
    leaseOwner: job.leaseOwner, leaseUntil: job.leaseUntil,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  };
}

function validJob(job: GoogleCalendarSyncJob, jobId: string): void {
  if (job.id !== jobId || !Number.isSafeInteger(job.revision) || job.revision < 1 ||
    !Number.isSafeInteger(job.attempts) || job.attempts < 0 ||
    !["pending", "processing", "completed", "error"].includes(job.status) ||
    !["upsert", "delete"].includes(job.operation) || !/^[a-v0-9]{5,1024}$/.test(job.googleCalendarEventId) ||
    (job.leaseOwner === null) !== (job.leaseUntil === null)) throw new CalendarSyncFailure("invalid_job");
  timestamp(job.createdAt); timestamp(job.updatedAt);
  if (job.nextAttemptAt !== null) timestamp(job.nextAttemptAt);
  if (job.leaseUntil !== null) timestamp(job.leaseUntil);
}

function sourceMatches(entity: Clase | Tocata | null, job: CalendarSyncBinding & {
  revision: number; operation: GoogleCalendarSyncJob["operation"]; googleCalendarEventId?: string;
}): boolean {
  if (!entity) return job.operation === "delete";
  const metadata = entity.googleCalendar;
  return !!metadata && entity.id === job.entityId &&
    (job.entityType === "clase" ? "alumnoId" in entity : "proyecto" in entity) &&
    metadata.googleAccountId === job.googleAccountId && metadata.calendarId === job.calendarId &&
    metadata.revision === job.revision && (job.operation === "delete" || metadata.enabled) &&
    (job.googleCalendarEventId === undefined || metadata.googleCalendarEventId === job.googleCalendarEventId);
}

/** Atomic queue + entity metadata update. Entity edits must enqueue their revision together. */
export async function enqueueCalendarSyncJob(
  store: CalendarSyncStore, uid: string,
  input: CalendarSyncBinding & { revision: number; operation: GoogleCalendarSyncJob["operation"] }, now: number,
): Promise<GoogleCalendarSyncJob> {
  const at = instant(now);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 ||
    !["upsert", "delete"].includes(input.operation)) throw new CalendarSyncFailure("invalid_job");
  const ids = await createCalendarSyncIds(uid, input);
  return store.transaction(uid, ids.jobId, async (tx) => {
    const current = await tx.getJob();
    const entity = await tx.getEntity(bindingData(input));
    if (current) {
      validJob(current, ids.jobId);
      if (input.revision <= current.revision) {
        if (input.revision === current.revision && input.operation !== current.operation) throw new CalendarSyncFailure("invalid_source");
        return jobData(current);
      }
    }
    if (!sourceMatches(entity, input)) throw new CalendarSyncFailure("invalid_source");
    const job = buildQueuedJob(current, entity?.googleCalendar, input, ids, at);
    tx.setJob(job);
    if (entity?.googleCalendar) tx.setMetadata(bindingData(input), {
      ...metadataData(entity.googleCalendar), googleCalendarEventId: job.googleCalendarEventId, status: job.status === "error" ? "error" : "pending", lastError: job.lastError,
    });
    return job;
  });
}

/** Shared pure job projection. No storage, clock, HTTP or retry loop. */
function buildQueuedJob(
  current: GoogleCalendarSyncJob | null,
  metadata: GoogleCalendarSyncMetadata | undefined,
  input: CalendarSyncBinding & { revision: number; operation: GoogleCalendarSyncJob["operation"] },
  ids: { jobId: string; googleCalendarEventId: string }, at: string,
): GoogleCalendarSyncJob {
    const eventId = current?.googleCalendarEventId ?? metadata?.googleCalendarEventId ?? ids.googleCalendarEventId;
    if (!/^[a-v0-9]{5,1024}$/.test(eventId) || (current && metadata?.googleCalendarEventId &&
      metadata.googleCalendarEventId !== eventId)) throw new CalendarSyncFailure("invalid_source");
    const requiresAuth = current?.lastError?.code === "requires_reauthorization";
    const job: GoogleCalendarSyncJob = {
      id: ids.jobId, ...bindingData(input), googleCalendarEventId: eventId,
      operation: input.operation, revision: input.revision, status: requiresAuth ? "error" : "pending",
      attempts: 0, nextAttemptAt: null,
      lastError: requiresAuth ? { code: "requires_reauthorization", message: messages.requires_reauthorization, at, retryable: false } : null,
      // Keep an in-flight lease across edits. The old worker cannot overwrite the
      // new revision; another worker waits for this bounded lease to expire.
      leaseOwner: current?.leaseOwner ?? null, leaseUntil: current?.leaseUntil ?? null,
      createdAt: current?.createdAt ?? at, updatedAt: at,
    };

    return job;
}

/** Prepare a new agenda intention using persisted snapshots, never form metadata. */
export async function planCalendarSyncMutation(
  uid: string, binding: CalendarSyncBinding, current: GoogleCalendarSyncJob | null,
  metadata: GoogleCalendarSyncMetadata, operation: GoogleCalendarSyncJob["operation"], now: number,
): Promise<{ job: GoogleCalendarSyncJob; metadata: GoogleCalendarSyncMetadata }> {
  const ids = await createCalendarSyncIds(uid, binding);
  const at = instant(now);
  if (!metadata || typeof metadata !== "object" ||
    (Object.getPrototypeOf(metadata) !== Object.prototype && Object.getPrototypeOf(metadata) !== null) ||
    Object.values(Object.getOwnPropertyDescriptors(metadata)).some(d => !Object.hasOwn(d, "value")))
    throw new CalendarSyncFailure("invalid_source");
  if (!["upsert", "delete"].includes(operation) || metadata.enabled !== true ||
    metadata.calendarId !== binding.calendarId || metadata.googleAccountId !== binding.googleAccountId ||
    !Number.isSafeInteger(metadata.revision) || metadata.revision < 0 ||
    !Number.isSafeInteger(metadata.syncedRevision) || metadata.syncedRevision < 0 ||
    !["not_synced", "pending", "synced", "error", "unlinked"].includes(metadata.status)) {
    throw new CalendarSyncFailure("invalid_source");
  }
  if (metadata.lastSyncedAt !== undefined && metadata.lastSyncedAt !== null) timestamp(metadata.lastSyncedAt);
  if (metadata.etag !== undefined && metadata.etag !== null && typeof metadata.etag !== "string")
    throw new CalendarSyncFailure("invalid_source");
  if (metadata.googleCalendarEventId !== undefined && (typeof metadata.googleCalendarEventId !== "string" || !/^[a-v0-9]{5,1024}$/.test(metadata.googleCalendarEventId)))
    throw new CalendarSyncFailure("invalid_source");
  if (metadata.lastError !== undefined && metadata.lastError !== null) {
    const error = metadata.lastError;
    const safe = persistedError(error, at);
    if (!safe || errorField(error, "code") !== safe.code || errorField(error, "message") !== safe.message ||
      typeof errorField(error, "retryable") !== "boolean" || typeof errorField(error, "at") !== "string")
      throw new CalendarSyncFailure("invalid_source");
    timestamp(error.at);
  }
  if (current) {
    if (typeof current !== "object" || (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) ||
      Object.values(Object.getOwnPropertyDescriptors(current)).some(d => !Object.hasOwn(d, "value")))
      throw new CalendarSyncFailure("invalid_job");
    validJob(current, ids.jobId);
    if (current.entityType !== binding.entityType || current.entityId !== binding.entityId ||
      current.googleAccountId !== binding.googleAccountId || current.calendarId !== binding.calendarId)
      throw new CalendarSyncFailure("invalid_source");
    // Reactivation after deletion requires a separate, explicit policy.
    if (operation === "upsert" && current.operation === "delete")
      throw new CalendarSyncFailure("invalid_source");
  }
  const revision = Math.max(metadata.revision, metadata.syncedRevision, current?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new CalendarSyncFailure("invalid_source");
  const job = buildQueuedJob(current, metadata, { ...bindingData(binding), operation, revision }, ids, at);
  return { job, metadata: {
    ...metadataData(metadata), revision, googleCalendarEventId: job.googleCalendarEventId,
    status: job.status === "error" ? "error" : "pending",
    lastError: job.lastError,
  } };
}

export type CalendarSyncReservation =
  | { status: "reserved"; job: GoogleCalendarSyncJob }
  | { status: "skipped"; reason: "missing" | "completed" | "lease_active" | "not_due" | "requires_decision" }
  | { status: "error"; error: GoogleCalendarSyncError };

/** A real Firestore adapter must serialize competing calls on this same document. */
export async function reserveJob(
  store: CalendarSyncStore, uid: string, jobId: string, leaseOwner: string, now: number,
  leaseDuration = CALENDAR_SYNC_LEASE_MS,
): Promise<CalendarSyncReservation> {
  identifier(uid); identifier(jobId); identifier(leaseOwner);
  const at = instant(now);
  if (!Number.isSafeInteger(leaseDuration) || leaseDuration < 1 || leaseDuration > 300_000) throw new CalendarSyncFailure("invalid_job");
  const until = instant(now + leaseDuration);
  return store.transaction(uid, jobId, async (tx): Promise<CalendarSyncReservation> => {
    const job = await tx.getJob();
    if (!job) return { status: "skipped", reason: "missing" };
    try { validJob(job, jobId); }
    catch { return { status: "error", error: terminal("invalid_job", at) }; }
    if (job.status === "completed") return { status: "skipped", reason: "completed" };
    // Even the same owner cannot overlap itself while its lease remains valid.
    if (job.leaseUntil !== null && timestamp(job.leaseUntil) > now) return { status: "skipped", reason: "lease_active" };
    if (job.status === "error" && !job.lastError?.retryable) return { status: "skipped", reason: "requires_decision" };
    if (job.nextAttemptAt !== null && timestamp(job.nextAttemptAt) > now) return { status: "skipped", reason: "not_due" };
    if (job.attempts >= CALENDAR_SYNC_MAX_ATTEMPTS) {
      const error = terminal("attempts_exhausted", at);
      tx.setJob({ ...jobData(job), status: "error", lastError: error, nextAttemptAt: null,
        leaseOwner: null, leaseUntil: null, updatedAt: at });
      return { status: "error", error };
    }
    const claimed: GoogleCalendarSyncJob = { ...jobData(job), status: "processing",
      attempts: job.attempts + 1, leaseOwner, leaseUntil: until, updatedAt: at };
    tx.setJob(claimed);
    return { status: "reserved", job: claimed };
  });
}

function ownsLease(current: GoogleCalendarSyncJob | null, claim: GoogleCalendarSyncJob, now: number): boolean {
  return !!current && current.status === "processing" && current.revision === claim.revision &&
    current.operation === claim.operation && current.googleCalendarEventId === claim.googleCalendarEventId &&
    current.leaseOwner === claim.leaseOwner && current.leaseUntil === claim.leaseUntil &&
    current.attempts === claim.attempts && current.leaseUntil !== null && timestamp(current.leaseUntil) > now;
}

function ownsEvent(event: CalendarSyncRemoteEvent, job: GoogleCalendarSyncJob): boolean {
  const properties = event.extendedProperties?.private;
  return event.id === job.googleCalendarEventId && properties?.app === "profesor-agenda" &&
    properties.syncJobId === job.id && properties.entityType === job.entityType && properties.entityId === job.entityId;
}

function mappedPayload(entity: Clase | Tocata | null, job: GoogleCalendarSyncJob): CalendarSyncPayload {
  if (!entity) throw new CalendarSyncFailure("invalid_source");
  const mapped = job.entityType === "clase" && "alumnoId" in entity ? mapClaseToGoogleCalendarEvent(entity) :
    job.entityType === "tocata" && "proyecto" in entity ? mapTocataToGoogleCalendarEvent(entity) : null;
  if (!mapped) throw new CalendarSyncFailure("invalid_source");
  if (mapped.requiresEndConfirmation || mapped.requiresAmbiguousTimeConfirmation) throw new CalendarSyncFailure("confirmation_required");
  return { ...mapped.event, location: mapped.event.location ?? "", extendedProperties: {
    private: { ...mapped.event.extendedProperties.private, app: "profesor-agenda",
      syncJobId: job.id, entityType: job.entityType, entityId: job.entityId },
  } };
}

function samePayload(event: CalendarSyncRemoteEvent, desired: CalendarSyncPayload): boolean {
  return event.summary === desired.summary && event.description === desired.description &&
    (event.location ?? "") === desired.location && event.start?.dateTime === desired.start.dateTime &&
    event.start?.timeZone === desired.start.timeZone && event.end?.dateTime === desired.end.dateTime &&
    event.end?.timeZone === desired.end.timeZone && event.reminders?.useDefault === false &&
    JSON.stringify(event.reminders.overrides) === JSON.stringify(desired.reminders.overrides) &&
    event.extendedProperties?.private.sourceRevision === desired.extendedProperties.private.sourceRevision;
}

/** Phase B policy: conflicts require a new revision/decision; all 403 require authorization. */
function processingError(cause: unknown, at: string, job: GoogleCalendarSyncJob): GoogleCalendarSyncError {
  const internalCode = errorField(cause, "code");
  if (cause instanceof CalendarSyncFailure && isTerminalCode(internalCode)) return terminal(internalCode, at);
  let error: GoogleCalendarSyncError = classifyCalendarSyncError(cause, at, job.operation);
  if (errorField(cause, "status") === 403) error = { code: "requires_reauthorization", message: messages.requires_reauthorization, at, retryable: false };
  if (error.code === "delete_not_found") return terminal("not_found_requires_upper_decision", at);
  if (error.code === "conflict" || error.code === "precondition_failed") return { ...error, retryable: false };
  return error;
}

export type CalendarSyncProcessResult = Exclude<CalendarSyncReservation, { status: "reserved" }> |
  { status: "stale_revision" | "lease_lost" | "completed" } |
  { status: "retry_scheduled"; error: GoogleCalendarSyncError; nextAttemptAt: string };

/** Exactly one manual attempt. GET always precedes writes, including after crashes. */
export async function processCalendarSyncJob(
  deps: CalendarSyncDependencies, uid: string, jobId: string, leaseOwner: string,
): Promise<CalendarSyncProcessResult> {
  const reservation = await reserveJob(deps.store, uid, jobId, leaseOwner, deps.now());
  if (reservation.status !== "reserved") return reservation;
  const claim = reservation.job;
  const binding = bindingData(claim);
  const scope: CalendarSyncScope = { uid, ...binding };
  const inspect = () => deps.store.transaction(uid, jobId, async (tx) => {
    const current = await tx.getJob();
    const entity = await tx.getEntity(binding);
    const now = deps.now(); instant(now);
    return { current, entity, active: ownsLease(current, claim, now) };
  });
  let failure: GoogleCalendarSyncError | null = null;
  let etag: string | undefined;
  try {
    const expected = await createCalendarSyncIds(uid, binding);
    if (expected.jobId !== claim.id) throw new CalendarSyncFailure("invalid_job");
    const before = await inspect();
    if (!before.active || !sourceMatches(before.entity, claim)) return finish(null, true);
    const desired = claim.operation === "upsert" ? mappedPayload(before.entity, claim) : null;
    const lookup = await deps.calendar.get(scope, claim.googleCalendarEventId);
    const remote = lookup.status === "found" ? lookup.event : null;
    if (remote && !ownsEvent(remote, claim)) throw new CalendarSyncFailure("foreign_event");
    etag = remote?.etag;
    const afterGet = await inspect();
    if (!afterGet.active || !sourceMatches(afterGet.entity, claim)) return finish(null, true);
    if (claim.operation === "delete") {
      if (!remote) throw new CalendarSyncFailure("not_found_requires_upper_decision");
      const result = await deps.calendar.delete(scope, claim.googleCalendarEventId, etag);
      if (result.status === "not_found") throw new CalendarSyncFailure("not_found_requires_upper_decision");
    } else if (desired) {
      let written: void | CalendarSyncRemoteEvent = undefined;
      if (!remote) written = await deps.calendar.create(scope, claim.googleCalendarEventId, desired);
      else if (!samePayload(remote, desired)) written = await deps.calendar.patch(scope, claim.googleCalendarEventId, desired, etag);
      if (written) {
        if (!ownsEvent(written, claim)) throw new CalendarSyncFailure("foreign_event");
        etag = written.etag;
      } else if (!remote || !samePayload(remote, desired)) etag = undefined;
    }
  } catch (cause) { failure = processingError(cause, instant(deps.now()), claim); }
  return finish(failure, false);

  async function finish(error: GoogleCalendarSyncError | null, interrupted: boolean): Promise<CalendarSyncProcessResult> {
    return deps.store.transaction(uid, jobId, async (tx): Promise<CalendarSyncProcessResult> => {
      const current = await tx.getJob();
      const entity = await tx.getEntity(binding);
      const now = deps.now(); const at = instant(now);
      if (current && current.revision !== claim.revision) return { status: "stale_revision" };
      if (!ownsLease(current, claim, now) || !current) return { status: "lease_lost" };
      if (!sourceMatches(entity, claim) || interrupted) {
        tx.setJob({ ...jobData(current), status: "error", lastError: terminal("invalid_source", at),
          nextAttemptAt: null, leaseOwner: null, leaseUntil: null, updatedAt: at });
        return { status: "stale_revision" };
      }
      const delay = error ? calendarSyncRetryDelay(error, claim.attempts) : null;
      const finalError = error?.retryable && delay === null ? terminal("attempts_exhausted", at) : error;
      const nextAttemptAt = delay === null ? null : instant(now + delay);
      tx.setJob({ ...jobData(current), status: finalError ? "error" : "completed", lastError: finalError,
        nextAttemptAt, leaseOwner: null, leaseUntil: null, updatedAt: at });
      if (entity?.googleCalendar) tx.setMetadata(binding, { ...metadataData(entity.googleCalendar),
        status: finalError ? "error" : claim.operation === "delete" ? "unlinked" : "synced",
        lastError: finalError,
        ...(finalError ? {} : { syncedRevision: claim.revision, lastSyncedAt: at, etag: etag ?? null }),
      });
      if (!finalError) return { status: "completed" };
      return nextAttemptAt === null ? { status: "error", error: finalError } :
        { status: "retry_scheduled", error: finalError, nextAttemptAt };
    });
  }
}
