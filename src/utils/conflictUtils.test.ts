import { test } from "node:test";
import assert from "node:assert/strict";
import { doIntervalsOverlap, detectScheduleConflict } from "./conflictUtils.js";
import { Clase, Tocata, Alumno } from "../types.js";

test("doIntervalsOverlap: detects direct collisions correctly", () => {
  // [18:00, 19:00) vs [18:30, 19:30) -> overlap
  assert.equal(doIntervalsOverlap("18:00", "19:00", "18:30", "19:30"), true);

  // [18:00, 19:00) vs [19:00, 20:00) -> adjacent, no overlap
  assert.equal(doIntervalsOverlap("18:00", "19:00", "19:00", "20:00"), false);

  // [17:00, 18:00) vs [19:00, 20:00) -> separate, no overlap
  assert.equal(doIntervalsOverlap("17:00", "18:00", "19:00", "20:00"), false);

  // [18:00, 20:00) completely contains [18:30, 19:30)
  assert.equal(doIntervalsOverlap("18:00", "20:00", "18:30", "19:30"), true);
});

test("doIntervalsOverlap: handles past-midnight intervals", () => {
  // [22:00, 02:00) vs [23:00, 03:00) -> both start same evening and cross midnight -> overlap
  assert.equal(doIntervalsOverlap("22:00", "02:00", "23:00", "03:00"), true);

  // [20:00, 22:00) vs [22:00, 02:00) -> adjacent, no overlap
  assert.equal(doIntervalsOverlap("20:00", "22:00", "22:00", "02:00"), false);
});

test("detectScheduleConflict: identifies collision with an existing class", () => {
  const alumnos: Alumno[] = [
    {
      id: "alm-1",
      nombre: "Martín",
      apellido: "López",
      activo: true,
      createdAt: "",
      updatedAt: "",
    },
  ];

  const clases: Clase[] = [
    {
      id: "cls-1",
      alumnoId: "alm-1",
      tipo: "alma",
      fecha: "2026-09-20",
      horaInicio: "17:30",
      horaFin: "18:30",
      tema: "Mezcla",
      estado: "programada",
      createdAt: "",
      updatedAt: "",
    },
  ];

  const tocatas: Tocata[] = [];

  const conflict = detectScheduleConflict({
    fecha: "2026-09-20",
    horaInicio: "18:00",
    horaFin: "19:00",
    clases,
    tocatas,
    alumnos,
  });

  assert.notEqual(conflict, null);
  assert.equal(conflict?.tipo, "clase");
  assert.equal(conflict?.nombre, "Martín López");
  assert.equal(conflict?.horaInicio, "17:30");
  assert.equal(conflict?.horaFin, "18:30");
});

test("detectScheduleConflict: ignores cancelled classes and excluded event ID", () => {
  const alumnos: Alumno[] = [
    {
      id: "alm-1",
      nombre: "Martín",
      activo: true,
      createdAt: "",
      updatedAt: "",
    },
  ];

  const clases: Clase[] = [
    {
      id: "cls-1",
      alumnoId: "alm-1",
      tipo: "alma",
      fecha: "2026-09-20",
      horaInicio: "17:30",
      horaFin: "18:30",
      tema: "Mezcla",
      estado: "cancelada",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "cls-2",
      alumnoId: "alm-1",
      tipo: "alma",
      fecha: "2026-09-20",
      horaInicio: "19:00",
      horaFin: "20:00",
      tema: "Mezcla",
      estado: "programada",
      createdAt: "",
      updatedAt: "",
    },
  ];

  // Conflict with cls-1 is ignored because it's cancelled
  const conflict1 = detectScheduleConflict({
    fecha: "2026-09-20",
    horaInicio: "18:00",
    horaFin: "19:00",
    clases,
    tocatas: [],
    alumnos,
  });
  assert.equal(conflict1, null);

  // Editing cls-2 does not self-collide
  const conflictSelf = detectScheduleConflict({
    fecha: "2026-09-20",
    horaInicio: "19:15",
    horaFin: "20:15",
    excludeEventId: "cls-2",
    clases,
    tocatas: [],
    alumnos,
  });
  assert.equal(conflictSelf, null);
});
