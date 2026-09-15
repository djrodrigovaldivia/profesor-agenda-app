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
let session: {
  token: string;
  uid: string;
  googleAccountId: string;
  validUntil: number;
} | null = null;
let state: GoogleCalendarAuthState = Object.freeze({
  status: "not_authorized", identity: null,
});
let generation = 0;
let ownerKey: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

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
  if (!requiresReauthorization) ownerKey = null;
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  publish(requiresReauthorization ? "requires_reauthorization" : "not_authorized");
}

export function subscribeGoogleCalendarAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function linkedGoogleId(user: User | null): string | undefined {
  return user?.providerData.find((provider) => provider.providerId === "google.com")?.uid;
}

/** Call from the Auth observer even for logout or a user with no Calendar session. */
export function syncGoogleCalendarUser(user: User | null): void {
  const nextKey = user ? JSON.stringify([user.uid, linkedGoogleId(user)]) : null;
  if (!user || ownerKey !== nextKey) {
    clearGoogleCalendarAuth();
    ownerKey = nextKey;
  }
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
    expiryTimer = setTimeout(() => clearGoogleCalendarAuth(true), validUntil - Date.now());
    publish("authorized_temporarily", googleAccountId);
    return state;
  } catch (error: unknown) {
    if (requestGeneration === generation) clearGoogleCalendarAuth(true);
    throw sanitizedError(error);
  }
}
