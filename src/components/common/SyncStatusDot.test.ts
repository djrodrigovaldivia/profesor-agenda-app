import assert from "node:assert/strict";
import { test } from "node:test";
import { getSyncStatusConfig } from "./SyncStatusDot";

test("usuario no autenticado con navigator.onLine true muestra modo local", () => {
  // currentUser is null, isDeviceOffline is false (i.e. navigator.onLine is true)
  // Even if syncStatus is "offline" (AgendaContext default when no session),
  // it should display "Local" and NOT "Modo local (sin internet)"
  const config = getSyncStatusConfig("offline", null, false);

  assert.equal(config.text, "Local");
  assert.equal(config.subtext, "Datos guardados en este dispositivo");
  assert.equal(config.dotBg, "bg-emerald-400");
  assert.equal(config.border, "border-emerald-500/30");
});

test("usuario no autenticado con navigator.onLine false muestra sin red en ámbar", () => {
  // currentUser is null, isDeviceOffline is true (i.e. navigator.onLine is false)
  const config = getSyncStatusConfig("offline", null, true);

  assert.equal(config.text, "Sin red");
  assert.equal(config.subtext, "Modo local (sin internet)");
  assert.equal(config.dotBg, "bg-amber-400");
  assert.equal(config.border, "border-amber-500/30");
});

test("usuario autenticado con status offline muestra offline", () => {
  const dummyUser = { uid: "user-123", email: "test@example.com" };
  const config = getSyncStatusConfig("offline", dummyUser, false);

  assert.equal(config.text, "Offline");
  assert.equal(config.subtext, "Sin conexión • Comprueba tu conexión antes de guardar");
  assert.equal(config.dotBg, "bg-rose-500");
});

test("usuario autenticado con status connected muestra en línea", () => {
  const dummyUser = { uid: "user-123", email: "test@example.com" };
  const config = getSyncStatusConfig("connected", dummyUser, false);

  assert.equal(config.text, "En línea");
  assert.equal(config.subtext, "Cloud Firestore conectado");
  assert.equal(config.dotBg, "bg-emerald-400");
});
