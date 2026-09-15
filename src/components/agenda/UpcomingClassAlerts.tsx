import React, { useState, useEffect, useMemo } from "react";
import { Clase, Alumno } from "../../types";
import {
  Clock,
  Calendar,
  ChevronRight,
  X,
} from "lucide-react";
import { formatFechaCorta, formatTimeRange, parseDateTimeLocal, hasActivityStarted } from "../../utils/dateUtils";

interface UpcomingClassAlertsProps {
  clases: Clase[];
  alumnos: Alumno[];
  onOpenClaseDetail: (clase: Clase) => void;
  now?: Date;
}

interface UpcomingClassItem {
  clase: Clase;
  alumno: Alumno | undefined;
  diffMinutes: number;
  timeLabel: string;
}

export const UpcomingClassAlerts: React.FC<UpcomingClassAlertsProps> = ({
  clases,
  alumnos,
  onOpenClaseDetail,
  now: nowProp,
}) => {
  // If now is not provided by parent, keep a single lightweight interval with focus/visibility updates
  const [internalNow, setInternalNow] = useState(() => new Date());
  const now = nowProp || internalNow;

  const [dismissedAlerts, setDismissedAlerts] = useState<
    Record<string, boolean>
  >({});
  const [is24hBannerDismissed, setIs24hBannerDismissed] = useState(false);

  useEffect(() => {
    if (nowProp) return; // Managed by parent component with single interval

    const updateTime = () => setInternalNow(new Date());

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        updateTime();
      }
    };
    const handleFocus = () => {
      updateTime();
    };

    window.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    const timer = setInterval(updateTime, 20000);
    return () => {
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      clearInterval(timer);
    };
  }, [nowProp]);

  const alumnoMap = useMemo(() => {
    const map = new Map<string, Alumno>();
    alumnos.forEach((a) => map.set(a.id, a));
    return map;
  }, [alumnos]);

  // Analyze upcoming classes strictly BEFORE their start time
  const { classesWithin3h, classesWithin24h } = useMemo(() => {
    const within3h: UpcomingClassItem[] = [];
    const within24h: UpcomingClassItem[] = [];

    const nowMs = now.getTime();

    clases.forEach((c) => {
      if (c.estado === "cancelada" || c.estado === "realizada") return;

      const startTime = parseDateTimeLocal(c.fecha, c.horaInicio);
      if (!startTime) return;
      const startMs = startTime.getTime();

      // Rule: An alert for a future class must disappear as soon as start time arrives!
      // No alerts for ongoing or past classes.
      if (nowMs >= startMs || hasActivityStarted(c.fecha, c.horaInicio, now)) return;

      const diffMinutes = Math.round((startMs - nowMs) / 60000);
      if (diffMinutes <= 0) return;

      let timeLabel = "";
      if (diffMinutes < 60) {
        timeLabel = `En ${diffMinutes} min`;
      } else if (diffMinutes <= 180) {
        const hours = Math.floor(diffMinutes / 60);
        const remainingMin = diffMinutes % 60;
        timeLabel =
          remainingMin > 0
            ? `En ${hours}h ${remainingMin}m`
            : `En ${hours} ${hours === 1 ? "hora" : "horas"}`;
      }

      const item: UpcomingClassItem = {
        clase: c,
        alumno: alumnoMap.get(c.alumnoId),
        diffMinutes,
        timeLabel,
      };

      // 1. Imminent: Within 3 hours
      if (diffMinutes <= 180) {
        within3h.push(item);
      }
      // 2. Next 24 hours: Between 3h and 24h
      else if (diffMinutes <= 1440) {
        within24h.push(item);
      }
    });

    // Sort ascending by remaining time
    within3h.sort((a, b) => a.diffMinutes - b.diffMinutes);
    within24h.sort((a, b) => a.diffMinutes - b.diffMinutes);

    return { classesWithin3h: within3h, classesWithin24h: within24h };
  }, [clases, alumnoMap, now]);

  const handleDismissSingle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedAlerts((prev) => ({ ...prev, [id]: true }));
  };

  const visibleClassesWithin3h = classesWithin3h.filter(
    (item) => !dismissedAlerts[item.clase.id]
  );

  if (visibleClassesWithin3h.length === 0 && (is24hBannerDismissed || classesWithin24h.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-3 mb-2 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* 1. Alerta Inminente (Menos de 3 horas antes de iniciar la clase) */}
      {visibleClassesWithin3h.map((item) => {
        const { clase, alumno, timeLabel } = item;
        const alumnoNombre = alumno ? alumno.nombre : "Alumno";

        return (
          <div
            key={`alert-3h-${clase.id}`}
            id={`alert-inminente-${clase.id}`}
            onClick={() => onOpenClaseDetail(clase)}
            className="group relative overflow-hidden bg-slate-900/95 hover:bg-slate-900 border border-amber-500/40 hover:border-amber-500/70 rounded-2xl p-4 sm:p-5 shadow-lg shadow-amber-950/20 transition-all cursor-pointer select-none"
            role="alert"
          >
            {/* Top accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="p-2.5 rounded-xl shrink-0 bg-amber-950/80 text-amber-400 border border-amber-800/80">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-tight bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      {timeLabel}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatTimeRange(clase.horaInicio, clase.horaFin)}
                    </span>
                  </div>

                  <h4 className="text-base font-bold text-slate-100 group-hover:text-white truncate">
                    {alumnoNombre}
                  </h4>

                  {clase.tema && (
                    <p className="text-xs text-slate-300 line-clamp-1">
                      {clase.tema}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-amber-400 group-hover:text-amber-300 mr-1">
                  Ver detalle
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
                <button
                  type="button"
                  id={`btn-descartar-alert-${clase.id}`}
                  onClick={(e) => handleDismissSingle(clase.id, e)}
                  aria-label="Descartar aviso"
                  className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Descartar aviso"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* 2. Banner Resumen de Clases en las Próximas 24 horas */}
      {!is24hBannerDismissed && classesWithin24h.length > 0 && (
        <div
          id="banner-proximas-24h"
          className="bg-slate-900/90 border border-sky-900/40 hover:border-sky-800/60 rounded-2xl p-4 sm:p-5 shadow-sm transition-all text-slate-200 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-sky-950/80 border border-sky-800/60 text-sky-400 shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-100 tracking-tight">
                    Próximas 24 horas
                  </h4>
                  <span className="px-2 py-0.2 text-[10px] font-bold text-sky-300 bg-sky-950/90 border border-sky-800/70 rounded-full">
                    {classesWithin24h.length}{" "}
                    {classesWithin24h.length === 1 ? "clase" : "clases"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-1">
                  Tienes compromisos pedagógicos programados para hoy/mañana
                </p>
              </div>
            </div>

            <button
              type="button"
              id="btn-descartar-banner-24h"
              onClick={() => setIs24hBannerDismissed(true)}
              aria-label="Cerrar aviso de 24h"
              className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick list of upcoming class chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none pt-0.5">
            {classesWithin24h.map(({ clase, alumno }) => {
              const alumnoNombre = alumno ? alumno.nombre : "Alumno";
              return (
                <button
                  key={`chip-24h-${clase.id}`}
                  type="button"
                  id={`btn-clase-chip-${clase.id}`}
                  onClick={() => onOpenClaseDetail(clase)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all active:scale-[0.98] shrink-0 cursor-pointer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-200 truncate max-w-[130px]">
                    {alumnoNombre}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {clase.horaInicio} • {formatFechaCorta(clase.fecha)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
