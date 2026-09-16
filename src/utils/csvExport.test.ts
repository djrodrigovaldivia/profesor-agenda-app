import { test } from "node:test";
import assert from "node:assert/strict";
import { generateContableCSV } from "./csvExport.js";
import { Clase, Tocata, Alumno } from "../types.js";

test("generateContableCSV: generates valid Excel-ready CSV with UTF-8 BOM and semicolon delimiters", () => {
  const alumnos: Alumno[] = [
    {
      id: "alm-1",
      nombre: "Carlos",
      apellido: "Santana",
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
      fecha: "2026-09-10",
      horaInicio: "10:00",
      horaFin: "11:00",
      tema: "Beatmatching",
      notas: "Buen progreso",
      estado: "realizada",
      createdAt: "",
      updatedAt: "",
    },
  ];

  const tocatas: Tocata[] = [
    {
      id: "toc-1",
      titulo: "Club Subterráneo",
      proyecto: "Rodrigo Valdivia",
      fecha: "2026-09-12",
      horaInicio: "23:00",
      horaFin: "03:00",
      lugar: "Club Subterráneo",
      ciudad: "Santiago",
      honorarios: 250000,
      estado: "confirmada",
      createdAt: "",
      updatedAt: "",
    },
  ];

  const csv = generateContableCSV({ clases, tocatas, alumnos });

  // Has BOM
  assert.equal(csv.startsWith("\uFEFF"), true);

  // Contains headers
  assert.equal(csv.includes('"Fecha";"Tipo";"Categoría"'), true);

  // Contains Carlos Santana
  assert.equal(csv.includes("Carlos Santana"), true);

  // Contains Tocata & Honorarios
  assert.equal(csv.includes("Club Subterráneo"), true);
  assert.equal(csv.includes("250000"), true);
  assert.equal(csv.includes("confirmada"), true);
});
