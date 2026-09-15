import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Clase, GoogleCalendarSyncJob, GoogleCalendarSyncMetadata } from "../types";
import { FirestoreCalendarSyncStorage, type FirestoreSyncDependencies, type FirestoreSyncTransaction } from "./firestoreCalendarSyncStorage.ts";
import { persistAgendaCalendarMutation, agendaEntityVersion, type AgendaCalendarMutation, type AgendaCalendarMutationResult } from "./agendaCalendarPersistence.ts";
import { createCalendarSyncIds, planCalendarSyncMutation, processCalendarSyncJob } from "./googleCalendarSync.ts";
import { enableCalendarLink, disableCalendarLink, enqueueCalendarSync, calendarLinkAuthorizationResult,
  type CalendarLinkResult } from "./agendaCalendarPersistence.ts";

const uid = "user-1", now = Date.parse("2026-09-08T12:00:00.000Z"), at = new Date(now).toISOString();
const target = { entityType: "clase", entityId: "class-1" } satisfies { entityType: "clase"; entityId: string };
const account = { googleAccountId: "google-1", calendarId: "primary" } satisfies { googleAccountId: string; calendarId: "primary" };
const binding = { ...target, ...account };
const authorizedLink = { ...account, authorized: true } satisfies { googleAccountId: string; calendarId: "primary"; authorized: true };
const data = { alumnoId: "student-1", tipo: "alma", fecha: "2026-09-10", horaInicio: "12:00", horaFin: "13:00",
  tema: "Tema", estado: "programada", notas: "nota ficticia" } satisfies Omit<Clase, "id" | "createdAt" | "updatedAt">;
const create = { ...target, operation: "create", data } satisfies AgendaCalendarMutation;
const entityPath = `users/${uid}/clases/${target.entityId}`;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** Optimistic transaction double: version checks, atomic commit, retry with fresh snapshots. */
function fixture() {
  const docs = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const log: Array<{ attempt: number; kind: string; path?: string; data?: Record<string, unknown> }> = [];
  const fault = { read: false, commit: false, write: false };
  let transactions = 0, attempts = 0;
  const put = (path: string, value: Record<string, unknown>) => {
    docs.set(path, structuredClone(value)); versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const dependencies: FirestoreSyncDependencies<object, string> = {
    db: {}, doc(_db, ...segments) { return segments.join("/"); },
    async runTransaction(_db, callback) {
      transactions++;
      for (let retry = 0; retry < 5; retry++) {
        const attempt = ++attempts;
        const reads = new Map<string, number>();
        const writes: Array<{ kind: "set" | "update" | "delete"; path: string; data?: Record<string, unknown> }> = [];
        const stage = (kind: "set" | "update" | "delete", path: string, data?: Record<string, unknown>) => {
          log.push({ attempt, kind, path, data });
          if (fault.write) throw new Error("fallo ficticio sensible");
          writes.push({ kind, path, data: data ? structuredClone(data) : undefined });
        };
        const tx: FirestoreSyncTransaction<string> = {
          async get(path) {
            assert.equal(writes.length, 0, "no reads after writes");
            log.push({ attempt, kind: "get", path });
            if (fault.read) throw new Error("permiso ficticio denegado");
            reads.set(path, versions.get(path) ?? 0);
            const value = docs.get(path); const copy = value ? structuredClone(value) : undefined;
            return { exists: () => copy !== undefined, data: () => copy };
          },
          set(path, value) { stage("set", path, value); },
          update(path, value) { stage("update", path, value); },
          delete(path) { stage("delete", path); },
        };
        const result = await callback(tx);
        if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
        if (fault.commit) throw new Error("resultado SDK ficticio");
        const next = new Map(docs);
        for (const write of writes) {
          if (write.kind === "delete") next.delete(write.path);
          else {
            if (!write.data) assert.fail("missing data");
            if (write.kind === "update" && !next.has(write.path)) throw new Error("missing entity");
            next.set(write.path, write.kind === "update" ? { ...next.get(write.path), ...write.data } : write.data);
          }
        }
        docs.clear(); for (const [path, value] of next) docs.set(path, value);
        for (const write of writes) versions.set(write.path, (versions.get(write.path) ?? 0) + 1);
        return result;
      }
      throw new Error("too much contention");
    },
  };
  const store = new FirestoreCalendarSyncStorage(dependencies);
  return { docs, log, fault, put, store, deps: { store, now: () => now }, transactions: () => transactions, attempts: () => attempts };
}
function applied(result: AgendaCalendarMutationResult) {
  assert.equal(result.status, "applied");
  if (result.status !== "applied") assert.fail("expected applied");
  return result;
}
async function linked(f: ReturnType<typeof fixture>) {
  const result = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...create, authorizedLink }));
  assert.ok(result.entity); assert.ok(result.version); assert.ok(result.jobId);
  return { entity: result.entity, version: result.version, jobId: result.jobId };
}
function jobDoc(f: ReturnType<typeof fixture>, id: string) { const value = f.docs.get(`users/${uid}/calendarSyncJobs/${id}`); assert.ok(value); return value; }

test("importación y construcción sin actividad ni imports externos", async () => {
  const f = fixture(); assert.equal(f.transactions(), 0);
  await import("./agendaCalendarPersistence.ts"); assert.deepEqual(f.log, []);
  const source = readFileSync(new URL("./agendaCalendarPersistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'](?:firebase|react|.*Auth|.*AgendaContext|.*googleCalendarService)|\b(?:fetch|setTimeout|setInterval|onSnapshot)\s*\(/);
});
test("create sin vínculo: una entidad sin metadata ni job; colisión no sobrescribe", async () => {
  const f = fixture(); applied(await persistAgendaCalendarMutation(f.deps, uid, create));
  assert.equal(f.transactions(), 1); assert.equal(f.docs.size, 1);
  assert.equal(Object.hasOwn(f.docs.get(entityPath) ?? {}, "googleCalendar"), false);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, create)).status, "conflict");
});
test("create vinculado: IDs estables, metadata mínima, dos escrituras atómicas", async () => {
  const f = fixture(), value = await linked(f), ids = await createCalendarSyncIds(uid, binding);
  assert.equal(value.jobId, ids.jobId); assert.equal(f.docs.size, 2); assert.equal(f.transactions(), 1);
  assert.equal(value.entity.googleCalendar?.revision, 1); assert.equal(value.entity.googleCalendar?.syncedRevision, 0);
  assert.equal(jobDoc(f, value.jobId).googleCalendarEventId, ids.googleCalendarEventId);
  assert.doesNotMatch(JSON.stringify(jobDoc(f, value.jobId)), /nota ficticia|student-1|alumnoId|honorarios|contacto|payload|token|Authorization/);
});
test("rechaza googleCalendar enviado por create/update y conserva documento original", async () => {
  const f = fixture();
  const badCreate = { ...create, data: { ...data, googleCalendar: { enabled: true } } };
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, badCreate)).status, "invalid_argument");
  assert.equal(f.transactions(), 0);
  const value = await linked(f); const snapshot = structuredClone([...f.docs]);
  const badUpdate: AgendaCalendarMutation = { ...target, operation: "update", preconditionVersion: value.version, patch: { tema: "Nuevo" } };
  Object.assign(badUpdate.patch, { googleCalendar: { revision: 99 } });
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, badUpdate)).status, "invalid_argument");
  assert.deepEqual([...f.docs], snapshot);
});
test("update sincronizable preserva vínculo, ETag, syncedRevision y lease", async () => {
  const f = fixture(), initial = await linked(f), ids = await createCalendarSyncIds(uid, binding);
  const entity = { ...initial.entity, googleCalendar: { ...initial.entity.googleCalendar, enabled: true,
    calendarId: "primary", revision: 4, syncedRevision: 3, etag: '"etag"', lastSyncedAt: at } };
  f.put(entityPath, entity);
  const until = new Date(now + 60000).toISOString();
  f.put(`users/${uid}/calendarSyncJobs/${ids.jobId}`, { ...jobDoc(f, ids.jobId), revision: 7,
    status: "processing", leaseOwner: "worker-1", leaseUntil: until, attempts: 2 });
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  const result = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
    preconditionVersion: await agendaEntityVersion(current, target), patch: { horaInicio: "11:00" } }));
  assert.equal(result.entity?.googleCalendar?.revision, 8); assert.equal(result.entity?.googleCalendar?.syncedRevision, 3);
  assert.equal(result.entity?.googleCalendar?.etag, '"etag"');
  assert.equal(jobDoc(f, ids.jobId).leaseOwner, "worker-1"); assert.equal(jobDoc(f, ids.jobId).leaseUntil, until);
  assert.equal(jobDoc(f, ids.jobId).googleCalendarEventId, ids.googleCalendarEventId);
});
test("update no-op no escribe; cambio no sincronizable preserva metadata y job", async () => {
  const f = fixture(), value = await linked(f); const previous = structuredClone(jobDoc(f, value.jobId));
  const writes = f.log.filter(x => x.kind !== "get").length;
  const noop = await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: value.version, patch: { tema: data.tema } });
  assert.equal(noop.status, "noop"); assert.equal(f.log.filter(x => x.kind !== "get").length, writes);
  const result = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: value.version, patch: { notas: "otra nota ficticia" } }));
  assert.deepEqual(result.entity?.googleCalendar, value.entity.googleCalendar);
  assert.deepEqual(jobDoc(f, value.jobId), previous);
});
test("update no vinculado no crea job; CAS detecta cambios incluso en el mismo milisegundo", async () => {
  const f = fixture(), initial = applied(await persistAgendaCalendarMutation(f.deps, uid, create)); assert.ok(initial.version);
  const change: AgendaCalendarMutation = { ...target, operation: "update", preconditionVersion: initial.version, patch: { tema: "Nuevo" } };
  const result = applied(await persistAgendaCalendarMutation(f.deps, uid, change));
  assert.ok(result.entity); assert.equal(f.docs.size, 1); assert.ok(result.entity.updatedAt > at);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, change)).status, "conflict");
});
test("dos updates concurrentes: uno applied, otro conflict tras retry, metadata conservada", async () => {
  const f = fixture(), value = await linked(f);
  const results = await Promise.all(["10:00", "11:00"].map(horaInicio => persistAgendaCalendarMutation(f.deps, uid,
    { ...target, operation: "update", preconditionVersion: value.version, patch: { horaInicio } })));
  assert.deepEqual(results.map(x => x.status).sort(), ["applied", "conflict"]);
  assert.equal(jobDoc(f, value.jobId).revision, 2); assert.ok(f.attempts() > f.transactions());
});
test("delete no vinculado borra solo entidad", async () => {
  const f = fixture(), result = applied(await persistAgendaCalendarMutation(f.deps, uid, create)); assert.ok(result.version);
  applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "delete", preconditionVersion: result.version }));
  assert.equal(f.docs.size, 0);
});
test("delete vinculado atómico; repetición localiza el mismo job sin incrementar revisión", async () => {
  const f = fixture(), value = await linked(f);
  const command: AgendaCalendarMutation = { ...target, operation: "delete", preconditionVersion: value.version, expectedLink: account };
  const deleted = applied(await persistAgendaCalendarMutation(f.deps, uid, command));
  assert.equal(deleted.jobId, value.jobId); assert.equal(f.docs.has(entityPath), false);
  const before = structuredClone(jobDoc(f, value.jobId)); assert.equal(before.operation, "delete"); assert.equal(before.revision, 2);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, command)).status, "noop");
  assert.deepEqual(jobDoc(f, value.jobId), before);
});
test("delete pendiente de igual revisión se reutiliza sin aumentarla", async () => {
  const f = fixture(), value = await linked(f);
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), operation: "delete" });
  applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "delete", preconditionVersion: value.version, expectedLink: account }));
  assert.equal(jobDoc(f, value.jobId).revision, 1);
});
for (const point of ["read", "write", "commit"] satisfies Array<keyof ReturnType<typeof fixture>["fault"]>) {
  test(`fallo ${point}: storage_failure sanitizado, sin commit parcial`, async () => {
    const f = fixture(), value = await linked(f), original = structuredClone([...f.docs]); f.fault[point] = true;
    const result = await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: value.version, patch: { horaInicio: "11:00" } });
    assert.deepEqual(result, { status: "storage_failure" }); assert.deepEqual([...f.docs], original);
  });
}
test("Tocata: create/update/delete con proyección propia de campos Calendar", async () => {
  const f = fixture();
  const target = { entityType: "tocata", entityId: "gig-1" } satisfies { entityType: "tocata"; entityId: string };
  const created = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "create", authorizedLink,
    data: { titulo: "Tocata", proyecto: "Otro", estado: "confirmada", fecha: "2026-09-10", horaInicio: "22:00", horaFin: "02:00", contacto: "contacto ficticio", honorarios: 99 } }));
  assert.ok(created.version);
  const updated = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: created.version, patch: { lugar: "Lugar" } }));
  assert.equal(updated.entity?.googleCalendar?.revision, 2); assert.ok(updated.version); assert.ok(updated.jobId);
  assert.doesNotMatch(JSON.stringify(jobDoc(f, updated.jobId)), /contacto|honorarios|payload/);
  applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "delete", preconditionVersion: updated.version, expectedLink: account }));
  assert.equal(jobDoc(f, updated.jobId).revision, 3);
});
test("pure planner: máximo de snapshots e IDs invariantes; rechaza contradicción y overflow", async () => {
  const metadata: GoogleCalendarSyncMetadata = { enabled: true, status: "synced", ...account, revision: 2, syncedRevision: 5 };
  const first = await planCalendarSyncMutation(uid, binding, null, metadata, "upsert", now);
  assert.equal(first.job.revision, 6); assert.equal(first.metadata.syncedRevision, 5);
  const second = await planCalendarSyncMutation(uid, binding, first.job, first.metadata, "delete", now);
  assert.equal(second.job.id, first.job.id); assert.equal(second.job.googleCalendarEventId, first.job.googleCalendarEventId);
  await assert.rejects(planCalendarSyncMutation(uid, binding, { ...first.job, googleAccountId: "other" }, first.metadata, "upsert", now));
  await assert.rejects(planCalendarSyncMutation(uid, binding, null, { ...metadata, revision: Number.MAX_SAFE_INTEGER }, "upsert", now));
});
test("update durante procesamiento: proceso anterior no completa la revisión nueva", async () => {
  const f = fixture(), value = await linked(f); let writes = 0;
  const result = await processCalendarSyncJob({ store: f.store, now: () => now, calendar: {
    async get() {
      const entity = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(entity);
      applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
        preconditionVersion: await agendaEntityVersion(entity, target), patch: { horaInicio: "11:00" } }));
      return { status: "not_found", requiresAccountValidation: true };
    },
    async create() { writes++; }, async patch() { writes++; }, async delete() { writes++; return { status: "deleted" }; },
  } }, uid, value.jobId, "worker-1");
  assert.equal(result.status, "stale_revision"); assert.equal(writes, 0); assert.equal(jobDoc(f, value.jobId).revision, 2);
});
test("sin UID, binding inválido y entidad ausente devuelven estados controlados", async () => {
  const f = fixture();
  assert.equal((await persistAgendaCalendarMutation(f.deps, "", create)).status, "invalid_argument");
  const bad = { ...create, authorizedLink }; Object.assign(bad, { authorizedLink: { ...authorizedLink, authorized: false } });
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, bad)).status, "invalid_argument"); assert.equal(f.transactions(), 0);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: "0".repeat(64), patch: {} })).status, "not_found");
});

test("CAS de metadata: finalización concurrente provoca conflicto sin perder syncedRevision", async () => {
  const f = fixture(), value = await linked(f), stored = f.docs.get(entityPath); assert.ok(stored);
  f.put(entityPath, { ...stored, googleCalendar: { ...value.entity.googleCalendar, status: "synced", syncedRevision: 1, etag: '"new"' } });
  const before = structuredClone([...f.docs]);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: value.version, patch: { horaInicio: "11:00" } })).status, "conflict");
  assert.deepEqual([...f.docs], before);
});
test("Calendar deshabilitado: edición y borrado no generan un nuevo job", async () => {
  const f = fixture(), value = await linked(f), stored = f.docs.get(entityPath); assert.ok(stored);
  f.put(entityPath, { ...stored, googleCalendar: { ...value.entity.googleCalendar, enabled: false } });
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  const before = structuredClone(jobDoc(f, value.jobId));
  const updated = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
    preconditionVersion: await agendaEntityVersion(current, target), patch: { horaInicio: "11:00" } }));
  assert.deepEqual(jobDoc(f, value.jobId), before); assert.ok(updated.version);
  applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "delete", preconditionVersion: updated.version }));
  assert.deepEqual(jobDoc(f, value.jobId), before);
});
test("syncedRevision superior se utiliza sin retroceder y conserva resultado anterior", async () => {
  const f = fixture(), value = await linked(f), stored = f.docs.get(entityPath); assert.ok(stored);
  f.put(entityPath, { ...stored, googleCalendar: { ...value.entity.googleCalendar, syncedRevision: 5 } });
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  const updated = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
    preconditionVersion: await agendaEntityVersion(current, target), patch: { horaInicio: "11:00" } }));
  assert.equal(updated.entity?.googleCalendar?.revision, 6); assert.equal(updated.entity?.googleCalendar?.syncedRevision, 5);
});
test("vínculo contradictorio del job retorna invalid_argument sin escribir", async () => {
  const f = fixture(), value = await linked(f);
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), googleAccountId: "other" });
  const before = structuredClone([...f.docs]);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: value.version, patch: { horaInicio: "11:00" } })).status, "invalid_argument");
  assert.deepEqual([...f.docs], before);
});
test("create no resucita un job previo del mismo vínculo", async () => {
  const f = fixture(), value = await linked(f); f.docs.delete(entityPath);
  const before = structuredClone([...f.docs]);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...create, authorizedLink })).status, "conflict");
  assert.deepEqual([...f.docs], before);
});
test("snapshot malformado y getters del comando se rechazan sin ejecutarlos", async () => {
  const f = fixture(); let getter = false;
  const bad = { ...create }; Object.defineProperty(bad, "data", { get() { getter = true; return data; } });
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, bad)).status, "invalid_argument");
  assert.equal(getter, false); assert.equal(f.transactions(), 0);
  f.put(entityPath, { id: target.entityId });
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update", preconditionVersion: "0".repeat(64), patch: {} })).status, "invalid_argument");
});
test("callback fallido descarta intenciones; transacción escapada queda cerrada", async () => {
  const f = fixture();
  const entity: Clase = { ...data, id: target.entityId, createdAt: at, updatedAt: at };
  await assert.rejects(f.store.agendaTransaction(uid, target, async tx => { tx.setEntity(entity); throw new Error("ficticio"); }));
  assert.equal(f.docs.size, 0);
  const escaped = await f.store.agendaTransaction(uid, target, async tx => tx);
  assert.throws(() => escaped.setEntity(entity)); assert.equal(f.docs.size, 0);
});

test("rechaza __proto__ propio y null fuera del contrato sin escribir", async () => {
  const f = fixture(), value = await linked(f);
  const before = structuredClone([...f.docs]);
  for (const key of ["__proto__", "notas", "recordatorio"]) {
    const patch = {};
    Object.defineProperty(patch, key, { value: null, enumerable: true });
    assert.equal((await persistAgendaCalendarMutation(f.deps, uid, {
      ...target, operation: "update", preconditionVersion: value.version, patch,
    })).status, "invalid_argument");
    assert.deepEqual([...f.docs], before);
  }
});

function linkValue(result: CalendarLinkResult) {
  if (!("entity" in result)) assert.fail(`Expected entity, got ${result.status}`);
  return result;
}
async function enableExisting(f: ReturnType<typeof fixture>) {
  const created = applied(await persistAgendaCalendarMutation(f.deps, uid, create)); assert.ok(created.version);
  return linkValue(await enableCalendarLink(f.deps, uid, target, created.version, authorizedLink));
}
test("vínculo: habilitar una entidad existente es atómico e idempotente", async () => {
  const f = fixture(), enabled = await enableExisting(f); assert.ok(enabled.jobId);
  assert.equal(enabled.status, "pending_upsert"); assert.equal(enabled.entity.googleCalendar?.revision, 1);
  const before = structuredClone([...f.docs]);
  const repeated = linkValue(await enableCalendarLink(f.deps, uid, target, enabled.version, authorizedLink));
  assert.equal(repeated.changed, false); assert.equal(repeated.jobId, enabled.jobId);
  assert.deepEqual([...f.docs], before); assert.equal(f.docs.size, 2);
});
test("vínculo: otra cuenta y precondición antigua no escriben", async () => {
  const f = fixture(), value = await enableExisting(f), before = structuredClone([...f.docs]);
  assert.equal((await enableCalendarLink(f.deps, uid, target, value.version,
    { ...authorizedLink, googleAccountId: "other" })).status, "account_mismatch");
  assert.equal((await enableCalendarLink(f.deps, uid, target, "0".repeat(64), authorizedLink)).status, "conflict");
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "upsert", "0".repeat(64))).status, "conflict");
  assert.deepEqual([...f.docs], before);
});
test("vínculo: desactivar conserva entidad, IDs, ETag, syncedRevision y lease", async () => {
  const f = fixture(), enabled = await enableExisting(f); assert.ok(enabled.jobId);
  const meta = enabled.entity.googleCalendar; assert.ok(meta);
  const entity = { ...enabled.entity, googleCalendar: { ...meta, revision: 3, syncedRevision: 2, etag: '"keep"' } };
  f.put(entityPath, entity);
  const prior = jobDoc(f, enabled.jobId);
  f.put(`users/${uid}/calendarSyncJobs/${enabled.jobId}`, { ...prior, revision: 7,
    leaseOwner: "worker", leaseUntil: "2026-09-08T12:01:00.000Z", status: "processing" });
  const result = linkValue(await disableCalendarLink(f.deps, uid, target, await agendaEntityVersion(entity, target)));
  assert.equal(result.status, "pending_delete"); assert.equal(result.entity.googleCalendar?.enabled, false);
  assert.equal(result.entity.googleCalendar?.revision, 8); assert.equal(result.entity.googleCalendar?.syncedRevision, 2);
  assert.equal(result.entity.googleCalendar?.etag, '"keep"'); assert.equal(result.jobId, enabled.jobId);
  const deletion = jobDoc(f, enabled.jobId);
  assert.equal(deletion.googleCalendarEventId, prior.googleCalendarEventId); assert.equal(deletion.leaseOwner, "worker");
  assert.equal(deletion.leaseUntil, "2026-09-08T12:01:00.000Z"); assert.notEqual(deletion.status, "completed");
  assert.equal(f.docs.has(entityPath), true); assert.equal(f.log.some(x => x.kind === "delete"), false);
  const before = structuredClone([...f.docs]);
  const repeated = linkValue(await disableCalendarLink(f.deps, uid, target, result.version));
  assert.equal(repeated.changed, false); assert.deepEqual([...f.docs], before);
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "delete", result.version)).status, "pending_delete");
  assert.deepEqual([...f.docs], before);
});
test("vínculo: borrado pendiente no se convierte en upsert por habilitación, encolado o edición", async () => {
  const f = fixture(), enabled = await enableExisting(f);
  const disabled = linkValue(await disableCalendarLink(f.deps, uid, target, enabled.version)); assert.ok(disabled.jobId);
  const before = structuredClone(jobDoc(f, disabled.jobId));
  assert.equal((await enableCalendarLink(f.deps, uid, target, disabled.version, authorizedLink)).status, "conflict");
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "upsert", disabled.version)).status, "conflict");
  applied(await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
    preconditionVersion: disabled.version, patch: { horaInicio: "10:00" } }));
  assert.deepEqual(jobDoc(f, disabled.jobId), before);
});
test("vínculo: enqueue duplicado no escribe; delete no puede contradecir enabled", async () => {
  const f = fixture(), value = await enableExisting(f), before = structuredClone([...f.docs]);
  assert.equal(linkValue(await enqueueCalendarSync(f.deps, uid, target, "upsert", value.version)).changed, false);
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "delete", value.version)).status, "conflict");
  assert.deepEqual([...f.docs], before);
});
test("vínculo: job de otra cuenta y metadata sin ID fallan sin reparación", async () => {
  const f = fixture(), value = await enableExisting(f); assert.ok(value.jobId);
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), googleAccountId: "other" });
  const before = structuredClone([...f.docs]);
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "upsert", value.version)).status, "invalid_argument");
  assert.deepEqual([...f.docs], before);
  const broken = { ...value.entity, googleCalendar: { enabled: true, status: "pending", calendarId: "primary",
    googleAccountId: "google-1", revision: 1, syncedRevision: 0 } };
  f.put(entityPath, broken);
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  assert.equal((await disableCalendarLink(f.deps, uid, target, await agendaEntityVersion(current, target))).status, "invalid_argument");
});
for (const fault of ["write", "commit"] satisfies Array<"write" | "commit">) {
  test(`vínculo: fallo ${fault} no deja desactivación parcial`, async () => {
    const f = fixture(), value = await enableExisting(f), before = structuredClone([...f.docs]); f.fault[fault] = true;
    assert.deepEqual(await disableCalendarLink(f.deps, uid, target, value.version), { status: "storage_failure" });
    assert.deepEqual([...f.docs], before);
  });
}
test("vínculo: callbacks concurrentes conservan un job y rechazan la precondición vieja", async () => {
  const f = fixture(), created = applied(await persistAgendaCalendarMutation(f.deps, uid, create)); assert.ok(created.version);
  const version = created.version;
  const results = await Promise.all([enableCalendarLink(f.deps, uid, target, version, authorizedLink),
    enableCalendarLink(f.deps, uid, target, version, authorizedLink)]);
  assert.deepEqual(results.map(x => x.status).sort(), ["conflict", "pending_upsert"]);
  assert.ok(f.attempts() > f.transactions()); assert.equal(f.docs.size, 2);
  const ids = await createCalendarSyncIds(uid, binding); assert.equal(jobDoc(f, ids.jobId).revision, 1);
});
test("vínculo: autorización solo produce resultados y no elimina un delete bloqueado", async () => {
  const f = fixture(), enabled = await enableExisting(f); assert.ok(enabled.jobId);
  const error = { code: "requires_reauthorization", message: "Se requiere validar la cuenta y renovar la autorización.", at, retryable: false };
  f.put(`users/${uid}/calendarSyncJobs/${enabled.jobId}`, { ...jobDoc(f, enabled.jobId), lastError: error, status: "error" });
  const disabled = linkValue(await disableCalendarLink(f.deps, uid, target, enabled.version));
  assert.equal(disabled.status, "authorization_required"); assert.equal(disabled.operation, "delete");
  const before = structuredClone([...f.docs]);
  assert.deepEqual(calendarLinkAuthorizationResult("authorized"), { status: "authorization_valid", requiresConditionalOperation: true });
  assert.equal(calendarLinkAuthorizationResult("auth_cancelled").status, "authorization_required");
  assert.equal(calendarLinkAuthorizationResult("requires_reauthorization").status, "authorization_required");
  assert.equal(calendarLinkAuthorizationResult("account_mismatch").status, "account_mismatch");
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "delete", disabled.version)).status, "authorization_required");
  assert.deepEqual([...f.docs], before);
});
test("vínculo: sin vínculo, ausente y argumentos extra son controlados", async () => {
  const f = fixture(), created = applied(await persistAgendaCalendarMutation(f.deps, uid, create)); assert.ok(created.version);
  assert.equal((await disableCalendarLink(f.deps, uid, target, created.version)).status, "not_linked");
  const extra = { ...authorizedLink, token: "ficticio" };
  assert.equal((await enableCalendarLink(f.deps, uid, target, created.version, extra)).status, "invalid_argument");
  assert.equal((await enableCalendarLink(f.deps, uid, { ...target, entityId: "missing" }, created.version, authorizedLink)).status, "not_found");
  assert.equal(f.docs.size, 1);
});

test("vínculo: Tocata se conserva y sus datos de negocio no entran al job", async () => {
  const f = fixture();
  const gig = { entityType: "tocata", entityId: "gig-2" } satisfies { entityType: "tocata"; entityId: string };
  const created = applied(await persistAgendaCalendarMutation(f.deps, uid, { ...gig, operation: "create",
    data: { titulo: "Tocata", proyecto: "Otro", estado: "confirmada", fecha: "2026-09-10", horaInicio: "22:00", horaFin: "02:00",
      contacto: "contacto ficticio", honorarios: 99, notas: "nota ficticia" } })); assert.ok(created.version);
  const enabled = linkValue(await enableCalendarLink(f.deps, uid, gig, created.version, authorizedLink));
  const disabled = linkValue(await disableCalendarLink(f.deps, uid, gig, enabled.version)); assert.ok(disabled.jobId);
  assert.equal(f.docs.has(`users/${uid}/tocatas/${gig.entityId}`), true);
  assert.equal(disabled.entity.notas, "nota ficticia");
  assert.doesNotMatch(JSON.stringify(jobDoc(f, disabled.jobId)), /contacto|honorarios|nota ficticia|payload|token|Authorization/);
});
test("vínculo: estado synced y error no se reencolan automáticamente", async () => {
  const f = fixture(), value = await enableExisting(f); assert.ok(value.jobId);
  const entity = { ...value.entity, googleCalendar: { ...value.entity.googleCalendar, enabled: true,
    calendarId: "primary", googleAccountId: account.googleAccountId, revision: 1, syncedRevision: 1, status: "synced" } };
  f.put(entityPath, entity);
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), status: "completed" });
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  const version = await agendaEntityVersion(current, target);
  assert.equal((await enqueueCalendarSync(f.deps, uid, target, "upsert", version)).status, "synced");
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), status: "error",
    lastError: { code: "foreign_event", message: "El evento no pertenece exactamente al vínculo esperado.", at, retryable: false } });
  const before = structuredClone([...f.docs]);
  assert.equal((await enableCalendarLink(f.deps, uid, target, version, authorizedLink)).status, "error");
  assert.deepEqual([...f.docs], before);
});
test("vínculo: enqueue calcula desde syncedRevision superior y conserva ETag", async () => {
  const f = fixture(), value = await enableExisting(f);
  f.put(entityPath, { ...value.entity, googleCalendar: { ...value.entity.googleCalendar, syncedRevision: 5, etag: '"stable"' } });
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  const queued = linkValue(await enqueueCalendarSync(f.deps, uid, target, "upsert", await agendaEntityVersion(current, target)));
  assert.equal(queued.entity.googleCalendar?.revision, 6); assert.equal(queued.entity.googleCalendar?.syncedRevision, 5);
  assert.equal(queued.entity.googleCalendar?.etag, '"stable"'); assert.equal(queued.jobId, value.jobId);
});
test("vínculo: desactivación durante GET invalida al procesador anterior", async () => {
  const f = fixture(), value = await enableExisting(f); assert.ok(value.jobId); let writes = 0;
  const result = await processCalendarSyncJob({ store: f.store, now: () => now, calendar: {
    async get() {
      const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
      assert.equal((await disableCalendarLink(f.deps, uid, target, await agendaEntityVersion(current, target))).status, "pending_delete");
      return { status: "not_found", requiresAccountValidation: true };
    },
    async create() { writes++; }, async patch() { writes++; }, async delete() { writes++; return { status: "deleted" }; },
  } }, uid, value.jobId, "worker");
  assert.equal(result.status, "stale_revision"); assert.equal(writes, 0);
  assert.equal(jobDoc(f, value.jobId).operation, "delete"); assert.equal(f.docs.has(entityPath), true);
});
test("vínculo: planner y CRUD rechazan transformar un delete existente en upsert", async () => {
  const f = fixture(), value = await enableExisting(f); assert.ok(value.jobId);
  f.put(`users/${uid}/calendarSyncJobs/${value.jobId}`, { ...jobDoc(f, value.jobId), operation: "delete" });
  const before = structuredClone([...f.docs]);
  assert.equal((await persistAgendaCalendarMutation(f.deps, uid, { ...target, operation: "update",
    preconditionVersion: value.version, patch: { horaInicio: "10:00" } })).status, "invalid_argument");
  assert.deepEqual([...f.docs], before);
  const deleted = linkValue(await disableCalendarLink(f.deps, uid, target, value.version)); assert.ok(deleted.jobId);
  f.put(`users/${uid}/calendarSyncJobs/${deleted.jobId}`, { ...jobDoc(f, deleted.jobId), status: "completed" });
  assert.equal((await enableCalendarLink(f.deps, uid, target, deleted.version, authorizedLink)).status, "conflict");
});

test("vínculo: el procesador existente finaliza delete conservando la entidad deshabilitada", async () => {
  const f = fixture(), value = await enableExisting(f);
  const disabled = linkValue(await disableCalendarLink(f.deps, uid, target, value.version)); assert.ok(disabled.jobId);
  const eventId = disabled.entity.googleCalendar?.googleCalendarEventId; assert.ok(eventId);
  let deletes = 0;
  const result = await processCalendarSyncJob({ store: f.store, now: () => now, calendar: {
    async get() { return { status: "found", event: { id: eventId, etag: '"etag"', extendedProperties: { private: {
      app: "profesor-agenda", syncJobId: disabled.jobId ?? "", entityType: "clase", entityId: target.entityId,
      sourceApp: "profesor-agenda", sourceType: "clase", sourceKey: "class-1", sourceRevision: "2", mappingVersion: "1",
    } } } }; },
    async create() { assert.fail("unexpected create"); }, async patch() { assert.fail("unexpected patch"); },
    async delete(_scope, id, etag) { assert.equal(id, eventId); assert.equal(etag, '"etag"'); deletes++; return { status: "deleted" }; },
  } }, uid, disabled.jobId, "worker");
  assert.equal(result.status, "completed"); assert.equal(deletes, 1);
  const current = await f.store.agendaTransaction(uid, target, tx => tx.getEntity()); assert.ok(current);
  assert.equal(current.googleCalendar?.enabled, false); assert.equal(current.googleCalendar?.status, "unlinked");
  const before = structuredClone([...f.docs]);
  const repeated = linkValue(await disableCalendarLink(f.deps, uid, target, await agendaEntityVersion(current, target)));
  assert.equal(repeated.status, "not_linked"); assert.equal(repeated.changed, false); assert.deepEqual([...f.docs], before);
});
