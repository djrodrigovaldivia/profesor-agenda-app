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
  } = useAuth();

  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isConnected = calendarAuth.status === "authorized_temporarily";
  const requiresReauth = calendarAuth.status === "requires_reauthorization";

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
            <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                Inicia sesión con tu cuenta de Google para poder conectar Google Calendar.
              </span>
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
