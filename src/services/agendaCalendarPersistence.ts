import type { Clase, Tocata, GoogleCalendarSyncJob, GoogleCalendarSyncMetadata } from "../types";
import type { CalendarSyncBinding } from "./googleCalendarSync";
import { createCalendarSyncIds, planCalendarSyncMutation } from "./googleCalendarSync.ts";
import { decodeAgendaEntity, FirestoreCalendarSyncStorageError } from "./firestoreCalendarSyncStorage.ts";
import type { AgendaEntityTarget, AgendaMutationStore } from "./firestoreCalendarSyncStorage";

type Business<T> = Omit<T, "id" | "createdAt" | "updatedAt" | "googleCalendar">;
export interface AgendaAuthorizedLink {
  /** Explicit caller authorization, not a replacement for Firebase authentication. */
  authorized: true;
  googleAccountId: string;
  calendarId: "primary";
}
type Create = { operation: "create"; entityId: string; authorizedLink?: AgendaAuthorizedLink } & (
  { entityType: "clase"; data: Business<Clase> } | { entityType: "tocata"; data: Business<Tocata> });
type Update = { operation: "update"; entityId: string; preconditionVersion: string } & (
  { entityType: "clase"; patch: Partial<Business<Clase>> } | { entityType: "tocata"; patch: Partial<Business<Tocata>> });
type Delete = AgendaEntityTarget & {
  operation: "delete";
  preconditionVersion: string;
  /** Retain this binding on retries so a missing entity's delete job remains locatable. */
  expectedLink?: Pick<CalendarSyncBinding, "googleAccountId" | "calendarId">;
};
export type AgendaCalendarMutation = Create | Update | Delete;
export type AgendaCalendarMutationResult =
  | { status: "applied" | "noop"; entity: Clase | Tocata | null; version: string | null; jobId?: string }
  | {
      status: "conflict" | "not_found" | "invalid_argument" | "storage_failure";
      details?: string;
      suggestion?: string;
      field?: string;
    };
export interface AgendaCalendarPersistenceDependencies {
  store: AgendaMutationStore;
  now(): number;
}

function invalid(reason?: string, field?: string): never {
  throw new FirestoreCalendarSyncStorageError("invalid_argument", reason, field);
}
function record(value: unknown, contextName = "objeto"): Record<string, unknown> {
  if (value === null || typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`El valor para ${contextName} no es un objeto válido`);
  }
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) return invalid(`Propiedad no permitida en ${contextName}: ${key}`);
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
function id(value: unknown, fieldName = "id"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value === "." || value === ".." ||
    /[/\\\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) {
    return invalid(`El identificador (${String(value)}) no es válido`, fieldName);
  }
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length > 0) invalid(`Campos no permitidos detectados: ${extra.join(", ")}`);
}
function businessKeys(kind: AgendaEntityTarget["entityType"]): string[] {
  return kind === "clase" ? ["alumnoId", "tipo", "fecha", "horaInicio", "horaFin", "tema", "notas", "estado", "recordatorio"] :
    ["titulo", "fecha", "horaInicio", "horaFin", "proyecto", "lugar", "ciudad", "direccion", "contacto", "honorarios", "estado", "notas"];
}
function business(value: unknown, target: AgendaEntityTarget): Record<string, unknown> {
  const data = record(value, `datos de ${target.entityType}`);
  keys(data, businessKeys(target.entityType));
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) invalid(`El campo '${key}' no puede ser undefined`, key);
    if (val === null && key !== "honorarios") invalid(`El campo '${key}' no puede ser nulo`, key);
  }
  if (data.recordatorio !== undefined && data.recordatorio !== null) {
    const reminder = record(data.recordatorio, "recordatorio");
    keys(reminder, ["activo", "antelacionValor", "antelacionUnidad", "notificadoAt"]);
    data.recordatorio = reminder;
  }
  return data;
}
function link(value: unknown, target: AgendaEntityTarget, authorized: boolean): CalendarSyncBinding {
  const data = record(value);
  keys(data, authorized ? ["authorized", "googleAccountId", "calendarId"] : ["googleAccountId", "calendarId"]);
  if ((authorized && data.authorized !== true) || data.calendarId !== "primary") return invalid();
  return { ...target, googleAccountId: id(data.googleAccountId), calendarId: "primary" };
}
function entityBinding(value: Clase | Tocata, target: AgendaEntityTarget): CalendarSyncBinding | null {
  const metadata = value.googleCalendar;
  if (!metadata?.enabled) return null;
  return link({ googleAccountId: metadata.googleAccountId, calendarId: metadata.calendarId }, target, false);
}
function sameBinding(left: CalendarSyncBinding, right: CalendarSyncBinding): boolean {
  return left.entityType === right.entityType && left.entityId === right.entityId &&
    left.googleAccountId === right.googleAccountId && left.calendarId === right.calendarId;
}
function businessView(value: Clase | Tocata, target: AgendaEntityTarget): Record<string, unknown> {
  const data = record(value), result: Record<string, unknown> = {};
  for (const key of businessKeys(target.entityType)) if (data[key] !== undefined) result[key] = data[key];
  return result;
}
function calendarChanged(before: Clase | Tocata, after: Clase | Tocata, target: AgendaEntityTarget): boolean {
  const relevant = target.entityType === "clase" ? ["tipo", "fecha", "horaInicio", "horaFin", "estado"] :
    ["titulo", "proyecto", "fecha", "horaInicio", "horaFin", "estado", "lugar", "direccion", "ciudad"];
  const a = record(before), b = record(after);
  return relevant.some(key => a[key] !== b[key]);
}

/** Opaque CAS version includes business fields and metadata, but never stores the snapshot. */
export async function agendaEntityVersion(value: Clase | Tocata, target: AgendaEntityTarget): Promise<string> {
  const clean = decodeAgendaEntity(value, target);
  const bytes = new TextEncoder().encode(JSON.stringify(clean));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function plan(...args: Parameters<typeof planCalendarSyncMutation>) {
  try { return await planCalendarSyncMutation(...args); }
  catch { return invalid(); }
}

export type CalendarLinkState = "not_linked" | "authorization_required" | "pending_upsert" |
  "pending_delete" | "synced" | "error";
export type CalendarLinkResult =
  | { status: CalendarLinkState; changed: boolean; entity: Clase | Tocata; version: string;
      jobId?: string; operation?: "upsert" | "delete" }
  | { status: "conflict" | "account_mismatch" | "invalid_argument" | "not_found" | "storage_failure" };
export type CalendarLinkAuthorizationOutcome = "requires_reauthorization" | "account_mismatch" |
  "auth_cancelled" | "authorized";
export type CalendarLinkAuthorizationResult =
  | { status: "authorization_required"; reason: "requires_reauthorization" | "auth_cancelled" }
  | { status: "account_mismatch" | "invalid_argument" }
  | { status: "authorization_valid"; requiresConditionalOperation: true };

/** A caller-reported outcome, never an authentication proof or a queue mutation. */
export function calendarLinkAuthorizationResult(outcome: CalendarLinkAuthorizationOutcome): CalendarLinkAuthorizationResult {
  switch (outcome) {
    case "authorized": return { status: "authorization_valid", requiresConditionalOperation: true };
    case "account_mismatch": return { status: "account_mismatch" };
    case "auth_cancelled":
    case "requires_reauthorization": return { status: "authorization_required", reason: outcome };
    default: return { status: "invalid_argument" };
  }
}

type LinkAction = { kind: "enable"; authorizedLink: AgendaAuthorizedLink } |
  { kind: "disable" } | { kind: "enqueue"; operation: "upsert" | "delete" };

export function enableCalendarLink(deps: AgendaCalendarPersistenceDependencies, uid: string,
  target: AgendaEntityTarget, preconditionVersion: string, authorizedLink: AgendaAuthorizedLink): Promise<CalendarLinkResult> {
  return mutateCalendarLink(deps, uid, target, preconditionVersion, { kind: "enable", authorizedLink });
}
export function disableCalendarLink(deps: AgendaCalendarPersistenceDependencies, uid: string,
  target: AgendaEntityTarget, preconditionVersion: string): Promise<CalendarLinkResult> {
  return mutateCalendarLink(deps, uid, target, preconditionVersion, { kind: "disable" });
}
export function enqueueCalendarSync(deps: AgendaCalendarPersistenceDependencies, uid: string,
  target: AgendaEntityTarget, operation: "upsert" | "delete", preconditionVersion: string): Promise<CalendarLinkResult> {
  return mutateCalendarLink(deps, uid, target, preconditionVersion, { kind: "enqueue", operation });
}

/** Only metadata and coordination jobs change; the local entity is never deleted. */
async function mutateCalendarLink(deps: AgendaCalendarPersistenceDependencies, uid: string,
  inputTarget: AgendaEntityTarget, preconditionVersion: string, action: LinkAction): Promise<CalendarLinkResult> {
  try {
    id(uid);
    const raw = record(inputTarget); keys(raw, ["entityType", "entityId"]);
    if (raw.entityType !== "clase" && raw.entityType !== "tocata") return invalid();
    const target: AgendaEntityTarget = { entityType: raw.entityType, entityId: id(raw.entityId) };
    if (typeof preconditionVersion !== "string" || !/^[0-9a-f]{64}$/.test(preconditionVersion)) return invalid();
    if (action.kind === "enqueue" && action.operation !== "upsert" && action.operation !== "delete") return invalid();
    const explicit = action.kind === "enable" ? link(action.authorizedLink, target, true) : null;
    const now = deps.now();
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) return invalid();
    const at = new Date(now).toISOString();
    return await deps.store.agendaTransaction(uid, target, async tx => {
      const current = await tx.getEntity();
      if (!current) return { status: "not_found" };
      const version = await agendaEntityVersion(current, target);
      if (version !== preconditionVersion) return { status: "conflict" };
      const metadata = current.googleCalendar;
      if (metadata && !metadata.googleCalendarEventId) return invalid();
      const persisted = metadata ? link({ googleAccountId: metadata.googleAccountId,
        calendarId: metadata.calendarId }, target, false) : null;
      if (explicit && persisted && !sameBinding(explicit, persisted)) return { status: "account_mismatch" };
      const binding = persisted ?? explicit;
      if (!binding) return { status: "not_linked", changed: false, entity: current, version };
      const ids = await createCalendarSyncIds(uid, binding);
      const previous = await tx.getJob(ids.jobId);
      if (previous && (!sameBinding(previous, binding) || !metadata ||
        !metadata.googleCalendarEventId || previous.googleCalendarEventId !== metadata.googleCalendarEventId)) return invalid();
      const operation = action.kind === "disable" ? "delete" : action.kind === "enable" ? "upsert" : action.operation;
      // A disabled link must not be reactivated, including after a completed delete.
      if (operation === "upsert" && (previous?.operation === "delete" || (metadata && !metadata.enabled)))
        return { status: "conflict" };
      if (action.kind === "enqueue" && (!metadata || (operation === "delete" ? metadata.enabled : !metadata.enabled)))
        return { status: "conflict" };
      const alreadyDesired = !!metadata && metadata.enabled === (operation === "upsert");
      if (alreadyDesired && previous?.operation === operation && previous.revision === metadata.revision &&
        previous.revision >= metadata.syncedRevision) {
        const status: CalendarLinkState = previous.lastError?.code === "requires_reauthorization" ? "authorization_required" :
          previous.status === "error" ? "error" : previous.status === "completed" ?
            operation === "delete" ? metadata.status === "unlinked" && metadata.syncedRevision === metadata.revision ? "not_linked" : "error" :
              metadata.status === "synced" && metadata.syncedRevision === metadata.revision ? "synced" : "error" :
            operation === "delete" ? "pending_delete" : "pending_upsert";
        return { status, changed: false, entity: current, version, jobId: previous.id, operation };
      }
      // Historical unlinked metadata without a job is not evidence of a pending deletion.
      if (metadata && !metadata.enabled && !previous) return { status: "conflict" };
      const seed: GoogleCalendarSyncMetadata = metadata ?? { enabled: true, status: "not_synced",
        googleAccountId: binding.googleAccountId, calendarId: "primary", revision: 0, syncedRevision: 0 };
      const prepared = await plan(uid, binding, previous, { ...seed, enabled: true }, operation, now);
      const next = { ...current, updatedAt: current.updatedAt > at ? current.updatedAt : at,
        googleCalendar: { ...prepared.metadata, enabled: operation === "upsert" } };
      const nextVersion = await agendaEntityVersion(next, target);
      tx.setEntity(next); tx.setJob(prepared.job);
      return { status: prepared.job.lastError?.code === "requires_reauthorization" ? "authorization_required" :
        operation === "delete" ? "pending_delete" : "pending_upsert", changed: true,
        entity: next, version: nextVersion, jobId: prepared.job.id, operation };
    });
  } catch (error) {
    return { status: error instanceof FirestoreCalendarSyncStorageError && error.code !== "storage_failure"
      ? "invalid_argument" : "storage_failure" };
  }
}

/** One explicit mutation, one storage transaction; no Calendar, auth, or automatic work. */
export async function persistAgendaCalendarMutation(
  deps: AgendaCalendarPersistenceDependencies, uid: string, command: AgendaCalendarMutation,
): Promise<AgendaCalendarMutationResult> {
  try {
    id(uid);
    const raw = record(command);
    const kind = raw.entityType;
    if (kind !== "clase" && kind !== "tocata") return invalid();
    const target: AgendaEntityTarget = { entityType: kind, entityId: id(raw.entityId) };
    const operation = raw.operation;
    if (operation !== "create" && operation !== "update" && operation !== "delete") return invalid();
    keys(raw, ["operation", "entityType", "entityId", ...(operation === "create" ? ["data", "authorizedLink"] :
      operation === "update" ? ["patch", "preconditionVersion"] : ["preconditionVersion", "expectedLink"])]);
    if (operation !== "create" && (typeof raw.preconditionVersion !== "string" || !/^[0-9a-f]{64}$/.test(raw.preconditionVersion))) return invalid();
    const input = operation === "delete" ? {} : business(operation === "create" ? raw.data : raw.patch, target);
    const explicit = operation === "create" && raw.authorizedLink !== undefined ? link(raw.authorizedLink, target, true) :
      operation === "delete" && raw.expectedLink !== undefined ? link(raw.expectedLink, target, false) : null;
    const now = deps.now();
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) return invalid();
    const at = new Date(now).toISOString();
    // Capture validated command data before callbacks can replay.
    const created = operation === "create" ? decodeAgendaEntity({ ...input, id: target.entityId, createdAt: at, updatedAt: at }, target) : null;
    return await deps.store.agendaTransaction(uid, target, async tx => {
      const current = await tx.getEntity();
      if (operation === "create" && current) {
        return {
          status: "conflict",
          details: `Ya existe un registro de ${target.entityType} con ID ${target.entityId}`,
          suggestion: "Intenta recargar la agenda o generar un nuevo identificador para el elemento.",
        };
      }
      if (!current && operation !== "create") {
        if (operation === "delete" && explicit) {
          const ids = await createCalendarSyncIds(uid, explicit);
          const previous = await tx.getJob(ids.jobId);
          if (previous && sameBinding(previous, explicit) && previous.operation === "delete")
            return { status: "noop", entity: null, version: null, jobId: previous.id };
        }
        return {
          status: "not_found",
          details: `El registro de ${target.entityType} con ID ${target.entityId} no existe en la base de datos.`,
          suggestion: "Recarga la agenda para ver los registros actualizados.",
        };
      }
      if (current && await agendaEntityVersion(current, target) !== raw.preconditionVersion) {
        return {
          status: "conflict",
          details: "La versión del elemento cambió en el servidor mientras se editaba.",
          suggestion: "Cierra el formulario, recarga la agenda para cargar la última versión y vuelve a intentarlo.",
        };
      }
      const persistedBinding = current ? entityBinding(current, target) : null;
      if (operation === "delete" && explicit && persistedBinding && !sameBinding(explicit, persistedBinding)) {
        return {
          status: "conflict",
          details: "El vínculo de Google Calendar del elemento a eliminar no coincide con el guardado.",
          suggestion: "Recarga la agenda para sincronizar el estado del vínculo.",
        };
      }
      if (operation === "delete") {
        if (!current) {
          return {
            status: "not_found",
            details: "No se encontró el elemento a eliminar.",
            suggestion: "Recarga la agenda.",
          };
        }
        if (!persistedBinding || !current.googleCalendar) { tx.deleteEntity(); return { status: "applied", entity: null, version: null }; }
        const ids = await createCalendarSyncIds(uid, persistedBinding);
        const previous = await tx.getJob(ids.jobId);
        if (previous && !sameBinding(previous, persistedBinding)) {
          return {
            status: "invalid_argument",
            details: "La tarea previa de sincronización no coincide con el vínculo actual.",
            suggestion: "Intenta nuevamente o desvincula la cuenta de Google Calendar.",
          };
        }
        const reusable = previous?.operation === "delete" && previous.revision === current.googleCalendar.revision &&
          previous.revision >= current.googleCalendar.syncedRevision &&
          previous.googleCalendarEventId === current.googleCalendar.googleCalendarEventId && previous.status !== "completed";
        const deletion = reusable ? previous : (await plan(uid, persistedBinding, previous,
          current.googleCalendar, "delete", now)).job;
        tx.setJob(deletion); tx.deleteEntity();
        return { status: "applied", entity: null, version: null, jobId: deletion.id };
      }
      let next: Clase | Tocata;
      if (created) next = created;
      else if (current) {
        next = decodeAgendaEntity({ ...current, ...input }, target);
        if (JSON.stringify(businessView(next, target)) === JSON.stringify(businessView(current, target)))
          return { status: "noop", entity: current, version: await agendaEntityVersion(current, target) };
        // Strictly increasing even when two commands share the injected millisecond.
        const updated = Math.max(now, Date.parse(current.updatedAt) + 1);
        next.updatedAt = new Date(updated).toISOString();
      } else {
        return {
          status: "invalid_argument",
          details: "No se proporcionaron datos válidos para actualizar o crear el elemento.",
          suggestion: "Verifica que todos los campos requeridos estén completos.",
        };
      }
      const active = operation === "create" ? explicit : persistedBinding;
      let planned: GoogleCalendarSyncJob | undefined;
      if (active && (!current || calendarChanged(current, next, target))) {
        const ids = await createCalendarSyncIds(uid, active);
        const previous = await tx.getJob(ids.jobId);
        // Never resurrect a prior identity/tombstone on create.
        if (operation === "create" && previous) {
          return {
            status: "conflict",
            details: "Existe una tarea previa de sincronización pendiente para este elemento.",
            suggestion: "Espera unos segundos a que finalice la sincronización previa o recarga la página.",
          };
        }
        const metadata: GoogleCalendarSyncMetadata = current?.googleCalendar ?? {
          enabled: true, status: "not_synced", calendarId: "primary", googleAccountId: active.googleAccountId,
          revision: 0, syncedRevision: 0,
        };
        const prepared = await plan(uid, active, previous, metadata, "upsert", now);
        next = { ...next, googleCalendar: prepared.metadata }; planned = prepared.job;
      }
      const version = await agendaEntityVersion(next, target);
      tx.setEntity(next); if (planned) tx.setJob(planned);
      return { status: "applied", entity: next, version, ...(planned ? { jobId: planned.id } : {}) };
    });
  } catch (error) {
    if (error instanceof FirestoreCalendarSyncStorageError && error.code !== "storage_failure") {
      return {
        status: "invalid_argument",
        details: error.details || error.message,
        field: error.field,
        suggestion: "Revisa los campos del formulario, asegurando que el alumno esté seleccionado, la fecha y horas sean válidas.",
      };
    }
    return {
      status: "storage_failure",
    };
  }
}
