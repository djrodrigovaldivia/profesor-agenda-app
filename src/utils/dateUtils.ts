/**
 * Date and utility functions for Profesor Agenda
 * Strict local date handling without timezone offset shifts
 */

export function getISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseISODate(iso: string): Date {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return new Date();
  }
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const DIAS_SEMANA = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

const DIAS_SEMANA_CORTOS = [
  "Dom",
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
];

export function formatFechaCorta(iso: string): string {
  const date = parseISODate(iso);
  const diaSemana = DIAS_SEMANA_CORTOS[date.getDay()];
  const diaNum = date.getDate();
  const mesCorto = MESES_CORTOS[date.getMonth()];
  return `${diaSemana} ${diaNum} ${mesCorto}`;
}

export function formatFechaLarga(iso: string): string {
  const date = parseISODate(iso);
  const diaSemana = DIAS_SEMANA[date.getDay()];
  const diaNum = date.getDate();
  const mes = MESES[date.getMonth()];
  const anio = date.getFullYear();
  return `${diaSemana}, ${diaNum} de ${mes} de ${anio}`;
}

export function formatFechaDiaYMes(iso: string): string {
  const date = parseISODate(iso);
  const diaSemana = DIAS_SEMANA[date.getDay()];
  const diaNum = date.getDate();
  const mes = MESES[date.getMonth()];
  return `${diaSemana}, ${diaNum} de ${mes}`;
}

export function formatTimeRange(inicio: string, fin: string): string {
  if (!inicio && !fin) return "";
  if (!fin) return inicio;
  if (!inicio) return fin;

  // Convert HH:mm to minutes for comparison
  const [h1, m1] = inicio.split(":").map(Number);
  const [h2, m2] = fin.split(":").map(Number);
  const min1 = (isNaN(h1) ? 0 : h1) * 60 + (isNaN(m1) ? 0 : m1);
  const min2 = (isNaN(h2) ? 0 : h2) * 60 + (isNaN(m2) ? 0 : m2);

  if (min2 <= min1) {
    return `${inicio} → ${fin} (+1)`;
  }
  return `${inicio} → ${fin}`;
}

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 9);
}

export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Parses local date YYYY-MM-DD and time HH:mm into a Date object without UTC offset shifts.
 * Guaranteed never to use new Date("YYYY-MM-DD").
 */
export function parseDateTimeLocal(
  fecha: string,
  hora: string = "00:00"
): Date | null {
  if (!fecha) return null;
  const parts = fecha.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [year, month, day] = parts;

  const timeParts = (hora || "00:00").split(":").map(Number);
  const hour = isNaN(timeParts[0]) ? 0 : timeParts[0];
  const min = isNaN(timeParts[1]) ? 0 : timeParts[1];

  return new Date(year, month - 1, day, hour, min, 0, 0);
}

/**
 * Calculates the exact end DateTime of an activity.
 * Properly accounts for activities crossing midnight (e.g. 23:00 to 03:00) by adding 1 day.
 */
export function getActivityEndDateTime(
  fecha: string,
  horaInicio: string,
  horaFin?: string
): Date | null {
  const start = parseDateTimeLocal(fecha, horaInicio);
  if (!start) return null;

  if (!horaFin) {
    // Default 1 hour duration
    return new Date(start.getTime() + 60 * 60 * 1000);
  }

  const [h1, m1] = (horaInicio || "00:00").split(":").map(Number);
  const [h2, m2] = (horaFin || "00:00").split(":").map(Number);
  const min1 = (isNaN(h1) ? 0 : h1) * 60 + (isNaN(m1) ? 0 : m1);
  const min2 = (isNaN(h2) ? 0 : h2) * 60 + (isNaN(m2) ? 0 : m2);

  const end = parseDateTimeLocal(fecha, horaFin);
  if (!end) return null;

  if (min2 <= min1) {
    // Crosses midnight! Add 1 day
    end.setDate(end.getDate() + 1);
  }

  return end;
}

/**
 * Checks if an activity's start time has arrived or passed
 */
export function hasActivityStarted(
  fecha: string,
  horaInicio: string,
  now: Date = new Date()
): boolean {
  const start = parseDateTimeLocal(fecha, horaInicio);
  if (!start) return false;
  return now.getTime() >= start.getTime();
}

/**
 * Checks if an activity's end time has arrived or passed
 */
export function hasActivityEnded(
  fecha: string,
  horaInicio: string,
  horaFin?: string,
  now: Date = new Date()
): boolean {
  const end = getActivityEndDateTime(fecha, horaInicio, horaFin);
  if (!end) return false;
  return now.getTime() >= end.getTime();
}

/**
 * Formats a Date object into human-readable local date and time string
 */
export function formatFechaHora(d: Date): string {
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${anio} a las ${hh}:${mm} hrs`;
}

/**
 * Cleans expired notification delivery timestamps from localStorage safely.
 * Only purges notification tracking keys older than 7 days, never actual data.
 */
export function cleanExpiredAlertStorage(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("profesor_agenda_push_") ||
        key.startsWith("clase_local_reminder_")
      ) {
        const val = localStorage.getItem(key);
        if (val && (val === "expired" || val === "missed_alerted" || val === "delivered")) {
          // Keep delivered/missed markers unless class date encoded in key is > 7 days old
          const match = key.match(/(\d{4}-\d{2}-\d{2})/);
          if (match && match[1]) {
            const parsed = parseDateTimeLocal(match[1]);
            if (parsed && parsed.getTime() < oneWeekAgo) {
              keysToRemove.push(key);
            }
          }
        }
      }
    }

    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Non-blocking
  }
}

/**
 * Returns the Date representing the end of the week (Sunday at 23:59:59.999 local time)
 * based on the provided reference date. Strictly uses local time components.
 */
export function getEndOfWeekDate(refDate: Date = new Date()): Date {
  const dayOfWeek = refDate.getDay(); // 0 is Sunday, 1..6 is Mon..Sat
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  return new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate() + daysUntilSunday,
    23,
    59,
    59,
    999
  );
}

/**
 * Returns the Date representing the end of a window N days from the reference date (at 23:59:59.999 local time).
 */
export function getEndOfRangeDate(days: number, refDate: Date = new Date()): Date {
  return new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate() + days,
    23,
    59,
    59,
    999
  );
}

export type ActivityTemporalSegment =
  | "historial"
  | "esta_semana"
  | "proximas_fechas"
  | "mas_adelante";

/**
 * Determines the temporal segment of an activity for the chronological agenda:
 * - 'historial': if canceled, completed, or its real end time has arrived/passed (including midnight-crossing)
 * - 'esta_semana': from now until Sunday 23:59:59.999 local time
 * - 'proximas_fechas': from Monday of next week up to 30 days from now
 * - 'mas_adelante': scheduled beyond 30 days
 */
export function getActivityTemporalSegment(
  fecha: string,
  horaInicio: string,
  horaFin?: string,
  estado?: string,
  cancelada?: boolean,
  now: Date = new Date()
): ActivityTemporalSegment {
  if (cancelada || estado === "cancelada" || estado === "realizada") {
    return "historial";
  }

  // Uses getActivityEndDateTime to accurately respect midnight-crossing tocatas (e.g. 22:00 to 02:00)
  if (hasActivityEnded(fecha, horaInicio, horaFin, now)) {
    return "historial";
  }

  const startDate = parseDateTimeLocal(fecha, horaInicio);
  if (!startDate) {
    return "historial";
  }

  const startMs = startDate.getTime();
  const endOfWeekMs = getEndOfWeekDate(now).getTime();
  const endOf30DaysMs = getEndOfRangeDate(30, now).getTime();

  if (startMs <= endOfWeekMs) {
    return "esta_semana";
  }
  if (startMs <= endOf30DaysMs) {
    return "proximas_fechas";
  }
  return "mas_adelante";
}
