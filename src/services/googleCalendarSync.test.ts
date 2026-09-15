import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Clase, Tocata, GoogleCalendarSyncJob } from "../types";
import {
  CALENDAR_SYNC_MAX_ATTEMPTS, createCalendarSyncIds, classifyCalendarSyncError,
  calendarSyncBackoff, calendarSyncRetryDelay, type CalendarSyncBinding,
  enqueueCalendarSyncJob, reserveJob, processCalendarSyncJob, CALENDAR_SYNC_LEASE_MS,
  type CalendarSyncStore, type CalendarSyncTransaction, type CalendarSyncCalendar,
  type CalendarSyncRemoteEvent, type CalendarSyncPayload,
} from "./googleCalendarSync.ts";

const binding: CalendarSyncBinding = {
  entityType: "clase", entityId: "entity-1", googleAccountId: "account-1", calendarId: "primary",
};
const at = "2026-09-08T12:00:00.000Z";

test("IDs estables con vector SHA-256 independiente y alfabeto válido", async () => {
  const ids = await createCalendarSyncIds("uid-1", binding);
  const hash = createHash("sha256").update(
    '["profesor-agenda-sync-v1","uid-1","clase","entity-1","account-1","primary"]',
  ).digest("hex");
  assert.deepEqual(ids, { jobId: `pa_${hash}`, googleCalendarEventId: `pa${hash}` });
  assert.deepEqual(ids, await createCalendarSyncIds("uid-1", { ...binding }));
  assert.match(ids.jobId, /^pa_[0-9a-f]{64}$/);
  assert.match(ids.googleCalendarEventId, /^[a-v0-9]{66}$/);
});

test("revisión, operación, reintento y datos extra no alteran IDs ni se devuelven", async () => {
  const first = await createCalendarSyncIds("uid-1", binding);
  const extra = { ...binding, revision: 20, operation: "delete", attempts: 4,
    notas: "dato-de-prueba", contacto: "contacto-de-prueba", honorarios: 42 };
  assert.deepEqual(await createCalendarSyncIds("uid-1", extra), first);
  assert.deepEqual(Object.keys(first).sort(), ["googleCalendarEventId", "jobId"]);
});

test("IDs separados por usuario, cuenta, entidad y tipo", async () => {
  const values = await Promise.all([
    createCalendarSyncIds("uid-1", binding),
    createCalendarSyncIds("uid-2", binding),
    createCalendarSyncIds("uid-1", { ...binding, googleAccountId: "account-2" }),
    createCalendarSyncIds("uid-1", { ...binding, entityId: "entity-2" }),
    createCalendarSyncIds("uid-1", { ...binding, entityType: "tocata" }),
  ]);
  assert.equal(new Set(values.map((value) => value.jobId)).size, values.length);
  assert.equal(new Set(values.map((value) => value.googleCalendarEventId)).size, values.length);
});

test("tupla evita ambigüedad por separadores", async () => {
  const a = await createCalendarSyncIds("uid-1", { ...binding, entityId: "a:b", googleAccountId: "c" });
  const b = await createCalendarSyncIds("uid-1", { ...binding, entityId: "a", googleAccountId: "b:c" });
  assert.notEqual(a.jobId, b.jobId);
});

for (const invalid of ["", " ", ".", "..", "path/segment", "\u0000", "\ud800", "x".repeat(513)]) {
  test(`rechaza identificador inválido ${JSON.stringify(invalid)}`, async () => {
    await assert.rejects(createCalendarSyncIds(invalid, binding), /Identificador inválido/);
    await assert.rejects(createCalendarSyncIds("uid-1", { ...binding, entityId: invalid }));
    await assert.rejects(createCalendarSyncIds("uid-1", { ...binding, googleAccountId: invalid }));
  });
}

const cases: Array<{ error: unknown; code: string; retryable: boolean }> = [
  { error: { status: 401 }, code: "requires_reauthorization", retryable: false },
  { error: { status: 403 }, code: "requires_reauthorization", retryable: false },
  { error: { status: 401, code: "rate_limited" }, code: "requires_reauthorization", retryable: false },
  { error: { status: 403, reason: "insufficientPermissions" }, code: "requires_reauthorization", retryable: false },
  { error: { status: 403, reason: "rateLimitExceeded" }, code: "rate_limited", retryable: true },
  { error: { status: 403, reason: "userRateLimitExceeded" }, code: "rate_limited", retryable: true },
  { error: { status: 404 }, code: "not_found", retryable: false },
  { error: { status: 409 }, code: "conflict", retryable: true },
  { error: { status: 412 }, code: "precondition_failed", retryable: true },
  { error: { status: 429 }, code: "rate_limited", retryable: true },
  { error: { status: 500 }, code: "server_error", retryable: true },
  { error: { status: 503 }, code: "server_error", retryable: true },
  { error: { status: 599 }, code: "server_error", retryable: true },
  { error: { status: 400 }, code: "invalid_request", retryable: false },
  { error: { status: 418, code: "network_error" }, code: "unknown_error", retryable: false },
  { error: { code: "network_error" }, code: "uncertain_result", retryable: true },
  { error: { code: "timeout" }, code: "uncertain_result", retryable: true },
  { error: { code: "invalid_response" }, code: "uncertain_result", retryable: true },
  { error: { name: "TimeoutError" }, code: "uncertain_result", retryable: true },
  { error: { name: "AbortError" }, code: "uncertain_result", retryable: true },
  { error: null, code: "unknown_error", retryable: false },
  { error: "texto ajeno", code: "unknown_error", retryable: false },
  { error: new Error("mensaje ajeno"), code: "unknown_error", retryable: false },
];
for (const [index, entry] of cases.entries()) {
  test(`clasificación pura ${index + 1}: ${entry.code}`, () => {
    const result = classifyCalendarSyncError(entry.error, at);
    assert.equal(result.code, entry.code);
    assert.equal(result.retryable, entry.retryable);
    assert.equal(result.at, at);
    assert.deepEqual(Object.keys(result).sort(), ["at", "code", "message", "retryable"]);
    assert.equal(calendarSyncRetryDelay(result, 1), entry.retryable ? 1_000 : null);
  });
}

test("códigos del adaptador existente sin status mantienen clasificación", () => {
  for (const [code, expected] of [
    ["unauthorized", "requires_reauthorization"], ["forbidden", "requires_reauthorization"],
    ["conflict", "conflict"], ["precondition_failed", "precondition_failed"],
    ["rate_limited", "rate_limited"], ["server_error", "server_error"],
    ["invalid_request", "invalid_request"],
  ]) assert.equal(classifyCalendarSyncError({ code }, at).code, expected);
});

test("404 en delete exige decisión superior, nunca éxito o reintento automático", () => {
  for (const error of [{ status: 404 }, { code: "not_found" }]) {
    const result = classifyCalendarSyncError(error, at, "delete");
    assert.equal(result.code, "delete_not_found");
    assert.equal(result.retryable, false);
    assert.equal(calendarSyncRetryDelay(result, 1), null);
  }
});

test("backoff acotado y parada tras cinco intentos", () => {
  assert.equal(CALENDAR_SYNC_MAX_ATTEMPTS, 5);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9999].map(calendarSyncBackoff),
    [1_000, 2_000, 4_000, 8_000, null, null, null]);
  const error = classifyCalendarSyncError({ status: 503 }, at);
  assert.equal(calendarSyncRetryDelay(error, 4), 8_000);
  assert.equal(calendarSyncRetryDelay(error, 5), null);
});

test("intentos inválidos se rechazan sin coerción o desbordamiento", () => {
  for (const attempts of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calendarSyncBackoff(attempts), /Intento inválido/);
  }
});

test("mensajes/cuerpos/campos sensibles no se copian ni se ejecutan getters", () => {
  const input = { status: 503, message: "mensaje-de-prueba", body: "cuerpo-de-prueba",
    accessToken: "marcador-ficticio", notas: "nota-de-prueba", stack: "pila-de-prueba" };
  const result = classifyCalendarSyncError(input, at);
  assert.deepEqual(result, classifyCalendarSyncError({ status: 503 }, at));
  let reads = 0;
  const withGetter = { get code() { reads += 1; throw new Error("no ejecutar"); } };
  assert.equal(classifyCalendarSyncError(withGetter, at).code, "unknown_error");
  assert.equal(reads, 0);
});

test("timestamp canónico y rechazo de fecha inválida", () => {
  assert.equal(classifyCalendarSyncError({}, "2026-09-08T09:00:00-03:00").at, at);
  assert.throws(() => classifyCalendarSyncError({}, "fecha inválida"), RangeError);
});

// This adapter models atomic commit/rollback and serializes concurrent workers.
// A production adapter must provide the same guarantees with real transactions.
class MemorySyncStore implements CalendarSyncStore {
  job: GoogleCalendarSyncJob | null = null;
  entity: Clase | Tocata | null = {
    id: binding.entityId, alumnoId: "PRIVATE_STUDENT", tema: "PRIVATE_TOPIC", notas: "PRIVATE_NOTES",
    tipo: "alma", fecha: "2026-09-15", horaInicio: "18:00", horaFin: "19:00", estado: "programada",
    createdAt: at, updatedAt: at, googleCalendar: {
      enabled: true, status: "pending", calendarId: "primary", googleAccountId: binding.googleAccountId,
      revision: 1, syncedRevision: 0,
    },
  };
  inside = false;
  private tail: Promise<void> = Promise.resolve();
  transaction<T>(uid: string, id: string, callback: (tx: CalendarSyncTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      assert.equal(uid, "uid-1");
      if (this.job) assert.equal(id, this.job.id);
      let job = structuredClone(this.job);
      let entity = structuredClone(this.entity);
      let written = false;
      this.inside = true;
      try {
        const value = await callback({
          getJob: async () => { assert.equal(written, false); return structuredClone(job); },
          getEntity: async () => { assert.equal(written, false); return structuredClone(entity); },
          setJob: (next) => { written = true; job = structuredClone(next); },
          setMetadata: (_binding, metadata) => { written = true; assert.ok(entity); entity.googleCalendar = structuredClone(metadata); },
        });
        this.job = job; this.entity = entity;
        return value;
      } finally { this.inside = false; }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

async function setupSync(operation: "upsert" | "delete" = "upsert") {
  const store = new MemorySyncStore();
  let now = new Date(at).getTime();
  const job = await enqueueCalendarSyncJob(store, "uid-1", { ...binding, operation, revision: 1 }, now);
  let remote: CalendarSyncRemoteEvent | null = null;
  const calls: Array<{ method: string; id: string; etag?: string; payload?: CalendarSyncPayload }> = [];
  const record = (method: string, id: string, etag?: string, payload?: CalendarSyncPayload) => {
    assert.equal(store.inside, false, "Calendar operation inside storage transaction");
    calls.push({ method, id, etag, payload });
  };
  const calendar: CalendarSyncCalendar = {
    get: async (scope, id) => {
      assert.deepEqual(scope, { uid: "uid-1", ...binding }); record("GET", id);
      return remote ? { status: "found", event: structuredClone(remote) } : { status: "not_found", requiresAccountValidation: true };
    },
    create: async (_scope, id, payload) => {
      record("POST", id, undefined, payload);
      if (remote) throw { status: 409 };
      remote = { ...structuredClone(payload), id, etag: '"v1"' };
      return structuredClone(remote);
    },
    patch: async (_scope, id, payload, etag) => {
      record("PATCH", id, etag, payload);
      if (etag !== remote?.etag) throw { status: 412 };
      remote = { ...structuredClone(payload), id, etag: '"v2"' };
      return structuredClone(remote);
    },
    delete: async (_scope, id, etag) => {
      record("DELETE", id, etag);
      if (etag !== remote?.etag) throw { status: 412 };
      remote = null; return { status: "deleted" };
    },
  };
  return {
    store, calendar, job, calls,
    get now() { return now; }, advance: (ms: number) => { now += ms; },
    get current() { assert.ok(store.job); return store.job; },
    get metadata() { assert.ok(store.entity?.googleCalendar); return store.entity.googleCalendar; },
    get remote() { assert.ok(remote); return remote; },
    set remote(value: CalendarSyncRemoteEvent) { remote = value; },
    run: (owner = "worker-1") => processCalendarSyncJob({ store, calendar, now: () => now }, "uid-1", job.id, owner),
    reserve: (owner = "worker-1") => reserveJob(store, "uid-1", job.id, owner, now),
    enqueue: (revision: number, nextOperation: "upsert" | "delete" = "upsert") =>
      enqueueCalendarSyncJob(store, "uid-1", { ...binding, revision, operation: nextOperation }, now),
  };
}

test("B: import has no processor invocation or automatic work", () => {
  const code = readFileSync(new URL("./googleCalendarSync.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /\b(?:fetch|setTimeout|setInterval|addEventListener)\s*\(/);
  assert.doesNotMatch(code, /from\s+["'][^"']*(?:firebase|googleCalendarAuth)["']/);
  assert.equal((code.match(/processCalendarSyncJob\(/g) ?? []).length, 1);
});

test("B: atomic competing reservations increment attempts only once", async () => {
  const f = await setupSync();
  const results = await Promise.all([f.reserve("a"), f.reserve("b")]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["reserved", "skipped"]);
  assert.equal(f.current.attempts, 1);
  assert.equal((await f.reserve("a")).status, "skipped");
  assert.equal(f.current.attempts, 1);
  assert.equal(f.calls.length, 0);
});

test("B: exact lease expiry permits recovery; completed never runs again", async () => {
  const f = await setupSync(); await f.reserve("a");
  f.advance(CALENDAR_SYNC_LEASE_MS - 1);
  assert.equal((await f.run("b")).status, "skipped");
  f.advance(1);
  assert.equal((await f.run("b")).status, "completed");
  assert.equal(f.current.attempts, 2);
  const count = f.calls.length;
  assert.equal((await f.run("a")).status, "skipped");
  assert.equal(f.calls.length, count);
  assert.equal(f.current.attempts, 2);
});

test("B: malformed timestamps fail closed without reservation or Calendar", async () => {
  for (const invalid of ["tomorrow", "2026-09-08", "2026-02-30T12:00:00.000Z", "2026-09-08T12:00:00-03:00"]) {
    const f = await setupSync();
    f.current.leaseOwner = "a"; f.current.leaseUntil = invalid;
    assert.equal((await f.run()).status, "error");
    assert.equal(f.current.attempts, 0); assert.equal(f.calls.length, 0);
  }
});

test("B: first upsert uses stable ID, approved link, safe job and saved ETag", async () => {
  const f = await setupSync();
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "POST"]);
  assert.ok(f.calls.every((c) => c.id === f.job.googleCalendarEventId));
  const link = f.remote.extendedProperties?.private;
  assert.equal(link?.app, "profesor-agenda"); assert.equal(link?.syncJobId, f.job.id);
  assert.equal(link?.entityType, "clase"); assert.equal(link?.entityId, binding.entityId);
  assert.equal(f.metadata.etag, '"v1"'); assert.equal(f.metadata.syncedRevision, 1);
  assert.doesNotMatch(JSON.stringify(f.current), /PRIVATE_|summary|description|reminders|Authorization/);
  assert.equal(f.current.leaseOwner, null); assert.equal(f.current.leaseUntil, null);
});

test("B: timeout after potential POST reconciles GET same ID without another POST", async () => {
  const f = await setupSync(); const create = f.calendar.create;
  f.calendar.create = async (...args) => { await create(...args); throw { code: "timeout" }; };
  assert.equal((await f.run()).status, "retry_scheduled");
  assert.equal(f.current.leaseOwner, null);
  assert.equal((await f.run()).status, "skipped"); assert.equal(f.current.attempts, 1);
  f.advance(1_000);
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "POST", "GET"]);
  assert.ok(f.calls.every((c) => c.id === f.job.googleCalendarEventId));
});

test("B: uncertain POST with GET 404 recreates exactly the same ID", async () => {
  const f = await setupSync(); const create = f.calendar.create;
  f.calendar.create = async () => { throw { code: "network_error" }; };
  await f.run(); f.advance(1_000); f.calendar.create = create;
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "GET", "POST"]);
  assert.ok(f.calls.every((c) => c.id === f.job.googleCalendarEventId));
});

for (const operation of ["upsert", "delete"] as const) test(`B: foreign syncJobId blocks ${operation} with no write`, async () => {
  const f = await setupSync(); await f.run();
  const properties = f.remote.extendedProperties; assert.ok(properties);
  properties.private.syncJobId = "someone-else";
  f.metadata.revision = 2; await f.enqueue(2, operation); f.calls.length = 0;
  const result = await f.run();
  assert.equal(result.status, "error"); assert.equal(f.current.lastError?.code, "foreign_event");
  assert.equal(f.current.lastError?.retryable, false);
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"]);
  assert.equal((await f.run()).status, "skipped");
});

for (const field of ["app", "entityType", "entityId"] as const) test(`B: mismatched ${field} is not claimed`, async () => {
  const f = await setupSync(); await f.run();
  const properties = f.remote.extendedProperties; assert.ok(properties);
  // Deleting a marker models an unrelated/incomplete remote event without casts.
  Reflect.deleteProperty(properties.private, field);
  f.metadata.revision = 2; await f.enqueue(2); f.calls.length = 0;
  await f.run(); assert.equal(f.current.lastError?.code, "foreign_event");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"]);
});

for (const status of [401, 403, 409, 412]) test(`B: ${status} requires decision, no automatic retries`, async () => {
  const f = await setupSync();
  f.calendar.get = async () => { throw { status, reason: "rateLimitExceeded", message: "PRIVATE_MESSAGE" }; };
  assert.equal((await f.run()).status, "error");
  assert.equal(f.current.lastError?.code, status < 409 ? "requires_reauthorization" : status === 409 ? "conflict" : "precondition_failed");
  assert.equal(f.current.lastError?.retryable, false); assert.equal(f.current.nextAttemptAt, null);
  assert.equal(f.current.leaseOwner, null); assert.equal((await f.run()).status, "skipped");
  assert.doesNotMatch(JSON.stringify(f.current), /PRIVATE_MESSAGE/);
});

for (const cause of [{ status: 429 }, { status: 500 }, { status: 503 }, { code: "network_error" }, { code: "timeout" }]) {
  test(`B: bounded retry policy ${JSON.stringify(cause)}`, async () => {
    const f = await setupSync(); f.calendar.get = async () => { throw cause; };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal((await f.run()).status, attempt < 5 ? "retry_scheduled" : "error");
      assert.equal(f.current.attempts, attempt); assert.equal(f.current.leaseUntil, null);
      f.advance(calendarSyncBackoff(attempt) ?? 0);
    }
    assert.equal(f.current.lastError?.code, "attempts_exhausted");
    assert.equal(f.current.lastError?.retryable, false); assert.equal(f.current.nextAttemptAt, null);
    assert.equal((await f.run()).status, "skipped");
  });
}

for (const variant of ["lookup", "result", "throw"] as const) test(`B: DELETE 404 (${variant}) requires upper decision`, async () => {
  const f = await setupSync();
  if (variant !== "lookup") await f.run();
  f.metadata.revision = 2; await f.enqueue(2, "delete"); f.calls.length = 0;
  if (variant === "result") f.calendar.delete = async () => ({ status: "not_found", requiresAccountValidation: true });
  if (variant === "throw") f.calendar.delete = async () => { throw { status: 404 }; };
  assert.equal((await f.run()).status, "error");
  assert.equal(f.current.lastError?.code, "not_found_requires_upper_decision");
  assert.equal(f.current.nextAttemptAt, null); assert.notEqual(f.metadata.syncedRevision, 2);
  assert.equal(f.calls.some((c) => c.method === "POST"), false);
});

test("B: DELETE uses current ETag and 412 never deletes blindly", async () => {
  const f = await setupSync(); await f.run();
  f.metadata.revision = 2; await f.enqueue(2, "delete");
  const remove = f.calendar.delete;
  f.calendar.delete = async (scope, id, etag) => {
    assert.equal(etag, '"v1"'); f.remote.etag = '"changed"'; return remove(scope, id, etag);
  };
  assert.equal((await f.run()).status, "error");
  assert.equal(f.current.lastError?.code, "precondition_failed");
  assert.equal(f.current.lastError?.retryable, false); assert.equal((await f.run()).status, "skipped");
});

test("B: old POST completion cannot overwrite new revision or delete operation", async () => {
  const f = await setupSync(); const create = f.calendar.create;
  f.calendar.create = async (...args) => {
    const result = await create(...args);
    f.metadata.revision = 2; await f.enqueue(2, "delete"); return result;
  };
  assert.equal((await f.run()).status, "stale_revision");
  assert.equal(f.current.revision, 2); assert.equal(f.current.operation, "delete");
  assert.equal(f.current.status, "pending"); assert.equal(f.metadata.syncedRevision, 0);
  assert.equal((await f.run("second")).status, "skipped");
  f.advance(CALENDAR_SYNC_LEASE_MS);
  assert.equal((await f.run("second")).status, "completed");
  assert.equal(f.calls.at(-1)?.method, "DELETE"); assert.equal(f.metadata.syncedRevision, 2);
});

test("B: new edit during GET prevents stale PATCH or POST", async () => {
  const f = await setupSync(); const get = f.calendar.get;
  f.calendar.get = async (...args) => {
    const result = await get(...args); f.metadata.revision = 2; await f.enqueue(2); return result;
  };
  assert.equal((await f.run()).status, "stale_revision");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"]);
  assert.equal(f.current.status, "pending"); assert.equal(f.current.revision, 2);
});

test("B: expired worker cannot finalize over a recovered worker", async () => {
  const f = await setupSync(); const create = f.calendar.create;
  f.calendar.create = async (...args) => {
    const result = await create(...args); f.advance(CALENDAR_SYNC_LEASE_MS);
    assert.equal((await f.run("second")).status, "completed"); return result;
  };
  assert.equal((await f.run()).status, "lease_lost");
  assert.equal(f.current.status, "completed"); assert.equal(f.current.attempts, 2);
});

test("B: newer desired payload patches own event and saves ETag", async () => {
  const f = await setupSync(); await f.run();
  assert.ok(f.store.entity); f.store.entity.estado = "cancelada";
  f.metadata.revision = 2; await f.enqueue(2);
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.calls.at(-1)?.method, "PATCH"); assert.equal(f.calls.at(-1)?.etag, '"v1"');
  assert.deepEqual(f.remote.reminders, { useDefault: false, overrides: [] });
  assert.equal(f.metadata.etag, '"v2"');
});

test("B: enqueue projects extras, preserves stable IDs and rejects same-revision operation changes", async () => {
  const f = await setupSync();
  const original = structuredClone(f.current);
  assert.deepEqual(await f.enqueue(1), original);
  await assert.rejects(f.enqueue(1, "delete"));
  const input = { ...binding, revision: 2, operation: "upsert" as const,
    notas: "PRIVATE_NOTES", alumno: "PRIVATE_STUDENT", contacto: "PRIVATE_CONTACT", honorarios: 100 };
  f.metadata.revision = 2;
  const job = await enqueueCalendarSyncJob(f.store, "uid-1", input, f.now);
  assert.equal(job.id, original.id); assert.equal(job.googleCalendarEventId, original.googleCalendarEventId);
  assert.doesNotMatch(JSON.stringify(job), /PRIVATE_|honorarios|payload/);
});

test("B: error getters are not evaluated or persisted", async () => {
  const f = await setupSync(); let reads = 0;
  f.calendar.get = async () => { throw { get code() { reads += 1; return "PRIVATE_ERROR"; }, body: "PRIVATE_BODY" }; };
  await f.run(); assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(f.current), /PRIVATE_/);
  assert.equal(f.current.lastError?.code, "unknown_error");
});

test("B: uncertain PATCH is reconciled by GET without a second PATCH", async () => {
  const f = await setupSync(); await f.run();
  assert.ok(f.store.entity); f.store.entity.horaInicio = "17:00";
  f.metadata.revision = 2; await f.enqueue(2); f.calls.length = 0;
  const patch = f.calendar.patch;
  f.calendar.patch = async (...args) => { await patch(...args); throw { status: 503 }; };
  assert.equal((await f.run()).status, "retry_scheduled");
  f.advance(1_000);
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "PATCH", "GET"]);
  assert.equal(f.metadata.syncedRevision, 2); assert.equal(f.metadata.etag, '"v2"');
});

test("B: POST 409 stops; only a newer revision permits another decision", async () => {
  const f = await setupSync();
  f.calendar.create = async () => { throw { status: 409 }; };
  assert.equal((await f.run()).status, "error");
  assert.equal(f.current.lastError?.code, "conflict");
  assert.equal((await f.run()).status, "skipped");
  f.metadata.revision = 2; await f.enqueue(2);
  assert.equal(f.current.status, "pending"); assert.equal(f.current.attempts, 0);
  assert.equal(f.current.googleCalendarEventId, f.job.googleCalendarEventId);
});

test("B: five crashed reservations cannot cause a sixth Calendar attempt", async () => {
  const f = await setupSync();
  for (let index = 0; index < 5; index += 1) { await f.reserve(); f.advance(CALENDAR_SYNC_LEASE_MS); }
  assert.equal((await f.run()).status, "error");
  assert.equal(f.current.lastError?.code, "attempts_exhausted");
  assert.equal(f.current.attempts, 5); assert.equal(f.calls.length, 0);
  assert.equal(f.current.leaseUntil, null);
});

test("B: persistence projection strips runtime extras and hostile stored error messages", async () => {
  const f = await setupSync();
  f.store.job = { ...f.current, lastError: { code: "server_error", message: "PRIVATE_BODY", at, retryable: true } };
  Object.assign(f.current, { notes: "PRIVATE_NOTES", responseBody: "PRIVATE_BODY" });
  Object.assign(f.metadata, { contact: "PRIVATE_CONTACT", credential: "PRIVATE_CREDENTIAL" });
  assert.equal((await f.run()).status, "completed");
  assert.doesNotMatch(JSON.stringify(f.current), /PRIVATE_/);
  assert.doesNotMatch(JSON.stringify(f.metadata), /PRIVATE_/);
});

test("B: missing ETag is optional; deleted entity still supports its tombstone job", async () => {
  const f = await setupSync(); await f.run();
  Reflect.deleteProperty(f.remote, "etag");
  f.store.entity = null; await f.enqueue(2, "delete");
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.calls.at(-1)?.method, "DELETE"); assert.equal(f.calls.at(-1)?.etag, undefined);
});
