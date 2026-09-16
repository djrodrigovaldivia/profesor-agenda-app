import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  getRedirectResult,
  signOut,
  User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDocFromServer,
  enableNetwork,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Auth & Firestore with dedicated or default Database ID
export const auth = getAuth(app);
const customDbId = (firebaseConfig as unknown as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = customDbId ? getFirestore(app, customDbId) : getFirestore(app);

// In browser environments, enable multi-tab indexedDB persistence asynchronously
if (typeof window !== "undefined") {
  import("firebase/firestore").then((firestoreModule) => {
    try {
      if (typeof firestoreModule.enableMultiTabIndexedDbPersistence === "function") {
        firestoreModule.enableMultiTabIndexedDbPersistence(db).catch((err: unknown) => {
          console.warn("Firestore multi-tab persistence warning:", err);
        });
      } else if (typeof firestoreModule.enableIndexedDbPersistence === "function") {
        firestoreModule.enableIndexedDbPersistence(db).catch((err: unknown) => {
          console.warn("Firestore indexedDb persistence warning:", err);
        });
      }
    } catch (err: unknown) {
      console.warn("Could not enable Firestore local persistence:", err);
    }
  }).catch(() => {
    // Ignore dynamic import failure in non-standard runtimes
  });
}

// Utility to detect if the app is currently running inside an iframe (e.g. AI Studio preview)
export const isInIframe = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

// Force Firestore to exit offline mode and enable network with retry mechanism
export const enableFirestoreNetworkWithRetry = async (
  retries: number = 3,
  delayMs: number = 400
): Promise<boolean> => {
  for (let i = 0; i < retries; i++) {
    try {
      await enableNetwork(db);
      return true;
    } catch (error: unknown) {
      console.warn(`Attempt ${i + 1} to enable Firestore network failed:`, error);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
};

export const enableFirestoreNetwork = enableFirestoreNetworkWithRetry;

// Google Auth Provider setup
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

// Primary strategy: signInWithPopup to prevent redirect loops in modern browsers/Netlify
export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    if (result?.user) {
      await enableFirestoreNetworkWithRetry();
    }
    return result.user;
  } catch (error: unknown) {
    console.error("Error al iniciar sesión con ventana emergente:", error);
    throw error;
  }
};

export const checkRedirectResult = async (): Promise<User | null> => {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      await enableFirestoreNetworkWithRetry();
      return result.user;
    }
    return null;
  } catch (error: unknown) {
    console.warn("getRedirectResult error:", error);
    return null;
  }
};

export const signOutUser = async (): Promise<void> => {
  await signOut(auth);
};

// Error handling standard required by Firebase integration
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type FirestoreSanitized<T> = T extends undefined
  ? null
  : T extends Date
  ? Date
  : T extends (infer U)[]
  ? FirestoreSanitized<U>[]
  : T extends object
  ? { [K in keyof T]: FirestoreSanitized<T[K]> }
  : T;

// Data Sanitization: Converts 'undefined' values into 'null' for Firestore compatibility
export function sanitizeForFirestore<T>(data: T): FirestoreSanitized<T> {
  if (data === undefined) {
    return null as FirestoreSanitized<T>;
  }
  if (data === null) {
    return null as FirestoreSanitized<T>;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown) =>
      sanitizeForFirestore(item)
    ) as FirestoreSanitized<T>;
  }
  if (typeof data === "object" && !(data instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value === undefined) {
        cleaned[key] = null;
      } else {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as FirestoreSanitized<T>;
  }
  return data as FirestoreSanitized<T>;
}

// Alias for backwards compatibility
export const cleanForFirestore = sanitizeForFirestore;

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    if (auth.currentUser) {
      await getDocFromServer(
        doc(db, "users", auth.currentUser.uid, "configuracion", "test")
      );
    }
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("the client is offline")
    ) {
      console.warn("Firestore client is offline");
    }
    return false;
  }
}