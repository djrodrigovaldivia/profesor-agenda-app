import assert from "node:assert/strict";
import { test } from "node:test";
import { extractErrorInfo } from "./DetailedErrorBanner";
import { AgendaCrudError } from "../../context/AgendaContext";

test("extractErrorInfo with empty or null error", () => {
  const info = extractErrorInfo(null);
  assert.equal(info.title, "Ha ocurrido un error inesperado");
  assert.ok(info.suggestion);
});

test("extractErrorInfo with single-line error string", () => {
  const info = extractErrorInfo("Inicia sesión para guardar cambios.");
  assert.equal(info.title, "Sesión requerida");
  assert.equal(info.details, "No hay una sesión activa de Google.");
  assert.ok(info.suggestion?.includes("Iniciar sesión"));
});

test("extractErrorInfo with offline error string", () => {
  const info = extractErrorInfo("Sin conexión. Comprueba tu conexión antes de guardar.");
  assert.equal(info.title, "Sin conexión a internet");
  assert.equal(info.details, "Tu dispositivo no tiene conexión a la red.");
  assert.ok(info.suggestion?.includes("Wi-Fi"));
});

test("extractErrorInfo with multi-line formatted error string", () => {
  const multiLine = "Los datos ingresados no son válidos.\nDetalle: El campo horaFin debe ser posterior a horaInicio.\nCómo solucionarlo: Ajusta la hora de término para que sea mayor a la de inicio.";
  const info = extractErrorInfo(multiLine);
  assert.equal(info.title, "Los datos ingresados no son válidos.");
  assert.equal(info.details, "El campo horaFin debe ser posterior a horaInicio.");
  assert.equal(info.suggestion, "Ajusta la hora de término para que sea mayor a la de inicio.");
});

test("extractErrorInfo with AgendaCrudError invalid_argument", () => {
  const err = new AgendaCrudError(
    "invalid_argument",
    "Datos no válidos",
    "El ID de alumno es obligatorio",
    "Selecciona un alumno de la lista desplegable",
    "alumnoId"
  );
  const info = extractErrorInfo(err);
  assert.equal(info.title, "Los datos de la operación no son válidos.");
  assert.equal(info.details, "El ID de alumno es obligatorio");
  assert.equal(info.suggestion, "Selecciona un alumno de la lista desplegable");
  assert.equal(info.field, "alumnoId");
});

test("extractErrorInfo with AgendaCrudError conflict", () => {
  const err = new AgendaCrudError(
    "conflict",
    undefined,
    "El registro fue editado por otro usuario",
    "Recarga la página para obtener la última versión"
  );
  const info = extractErrorInfo(err);
  assert.ok(info.title.includes("Conflicto"));
  assert.equal(info.details, "El registro fue editado por otro usuario");
  assert.equal(info.suggestion, "Recarga la página para obtener la última versión");
});
