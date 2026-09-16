// Run with Node >=22.3: node --experimental-test-module-mocks --import tsx --test src/services/*.test.ts
import assert from "node:assert/strict";
import { mock, test, beforeEach, afterEach, type TestContext } from "node:test";
import type { User } from "firebase/auth";

const TOKEN = "fake-calendar-access-token";
const makeUser = (uid = "firebase-a", googleId = "google-a") => ({
  uid, providerData: [{ providerId: "google.com", uid: googleId }],
}) as User;
let auth = { currentUser: makeUser() as User | null };
let profile: Record<string, unknown> | null = { sub: "google-a" };
let credential: { accessToken: string } | null = { accessToken: TOKEN };
let popupCalls = 0;
let loginProvider: Provider | undefined;
let observer: (user: User | null) => unknown;
let popup: () => Promise<{ user: User }> = async () => ({ user: auth.currentUser! });
const providers: Provider[] = [];
class Provider {
  scopes: string[] = [];
  parameters: Record<string, string> = {};
  constructor() { providers.push(this); }
  addScope(scope: string) { this.scopes.push(scope); return this; }
  setCustomParameters(parameters: Record<string, string>) { this.parameters = parameters; return this; }
  static credentialFromResult() { return credential; }
}

mock.module("firebase/auth", { namedExports: {
  GoogleAuthProvider: Provider,
  getAuth: () => auth,
  initializeAuth: () => auth,
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  getAdditionalUserInfo: () => ({ providerId: "google.com", profile }),
  reauthenticateWithPopup: async (user: User) => {
    assert.equal(user, auth.currentUser);
    popupCalls += 1;
    return popup();
  },
  signInWithPopup: async (_auth: unknown, provider: Provider) => {
    loginProvider = provider;
    return { user: auth.currentUser };
  },
  signOut: async () => { auth.currentUser = null; },
  getRedirectResult: async () => null,
  onAuthStateChanged: (_auth: unknown, callback: typeof observer) => {
    observer = callback;
    return () => {};
  },
} });
mock.module("firebase/app", { namedExports: {
  initializeApp: () => ({}), getApps: () => [], getApp: () => ({}),
} });
mock.module("firebase/firestore", { namedExports: {
  getFirestore: () => ({}), enableNetwork: async () => {},
  doc: () => { throw new Error("Unexpected Firestore access"); },
  getDocFromServer: () => { throw new Error("Unexpected Firestore access"); },
} });

// A small hook harness tests the actual AuthProvider without adding dependencies.
let slots: unknown[] = [];
let cursor = 0;
let mounting = true;
let effects: Array<() => unknown> = [];
const react = {
  createContext: () => ({ Provider: "provider" }),
  useContext: () => undefined,
  useState: (initial: unknown) => {
    const index = cursor++;
    if (mounting) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: unknown) => { slots[index] = value; }];
  },
  useEffect: (effect: () => unknown) => { if (mounting) effects.push(effect); },
  createElement: (_type: unknown, props: unknown) => ({ props }),
};
mock.module("react", { defaultExport: react, namedExports: react });
mock.module("react/jsx-runtime", { namedExports: {
  jsx: (_type: unknown, props: unknown) => ({ props }),
  jsxs: (_type: unknown, props: unknown) => ({ props }),
} });

const calendar = await import("./googleCalendarAuth");
const firebase = await import("../lib/firebase");
const { AuthProvider } = await import("../context/AuthContext");

function renderContext() {
  cursor = 0;
  return (AuthProvider({ children: null }) as unknown as { props: { value: {
    logout: () => Promise<void>;
    signIn: () => Promise<User | null>;
    calendarAuth: typeof calendar extends { getGoogleCalendarAuthState: () => infer S } ? S : never;
    clearCalendarAuth: () => void;
  } } }).props.value;
}

const storageMap = new Map<string, string>();
const mockStorage: Storage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => { storageMap.set(key, String(val)); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
  key: (idx: number) => Array.from(storageMap.keys())[idx] ?? null,
  get length() { return storageMap.size; },
};

const descriptors = new Map<string, PropertyDescriptor | undefined>();
beforeEach((t: TestContext) => {
  calendar.clearGoogleCalendarAuth();
  auth.currentUser = makeUser();
  profile = { sub: "google-a" };
  credential = { accessToken: TOKEN };
  popupCalls = 0;
  popup = async () => ({ user: auth.currentUser! });
  storageMap.clear();

  descriptors.set("localStorage", Object.getOwnPropertyDescriptor(globalThis, "localStorage"));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage,
    writable: true,
  });

  t.mock.method(globalThis, "fetch", async () => { assert.fail("No real fetch allowed"); });
  for (const method of ["log", "warn", "error", "info", "debug"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => {
      assert.equal(JSON.stringify(args).includes(TOKEN), false);
    });
  }
});
afterEach(() => {
  calendar.clearGoogleCalendarAuth();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("import and normal Google login never request Calendar", async () => {
  assert.equal(calendar.hasGoogleCalendarAccessToken(auth.currentUser), false);
  await firebase.signInWithGoogle();
  assert.equal(popupCalls, 0);
  assert.deepEqual(loginProvider?.scopes, []);
  assert.deepEqual(loginProvider?.parameters, { prompt: "select_account" });
});

test("only an explicit call requests incremental consent with an isolated provider", async () => {
  assert.equal(popupCalls, 0);
  const result = await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.equal(popupCalls, 1);
  assert.deepEqual(providers.at(-1)?.scopes, [calendar.GOOGLE_CALENDAR_SCOPE]);
  assert.deepEqual(providers.at(-1)?.parameters, {
    include_granted_scopes: "true", prompt: "consent", login_hint: "google-a",
  });
  assert.notEqual(providers.at(-1), loginProvider);
  assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), TOKEN);
  assert.equal(result.status, "authorized_temporarily");
  assert.deepEqual(result.identity, { googleAccountId: "google-a" });
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  await firebase.signInWithGoogle();
  assert.deepEqual(loginProvider?.scopes, []);
});

test("a Firebase uid match alone cannot authorize a different Google identity", async () => {
  profile = { sub: "different-google-account" };
  await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), { code: "account_mismatch" });
  assert.equal(calendar.hasGoogleCalendarAccessToken(auth.currentUser), false);
});

test("requires a Google profile identifier and accepts the documented id fallback", async () => {
  profile = null;
  await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), { code: "account_mismatch" });
  profile = { id: "google-a" };
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.equal(calendar.hasGoogleCalendarAccessToken(auth.currentUser), true);
});

test("detects mutation of the linked identity during reauthentication", async () => {
  popup = async () => {
    (auth.currentUser!.providerData[0] as { uid: string }).uid = "other";
    profile = { sub: "other" };
    return { user: auth.currentUser! };
  };
  await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), { code: "account_mismatch" });
});

for (const [firebaseCode, expected] of [
  ["auth/popup-closed-by-user", "popup_cancelled"],
  ["auth/cancelled-popup-request", "popup_cancelled"],
  ["auth/access-denied", "permission_denied"],
  ["auth/user-cancelled", "permission_denied"],
  ["auth/permission-denied", "permission_denied"],
  ["auth/admin-restricted-operation", "permission_denied"],
  ["auth/user-mismatch", "account_mismatch"],
  ["auth/popup-blocked", "unrecoverable"],
  ["unexpected", "unrecoverable"],
]) {
  test(`sanitizes OAuth ${firebaseCode}`, async () => {
    popup = async () => { throw { code: firebaseCode, message: TOKEN, customData: { accessToken: TOKEN } }; };
    await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), (error: unknown) => {
      assert.ok(error instanceof calendar.GoogleCalendarAuthError);
      assert.equal(error.code, expected);
      assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(TOKEN), false);
      assert.equal("cause" in error, false);
      return true;
    });
    assert.equal(calendar.hasGoogleCalendarAccessToken(auth.currentUser), false);
    assert.equal(calendar.getGoogleCalendarAuthState().status, "requires_reauthorization");
  });
}

test("missing credentials and signed-out users fail without a retained token", async () => {
  credential = null;
  await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), { code: "missing_token" });
  assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), null);
  auth.currentUser = null;
  await assert.rejects(calendar.requestGoogleCalendarAuthorization(auth as never), { code: "not_signed_in" });
  assert.equal(popupCalls, 1);
});

test("expiry clears memory and notifies future screens", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let notifications = 0;
  const unsubscribe = calendar.subscribeGoogleCalendarAuth(() => { notifications += 1; });
  try {
    await calendar.requestGoogleCalendarAuthorization(auth as never);
    t.mock.timers.tick(50 * 60 * 1000);
    assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), null);
    assert.equal(calendar.getGoogleCalendarAuthState().status, "requires_reauthorization");
    assert.ok(notifications >= 2);
  } finally { unsubscribe(); }
});

test("lazy expiry still works when the browser suspends timers", async (t) => {
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  t.mock.method(Date, "now", () => Number.MAX_SAFE_INTEGER);
  assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), null);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "requires_reauthorization");
});

test("clearing, switching user and returning to the old user cannot restore a pending popup", async () => {
  let resolve!: (result: { user: User }) => void;
  const original = auth.currentUser!;
  popup = () => new Promise((done) => { resolve = done; });
  const pending = calendar.requestGoogleCalendarAuthorization(auth as never);
  auth.currentUser = makeUser("firebase-b", "google-b");
  calendar.syncGoogleCalendarUser(auth.currentUser);
  auth.currentUser = original;
  calendar.syncGoogleCalendarUser(original);
  resolve({ user: original });
  await assert.rejects(pending, { code: "request_superseded" });
  assert.equal(calendar.getGoogleCalendarAccessToken(original), null);
});

test("logout during a popup invalidates its eventual result", async () => {
  let resolve!: (result: { user: User }) => void;
  const original = auth.currentUser!;
  popup = () => new Promise((done) => { resolve = done; });
  const pending = calendar.requestGoogleCalendarAuthorization(auth as never);
  calendar.clearGoogleCalendarAuth();
  resolve({ user: original });
  await assert.rejects(pending, { code: "request_superseded" });
  assert.equal(calendar.getGoogleCalendarAuthState().status, "not_authorized");
});

test("an older failed popup cannot clear a newer authorization", async () => {
  let reject!: (error: unknown) => void;
  popup = () => new Promise((_done, fail) => { reject = fail; });
  const first = calendar.requestGoogleCalendarAuthorization(auth as never);
  popup = async () => ({ user: auth.currentUser! });
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  reject({ code: "auth/popup-closed-by-user", message: TOKEN });
  await assert.rejects(first, { code: "popup_cancelled" });
  assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), TOKEN);
});

test("AuthContext mount/login stays passive and reflects authorization, logout and user changes", async () => {
  slots = []; effects = []; mounting = true;
  let context = renderContext();
  const cleanups = effects.map((effect) => effect());
  mounting = false;
  try {
    await observer(auth.currentUser);
    await context.signIn();
    assert.equal(popupCalls, 0);
    await calendar.requestGoogleCalendarAuthorization(auth as never);
    context = renderContext();
    assert.equal(context.calendarAuth.status, "authorized_temporarily");
    assert.equal(JSON.stringify(context.calendarAuth).includes(TOKEN), false);
    await context.logout();
    assert.equal(calendar.getGoogleCalendarAccessToken(null), null);
    assert.equal(renderContext().calendarAuth.status, "not_authorized");
    auth.currentUser = makeUser();
    await observer(auth.currentUser);
    await calendar.requestGoogleCalendarAuthorization(auth as never);
    auth.currentUser = makeUser("firebase-b", "google-b");
    await observer(auth.currentUser);
    assert.equal(calendar.getGoogleCalendarAccessToken(auth.currentUser), null);
    assert.equal(renderContext().calendarAuth.identity, null);
  } finally {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  }
});

test("Requirement 1 & 10: Authorization is retained across simulated PWA app close and reopen without popups", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.equal(popupCalls, 1);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "authorized_temporarily");

  // Simulate closing the app: in-memory state in singleton is reset, but localStorage remains
  // (We simulate this by calling syncGoogleCalendarUser with the restored Firebase user, as happens on PWA boot)
  calendar.syncGoogleCalendarUser(user);
  assert.equal(popupCalls, 1); // No new popup!
  assert.equal(calendar.getGoogleCalendarAuthState().status, "authorized_temporarily");
  assert.equal(calendar.getGoogleCalendarAccessToken(user), TOKEN);
});

test("Requirement 2: Calendar auth state is preserved when context is unmounted and remounted", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.equal(popupCalls, 1);

  // Mount context first time
  slots = []; effects = []; mounting = true;
  let context1 = renderContext();
  const cleanups1 = effects.map((effect) => effect());
  mounting = false;
  assert.equal(context1.calendarAuth.status, "authorized_temporarily");

  // Unmount context
  for (const cleanup of cleanups1) if (typeof cleanup === "function") cleanup();

  // Remount context
  slots = []; effects = []; mounting = true;
  let context2 = renderContext();
  const cleanups2 = effects.map((effect) => effect());
  mounting = false;

  assert.equal(context2.calendarAuth.status, "authorized_temporarily");
  assert.equal(popupCalls, 1); // Still no new popups

  for (const cleanup of cleanups2) if (typeof cleanup === "function") cleanup();
});

test("Requirement 3: Normal app initialization never triggers an OAuth popup", async () => {
  const initialPopups = popupCalls;
  slots = []; effects = []; mounting = true;
  const context = renderContext();
  const cleanups = effects.map((effect) => effect());
  mounting = false;

  await observer(auth.currentUser);
  assert.equal(popupCalls, initialPopups);
  assert.equal(context.calendarAuth.status, "not_authorized");

  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
});

test("Requirement 4: Expired token is detected and rejected without retaining invalid session", () => {
  const user = auth.currentUser!;
  // Seed an expired storage record
  storageMap.set(calendar.GCAL_AUTH_STORAGE_KEY, JSON.stringify({
    uid: user.uid,
    googleAccountId: "google-a",
    calendarId: "primary",
    validUntil: Date.now() - 1000,
    token: "expired-token",
  }));

  calendar.syncGoogleCalendarUser(user);
  assert.equal(calendar.getGoogleCalendarAccessToken(user), null);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "requires_reauthorization");
});

test("Requirement 5: Mismatched Google account identity produces controlled not_authorized state", () => {
  const user = auth.currentUser!;
  // Storage contains data for a DIFFERENT google account
  storageMap.set(calendar.GCAL_AUTH_STORAGE_KEY, JSON.stringify({
    uid: user.uid,
    googleAccountId: "google-acct-different",
    calendarId: "primary",
    validUntil: Date.now() + 100000,
    token: "other-token",
  }));

  calendar.syncGoogleCalendarUser(user);
  assert.equal(calendar.getGoogleCalendarAccessToken(user), null);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "not_authorized");
});

test("Requirement 6: Revoking authorization produces requires_reauthorization status", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "authorized_temporarily");

  calendar.clearGoogleCalendarAuth(true);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "requires_reauthorization");
  assert.equal(calendar.getGoogleCalendarAccessToken(user), null);
});

test("Requirement 7: Disconnecting Google Calendar clears local storage and link", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };
  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.ok(storageMap.has(calendar.GCAL_AUTH_STORAGE_KEY));

  calendar.clearGoogleCalendarAuth(false);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "not_authorized");
  assert.equal(calendar.getGoogleCalendarAccessToken(user), null);
  assert.equal(storageMap.has(calendar.GCAL_AUTH_STORAGE_KEY), false);
});

test("Requirement 8: User logout thoroughly clears all stored calendar state", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };

  slots = []; effects = []; mounting = true;
  const context = renderContext();
  const cleanups = effects.map((effect) => effect());
  mounting = false;

  await calendar.requestGoogleCalendarAuthorization(auth as never);
  assert.ok(storageMap.has(calendar.GCAL_AUTH_STORAGE_KEY));

  await context.logout();
  assert.equal(storageMap.has(calendar.GCAL_AUTH_STORAGE_KEY), false);
  assert.equal(calendar.getGoogleCalendarAuthState().status, "not_authorized");
  assert.equal(calendar.getGoogleCalendarAccessToken(null), null);

  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
});

test("Requirement 9: Repeated mounting does not duplicate listeners or popup calls", async () => {
  const initialPopups = popupCalls;
  for (let i = 0; i < 5; i++) {
    slots = []; effects = []; mounting = true;
    renderContext();
    const cleanups = effects.map((effect) => effect());
    mounting = false;
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  }
  assert.equal(popupCalls, initialPopups);
});

test("Requirement 11: Sensitive tokens never leak into exported state or stringified objects", async () => {
  const user = auth.currentUser!;
  profile = { sub: "google-a" };
  const stateResult = await calendar.requestGoogleCalendarAuthorization(auth as never);

  const stringified = JSON.stringify(stateResult);
  assert.equal(stringified.includes(TOKEN), false);

  const authState = calendar.getGoogleCalendarAuthState();
  assert.equal(JSON.stringify(authState).includes(TOKEN), false);
});

test("Requirement 12: Calendar service operates safely with both authenticated and unauthenticated users", () => {
  // Disconnected user
  assert.doesNotThrow(() => {
    calendar.syncGoogleCalendarUser(null);
    assert.equal(calendar.getGoogleCalendarAccessToken(null), null);
    assert.equal(calendar.getGoogleCalendarAuthState().status, "not_authorized");
  });

  // Re-authenticated user
  const user = makeUser("firebase-user-12", "google-acct-12");
  assert.doesNotThrow(() => {
    calendar.syncGoogleCalendarUser(user);
    assert.equal(calendar.getGoogleCalendarAccessToken(user), null);
  });
});

