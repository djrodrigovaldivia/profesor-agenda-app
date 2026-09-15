import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  Calendar,
  Music2,
  ShieldCheck,
  Sparkles,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

export const LoginScreen: React.FC = () => {
  const { signIn, authError, clearAuthError, isInsideIframe } = useAuth();
  const [signingIn, setSigningIn] = useState<boolean>(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    clearAuthError();
    try {
      await signIn();
    } catch (err: unknown) {
      console.warn("Sign in cancelled or failed:", err);
    } finally {
      setSigningIn(false);
    }
  };

  const handleOpenInNewTab = () => {
    window.open(window.location.href, "_blank");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-4 sm:p-6 antialiased">
      <div className="w-full max-w-md mx-auto space-y-6">
        {/* Brand & App Title Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-sky-500/20 to-emerald-500/20 border border-slate-800 shadow-lg mb-1">
            <div className="relative">
              <Calendar className="w-8 h-8 text-sky-400" />
              <Music2 className="w-4 h-4 text-emerald-400 absolute -bottom-1 -right-1" />
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Profesor Agenda
          </h1>
          <p className="text-sm text-slate-400 max-w-xs mx-auto">
            Gestión integral de Clases ALMA, Mentorías La Escalera y Fechas DJ
          </p>
        </div>

        {/* Main Authentication Card */}
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-6 sm:p-7 shadow-2xl backdrop-blur-sm space-y-6">
          <div className="space-y-1.5 text-center">
            <h2 className="text-base font-semibold text-slate-200">
              Iniciar Sesión
            </h2>
            <p className="text-xs text-slate-400">
              Accede con tu cuenta de Google para sincronizar tus actividades en Cloud Firestore.
            </p>
          </div>

          {/* Iframe Warning Alert */}
          {isInsideIframe && (
            <div className="p-3.5 bg-amber-950/50 border border-amber-800/80 rounded-xl text-amber-200 text-xs space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed">
                  Debes abrir la app en una nueva pestaña para iniciar sesión
                </span>
              </div>
              <button
                type="button"
                id="btn-open-new-tab-auth"
                onClick={handleOpenInNewTab}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 bg-amber-600/90 hover:bg-amber-600 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir en nueva pestaña</span>
              </button>
            </div>
          )}

          {/* Error Message */}
          {authError && (
            <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-xl text-rose-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <span>{authError}</span>
              </div>
            </div>
          )}

          {/* Google Sign-in Button */}
          <button
            type="button"
            id="btn-login-google"
            onClick={handleSignIn}
            disabled={signingIn || isInsideIframe}
            title={
              isInsideIframe
                ? "Abre la app en una nueva pestaña para iniciar sesión"
                : "Iniciar sesión con Google"
            }
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 px-5 py-3 bg-white hover:bg-slate-100 active:scale-[0.99] text-slate-900 font-semibold text-sm rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signingIn ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-slate-700" />
                <span>Iniciando sesión...</span>
              </>
            ) : isInsideIframe ? (
              <>
                <AlertCircle className="w-5 h-5 text-slate-700" />
                <span>Usa 'Abrir en nueva pestaña' arriba</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Continuar con Google</span>
              </>
            )}
          </button>

          {/* Benefits / Information */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
            <div className="flex items-center gap-2.5 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Tus datos se almacenan de forma 100% privada</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-400">
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Sincronización en tiempo real entre tus dispositivos</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-600">
          Profesor Agenda • Conectado a Cloud Firestore
        </p>
      </div>
    </div>
  );
};
