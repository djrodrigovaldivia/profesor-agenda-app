/**
 * Local Notification Service for Profesor Agenda (PWA & Web)
 * Handles browser notification permissions, service worker triggers,
 * and upcoming class / gig reminders (1 day before, 2 hours before).
 * Local delivery only: requires the app to be open, active or installed.
 */

import {
  ActividadUnificada,
  Preferencias,
  Clase,
  Tocata,
  Alumno,
  UnidadTiempoRecordatorio,
} from "../types";
import {
  getISODate,
  addDays,
  parseDateTimeLocal,
  getActivityEndDateTime,
  hasActivityStarted,
  hasActivityEnded,
  formatFechaCorta,
} from "./dateUtils";

export type NotificationPermissionStatus =
  | "granted"
  | "default"
  | "denied"
  | "unsupported";

/**
 * Checks if the Notification API is supported in the current environment
 */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Returns current notification permission status:
 * - "granted": Permitidas
 * - "default": Pendientes
 * - "denied": Bloqueadas
 * - "unsupported": No compatibles
 */
export function getNotificationPermissionStatus(): NotificationPermissionStatus {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Compatibility alias for getNotificationPermissionStatus
 */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  return getNotificationPermissionStatus();
}

/**
 * Requests explicit browser notification permission.
 * Never called automatically on app load; only triggered on explicit user action.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return "denied";
  }
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error: unknown) {
    console.error("Error al solicitar permiso de notificaciones:", error);
    return Notification.permission;
  }
}

/**
 * Registers the Service Worker (/public/sw.js) if available
 */
export async function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch {
    return null;
  }
}

/**
 * Synthesizes a gentle two-tone chime for local push notifications
 */
export function playNotificationChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // First tone (E5 - 659.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second tone (B5 - 987.77Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(987.77, now + 0.14);
    gain2.gain.setValueAtTime(0.001, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.18, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.5);
  } catch {
    // Audio synthesis is optional and should never throw
  }
}

/**
 * Sends a local notification using the registered Service Worker or standard Notification API
 */
export async function sendLocalPushNotification(
  title: string,
  options?: NotificationOptions
): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }

  playNotificationChime();

  const mergedOptions: NotificationOptions = {
    badge: "/favicon.ico",
    icon: "/favicon.ico",
    ...options,
  };

  try {
    // 1. Try Service Worker registration first
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && "showNotification" in reg) {
        await reg.showNotification(title, mergedOptions);
        return true;
      }
    }

    // 2. Fallback to standard Notification API
    const notification = new Notification(title, mergedOptions);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch (error: unknown) {
    console.warn("Fallback to standard Notification API:", error);
    try {
      const fallback = new Notification(title, mergedOptions);
      fallback.onclick = () => {
        window.focus();
        fallback.close();
      };
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Shows a test notification strictly when permission is "granted"
 * Title: "Profesor Agenda"
 * Body: "Las notificaciones están activadas correctamente."
 */
export async function showTestNotification(): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }

  return await sendLocalPushNotification("Profesor Agenda", {
    body: "Las notificaciones están activadas correctamente.",
    tag: "profesor-agenda-test-notification",
  });
}

/**
 * Builds the persistent duplicate prevention storage key.
 * Format: profesor_agenda_notification_{uid o "local"}_{tipoActividad}_{idActividad}_{trigger}_{fechaInicio}
 */
export function buildNotificationStorageKey(
  uid: string | null | undefined,
  tipoActividad: "clase" | "tocata",
  idActividad: string,
  trigger: "1d" | "2h",
  fecha: string,
  horaInicio: string
): string {
  const userSegment = uid && uid.trim() ? uid : "local";
  const fechaInicioSegment = `${fecha}_${(horaInicio || "00:00").replace(":", "-")}`;
  return `profesor_agenda_notification_${userSegment}_${tipoActividad}_${idActividad}_${trigger}_${fechaInicioSegment}`;
}

/**
 * Cleans old notification keys from localStorage:
 * - Removes keys for activities that have ended
 * - Removes keys older than 45 days
 * - Strictly protects keys for future activities
 */
export function cleanOldNotificationKeys(
  activeActivities: Array<{ id: string; fecha: string; horaInicio: string; horaFin?: string }>
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const now = new Date();
    const nowMs = now.getTime();
    const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
    const prefix = "profesor_agenda_notification_";

    // Set of active future activity IDs to protect
    const futureActivityIds = new Set<string>();
    activeActivities.forEach((act) => {
      if (!hasActivityEnded(act.fecha, act.horaInicio, act.horaFin, now)) {
        futureActivityIds.add(act.id);
      }
    });

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;

      // Extract parts: profesor_agenda_notification_{uid}_{tipo}_{id}_{trigger}_{fecha}_{hora}
      const parts = key.split("_");
      const actId = parts[5];
      const fechaStr = parts[7];

      // If associated with an active future activity, preserve it
      if (actId && futureActivityIds.has(actId)) {
        continue;
      }

      let isOld = false;
      if (fechaStr) {
        const parsedDate = parseDateTimeLocal(fechaStr, "00:00");
        if (parsedDate && nowMs - parsedDate.getTime() > fortyFiveDaysMs) {
          isOld = true;
        }
      }

      const val = localStorage.getItem(key);
      if (val) {
        try {
          const parsedVal = JSON.parse(val);
          if (parsedVal?.timestamp && nowMs - parsedVal.timestamp > fortyFiveDaysMs) {
            isOld = true;
          }
        } catch {
          // not json
        }
      }

      if (isOld || (actId && !futureActivityIds.has(actId))) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage access may fail in restricted iframes
  }
}

function getClaseLugarTexto(tipo?: string): string {
  if (tipo === "alma") return " en ALMA";
  if (tipo === "escalera") return " en La Escalera";
  if (tipo === "dj") return " en clase DJ";
  if (tipo === "sokolov") return " en Sokolov";
  return "";
}

function getTocataLugarTexto(tocata: Tocata): string {
  if (tocata.lugar) {
    if (tocata.ciudad && tocata.ciudad !== tocata.lugar) {
      return `${tocata.lugar}, ${tocata.ciudad}`;
    }
    return tocata.lugar;
  }
  return tocata.ciudad || "locación programada";
}

export const TWO_HOURS_REMINDER_MIN_MS = 115 * 60 * 1000;
export const TWO_HOURS_REMINDER_MAX_MS = 125 * 60 * 1000;

export interface CheckAndNotifyOptions {
  uid?: string | null;
  clases: Clase[];
  tocatas: Tocata[];
  alumnos: Alumno[];
  preferencias: Preferencias;
  now?: Date;
}

/**
 * Main function to check upcoming events and trigger local notifications:
 * - 1 day before (for tomorrow's events)
 * - 2 hours before (within 2h before start)
 * Strictly adheres to:
 * - No notifications for cancelled, completed, ended, or already-started events
 * - No duplicate notifications
 * - Overnight gigs calculated from start time
 * - Local dateUtils without UTC shifts
 */
export async function checkAndNotifyUpcomingEvents(
  optionsOrActividades: CheckAndNotifyOptions | ActividadUnificada[],
  legacyPreferencias?: Preferencias
): Promise<void> {
  // Legacy signature adapter
  let uid: string | null = null;
  let clasesList: Clase[] = [];
  let tocatasList: Tocata[] = [];
  let alumnosList: Alumno[] = [];
  let prefs: Preferencias;
  let now: Date = new Date();

  if (Array.isArray(optionsOrActividades)) {
    prefs = legacyPreferencias || { recordatoriosActivos: true, recordatorios: "ambos", proximaVistaDias: 30 };
    optionsOrActividades.forEach((act) => {
      if (act.tipoActividad === "clase" && act.rawClase) {
        clasesList.push(act.rawClase);
      } else if (act.tipoActividad === "tocata" && act.rawTocata) {
        tocatasList.push(act.rawTocata);
      }
    });
  } else {
    uid = optionsOrActividades.uid || null;
    clasesList = optionsOrActividades.clases;
    tocatasList = optionsOrActividades.tocatas;
    alumnosList = optionsOrActividades.alumnos;
    prefs = optionsOrActividades.preferencias;
    now = optionsOrActividades.now || new Date();
  }

  // Abort if reminders are deactivated
  if (!prefs.recordatoriosActivos) {
    return;
  }
  if (prefs.notificacionesPushLocales === false) {
    return;
  }

  // Abort if browser notification permission is not granted
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return;
  }

  const alumnoMap = new Map<string, Alumno>();
  alumnosList.forEach((a) => alumnoMap.set(a.id, a));

  const tomorrowIso = getISODate(addDays(now, 1));
  const nowMs = now.getTime();

  // Clean old expired keys periodically
  const allActiveForCleanup = [
    ...clasesList.map((c) => ({ id: c.id, fecha: c.fecha, horaInicio: c.horaInicio, horaFin: c.horaFin })),
    ...tocatasList.map((t) => ({ id: t.id, fecha: t.fecha, horaInicio: t.horaInicio, horaFin: t.horaFin })),
  ];
  cleanOldNotificationKeys(allActiveForCleanup);

  // 1. Process Clases
  for (const clase of clasesList) {
    if (
      clase.estado === "cancelada" ||
      clase.estado === "realizada" ||
      !clase.fecha ||
      !clase.horaInicio
    ) {
      continue;
    }

    // Do not notify if already started or ended
    if (hasActivityStarted(clase.fecha, clase.horaInicio, now)) {
      continue;
    }
    if (hasActivityEnded(clase.fecha, clase.horaInicio, clase.horaFin, now)) {
      continue;
    }

    const startDate = parseDateTimeLocal(clase.fecha, clase.horaInicio);
    if (!startDate) continue;
    const startMs = startDate.getTime();
    const diffMs = startMs - nowMs;

    const alumno = alumnoMap.get(clase.alumnoId);
    const alumnoNombre = alumno ? alumno.nombre : "tu alumno";
    const lugarTexto = getClaseLugarTexto(clase.tipo);

    // Trigger A: 1 día antes (activity date is tomorrow)
    if (clase.fecha === tomorrowIso) {
      const key1d = buildNotificationStorageKey(
        uid,
        "clase",
        clase.id,
        "1d",
        clase.fecha,
        clase.horaInicio
      );
      if (!localStorage.getItem(key1d)) {
        const title = "Profesor Agenda";
        const body = `Mañana tienes una clase a las ${clase.horaInicio} con ${alumnoNombre}${lugarTexto}.`;
        const sent = await sendLocalPushNotification(title, {
          body,
          tag: `clase-1d-${clase.id}`,
        });
        if (sent) {
          localStorage.setItem(
            key1d,
            JSON.stringify({ timestamp: Date.now(), fecha: clase.fecha, horaInicio: clase.horaInicio })
          );
        }
      }
    }

    // Trigger B: 2 horas antes (solo si faltan entre 115 y 125 minutos)
    if (diffMs >= TWO_HOURS_REMINDER_MIN_MS && diffMs <= TWO_HOURS_REMINDER_MAX_MS) {
      const key2h = buildNotificationStorageKey(
        uid,
        "clase",
        clase.id,
        "2h",
        clase.fecha,
        clase.horaInicio
      );
      if (!localStorage.getItem(key2h)) {
        const title = "Profesor Agenda";
        const body = `En 2 horas tienes una clase a las ${clase.horaInicio} con ${alumnoNombre}.`;
        const sent = await sendLocalPushNotification(title, {
          body,
          tag: `clase-2h-${clase.id}`,
        });
        if (sent) {
          localStorage.setItem(
            key2h,
            JSON.stringify({ timestamp: Date.now(), fecha: clase.fecha, horaInicio: clase.horaInicio })
          );
        }
      }
    }
  }

  // 2. Process Tocatas
  for (const tocata of tocatasList) {
    if (
      tocata.estado === "cancelada" ||
      tocata.estado === "realizada" ||
      !tocata.fecha ||
      !tocata.horaInicio
    ) {
      continue;
    }

    // Overnight tocatas: triggers are calculated from horaInicio, end is checked with getActivityEndDateTime
    if (hasActivityStarted(tocata.fecha, tocata.horaInicio, now)) {
      continue;
    }
    if (hasActivityEnded(tocata.fecha, tocata.horaInicio, tocata.horaFin, now)) {
      continue;
    }

    const startDate = parseDateTimeLocal(tocata.fecha, tocata.horaInicio);
    if (!startDate) continue;
    const startMs = startDate.getTime();
    const diffMs = startMs - nowMs;
    const lugar = getTocataLugarTexto(tocata);

    // Trigger A: 1 día antes (activity date is tomorrow)
    if (tocata.fecha === tomorrowIso) {
      const key1d = buildNotificationStorageKey(
        uid,
        "tocata",
        tocata.id,
        "1d",
        tocata.fecha,
        tocata.horaInicio
      );
      if (!localStorage.getItem(key1d)) {
        const title = "Profesor Agenda";
        const body = `Mañana tienes una tocata a las ${tocata.horaInicio} en ${lugar}.`;
        const sent = await sendLocalPushNotification(title, {
          body,
          tag: `tocata-1d-${tocata.id}`,
        });
        if (sent) {
          localStorage.setItem(
            key1d,
            JSON.stringify({ timestamp: Date.now(), fecha: tocata.fecha, horaInicio: tocata.horaInicio })
          );
        }
      }
    }

    // Trigger B: 2 horas antes (solo si faltan entre 115 y 125 minutos)
    if (diffMs >= TWO_HOURS_REMINDER_MIN_MS && diffMs <= TWO_HOURS_REMINDER_MAX_MS) {
      const key2h = buildNotificationStorageKey(
        uid,
        "tocata",
        tocata.id,
        "2h",
        tocata.fecha,
        tocata.horaInicio
      );
      if (!localStorage.getItem(key2h)) {
        const title = "Profesor Agenda";
        const body = `En 2 horas tienes una tocata a las ${tocata.horaInicio} en ${lugar}.`;
        const sent = await sendLocalPushNotification(title, {
          body,
          tag: `tocata-2h-${tocata.id}`,
        });
        if (sent) {
          localStorage.setItem(
            key2h,
            JSON.stringify({ timestamp: Date.now(), fecha: tocata.fecha, horaInicio: tocata.horaInicio })
          );
        }
      }
    }
  }
}

/**
 * Calculates the exact target date and time when a custom reminder will fire.
 * Retained for backward compatibility with AgendaView and modals.
 */
export function calculateNotificationTriggerTime(
  fecha: string,
  horaInicio: string,
  antelacionValor: number,
  antelacionUnidad: UnidadTiempoRecordatorio
): Date | null {
  if (!fecha || !horaInicio || typeof antelacionValor !== "number" || antelacionValor <= 0) {
    return null;
  }
  const classDate = parseDateTimeLocal(fecha, horaInicio);
  if (!classDate) return null;

  let antelacionMs = 0;
  if (antelacionUnidad === "minutos") {
    antelacionMs = antelacionValor * 60 * 1000;
  } else if (antelacionUnidad === "horas") {
    antelacionMs = antelacionValor * 60 * 60 * 1000;
  } else if (antelacionUnidad === "dias") {
    antelacionMs = antelacionValor * 24 * 60 * 60 * 1000;
  }

  return new Date(classDate.getTime() - antelacionMs);
}

/**
 * Retained for backward compatibility
 */
export async function checkAndNotifyClaseReminders(
  clases: Clase[],
  alumnoMap: Map<string, Alumno>
): Promise<void> {
  // Merged into unified checkAndNotifyUpcomingEvents
  return;
}

/**
 * Returns the current status of a class's reminder.
 * Retained for backward compatibility with CommitmentCard.
 */
export function getClaseReminderStatus(
  clase: Clase
): "none" | "scheduled" | "delivered" | "unconfirmed" {
  if (!clase.recordatorio?.activo || !clase.fecha || !clase.horaInicio) {
    return "none";
  }
  const { antelacionValor, antelacionUnidad } = clase.recordatorio;
  const trigger = calculateNotificationTriggerTime(
    clase.fecha,
    clase.horaInicio,
    antelacionValor,
    antelacionUnidad
  );
  if (!trigger) return "none";

  const storageKey = `clase_local_reminder_${clase.id}_${clase.fecha}_${clase.horaInicio}_${antelacionValor}_${antelacionUnidad}`;
  const stored = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;

  if (stored === "delivered") {
    return "delivered";
  }

  const now = Date.now();
  if (now < trigger.getTime()) {
    return "scheduled";
  }

  return "unconfirmed";
}

/**
 * Triggers a test notification for a class reminder.
 * Retained for backward compatibility with ClaseModal.
 */
export async function sendTestClaseNotification(
  alumnoNombre: string,
  tema: string,
  antelacionValor: number,
  antelacionUnidad: UnidadTiempoRecordatorio
): Promise<boolean> {
  const unidadTexto =
    antelacionUnidad === "minutos"
      ? `${antelacionValor} min`
      : antelacionUnidad === "horas"
      ? `${antelacionValor} ${antelacionValor === 1 ? "hora" : "horas"}`
      : `${antelacionValor} ${antelacionValor === 1 ? "día" : "días"}`;

  return await sendLocalPushNotification(`🔔 Notificación de prueba: ${alumnoNombre || "Alumno"}`, {
    body: `Recordatorio configurado: ${unidadTexto} antes de la clase "${tema || "Sin tema"}". Sonido y alertas funcionando correctamente en este dispositivo.`,
    tag: "test-clase-reminder",
  });
}


