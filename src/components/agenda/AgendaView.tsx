import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ActividadUnificada, Clase, Tocata } from "../../types";
import { useAgenda } from "../../context/AgendaContext";
import { CommitmentCard } from "./CommitmentCard";
import { TopCardsSkeleton, AgendaListSkeleton } from "./AgendaSkeleton";
import { CategoryBadge, EstadoBadge } from "../common/Badge";
import { SyncStatusDot } from "../common/SyncStatusDot";
import { UpcomingClassAlerts } from "./UpcomingClassAlerts";
import {
  formatFechaLarga,
  formatFechaCorta,
  formatTimeRange,
  parseDateTimeLocal,
  hasActivityStarted,
  hasActivityEnded,
  getISODate,
  getEndOfWeekDate,
  getActivityTemporalSegment,
} from "../../utils/dateUtils";
import { calculateNotificationTriggerTime } from "../../utils/notificationService";
import {
  Plus,
  CalendarPlus,
  Radio,
  Clock,
  MapPin,
  Sparkles,
  X,
  Bell,
  Calendar as CalendarIcon,
  ChevronDown,
  AlertCircle,
  BookOpen,
} from "lucide-react";

interface AgendaViewProps {
  onOpenNewClase: () => void;
  onOpenNewTocata: () => void;
  onOpenClaseDetail: (clase: Clase) => void;
  onOpenTocataDetail: (tocata: Tocata) => void;
}

export const FILTERS_STORAGE_KEY = "profesor_agenda_filtros_v1";
export type SpecificFilter = "alma" | "escalera" | "dj";

interface ReminderItem {
  id: string;
  texto: string;
  act: ActividadUnificada;
  storageKey?: string;
  isMissed?: boolean;
}

export const AgendaView: React.FC<AgendaViewProps> = ({
  onOpenNewClase,
  onOpenNewTocata,
  onOpenClaseDetail,
  onOpenTocataDetail,
}) => {
  const {
    clases,
    tocatas,
    alumnos,
    preferencias,
    getAllActividades,
    loadingData,
  } = useAgenda();

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [showHistorial, setShowHistorial] = useState(false);
  const [showAllHistorial, setShowAllHistorial] = useState(false);
  const [showAllMasAdelante, setShowAllMasAdelante] = useState(false);

  // Periodically refresh current time and update immediately on app focus / tab visibility
  useEffect(() => {
    const updateTime = () => setNow(new Date());

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updateTime();
      }
    };
    const handleFocus = () => {
      updateTime();
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    const timer = setInterval(updateTime, 30000);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      clearInterval(timer);
    };
  }, []);

  const [dismissedReminders, setDismissedReminders] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        const saved = sessionStorage.getItem("profesor_agenda_dismissed_reminders");
        if (saved) return JSON.parse(saved);
      }
    } catch {}
    return {};
  });

  // Filter State persisted in localStorage: empty array represents "Todos"
  const [selectedFilters, setSelectedFilters] = useState<SpecificFilter[]>(() => {
    try {
      const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        if (parsed.includes("todos") || parsed.length === 0) {
          return [];
        }
        const valid = parsed.filter(
          (c): c is SpecificFilter => c === "alma" || c === "escalera" || c === "dj"
        );
        if (valid.length > 0) return valid;
      }
    } catch (e) {
      console.error("Error loading filters from storage, defaulting to Todos", e);
    }
    return [];
  });

  const isTodos = selectedFilters.length === 0;
  const isSoloClases =
    selectedFilters.length === 2 &&
    selectedFilters.includes("alma") &&
    selectedFilters.includes("escalera");
  const isSoloTocatas =
    selectedFilters.length === 1 && selectedFilters.includes("dj");

  useEffect(() => {
    const handleImported = () => {
      try {
        const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            if (parsed.includes("todos") || parsed.length === 0) {
              setSelectedFilters([]);
              return;
            }
            const valid = parsed.filter(
              (c): c is SpecificFilter => c === "alma" || c === "escalera" || c === "dj"
            );
            if (valid.length > 0) {
              setSelectedFilters(valid);
              return;
            }
          }
        }
      } catch {}
      setSelectedFilters([]);
    };
    window.addEventListener("agenda-data-imported", handleImported);
    return () => window.removeEventListener("agenda-data-imported", handleImported);
  }, []);

  const handleToggleTodos = useCallback(() => {
    setSelectedFilters([]);
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(["todos"]));
    } catch (e) {
      console.error("Error saving filters to storage", e);
    }
  }, []);

  const handleToggleSoloClases = useCallback(() => {
    if (isSoloClases) {
      handleToggleTodos();
    } else {
      setSelectedFilters(["alma", "escalera"]);
      try {
        localStorage.setItem(
          FILTERS_STORAGE_KEY,
          JSON.stringify(["alma", "escalera"])
        );
      } catch (e) {
        console.error("Error saving filters to storage", e);
      }
    }
  }, [isSoloClases, handleToggleTodos]);

  const handleToggleSoloTocatas = useCallback(() => {
    if (isSoloTocatas) {
      handleToggleTodos();
    } else {
      setSelectedFilters(["dj"]);
      try {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(["dj"]));
      } catch (e) {
        console.error("Error saving filters to storage", e);
      }
    }
  }, [isSoloTocatas, handleToggleTodos]);

  const handleToggleCategory = useCallback(
    (cat: SpecificFilter) => {
      let next: SpecificFilter[];
      if (selectedFilters.length === 0) {
        // Switch from "Todos" to just this category
        next = [cat];
      } else if (selectedFilters.includes(cat)) {
        // Toggling off
        next = selectedFilters.filter((c) => c !== cat);
        // If last specific filter is turned off, revert to Todos
        if (next.length === 0) {
          handleToggleTodos();
          return;
        }
      } else {
        // Adding specific category
        next = [...selectedFilters, cat];
      }

      setSelectedFilters(next);
      try {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Error saving filters to storage", e);
      }
    },
    [selectedFilters, handleToggleTodos]
  );

  const matchesFilter = useCallback(
    (act: ActividadUnificada): boolean => {
      // If "Todos" is active, show everything
      if (selectedFilters.length === 0) return true;

      // Fecha DJ: only tocatas
      if (act.tipoActividad === "tocata") {
        return selectedFilters.includes("dj");
      }

      // Classes: ALMA or La Escalera
      if (act.tipoActividad === "clase") {
        const rawTipo = (act.rawClase?.tipo || act.categoria || "").toLowerCase().trim();
        const isAlma = rawTipo === "alma";
        const isEscalera = rawTipo === "escalera" || rawTipo === "sokolov";

        if (isAlma && selectedFilters.includes("alma")) return true;
        if (isEscalera && selectedFilters.includes("escalera")) return true;
        return false;
      }

      return false;
    },
    [selectedFilters]
  );

  // Top Cards: Una clase futura y una tocata futura no canceladas (independientes de los filtros)
  const proximaClaseFutura = useMemo(() => {
    const valid = clases
      .filter(
        (c) =>
          c.estado === "programada" &&
          !hasActivityEnded(c.fecha, c.horaInicio, c.horaFin, now)
      )
      .sort((a, b) => {
        const tA = parseDateTimeLocal(a.fecha, a.horaInicio)?.getTime() || 0;
        const tB = parseDateTimeLocal(b.fecha, b.horaInicio)?.getTime() || 0;
        return tA - tB;
      });
    if (valid.length === 0) return null;
    const c = valid[0];
    const alumno = alumnos.find((a) => a.id === c.alumnoId);
    return {
      tipoActividad: "clase" as const,
      id: c.id,
      fecha: c.fecha,
      horaInicio: c.horaInicio,
      horaFin: c.horaFin,
      tituloPrincipal: alumno ? alumno.nombre : "Alumno",
      subtitulo: c.tema,
      categoria: (c.tipo === "escalera" || c.tipo === "sokolov" ? "escalera" : "alma") as
        | "alma"
        | "escalera",
      estado: c.estado,
      cancelada: false,
      rawClase: c,
    };
  }, [clases, alumnos, now]);

  const proximaTocataFutura = useMemo(() => {
    const valid = tocatas
      .filter(
        (t) =>
          t.estado !== "cancelada" &&
          t.estado !== "realizada" &&
          !hasActivityEnded(t.fecha, t.horaInicio, t.horaFin, now)
      )
      .sort((a, b) => {
        const tA = parseDateTimeLocal(a.fecha, a.horaInicio)?.getTime() || 0;
        const tB = parseDateTimeLocal(b.fecha, b.horaInicio)?.getTime() || 0;
        return tA - tB;
      });
    if (valid.length === 0) return null;
    const t = valid[0];
    const lugarTexto = t.lugar
      ? t.ciudad && t.ciudad !== t.lugar
        ? `${t.lugar}, ${t.ciudad}`
        : t.lugar
      : t.ciudad || "Lugar por confirmar";
    return {
      tipoActividad: "tocata" as const,
      id: t.id,
      fecha: t.fecha,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      tituloPrincipal: t.titulo,
      subtitulo: `${t.proyecto} • ${lugarTexto}`,
      categoria: "dj" as const,
      estado: t.estado,
      cancelada: false,
      rawTocata: t,
    };
  }, [tocatas, now]);

  // Chronological grouping into:
  // 1. "Esta semana" (desde ahora hasta domingo 23:59:59.999 local)
  // 2. "Próximas fechas" (desde lunes posterior hasta +30 días)
  // 3. "Más adelante" (> 30 días)
  // 4. "Historial" (actividades finalizadas, pasadas o canceladas)
  const {
    estaSemanaRaw,
    proximasFechasRaw,
    masAdelanteRaw,
    historialRaw,
    endOfWeekDateFormatted,
  } = useMemo(() => {
    const allActs = getAllActividades();
    const endOfWeek = getEndOfWeekDate(now);

    const estaSemanaList: ActividadUnificada[] = [];
    const proximasList: ActividadUnificada[] = [];
    const masAdelanteList: ActividadUnificada[] = [];
    const historialList: ActividadUnificada[] = [];

    allActs.forEach((act) => {
      // Use dateUtils helper for strict local temporal segmentation
      const segment = getActivityTemporalSegment(
        act.fecha,
        act.horaInicio,
        act.horaFin,
        act.estado,
        act.cancelada,
        now
      );

      switch (segment) {
        case "esta_semana":
          estaSemanaList.push(act);
          break;
        case "proximas_fechas":
          proximasList.push(act);
          break;
        case "mas_adelante":
          masAdelanteList.push(act);
          break;
        case "historial":
        default:
          historialList.push(act);
          break;
      }
    });

    const sortAsc = (a: ActividadUnificada, b: ActividadUnificada) => {
      const tA = parseDateTimeLocal(a.fecha, a.horaInicio)?.getTime() || 0;
      const tB = parseDateTimeLocal(b.fecha, b.horaInicio)?.getTime() || 0;
      return tA - tB;
    };

    const sortDesc = (a: ActividadUnificada, b: ActividadUnificada) => {
      const tA = parseDateTimeLocal(a.fecha, a.horaInicio)?.getTime() || 0;
      const tB = parseDateTimeLocal(b.fecha, b.horaInicio)?.getTime() || 0;
      return tB - tA;
    };

    estaSemanaList.sort(sortAsc);
    proximasList.sort(sortAsc);
    masAdelanteList.sort(sortAsc);
    historialList.sort(sortDesc);

    return {
      estaSemanaRaw: estaSemanaList,
      proximasFechasRaw: proximasList,
      masAdelanteRaw: masAdelanteList,
      historialRaw: historialList,
      endOfWeekDateFormatted: formatFechaCorta(getISODate(endOfWeek)),
    };
  }, [getAllActividades, now]);

  const estaSemana = useMemo(
    () => estaSemanaRaw.filter(matchesFilter),
    [estaSemanaRaw, matchesFilter]
  );
  const proximasFechas = useMemo(
    () => proximasFechasRaw.filter(matchesFilter),
    [proximasFechasRaw, matchesFilter]
  );
  const masAdelante = useMemo(
    () => masAdelanteRaw.filter(matchesFilter),
    [masAdelanteRaw, matchesFilter]
  );
  const historial = useMemo(
    () => historialRaw.filter(matchesFilter),
    [historialRaw, matchesFilter]
  );

  const handleCardClick = (act: ActividadUnificada) => {
    setErrorMessage(null);
    if (act.tipoActividad === "clase") {
      const targetClase = act.rawClase || clases.find((c) => c.id === act.id);
      if (!targetClase) {
        setErrorMessage("La clase seleccionada no existe o no fue encontrada.");
        return;
      }
      onOpenClaseDetail(targetClase);
    } else if (act.tipoActividad === "tocata") {
      const targetTocata = act.rawTocata || tocatas.find((t) => t.id === act.id);
      if (!targetTocata) {
        setErrorMessage("La tocata seleccionada no existe o no fue encontrada.");
        return;
      }
      onOpenTocataDetail(targetTocata);
    }
  };

  // Generate Reminders that auto-expire strictly when an activity starts
  const reminders = useMemo(() => {
    if (!preferencias.recordatoriosActivos) return [];

    const list: ReminderItem[] = [];
    const hoyIso = getISODate(now);

    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowIso = getISODate(tomorrow);

    const allActs = getAllActividades();

    // Today reminders (if 'mismo_dia' or 'ambos')
    if (
      preferencias.recordatorios === "mismo_dia" ||
      preferencias.recordatorios === "ambos"
    ) {
      allActs
        .filter(
          (a) =>
            a.fecha === hoyIso &&
            !a.cancelada &&
            a.estado !== "cancelada" &&
            a.estado !== "realizada"
        )
        .forEach((a) => {
          // Rule 1: A future activity reminder must disappear automatically when its start time arrives!
          // Must not be kept during an ongoing activity or once started/ended.
          if (hasActivityStarted(a.fecha, a.horaInicio, now)) {
            return;
          }

          const reminderId = `rem-hoy-${a.id}`;
          if (dismissedReminders[reminderId]) return;

          let msg = "";
          if (a.tipoActividad === "clase") {
            const tipoLabel =
              a.categoria === "alma"
                ? "clase ALMA"
                : a.categoria === "escalera"
                ? "mentoría La Escalera"
                : "clase";
            const lugarAlma = a.categoria === "alma" ? " en ALMA" : "";
            msg = `Hoy tienes una ${tipoLabel} a las ${a.horaInicio} con ${a.tituloPrincipal}${lugarAlma}.`;
          } else {
            const lugar =
              a.rawTocata?.lugar
                ? a.rawTocata?.ciudad && a.rawTocata?.ciudad !== a.rawTocata?.lugar
                  ? `${a.rawTocata.lugar}, ${a.rawTocata.ciudad}`
                  : a.rawTocata.lugar
                : a.rawTocata?.ciudad || "locación programada";
            msg = `Hoy tienes una tocata a las ${a.horaInicio} en ${lugar}.`;
          }
          list.push({ id: reminderId, texto: msg, act: a });
        });
    }

    // Tomorrow reminders (if 'un_dia_antes' or 'ambos')
    if (
      preferencias.recordatorios === "un_dia_antes" ||
      preferencias.recordatorios === "ambos"
    ) {
      allActs
        .filter(
          (a) =>
            a.fecha === tomorrowIso &&
            !a.cancelada &&
            a.estado !== "cancelada" &&
            a.estado !== "realizada"
        )
        .forEach((a) => {
          if (hasActivityStarted(a.fecha, a.horaInicio, now)) {
            return;
          }

          const reminderId = `rem-manana-${a.id}`;
          if (dismissedReminders[reminderId]) return;

          let msg = "";
          if (a.tipoActividad === "clase") {
            const tipoLabel =
              a.categoria === "alma"
                ? "clase ALMA"
                : a.categoria === "escalera"
                ? "mentoría La Escalera"
                : "clase";
            const lugarAlma = a.categoria === "alma" ? " en ALMA" : "";
            msg = `Mañana tienes una ${tipoLabel} a las ${a.horaInicio} con ${a.tituloPrincipal}${lugarAlma}.`;
          } else {
            const lugar =
              a.rawTocata?.lugar
                ? a.rawTocata?.ciudad && a.rawTocata?.ciudad !== a.rawTocata?.lugar
                  ? `${a.rawTocata.lugar}, ${a.rawTocata.ciudad}`
                  : a.rawTocata.lugar
                : a.rawTocata?.ciudad || "locación programada";
            msg = `Mañana tienes una tocata a las ${a.horaInicio} en ${lugar}.`;
          }
          list.push({ id: reminderId, texto: msg, act: a });
        });
    }

    // Missed reminders check (only if activity has not started or ended)
    clases.forEach((c) => {
      if (
        c.estado !== "programada" ||
        !c.recordatorio ||
        !c.recordatorio.activo ||
        !c.fecha ||
        !c.horaInicio
      ) {
        return;
      }

      // If class already started or ended, discard alert automatically
      if (hasActivityStarted(c.fecha, c.horaInicio, now) || hasActivityEnded(c.fecha, c.horaInicio, c.horaFin, now)) {
        return;
      }

      const { antelacionValor, antelacionUnidad } = c.recordatorio;
      if (typeof antelacionValor !== "number" || antelacionValor <= 0) return;

      const triggerDate = calculateNotificationTriggerTime(
        c.fecha,
        c.horaInicio,
        antelacionValor,
        antelacionUnidad
      );
      if (!triggerDate) return;

      const storageKey = `clase_local_reminder_${c.id}_${c.fecha}_${c.horaInicio}_${antelacionValor}_${antelacionUnidad}`;
      const stored = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;

      if (
        stored === "delivered" ||
        stored === "missed_alerted" ||
        stored === "expired" ||
        stored === "dismissed" ||
        dismissedReminders[storageKey]
      ) {
        return;
      }

      const nowMs = now.getTime();
      const triggerMs = triggerDate.getTime();
      const classStartDate = parseDateTimeLocal(c.fecha, c.horaInicio);
      if (!classStartDate) return;
      const classStartMs = classStartDate.getTime();

      // Only alert if missed before the class has started
      if (nowMs >= triggerMs && nowMs < classStartMs) {
        const diffFromTarget = nowMs - triggerMs;
        if (diffFromTarget > 3 * 60 * 1000) {
          const alumno = alumnos.find((a) => a.id === c.alumnoId);
          const alumnoNombre = alumno ? alumno.nombre : "Alumno";
          list.push({
            id: storageKey,
            storageKey,
            isMissed: true,
            texto: `Recordatorio pendiente: esta alerta debía sonar antes (${alumnoNombre}); revisa la Agenda.`,
            act: {
              tipoActividad: "clase",
              id: c.id,
              fecha: c.fecha,
              horaInicio: c.horaInicio,
              horaFin: c.horaFin,
              tituloPrincipal: alumnoNombre,
              subtitulo: c.tema,
              categoria:
                c.tipo === "escalera" || c.tipo === "sokolov"
                  ? "escalera"
                  : "alma",
              estado: c.estado,
              cancelada: false,
              rawClase: c,
            },
          });
        }
      }
    });

    return list;
  }, [
    preferencias.recordatoriosActivos,
    preferencias.recordatorios,
    getAllActividades,
    clases,
    alumnos,
    dismissedReminders,
    now,
  ]);

  const dismissReminder = (rem: ReminderItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedReminders((prev) => {
      const next = { ...prev, [rem.id]: true };
      try {
        sessionStorage.setItem(
          "profesor_agenda_dismissed_reminders",
          JSON.stringify(next)
        );
      } catch {}
      return next;
    });

    if (rem.storageKey) {
      try {
        localStorage.setItem(rem.storageKey, "missed_alerted");
      } catch {}
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">
            Profesor Agenda
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Clases y tocatas
          </p>
        </div>

        {/* Dropdown "+ Agregar" */}
        <div className="relative">
          <button
            type="button"
            id="btn-agregar-principal"
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl transition-all shadow-sm active:scale-[0.98]"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>+ Agregar</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${
                isAddMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isAddMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setIsAddMenuOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-30 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  id="menu-opt-nueva-clase"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    onOpenNewClase();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                >
                  <CalendarPlus className="w-4 h-4 text-blue-400" />
                  <span>Nueva clase</span>
                </button>
                <button
                  type="button"
                  id="menu-opt-nueva-tocata"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    onOpenNewTocata();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                >
                  <Radio className="w-4 h-4 text-fuchsia-400" />
                  <span>Nueva tocata</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
 
      {/* Mensaje de error si una actividad no existe */}
      {errorMessage && (
        <div
          role="alert"
          id="agenda-error-banner"
          className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-xs flex items-center justify-between gap-3 shadow-sm animate-in fade-in"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium text-rose-100">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-rose-200 p-1 rounded-lg hover:bg-rose-900/50 transition-colors cursor-pointer"
            aria-label="Cerrar mensaje"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Banner de alertas dinámicas de clases (inminentes antes de comenzar) */}
      <UpcomingClassAlerts
        clases={clases}
        alumnos={alumnos}
        onOpenClaseDetail={onOpenClaseDetail}
        now={now}
      />

      {/* Dismissible Reminder Notifications */}
      {reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map((rem) => (
            <div
              key={rem.id}
              onClick={() => handleCardClick(rem.act)}
              className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl flex items-center justify-between gap-3 text-sm text-blue-200 cursor-pointer hover:bg-blue-950/60 transition-colors shadow-sm"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Bell className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="truncate">{rem.texto}</span>
              </div>
              <button
                type="button"
                onClick={(e) => dismissReminder(rem, e)}
                className="p-1 text-blue-400 hover:text-white hover:bg-blue-900/60 rounded-md transition-colors shrink-0"
                title="Descartar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Top 2 Cards: Próxima Clase & Próxima Fecha DJ (Siempre visibles e independientes de los filtros) */}
      {loadingData ? (
        <TopCardsSkeleton />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Próxima Clase */}
          <div
            id="card-proxima-clase"
            onClick={() => {
              if (proximaClaseFutura) handleCardClick(proximaClaseFutura);
            }}
            className={`p-4 bg-slate-900 border rounded-2xl transition-all ${
              proximaClaseFutura
                ? "border-slate-800 hover:border-blue-900/60 cursor-pointer shadow-sm hover:bg-slate-900/90"
                : "border-slate-800/70"
            }`}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                Próxima clase
              </span>
              {proximaClaseFutura && (
                <CategoryBadge category={proximaClaseFutura.categoria} size="sm" />
              )}
            </div>

            {proximaClaseFutura ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-50 truncate">
                    {proximaClaseFutura.tituloPrincipal}
                  </h3>
                  <span className="text-xs text-blue-300 font-medium">
                    {formatFechaCorta(proximaClaseFutura.fecha)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-1">
                  {proximaClaseFutura.subtitulo}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono pt-1">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>{formatTimeRange(proximaClaseFutura.horaInicio, proximaClaseFutura.horaFin)}</span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-xs text-slate-400">No hay clases próximas programadas.</p>
              </div>
            )}
          </div>

          {/* Próxima Fecha DJ */}
          <div
            id="card-proxima-tocata"
            onClick={() => {
              if (proximaTocataFutura) handleCardClick(proximaTocataFutura);
            }}
            className={`p-4 bg-slate-900 border rounded-2xl transition-all ${
              proximaTocataFutura
                ? "border-slate-800 hover:border-amber-900/60 cursor-pointer shadow-sm hover:bg-slate-900/90"
                : "border-slate-800/70"
            }`}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80 mb-3">
              <span
                style={{ color: "#f8995d" }}
                className="text-xs font-semibold uppercase tracking-wider"
              >
                Próxima Fecha DJ
              </span>
              {proximaTocataFutura && (
                <CategoryBadge category="dj" size="sm" />
              )}
            </div>

            {proximaTocataFutura ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-50 truncate">
                    {proximaTocataFutura.tituloPrincipal}
                  </h3>
                  <span
                    style={{ color: "#f8995d" }}
                    className="text-xs font-medium"
                  >
                    {formatFechaCorta(proximaTocataFutura.fecha)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-1">
                  {proximaTocataFutura.subtitulo}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>{formatTimeRange(proximaTocataFutura.horaInicio, proximaTocataFutura.horaFin)}</span>
                  </div>
                  <EstadoBadge estado={proximaTocataFutura.estado} size="sm" />
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-xs text-slate-400">No hay tocatas próximas programadas.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter Chips Bar (Filtrado de la lista cronológica con Modos de Vida y Academias) */}
      <div
        role="group"
        aria-label="Filtros de actividades"
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none touch-pan-x"
      >
        {/* Chip: Todos */}
        <button
          type="button"
          id="filter-chip-todos"
          aria-pressed={isTodos}
          onClick={handleToggleTodos}
          className={`min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 border flex items-center justify-center select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            isTodos
              ? "bg-slate-100 text-slate-950 border-slate-200 shadow-sm font-semibold"
              : "bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-850"
          }`}
        >
          Todos
        </button>

        {/* Chip: Solo Clases (Modo Docencia) */}
        <button
          type="button"
          id="filter-chip-solo-clases"
          aria-pressed={isSoloClases}
          onClick={handleToggleSoloClases}
          className={`min-h-[44px] min-w-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 border flex items-center gap-2 select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            isSoloClases
              ? "bg-sky-500/20 text-sky-300 border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.2)] font-semibold"
              : "bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-850"
          }`}
        >
          <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
          <span>Solo Clases</span>
        </button>

        {/* Chip: Solo Tocatas (Modo DJ) */}
        <button
          type="button"
          id="filter-chip-dj"
          aria-pressed={isSoloTocatas}
          onClick={handleToggleSoloTocatas}
          className={`min-h-[44px] min-w-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 border flex items-center gap-2 select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f8995d] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            isSoloTocatas
              ? "bg-[#f8995d]/20 text-[#f8995d] border-[#f8995d] shadow-[0_0_12px_rgba(248,153,93,0.2)] font-semibold"
              : "bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-850"
          }`}
        >
          <Radio className="w-4 h-4 text-[#f8995d] shrink-0" />
          <span>Solo Tocatas</span>
        </button>

        {/* Separador visual sutil entre modos generales y academias */}
        <div className="h-6 w-px bg-slate-800 shrink-0 mx-0.5" />

        {/* Chip: ALMA */}
        <button
          type="button"
          id="filter-chip-alma"
          aria-pressed={!isTodos && selectedFilters.includes("alma")}
          onClick={() => handleToggleCategory("alma")}
          style={
            !isTodos && selectedFilters.includes("alma") && !isSoloClases
              ? {
                  backgroundColor: "rgba(159, 198, 231, 0.16)",
                  borderColor: "#9fc6e7",
                  color: "#9fc6e7",
                }
              : undefined
          }
          className={`min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 border flex items-center gap-2.5 select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9fc6e7] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            !isTodos && selectedFilters.includes("alma") && !isSoloClases
              ? "shadow-[0_0_12px_rgba(159,198,231,0.15)] font-semibold"
              : "bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-850"
          }`}
        >
          <span
            style={{
              backgroundColor:
                !isTodos && selectedFilters.includes("alma") ? "#9fc6e7" : "#64748b",
            }}
            className="w-2 h-2 rounded-full transition-colors shrink-0"
          />
          ALMA
        </button>

        {/* Chip: La Escalera */}
        <button
          type="button"
          id="filter-chip-escalera"
          aria-pressed={!isTodos && selectedFilters.includes("escalera")}
          onClick={() => handleToggleCategory("escalera")}
          style={
            !isTodos && selectedFilters.includes("escalera") && !isSoloClases
              ? {
                  backgroundColor: "rgba(167, 220, 158, 0.16)",
                  borderColor: "#a7dc9e",
                  color: "#a7dc9e",
                }
              : undefined
          }
          className={`min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 border flex items-center gap-2.5 select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a7dc9e] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            !isTodos && selectedFilters.includes("escalera") && !isSoloClases
              ? "shadow-[0_0_12px_rgba(167,220,158,0.15)] font-semibold"
              : "bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-850"
          }`}
        >
          <span
            style={{
              backgroundColor:
                !isTodos && selectedFilters.includes("escalera") ? "#a7dc9e" : "#64748b",
            }}
            className="w-2 h-2 rounded-full transition-colors shrink-0"
          />
          La Escalera
        </button>
      </div>

      {/* SECCIÓN A: Esta semana (desde ahora hasta domingo 23:59 local) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Esta semana
          </h2>
          <span className="text-xs text-slate-500 font-medium">
            Hasta dom. {endOfWeekDateFormatted}
          </span>
        </div>

        {loadingData ? (
          <AgendaListSkeleton count={2} />
        ) : estaSemanaRaw.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">No tienes actividades programadas para lo que queda de semana.</p>
          </div>
        ) : estaSemana.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">No hay actividades de los filtros seleccionados esta semana.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {estaSemana.map((act) => (
              <CommitmentCard
                key={act.id}
                actividad={act}
                showDate={true}
                onClick={() => handleCardClick(act)}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECCIÓN B: Próximas fechas (lunes siguiente hasta +30 días) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Próximas fechas
          </h2>
          <span className="text-xs text-slate-500 font-medium">
            Próximos 30 días
          </span>
        </div>

        {loadingData ? (
          <AgendaListSkeleton count={2} />
        ) : proximasFechasRaw.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">No tienes compromisos en las próximas semanas.</p>
          </div>
        ) : proximasFechas.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">No hay actividades de los filtros seleccionados en las próximas semanas.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {proximasFechas.map((act) => (
              <CommitmentCard
                key={act.id}
                actividad={act}
                showDate={true}
                onClick={() => handleCardClick(act)}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECCIÓN C: Más adelante (> 30 días) */}
      {masAdelanteRaw.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              Más adelante
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              A más de 30 días ({masAdelante.length})
            </span>
          </div>

          {masAdelante.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
              <p className="text-xs text-slate-400">No hay actividades con los filtros actuales para más adelante.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {(showAllMasAdelante ? masAdelante : masAdelante.slice(0, 5)).map((act) => (
                <CommitmentCard
                  key={act.id}
                  actividad={act}
                  showDate={true}
                  onClick={() => handleCardClick(act)}
                />
              ))}

              {masAdelante.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllMasAdelante(!showAllMasAdelante)}
                  className="w-full py-2 px-3 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900/50 hover:bg-slate-900 border border-slate-800/80 rounded-xl transition-colors text-center"
                >
                  {showAllMasAdelante
                    ? "Mostrar menos"
                    : `Ver todas las actividades futuras (${masAdelante.length})`}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* SECCIÓN D: Historial (actividades pasadas, canceladas o realizadas) */}
      <section className="pt-2 border-t border-slate-800/80">
        <button
          type="button"
          id="btn-toggle-historial"
          onClick={() => setShowHistorial(!showHistorial)}
          className="w-full flex items-center justify-between p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 rounded-2xl text-left transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-slate-600 group-hover:bg-slate-400 transition-colors" />
            <span className="text-sm font-bold text-slate-300 group-hover:text-slate-100">
              Historial de actividades
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
              {historial.length}
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-transform ${
              showHistorial ? "rotate-180" : ""
            }`}
          />
        </button>

        {showHistorial && (
          <div className="mt-3 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
            {historial.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/60 text-center">
                <p className="text-xs text-slate-400">
                  {historialRaw.length === 0
                    ? "No hay actividades en el historial."
                    : "No hay actividades pasadas que coincidan con los filtros seleccionados."}
                </p>
              </div>
            ) : (
              <>
                {(showAllHistorial ? historial : historial.slice(0, 10)).map((act) => (
                  <div key={act.id} className="opacity-75 hover:opacity-100 transition-opacity">
                    <CommitmentCard
                      actividad={act}
                      showDate={true}
                      onClick={() => handleCardClick(act)}
                    />
                  </div>
                ))}

                {historial.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllHistorial(!showAllHistorial)}
                    className="w-full py-2 px-3 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900/50 hover:bg-slate-900 border border-slate-800/80 rounded-xl transition-colors text-center"
                  >
                    {showAllHistorial
                      ? "Mostrar menos anteriores"
                      : `Ver más anteriores (${historial.length - 10} más)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
