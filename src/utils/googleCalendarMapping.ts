import type { Clase, Tocata } from "../types";

export const GOOGLE_CALENDAR_TIME_ZONE = "America/Santiago" as const;

export interface GoogleCalendarDateTime {
  dateTime: string;
  timeZone: typeof GOOGLE_CALENDAR_TIME_ZONE;
}

export interface GoogleCalendarReminder {
  method: "popup";
  minutes: number;
}

export interface GoogleCalendarEventPayload {
  summary: string;
  description: string;
  start: GoogleCalendarDateTime;
  end: GoogleCalendarDateTime;
  location?: string;
  extendedProperties: {
    private: {
      sourceApp: "profesor-agenda";
      sourceType: "clase" | "tocata";
      sourceKey: string;
      sourceRevision: string;
      mappingVersion: "1";
    };
  };
  reminders: {
    useDefault: false;
    overrides: GoogleCalendarReminder[];
  };
}

export interface GoogleCalendarMappingResult {
  event: GoogleCalendarEventPayload;
  requiresEndConfirmation: boolean;
  requiresAmbiguousTimeConfirmation: boolean;
  ambiguousTimeDetails: GoogleCalendarAmbiguousTimeDetails[];
}

export interface GoogleCalendarAmbiguousTimeDetails {
  boundary: "start" | "end";
  localDateTime: string;
  timeZone: typeof GOOGLE_CALENDAR_TIME_ZONE;
  proposedDateTime: string;
  alternativeDateTimes: string[];
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const zonedFormatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
  timeZone: GOOGLE_CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Offset accuracy follows the IANA time-zone data bundled with the JavaScript runtime.

function parseDate(value: string): Pick<LocalDateTimeParts, "year" | "month" | "day"> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Fecha inválida: "${value}". Usa YYYY-MM-DD.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Fecha inválida: "${value}" no existe.`);
  }
  return { year, month, day };
}

function parseTime(value: string): Pick<LocalDateTimeParts, "hour" | "minute"> {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Hora inválida: "${value}". Usa HH:mm.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Hora inválida: "${value}" no existe.`);
  }
  return { hour, minute };
}

function addCivilDay(date: string): string {
  const { year, month, day } = parseDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${String(
    next.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function getZonedParts(instantMs: number): LocalDateTimeParts {
  const values: Record<string, number> = {};
  for (const part of zonedFormatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function getOffsetMinutes(instantMs: number): number {
  const parts = getZonedParts(instantMs);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return Math.round((wallClockAsUtc - instantMs) / 60_000);
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(
    absolute % 60,
  ).padStart(2, "0")}`;
}

interface ZonedDateTimeResolution {
  value: GoogleCalendarDateTime;
  alternativeDateTimes: string[];
}

function toZonedDateTime(date: string, time: string): ZonedDateTimeResolution {
  const target = { ...parseDate(date), ...parseTime(time) };
  const wallClockAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(getOffsetMinutes(wallClockAsUtc + hours * 60 * 60 * 1000));
  }

  const matches = [...offsets]
    .map((offset) => ({ offset, instant: wallClockAsUtc - offset * 60_000 }))
    .filter(({ instant }) => sameParts(getZonedParts(instant), target))
    .sort((a, b) => a.instant - b.instant);

  if (matches.length === 0) {
    throw new Error(
      `Fecha u hora inválida en ${GOOGLE_CALENDAR_TIME_ZONE}: ${date} ${time}.`,
    );
  }

  const selected = matches[0];
  const toDateTime = (offset: number) =>
    `${date}T${time}:00${formatOffset(offset)}`;
  return {
    value: {
      dateTime: toDateTime(selected.offset),
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    },
    alternativeDateTimes: matches.slice(1).map(({ offset }) => toDateTime(offset)),
  };
}

function createSourceKey(sourceType: "clase" | "tocata", id: string): string {
  const input = `${sourceType}:${id}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pa_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getRevision(entity: Clase | Tocata): string {
  const revision = entity.googleCalendar?.revision ?? 0;
  return String(Math.max(0, Math.trunc(revision)));
}

function createReminders(cancelled: boolean): GoogleCalendarEventPayload["reminders"] {
  return {
    useDefault: false,
    overrides: cancelled
      ? []
      : [
          { method: "popup", minutes: 1440 }, // 24 horas antes
          { method: "popup", minutes: 120 },  // 2 horas antes
          { method: "popup", minutes: 30 },   // 30 minutos antes
        ],
  };
}

function createDateRange(
  fecha: string,
  horaInicio: string,
  horaFin: string,
): Pick<
  GoogleCalendarMappingResult,
  | "requiresEndConfirmation"
  | "requiresAmbiguousTimeConfirmation"
  | "ambiguousTimeDetails"
> & {
  start: GoogleCalendarDateTime;
  end: GoogleCalendarDateTime;
} {
  const startTime = parseTime(horaInicio);
  const endTime = parseTime(horaFin);
  parseDate(fecha);
  const startMinutes = startTime.hour * 60 + startTime.minute;
  const endMinutes = endTime.hour * 60 + endTime.minute;
  const crossesMidnight = endMinutes <= startMinutes;
  const endDate = crossesMidnight ? addCivilDay(fecha) : fecha;
  const start = toZonedDateTime(fecha, horaInicio);
  const end = toZonedDateTime(endDate, horaFin);
  const ambiguousTimeDetails: GoogleCalendarAmbiguousTimeDetails[] = [];

  if (start.alternativeDateTimes.length > 0) {
    ambiguousTimeDetails.push({
      boundary: "start",
      localDateTime: `${fecha}T${horaInicio}:00`,
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
      proposedDateTime: start.value.dateTime,
      alternativeDateTimes: start.alternativeDateTimes,
    });
  }
  if (end.alternativeDateTimes.length > 0) {
    ambiguousTimeDetails.push({
      boundary: "end",
      localDateTime: `${endDate}T${horaFin}:00`,
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
      proposedDateTime: end.value.dateTime,
      alternativeDateTimes: end.alternativeDateTimes,
    });
  }

  return {
    start: start.value,
    end: end.value,
    requiresEndConfirmation: endMinutes === startMinutes,
    requiresAmbiguousTimeConfirmation: ambiguousTimeDetails.length > 0,
    ambiguousTimeDetails,
  };
}

function createPrivateProperties(
  sourceType: "clase" | "tocata",
  entity: Clase | Tocata,
): GoogleCalendarEventPayload["extendedProperties"] {
  if (!entity.id.trim()) throw new Error("El identificador local del evento es obligatorio.");
  return {
    private: {
      sourceApp: "profesor-agenda",
      sourceType,
      sourceKey: createSourceKey(sourceType, entity.id),
      sourceRevision: getRevision(entity),
      mappingVersion: "1",
    },
  };
}

function joinUniqueLocationParts(parts: Array<string | undefined>): string | undefined {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const normalized = value.toLocaleLowerCase("es-CL");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(value);
    }
  }
  return unique.length > 0 ? unique.join(", ") : undefined;
}

export function mapClaseToGoogleCalendarEvent(
  clase: Clase,
): GoogleCalendarMappingResult {
  const range = createDateRange(clase.fecha, clase.horaInicio, clase.horaFin);
  return {
    event: {
      summary: `Clase · ${clase.tipo}`,
      description: `Origen: Profesor Agenda\nEstado: ${clase.estado}`,
      start: range.start,
      end: range.end,
      extendedProperties: createPrivateProperties("clase", clase),
      reminders: createReminders(clase.estado === "cancelada"),
    },
    requiresEndConfirmation: range.requiresEndConfirmation,
    requiresAmbiguousTimeConfirmation:
      range.requiresAmbiguousTimeConfirmation,
    ambiguousTimeDetails: range.ambiguousTimeDetails,
  };
}

export function mapTocataToGoogleCalendarEvent(
  tocata: Tocata,
): GoogleCalendarMappingResult {
  const range = createDateRange(tocata.fecha, tocata.horaInicio, tocata.horaFin);
  const project = String(tocata.proyecto ?? "").trim();
  const location = joinUniqueLocationParts([
    tocata.lugar,
    tocata.direccion,
    tocata.ciudad,
  ]);
  const event: GoogleCalendarEventPayload = {
    summary: project ? `${tocata.titulo} · ${project}` : tocata.titulo,
    description: `Origen: Profesor Agenda\nEstado: ${tocata.estado}`,
    start: range.start,
    end: range.end,
    extendedProperties: createPrivateProperties("tocata", tocata),
    reminders: createReminders(tocata.estado === "cancelada"),
  };
  if (location) event.location = location;

  return {
    event,
    requiresEndConfirmation: range.requiresEndConfirmation,
    requiresAmbiguousTimeConfirmation:
      range.requiresAmbiguousTimeConfirmation,
    ambiguousTimeDetails: range.ambiguousTimeDetails,
  };
}

