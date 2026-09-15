import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { GoogleCalendarSyncMetadata } from "../../types";
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

interface GoogleCalendarSyncToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  metadata?: GoogleCalendarSyncMetadata;
  onRetry?: () => Promise<void>;
  isRetrying?: boolean;
}

export const GoogleCalendarSyncToggle: React.FC<GoogleCalendarSyncToggleProps> = ({
  enabled,
  onChange,
  metadata,
  onRetry,
  isRetrying = false,
}) => {
  const { currentUser, calendarAuth, authorizeCalendar } = useAuth();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isConnected = calendarAuth.status === "authorized_temporarily";

  const handleToggle = async (newVal: boolean) => {
    setAuthError(null);
    if (newVal && !isConnected) {
      if (!currentUser) {
        setAuthError("Inicia sesión con Google para usar la sincronización.");
        return;
      }
      setIsAuthorizing(true);
      try {
        await authorizeCalendar();
        onChange(true);
      } catch (err: any) {
        console.error("Authorization failed:", err);
        setAuthError(
          err?.code === "popup_cancelled"
            ? "Ventana de autorización cerrada."
            : "No se pudo autorizar Google Calendar."
        );
        onChange(false);
      } finally {
        setIsAuthorizing(false);
      }
    } else {
      onChange(newVal);
    }
  };

  const syncStatus = metadata?.status;

  return (
    <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
              enabled
                ? "bg-sky-950/70 border-sky-700/80 text-sky-300 shadow-sm"
                : "bg-slate-900 border-slate-800 text-slate-400"
            }`}
          >
            <Calendar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="toggle-google-calendar-sync"
              className="text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer block truncate"
            >
              Sincronizar con Google Calendar
            </label>
            <p className="text-[11px] text-slate-400 leading-tight truncate">
              {isConnected
                ? "Crea y actualiza el evento en tu Google Calendar principal"
                : "Conecta tu calendario de Google para sincronizar"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAuthorizing && (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          )}
          <button
            type="button"
            role="switch"
            id="toggle-google-calendar-sync"
            aria-checked={enabled}
            disabled={isAuthorizing}
            onClick={() => handleToggle(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
              enabled ? "bg-sky-600" : "bg-slate-800"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {authError && (
        <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{authError}</span>
        </div>
      )}

      {/* Connection prompt if toggle is enabled but not connected */}
      {enabled && !isConnected && !isAuthorizing && (
        <div className="p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Google Calendar no está autorizado en esta sesión.</span>
          </div>
          <button
            type="button"
            onClick={() => handleToggle(true)}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-[11px] font-medium shrink-0 cursor-pointer"
          >
            Autorizar
          </button>
        </div>
      )}

      {/* Sync Status Badge when metadata exists */}
      {metadata && metadata.enabled && (
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[11px]">Estado de sincronización:</span>
            {syncStatus === "synced" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/70 text-emerald-400 text-[11px] font-medium">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Sincronizado
              </span>
            )}
            {syncStatus === "pending" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-950/60 border border-sky-800/70 text-sky-400 text-[11px] font-medium">
                <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                Pendiente de sincronizar
              </span>
            )}
            {syncStatus === "error" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-800/70 text-rose-300 text-[11px] font-medium">
                <AlertCircle className="w-3 h-3 text-rose-400" />
                Error de sincronización
              </span>
            )}
            {syncStatus === "not_synced" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-medium">
                No sincronizado
              </span>
            )}
          </div>

          {syncStatus === "error" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md text-[11px] font-medium cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              <span>{isRetrying ? "Reintentando..." : "Reintentar"}</span>
            </button>
          )}

          {metadata.googleCalendarEventId && (
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300 transition-colors"
            >
              <span>Ver en Calendar</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
};
