import React from "react";
import { ActividadUnificada } from "../../types";
import { CategoryBadge, EstadoBadge } from "../common/Badge";
import { formatTimeRange, formatFechaCorta } from "../../utils/dateUtils";
import { Clock, MapPin, User, ChevronRight, Bell, Calendar } from "lucide-react";
import { getClaseReminderStatus } from "../../utils/notificationService";

interface CommitmentCardProps {
  actividad: ActividadUnificada;
  onClick: () => void;
  showDate?: boolean;
}

export const CommitmentCard: React.FC<CommitmentCardProps> = ({
  actividad,
  onClick,
  showDate = false,
}) => {
  const timeFormatted = formatTimeRange(actividad.horaInicio, actividad.horaFin);
  const reminderStatus = actividad.rawClase
    ? getClaseReminderStatus(actividad.rawClase)
    : "none";
  const isReminderUnconfirmed = reminderStatus === "unconfirmed";

  return (
    <div
      id={`actividad-card-${actividad.id}`}
      onClick={onClick}
      className={`p-3.5 sm:p-4 bg-slate-900 border rounded-xl cursor-pointer transition-all duration-150 flex items-center justify-between gap-3 group active:scale-[0.99] ${
        actividad.cancelada
          ? "border-slate-800/60 opacity-65 bg-slate-950/60"
          : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/70 shadow-sm"
      }`}
    >
      <div className="space-y-1.5 min-w-0 flex-1">
        {/* Badges & time header */}
        <div className="flex items-center gap-2 flex-wrap">
          <CategoryBadge
            category={actividad.categoria}
            isCancelada={actividad.cancelada}
            size="sm"
          />

          {showDate && (
            <span className="text-xs font-medium text-slate-300">
              {formatFechaCorta(actividad.fecha)}
            </span>
          )}

          <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-slate-300">
            <Clock className="w-3 h-3 text-slate-500" />
            {timeFormatted}
          </span>

          {!actividad.cancelada && (
            <EstadoBadge estado={actividad.estado} size="sm" />
          )}

          {actividad.tipoActividad === "tocata" &&
            actividad.rawTocata?.honorarios != null &&
            actividad.rawTocata.honorarios > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium text-emerald-300 bg-emerald-950/60 border border-emerald-800/60">
                ${actividad.rawTocata.honorarios.toLocaleString("es-CL")}
              </span>
            )}

          {actividad.rawClase?.recordatorio?.activo && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded shadow-sm"
              title={
                isReminderUnconfirmed
                  ? `Recordatorio no confirmado a tiempo: la hora programada (${actividad.rawClase.recordatorio.antelacionValor} ${actividad.rawClase.recordatorio.antelacionUnidad} antes) ya pasó sin registrar confirmación de entrega`
                  : `Recordatorio programado: ${actividad.rawClase.recordatorio.antelacionValor} ${actividad.rawClase.recordatorio.antelacionUnidad} antes`
              }
            >
              <Bell className="w-2.5 h-2.5 text-amber-400" />
              <span>
                {actividad.rawClase.recordatorio.antelacionValor}{" "}
                {actividad.rawClase.recordatorio.antelacionUnidad === "minutos"
                  ? "min"
                  : actividad.rawClase.recordatorio.antelacionUnidad === "horas"
                  ? "h"
                  : "d"}
              </span>
              {isReminderUnconfirmed && (
                <span
                  className="inline-flex items-center justify-center w-3 h-3 text-[9px] font-bold text-amber-200 bg-amber-900/90 rounded-full border border-amber-700/60 ml-0.5"
                  title="Hora de recordatorio superada sin confirmación"
                >
                  ?
                </span>
              )}
            </span>
          )}

          {(actividad.rawClase?.googleCalendar?.enabled || actividad.rawTocata?.googleCalendar?.enabled) && (() => {
            const calMeta = actividad.rawClase?.googleCalendar || actividad.rawTocata?.googleCalendar;
            if (!calMeta) return null;
            return (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${
                  calMeta.status === "synced"
                    ? "text-sky-300 bg-sky-950/60 border-sky-800/60"
                    : calMeta.status === "error"
                    ? "text-rose-300 bg-rose-950/60 border-rose-800/60"
                    : "text-slate-400 bg-slate-900 border-slate-800"
                }`}
                title={
                  calMeta.status === "synced"
                    ? "Sincronizado con Google Calendar"
                    : calMeta.status === "error"
                    ? `Error al sincronizar con Google Calendar${calMeta.lastError?.message ? `: ${calMeta.lastError.message}` : ""}`
                    : "Sincronización con Google Calendar pendiente"
                }
              >
                <Calendar className="w-2.5 h-2.5 text-sky-400" />
                <span>Calendar</span>
              </span>
            );
          })()}
        </div>

        {/* Main Title */}
        <div className="flex items-center gap-1.5">
          {actividad.tipoActividad === "clase" && (
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          {actividad.tipoActividad === "tocata" && (
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <h4
            className={`text-sm sm:text-base font-semibold truncate ${
              actividad.cancelada
                ? "text-slate-400 line-through"
                : "text-slate-100 group-hover:text-blue-400 transition-colors"
            }`}
          >
            {actividad.tituloPrincipal}
          </h4>
        </div>

        {/* Subtitle */}
        <p className="text-xs text-slate-400 truncate leading-relaxed">
          {actividad.subtitulo}
        </p>
      </div>

      <div className="shrink-0 flex items-center text-slate-500 group-hover:text-slate-300 transition-transform group-hover:translate-x-0.5">
        <ChevronRight className="w-5 h-5" />
      </div>
    </div>
  );
};
