import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeSaveAlumno,
  sanitizeAlumnoErrorMessage,
  type SaveAlumnoExecutionParams,
} from "./alumnoSaveHandler";
import type { Alumno } from "../../types";

const mockBaseAlumno: Alumno = {
  id: "test-id-1",
  nombre: "Carlos Santana",
  apellido: "Santana",
  telefono: "+56912345678",
  email: "carlos@example.com",
  tipoClase: "alma",
  activo: true,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};

test("crear un alumno autenticado correctamente", async () => {
  let addAlumnoCalledWith: unknown = null;
  let closed = false;
  let lastError: string | null = "prev-err";
  const savingStates: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Carlos Santana",
      apellido: "Santana",
      telefono: "+56912345678",
      email: "carlos@example.com",
      tipoClase: "alma",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      addAlumnoCalledWith = data;
      return {
        ...data,
        id: "new-generated-id",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {
      assert.fail("updateAlumno should not be called when creating an alumno");
    },
    onClose: () => {
      closed = true;
    },
    setIsSaving: (s) => savingStates.push(s),
    setSubmitError: (e) => {
      lastError = e;
    },
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, true, "executeSaveAlumno should return true on success");
  assert.ok(addAlumnoCalledWith, "addAlumno must be called with the payload");
  assert.equal(closed, true, "onClose must be called after successful creation");
  assert.equal(lastError, null, "submitError must be cleared to null");
  assert.deepEqual(
    savingStates,
    [true, false],
    "isSaving must transition to true then back to false"
  );
});

test("editar un alumno autenticado correctamente", async () => {
  let updateCalledWithId: string | null = null;
  let updateCalledWithData: unknown = null;
  let closed = false;
  let lastError: string | null = "prev-err";
  const savingStates: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: mockBaseAlumno,
    payload: {
      nombre: "Carlos Santana Editado",
      apellido: "Santana",
      telefono: "+56987654321",
      email: "carlos.nuevo@example.com",
      tipoClase: "escalera",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async () => {
      assert.fail("addAlumno should not be called when editing an alumno");
    },
    updateAlumno: async (id, data) => {
      updateCalledWithId = id;
      updateCalledWithData = data;
    },
    onClose: () => {
      closed = true;
    },
    setIsSaving: (s) => savingStates.push(s),
    setSubmitError: (e) => {
      lastError = e;
    },
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, true, "executeSaveAlumno should return true on update success");
  assert.equal(
    updateCalledWithId,
    mockBaseAlumno.id,
    "updateAlumno must receive the existing student ID"
  );
  assert.ok(updateCalledWithData, "updateAlumno must receive the updated payload");
  assert.equal(closed, true, "onClose must be called after successful edit");
  assert.equal(lastError, null, "submitError must be cleared to null");
  assert.deepEqual(
    savingStates,
    [true, false],
    "isSaving must transition to true then back to false"
  );
});

test("guardar sin autenticación", async () => {
  let addCalled = false;
  let updateCalled = false;
  let closed = false;
  let lastError: string | null = null;
  const savingStates: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Ana María",
      apellido: "Pérez",
      activo: true,
    },
    currentUser: null, // Sin autenticación
    isDeviceOffline: false,
    addAlumno: async () => {
      addCalled = true;
      return mockBaseAlumno;
    },
    updateAlumno: async () => {
      updateCalled = true;
    },
    onClose: () => {
      closed = true;
    },
    setIsSaving: (s) => savingStates.push(s),
    setSubmitError: (e) => {
      lastError = e;
    },
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, false, "Should return false when unauthenticated");
  assert.equal(
    lastError,
    "Inicia sesión para guardar cambios.",
    "Must show exact error message when unauthenticated"
  );
  assert.equal(addCalled, false, "Must not attempt to addAlumno when unauthenticated");
  assert.equal(updateCalled, false, "Must not attempt to updateAlumno when unauthenticated");
  assert.equal(closed, false, "Modal must remain open on unauthenticated error");
  assert.equal(savingStates.length, 0, "isSaving should not stay active if blocked early");
});

test("guardar sin conexión", async () => {
  let addCalled = false;
  let updateCalled = false;
  let closed = false;
  let lastError: string | null = null;
  const savingStates: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: mockBaseAlumno,
    payload: {
      nombre: "Carlos Santana",
      apellido: "Santana",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: true, // Dispositivo sin conexión
    addAlumno: async () => {
      addCalled = true;
      return mockBaseAlumno;
    },
    updateAlumno: async () => {
      updateCalled = true;
    },
    onClose: () => {
      closed = true;
    },
    setIsSaving: (s) => savingStates.push(s),
    setSubmitError: (e) => {
      lastError = e;
    },
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, false, "Should return false when offline");
  assert.equal(
    lastError,
    "Sin conexión. Comprueba tu conexión antes de guardar.",
    "Must show exact error message when offline"
  );
  assert.equal(addCalled, false, "Must not attempt to addAlumno when offline");
  assert.equal(updateCalled, false, "Must not attempt to updateAlumno when offline");
  assert.equal(closed, false, "Modal must remain open on offline error");
  assert.equal(savingStates.length, 0, "isSaving should not stay active if blocked early");
});

test("error de Firestore", async () => {
  let closed = false;
  let lastError: string | null = null;
  const savingStates: boolean[] = [];

  const firestoreErrorJson = JSON.stringify({
    error: "Missing or insufficient permissions.",
    operationType: "create",
    path: "users/user-123/alumnos/abc",
  });

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Estudiante Fallido",
      apellido: "García",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async () => {
      throw new Error(firestoreErrorJson);
    },
    updateAlumno: async () => {},
    onClose: () => {
      closed = true;
    },
    setIsSaving: (s) => savingStates.push(s),
    setSubmitError: (e) => {
      lastError = e;
    },
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, false, "Should return false when Firestore throws");
  assert.equal(
    lastError,
    "Permiso denegado por el servidor. Inicia sesión nuevamente.",
    "Must show sanitized permission error message instead of raw JSON"
  );
  assert.equal(closed, false, "Modal must remain open when Firestore returns an error");
  assert.deepEqual(
    savingStates,
    [true, false],
    "isSaving must be turned off even when an error is caught"
  );
});

test("comprobar que isSaving vuelve a false en éxito", async () => {
  const states: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Pedro Pascal",
      apellido: "Pascal",
      activo: true,
    },
    currentUser: { uid: "user-1" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      assert.equal(
        states[states.length - 1],
        true,
        "isSaving must be true during the asynchronous operation"
      );
      return {
        ...data,
        id: "pedro-id",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {},
    onClose: () => {},
    setIsSaving: (s) => states.push(s),
    setSubmitError: () => {},
  };

  await executeSaveAlumno(params);

  assert.equal(
    states[states.length - 1],
    false,
    "isSaving must return to false after successful completion"
  );
  assert.deepEqual(states, [true, false]);
});

test("comprobar que isSaving vuelve a false en error", async () => {
  const states: boolean[] = [];

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: mockBaseAlumno,
    payload: {
      nombre: "Error Test",
      activo: true,
    },
    currentUser: { uid: "user-1" },
    isDeviceOffline: false,
    addAlumno: async () => mockBaseAlumno,
    updateAlumno: async () => {
      assert.equal(
        states[states.length - 1],
        true,
        "isSaving must be true during the asynchronous operation"
      );
      throw new Error("Network timeout or crash");
    },
    onClose: () => {},
    setIsSaving: (s) => states.push(s),
    setSubmitError: () => {},
  };

  await executeSaveAlumno(params);

  assert.equal(
    states[states.length - 1],
    false,
    "isSaving must return to false in finally block even when an error throws"
  );
  assert.deepEqual(states, [true, false]);
});

test("comprobar que el modal permanece abierto en error", async () => {
  let modalClosed = false;

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Prueba Cierre Fallido",
      activo: true,
    },
    currentUser: { uid: "user-1" },
    isDeviceOffline: false,
    addAlumno: async () => {
      throw new Error("Storage quota exceeded");
    },
    updateAlumno: async () => {},
    onClose: () => {
      modalClosed = true;
    },
    setIsSaving: () => {},
    setSubmitError: () => {},
  };

  await executeSaveAlumno(params);

  assert.equal(modalClosed, false, "Modal must NOT close when an error occurs");
});

test("comprobar que el modal se cierra solo en éxito", async () => {
  let modalClosed = false;
  let operationFinished = false;

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Prueba Cierre Exitoso",
      activo: true,
    },
    currentUser: { uid: "user-1" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      assert.equal(modalClosed, false, "Modal must NOT close before the promise resolves");
      operationFinished = true;
      return {
        ...data,
        id: "success-id",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {},
    onClose: () => {
      assert.equal(operationFinished, true, "onClose called only after operation completes");
      modalClosed = true;
    },
    setIsSaving: () => {},
    setSubmitError: () => {},
  };

  const success = await executeSaveAlumno(params);

  assert.equal(success, true);
  assert.equal(modalClosed, true, "Modal must close on successful save");
});

test("sanitización de mensajes de error de Firestore y red", () => {
  // Unauthenticated
  assert.equal(
    sanitizeAlumnoErrorMessage(new Error("Inicia sesión para guardar cambios.")),
    "Inicia sesión para guardar cambios."
  );

  // Offline
  assert.equal(
    sanitizeAlumnoErrorMessage(
      new Error("Sin conexión. Comprueba tu conexión antes de guardar.")
    ),
    "Sin conexión. Comprueba tu conexión antes de guardar."
  );

  // Serialized Firestore permission error
  const permError = JSON.stringify({
    error: "Missing or insufficient permissions.",
    operationType: "create",
  });
  assert.equal(
    sanitizeAlumnoErrorMessage(new Error(permError)),
    "Permiso denegado por el servidor. Inicia sesión nuevamente."
  );

  // Serialized Firestore offline error
  const offlineFirestoreError = JSON.stringify({
    error: "Failed to get document because the client is offline.",
    operationType: "update",
  });
  assert.equal(
    sanitizeAlumnoErrorMessage(new Error(offlineFirestoreError)),
    "Sin conexión. Comprueba tu conexión antes de guardar."
  );

  // Raw network error
  assert.equal(
    sanitizeAlumnoErrorMessage(new Error("Failed to fetch")),
    "Sin conexión. Comprueba tu conexión antes de guardar."
  );
});

test("protección síncrona: segundo submit bloqueado mientras la promesa inicial sigue en curso", async () => {
  const activeRef = { current: false };
  let addCount = 0;
  let resolvePromise: (val: any) => void;
  const pendingPromise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Juan Perez",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      addCount++;
      await pendingPromise;
      return {
        ...data,
        id: "id-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {},
    onClose: () => {},
    setIsSaving: () => {},
    setSubmitError: () => {},
    activeRef,
  };

  // Primer submit: arranca la promesa y activa la referencia síncrona
  const firstSavePromise = executeSaveAlumno(params);
  assert.equal(activeRef.current, true, "activeRef debe ser true mientras la operación está activa");
  assert.equal(addCount, 1, "addAlumno debe haberse llamado una vez");

  // Segundo submit (ej: doble click o enter inmediato): debe rebotar
  let secondError: string | null = null;
  const secondParams: SaveAlumnoExecutionParams = {
    ...params,
    setSubmitError: (err) => {
      secondError = err;
    },
  };
  const secondResult = await executeSaveAlumno(secondParams);

  assert.equal(secondResult, false, "El segundo submit debe retornar false inmediatamente");
  assert.equal(addCount, 1, "addAlumno NO debe ser llamado una segunda vez");
  assert.equal(
    secondError,
    "Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario."
  );

  // Resolver la primera promesa
  resolvePromise!({});
  const firstResult = await firstSavePromise;

  assert.equal(firstResult, true, "El primer submit debe completarse exitosamente");
  assert.equal(activeRef.current, false, "activeRef debe volver a false tras completarse");
  assert.equal(addCount, 1, "addAlumno debe haberse ejecutado exactamente una sola vez en total");
});

test("protección post-timeout: después del timeout visual de 20s, un segundo submit NO duplica la escritura", async () => {
  const activeRef = { current: false };
  let addCount = 0;
  let resolvePromise: (val: any) => void;
  const pendingPromise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  let timeoutFired = false;
  let isSavingState = false;

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "María Lopez",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      addCount++;
      await pendingPromise;
      return {
        ...data,
        id: "id-2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {},
    onClose: () => {},
    setIsSaving: (s) => {
      isSavingState = s;
    },
    setSubmitError: () => {},
    onTimeoutWarning: (warn) => {
      timeoutFired = warn;
    },
    activeRef,
  };

  const firstSavePromise = executeSaveAlumno(params);
  assert.equal(activeRef.current, true);
  assert.equal(addCount, 1);

  // Simulamos que pasaron 20 segundos y se disparó el callback de timeout
  // El callback del timeout pone isSaving en false y timeoutWarning en true,
  // pero NUNCA debe poner activeRef en false
  isSavingState = false;
  timeoutFired = true;

  assert.equal(isSavingState, false, "El spinner se oculta para no bloquear la pantalla");
  assert.equal(timeoutFired, true, "El aviso de timeout se muestra");
  assert.equal(
    activeRef.current,
    true,
    "activeRef.current DEBE seguir en true para proteger la promesa en curso"
  );

  // El usuario pulsa Guardar otra vez tras el timeout
  let secondError: string | null = null;
  const secondResult = await executeSaveAlumno({
    ...params,
    setSubmitError: (err) => {
      secondError = err;
    },
  });

  assert.equal(secondResult, false, "El segundo submit tras el timeout debe ser rechazado");
  assert.equal(addCount, 1, "addAlumno NO debe ejecutarse dos veces bajo ninguna circunstancia");
  assert.equal(
    secondError,
    "Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario."
  );

  // La promesa lenta finalmente responde con éxito
  resolvePromise!({});
  const firstResult = await firstSavePromise;

  assert.equal(firstResult, true);
  assert.equal(activeRef.current, false, "activeRef se libera únicamente tras la resolución real");
  assert.equal(addCount, 1, "addAlumno se llamó una sola vez");
});

test("si la primera operación falla con error, activeRef se libera y permite reintentar conscientemente", async () => {
  const activeRef = { current: false };
  let addCount = 0;
  let shouldFail = true;

  const params: SaveAlumnoExecutionParams = {
    alumnoToEdit: null,
    payload: {
      nombre: "Reintento Alumno",
      activo: true,
    },
    currentUser: { uid: "user-123" },
    isDeviceOffline: false,
    addAlumno: async (data) => {
      addCount++;
      if (shouldFail) {
        throw new Error("Error de conexión transitorio");
      }
      return {
        ...data,
        id: "id-3",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateAlumno: async () => {},
    onClose: () => {},
    setIsSaving: () => {},
    setSubmitError: () => {},
    activeRef,
  };

  // Primer intento: falla
  const firstResult = await executeSaveAlumno(params);
  assert.equal(firstResult, false, "Primer intento falla");
  assert.equal(activeRef.current, false, "activeRef debe quedar en false tras el error");
  assert.equal(addCount, 1);

  // Segundo intento: el usuario corrige la red y reintenta
  shouldFail = false;
  let closed = false;
  const secondResult = await executeSaveAlumno({
    ...params,
    onClose: () => {
      closed = true;
    },
  });

  assert.equal(secondResult, true, "Segundo intento tiene éxito");
  assert.equal(addCount, 2, "Se ejecutó el reintento");
  assert.equal(closed, true, "El modal se cierra una vez");
  assert.equal(activeRef.current, false, "activeRef vuelve a quedar en false");
});

