import React, { useState, useMemo } from "react";
import { ActividadUnificada, Clase, Tocata } from "../../types";
import { useAgenda } from "../../context/AgendaContext";
import { CommitmentCard } from "../agenda/CommitmentCard";
import {
  getISODate,
  parseISODate,
  formatFechaDiaYMes,
  formatFechaCorta,
} from "../../utils/dateUtils";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarPlus,
  Radio,
  Calendar as CalendarIcon,
  AlertCircle,
  X,
} from "lucide-react";

interface CalendarViewProps {
  onOpenNewClaseWithDate: (fecha: string) => void;
  onOpenNewTocataWithDate: (fecha: string) => void;
  onOpenClaseDetail: (clase: Clase) => void;
  onOpenTocataDetail: (tocata: Tocata) => void;
}

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DIAS_HEADER = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export const CalendarView: React.FC<CalendarViewProps> = ({
  onOpenNewClaseWithDate,
  onOpenNewTocataWithDate,
  onOpenClaseDetail,
  onOpenTocataDetail,
}) => {
  const { getAllActividades, clases, tocatas } = useAgenda();

  const [currentDate, setCurrentDate] = useState(() => new Date(2026, 8, 1));
  const [selectedDateIso, setSelectedDateIso] = useState(() => "2026-09-02");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const todayIso = getISODate(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleGoToToday = () => {
    const targetDate = new Date(2026, 8, 2);
    setCurrentDate(targetDate);
    setSelectedDateIso("2026-09-02");
  };

  // Group all activities by ISO date
  const allActividades = getAllActividades();
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, ActividadUnificada[]>();
    allActividades.forEach((act) => {
      const list = map.get(act.fecha) || [];
      list.push(act);
      map.set(act.fecha, list);
    });
    return map;
  }, [allActividades]);

  // Selected date activities
  const selectedDateActivities = useMemo(() => {
    return (activitiesByDate.get(selectedDateIso) || []).sort((a, b) =>
      a.horaInicio.localeCompare(b.horaInicio)
    );
  }, [activitiesByDate, selectedDateIso]);

  // Generate calendar days grid (Monday to Sunday)
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // In JS, getDay() returns 0 for Sunday, 1 for Monday...
    // We want Monday = 0, ..., Sunday = 6
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: {
      date: Date;
      iso: string;
      isCurrentMonth: boolean;
      dayNumber: number;
    }[] = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, d);
      days.push({
        date: prevDate,
        iso: getISODate(prevDate),
        isCurrentMonth: false,
        dayNumber: d,
      });
    }

    // Current month days
    for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
      const curDate = new Date(year, month, d);
      days.push({
        date: curDate,
        iso: getISODate(curDate),
        isCurrentMonth: true,
        dayNumber: d,
      });
    }

    // Next month padding to complete 35 or 42 cells
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      days.push({
        date: nextDate,
        iso: getISODate(nextDate),
        isCurrentMonth: false,
        dayNumber: d,
      });
    }

    return days;
  }, [year, month]);

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

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Error banner si una actividad no se encuentra */}
      {errorMessage && (
        <div
          role="alert"
          id="calendar-error-banner"
          className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-xs flex items-center justify-between gap-3 shadow-sm"
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

      {/* Calendar Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-sm space-y-4">
        {/* Month Navigation & Today Button */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg sm:text-xl font-bold text-slate-50 tracking-tight">
              {MESES[month]} {year}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              id="btn-calendario-hoy"
              onClick={handleGoToToday}
              className="px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
            >
              Hoy
            </button>
            <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                id="btn-mes-anterior"
                onClick={handlePrevMonth}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                id="btn-mes-siguiente"
                onClick={handleNextMonth}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Legend (Always visible) */}
        <div className="flex items-center justify-start gap-3 sm:gap-5 text-xs text-slate-400 py-1 border-y border-slate-800/80 overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              style={{ backgroundColor: "#9fc6e7" }}
              className="w-2.5 h-2.5 rounded-full shadow-[0_0_6px_rgba(159,198,231,0.5)]"
            />
            <span className="text-slate-300 font-medium">ALMA</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              style={{ backgroundColor: "#a7dc9e" }}
              className="w-2.5 h-2.5 rounded-full shadow-[0_0_6px_rgba(167,220,158,0.5)]"
            />
            <span className="text-slate-300 font-medium">La Escalera</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              style={{ backgroundColor: "#f8995d" }}
              className="w-2.5 h-2.5 rounded-full shadow-[0_0_6px_rgba(248,153,93,0.5)]"
            />
            <span className="text-slate-300 font-medium">Fecha DJ</span>
          </div>
        </div>

        {/* Days Header (Lun - Dom) */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
          {DIAS_HEADER.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            const isSelected = day.iso === selectedDateIso;
            const isToday = day.iso === todayIso;
            const acts = activitiesByDate.get(day.iso) || [];

            const hasAlma = acts.some((a) => a.categoria === "alma" && !a.cancelada);
            const hasEscalera = acts.some((a) => a.categoria === "escalera" && !a.cancelada);
            const hasDj = acts.some((a) => (a.categoria === "dj" || a.categoria === "tocata") && !a.cancelada);
            const hasCanceled = acts.some((a) => a.cancelada);

            return (
              <button
                key={day.iso}
                type="button"
                id={`cal-day-${day.iso}`}
                onClick={() => setSelectedDateIso(day.iso)}
                className={`min-h-[54px] sm:min-h-[64px] p-1.5 rounded-xl flex flex-col items-center justify-between transition-all duration-100 relative ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-400/40 z-10"
                    : isToday
                    ? "bg-slate-800/90 text-blue-400 border border-blue-500/40 font-bold"
                    : day.isCurrentMonth
                    ? "bg-slate-950/60 text-slate-200 hover:bg-slate-800/60 border border-slate-800/60"
                    : "bg-slate-950/20 text-slate-600 border border-transparent hover:bg-slate-800/30"
                }`}
              >
                <div className="flex items-center justify-between w-full px-0.5">
                  <span
                    className={`text-xs font-medium ${
                      isSelected
                        ? "text-white font-bold"
                        : isToday
                        ? "text-blue-400 font-bold"
                        : day.isCurrentMonth
                        ? "text-slate-300"
                        : "text-slate-600"
                    }`}
                  >
                    {day.dayNumber}
                  </span>

                  {acts.length > 1 && (
                    <span
                      className={`text-[10px] font-bold px-1 rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {acts.length}
                    </span>
                  )}
                </div>

                {/* Category Indicator Dots */}
                <div className="flex items-center justify-center gap-1 w-full pb-0.5">
                  {hasAlma && (
                    <span
                      style={{ backgroundColor: isSelected ? "#ffffff" : "#9fc6e7" }}
                      className="w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(159,198,231,0.6)]"
                      title="ALMA"
                    />
                  )}
                  {hasEscalera && (
                    <span
                      style={{ backgroundColor: isSelected ? "#ffffff" : "#a7dc9e" }}
                      className="w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(167,220,158,0.6)]"
                      title="La Escalera"
                    />
                  )}
                  {hasDj && (
                    <span
                      style={{ backgroundColor: isSelected ? "#ffffff" : "#f8995d" }}
                      className="w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(248,153,93,0.6)]"
                      title="Fecha DJ"
                    />
                  )}
                  {hasCanceled && !hasAlma && !hasEscalera && !hasDj && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? "bg-white/60" : "bg-slate-500"
                      }`}
                      title="Cancelada"
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Commitments Section */}
      <section className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Compromisos del {formatFechaDiaYMes(selectedDateIso)}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {selectedDateActivities.length}{" "}
              {selectedDateActivities.length === 1
                ? "actividad agendada"
                : "actividades agendadas"}
            </p>
          </div>

          {/* "+ Agregar para este día" with dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              id="btn-agregar-este-dia"
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-xl transition-all shadow-sm active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Agregar para este día</span>
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
                    id="menu-cal-nueva-clase"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      onOpenNewClaseWithDate(selectedDateIso);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                  >
                    <CalendarPlus className="w-4 h-4 text-blue-400" />
                    <span>Nueva clase</span>
                  </button>
                  <button
                    type="button"
                    id="menu-cal-nueva-tocata"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      onOpenNewTocataWithDate(selectedDateIso);
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

        {selectedDateActivities.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center space-y-2">
            <p className="text-xs text-slate-400">
              No tienes compromisos este día.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {selectedDateActivities.map((act) => (
              <CommitmentCard
                key={act.id}
                actividad={act}
                onClick={() => handleCardClick(act)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
