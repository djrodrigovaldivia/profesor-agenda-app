import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { DetailedErrorBanner } from "../common/DetailedErrorBanner";
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  LogOut,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";

export const GoogleCalendarSyncCard: React.FC = () => {
  const {
    currentUser,
    calendarAuth,
    authorizeCalendar,
    clearCalendarAuth,
    signIn,
  } = useAuth();

  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isConnected = calendarAuth.status === "authorized_temporarily";
  const requiresReauth = calendarAuth.status === "requires_reauthorization";

  const handleSignInAndConnect = async () => {
    setIsAuthorizing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      let user = currentUser;
      if (!user) {
        user = await signIn();
      }
      if (user) {
        await authorizeCalendar();
        setSuccessMessage("Conectado con éxito a Google Calendar.");
      }
    } catch (error: any) {
      console.warn("Sign-in/Calendar connection failed:", error);
      if (!error?.message?.includes("popup-closed-by-user")) {
        setErrorMessage("No se pudo iniciar sesión con Google.");
      }
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleConnect = async () => {
    setIsAuthorizing(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await authorizeCalendar();
      setSuccessMessage("Conexión con Google Calendar autorizada con éxito.");
    } catch (error: any) {
      console.error("Calendar authorization failed:", error);
      const code = error?.code || error?.message;
      if (code === "popup_cancelled") {
        setErrorMessage("Se cerró la ventana de autorización antes de completarse.");
      } else if (code === "permission_denied") {
        setErrorMessage("No se otorgaron los permisos necesarios para acceder a Google Calendar.");
      } else if (code === "account_mismatch") {
        setErrorMessage("La cuenta de Google seleccionada no coincide con el usuario autenticado.");
      } else if (code === "not_signed_in") {
        setErrorMessage("Debes iniciar sesión con tu cuenta de Google antes de autorizar el calendario.");
      } else {
        setErrorMessage("Ocurrió un error al autorizar Google Calendar. Por favor, inténtalo de nuevo.");
      }
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleDisconnect = () => {
    clearCalendarAuth();
    setSuccessMessage("Google Calendar ha sido desconectado de esta sesión.");
    setErrorMessage(null);
  };

  return (
    <div
      id="card-google-calendar-sync"
      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-lg ${
              errorMessage
                ? "bg-rose-950/70 border border-rose-800/70 text-rose-400"
                : isConnected
                ? "bg-emerald-950/70 border border-emerald-800/70 text-emerald-400"
                : requiresReauth
                ? "bg-amber-950/70 border border-amber-800/70 text-amber-400"
                : "bg-sky-950/70 border border-sky-800/70 text-sky-400"
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Google Calendar
            </h3>
            <p className="text-xs text-slate-400">
              Sincronización unidireccional de clases y tocatas
            </p>
          </div>
        </div>

        <div>
          {isAuthorizing ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-950/60 border border-sky-800/70 rounded-full text-sky-400 text-[11px] font-medium">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Conectando</span>
            </div>
          ) : errorMessage ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/60 border border-rose-800/70 rounded-full text-rose-300 text-[11px] font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>Error</span>
            </div>
          ) : isConnected ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-800/70 rounded-full text-emerald-400 text-[11px] font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Conectado</span>
            </div>
          ) : requiresReauth ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 border border-amber-800/70 rounded-full text-amber-300 text-[11px] font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Token expirado</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-slate-400 text-[11px] font-medium">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>No conectado</span>
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <DetailedErrorBanner
          id="calendar-sync-error"
          error={errorMessage}
        />
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-950/50 border border-emerald-800/60 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <p>{successMessage}</p>
          </div>
        </div>
      )}

      {isConnected ? (
        <div className="space-y-3">
          <div className="p-3.5 bg-slate-950/70 border border-slate-800/70 rounded-xl space-y-2 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Sesión activa con Google Calendar</span>
                </div>
                <p className="text-slate-400">
                  Calendario de destino:{" "}
                  <span className="text-slate-200 font-medium">
                    Principal (primary)
                  </span>
                </p>
                {calendarAuth.identity?.googleAccountId && (
                  <p className="text-slate-400">
                    ID de cuenta:{" "}
                    <span className="text-slate-300 font-mono">
                      {currentUser?.email || calendarAuth.identity.googleAccountId}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="https://calendar.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  <span>Abrir Calendar</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>

                <button
                  type="button"
                  id="btn-desconectar-calendar"
                  onClick={handleDisconnect}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700/80 hover:border-rose-800/50 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Desconectar</span>
                </button>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Las clases y tocatas creadas o editadas con la opción &ldquo;Sincronizar con Google Calendar&rdquo; se reflejarán automáticamente en tu calendario de Google.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            Conecta tu cuenta de Google Calendar para sincronizar tus clases y tocatas unidireccionalmente. Podrás activar o desactivar la sincronización individualmente en cada clase o evento.
          </p>

          {!currentUser ? (
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-200">
                  Inicia sesión con Google para conectar Google Calendar
                </p>
                <p className="text-[11px] text-slate-400">
                  Sincroniza tus clases y eventos con tu cuenta de Google.
                </p>
              </div>
              <button
                type="button"
                id="btn-login-google-calendar-card"
                onClick={handleSignInAndConnect}
                disabled={isAuthorizing}
                className="min-h-[40px] inline-flex items-center justify-center gap-2.5 px-4 py-2 bg-white hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 text-slate-900 text-xs font-semibold rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
              >
                {isAuthorizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
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
                    <span>Iniciar sesión con Google</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="pt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                id="btn-conectar-google-calendar"
                onClick={handleConnect}
                disabled={isAuthorizing}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white disabled:text-slate-500 font-medium rounded-xl text-xs transition-colors cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {isAuthorizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-sky-200" />
                    <span>Solicitando autorización...</span>
                  </>
                ) : requiresReauth ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Reautorizar Google Calendar</span>
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" />
                    <span>Conectar Google Calendar</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
