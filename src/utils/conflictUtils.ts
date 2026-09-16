import { Clase, Tocata, Alumno } from "../types";

export interface ScheduleConflict {
  tipo: "clase" | "tocata";
  nombre: string;
  horaInicio: string;
  horaFin: string;
  detalle?: string;
}

/**
 * Evaluates whether two intervals [startA, endA) and [startB, endB) overlap.
 * Format: "HH:MM" (24-hour).
 * Handles past-midnight intervals if end <= start (adds 24 hours / 1440 min).
 */
export function doIntervalsOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  if (!startA || !endA || !startB || !endB) return false;

  const toMinutes = (time: string): number => {
    const parts = time.split(":").map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    return h * 60 + m;
  };

  const minStartA = toMinutes(startA);
  let minEndA = toMinutes(endA);
  const minStartB = toMinutes(startB);
  let minEndB = toMinutes(endB);

  // If end is <= start, the event crosses midnight
  if (minEndA <= minStartA) minEndA += 1440;
  if (minEndB <= minStartB) minEndB += 1440;

  // Standard interval overlap condition: startA < endB && startB < endA
  return minStartA < minEndB && minStartB < minEndA;
}

/**
 * Searches for any active (non-cancelled) class or tocata that overlaps on the given date.
 * Excludes the event currently being edited via excludeEventId.
 */
export function detectScheduleConflict(params: {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  excludeEventId?: string;
  clases: Clase[];
  tocatas: Tocata[];
  alumnos: Alumno[];
}): ScheduleConflict | null {
  const { fecha, horaInicio, horaFin, excludeEventId, clases, tocatas, alumnos } = params;

  if (!fecha || !horaInicio || !horaFin) return null;

  // 1. Check against active classes
  for (const c of clases) {
    if (excludeEventId && c.id === excludeEventId) continue;
    if (c.fecha !== fecha) continue;
    if (c.estado === "cancelada") continue;

    if (doIntervalsOverlap(horaInicio, horaFin, c.horaInicio, c.horaFin)) {
      const alumno = alumnos.find((a) => a.id === c.alumnoId);
      const nombreAlumno = alumno
        ? `${alumno.nombre}${alumno.apellido ? " " + alumno.apellido : ""}`.trim()
        : "Alumno";
      return {
        tipo: "clase",
        nombre: nombreAlumno,
        horaInicio: c.horaInicio,
        horaFin: c.horaFin,
        detalle: c.tema ? `Tema: ${c.tema}` : undefined,
      };
    }
  }

  // 2. Check against active tocatas
  for (const t of tocatas) {
    if (excludeEventId && t.id === excludeEventId) continue;
    if (t.fecha !== fecha) continue;
    if (t.estado === "cancelada") continue;

    if (doIntervalsOverlap(horaInicio, horaFin, t.horaInicio, t.horaFin)) {
      const nombreTocata = t.titulo || t.lugar || "Fecha DJ";
      return {
        tipo: "tocata",
        nombre: nombreTocata,
        horaInicio: t.horaInicio,
        horaFin: t.horaFin,
        detalle: t.lugar ? `Lugar: ${t.lugar}` : undefined,
      };
    }
  }

  return null;
}
