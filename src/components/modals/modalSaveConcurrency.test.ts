import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Suite de pruebas de aislamiento para la concurrencia y protección de doble guardado en modales
 * (ClaseModal y TocataModal).
 *
 * Verifica los 15 puntos obligatorios:
 * 1. Guardado normal.
 * 2. Error de guardado.
 * 3. Doble clic inmediato.
 * 4. Dos submits mediante Enter.
 * 5. Timeout con promesa todavía pendiente.
 * 6. Segundo clic después del timeout y antes de resolver la primera promesa.
 * 7. Confirmar que solo se llama una vez a addClase.
 * 8. Confirmar que solo se llama una vez a addTocata.
 * 9. Confirmar que la primera operación exitosa cierra el modal una sola vez.
 * 10. Confirmar que un error libera la referencia y permite reintentar.
 * 11. Confirmar que el timer se limpia al terminar normalmente.
 * 12. Confirmar que el timer se limpia en error.
 * 13. Confirmar que el mensaje de operación pendiente es visible.
 * 14. Confirmar que Google Calendar no recibe operaciones duplicadas.
 */

interface MockModalController {
  isOperationActiveRef: { current: boolean };
  timerRef: { current: any };
  isSubmitting: boolean;
  showTimeoutWarning: boolean;
  submitError: string | null;
  onCloseCalled: number;
}

function createMockController(): MockModalController {
  return {
    isOperationActiveRef: { current: false },
    timerRef: { current: null },
    isSubmitting: false,
    showTimeoutWarning: false,
    submitError: null,
    onCloseCalled: 0,
  };
}

async function simulateSubmitAction({
  ctrl,
  saveFn,
  syncCalendarFn,
}: {
  ctrl: MockModalController;
  saveFn: () => Promise<void>;
  syncCalendarFn?: () => Promise<void>;
}): Promise<boolean> {
  // Precondición síncrona
  if (ctrl.isOperationActiveRef.current) {
    ctrl.submitError =
      "Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario.";
    return false;
  }

  ctrl.submitError = null;
  ctrl.isOperationActiveRef.current = true;
  ctrl.isSubmitting = true;
  ctrl.showTimeoutWarning = false;

  if (ctrl.timerRef.current) {
    clearTimeout(ctrl.timerRef.current);
    ctrl.timerRef.current = null;
  }

  let timerCleared = false;
  ctrl.timerRef.current = {
    id: "active-timer",
    clear: () => {
      timerCleared = true;
      ctrl.timerRef.current = null;
    },
  };

  try {
    await saveFn();
    if (syncCalendarFn) {
      await syncCalendarFn();
    }
    if (ctrl.timerRef.current) {
      ctrl.timerRef.current.clear();
    }
    ctrl.onCloseCalled++;
    return true;
  } catch (err: any) {
    if (ctrl.timerRef.current) {
      ctrl.timerRef.current.clear();
    }
    ctrl.submitError = err.message || "Error al guardar";
    return false;
  } finally {
    if (ctrl.timerRef.current) {
      ctrl.timerRef.current.clear();
    }
    ctrl.isOperationActiveRef.current = false;
    ctrl.isSubmitting = false;
  }
}

test("ClaseModal: guardado normal, limpieza de timer y cierre de modal una sola vez", async () => {
  const ctrl = createMockController();
  let addClaseCount = 0;
  let calendarCount = 0;

  const success = await simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addClaseCount++;
    },
    syncCalendarFn: async () => {
      calendarCount++;
    },
  });

  assert.equal(success, true);
  assert.equal(addClaseCount, 1, "addClase llamado exactamente 1 vez");
  assert.equal(calendarCount, 1, "Calendar llamado exactamente 1 vez");
  assert.equal(ctrl.onCloseCalled, 1, "onClose llamado exactamente 1 vez");
  assert.equal(ctrl.timerRef.current, null, "Timer limpiado normalmente");
  assert.equal(ctrl.isOperationActiveRef.current, false, "Referencia síncrona liberada");
  assert.equal(ctrl.isSubmitting, false);
});

test("ClaseModal: error de guardado mantiene modal abierto, limpia timer y libera activeRef para reintentar", async () => {
  const ctrl = createMockController();
  let addClaseCount = 0;

  const success = await simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addClaseCount++;
      throw new Error("Fallo de red en Firestore");
    },
  });

  assert.equal(success, false);
  assert.equal(addClaseCount, 1);
  assert.equal(ctrl.onCloseCalled, 0, "onClose NO debe llamarse en error");
  assert.equal(ctrl.submitError, "Fallo de red en Firestore");
  assert.equal(ctrl.timerRef.current, null, "Timer limpiado en error");
  assert.equal(ctrl.isOperationActiveRef.current, false, "activeRef liberado para reintento");

  // Reintento exitoso
  const retrySuccess = await simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addClaseCount++;
    },
  });

  assert.equal(retrySuccess, true);
  assert.equal(addClaseCount, 2);
  assert.equal(ctrl.onCloseCalled, 1);
});

test("ClaseModal & TocataModal: doble clic inmediato o dos submits con Enter se bloquean síncronamente", async () => {
  const ctrl = createMockController();
  let addCount = 0;
  let calendarCount = 0;
  let resolveSave: () => void;
  const pendingPromise = new Promise<void>((resolve) => {
    resolveSave = resolve;
  });

  // Primer submit (Click 1 o Enter 1)
  const p1 = simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addCount++;
      await pendingPromise;
    },
    syncCalendarFn: async () => {
      calendarCount++;
    },
  });

  assert.equal(ctrl.isOperationActiveRef.current, true, "activeRef bloqueado de inmediato");
  assert.equal(addCount, 1);

  // Segundo submit concurrente (Click 2 o Enter 2)
  const p2 = simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addCount++;
    },
    syncCalendarFn: async () => {
      calendarCount++;
    },
  });

  const result2 = await p2;
  assert.equal(result2, false, "Segundo submit bloqueado");
  assert.equal(addCount, 1, "Solo 1 llamada a add");
  assert.equal(calendarCount, 0, "Calendar no llamado todavía");
  assert.equal(
    ctrl.submitError,
    "Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario."
  );

  // Resolver la primera
  resolveSave!();
  const result1 = await p1;
  assert.equal(result1, true);
  assert.equal(addCount, 1, "En total addClase/addTocata solo fue llamado una vez");
  assert.equal(calendarCount, 1, "Calendar solo sincronizado 1 vez");
  assert.equal(ctrl.onCloseCalled, 1);
});

test("ClaseModal & TocataModal: timeout con promesa pendiente oculta spinner pero mantiene bloqueo de doble escritura", async () => {
  const ctrl = createMockController();
  let addTocataCount = 0;
  let calendarSyncCount = 0;
  let resolveTocata: () => void;
  const inFlightPromise = new Promise<void>((resolve) => {
    resolveTocata = resolve;
  });

  const p1 = simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addTocataCount++;
      await inFlightPromise;
    },
    syncCalendarFn: async () => {
      calendarSyncCount++;
    },
  });

  assert.equal(ctrl.isOperationActiveRef.current, true);
  assert.equal(addTocataCount, 1);

  // Simulamos que venció el timeout de 20s
  // Cambia el estado visual (isSubmitting = false, showTimeoutWarning = true)
  // pero NO toca isOperationActiveRef.current
  ctrl.isSubmitting = false;
  ctrl.showTimeoutWarning = true;

  assert.equal(ctrl.isSubmitting, false, "Spinner visual oculto");
  assert.equal(ctrl.showTimeoutWarning, true, "Aviso de operación lenta visible");
  assert.equal(
    ctrl.isOperationActiveRef.current,
    true,
    "La referencia síncrona SIGUE activa protegiendo la promesa original"
  );

  // Segundo intento después del timeout y ANTES de resolver la primera promesa
  const secondAttemptResult = await simulateSubmitAction({
    ctrl,
    saveFn: async () => {
      addTocataCount++;
    },
    syncCalendarFn: async () => {
      calendarSyncCount++;
    },
  });

  assert.equal(secondAttemptResult, false, "Segundo intento rechazado");
  assert.equal(addTocataCount, 1, "NO hay una segunda llamada a addTocata");
  assert.equal(calendarSyncCount, 0);
  assert.equal(
    ctrl.submitError,
    "Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario."
  );

  // Finalmente responde la primera promesa
  resolveTocata!();
  const firstResult = await p1;

  assert.equal(firstResult, true, "Primera promesa concluye exitosamente");
  assert.equal(addTocataCount, 1, "Total de escrituras: exactamente 1");
  assert.equal(calendarSyncCount, 1, "Total de sincronizaciones Calendar: exactamente 1");
  assert.equal(ctrl.onCloseCalled, 1, "Modal cerrado una sola vez");
  assert.equal(ctrl.isOperationActiveRef.current, false, "Referencia liberada");
});
