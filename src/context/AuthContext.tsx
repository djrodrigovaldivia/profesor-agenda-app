import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import {
  clearGoogleCalendarAuth,
  getGoogleCalendarAuthState,
  requestGoogleCalendarAuthorization,
  subscribeGoogleCalendarAuth,
  syncGoogleCalendarUser,
  type GoogleCalendarAuthState,
} from "../services/googleCalendarAuth";
import {
  auth,
  signInWithGoogle,
  signOutUser,
  checkRedirectResult,
  enableFirestoreNetwork,
  isInIframe,
} from "../lib/firebase";

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signIn: () => Promise<User | null>;
  logout: () => Promise<void>;
  authError: string | null;
  clearAuthError: () => void;
  isInsideIframe: boolean;
  calendarAuth: GoogleCalendarAuthState;
  clearCalendarAuth: () => void;
  authorizeCalendar: () => Promise<GoogleCalendarAuthState>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isInsideIframe, setIsInsideIframe] = useState<boolean>(false);
  const [calendarAuth, setCalendarAuth] = useState(getGoogleCalendarAuthState);

  useEffect(() => {
    const unsubscribe = subscribeGoogleCalendarAuth(() => {
      setCalendarAuth(getGoogleCalendarAuthState());
    });
    setCalendarAuth(getGoogleCalendarAuthState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    setIsInsideIframe(isInIframe());

    // Check for redirect result on initialization
    checkRedirectResult()
      .then((user) => {
        if (user) {
          setCurrentUser(user);
        }
      })
      .catch((err) => {
        console.warn("Error checking redirect result:", err);
      });

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        syncGoogleCalendarUser(user);
        setCurrentUser(user);
        if (user) {
          await enableFirestoreNetwork();
        }
        setLoading(false);
      },
      (error) => {
        clearGoogleCalendarAuth();
        console.error("Auth state error:", error);
        setAuthError(error.message);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = async (): Promise<User | null> => {
    setAuthError(null);
    try {
      const user = await signInWithGoogle();
      if (user) {
        setCurrentUser(user);
        await enableFirestoreNetwork();
      }
      return user;
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : "Error al iniciar sesión con Google";
      setAuthError(msg);
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    clearGoogleCalendarAuth();
    try {
      await signOutUser();
      setCurrentUser(null);
    } catch (error: unknown) {
      console.error("Error signing out:", error);
      throw error;
    }
  };

  const clearAuthError = () => setAuthError(null);

  const authorizeCalendar = async (): Promise<GoogleCalendarAuthState> => {
    return requestGoogleCalendarAuthorization(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        signIn,
        logout,
        authError,
        clearAuthError,
        isInsideIframe,
        calendarAuth,
        clearCalendarAuth: () => clearGoogleCalendarAuth(),
        authorizeCalendar,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
