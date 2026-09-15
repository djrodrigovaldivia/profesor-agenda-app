// Same module-mock + tsx pattern used by googleCalendarAuth.test.ts.
import assert from "node:assert/strict";
import { beforeEach, afterEach, mock, test } from "node:test";
import type { Clase, Tocata } from "../types";
import type { FirestoreSyncTransaction } from "../services/firestoreCalendarSyncStorage";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function deferred() {
  let resolve: () => void = () => assert.fail("not initialized");
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: "owner" } };
const docs = new Map<string, Record<string, unknown>>();
let transactions = 0, retryOnce = false, failCommit = false;
let gate: ReturnType<typeof deferred> | null = null;
let started = deferred();
const unexpected = () => assert.fail("Unexpected external operation");
mock.module("firebase/firestore", { namedExports: {
  doc: (_db: unknown, ...segments: string[]) => segments.join("/"),
  async runTransaction<T>(_db: unknown, callback: (tx: FirestoreSyncTransaction<string>) => Promise<T>): Promise<T> {
    transactions++;
    for (;;) {
      const writes: Array<() => void> = [];
      const next = new Map(docs);
      const tx: FirestoreSyncTransaction<string> = {
        async get(path) {
          assert.equal(writes.length, 0, "reads must precede writes");
          const copy = structuredClone(docs.get(path));
          return { exists: () => copy !== undefined, data: () => copy };
        },
        set(path, value) { writes.push(() => next.set(path, structuredClone(value))); },
        update(path, value) { writes.push(() => { assert.ok(next.has(path)); next.set(path, { ...next.get(path), ...structuredClone(value) }); }); },
        delete(path) { writes.push(() => next.delete(path)); },
      };
      const result = await callback(tx);
      started.resolve();
      if (gate) await gate.promise;
      if (failCommit) throw new Error("private SDK diagnostics");
      if (retryOnce) { retryOnce = false; continue; }
      for (const write of writes) write();
      docs.clear(); for (const [path, value] of next) docs.set(path, value);
      return result;
    }
  },
  collection: unexpected, setDoc: unexpected, updateDoc: unexpected, deleteDoc: unexpected,
  onSnapshot: unexpected, getDocs: unexpected, getDoc: unexpected, writeBatch: unexpected, query: unexpected, where: unexpected,
} });
mock.module("../lib/firebase", { namedExports: {
  auth, db: {}, handleFirestoreError: unexpected, OperationType: {},
  cleanForFirestore: unexpected, sanitizeForFirestore: unexpected, enableFirestoreNetwork: unexpected,
} });
mock.module("./AuthContext", {
  namedExports: {
    useAuth: () => ({
      currentUser: auth.currentUser,
      calendarAuth: { status: "not_authorized", identity: null },
      authorizeCalendar: async () => {},
      clearCalendarAuth: () => {},
    }),
  },
});
mock.module("../utils/notificationService", { namedExports: {
  checkAndNotifyUpcomingEvents: unexpected, checkAndNotifyClaseReminders: unexpected, registerNotificationServiceWorker: unexpected,
  getNotificationPermission: () => "default", requestNotificationPermission: unexpected,
  calculateNotificationTriggerTime: () => null, sendTestClaseNotification: unexpected,
} });
mock.module("../components/common/Modal", { namedExports: { Modal: "modal" } });
mock.module("../components/common/ConfirmDialog", { namedExports: { ConfirmDialog: "confirm" } });
mock.module("lucide-react", { namedExports: Object.fromEntries([
  "Clock", "Calendar", "BookOpen", "AlertCircle", "Trash2", "Copy", "Bell", "Volume2", "CheckCircle2",
  "MapPin", "DollarSign", "Phone", "Radio", "UserPlus", "Loader2", "RefreshCw", "ExternalLink",
].map(name => [name, name])) });

// Exercise the real components with a small hook harness, without a DOM or SDK.
function hooks() {
  const slots: unknown[] = [], effects: Array<() => unknown> = [];
  return { slots, cursor: 0, effects, runEffects: false };
}
let provider = hooks(), modal = hooks(), active = provider, contextValue: unknown;
const react = {
  createContext: () => ({ Provider: "provider" }), useContext: () => contextValue,
  useState(initial: unknown) {
    const h = active, index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial;
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }];
  },
  useRef(initial: unknown) {
    const index = active.cursor++;
    if (!(index in active.slots)) active.slots[index] = { current: initial };
    return active.slots[index];
  },
  useEffect(effect: () => unknown, deps: unknown[]) {
    const index = active.cursor++, previous = active.slots[index];
    active.slots[index] = deps;
    if (active.runEffects && (!Array.isArray(previous) || deps.some((v, i) => v !== previous[i]))) active.effects.push(effect);
  },
  useMemo: (factory: () => unknown) => factory(), useCallback: (fn: unknown) => fn,
  createElement: (type: unknown, props: unknown) => jsx(type, props),
};
function jsx(type: unknown, props: unknown) {
  if (type === "provider" && object(props)) contextValue = props.value;
  return { type, props };
}
mock.module("react", { defaultExport: react, namedExports: react });
mock.module("react/jsx-runtime", { namedExports: { jsx, jsxs: jsx, Fragment: "fragment" } });
const { AgendaProvider, useAgenda, AgendaCrudError } = await import("./AgendaContext");
const { ClaseModal } = await import("../components/modals/ClaseModal");
const { TocataModal } = await import("../components/modals/TocataModal");
const { createCalendarSyncIds } = await import("../services/googleCalendarSync.ts");
const at = "2026-09-10T12:00:00.000Z";
const clase: Clase = { id: "class-1", alumnoId: "student", tipo: "alma", tema: "Tema", estado: "programada",
  fecha: "2026-09-11", horaInicio: "12:00", horaFin: "13:00", createdAt: at, updatedAt: at };
const tocata: Tocata = { id: "gig-1", titulo: "Evento", proyecto: "Otro", estado: "confirmada",
  fecha: "2026-09-11", horaInicio: "22:00", horaFin: "02:00", createdAt: at, updatedAt: at };
const localData = new Map<string, string>();
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => {
  provider = hooks(); modal = hooks(); modal.runEffects = true; contextValue = undefined;
  auth.currentUser = { uid: "owner" }; docs.clear(); localData.clear();
  transactions = 0; failCommit = false; retryOnce = false; gate = null; started = deferred();
  localData.set("profesor_agenda_alumnos_v3", JSON.stringify([{ id: "student", nombre: "Alumno", activo: true }]));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => localData.get(key) ?? null } });
  mock.method(globalThis, "fetch", async () => assert.fail("No network permitted"));
});
afterEach(() => {
  mock.restoreAll();
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function renderProvider() {
  active = provider; active.cursor = 0; AgendaProvider({ children: null });
  return useAgenda();
}
function renderModal(kind: "clase" | "tocata", entity: Clase | Tocata | null, onClose: () => void) {
  const render = () => {
    active = modal; active.cursor = 0;
    if (kind === "clase") {
      assert.ok(!entity || "alumnoId" in entity);
      return ClaseModal({ isOpen: true, claseToEdit: entity && "alumnoId" in entity ? entity : null, onClose });
    }
    assert.ok(!entity || "proyecto" in entity);
    return TocataModal({ isOpen: true, tocataToEdit: entity && "proyecto" in entity ? entity : null, onClose });
  };
  render(); const effects = modal.effects.splice(0); for (const effect of effects) effect();
  return render();
}
function findProps(tree: unknown, predicate: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> {
  const visit = (node: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(node)) { for (const item of node) { const found = visit(item); if (found) return found; } }
    if (object(node) && object(node.props)) {
      if (predicate(node.type, node.props)) return node.props;
      return visit(node.props.children);
    }
    return undefined;
  };
  const result = visit(tree); assert.ok(result, "element exists"); return result;
}
async function invoke(props: Record<string, unknown>, key: string, ...args: unknown[]) {
  const fn = props[key]; assert.equal(typeof fn, "function");
  if (typeof fn !== "function") assert.fail("handler missing");
  await fn(...args);
}
async function seed(kind: "clase" | "tocata", linked: boolean) {
  const source = kind === "clase" ? clase : tocata;
  if (!linked) { docs.set(`users/owner/${kind === "clase" ? "clases" : "tocatas"}/${source.id}`, { ...source }); return source; }
  const binding = { entityType: kind, entityId: source.id, googleAccountId: "google-1", calendarId: "primary" } satisfies Parameters<typeof createCalendarSyncIds>[1];
  const ids = await createCalendarSyncIds("owner", binding);
  const entity = { ...source, googleCalendar: { enabled: true, status: "pending", ...binding, googleCalendarEventId: ids.googleCalendarEventId,
    revision: 1, syncedRevision: 0, etag: '"kept"' } };
  // Domain typing is established by the existing decoder, not an assertion.
  const { decodeAgendaEntity } = await import("../services/firestoreCalendarSyncStorage.ts");
  const clean = decodeAgendaEntity(entity, binding);
  docs.set(`users/owner/${kind === "clase" ? "clases" : "tocatas"}/${source.id}`, { ...clean });
  docs.set(`users/owner/calendarSyncJobs/${ids.jobId}`, { id: ids.jobId, ...binding, googleCalendarEventId: ids.googleCalendarEventId,
    operation: "upsert", revision: 1, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null,
    leaseOwner: null, leaseUntil: null, createdAt: at, updatedAt: at });
  return clean;
}
for (const kind of ["clase", "tocata"] as const) {
  for (const linked of [false, true]) test(`${kind}: CRUD ${linked ? "vinculado" : "sin vínculo"} atómico y delete repetido`, async () => {
    const entity = await seed(kind, linked), api = renderProvider();
    const expected = api.captureEditPrecondition(kind, entity);
    if (kind === "clase") await api.updateClase(entity.id, { horaInicio: "11:00" }, expected);
    else await api.updateTocata(entity.id, { horaInicio: "21:00" }, expected);
    assert.equal(transactions, 1);
    const path = `users/owner/${kind === "clase" ? "clases" : "tocatas"}/${entity.id}`;
    const stored = docs.get(path); assert.ok(stored);
    const { decodeAgendaEntity } = await import("../services/firestoreCalendarSyncStorage.ts");
    const updated = decodeAgendaEntity(stored, { entityType: kind, entityId: entity.id });
    assert.equal(updated.googleCalendar?.revision, linked ? 2 : undefined);
    if (linked) assert.equal(updated.googleCalendar?.etag, '"kept"');
    const deletion = api.captureEditPrecondition(kind, updated);
    const remove = () => kind === "clase" ? api.deleteClase(entity.id, deletion) : api.deleteTocata(entity.id, deletion);
    await remove(); assert.equal(docs.has(path), false);
    assert.equal(docs.size, linked ? 1 : 0);
    if (linked) { const before = structuredClone([...docs]); await remove(); assert.deepEqual([...docs], before); }
  });
  test(`${kind}: fallo de commit no altera entidad/job ni estado React`, async () => {
    const entity = await seed(kind, true), api = renderProvider(), before = structuredClone([...docs]);
    const state = provider.slots.slice(); const expected = api.captureEditPrecondition(kind, entity);
    gate = deferred(); failCommit = true;
    const operation = kind === "clase" ? api.updateClase(entity.id, { horaInicio: "11:00" }, expected) : api.updateTocata(entity.id, { horaInicio: "21:00" }, expected);
    const rejection = assert.rejects(operation, { code: "storage_failure" });
    await started.promise; assert.deepEqual([...docs], before); assert.deepEqual(provider.slots, state);
    gate.resolve(); await rejection; assert.deepEqual([...docs], before); assert.deepEqual(provider.slots, state);
  });
  for (const operation of ["save", "delete"] as const) {
    test(`${kind}: ${operation} espera confirmación antes de cerrar`, async () => {
      const entity = await seed(kind, true); renderProvider(); let closed = 0;
      const tree = renderModal(kind, entity, () => { closed++; }); gate = deferred();
      const props = findProps(tree, (type) => type === (operation === "save" ? "form" : "confirm"));
      const task = invoke(props, operation === "save" ? "onSubmit" : "onConfirm", { preventDefault() {} });
      await started.promise; assert.equal(closed, 0);
      if (operation === "delete") await invoke(props, "onClose");
      gate.resolve(); await task; assert.equal(closed, 1);
    });
    test(`${kind}: ${operation} con snapshot viejo mantiene abierto y muestra conflicto`, async () => {
      const entity = await seed(kind, true); renderProvider(); let closed = 0;
      renderModal(kind, entity, () => { closed++; });
      const newer = { ...entity, updatedAt: "2026-09-10T12:01:00.000Z" };
      docs.set(`users/owner/${kind === "clase" ? "clases" : "tocatas"}/${entity.id}`, { ...newer });
      renderProvider(); const tree = renderModal(kind, newer, () => { closed++; });
      const before = structuredClone([...docs]);
      await invoke(findProps(tree, type => type === (operation === "save" ? "form" : "confirm")), operation === "save" ? "onSubmit" : "onConfirm", { preventDefault() {} });
      assert.equal(closed, 0); assert.deepEqual([...docs], before);
      const error = findProps(renderModal(kind, newer, () => { closed++; }), (_type, props) => props.role === "alert");
      assert.match(String(error.children), /cambió desde que abriste/);
    });
    test(`${kind}: ${operation} con error de persistencia no cierra ni expone detalles`, async () => {
      const entity = await seed(kind, true); renderProvider(); let closed = 0; failCommit = true;
      const tree = renderModal(kind, entity, () => { closed++; });
      await invoke(findProps(tree, type => type === (operation === "save" ? "form" : "confirm")), operation === "save" ? "onSubmit" : "onConfirm", { preventDefault() {} });
      assert.equal(closed, 0);
      const error = findProps(renderModal(kind, entity, () => { closed++; }), (_type, props) => props.role === "alert");
      assert.match(String(error.children), /No se pudo confirmar/); assert.doesNotMatch(String(error.children), /SDK|private/);
    });
  }
}
test("creación autenticada sin precondición y retry no crea jobs ni duplica IDs", async () => {
  const api = renderProvider(); retryOnce = true;
  const c = await api.addClase({ alumnoId: "student", tipo: "alma", tema: "Tema", estado: "programada", fecha: "2026-09-11", horaInicio: "12:00", horaFin: "13:00", notas: undefined });
  const t = await api.addTocata({ titulo: "Evento", proyecto: "Otro", estado: "confirmada", fecha: "2026-09-11", horaInicio: "22:00", horaFin: "02:00" });
  assert.ok(c.id); assert.ok(t.id); assert.equal(docs.size, 2);
  assert.equal([...docs.keys()].some(p => p.includes("calendarSyncJobs")), false);
});
test("modo local conserva CRUD sin Firestore", async () => {
  auth.currentUser = null; let api = renderProvider();
  const c = await api.addClase({ alumnoId: "student", tipo: "alma", tema: "Tema", estado: "programada", fecha: "2026-09-11", horaInicio: "12:00", horaFin: "13:00" });
  api = renderProvider(); await api.updateClase(c.id, { tema: "Nuevo" }, api.captureEditPrecondition("clase", c));
  api = renderProvider(); const updated = api.getClaseById(c.id); assert.ok(updated);
  await api.deleteClase(c.id, api.captureEditPrecondition("clase", updated));
  api = renderProvider(); assert.equal(api.getClaseById(c.id), undefined); assert.equal(transactions, 0);
});
test("no-op y metadata del llamador no alteran el vínculo", async () => {
  const entity = await seed("clase", true), api = renderProvider(), expected = api.captureEditPrecondition("clase", entity);
  const before = structuredClone([...docs]);
  await api.updateClase(entity.id, {}, expected); assert.deepEqual([...docs], before);
  await assert.rejects(api.updateClase(entity.id, { googleCalendar: entity.googleCalendar }, expected), { code: "invalid_argument" });
  assert.deepEqual([...docs], before);
});
test("una operación capturada con otro usuario se rechaza", async () => {
  const entity = await seed("clase", true), api = renderProvider(), expected = api.captureEditPrecondition("clase", entity);
  auth.currentUser = { uid: "other" };
  await assert.rejects(api.deleteClase(entity.id, expected), { code: "conflict" }); assert.equal(transactions, 0);
  assert.ok(new AgendaCrudError("conflict") instanceof Error);
});

for (const kind of ["clase", "tocata"] as const) {
  test(`${kind}: crear desde formulario espera guardado sin precondición`, async () => {
    renderProvider(); let closed = 0;
    const initial = renderModal(kind, null, () => { closed++; });
    await invoke(findProps(initial, (_type, props) => props.id === (kind === "clase" ? "clase-tema" : "tocata-titulo")),
      "onChange", { target: { value: "Evento nuevo" } });
    const ready = renderModal(kind, null, () => { closed++; });
    gate = deferred();
    const save = invoke(findProps(ready, type => type === "form"), "onSubmit", { preventDefault() {} });
    await started.promise; assert.equal(closed, 0); assert.equal(docs.size, 0);
    gate.resolve(); await save; assert.equal(closed, 1); assert.equal(docs.size, 1);
    assert.equal([...docs.keys()].some(p => p.includes("calendarSyncJobs")), false);
  });
  test(`${kind}: cambio exclusivo de ETag causa conflicto; ausencia produce not_found`, async () => {
    const entity = await seed(kind, true), api = renderProvider(), expected = api.captureEditPrecondition(kind, entity);
    assert.ok(entity.googleCalendar);
    const path = `users/owner/${kind === "clase" ? "clases" : "tocatas"}/${entity.id}`;
    docs.set(path, { ...entity, googleCalendar: { ...entity.googleCalendar, etag: '"remote"' } });
    const before = structuredClone([...docs]);
    const save = () => kind === "clase" ? api.updateClase(entity.id, {}, expected) : api.updateTocata(entity.id, {}, expected);
    await assert.rejects(save(), { code: "conflict" }); assert.deepEqual([...docs], before);
    docs.delete(path); await assert.rejects(save(), { code: "not_found" });
  });
}
test("modo local: Tocata conserva edición y borrado", async () => {
  auth.currentUser = null; let api = renderProvider();
  const t = await api.addTocata({ titulo: "Evento", proyecto: "Otro", estado: "confirmada", fecha: "2026-09-11", horaInicio: "22:00", horaFin: "02:00" });
  api = renderProvider(); await api.updateTocata(t.id, { titulo: "Nuevo" }, api.captureEditPrecondition("tocata", t));
  api = renderProvider(); const updated = api.getTocataById(t.id); assert.ok(updated);
  await api.deleteTocata(t.id, api.captureEditPrecondition("tocata", updated));
  api = renderProvider(); assert.equal(api.getTocataById(t.id), undefined); assert.equal(transactions, 0);
});
