import type {
  CalendarSyncCalendar,
  CalendarSyncScope,
  CalendarSyncPayload,
  CalendarSyncLookup,
  CalendarSyncRemoteEvent,
  CalendarSyncDeleteResult,
  CalendarSyncStore,
  CalendarSyncTransaction,
} from "./googleCalendarSync";
import {
  FirestoreCalendarSyncStorage,
  type FirestoreSyncDependencies,
} from "./firestoreCalendarSyncStorage";
import {
  getGoogleCalendarEvent,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  GoogleCalendarServiceError,
} from "./googleCalendarService";

/**
 * Creates a production adapter implementing CalendarSyncCalendar using googleCalendarService.
 * Token is dynamically retrieved on demand without exposing tokens to the UI or persistence.
 */
export function createGoogleCalendarSyncCalendar(
  getAccessToken: (scope: CalendarSyncScope) => string | null
): CalendarSyncCalendar {
  const requireToken = (scope: CalendarSyncScope): string => {
    const token = getAccessToken(scope);
    if (!token || /\s/.test(token)) {
      throw new GoogleCalendarServiceError("unauthorized", 401);
    }
    return token;
  };

  return {
    async get(scope: CalendarSyncScope, eventId: string): Promise<CalendarSyncLookup> {
      const token = requireToken(scope);
      try {
        const event = await getGoogleCalendarEvent(token, eventId);
        return {
          status: "found",
          event: event as unknown as CalendarSyncRemoteEvent,
        };
      } catch (err) {
        if (err instanceof GoogleCalendarServiceError && err.status === 404) {
          return { status: "not_found", requiresAccountValidation: true };
        }
        throw err;
      }
    },

    async create(
      scope: CalendarSyncScope,
      eventId: string,
      payload: CalendarSyncPayload
    ): Promise<void | CalendarSyncRemoteEvent> {
      const token = requireToken(scope);
      const event = await createGoogleCalendarEvent(token, payload as any, eventId);
      return event as unknown as CalendarSyncRemoteEvent;
    },

    async patch(
      scope: CalendarSyncScope,
      eventId: string,
      payload: CalendarSyncPayload,
      etag?: string
    ): Promise<void | CalendarSyncRemoteEvent> {
      const token = requireToken(scope);
      const event = await updateGoogleCalendarEvent(token, eventId, payload as any, etag);
      return event as unknown as CalendarSyncRemoteEvent;
    },

    async delete(
      scope: CalendarSyncScope,
      eventId: string,
      etag?: string
    ): Promise<CalendarSyncDeleteResult> {
      const token = requireToken(scope);
      try {
        await deleteGoogleCalendarEvent(token, eventId, etag);
        return { status: "deleted" };
      } catch (err) {
        if (err instanceof GoogleCalendarServiceError && err.status === 404) {
          return { status: "not_found", requiresAccountValidation: true };
        }
        throw err;
      }
    },
  };
}

/**
 * Creates an adapter implementing CalendarSyncStore using FirestoreCalendarSyncStorage.
 * Preserves atomicity, preconditions, leases, ETags, and idempotence across transactions.
 */
export function createGoogleCalendarSyncStore<Db = unknown, Ref = unknown>(
  storageOrDeps:
    | FirestoreCalendarSyncStorage<Db, Ref>
    | FirestoreSyncDependencies<Db, Ref>
): CalendarSyncStore {
  const storage =
    storageOrDeps instanceof FirestoreCalendarSyncStorage
      ? storageOrDeps
      : new FirestoreCalendarSyncStorage(storageOrDeps);

  return {
    async transaction<T>(
      uid: string,
      jobId: string,
      callback: (tx: CalendarSyncTransaction) => Promise<T>
    ): Promise<T> {
      return storage.transaction(uid, jobId, callback);
    },
  };
}

