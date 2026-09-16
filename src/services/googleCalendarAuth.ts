import {
  GoogleAuthProvider,
  getAdditionalUserInfo,
  reauthenticateWithPopup,
  type Auth,
  type User,
} from "firebase/auth";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

export type GoogleCalendarAuthStatus =
  | "not_authorized"
  | "authorized_temporarily"
  | "requires_reauthorization";

export interface GoogleCalendarIdentity {
  readonly googleAccountId: string;
}

export interface GoogleCalendarAuthState {
  readonly status: GoogleCalendarAuthStatus;
  readonly identity: GoogleCalendarIdentity | null;
}

export type GoogleCalendarAuthErrorCode =
  | "popup_cancelled"
  | "permission_denied"
  | "account_mismatch"
  | "missing_token"
  | "not_signed_in"
  | "request_superseded"
  | "unrecoverable";

export class GoogleCalendarAuthError extends Error {
  constructor(readonly code: GoogleCalendarAuthErrorCode) {
    super(`Google Calendar authorization: ${code}.`);
    this.name = "GoogleCalendarAuthError";
  }
}

// Firebase's public OAuthCredential API does not expose Google's expires_in.
// This is a conservative LOCAL lease, not proof of server validity or granted
// scopes. A future caller must invalidate on 401/insufficient-permission 403.
const TOKEN_LEASE_MS = 50 * 60 * 1000;

export const GCAL_AUTH_STORAGE_KEY = "profesor_agenda_gcal_auth_v1";

export interface StoredGoogleCalendarAuth {
  readonly uid: string;
  readonly googleAccountId: string;
  readonly calendarId: "primary";
  readonly validUntil: number;
  readonly token?: string;
}

let session: {
  token: string;
  uid: string;
  googleAccountId: string;
  validUntil: number;
} | null = null;
let state: GoogleCalendarAuthState = Object.freeze({
  status: "not_authorized",
  identity: null,
});
let generation = 0;
let ownerKey: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access might be restricted or throw in strict environments
  }
  return null;
}

export function loadPersistedAuth(user: User | null): StoredGoogleCalendarAuth | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(GCAL_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.uid !== "string" ||
      typeof parsed.googleAccountId !== "string" ||
      typeof parsed.validUntil !== "number"
    ) {
      storage.removeItem(GCAL_AUTH_STORAGE_KEY);
      return null;
    }
    if (user) {
      const gId = linkedGoogleId(user);
      if (parsed.uid !== user.uid || (gId && parsed.googleAccountId !== gId)) {
        return null;
      }
    }
    return parsed as StoredGoogleCalendarAuth;
  } catch {
    return null;
  }
}

export function savePersistedAuth(data: StoredGoogleCalendarAuth | null): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (!data) {
      storage.removeItem(GCAL_AUTH_STORAGE_KEY);
    } else {
      storage.setItem(GCAL_AUTH_STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // Storage quota or sandboxing error ignored
  }
}

function publish(status: GoogleCalendarAuthStatus, googleAccountId?: string): void {
  state = Object.freeze({
    status,
    identity: googleAccountId ? Object.freeze({ googleAccountId }) : null,
  });
  for (const listener of listeners) listener();
}

/** Clears the token AND invalidates any popup still in flight. Never revokes remotely. */
export function clearGoogleCalendarAuth(requiresReauthorization = false): void {
  generation += 1;
  session = null;
  clearTimeout(expiryTimer);
  expiryTimer = undefined;

  if (requiresReauthorization) {
    const existing = loadPersistedAuth(null);
    if (existing) {
      savePersistedAuth({
        uid: existing.uid,
        googleAccountId: existing.googleAccountId,
        calendarId: "primary",
        validUntil: Math.min(existing.validUntil, Date.now()),
      });
      publish("requires_reauthorization", existing.googleAccountId);
      return;
    }
    publish("requires_reauthorization");
  } else {
    ownerKey = null;
    savePersistedAuth(null);
    publish("not_authorized");
  }
}

export function subscribeGoogleCalendarAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function linkedGoogleId(user: User | null): string | undefined {
  return user?.providerData.find((provider) => provider.providerId === "google.com")?.uid;
}

/** Call from the Auth observer even for logout or a user with no Calendar session. */
export function syncGoogleCalendarUser(user: User | null): void {
  const nextKey = user ? JSON.stringify([user.uid, linkedGoogleId(user)]) : null;

  if (!user) {
    generation += 1;
    session = null;
    ownerKey = null;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    publish("not_authorized");
    return;
  }

  if (ownerKey === nextKey) {
    if (session !== null && Date.now() < session.validUntil) {
      return;
    }
    if (state.status === "requires_reauthorization") {
      return;
    }
  }

  ownerKey = nextKey;
  const stored = loadPersistedAuth(user);
  if (!stored) {
    generation += 1;
    session = null;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    publish("not_authorized");
    return;
  }

  const now = Date.now();
  if (stored.token && now < stored.validUntil) {
    session = {
      token: stored.token,
      uid: stored.uid,
      googleAccountId: stored.googleAccountId,
      validUntil: stored.validUntil,
    };
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => clearGoogleCalendarAuth(true), stored.validUntil - now);
    publish("authorized_temporarily", stored.googleAccountId);
  } else {
    session = null;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (stored.token) {
      savePersistedAuth({
        uid: stored.uid,
        googleAccountId: stored.googleAccountId,
        calendarId: "primary",
        validUntil: stored.validUntil,
      });
    }
    publish("requires_reauthorization", stored.googleAccountId);
  }
}

export function markGoogleCalendarRequiresReauthorization(): void {
  clearGoogleCalendarAuth(true);
}

export function getGoogleCalendarAuthState(): GoogleCalendarAuthState {
  if (session && Date.now() >= session.validUntil) clearGoogleCalendarAuth(true);
  return state;
}

/** Local validity only; the token must never be put in React state or persisted. */
export function getGoogleCalendarAccessToken(user: User | null): string | null {
  syncGoogleCalendarUser(user);
  getGoogleCalendarAuthState();
  return session?.token ?? null;
}

export function hasGoogleCalendarAccessToken(user: User | null): boolean {
  return getGoogleCalendarAccessToken(user) !== null;
}

function sanitizedError(error: unknown): GoogleCalendarAuthError {
  if (error instanceof GoogleCalendarAuthError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? error.code : undefined;
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return new GoogleCalendarAuthError("popup_cancelled");
    // Firebase uses user-cancelled when the requested permissions were denied.
    case "auth/user-cancelled":
    case "auth/permission-denied":
    case "auth/access-denied":
    case "auth/admin-restricted-operation":
      return new GoogleCalendarAuthError("permission_denied");
    case "auth/user-mismatch":
    case "auth/account-exists-with-different-credential":
      return new GoogleCalendarAuthError("account_mismatch");
    default:
      return new GoogleCalendarAuthError("unrecoverable");
  }
}

/** Only invoke directly from an explicit user gesture; never during login/mount. */
export async function requestGoogleCalendarAuthorization(auth: Auth): Promise<GoogleCalendarAuthState> {
  clearGoogleCalendarAuth();
  const requestGeneration = generation;
  const currentUser = auth.currentUser;
  if (!currentUser) throw new GoogleCalendarAuthError("not_signed_in");
  const uid = currentUser.uid;
  // Capture before reauthentication: Firebase may mutate the User object in place.
  const googleAccountId = linkedGoogleId(currentUser);
  ownerKey = JSON.stringify([uid, googleAccountId]);
  try {
    if (!googleAccountId) throw new GoogleCalendarAuthError("account_mismatch");
    const provider = new GoogleAuthProvider();
    provider.addScope(GOOGLE_CALENDAR_SCOPE);
    provider.setCustomParameters({
      include_granted_scopes: "true",
      prompt: "consent",
      login_hint: googleAccountId,
    });
    const startedAt = Date.now();
    const result = await reauthenticateWithPopup(currentUser, provider);
    if (requestGeneration !== generation) {
      throw new GoogleCalendarAuthError("request_superseded");
    }
    const info = getAdditionalUserInfo(result);
    const profileId = info?.profile?.sub ?? info?.profile?.id;
    if (
      auth.currentUser !== currentUser || auth.currentUser.uid !== uid ||
      linkedGoogleId(auth.currentUser) !== googleAccountId ||
      result.user.uid !== uid || linkedGoogleId(result.user) !== googleAccountId ||
      info?.providerId !== "google.com" || profileId !== googleAccountId
    ) {
      throw new GoogleCalendarAuthError("account_mismatch");
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;
    if (!token || /\s/.test(token)) throw new GoogleCalendarAuthError("missing_token");
    const validUntil = startedAt + TOKEN_LEASE_MS;
    if (Date.now() >= validUntil) throw new GoogleCalendarAuthError("missing_token");
    session = { token, uid, googleAccountId, validUntil };
    savePersistedAuth({
      uid,
      googleAccountId,
      calendarId: "primary",
      validUntil,
      token,
    });
    expiryTimer = setTimeout(() => clearGoogleCalendarAuth(true), validUntil - Date.now());
    publish("authorized_temporarily", googleAccountId);
    return state;
  } catch (error: unknown) {
    if (requestGeneration === generation) clearGoogleCalendarAuth(true);
    throw sanitizedError(error);
  }
}
