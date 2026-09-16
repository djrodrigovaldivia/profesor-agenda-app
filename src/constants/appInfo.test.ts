import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_INFO } from "./appInfo";

test("APP_INFO contiene la información requerida", () => {
  assert.equal(APP_INFO.nombre, "Profesor Agenda");
  assert.equal(APP_INFO.version, "1.0.0");
  assert.equal(APP_INFO.estado, "versión en prueba");
  assert.ok(APP_INFO.descripcion.length > 0);
  assert.ok(
    APP_INFO.avisoFase.includes(
      "Proyecto en evolución. Las funciones pueden seguir cambiando durante la fase de prueba."
    )
  );
  assert.deepEqual(APP_INFO.tecnologias, [
    "React",
    "TypeScript",
    "Firebase",
    "Google Calendar",
  ]);
});
