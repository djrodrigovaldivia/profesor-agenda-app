import type { Alumno } from "../../types";

/**
 * Sanitizes Firestore errors and internal exceptions into clean, user-friendly messages.
 * Prevents raw JSON strings or technical stack traces from leaking to the UI.
 */
export function sanitizeAlumnoErrorMessage(error: unknown): string {
  if (!error) return "Ocurrió un error inesperado al guardar el alumno.";

  const rawMessage = error instanceof Error ? error.message : String(error);

  if (rawMessage === "Inicia sesión para guardar cambios.") {
    return "Inicia sesión para guardar cambios.";
  }
  if (rawMessage === "Sin conexión. Comprueba tu conexión antes de guardar.") {
    return "Sin conexión. Comprueba tu conexión antes de guardar.";
  }

  // Check if error is serialized JSON (e.g. from handleFirestoreError)
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      const inner = parsed.error.toLowerCase();
      if (
        inner.includes("permission-denied") ||
        inner.includes("insufficient permissions") ||
        inner.includes("unauthorized")
      ) {
        return "Permiso denegado por el servidor. Inicia sesión nuevamente.";
      }
      if (
        inner.includes("unavailable") ||
        inner.includes("offline") ||
        inner.includes("network") ||
        inner.includes("failed to get document")
      ) {
        return "Sin conexión. Comprueba tu conexión antes de guardar.";
      }
      if (inner.includes("not-found")) {
        return "El alumno no fue encontrado en el servidor.";
      }
      return `Error del servidor: ${parsed.error}`;
    }
  } catch {
    // Not JSON string
  }

  const lower = rawMessage.toLowerCase();
  if (
    lower.includes("offline") ||
    lower.includes("sin conexión") ||
    lower.includes("failed to fetch") ||
    lower.includes("network error")
  ) {
    return "Sin conexión. Comprueba tu conexión antes de guardar.";
  }
  if (lower.includes("permission") || lower.includes("inicia sesión")) {
    return "Inicia sesión para guardar cambios.";
  }

  return rawMessage || "No se pudo guardar el alumno. Intenta nuevamente.";
}

export interface SaveAlumnoExecutionParams {
  alumnoToEdit?: Alumno | null;
  payload: Omit<Alumno, "id" | "createdAt" | "updatedAt">;
  currentUser: unknown;
  isDeviceOffline?: boolean;
  addAlumno: (data: Omit<Alumno, "id" | "createdAt" | "updatedAt">) => Promise<Alumno>;
  updateAlumno: (id: string, data: Partial<Omit<Alumno, "id" | "createdAt" | "updatedAt">>) => Promise<void>;
  onAlumnoCreated?: (alumno: Alumno) => void;
  onClose: () => void;
  setIsSaving: (saving: boolean) => void;
  setSubmitError: (error: string | null) => void;
}

/**
 * Handles validation, pre-conditions, error handling and lifecycle states for saving an alumno.
 *
 * Requirements:
 * 1. Shows "Guardando..." via setIsSaving.
 * 2. Re-enables button (setIsSaving(false)) in finally block on both success and failure.
 * 3. Uses try/catch/finally.
 * 4. Never leaves isSaving locked permanently.
 * 5. If currentUser is null: shows "Inicia sesión para guardar cambios."
 * 6. If offline: shows "Sin conexión. Comprueba tu conexión antes de guardar."
 * 7. Sanitizes Firestore errors and renders inside modal.
 * 8. Keeps modal open when save fails.
 * 9. Closes modal only after promise successfully resolves.
 * 10. No fake timeouts to declare success.
 * 11. No local-only saves without real offline persistence.
 */
export async function executeSaveAlumno({
  alumnoToEdit,
  payload,
  currentUser,
  isDeviceOffline = typeof navigator !== "undefined" && !navigator.onLine,
  addAlumno,
  updateAlumno,
  onAlumnoCreated,
  onClose,
  setIsSaving,
  setSubmitError,
}: SaveAlumnoExecutionParams): Promise<boolean> {
  setSubmitError(null);

  // Requirement 5: Usuario no autenticado
  if (!currentUser) {
    setSubmitError("Inicia sesión para guardar cambios.");
    return false;
  }

  // Requirement 6: Dispositivo sin conexión
  if (isDeviceOffline) {
    setSubmitError("Sin conexión. Comprueba tu conexión antes de guardar.");
    return false;
  }

  // Requirement 1: Mostrar estado "Guardando..."
  setIsSaving(true);

  try {
    if (alumnoToEdit) {
      await updateAlumno(alumnoToEdit.id, payload);
    } else {
      const nuevo = await addAlumno(payload);
      if (onAlumnoCreated) {
        onAlumnoCreated(nuevo);
      }
    }

    // Requirement 9: Cerrar modal solo tras éxito real
    onClose();
    return true;
  } catch (err: unknown) {
    // Requirement 7 & 8: Capturar error, sanitizarlo y mantener modal abierto
    setSubmitError(sanitizeAlumnoErrorMessage(err));
    return false;
  } finally {
    // Requirement 2 & 4: Re-habilitar botón siempre en finally
    setIsSaving(false);
  }
}
