import type { GoogleCalendarEventPayload } from "../utils/googleCalendarMapping";

export type GoogleCalendarServiceErrorCode =
  | "unauthorized" | "forbidden" | "not_found" | "conflict"
  | "precondition_failed" | "rate_limited" | "server_error"
  | "network_error" | "invalid_response" | "invalid_request" | "http_error";

export class GoogleCalendarServiceError extends Error {
  readonly code: GoogleCalendarServiceErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  constructor(code: GoogleCalendarServiceErrorCode, status?: number) {
    super(`Google Calendar request: ${code}.`);
    this.code = code;
    this.status = status;
    this.name = "GoogleCalendarServiceError";
    this.retryable = ["rate_limited", "server_error", "network_error"].includes(code);
  }
}

export interface GoogleCalendarLinkMetadata {
  app: "profesor-agenda";
  syncJobId: string;
  entityType: "clase" | "tocata";
  entityId: string;
}

type LegacyMetadata = GoogleCalendarEventPayload["extendedProperties"]["private"];
export type GoogleCalendarPrivateMetadata = Partial<LegacyMetadata> & Partial<GoogleCalendarLinkMetadata>;
export type GoogleCalendarServicePayload = Omit<GoogleCalendarEventPayload, "extendedProperties"> & {
  extendedProperties: { private: GoogleCalendarPrivateMetadata };
};

export interface GoogleCalendarEvent extends Partial<GoogleCalendarServicePayload> {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
}

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error();
  return value;
}

function string(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error();
  return value;
}

function privateMetadata(value: unknown, writing: boolean): GoogleCalendarPrivateMetadata {
  const input = record(value);
  const result: GoogleCalendarPrivateMetadata = {};
  if (input.sourceApp !== undefined) {
    if (input.sourceApp !== "profesor-agenda") throw new Error();
    result.sourceApp = input.sourceApp;
  }
  if (input.sourceType !== undefined) {
    if (input.sourceType !== "clase" && input.sourceType !== "tocata") throw new Error();
    result.sourceType = input.sourceType;
  }
  if (input.mappingVersion !== undefined) {
    if (input.mappingVersion !== "1") throw new Error();
    result.mappingVersion = input.mappingVersion;
  }
  result.sourceKey = string(input.sourceKey);
  result.sourceRevision = string(input.sourceRevision);
  if (input.app !== undefined) {
    if (input.app !== "profesor-agenda") throw new Error();
    result.app = input.app;
  }
  if (input.entityType !== undefined) {
    if (input.entityType !== "clase" && input.entityType !== "tocata") throw new Error();
    result.entityType = input.entityType;
  }
  result.syncJobId = string(input.syncJobId);
  result.entityId = string(input.entityId);
  const hasLink = ["app", "syncJobId", "entityType", "entityId"].some((key) => input[key] !== undefined);
  // Legacy calls remain valid. A new outbound link must be complete.
  if (writing && hasLink && (!result.app || !result.entityType ||
    !result.syncJobId?.trim() || !result.entityId?.trim())) throw new Error();
  return result;
}

function dateTime(value: unknown): GoogleCalendarEventPayload["start"] | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  if (typeof input.dateTime !== "string" || input.timeZone !== "America/Santiago") throw new Error();
  return { dateTime: input.dateTime, timeZone: input.timeZone };
}

// Explicit allowlist for requests AND responses. Runtime extras cannot leak into
// private metadata, attendees, recurrence or conferenceData. Omitted PATCH fields stay omitted.
function eventPayload(value: unknown, writing: boolean): Partial<GoogleCalendarServicePayload> {
  const input = record(value);
  const result: Partial<GoogleCalendarServicePayload> = {
    summary: string(input.summary), description: string(input.description),
    location: string(input.location), start: dateTime(input.start), end: dateTime(input.end),
  };
  if (input.extendedProperties !== undefined) {
    result.extendedProperties = { private: privateMetadata(record(input.extendedProperties).private, writing) };
  }
  if (input.reminders !== undefined) {
    const reminders = record(input.reminders);
    if (!Array.isArray(reminders.overrides)) throw new Error();
    result.reminders = { useDefault: false, overrides: reminders.overrides.map((item: unknown) => {
      const reminder = record(item);
      if (typeof reminder.minutes !== "number" || !Number.isFinite(reminder.minutes)) throw new Error();
      return { method: "popup", minutes: reminder.minutes };
    }) };
  }
  return result;
}

function httpError(status: number): GoogleCalendarServiceError {
  const codes: Record<number, GoogleCalendarServiceErrorCode> = {
    401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
    412: "precondition_failed", 429: "rate_limited",
  };
  return new GoogleCalendarServiceError(codes[status] ??
    (status >= 500 && status <= 599 ? "server_error" : "http_error"), status);
}

function request(token: string, method: "DELETE", eventId: string, payload?: undefined, etag?: string): Promise<void>;
function request(token: string, method: "POST" | "PATCH" | "GET", eventId?: string,
  payload?: Partial<GoogleCalendarServicePayload>, etag?: string): Promise<GoogleCalendarEvent>;
async function request(
  token: string, method: "POST" | "PATCH" | "DELETE" | "GET", eventId?: string,
  payload?: Partial<GoogleCalendarServicePayload>, etag?: string,
): Promise<GoogleCalendarEvent | void> {
  if (!token || /\s/.test(token) ||
    (method !== "POST" && (!eventId || !/^[a-zA-Z0-9_-]+$/.test(eventId))) ||
    (method === "POST" && eventId !== undefined && !/^[a-v0-9]{5,1024}$/.test(eventId)) ||
    (etag !== undefined && /[\r\n]/.test(etag))) {
    throw new GoogleCalendarServiceError("invalid_request");
  }
  let body: string | undefined;
  try {
    const projected = payload === undefined ? undefined : eventPayload(payload, true);
    body = projected === undefined ? undefined : JSON.stringify(
      method === "POST" && eventId !== undefined ? { ...projected, id: eventId } : projected,
    );
  } catch {
    throw new GoogleCalendarServiceError("invalid_request");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if ((method === "PATCH" || method === "DELETE") && etag !== undefined) headers["If-Match"] = etag;
  const path = method === "POST" ? EVENTS_URL : `${EVENTS_URL}/${encodeURIComponent(eventId ?? "")}`;
  const query = method === "POST" && eventId !== undefined
    ? "?conferenceDataVersion=1&sendUpdates=none" : "?sendUpdates=none";
  let response: Response;
  try {
    response = await fetch(path + query, {
      method, headers, body, credentials: "omit", cache: "no-store", redirect: "error",
    });
  } catch {
    throw new GoogleCalendarServiceError("network_error");
  }
  if (!response.ok) throw httpError(response.status);
  if (method === "DELETE") return;
  try {
    const data: unknown = await response.json();
    const event = record(data);
    if (typeof event.id !== "string" || !event.id) throw new Error();
    const status = event.status === "confirmed" || event.status === "tentative" || event.status === "cancelled"
      ? event.status : undefined;
    if (event.status !== undefined && status === undefined) throw new Error();
    return { ...eventPayload(event, false), id: event.id, status,
      etag: response.headers.get("ETag") ?? string(event.etag) };
  } catch {
    throw new GoogleCalendarServiceError("invalid_response");
  }
}

/** Optional application-selected ID is sent unchanged; no IDs or retries are generated here. */
export function createGoogleCalendarEvent(token: string, payload: GoogleCalendarServicePayload, eventId?: string): Promise<GoogleCalendarEvent> {
  return request(token, "POST", eventId, payload);
}

export function updateGoogleCalendarEvent(token: string, eventId: string, payload: Partial<GoogleCalendarServicePayload>, etag?: string): Promise<GoogleCalendarEvent> {
  return request(token, "PATCH", eventId, payload, etag);
}

export async function deleteGoogleCalendarEvent(token: string, eventId: string, etag?: string): Promise<void> {
  await request(token, "DELETE", eventId, undefined, etag);
}

export function getGoogleCalendarEvent(token: string, eventId: string): Promise<GoogleCalendarEvent> {
  return request(token, "GET", eventId);
}
