import assert from "node:assert/strict";
import test from "node:test";
import type { Clase, Tocata } from "../types";
import {
  GOOGLE_CALENDAR_TIME_ZONE,
  mapClaseToGoogleCalendarEvent,
  mapTocataToGoogleCalendarEvent,
} from "./googleCalendarMapping";

const baseClase: Clase = {
  id: "clase-privada-123",
  alumnoId: "alumno-secreto",
  tipo: "alma",
  fecha: "2026-09-15",
  horaInicio: "18:00",
  horaFin: "19:30",
  tema: "Tema privado",
  notas: "Notas privadas",
  estado: "programada",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const baseTocata: Tocata = {
  id: "tocata-privada-456",
  titulo: "Club Central",
  fecha: "2026-09-18",
  horaInicio: "22:00",
  horaFin: "23:30",
  proyecto: "Sokolov",
  lugar: "Club Central",
  direccion: "Calle Uno 123",
  ciudad: "Santiago",
  contacto: "Contacto secreto",
  honorarios: 999999,
  notas: "Notas privadas de tocata",
  estado: "confirmada",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

test("mapea una clase normal con privacidad y dos recordatorios", () => {
  const result = mapClaseToGoogleCalendarEvent(baseClase);
  assert.equal(result.event.summary, "Clase · alma");
  assert.equal(result.event.start.timeZone, GOOGLE_CALENDAR_TIME_ZONE);
  assert.equal(result.event.end.timeZone, GOOGLE_CALENDAR_TIME_ZONE);
  assert.match(result.event.start.dateTime, /^2026-09-15T18:00:00-0[34]:00$/);
  assert.equal(result.event.location, undefined);
  assert.deepEqual(result.event.reminders.overrides, [
    { method: "popup", minutes: 1440 },
    { method: "popup", minutes: 120 },
    { method: "popup", minutes: 30 },
  ]);
  assert.equal(result.event.extendedProperties.private.sourceType, "clase");
  assert.notEqual(result.event.extendedProperties.private.sourceKey, baseClase.id);
});

test("mapea una tocata, deduplica ubicación y excluye datos sensibles", () => {
  const result = mapTocataToGoogleCalendarEvent({
    ...baseTocata,
    ciudad: "club central",
  });
  assert.equal(result.event.summary, "Club Central · Sokolov");
  assert.equal(result.event.location, "Club Central, Calle Uno 123");
  const exported = JSON.stringify(result.event);
  for (const secret of [
    baseTocata.contacto!,
    String(baseTocata.honorarios),
    baseTocata.notas!,
  ]) {
    assert.equal(exported.includes(secret), false);
  }
});

test("mueve el término al día siguiente si es menor al inicio", () => {
  const result = mapTocataToGoogleCalendarEvent({
    ...baseTocata,
    horaInicio: "23:00",
    horaFin: "03:00",
  });
  assert.match(result.event.end.dateTime, /^2026-09-19T03:00:00-0[34]:00$/);
  assert.equal(result.requiresEndConfirmation, false);
});

test("marca confirmación cuando inicio y término son iguales", () => {
  const result = mapClaseToGoogleCalendarEvent({
    ...baseClase,
    horaInicio: "18:00",
    horaFin: "18:00",
  });
  assert.match(result.event.end.dateTime, /^2026-09-16T18:00:00-0[34]:00$/);
  assert.equal(result.requiresEndConfirmation, true);
});

test("elimina recordatorios de eventos cancelados", () => {
  const result = mapClaseToGoogleCalendarEvent({
    ...baseClase,
    estado: "cancelada",
  });
  assert.deepEqual(result.event.reminders, { useDefault: false, overrides: [] });
});

test("rechaza fechas y horas inválidas con errores claros", () => {
  assert.throws(
    () => mapClaseToGoogleCalendarEvent({ ...baseClase, fecha: "2026-02-30" }),
    /Fecha inválida/,
  );
  assert.throws(
    () => mapClaseToGoogleCalendarEvent({ ...baseClase, horaInicio: "25:00" }),
    /Hora inválida/,
  );
});

test("no filtra notas, alumno, contacto ni honorarios a ningún campo", () => {
  const clasePayload = JSON.stringify(mapClaseToGoogleCalendarEvent(baseClase).event);
  const tocataPayload = JSON.stringify(mapTocataToGoogleCalendarEvent(baseTocata).event);

  for (const secret of [baseClase.notas!, baseClase.alumnoId, baseClase.tema]) {
    assert.equal(clasePayload.includes(secret), false);
  }
  for (const secret of [
    baseTocata.notas!,
    baseTocata.contacto!,
    String(baseTocata.honorarios),
  ]) {
    assert.equal(tocataPayload.includes(secret), false);
  }
});

test("usa offsets IANA correctos en verano e invierno de Santiago", () => {
  const summer = mapClaseToGoogleCalendarEvent({
    ...baseClase,
    fecha: "2026-01-15",
    horaInicio: "10:00",
    horaFin: "11:00",
  });
  const winter = mapClaseToGoogleCalendarEvent({
    ...baseClase,
    fecha: "2026-07-15",
    horaInicio: "10:00",
    horaFin: "11:00",
  });

  assert.equal(summer.event.start.dateTime, "2026-01-15T10:00:00-03:00");
  assert.equal(summer.event.end.dateTime, "2026-01-15T11:00:00-03:00");
  assert.equal(winter.event.start.dateTime, "2026-07-15T10:00:00-04:00");
  assert.equal(winter.event.end.dateTime, "2026-07-15T11:00:00-04:00");
});

test("aplica ambos offsets al atravesar el retroceso horario real", () => {
  const result = mapTocataToGoogleCalendarEvent({
    ...baseTocata,
    fecha: "2026-04-04",
    horaInicio: "22:30",
    horaFin: "00:30",
  });

  assert.equal(result.event.start.dateTime, "2026-04-04T22:30:00-03:00");
  assert.equal(result.event.end.dateTime, "2026-04-05T00:30:00-04:00");
  assert.equal(result.requiresAmbiguousTimeConfirmation, false);
});

test("rechaza una hora inexistente durante el adelanto horario real", () => {
  assert.throws(
    () =>
      mapClaseToGoogleCalendarEvent({
        ...baseClase,
        fecha: "2026-09-06",
        horaInicio: "00:30",
        horaFin: "02:00",
      }),
    /Fecha u hora inválida en America\/Santiago: 2026-09-06 00:30/,
  );
});

test("señala una hora ambigua, propone la primera ocurrencia y conserva ambas confirmaciones", () => {
  const result = mapClaseToGoogleCalendarEvent({
    ...baseClase,
    fecha: "2026-04-04",
    horaInicio: "23:30",
    horaFin: "23:30",
  });

  assert.equal(result.requiresEndConfirmation, true);
  assert.equal(result.requiresAmbiguousTimeConfirmation, true);
  assert.deepEqual(result.ambiguousTimeDetails, [
    {
      boundary: "start",
      localDateTime: "2026-04-04T23:30:00",
      timeZone: "America/Santiago",
      proposedDateTime: "2026-04-04T23:30:00-03:00",
      alternativeDateTimes: ["2026-04-04T23:30:00-04:00"],
    },
  ]);
  assert.equal(result.event.start.dateTime, "2026-04-04T23:30:00-03:00");
});

test("cruza medianoche al cambiar de mes", () => {
  const result = mapTocataToGoogleCalendarEvent({
    ...baseTocata,
    fecha: "2026-06-30",
    horaInicio: "23:00",
    horaFin: "01:00",
  });
  assert.equal(result.event.end.dateTime, "2026-07-01T01:00:00-04:00");
});

test("cruza medianoche al cambiar de año", () => {
  const result = mapTocataToGoogleCalendarEvent({
    ...baseTocata,
    fecha: "2026-12-31",
    horaInicio: "23:00",
    horaFin: "01:00",
  });
  assert.equal(result.event.end.dateTime, "2027-01-01T01:00:00-03:00");
});

