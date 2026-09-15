import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Clase, Tocata, GoogleCalendarSyncJob, GoogleCalendarSyncMetadata } from "../types";
import type { CalendarSyncBinding, CalendarSyncTransaction } from "./googleCalendarSync";
import { createCalendarSyncIds, enqueueCalendarSyncJob, reserveJob, processCalendarSyncJob } from "./googleCalendarSync.ts";
import {
  FirestoreCalendarSyncStorage, FirestoreCalendarSyncStorageError,
  type FirestoreSyncDependencies, type FirestoreSyncTransaction,
} from "./firestoreCalendarSyncStorage.ts";

const uid = "user-1", at = "2026-09-08T12:00:00.000Z";
const binding: CalendarSyncBinding = { entityType: "clase", entityId: "entity-1", googleAccountId: "account-1", calendarId: "primary" };
const metadata: GoogleCalendarSyncMetadata = { enabled: true, status: "pending", calendarId: "primary",
  googleAccountId: binding.googleAccountId, googleCalendarEventId: "pa12345", revision: 1, syncedRevision: 0 };
const job: GoogleCalendarSyncJob = { id: "job-1", ...binding, googleCalendarEventId: "pa12345", operation: "upsert",
  revision: 1, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null,
  leaseOwner: null, leaseUntil: null, createdAt: at, updatedAt: at };
const clase: Clase = { id: binding.entityId, alumnoId: "student-1", tipo: "alma", fecha: "2026-09-10",
  horaInicio: "12:00", horaFin: "13:00", tema: "Tema de prueba", estado: "programada",
  notas: "nota ficticia", createdAt: at, updatedAt: at, googleCalendar: metadata };
const tocata: Tocata = { id: binding.entityId, titulo: "Prueba", fecha: clase.fecha, horaInicio: "12:00",
  horaFin: "13:00", proyecto: "Otro", estado: "confirmada", contacto: "contacto ficticio", honorarios: 42,
  createdAt: at, updatedAt: at, googleCalendar: metadata };
const jobPath = `users/${uid}/calendarSyncJobs/${job.id}`;
const entityPath = `users/${uid}/clases/${binding.entityId}`;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function code(expected: string) {
  return (error: unknown) => error instanceof FirestoreCalendarSyncStorageError && error.code === expected &&
    error.message === `Calendar sync storage: ${expected}.` && !Object.hasOwn(error, "cause");
}

/** Transaction double: commit atomically, discard conflicts, record read/write ordering. */
function fixture() {
  const docs = new Map<string, unknown>([[jobPath, job], [entityPath, clase]]);
  const calls: string[] = [];
  const writes: Array<{ kind: string; path: string; data: Record<string, unknown> }> = [];
  const faults = { get: false, set: false, update: false, commit: false, retry: false, doc: false };
  let active = false;
  let beforeRetry: (() => void) | undefined;
  const deps: FirestoreSyncDependencies<object, string> = {
    db: {},
    doc(_db, ...segments) {
      if (faults.doc) throw new Error("diagnóstico SDK ficticio");
      const path = segments.join("/"); calls.push(`doc:${path}`); return path;
    },
    async runTransaction(_db, callback) {
      calls.push("transaction");
      for (let attempt = 0; ; attempt++) {
        const pending: typeof writes = [];
        const native: FirestoreSyncTransaction<string> = {
          async get(path) {
            calls.push(`get:${path}`);
            if (faults.get) throw new Error("diagnóstico SDK ficticio");
            const exists = docs.has(path), value = docs.get(path);
            await Promise.resolve(); calls.push(`read-done:${path}`);
            return { exists: () => exists, data: () => value };
          },
          set(path, data) {
            calls.push(`set:${path}`);
            if (faults.set) throw new Error("diagnóstico SDK ficticio");
            pending.push({ kind: "set", path, data });
          },
          update(path, data) {
            calls.push(`update:${path}`);
            if (faults.update) throw new Error("diagnóstico SDK ficticio");
            pending.push({ kind: "update", path, data });
          },
        };
        const result = await (async () => {
          active = true;
          try { return await callback(native); } finally { active = false; }
        })();
        if (faults.retry && attempt === 0) { beforeRetry?.(); continue; }
        if (faults.commit) throw new Error("diagnóstico SDK ficticio");
        const next = new Map(docs);
        for (const write of pending) {
          const original = next.get(write.path);
          if (write.kind === "set") next.set(write.path, write.data);
          else {
            if (!isRecord(original)) throw new Error("missing document");
            next.set(write.path, { ...original, ...write.data });
          }
        }
        docs.clear(); for (const [path, value] of next) docs.set(path, value);
        writes.push(...pending); return result;
      }
    },
  };
  return { store: new FirestoreCalendarSyncStorage(deps), docs, calls, writes, faults,
    isTransactionActive: () => active,
    onRetry(action: () => void) { beforeRetry = action; } };
}

test("importación y construcción no ejecutan dependencias; sin imports SDK ni efectos", async () => {
  const f = fixture(); assert.deepEqual(f.calls, []);
  const source = readFileSync(new URL("./firestoreCalendarSyncStorage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'](?:firebase|.*lib\/firebase)|\b(?:fetch|setTimeout|setInterval|onSnapshot|Worker)\s*\(/);
  const module = await import("./firestoreCalendarSyncStorage.ts");
  assert.equal(module.FirestoreCalendarSyncStorage, FirestoreCalendarSyncStorage);
  assert.deepEqual(f.calls, []);
});

for (const invalid of ["", " ", ".", "..", "x/y", "x\\y", "\u0000", "\ud800", "x".repeat(513)]) {
  test(`identificadores inválidos ${JSON.stringify(invalid)}`, async () => {
    const f = fixture();
    await assert.rejects(f.store.transaction(invalid, job.id, async () => {}), code("unauthenticated_or_missing_uid"));
    await assert.rejects(f.store.transaction(uid, invalid, async () => {}), code("invalid_argument"));
    assert.deepEqual(f.calls, []);
    for (const input of [{ ...binding, entityId: invalid }, { ...binding, googleAccountId: invalid }]) {
      await assert.rejects(f.store.transaction(uid, job.id, async tx => { await tx.getEntity(input); }), code("invalid_argument"));
    }
    assert.equal(f.calls.filter(call => call.startsWith("get:")).length, 0);
  });
}
test("calendario/tipo inválidos se rechazan antes de formar la ruta de entidad", async () => {
  const f = fixture();
  for (const extra of [{ calendarId: "other" }, { entityType: "other" }, { googleAccountId: null }, { entityId: undefined }]) {
    const bad = { ...binding }; Object.assign(bad, extra);
    await assert.rejects(f.store.transaction(uid, job.id, async tx => { await tx.getEntity(bad); }), code("invalid_argument"));
  }
  assert.equal(f.calls.filter(call => call.startsWith("doc:") && !call.endsWith("job-1")).length, 0);
});
test("rutas exactas; documento ausente devuelve null; clase y tocata válidas", async () => {
  const f = fixture();
  const path = `users/${uid}/tocatas/${binding.entityId}`; f.docs.set(path, tocata);
  await f.store.transaction(uid, job.id, async tx => {
    assert.deepEqual(await tx.getJob(), job);
    assert.deepEqual(await tx.getEntity(binding), clase);
    assert.deepEqual(await tx.getEntity({ ...binding, entityType: "tocata" }), tocata);
  });
  assert.deepEqual(f.calls.filter(c => c.startsWith("get:")), [`get:${jobPath}`, `get:${entityPath}`, `get:${path}`]);
  f.docs.clear();
  await f.store.transaction(uid, job.id, async tx => {
    assert.equal(await tx.getJob(), null); assert.equal(await tx.getEntity(binding), null);
  });
});
for (const extra of [{ revision: undefined }, { createdAt: new Date(at) }, { leaseUntil: "bad" },
  { calendarId: "other" }, { attempts: -1 }, { id: "wrong" }, { nextAttemptAt: undefined },
  { lastError: new Error("ficticio") }, { updatedAt: { seconds: 1, nanoseconds: 0 } }]) {
  test(`job malformado ${Object.keys(extra)[0]}`, async () => {
    const f = fixture(); f.docs.set(jobPath, { ...job, ...extra });
    await assert.rejects(f.store.transaction(uid, job.id, tx => tx.getJob()), code("malformed_job"));
    assert.deepEqual(f.writes, []);
  });
}
test("entidad malformada se distingue de inexistente; getters no se ejecutan", async () => {
  const f = fixture(); let invoked = false;
  const malicious = { ...clase }; Object.defineProperty(malicious, "extra", { get() { invoked = true; return "dato ficticio"; } });
  for (const value of [{}, { ...clase, id: "wrong" }, { ...clase, fecha: "2026-02-30" },
    { ...clase, horaFin: "25:00" }, malicious, new Error("ficticio")]) {
    f.docs.set(entityPath, value);
    await assert.rejects(f.store.transaction(uid, job.id, tx => tx.getEntity(binding)), code("malformed_entity"));
  }
  assert.equal(invoked, false);
});
test("job y lastError solo guardan campos autorizados; copias independientes", async () => {
  const f = fixture();
  const lastError = { code: "server_error", message: "Fallo temporal del servicio.", at, retryable: true,
    response: { simulated: true }, stack: "pila ficticia" };
  const input = { ...job, lastError, token: "marcador ficticio", Authorization: "marcador ficticio",
    payload: clase, notas: "dato ficticio", unexpected: new Date(at), rawError: new Error("ficticio") };
  await f.store.transaction(uid, job.id, async tx => {
    tx.setJob(input); lastError.message = "mutación posterior";
  });
  const expected = { ...job, lastError: { code: "server_error", message: "Fallo temporal del servicio.", at, retryable: true } };
  assert.deepEqual(f.docs.get(jobPath), expected);
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), Object.keys(job).sort());
  assert.doesNotMatch(JSON.stringify(f.writes), /marcador|payload|notas|Authorization|stack|rawError/);
});
test("rechaza error crudo o mensaje arbitrario incluso dentro de lastError", async () => {
  for (const lastError of [new Error("ficticio"), { code: "server_error", message: "diagnóstico ficticio", at, retryable: true }]) {
    const f = fixture(), input = { ...job }; Object.assign(input, { lastError });
    await assert.rejects(f.store.transaction(uid, job.id, async tx => tx.setJob(input)), code("invalid_argument"));
    assert.deepEqual(f.writes, []);
  }
});
test("metadata reemplaza solo googleCalendar, omite undefined y conserva null", async () => {
  const f = fixture();
  const input = { ...metadata, etag: null, lastError: null, lastSyncedAt: undefined, payload: tocata };
  await f.store.transaction(uid, job.id, async tx => tx.setMetadata(binding, input));
  const expected = { ...metadata, etag: null, lastError: null };
  assert.deepEqual(f.writes, [{ kind: "update", path: entityPath, data: { googleCalendar: expected } }]);
  assert.deepEqual(f.docs.get(entityPath), { ...clase, googleCalendar: expected });
});
test("setMetadata comprueba existencia incluso sin getEntity explícito", async () => {
  const f = fixture(); f.docs.delete(entityPath);
  await assert.rejects(f.store.transaction(uid, job.id, async tx => {
    tx.setJob(job); tx.setMetadata(binding, metadata);
  }), code("entity_not_found"));
  assert.deepEqual(f.writes, []); assert.equal(f.docs.has(entityPath), false);
  assert.equal(f.calls.some(c => c.startsWith("set:")), false);
});
test("todas las lecturas terminan antes de escribir, incluso si no se esperan", async () => {
  const f = fixture();
  await f.store.transaction(uid, job.id, async tx => {
    tx.setJob(job); tx.setMetadata(binding, metadata); void tx.getJob();
  });
  const writeIndex = f.calls.findIndex(c => c.startsWith("set:"));
  assert.ok(writeIndex > 0);
  assert.equal(f.calls.slice(writeIndex).some(c => c.startsWith("get:") || c.startsWith("read-done:")), false);
});
test("callback fallido descarta escrituras; fallo de lectura capturado también aborta", async () => {
  const f = fixture();
  await assert.rejects(f.store.transaction(uid, job.id, async tx => { tx.setJob(job); throw new Error("ficticio"); }), code("storage_failure"));
  f.faults.get = true;
  await assert.rejects(f.store.transaction(uid, job.id, async tx => {
    try { await tx.getJob(); } catch { /* must still abort */ } tx.setJob(job);
  }), code("storage_failure"));
  assert.deepEqual(f.writes, []);
});
for (const fault of ["get", "set", "update", "commit", "doc"] satisfies Array<keyof ReturnType<typeof fixture>["faults"]>) {
  test(`fallo ${fault} sanitizado y sin commit parcial`, async () => {
    const f = fixture(); f.faults[fault] = true;
    await assert.rejects(f.store.transaction(uid, job.id, async tx => {
      await tx.getJob(); tx.setJob({ ...job, revision: 2 }); tx.setMetadata(binding, metadata);
    }), code("storage_failure"));
    assert.deepEqual(f.docs.get(jobPath), job); assert.deepEqual(f.writes, []);
  });
}
test("repetición de callback descarta intenciones anteriores y devuelve último resultado", async () => {
  const f = fixture(); f.faults.retry = true; let attempts = 0;
  const result = await f.store.transaction(uid, job.id, async tx => {
    attempts++; await tx.getJob();
    if (attempts === 1) { tx.setJob({ ...job, revision: 2 }); tx.setMetadata(binding, metadata); }
    return attempts;
  });
  assert.equal(result, 2); assert.deepEqual(f.writes, []);
});
test("transacción escapada queda cerrada", async () => {
  const f = fixture(); let escaped: CalendarSyncTransaction | undefined;
  await f.store.transaction(uid, job.id, async tx => { escaped = tx; });
  assert.ok(escaped); assert.throws(() => escaped.setJob(job), code("invalid_argument"));
  assert.deepEqual(f.writes, []);
});
test("núcleo reserva mediante el adaptador y no pierde una revisión concurrente", async () => {
  const f = fixture(); f.faults.retry = true;
  f.onRetry(() => f.docs.set(jobPath, { ...job, revision: 2 }));
  const result = await reserveJob(f.store, uid, job.id, "worker-1", Date.parse(at));
  assert.equal(result.status, "reserved");
  if (result.status !== "reserved") assert.fail("reserva esperada");
  assert.equal(result.job.revision, 2); assert.equal(result.job.attempts, 1);
});
test("procesador manual con Calendar doble fuera de transacciones; revisión nueva no se completa", async () => {
  const f = fixture(), ids = await createCalendarSyncIds(uid, binding);
  const path = `users/${uid}/calendarSyncJobs/${ids.jobId}`;
  f.docs.set(entityPath, { ...clase, googleCalendar: { ...metadata, googleCalendarEventId: ids.googleCalendarEventId } });
  await enqueueCalendarSyncJob(f.store, uid, { ...binding, revision: 1, operation: "upsert" }, Date.parse(at));
  let writes = 0;
  const result = await processCalendarSyncJob({ store: f.store, now: () => Date.parse(at), calendar: {
    async get() {
      assert.equal(f.isTransactionActive(), false);
      const previous = f.docs.get(path); assert.ok(isRecord(previous));
      f.docs.set(path, { ...previous, revision: 2, status: "pending" });
      return { status: "not_found", requiresAccountValidation: true };
    },
    async create() { writes++; }, async patch() { writes++; },
    async delete() { writes++; return { status: "deleted" }; },
  } }, uid, ids.jobId, "worker-1");
  assert.equal(result.status, "stale_revision"); assert.equal(writes, 0);
  const current = f.docs.get(path); assert.ok(isRecord(current));
  assert.equal(current.revision, 2); assert.equal(current.status, "pending");
});

test("flujo manual exitoso persiste job y metadata; Calendar siempre fuera del callback", async () => {
  const f = fixture(), ids = await createCalendarSyncIds(uid, binding);
  f.docs.set(entityPath, { ...clase, googleCalendar: { ...metadata, googleCalendarEventId: ids.googleCalendarEventId } });
  await enqueueCalendarSyncJob(f.store, uid, { ...binding, revision: 1, operation: "upsert" }, Date.parse(at));
  const calls: string[] = [];
  const result = await processCalendarSyncJob({ store: f.store, now: () => Date.parse(at), calendar: {
    async get(_scope, id) {
      assert.equal(f.isTransactionActive(), false); assert.equal(id, ids.googleCalendarEventId); calls.push("get");
      return { status: "not_found", requiresAccountValidation: true };
    },
    async create(_scope, id) {
      assert.equal(f.isTransactionActive(), false); assert.equal(id, ids.googleCalendarEventId); calls.push("create");
    },
    async patch() { assert.fail("unexpected patch"); },
    async delete() { assert.fail("unexpected delete"); },
  } }, uid, ids.jobId, "worker-1");
  assert.equal(result.status, "completed"); assert.deepEqual(calls, ["get", "create"]);
  const storedJob = f.docs.get(`users/${uid}/calendarSyncJobs/${ids.jobId}`);
  assert.ok(isRecord(storedJob)); assert.equal(storedJob.status, "completed");
  assert.equal(storedJob.leaseOwner, null); assert.equal(storedJob.leaseUntil, null);
  const storedEntity = f.docs.get(entityPath); assert.ok(isRecord(storedEntity));
  assert.ok(isRecord(storedEntity.googleCalendar));
  assert.equal(storedEntity.googleCalendar.syncedRevision, 1);
  assert.equal(storedEntity.googleCalendar.status, "synced"); assert.equal(storedEntity.notas, clase.notas);
});

test("extra malicioso al leer se excluye; null histórico opcional se normaliza", async () => {
  const f = fixture();
  f.docs.set(jobPath, { ...job, payload: { simulated: true } });
  f.docs.set(entityPath, { ...clase, notas: null, recordatorio: null, extra: { simulated: true } });
  await f.store.transaction(uid, job.id, async tx => {
    assert.deepEqual(await tx.getJob(), job);
    const value = await tx.getEntity(binding); assert.ok(value);
    assert.equal(Object.hasOwn(value, "notas"), false);
    assert.equal(Object.hasOwn(value, "extra"), false);
  });
});

test("intención inválida capturada por el callback impide otras escrituras", async () => {
  const f = fixture();
  await assert.rejects(f.store.transaction(uid, job.id, async tx => {
    tx.setJob(job);
    try { tx.setMetadata({ ...binding, entityId: "bad/path" }, metadata); } catch { /* must abort */ }
  }), code("invalid_argument"));
  assert.deepEqual(f.writes, []);
});
