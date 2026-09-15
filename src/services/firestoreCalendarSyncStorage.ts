import type { Clase, Tocata, GoogleCalendarSyncJob, GoogleCalendarSyncMetadata, GoogleCalendarSyncError } from "../types";
import type { CalendarSyncBinding, CalendarSyncStore, CalendarSyncTransaction } from "./googleCalendarSync";

/** Structural ports compatible with modular Firestore; no runtime SDK import. */
export interface FirestoreSyncSnapshot {
  exists(): boolean;
  data(): unknown;
}
export interface FirestoreSyncTransaction<Ref> {
  get(ref: Ref): Promise<FirestoreSyncSnapshot>;
  set(ref: Ref, data: Record<string, unknown>): unknown;
  update(ref: Ref, data: Record<string, unknown>): unknown;
  delete?(ref: Ref): unknown;
}
export interface FirestoreSyncDependencies<Db, Ref> {
  db: Db;
  doc(db: Db, path: string, ...segments: string[]): Ref;
  runTransaction<T>(db: Db, callback: (tx: FirestoreSyncTransaction<Ref>) => Promise<T>): Promise<T>;
}

export type FirestoreCalendarSyncStorageErrorCode =
  | "invalid_argument" | "unauthenticated_or_missing_uid" | "entity_not_found"
  | "malformed_job" | "malformed_entity" | "storage_failure";

export class FirestoreCalendarSyncStorageError extends Error {
  readonly code: FirestoreCalendarSyncStorageErrorCode;
  readonly details?: string;
  readonly field?: string;
  constructor(code: FirestoreCalendarSyncStorageErrorCode, details?: string, field?: string) {
    super(details ? `Calendar sync storage: ${code} - ${details}` : `Calendar sync storage: ${code}.`);
    this.name = "FirestoreCalendarSyncStorageError";
    this.code = code;
    this.details = details;
    this.field = field;
  }
}
type Code = FirestoreCalendarSyncStorageErrorCode;
function fail(code: Code, details?: string, field?: string): never {
  throw new FirestoreCalendarSyncStorageError(code, details, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function object(value: unknown, code: Code): Record<string, unknown> {
  if (!isRecord(value)) return fail(code);
  // Reject accessors without executing them, including on unknown fields.
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) return fail(code);
  }
  return value;
}
function string(value: unknown, code: Code): string {
  if (typeof value !== "string") return fail(code);
  return value;
}
function identifier(value: unknown, code: Code): string {
  const result = string(value, code);
  if (!result.trim() || result.length > 512 || result === "." || result === ".." ||
    /[/\\\u0000-\u001f\u007f\ud800-\udfff]/u.test(result)) return fail(code);
  return result;
}
function choice<T extends string>(value: unknown, choices: readonly T[], code: Code): T {
  for (const item of choices) if (value === item) return item;
  return fail(code);
}
function integer(value: unknown, min: number, code: Code): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return fail(code);
  return value;
}
function boolean(value: unknown, code: Code): boolean {
  if (typeof value !== "boolean") return fail(code);
  return value;
}
function timestamp(value: unknown, code: Code): string {
  const result = string(value, code);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) return fail(code);
  return result;
}
function nullableTime(value: unknown, code: Code): string | null {
  return value === null ? null : timestamp(value, code);
}
function eventId(value: unknown, code: Code): string {
  const result = string(value, code);
  if (!/^[a-v0-9]{5,1024}$/.test(result)) return fail(code);
  return result;
}
function binding(value: unknown, code: Code): CalendarSyncBinding {
  const data = object(value, code);
  return {
    entityType: choice(data.entityType, ["clase", "tocata"], code),
    entityId: identifier(data.entityId, code),
    googleAccountId: identifier(data.googleAccountId, code),
    calendarId: choice(data.calendarId, ["primary"], code),
  };
}

/** Published core messages: accept canonical diagnostics, never raw transport text. */
const errorMessages: Readonly<Record<string, string>> = {
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
  foreign_event: "El evento no pertenece exactamente al vínculo esperado.",
  not_found_requires_upper_decision: "Evento no encontrado; se requiere decisión superior sobre cuenta y autorización.",
  attempts_exhausted: "Se agotaron cinco intentos; se requiere revisión manual.",
  invalid_job: "La tarea contiene datos de coordinación inválidos.",
  invalid_source: "La entidad no coincide con la revisión y vínculo de la tarea.",
  confirmation_required: "La fecha u hora requiere confirmación antes de sincronizar.",
};
function syncError(value: unknown, code: Code): GoogleCalendarSyncError | null {
  if (value === null) return null;
  const data = object(value, code);
  const errorCode = string(data.code, code);
  if (!Object.hasOwn(errorMessages, errorCode) || data.message !== errorMessages[errorCode]) return fail(code);
  return { code: errorCode, message: errorMessages[errorCode], at: timestamp(data.at, code),
    retryable: boolean(data.retryable, code) };
}
function metadata(value: unknown, code: Code, allowAdvancedSyncedRevision = false): GoogleCalendarSyncMetadata {
  const data = object(value, code);
  const result: GoogleCalendarSyncMetadata = {
    enabled: boolean(data.enabled, code),
    status: choice(data.status, ["not_synced", "pending", "synced", "error", "unlinked"], code),
    calendarId: choice(data.calendarId, ["primary"], code),
    revision: integer(data.revision, 0, code), syncedRevision: integer(data.syncedRevision, 0, code),
  };
  if (!allowAdvancedSyncedRevision && result.syncedRevision > result.revision) return fail(code);
  if (data.googleAccountId !== undefined) result.googleAccountId = identifier(data.googleAccountId, code);
  if (data.googleCalendarEventId !== undefined) result.googleCalendarEventId = eventId(data.googleCalendarEventId, code);
  if (data.lastSyncedAt !== undefined) result.lastSyncedAt = nullableTime(data.lastSyncedAt, code);
  if (data.lastError !== undefined) result.lastError = syncError(data.lastError, code);
  if (data.etag !== undefined) result.etag = data.etag === null ? null : string(data.etag, code);
  return result;
}
function job(value: unknown, expectedId: string, code: Code): GoogleCalendarSyncJob {
  const data = object(value, code);
  const result: GoogleCalendarSyncJob = {
    id: identifier(data.id, code), ...binding(data, code),
    googleCalendarEventId: eventId(data.googleCalendarEventId, code),
    operation: choice(data.operation, ["upsert", "delete"], code),
    revision: integer(data.revision, 1, code),
    status: choice(data.status, ["pending", "processing", "completed", "error"], code),
    attempts: integer(data.attempts, 0, code), nextAttemptAt: nullableTime(data.nextAttemptAt, code),
    lastError: syncError(data.lastError, code),
    leaseOwner: data.leaseOwner === null ? null : identifier(data.leaseOwner, code),
    leaseUntil: nullableTime(data.leaseUntil, code),
    createdAt: timestamp(data.createdAt, code), updatedAt: timestamp(data.updatedAt, code),
  };
  if (result.id !== expectedId || (result.leaseOwner === null) !== (result.leaseUntil === null)) return fail(code);
  return result;
}
function entity(value: unknown, expected: AgendaEntityTarget, allowAdvancedSyncedRevision = false): Clase | Tocata {
  const code = "malformed_entity";
  const data = object(value, code);
  const id = identifier(data.id, code);
  if (id !== expected.entityId) return fail(code, `El ID de la entidad (${id}) no coincide con el objetivo (${expected.entityId})`, "id");
  const fecha = string(data.fecha, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fail(code, "La fecha debe tener formato válido AAAA-MM-DD (ej: 2025-05-14)", "fecha");
  timestamp(`${fecha}T00:00:00.000Z`, code);
  const horaInicio = string(data.horaInicio, code), horaFin = string(data.horaFin, code);
  for (const time of [horaInicio, horaFin]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return fail(code, `La hora '${time}' debe tener formato HH:MM de 24 horas (ej: 15:30)`, time === horaInicio ? "horaInicio" : "horaFin");
    }
  }
  const common = { id, fecha, horaInicio, horaFin, createdAt: timestamp(data.createdAt, code),
    updatedAt: timestamp(data.updatedAt, code),
    ...(data.googleCalendar === undefined || data.googleCalendar === null ? {} :
      { googleCalendar: metadata(data.googleCalendar, code, allowAdvancedSyncedRevision) }) };
  // Return only known domain fields. Optional historical nulls become absent.
  const optional = (key: string): string | undefined => data[key] === undefined || data[key] === null
    ? undefined : string(data[key], code);
  const notas = optional("notas");
  if (expected.entityType === "clase") {
    const alumnoId = identifier(data.alumnoId, code);
    if (!alumnoId || !alumnoId.trim()) return fail(code, "Debes seleccionar un alumno válido para la clase", "alumnoId");
    const result: Clase = { ...common, alumnoId,
      tipo: choice(data.tipo, ["alma", "escalera", "dj", "sokolov"], code), tema: string(data.tema, code),
      estado: choice(data.estado, ["programada", "realizada", "cancelada"], code),
      ...(notas === undefined ? {} : { notas }) };
    if (data.recordatorio !== undefined && data.recordatorio !== null) {
      const reminder = object(data.recordatorio, code);
      result.recordatorio = { activo: boolean(reminder.activo, code),
        antelacionValor: integer(reminder.antelacionValor, 0, code),
        antelacionUnidad: choice(reminder.antelacionUnidad, ["minutos", "horas", "dias"], code) };
      if (reminder.notificadoAt !== undefined && reminder.notificadoAt !== null)
        result.recordatorio.notificadoAt = timestamp(reminder.notificadoAt, code);
    }
    return result;
  }
  const result: Tocata = { ...common, titulo: string(data.titulo, code),
    proyecto: choice(data.proyecto, ["Rodrigo Valdivia", "Sokolov", "Área 51", "Otro"], code),
    estado: choice(data.estado, ["pendiente", "confirmada", "cancelada", "realizada"], code),
    ...(notas === undefined ? {} : { notas }) };
  for (const key of ["lugar", "ciudad", "direccion", "contacto"] satisfies Array<keyof Tocata>) {
    const value = optional(key);
    if (value !== undefined) result[key] = value;
  }
  if (data.honorarios !== undefined) {
    if (data.honorarios === null) result.honorarios = null;
    else if (typeof data.honorarios === "number" && Number.isFinite(data.honorarios)) result.honorarios = data.honorarios;
    else return fail(code);
  }
  return result;
}

export type AgendaEntityTarget = Pick<CalendarSyncBinding, "entityType" | "entityId">;
export interface AgendaMutationTransaction {
  getEntity(): Promise<Clase | Tocata | null>;
  getJob(jobId: string): Promise<GoogleCalendarSyncJob | null>;
  setEntity(value: Clase | Tocata): void;
  deleteEntity(): void;
  setJob(value: GoogleCalendarSyncJob): void;
}
export interface AgendaMutationStore {
  agendaTransaction<T>(uid: string, target: AgendaEntityTarget,
    callback: (tx: AgendaMutationTransaction) => Promise<T>): Promise<T>;
}

/** Reuse the strict decoder for business commands without exposing SDK objects. */
export function decodeAgendaEntity(value: unknown, target: AgendaEntityTarget): Clase | Tocata {
  return entity(value, target, true);
}

/** Caller supplies an authenticated UID. This class neither discovers nor authenticates users. */
export class FirestoreCalendarSyncStorage<Db, Ref> implements CalendarSyncStore, AgendaMutationStore {
  private readonly dependencies: FirestoreSyncDependencies<Db, Ref>;
  constructor(dependencies: FirestoreSyncDependencies<Db, Ref>) { this.dependencies = dependencies; }

  /** Additive API: one entity plus its deterministic job, never a nested transaction. */
  async agendaTransaction<T>(uid: string, target: AgendaEntityTarget,
    callback: (tx: AgendaMutationTransaction) => Promise<T>): Promise<T> {
    try {
      identifier(uid, "unauthenticated_or_missing_uid");
      const kind = choice(target.entityType, ["clase", "tocata"], "invalid_argument");
      const id = identifier(target.entityId, "invalid_argument");
      const scope = { entityType: kind, entityId: id };
      const deps = this.dependencies;
      const ref = deps.doc(deps.db, "users", uid, kind === "clase" ? "clases" : "tocatas", id);
      return await deps.runTransaction(deps.db, async native => {
        let open = true;
        let failed = false;
        const reads: Promise<unknown>[] = [];
        const jobs = new Map<string, { ref: Ref; read: Promise<GoogleCalendarSyncJob | null> }>();
        const intentions = new Map<string, GoogleCalendarSyncJob>();
        let entityRead: Promise<Clase | Tocata | null> | undefined;
        let pending: Clase | Tocata | null | undefined;
        const checked = <R>(action: () => R): R => {
          try { if (!open) fail("invalid_argument"); return action(); }
          catch (error) { failed = true; throw error; }
        };
        const read = <R>(ref: Ref, decode: (value: unknown) => R): Promise<R | null> => {
          const promise = (async () => {
            const snapshot = await native.get(ref);
            return snapshot.exists() ? decode(snapshot.data()) : null;
          })();
          reads.push(promise); void promise.catch(() => { failed = true; }); return promise;
        };
        const getEntity = () => checked(() => entityRead ??= read(ref, value => entity(value, scope, true)));
        const getJob = (id: string) => checked(() => {
          identifier(id, "invalid_argument");
          let entry = jobs.get(id);
          if (!entry) {
            const jobRef = deps.doc(deps.db, "users", uid, "calendarSyncJobs", id);
            entry = { ref: jobRef, read: read(jobRef, value => job(value, id, "malformed_job")) };
            jobs.set(id, entry);
          }
          return entry.read;
        });
        try {
          const result = await callback({ getEntity, getJob,
            setEntity: value => checked(() => { getEntity(); pending = entity(value, scope, true); }),
            deleteEntity: () => checked(() => { getEntity(); pending = null; }),
            setJob: value => checked(() => {
              const clean = job(value, value.id, "invalid_argument");
              if (clean.entityType !== kind || clean.entityId !== id) fail("invalid_argument");
              getJob(clean.id); intentions.set(clean.id, clean);
            }),
          });
          open = false;
          await Promise.all(reads);
          if (failed) fail("storage_failure");
          const original = entityRead ? await entityRead : null;
          if (pending === null && !native.delete) fail("storage_failure");
          // All reads and validations have completed before native writes start.
          if (pending === null) native.delete?.(ref);
          else if (pending !== undefined) {
            // update preserves unrelated stored fields; set is only for a new entity.
            if (original) native.update(ref, { ...pending });
            else native.set(ref, { ...pending });
          }
          for (const [id, value] of intentions) {
            const entry = jobs.get(id);
            if (!entry) fail("storage_failure");
            native.set(entry.ref, { ...value });
          }
          return result;
        } finally { open = false; }
      });
    } catch (error) {
      if (error instanceof FirestoreCalendarSyncStorageError) throw new FirestoreCalendarSyncStorageError(error.code);
      throw new FirestoreCalendarSyncStorageError("storage_failure");
    }
  }

  async transaction<T>(uid: string, jobId: string, callback: (tx: CalendarSyncTransaction) => Promise<T>): Promise<T> {
    try {
      identifier(uid, "unauthenticated_or_missing_uid");
      identifier(jobId, "invalid_argument");
      if (typeof callback !== "function") return fail("invalid_argument");
      const deps = this.dependencies;
      const jobRef = deps.doc(deps.db, "users", uid, "calendarSyncJobs", jobId);
      return await deps.runTransaction(deps.db, async (native) => {
        let open = true;
        let poisoned: unknown;
        const reads: Promise<unknown>[] = [];
        const entities = new Map<string, { ref: Ref; read: Promise<Clase | Tocata | null> }>();
        const updates = new Map<string, GoogleCalendarSyncMetadata>();
        let pendingJob: GoogleCalendarSyncJob | undefined;
        let jobRead: Promise<GoogleCalendarSyncJob | null> | undefined;
        const guard = () => { if (!open) fail("invalid_argument"); };
        const checked = <R>(action: () => R): R => {
          try { guard(); return action(); } catch (error) { poisoned = error; throw error; }
        };
        const read = <R>(ref: Ref, decode: (value: unknown) => R): Promise<R | null> => {
          const promise = (async () => {
            const snapshot = await native.get(ref);
            return snapshot.exists() ? decode(snapshot.data()) : null;
          })();
          reads.push(promise);
          // Attach immediately, even if the caller forgets to await or catches the rejection.
          void promise.catch((error: unknown) => { poisoned = error; });
          return promise;
        };
        const getEntity = (input: CalendarSyncBinding) => checked(() => {
          const valid = binding(input, "invalid_argument");
          const key = `${valid.entityType}/${valid.entityId}`;
          let entry = entities.get(key);
          if (!entry) {
            const ref = deps.doc(deps.db, "users", uid, valid.entityType === "clase" ? "clases" : "tocatas", valid.entityId);
            entry = { ref, read: read(ref, (value) => entity(value, valid)) };
            entities.set(key, entry);
          }
          return { key, entry };
        });
        try {
          const result = await callback({
            getJob: () => checked(() => {
              jobRead ??= read(jobRef, (value) => job(value, jobId, "malformed_job"));
              return jobRead;
            }),
            getEntity: (input) => getEntity(input).entry.read,
            setJob: (value) => checked(() => { pendingJob = job(value, jobId, "invalid_argument"); }),
            setMetadata: (input, value) => checked(() => {
              const valid = binding(input, "invalid_argument");
              const clean = metadata(value, "invalid_argument");
              if (clean.calendarId !== valid.calendarId ||
                (clean.googleAccountId !== undefined && clean.googleAccountId !== valid.googleAccountId)) fail("invalid_argument");
              const { key } = getEntity(valid);
              updates.set(key, clean);
            }),
          });
          open = false;
          await Promise.all(reads);
          if (poisoned !== undefined) throw poisoned;
          for (const key of updates.keys()) {
            const entry = entities.get(key);
            if (!entry || await entry.read === null) fail("entity_not_found");
          }
          if (pendingJob) native.set(jobRef, { ...pendingJob });
          for (const [key, clean] of updates) {
            const entry = entities.get(key);
            if (!entry) fail("entity_not_found");
            native.update(entry.ref, { googleCalendar: clean });
          }
          return result;
        } finally { open = false; }
      });
    } catch (error) {
      // Recreate controlled errors; never retain SDK messages, causes, stacks or objects.
      if (error instanceof FirestoreCalendarSyncStorageError) throw new FirestoreCalendarSyncStorageError(error.code);
      throw new FirestoreCalendarSyncStorageError("storage_failure");
    }
  }
}
