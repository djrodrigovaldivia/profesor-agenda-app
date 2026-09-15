import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
  writeBatch,
  query,
  where,
  runTransaction,
} from "firebase/firestore";
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  cleanForFirestore,
  sanitizeForFirestore,
  enableFirestoreNetwork,
} from "../lib/firebase";
import { FirestoreCalendarSyncStorage } from "../services/firestoreCalendarSyncStorage";
import {
  persistAgendaCalendarMutation,
  agendaEntityVersion,
  enableCalendarLink,
  disableCalendarLink,
  enqueueCalendarSync,
  type AgendaCalendarPersistenceDependencies,
  type AgendaAuthorizedLink,
  type AgendaCalendarMutationResult,
} from "../services/agendaCalendarPersistence";
export type { AgendaAuthorizedLink } from "../services/agendaCalendarPersistence";
import {
  createGoogleCalendarSyncCalendar,
  createGoogleCalendarSyncStore,
} from "../services/googleCalendarSyncAdapter";
import { CalendarSyncWorker } from "../services/calendarSyncWorker";
import {
  getGoogleCalendarAccessToken,
  hasGoogleCalendarAccessToken,
} from "../services/googleCalendarAuth";
import { useAuth } from "./AuthContext";

export type AgendaCrudErrorCode =
  | "conflict"
  | "not_found"
  | "invalid_argument"
  | "storage_failure";

export class AgendaCrudError extends Error {
  readonly code: AgendaCrudErrorCode;
  readonly details?: string;
  readonly suggestion?: string;
  readonly field?: string;

  constructor(
    code: AgendaCrudErrorCode,
    message?: string,
    details?: string,
    suggestion?: string,
    field?: string
  ) {
    super(message || `Operación de agenda no válida: ${code}`);
    this.name = "AgendaCrudError";
    this.code = code;
    this.details = details;
    this.suggestion = suggestion;
    this.field = field;
  }
}

export interface FormattedErrorInfo {
  title: string;
  details?: string;
  suggestion?: string;
  field?: string;
}

export function parseErrorInfo(error: unknown): FormattedErrorInfo {
  if (error instanceof AgendaCrudError) {
    let title = "";
    let defaultSuggestion = "";

    switch (error.code) {
      case "conflict":
        title = "El elemento cambió desde que abriste el formulario (Conflicto de edición).";
        defaultSuggestion = "Cierra este formulario, recarga la agenda para cargar la última versión y vuelve a intentar el cambio.";
        break;
      case "not_found":
        title = "El elemento no existe o ya fue eliminado del servidor.";
        defaultSuggestion = "Recarga la agenda para reflejar los elementos actuales.";
        break;
      case "invalid_argument":
        title = "Los datos de la operación no son válidos.";
        defaultSuggestion = "Verifica que el alumno esté seleccionado, que la fecha sea válida (AAAA-MM-DD), que las horas tengan formato HH:MM (24h) y que el término sea posterior al inicio.";
        break;
      case "storage_failure":
      default:
        title = "No se pudo confirmar la operación con el servidor.";
        defaultSuggestion = "Comprueba tu conexión a internet e inicia sesión nuevamente con tu cuenta de Google si la sesión ha expirado.";
        break;
    }

    const details = error.details || (error.message && !error.message.startsWith("Operación de agenda no válida") ? error.message : undefined);
    const suggestion = error.suggestion || defaultSuggestion;

    return { title, details, suggestion, field: error.field };
  }

  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("Inicia sesión") || msg.includes("not_signed_in") || msg.includes("unauthenticated")) {
      return {
        title: "Sesión requerida",
        details: "No hay una sesión activa de Google.",
        suggestion: "Haz clic en 'Iniciar sesión' en la esquina superior derecha con tu cuenta de Google para poder guardar.",
      };
    }
    if (msg.includes("Sin conexión") || msg.includes("offline") || msg.includes("network_error")) {
      return {
        title: "Sin conexión a internet",
        details: "Tu dispositivo no tiene conexión a la red.",
        suggestion: "Comprueba tu conexión Wi-Fi o datos móviles antes de intentar guardar.",
      };
    }
    if (msg.includes("permission-denied") || msg.includes("insufficient permissions")) {
      return {
        title: "Permiso denegado por el servidor",
        details: "Tu cuenta no tiene permisos suficientes para guardar en Firestore.",
        suggestion: "Cierra sesión y vuelve a iniciarla para refrescar los tokens de acceso.",
      };
    }
    return {
      title: "Error en la operación",
      details: msg,
      suggestion: "Verifica los datos del formulario o recarga la página si el problema persiste.",
    };
  }

  return {
    title: "Error inesperado",
    details: String(error),
    suggestion: "Recarga la página e intenta de nuevo.",
  };
}

export function agendaCrudErrorMessage(error: unknown): string {
  const info = parseErrorInfo(error);
  const parts: string[] = [info.title];
  if (info.details) {
    parts.push(`Detalle: ${info.details}`);
  }
  if (info.suggestion) {
    parts.push(`Cómo solucionarlo: ${info.suggestion}`);
  }
  return parts.join("\n");
}

export interface AgendaEditPrecondition {
  id: string;
  kind: "clase" | "tocata";
  updatedAt: string;
  snapshot: Clase | Tocata;
  version?: string;
  uid?: string;
}
import {
  Alumno,
  Clase,
  Tocata,
  NotaAlumno,
  NotaRapida,
  Preferencias,
  RespaldoProfesorAgenda,
  ActividadUnificada,
  FirestoreSyncStatus,
  GoogleCalendarSyncJob,
} from "../types";
import {
  getISODate,
  addDays,
  generateUUID,
  cleanExpiredAlertStorage,
} from "../utils/dateUtils";
import {
  checkAndNotifyUpcomingEvents,
  checkAndNotifyClaseReminders,
  registerNotificationServiceWorker,
} from "../utils/notificationService";
import { validateRespaldo } from "../utils/backupValidation";

const STORAGE_KEYS = {
  ALUMNOS: "profesor_agenda_alumnos_v3",
  CLASES: "profesor_agenda_clases_v3",
  TOCATAS: "profesor_agenda_tocatas_v3",
  NOTAS: "profesor_agenda_notas_v3",
  NOTAS_RAPIDAS: "profesor_agenda_notas_rapidas_v3",
  PREFERENCIAS: "profesor_agenda_preferencias_v3",
  INITIALIZED: "profesor_agenda_initialized_v3",
};

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

export function createInitialDemoData(): {
  alumnos: Alumno[];
  clases: Clase[];
  tocatas: Tocata[];
  notas: NotaAlumno[];
  notasRapidas: NotaRapida[];
  preferencias: Preferencias;
} {
  const alumnoClaudioId = "alumno-claudio";
  const alumnoPabloId = "alumno-pablo";
  const alumnoEscaleraId = "alumno-escalera";

  const defaultIso = "2026-09-01T10:00:00.000Z";

  // 1. Alumnos: Claudio, Pablo, La Escalera (Activo)
  const alumnos: Alumno[] = [
    {
      id: alumnoClaudioId,
      nombre: "Claudio",
      tipoClase: "alma",
      telefono: "+56 9 9123 4567",
      descripcion:
        "Alumno de Clases ALMA. Enfoque en desarrollo de repertorio, técnica y control sonoro.",
      activo: true,
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: alumnoPabloId,
      nombre: "Pablo",
      tipoClase: "alma",
      telefono: "+56 9 8234 5678",
      descripcion:
        "Alumno de Clases ALMA. Enfoque en técnica instrumental, lectura y dinámicas.",
      activo: true,
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: alumnoEscaleraId,
      nombre: "La Escalera",
      tipoClase: "escalera",
      telefono: "+56 9 7345 6789",
      descripcion:
        "Mentorías especializadas La Escalera: producción musical, estructuración y performance en vivo.",
      activo: true,
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
  ];

  // 2. Clases ALMA (8 sesiones los miércoles de septiembre 2026: 02, 09, 16, 23)
  // + Mentorías La Escalera (2 sesiones los sábados de septiembre 2026: 05, 12)
  const clases: Clase[] = [
    // --- Miércoles 2 de Septiembre 2026 ---
    {
      id: "clase-alma-1",
      alumnoId: alumnoClaudioId,
      tipo: "alma",
      fecha: "2026-09-02",
      horaInicio: "16:00",
      horaFin: "17:30",
      tema: "Clase ALMA: Fundamentos y Técnica",
      notas: "Revisar postura, dinámicas de ejecución y articulación.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "clase-alma-2",
      alumnoId: alumnoPabloId,
      tipo: "alma",
      fecha: "2026-09-02",
      horaInicio: "18:00",
      horaFin: "19:30",
      tema: "Clase ALMA: Lectura y Rítmica",
      notas: "Métricas irregulares y subdivisión temporal.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },

    // --- Sábado 5 de Septiembre 2026 (Mentoría La Escalera) ---
    {
      id: "clase-esc-1",
      alumnoId: alumnoEscaleraId,
      tipo: "escalera",
      fecha: "2026-09-05",
      horaInicio: "11:00",
      horaFin: "13:00",
      tema: "Mentoría La Escalera: Producción & Workflow",
      notas:
        "Revisión de proyectos en Ableton Live, síntesis y arquitectura de stems.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },

    // --- Miércoles 9 de Septiembre 2026 ---
    {
      id: "clase-alma-3",
      alumnoId: alumnoClaudioId,
      tipo: "alma",
      fecha: "2026-09-09",
      horaInicio: "16:00",
      horaFin: "17:30",
      tema: "Clase ALMA: Armonía y Estructura",
      notas: "Continuación de secuencias tonales y acompañamiento.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "clase-alma-4",
      alumnoId: alumnoPabloId,
      tipo: "alma",
      fecha: "2026-09-09",
      horaInicio: "18:00",
      horaFin: "19:30",
      tema: "Clase ALMA: Progresiones y Arpegios",
      notas: "Ejercicios de digitación y coordinación bilateral.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },

    // --- Sábado 12 de Septiembre 2026 (Mentoría La Escalera) ---
    {
      id: "clase-esc-2",
      alumnoId: alumnoEscaleraId,
      tipo: "escalera",
      fecha: "2026-09-12",
      horaInicio: "11:00",
      horaFin: "13:00",
      tema: "Mentoría La Escalera: Mezcla & Live Performance",
      notas:
        "Setup de controladoras, ecualización de mezcla y dinámicas de show.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },

    // --- Miércoles 16 de Septiembre 2026 ---
    {
      id: "clase-alma-5",
      alumnoId: alumnoClaudioId,
      tipo: "alma",
      fecha: "2026-09-16",
      horaInicio: "16:00",
      horaFin: "17:30",
      tema: "Clase ALMA: Interpretación y Dinámica",
      notas: "Trabajo de tempo y expresión en pasajes complejos.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "clase-alma-6",
      alumnoId: alumnoPabloId,
      tipo: "alma",
      fecha: "2026-09-16",
      horaInicio: "18:00",
      horaFin: "19:30",
      tema: "Clase ALMA: Modulación y Texturas",
      notas: "Transición entre tonalidades relativas y acordes de paso.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },

    // --- Miércoles 23 de Septiembre 2026 ---
    {
      id: "clase-alma-7",
      alumnoId: alumnoClaudioId,
      tipo: "alma",
      fecha: "2026-09-23",
      horaInicio: "16:00",
      horaFin: "17:30",
      tema: "Clase ALMA: Consolidación de Repertorio",
      notas: "Evaluación de piezas preparadas y pulido final.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "clase-alma-8",
      alumnoId: alumnoPabloId,
      tipo: "alma",
      fecha: "2026-09-23",
      horaInicio: "18:00",
      horaFin: "19:30",
      tema: "Clase ALMA: Ensamble y Cierre",
      notas: "Ensayo completo de repertorio y dinámica de ensamble.",
      estado: "programada",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
  ];

  // 3. Fechas DJ (13 actividades en septiembre de 2026)
  const tocatas: Tocata[] = [
    {
      id: "fecha-dj-1",
      titulo: "Bar del Medio",
      fecha: "2026-09-02",
      horaInicio: "21:00",
      horaFin: "01:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 50000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-2",
      titulo: "Bar del Medio",
      fecha: "2026-09-04",
      horaInicio: "22:00",
      horaFin: "02:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 90000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-3",
      titulo: "Cumple Diabase",
      fecha: "2026-09-05",
      horaInicio: "22:00",
      horaFin: "03:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Angol",
      ciudad: "Angol",
      estado: "confirmada",
      notas: "Cumple Diabase",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-4",
      titulo: "Bar del Medio",
      fecha: "2026-09-10",
      horaInicio: "22:00",
      horaFin: "02:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 90000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-5",
      titulo: "Chabela",
      fecha: "2026-09-11",
      horaInicio: "22:00",
      horaFin: "03:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Chabela",
      estado: "pendiente",
      notas: "Por confirmar",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-6",
      titulo: "XN Amorcito",
      fecha: "2026-09-12",
      horaInicio: "22:00",
      horaFin: "03:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Santiago",
      ciudad: "Santiago",
      estado: "confirmada",
      notas: "XN Amorcito",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-7",
      titulo: "Bar del Medio",
      fecha: "2026-09-16",
      horaInicio: "21:00",
      horaFin: "01:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 50000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-8",
      titulo: "Klein",
      fecha: "2026-09-17",
      horaInicio: "22:00",
      horaFin: "03:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Klein",
      honorarios: 100000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-9",
      titulo: "Bar del Medio",
      fecha: "2026-09-19",
      horaInicio: "22:00",
      horaFin: "02:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 90000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-10",
      titulo: "Bar del Medio",
      fecha: "2026-09-23",
      horaInicio: "21:00",
      horaFin: "01:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 50000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-11",
      titulo: "Carrillo XS",
      fecha: "2026-09-24",
      horaInicio: "22:00",
      horaFin: "03:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Carrillo XS",
      estado: "pendiente",
      notas: "Por confirmar",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-12",
      titulo: "Bar del Medio",
      fecha: "2026-09-25",
      horaInicio: "22:00",
      horaFin: "02:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 90000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "fecha-dj-13",
      titulo: "Bar del Medio",
      fecha: "2026-09-30",
      horaInicio: "21:00",
      horaFin: "01:00",
      proyecto: "Rodrigo Valdivia",
      lugar: "Bar del Medio",
      honorarios: 50000,
      estado: "confirmada",
      notas: "",
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
  ];

  const notas: NotaAlumno[] = [];

  const notasRapidas: NotaRapida[] = [
    {
      id: "nota-rapida-setlist-1",
      titulo: "Setlist Club Subterráneo (Sokolov)",
      contenido:
        "• Intro: Ambient / Minimal (122 BPM)\n• Progresión: Deep Melodic Techno (125-127 BPM)\n• Peak: Tracks Sokolov + remixes exclusivos (128 BPM)\n• Cierre: Breakbeat atmosférico\n• Recordatorio: Llevar 2 pendrives USB formateados en FAT32 y cables RCA de respaldo.",
      categoria: "setlist",
      fijada: true,
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
    {
      id: "nota-rapida-pedagogica-1",
      titulo: "Recordatorio Pedagógico: Módulo de Independencia Rítmica",
      contenido:
        "• Imprimir esquemas de métricas 7/8 y 5/4 para alumnos ALMA.\n• Preparar audio de referencia con claqueta acentuada para Claudio y Pablo.\n• Revisar grabaciones de la última mentoría de La Escalera antes del sábado.",
      categoria: "pedagogica",
      fijada: true,
      createdAt: defaultIso,
      updatedAt: defaultIso,
    },
  ];

  const preferencias: Preferencias = {
    recordatoriosActivos: true,
    recordatorios: "ambos",
    proximaVistaDias: 30,
  };

  return { alumnos, clases, tocatas, notas, notasRapidas, preferencias };
}

interface AgendaContextType {
  alumnos: Alumno[];
  clases: Clase[];
  tocatas: Tocata[];
  notas: NotaAlumno[];
  notasRapidas: NotaRapida[];
  preferencias: Preferencias;
  loadingData: boolean;

  // Student operations
  addAlumno: (
    alumno: Omit<Alumno, "id" | "createdAt" | "updatedAt">
  ) => Promise<Alumno>;
  updateAlumno: (
    id: string,
    alumno: Partial<Omit<Alumno, "id" | "createdAt" | "updatedAt">>
  ) => Promise<void>;
  deleteAlumno: (id: string) => Promise<void>;
  getAlumnoById: (id: string) => Alumno | undefined;

  // Note operations
  addNota: (
    nota: Omit<NotaAlumno, "id" | "createdAt" | "updatedAt">
  ) => Promise<NotaAlumno>;
  updateNota: (id: string, texto: string) => Promise<void>;
  deleteNota: (id: string) => Promise<void>;
  getNotasByAlumnoId: (alumnoId: string) => NotaAlumno[];

  // Quick Notes operations (Setlists / Pedagógicas / Ideas)
  addNotaRapida: (
    nota: Omit<NotaRapida, "id" | "createdAt" | "updatedAt">
  ) => Promise<NotaRapida>;
  updateNotaRapida: (
    id: string,
    data: Partial<Omit<NotaRapida, "id" | "createdAt" | "updatedAt">>
  ) => Promise<void>;
  deleteNotaRapida: (id: string) => Promise<void>;

  // Class operations
  addClase: (
    clase: Omit<Clase, "id" | "createdAt" | "updatedAt">,
    authorizedLink?: AgendaAuthorizedLink
  ) => Promise<Clase>;
  updateClase: (
    id: string,
    clase: Partial<Omit<Clase, "id" | "createdAt" | "updatedAt">>,
    precondition?: AgendaEditPrecondition | null
  ) => Promise<void>;
  deleteClase: (
    id: string,
    precondition?: AgendaEditPrecondition | null
  ) => Promise<void>;
  captureEditPrecondition: (
    kindOrEntity: "clase" | "tocata" | Clase | Tocata,
    maybeEntity?: Clase | Tocata
  ) => AgendaEditPrecondition | null;
  getClaseById: (id: string) => Clase | undefined;
  getClasesByAlumnoId: (alumnoId: string) => Clase[];

  // Tocata operations
  addTocata: (
    tocata: Omit<Tocata, "id" | "createdAt" | "updatedAt">,
    authorizedLink?: AgendaAuthorizedLink
  ) => Promise<Tocata>;
  updateTocata: (
    id: string,
    tocata: Partial<Omit<Tocata, "id" | "createdAt" | "updatedAt">>,
    precondition?: AgendaEditPrecondition | null
  ) => Promise<void>;
  deleteTocata: (
    id: string,
    precondition?: AgendaEditPrecondition | null
  ) => Promise<void>;
  getTocataById: (id: string) => Tocata | undefined;

  // Google Calendar Integration
  enableEntityCalendarLink: (
    entityType: "clase" | "tocata",
    entityId: string,
    authorizedLink: AgendaAuthorizedLink
  ) => Promise<void>;
  disableEntityCalendarLink: (
    entityType: "clase" | "tocata",
    entityId: string
  ) => Promise<void>;
  retryEntityCalendarSync: (
    entityType: "clase" | "tocata",
    entityId: string
  ) => Promise<void>;
  calendarSyncJobs: Record<string, GoogleCalendarSyncJob>;

  // Preferences
  updatePreferencias: (pref: Partial<Preferencias>) => Promise<void>;

  // Data management & Cloud Migration
  exportarRespaldo: () => RespaldoProfesorAgenda;
  exportarRespaldoFirestore: () => Promise<RespaldoProfesorAgenda>;
  importarRespaldo: (data: RespaldoProfesorAgenda) => Promise<boolean>;
  borrarTodosLosDatos: () => Promise<void>;
  restaurarDatosDemostracion: () => Promise<void>;

  // Migration from localStorage to Firestore
  isMigrationModalOpen: boolean;
  localSummary: {
    alumnosCount: number;
    clasesCount: number;
    tocatasCount: number;
  };
  migrateLocalDataToFirestore: () => Promise<void>;
  skipMigrationAndSeedDemo: () => Promise<void>;

  // Real-time Firestore Sync Status
  syncStatus: FirestoreSyncStatus;
  lastSyncTime: Date | null;
  sincronizarAhora: () => Promise<void>;

  // Queries
  proximaClase: ActividadUnificada | null;
  proximaTocata: ActividadUnificada | null;
  actividadesHoy: ActividadUnificada[];
  actividadesManana: ActividadUnificada[];
  actividadesProximas: ActividadUnificada[];
  getActividadesPorFecha: (fechaIso: string) => ActividadUnificada[];
  getAllActividades: () => ActividadUnificada[];
}

const AgendaContext = createContext<AgendaContextType | undefined>(undefined);

export const AgendaProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser, calendarAuth } = useAuth();

  // In-memory states with localStorage initial fallback
  const [calendarSyncJobs, setCalendarSyncJobs] = useState<
    Record<string, GoogleCalendarSyncJob>
  >({});
  const workerRef = useRef<CalendarSyncWorker | null>(null);

  const calendarSyncStorage = useMemo(
    () =>
      new FirestoreCalendarSyncStorage({
        db,
        doc,
        runTransaction,
      }),
    []
  );

  const persistenceDeps = useMemo<AgendaCalendarPersistenceDependencies>(() => {
    return {
      store: calendarSyncStorage,
      now: () => Date.now(),
    };
  }, [calendarSyncStorage]);

  useEffect(() => {
    if (calendarAuth.status === "authorized_temporarily" && workerRef.current) {
      workerRef.current.triggerPendingJobs(Object.values(calendarSyncJobs));
    }
  }, [calendarAuth.status]);
  const [alumnos, setAlumnos] = useState<Alumno[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ALUMNOS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading alumnos from storage", e);
    }
    return [];
  });

  const [clases, setClases] = useState<Clase[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CLASES);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading clases from storage", e);
    }
    return [];
  });

  const [tocatas, setTocatas] = useState<Tocata[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.TOCATAS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading tocatas from storage", e);
    }
    return [];
  });

  const [notas, setNotas] = useState<NotaAlumno[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.NOTAS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading notas from storage", e);
    }
    return [];
  });

  const [notasRapidas, setNotasRapidas] = useState<NotaRapida[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.NOTAS_RAPIDAS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading notasRapidas from storage", e);
    }
    return [];
  });

  const [preferencias, setPreferencias] = useState<Preferencias>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PREFERENCIAS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Error reading preferencias from storage", e);
    }
    return {
      recordatoriosActivos: true,
      recordatorios: "ambos",
      proximaVistaDias: 30,
    };
  });

  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<FirestoreSyncStatus>(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return "offline";
    }
    return currentUser ? "syncing" : "offline";
  });
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(() => {
    try {
      const stored = localStorage.getItem("profesor_agenda_last_sync");
      if (stored) {
        const d = new Date(stored);
        if (!isNaN(d.getTime())) return d;
      }
    } catch {}
    return null;
  });
  const [syncKey, setSyncKey] = useState(0);

  // Clean obsolete alert delivery records (> 7 days) without affecting user data
  useEffect(() => {
    cleanExpiredAlertStorage();
  }, []);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [localSummary, setLocalSummary] = useState({
    alumnosCount: 0,
    clasesCount: 0,
    tocatasCount: 0,
  });

  // Handle browser and Firestore network state changes
  useEffect(() => {
    const handleOnline = () => {
      if (currentUser) {
        setSyncStatus("syncing");
        enableFirestoreNetwork().then((ok) => {
          if (ok) setSyncStatus("connected");
        });
      } else {
        setSyncStatus("offline");
      }
    };

    const handleOffline = () => {
      setSyncStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [currentUser]);

  // Ensure initial demo data exists in localStorage for fresh installs
  useEffect(() => {
    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!initialized) {
      const demo = createInitialDemoData();
      setAlumnos(demo.alumnos);
      setClases(demo.clases);
      setTocatas(demo.tocatas);
      setNotas(demo.notas);
      setNotasRapidas(demo.notasRapidas);
      setPreferencias(demo.preferencias);
      localStorage.setItem(STORAGE_KEYS.ALUMNOS, JSON.stringify(demo.alumnos));
      localStorage.setItem(STORAGE_KEYS.CLASES, JSON.stringify(demo.clases));
      localStorage.setItem(STORAGE_KEYS.TOCATAS, JSON.stringify(demo.tocatas));
      localStorage.setItem(STORAGE_KEYS.NOTAS, JSON.stringify(demo.notas));
      localStorage.setItem(
        STORAGE_KEYS.NOTAS_RAPIDAS,
        JSON.stringify(demo.notasRapidas)
      );
      localStorage.setItem(
        STORAGE_KEYS.PREFERENCIAS,
        JSON.stringify(demo.preferencias)
      );
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, "true");
    } else {
      // If initialized before without notas_rapidas, seed default quick notes
      const existingNotasRapidas = localStorage.getItem(STORAGE_KEYS.NOTAS_RAPIDAS);
      if (!existingNotasRapidas) {
        const demo = createInitialDemoData();
        setNotasRapidas(demo.notasRapidas);
        localStorage.setItem(
          STORAGE_KEYS.NOTAS_RAPIDAS,
          JSON.stringify(demo.notasRapidas)
        );
      }
    }
  }, []);

  // Sync state to localStorage cache whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ALUMNOS, JSON.stringify(alumnos));
      localStorage.setItem(STORAGE_KEYS.CLASES, JSON.stringify(clases));
      localStorage.setItem(STORAGE_KEYS.TOCATAS, JSON.stringify(tocatas));
      localStorage.setItem(STORAGE_KEYS.NOTAS, JSON.stringify(notas));
      localStorage.setItem(
        STORAGE_KEYS.NOTAS_RAPIDAS,
        JSON.stringify(notasRapidas)
      );
      localStorage.setItem(
        STORAGE_KEYS.PREFERENCIAS,
        JSON.stringify(preferencias)
      );
    } catch (e) {
      console.error("Error updating local cache", e);
    }
  }, [alumnos, clases, tocatas, notas, notasRapidas, preferencias]);

  // Firestore Real-time Subscriptions & Migration Check
  useEffect(() => {
    if (!currentUser) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const uid = currentUser.uid;

    const alumnosCol = collection(db, "users", uid, "alumnos");
    const clasesCol = collection(db, "users", uid, "clases");
    const tocatasCol = collection(db, "users", uid, "tocatas");
    const notasCol = collection(db, "users", uid, "notas");
    const notasRapidasCol = collection(db, "users", uid, "notasRapidas");
    const prefsDocRef = doc(db, "users", uid, "configuracion", "preferencias");

    // 1. Check if Firestore is completely empty for this user and local storage has data
    const checkMigrationNeeded = async () => {
      try {
        await enableFirestoreNetwork();

        const [alumnosSnap, clasesSnap, tocatasSnap] = await Promise.all([
          getDocs(alumnosCol),
          getDocs(clasesCol),
          getDocs(tocatasCol),
        ]);

        const firestoreIsEmpty =
          alumnosSnap.empty && clasesSnap.empty && tocatasSnap.empty;

        if (firestoreIsEmpty) {
          // Read local storage to see what we have
          let localAlumnos: Alumno[] = [];
          let localClases: Clase[] = [];
          let localTocatas: Tocata[] = [];

          try {
            const aStr = localStorage.getItem(STORAGE_KEYS.ALUMNOS);
            if (aStr) localAlumnos = JSON.parse(aStr);
            const cStr = localStorage.getItem(STORAGE_KEYS.CLASES);
            if (cStr) localClases = JSON.parse(cStr);
            const tStr = localStorage.getItem(STORAGE_KEYS.TOCATAS);
            if (tStr) localTocatas = JSON.parse(tStr);
          } catch (e) {
            console.warn("Could not parse local data for migration check:", e);
          }

          if (
            localAlumnos.length > 0 ||
            localClases.length > 0 ||
            localTocatas.length > 0
          ) {
            setLocalSummary({
              alumnosCount: localAlumnos.length,
              clasesCount: localClases.length,
              tocatasCount: localTocatas.length,
            });
            setIsMigrationModalOpen(true);
          } else {
            // Seed initial demo data directly to Firestore
            const demo = createInitialDemoData();
            await seedDataToFirestore(uid, demo);
          }
        }
      } catch (err) {
        console.error("Error during Firestore migration check:", err);
      } finally {
        setLoadingData(false);
      }
    };

    checkMigrationNeeded();

    // 2. Real-time Listeners (onSnapshot with metadata changes)
    const recordSuccessfulSync = () => {
      if (navigator.onLine) {
        setSyncStatus("connected");
      }
      const syncDate = new Date();
      setLastSyncTime(syncDate);
      try {
        localStorage.setItem("profesor_agenda_last_sync", syncDate.toISOString());
      } catch {}
    };

    const unsubAlumnos = onSnapshot(
      alumnosCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const items: Alumno[] = [];
        snapshot.forEach((d) => items.push(d.data() as Alumno));
        setAlumnos(items);
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/alumnos`
        );
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const unsubClases = onSnapshot(
      clasesCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const items: Clase[] = [];
        snapshot.forEach((d) => items.push(d.data() as Clase));
        setClases(items);
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/clases`
        );
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const unsubTocatas = onSnapshot(
      tocatasCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const items: Tocata[] = [];
        snapshot.forEach((d) => items.push(d.data() as Tocata));
        setTocatas(items);
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/tocatas`
        );
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const unsubNotas = onSnapshot(
      notasCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const items: NotaAlumno[] = [];
        snapshot.forEach((d) => items.push(d.data() as NotaAlumno));
        setNotas(items);
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/notas`);
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const unsubNotasRapidas = onSnapshot(
      notasRapidasCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const items: NotaRapida[] = [];
        snapshot.forEach((d) => items.push(d.data() as NotaRapida));
        // Sort with fijada first, then updatedAt desc
        items.sort((a, b) => {
          if (a.fijada && !b.fijada) return -1;
          if (!a.fijada && b.fijada) return 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
        setNotasRapidas(items);
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/notasRapidas`
        );
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const unsubPrefs = onSnapshot(
      prefsDocRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.exists()) {
          setPreferencias(snapshot.data() as Preferencias);
        }
        recordSuccessfulSync();
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `users/${uid}/configuracion/preferencias`
        );
        setSyncStatus("offline");
        setLoadingData(false);
      }
    );

    const calendarAdapter = createGoogleCalendarSyncCalendar(() =>
      getGoogleCalendarAccessToken(auth?.currentUser ?? currentUser)
    );

    const worker = new CalendarSyncWorker({
      deps: {
        store: persistenceDeps.store,
        calendar: calendarAdapter,
        now: () => Date.now(),
      },
      uid,
      isTokenAvailable: () =>
        hasGoogleCalendarAccessToken(auth?.currentUser ?? currentUser),
    });

    workerRef.current = worker;

    const jobsCol = collection(db, "users", uid, "calendarSyncJobs");
    const unsubJobs = onSnapshot(
      jobsCol,
      { includeMetadataChanges: true },
      (snapshot) => {
        const jobsMap: Record<string, GoogleCalendarSyncJob> = {};
        const jobsList: GoogleCalendarSyncJob[] = [];
        snapshot.forEach((d) => {
          const job = d.data() as GoogleCalendarSyncJob;
          jobsMap[job.id] = job;
          jobsList.push(job);
        });
        setCalendarSyncJobs(jobsMap);
        worker.handleJobsUpdated(jobsList);
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/calendarSyncJobs`
        );
      }
    );

    return () => {
      unsubAlumnos();
      unsubClases();
      unsubTocatas();
      unsubNotas();
      unsubNotasRapidas();
      unsubPrefs();
      unsubJobs();
      worker.dispose();
      workerRef.current = null;
    };
  }, [currentUser, syncKey]);

  // Helper to write complete batch data to Firestore
  const seedDataToFirestore = async (
    uid: string,
    data: RespaldoProfesorAgenda | ReturnType<typeof createInitialDemoData>
  ) => {
    try {
      await enableFirestoreNetwork();
      const batch = writeBatch(db);

      (data.alumnos || []).forEach((a) => {
        const ref = doc(db, "users", uid, "alumnos", a.id);
        batch.set(ref, sanitizeForFirestore(a));
      });

      (data.clases || []).forEach((c) => {
        const ref = doc(db, "users", uid, "clases", c.id);
        batch.set(ref, sanitizeForFirestore(c));
      });

      (data.tocatas || []).forEach((t) => {
        const ref = doc(db, "users", uid, "tocatas", t.id);
        batch.set(ref, sanitizeForFirestore(t));
      });

      (data.notas || []).forEach((n) => {
        const ref = doc(db, "users", uid, "notas", n.id);
        batch.set(ref, sanitizeForFirestore(n));
      });

      (data.notasRapidas || []).forEach((nr) => {
        const ref = doc(db, "users", uid, "notasRapidas", nr.id);
        batch.set(ref, sanitizeForFirestore(nr));
      });

      const prefsRef = doc(db, "users", uid, "configuracion", "preferencias");
      batch.set(prefsRef, sanitizeForFirestore(data.preferencias || {}));

      const metadataRef = doc(db, "users", uid, "configuracion", "metadata");
      batch.set(metadataRef, {
        migratedAt: new Date().toISOString(),
        source: "backup_sync",
        version: 1,
      });

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    }
  };

  // Migration handlers
  const migrateLocalDataToFirestore = async () => {
    if (!currentUser) return;
    const currentBackup = exportarRespaldo();
    await seedDataToFirestore(currentUser.uid, currentBackup);
    setIsMigrationModalOpen(false);
  };

  const skipMigrationAndSeedDemo = async () => {
    if (!currentUser) return;
    const demo = createInitialDemoData();
    await seedDataToFirestore(currentUser.uid, demo);
    setIsMigrationModalOpen(false);
  };

  const sincronizarAhora = async (): Promise<void> => {
    if (!currentUser) return;
    try {
      setSyncStatus("syncing");
      await enableFirestoreNetwork();
      const uid = currentUser.uid;

      const [alumnosSnap, clasesSnap, tocatasSnap, notasSnap, notasRapidasSnap, prefsSnap] =
        await Promise.all([
          getDocs(collection(db, "users", uid, "alumnos")),
          getDocs(collection(db, "users", uid, "clases")),
          getDocs(collection(db, "users", uid, "tocatas")),
          getDocs(collection(db, "users", uid, "notas")),
          getDocs(collection(db, "users", uid, "notasRapidas")),
          getDoc(doc(db, "users", uid, "configuracion", "preferencias")),
        ]);

      const loadedAlumnos: Alumno[] = [];
      alumnosSnap.forEach((d) => loadedAlumnos.push(d.data() as Alumno));
      setAlumnos(loadedAlumnos);
      localStorage.setItem(STORAGE_KEYS.ALUMNOS, JSON.stringify(loadedAlumnos));

      const loadedClases: Clase[] = [];
      clasesSnap.forEach((d) => loadedClases.push(d.data() as Clase));
      setClases(loadedClases);
      localStorage.setItem(STORAGE_KEYS.CLASES, JSON.stringify(loadedClases));

      const loadedTocatas: Tocata[] = [];
      tocatasSnap.forEach((d) => loadedTocatas.push(d.data() as Tocata));
      setTocatas(loadedTocatas);
      localStorage.setItem(STORAGE_KEYS.TOCATAS, JSON.stringify(loadedTocatas));

      const loadedNotas: NotaAlumno[] = [];
      notasSnap.forEach((d) => loadedNotas.push(d.data() as NotaAlumno));
      setNotas(loadedNotas);
      localStorage.setItem(STORAGE_KEYS.NOTAS, JSON.stringify(loadedNotas));

      const loadedNotasRapidas: NotaRapida[] = [];
      notasRapidasSnap.forEach((d) => loadedNotasRapidas.push(d.data() as NotaRapida));
      loadedNotasRapidas.sort((a, b) => {
        if (a.fijada && !b.fijada) return -1;
        if (!a.fijada && b.fijada) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      setNotasRapidas(loadedNotasRapidas);
      localStorage.setItem(STORAGE_KEYS.NOTAS_RAPIDAS, JSON.stringify(loadedNotasRapidas));

      if (prefsSnap.exists()) {
        const loadedPrefs = prefsSnap.data() as Preferencias;
        setPreferencias(loadedPrefs);
        localStorage.setItem(STORAGE_KEYS.PREFERENCIAS, JSON.stringify(loadedPrefs));
      }

      const syncDate = new Date();
      setLastSyncTime(syncDate);
      try {
        localStorage.setItem("profesor_agenda_last_sync", syncDate.toISOString());
      } catch {}
      setSyncStatus("connected");

      // Trigger listener reconnections
      setSyncKey((k) => k + 1);
    } catch (e) {
      console.error("Error al sincronizar ahora con Cloud Firestore:", e);
      setSyncStatus("offline");
    }
  };

  // Student operations
  const addAlumno = async (
    data: Omit<Alumno, "id" | "createdAt" | "updatedAt">
  ): Promise<Alumno> => {
    if (!currentUser) {
      throw new Error("Inicia sesión para guardar cambios.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Sin conexión. Comprueba tu conexión antes de guardar.");
    }

    const nowIso = new Date().toISOString();
    const newAlumno: Alumno = {
      ...data,
      id: generateUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const path = `users/${currentUser.uid}/alumnos/${newAlumno.id}`;
    try {
      await Promise.race([
        setDoc(
          doc(db, "users", currentUser.uid, "alumnos", newAlumno.id),
          cleanForFirestore(newAlumno)
        ),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Sin conexión. Comprueba tu conexión antes de guardar."
                )
              ),
            12000
          )
        ),
      ]);
      setAlumnos((prev) => {
        if (prev.some((a) => a.id === newAlumno.id)) return prev;
        return [...prev, newAlumno];
      });
      return newAlumno;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Sin conexión") ||
          error.message.includes("Inicia sesión"))
      ) {
        throw error;
      }
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const updateAlumno = async (
    id: string,
    data: Partial<Omit<Alumno, "id" | "createdAt" | "updatedAt">>
  ): Promise<void> => {
    if (!currentUser) {
      throw new Error("Inicia sesión para guardar cambios.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Sin conexión. Comprueba tu conexión antes de guardar.");
    }

    const nowIso = new Date().toISOString();
    const updatedPayload = { ...data, updatedAt: nowIso };

    const path = `users/${currentUser.uid}/alumnos/${id}`;
    try {
      await Promise.race([
        updateDoc(
          doc(db, "users", currentUser.uid, "alumnos", id),
          cleanForFirestore(updatedPayload)
        ),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Sin conexión. Comprueba tu conexión antes de guardar."
                )
              ),
            12000
          )
        ),
      ]);
      setAlumnos((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updatedPayload } : a))
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Sin conexión") ||
          error.message.includes("Inicia sesión"))
      ) {
        throw error;
      }
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deleteAlumno = async (id: string): Promise<void> => {
    if (currentUser) {
      const path = `users/${currentUser.uid}/alumnos/${id}`;
      try {
        const batch = writeBatch(db);
        // 1. Delete student document
        batch.delete(doc(db, "users", currentUser.uid, "alumnos", id));

        // 2. Query and delete all associated classes in Firestore
        const clasesRef = collection(db, "users", currentUser.uid, "clases");
        const clasesQuery = query(clasesRef, where("alumnoId", "==", id));
        const clasesSnap = await getDocs(clasesQuery);
        clasesSnap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });

        // 3. Query and delete all associated notes in Firestore
        const notasRef = collection(db, "users", currentUser.uid, "notas");
        const notasQuery = query(notasRef, where("alumnoId", "==", id));
        const notasSnap = await getDocs(notasQuery);
        notasSnap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });

        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
    // Update local state in all cases
    setAlumnos((prev) => prev.filter((a) => a.id !== id));
    setClases((prev) => prev.filter((c) => c.alumnoId !== id));
    setNotas((prev) => prev.filter((n) => n.alumnoId !== id));
  };

  const getAlumnoById = (id: string): Alumno | undefined => {
    return alumnos.find((a) => a.id === id);
  };

  // Nota operations
  const addNota = async (
    data: Omit<NotaAlumno, "id" | "createdAt" | "updatedAt">
  ): Promise<NotaAlumno> => {
    const nowIso = new Date().toISOString();
    const newNota: NotaAlumno = {
      ...data,
      id: generateUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (currentUser) {
      const path = `users/${currentUser.uid}/notas/${newNota.id}`;
      try {
        await setDoc(
          doc(db, "users", currentUser.uid, "notas", newNota.id),
          cleanForFirestore(newNota)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else {
      setNotas((prev) => [newNota, ...prev]);
    }
    return newNota;
  };

  const updateNota = async (id: string, texto: string): Promise<void> => {
    const nowIso = new Date().toISOString();
    if (currentUser) {
      const path = `users/${currentUser.uid}/notas/${id}`;
      try {
        await updateDoc(
          doc(db, "users", currentUser.uid, "notas", id),
          cleanForFirestore({
            texto,
            updatedAt: nowIso,
          })
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } else {
      setNotas((prev) =>
        prev.map((n) => (n.id === id ? { ...n, texto, updatedAt: nowIso } : n))
      );
    }
  };

  const deleteNota = async (id: string): Promise<void> => {
    if (currentUser) {
      const path = `users/${currentUser.uid}/notas/${id}`;
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "notas", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    } else {
      setNotas((prev) => prev.filter((n) => n.id !== id));
    }
  };

  const getNotasByAlumnoId = (alumnoId: string): NotaAlumno[] => {
    return notas
      .filter((n) => n.alumnoId === alumnoId)
      .sort(
        (a, b) =>
          b.fecha.localeCompare(a.fecha) ||
          b.createdAt.localeCompare(a.createdAt)
      );
  };

  // Quick Notes operations (Setlists / Pedagógicas / Ideas)
  const addNotaRapida = async (
    data: Omit<NotaRapida, "id" | "createdAt" | "updatedAt">
  ): Promise<NotaRapida> => {
    const nowIso = new Date().toISOString();
    const newNota: NotaRapida = {
      ...data,
      id: generateUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (currentUser) {
      const path = `users/${currentUser.uid}/notasRapidas/${newNota.id}`;
      try {
        await setDoc(
          doc(db, "users", currentUser.uid, "notasRapidas", newNota.id),
          cleanForFirestore(newNota)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else {
      setNotasRapidas((prev) => [newNota, ...prev]);
    }
    return newNota;
  };

  const updateNotaRapida = async (
    id: string,
    data: Partial<Omit<NotaRapida, "id" | "createdAt" | "updatedAt">>
  ): Promise<void> => {
    const nowIso = new Date().toISOString();
    const updatedPayload = { ...data, updatedAt: nowIso };

    if (currentUser) {
      const path = `users/${currentUser.uid}/notasRapidas/${id}`;
      try {
        await updateDoc(
          doc(db, "users", currentUser.uid, "notasRapidas", id),
          cleanForFirestore(updatedPayload)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } else {
      setNotasRapidas((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updatedPayload } : n))
      );
    }
  };

  const deleteNotaRapida = async (id: string): Promise<void> => {
    if (currentUser) {
      const path = `users/${currentUser.uid}/notasRapidas/${id}`;
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "notasRapidas", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    } else {
      setNotasRapidas((prev) => prev.filter((n) => n.id !== id));
    }
  };

  const extractMutationError = (res: AgendaCalendarMutationResult) => {
    const details = "details" in res ? res.details : undefined;
    const suggestion = "suggestion" in res ? res.suggestion : undefined;
    const field = "field" in res ? res.field : undefined;
    return { details, suggestion, field };
  };

  // Clase operations
  const addClase = async (
    data: Omit<Clase, "id" | "createdAt" | "updatedAt">,
    authorizedLink?: AgendaAuthorizedLink
  ): Promise<Clase> => {
    const newId = generateUUID();
    const nowIso = new Date().toISOString();

    if (currentUser) {
      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        currentUser.uid,
        {
          operation: "create",
          entityType: "clase",
          entityId: newId,
          data: stripUndefined(data) as any,
          ...(authorizedLink ? { authorizedLink } : {}),
        }
      );

      if (result.status === "applied" && result.entity) {
        const createdClase = result.entity as Clase;
        setClases((prev) => [...prev, createdClase]);
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
        return createdClase;
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      const newClase: Clase = {
        ...data,
        id: newId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setClases((prev) => [...prev, newClase]);
      return newClase;
    }
  };

  const captureEditPrecondition = (
    kindOrEntity: "clase" | "tocata" | Clase | Tocata,
    maybeEntity?: Clase | Tocata
  ): AgendaEditPrecondition | null => {
    let kind: "clase" | "tocata";
    let entity: Clase | Tocata;

    if (maybeEntity !== undefined) {
      kind = kindOrEntity as "clase" | "tocata";
      entity = maybeEntity;
    } else {
      entity = kindOrEntity as Clase | Tocata;
      if (!entity) return null;
      kind = "alumnoId" in entity ? "clase" : "tocata";
    }
    if (!entity) return null;

    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;

    return {
      id: entity.id,
      kind,
      updatedAt: entity.updatedAt || new Date().toISOString(),
      snapshot: JSON.parse(JSON.stringify(entity)),
      uid: activeUid,
    };
  };

  const updateClase = async (
    id: string,
    data: Partial<Omit<Clase, "id" | "createdAt" | "updatedAt">>,
    precondition?: AgendaEditPrecondition | null
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (activeUid) {
      if (precondition && precondition.uid && precondition.uid !== activeUid) {
        throw new AgendaCrudError("conflict");
      }

      let preconditionVersion = precondition?.version;
      if (!preconditionVersion && precondition?.snapshot) {
        preconditionVersion = await agendaEntityVersion(precondition.snapshot, {
          entityType: "clase",
          entityId: id,
        });
      }
      if (!preconditionVersion) {
        const currentClase = clases.find((c) => c.id === id);
        if (currentClase) {
          preconditionVersion = await agendaEntityVersion(currentClase, {
            entityType: "clase",
            entityId: id,
          });
        }
      }
      if (!preconditionVersion) {
        throw new AgendaCrudError(
          "invalid_argument",
          "No se pudo determinar la versión previa de la clase",
          "Falta la versión previa (preconditionVersion) para realizar la actualización atómica.",
          "Cierra el modal, recarga la agenda e intenta guardar los cambios nuevamente."
        );
      }

      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        activeUid,
        {
          operation: "update",
          entityType: "clase",
          entityId: id,
          preconditionVersion,
          patch: stripUndefined(data) as any,
        }
      );

      if (result.status === "applied" && result.entity) {
        setClases((prev) =>
          prev.map((c) => (c.id === id ? (result.entity as Clase) : c))
        );
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
      } else if (result.status === "noop") {
        return;
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "not_found") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("not_found", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      const existing = clases.find((c) => c.id === id);
      if (!existing) {
        throw new AgendaCrudError("not_found", undefined, "La clase a actualizar no existe en el almacenamiento local.", "Recarga la vista.");
      }
      const nowIso = new Date().toISOString();
      const updatedPayload = { ...data, updatedAt: nowIso };
      setClases((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updatedPayload } : c))
      );
    }
  };

  const deleteClase = async (
    id: string,
    precondition?: AgendaEditPrecondition | null
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (activeUid) {
      if (precondition && precondition.uid && precondition.uid !== activeUid) {
        throw new AgendaCrudError("conflict", undefined, "La precondición de eliminación pertenece a otro usuario.", "Inicia sesión con el usuario correspondiente.");
      }

      const currentClase = clases.find((c) => c.id === id);
      let preconditionVersion = precondition?.version;
      if (!preconditionVersion && precondition?.snapshot) {
        preconditionVersion = await agendaEntityVersion(precondition.snapshot, {
          entityType: "clase",
          entityId: id,
        });
      }
      if (!preconditionVersion && currentClase) {
        preconditionVersion = await agendaEntityVersion(currentClase, {
          entityType: "clase",
          entityId: id,
        });
      }
      if (!preconditionVersion) {
        throw new AgendaCrudError(
          "invalid_argument",
          "No se pudo determinar la versión previa de la clase",
          "Falta la versión previa requerida para eliminar la clase de forma segura.",
          "Cierra el modal, recarga la agenda y vuelve a intentar."
        );
      }

      const snapshotBinding =
        (precondition?.snapshot && "googleCalendar" in precondition.snapshot
          ? (precondition.snapshot as any).googleCalendar
          : undefined) ?? currentClase?.googleCalendar;

      const expectedLink =
        snapshotBinding?.enabled && snapshotBinding?.googleAccountId
          ? {
              googleAccountId: snapshotBinding.googleAccountId,
              calendarId: "primary" as const,
            }
          : undefined;

      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        activeUid,
        {
          operation: "delete",
          entityType: "clase",
          entityId: id,
          preconditionVersion,
          ...(expectedLink ? { expectedLink } : {}),
        }
      );

      if (result.status === "applied" || result.status === "noop") {
        setClases((prev) => prev.filter((c) => c.id !== id));
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "not_found") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("not_found", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      setClases((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const getClaseById = (id: string): Clase | undefined => {
    return clases.find((c) => c.id === id);
  };

  const getClasesByAlumnoId = (alumnoId: string): Clase[] => {
    return clases
      .filter((c) => c.alumnoId === alumnoId)
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          a.horaInicio.localeCompare(b.horaInicio)
      );
  };

  // Tocata operations
  const addTocata = async (
    data: Omit<Tocata, "id" | "createdAt" | "updatedAt">,
    authorizedLink?: AgendaAuthorizedLink
  ): Promise<Tocata> => {
    const newId = generateUUID();
    const nowIso = new Date().toISOString();

    if (currentUser) {
      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        currentUser.uid,
        {
          operation: "create",
          entityType: "tocata",
          entityId: newId,
          data: stripUndefined(data) as any,
          ...(authorizedLink ? { authorizedLink } : {}),
        }
      );

      if (result.status === "applied" && result.entity) {
        const createdTocata = result.entity as Tocata;
        setTocatas((prev) => [...prev, createdTocata]);
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
        return createdTocata;
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      const newTocata: Tocata = {
        ...data,
        id: newId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setTocatas((prev) => [...prev, newTocata]);
      return newTocata;
    }
  };

  const updateTocata = async (
    id: string,
    data: Partial<Omit<Tocata, "id" | "createdAt" | "updatedAt">>,
    precondition?: AgendaEditPrecondition | null
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (activeUid) {
      if (precondition && precondition.uid && precondition.uid !== activeUid) {
        throw new AgendaCrudError("conflict", undefined, "La precondición pertenece a otra sesión.", "Inicia sesión con la cuenta correcta.");
      }

      let preconditionVersion = precondition?.version;
      if (!preconditionVersion && precondition?.snapshot) {
        preconditionVersion = await agendaEntityVersion(precondition.snapshot, {
          entityType: "tocata",
          entityId: id,
        });
      }
      if (!preconditionVersion) {
        const currentTocata = tocatas.find((t) => t.id === id);
        if (currentTocata) {
          preconditionVersion = await agendaEntityVersion(currentTocata, {
            entityType: "tocata",
            entityId: id,
          });
        }
      }
      if (!preconditionVersion) {
        throw new AgendaCrudError(
          "invalid_argument",
          "No se pudo determinar la versión previa de la tocata",
          "Falta la versión previa requerida para actualizar la tocata de forma atómica.",
          "Cierra el modal, recarga la agenda e inténtalo de nuevo."
        );
      }

      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        activeUid,
        {
          operation: "update",
          entityType: "tocata",
          entityId: id,
          preconditionVersion,
          patch: stripUndefined(data) as any,
        }
      );

      if (result.status === "applied" && result.entity) {
        setTocatas((prev) =>
          prev.map((t) => (t.id === id ? (result.entity as Tocata) : t))
        );
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
      } else if (result.status === "noop") {
        return;
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "not_found") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("not_found", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      const existing = tocatas.find((t) => t.id === id);
      if (!existing) {
        throw new AgendaCrudError("not_found", undefined, "La tocata a actualizar no existe localmente.", "Recarga la vista.");
      }
      const nowIso = new Date().toISOString();
      const updatedPayload = { ...data, updatedAt: nowIso };
      setTocatas((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updatedPayload } : t))
      );
    }
  };

  const deleteTocata = async (
    id: string,
    precondition?: AgendaEditPrecondition | null
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (activeUid) {
      if (precondition && precondition.uid && precondition.uid !== activeUid) {
        throw new AgendaCrudError("conflict", undefined, "La precondición de eliminación pertenece a otra sesión.", "Inicia sesión con la cuenta correspondiente.");
      }

      const currentTocata = tocatas.find((t) => t.id === id);
      let preconditionVersion = precondition?.version;
      if (!preconditionVersion && precondition?.snapshot) {
        preconditionVersion = await agendaEntityVersion(precondition.snapshot, {
          entityType: "tocata",
          entityId: id,
        });
      }
      if (!preconditionVersion && currentTocata) {
        preconditionVersion = await agendaEntityVersion(currentTocata, {
          entityType: "tocata",
          entityId: id,
        });
      }
      if (!preconditionVersion) {
        throw new AgendaCrudError(
          "invalid_argument",
          "No se pudo determinar la versión previa de la tocata",
          "Falta la versión previa requerida para eliminar la tocata de forma atómica.",
          "Cierra el modal, recarga la agenda e inténtalo de nuevo."
        );
      }

      const snapshotBinding =
        (precondition?.snapshot && "googleCalendar" in precondition.snapshot
          ? (precondition.snapshot as any).googleCalendar
          : undefined) ?? currentTocata?.googleCalendar;

      const expectedLink =
        snapshotBinding?.enabled && snapshotBinding?.googleAccountId
          ? {
              googleAccountId: snapshotBinding.googleAccountId,
              calendarId: "primary" as const,
            }
          : undefined;

      const result = await persistAgendaCalendarMutation(
        persistenceDeps,
        activeUid,
        {
          operation: "delete",
          entityType: "tocata",
          entityId: id,
          preconditionVersion,
          ...(expectedLink ? { expectedLink } : {}),
        }
      );

      if (result.status === "applied" || result.status === "noop") {
        setTocatas((prev) => prev.filter((t) => t.id !== id));
        if ("jobId" in result && result.jobId) {
          void workerRef.current?.processJob(result.jobId);
        }
      } else if (result.status === "conflict") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("conflict", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "not_found") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("not_found", undefined, errInfo.details, errInfo.suggestion);
      } else if (result.status === "invalid_argument") {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("invalid_argument", undefined, errInfo.details, errInfo.suggestion, errInfo.field);
      } else {
        const errInfo = extractMutationError(result);
        throw new AgendaCrudError("storage_failure", undefined, errInfo.details, errInfo.suggestion);
      }
    } else {
      setTocatas((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const getTocataById = (id: string): Tocata | undefined => {
    return tocatas.find((t) => t.id === id);
  };

  // Google Calendar Link Operations
  const enableEntityCalendarLink = async (
    entityType: "clase" | "tocata",
    entityId: string,
    authorizedLink: AgendaAuthorizedLink
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (!activeUid) throw new AgendaCrudError("invalid_argument");
    const entity =
      entityType === "clase"
        ? clases.find((c) => c.id === entityId)
        : tocatas.find((t) => t.id === entityId);
    if (!entity) throw new AgendaCrudError("not_found");

    const version = await agendaEntityVersion(entity, { entityType, entityId });
    const result = await enableCalendarLink(
      persistenceDeps,
      activeUid,
      { entityType, entityId },
      version,
      authorizedLink
    );

    if ("entity" in result) {
      if (entityType === "clase") {
        setClases((prev) =>
          prev.map((c) => (c.id === entityId ? (result.entity as Clase) : c))
        );
      } else {
        setTocatas((prev) =>
          prev.map((t) => (t.id === entityId ? (result.entity as Tocata) : t))
        );
      }
      if (result.jobId) {
        void workerRef.current?.processJob(result.jobId);
      }
    } else if (result.status === "conflict") {
      throw new AgendaCrudError("conflict");
    } else if (result.status === "invalid_argument") {
      throw new AgendaCrudError("invalid_argument");
    } else {
      throw new AgendaCrudError("storage_failure");
    }
  };

  const disableEntityCalendarLink = async (
    entityType: "clase" | "tocata",
    entityId: string
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (!activeUid) throw new AgendaCrudError("invalid_argument");
    const entity =
      entityType === "clase"
        ? clases.find((c) => c.id === entityId)
        : tocatas.find((t) => t.id === entityId);
    if (!entity) throw new AgendaCrudError("not_found");

    const version = await agendaEntityVersion(entity, { entityType, entityId });
    const result = await disableCalendarLink(
      persistenceDeps,
      activeUid,
      { entityType, entityId },
      version
    );

    if ("entity" in result) {
      if (entityType === "clase") {
        setClases((prev) =>
          prev.map((c) => (c.id === entityId ? (result.entity as Clase) : c))
        );
      } else {
        setTocatas((prev) =>
          prev.map((t) => (t.id === entityId ? (result.entity as Tocata) : t))
        );
      }
      if (result.jobId) {
        void workerRef.current?.processJob(result.jobId);
      }
    } else if (result.status === "conflict") {
      throw new AgendaCrudError("conflict");
    } else if (result.status === "invalid_argument") {
      throw new AgendaCrudError("invalid_argument");
    } else {
      throw new AgendaCrudError("storage_failure");
    }
  };

  const retryEntityCalendarSync = async (
    entityType: "clase" | "tocata",
    entityId: string
  ): Promise<void> => {
    const activeUid = auth?.currentUser?.uid ?? currentUser?.uid;
    if (!activeUid) throw new AgendaCrudError("invalid_argument");
    const entity =
      entityType === "clase"
        ? clases.find((c) => c.id === entityId)
        : tocatas.find((t) => t.id === entityId);
    if (!entity) throw new AgendaCrudError("not_found");

    const version = await agendaEntityVersion(entity, { entityType, entityId });
    const result = await enqueueCalendarSync(
      persistenceDeps,
      activeUid,
      { entityType, entityId },
      "upsert",
      version
    );

    if ("entity" in result) {
      if (entityType === "clase") {
        setClases((prev) =>
          prev.map((c) => (c.id === entityId ? (result.entity as Clase) : c))
        );
      } else {
        setTocatas((prev) =>
          prev.map((t) => (t.id === entityId ? (result.entity as Tocata) : t))
        );
      }
      if (result.jobId) {
        void workerRef.current?.processJob(result.jobId);
      }
    } else if (result.status === "conflict") {
      throw new AgendaCrudError("conflict");
    } else if (result.status === "invalid_argument") {
      throw new AgendaCrudError("invalid_argument");
    } else {
      throw new AgendaCrudError("storage_failure");
    }
  };

  // Preferences
  const updatePreferencias = async (
    pref: Partial<Preferencias>
  ): Promise<void> => {
    const newPrefs = { ...preferencias, ...pref };
    setPreferencias(newPrefs);

    if (currentUser) {
      const path = `users/${currentUser.uid}/configuracion/preferencias`;
      try {
        await setDoc(
          doc(db, "users", currentUser.uid, "configuracion", "preferencias"),
          cleanForFirestore(newPrefs),
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }
  };

  // Export / Import
  const exportarRespaldo = useCallback((): RespaldoProfesorAgenda => {
    let savedFilters: string[] | undefined = undefined;
    try {
      const sf = localStorage.getItem("profesor_agenda_filtros_v1");
      if (sf) {
        const parsed = JSON.parse(sf);
        if (Array.isArray(parsed)) savedFilters = parsed;
      }
    } catch {}

    return {
      version: 1,
      exportadoEn: new Date().toISOString(),
      alumnos,
      clases,
      tocatas,
      notas,
      notasRapidas,
      preferencias: {
        ...preferencias,
        filtrosGuardados: savedFilters,
      },
    };
  }, [alumnos, clases, tocatas, notas, notasRapidas, preferencias]);

  const exportarRespaldoFirestore = async (): Promise<RespaldoProfesorAgenda> => {
    if (currentUser) {
      try {
        await enableFirestoreNetwork();
        const uid = currentUser.uid;
        const alumnosCol = collection(db, "users", uid, "alumnos");
        const clasesCol = collection(db, "users", uid, "clases");
        const tocatasCol = collection(db, "users", uid, "tocatas");
        const notasCol = collection(db, "users", uid, "notas");
        const notasRapidasCol = collection(db, "users", uid, "notasRapidas");
        const prefsDocRef = doc(db, "users", uid, "configuracion", "preferencias");

        const [
          alumnosSnap,
          clasesSnap,
          tocatasSnap,
          notasSnap,
          notasRapidasSnap,
          prefsSnap,
        ] = await Promise.all([
          getDocs(alumnosCol),
          getDocs(clasesCol),
          getDocs(tocatasCol),
          getDocs(notasCol),
          getDocs(notasRapidasCol),
          getDoc(prefsDocRef),
        ]);

        const fetchedAlumnos: Alumno[] = [];
        alumnosSnap.forEach((d) => fetchedAlumnos.push(d.data() as Alumno));

        const fetchedClases: Clase[] = [];
        clasesSnap.forEach((d) => fetchedClases.push(d.data() as Clase));

        const fetchedTocatas: Tocata[] = [];
        tocatasSnap.forEach((d) => fetchedTocatas.push(d.data() as Tocata));

        const fetchedNotas: NotaAlumno[] = [];
        notasSnap.forEach((d) => fetchedNotas.push(d.data() as NotaAlumno));

        const fetchedNotasRapidas: NotaRapida[] = [];
        notasRapidasSnap.forEach((d) =>
          fetchedNotasRapidas.push(d.data() as NotaRapida)
        );

        let fetchedPrefs: Preferencias = preferencias;
        if (prefsSnap.exists()) {
          fetchedPrefs = prefsSnap.data() as Preferencias;
        }

        return {
          version: 1,
          exportadoEn: new Date().toISOString(),
          alumnos: fetchedAlumnos,
          clases: fetchedClases,
          tocatas: fetchedTocatas,
          notas: fetchedNotas,
          notasRapidas: fetchedNotasRapidas,
          preferencias: fetchedPrefs,
        };
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        return exportarRespaldo();
      }
    } else {
      return exportarRespaldo();
    }
  };

  const importarRespaldo = async (
    data: RespaldoProfesorAgenda
  ): Promise<boolean> => {
    const validation = validateRespaldo(data);
    if (!validation.valid || !validation.data) {
      console.warn("Validación de respaldo falló:", validation.error);
      return false;
    }

    const cleanData = validation.data;

    // Restore saved filters if present in preferences
    const rawPrefs = cleanData.preferencias as (Preferencias & { filtrosGuardados?: string[] });
    if (rawPrefs && Array.isArray(rawPrefs.filtrosGuardados) && rawPrefs.filtrosGuardados.length > 0) {
      try {
        localStorage.setItem(
          "profesor_agenda_filtros_v1",
          JSON.stringify(rawPrefs.filtrosGuardados)
        );
      } catch (e) {
        console.error("Error al restaurar filtros guardados:", e);
      }
    }

    if (currentUser) {
      await seedDataToFirestore(currentUser.uid, cleanData);
    } else {
      setAlumnos(cleanData.alumnos);
      setClases(cleanData.clases);
      setTocatas(cleanData.tocatas);
      setNotas(cleanData.notas);
      setNotasRapidas(cleanData.notasRapidas || []);
      if (cleanData.preferencias) {
        setPreferencias(cleanData.preferencias);
      }

      // Explicitly write immediately to localStorage for atomic safety on iPhone/Safari
      try {
        localStorage.setItem(
          STORAGE_KEYS.ALUMNOS,
          JSON.stringify(cleanData.alumnos)
        );
        localStorage.setItem(
          STORAGE_KEYS.CLASES,
          JSON.stringify(cleanData.clases)
        );
        localStorage.setItem(
          STORAGE_KEYS.TOCATAS,
          JSON.stringify(cleanData.tocatas)
        );
        localStorage.setItem(
          STORAGE_KEYS.NOTAS,
          JSON.stringify(cleanData.notas)
        );
        localStorage.setItem(
          STORAGE_KEYS.NOTAS_RAPIDAS,
          JSON.stringify(cleanData.notasRapidas || [])
        );
        localStorage.setItem(
          STORAGE_KEYS.PREFERENCIAS,
          JSON.stringify(cleanData.preferencias)
        );
        localStorage.setItem(STORAGE_KEYS.INITIALIZED, "true");
      } catch (e) {
        console.error("Error persistiendo respaldo a localStorage:", e);
      }
    }

    // Trigger custom event for instant refresh of views (e.g. active filters in AgendaView)
    try {
      window.dispatchEvent(new CustomEvent("agenda-data-imported"));
    } catch {}

    return true;
  };

  const borrarTodosLosDatos = async (): Promise<void> => {
    if (currentUser) {
      try {
        const batch = writeBatch(db);
        alumnos.forEach((a) =>
          batch.delete(doc(db, "users", currentUser.uid, "alumnos", a.id))
        );
        clases.forEach((c) =>
          batch.delete(doc(db, "users", currentUser.uid, "clases", c.id))
        );
        tocatas.forEach((t) =>
          batch.delete(doc(db, "users", currentUser.uid, "tocatas", t.id))
        );
        notas.forEach((n) =>
          batch.delete(doc(db, "users", currentUser.uid, "notas", n.id))
        );
        notasRapidas.forEach((nr) =>
          batch.delete(doc(db, "users", currentUser.uid, "notasRapidas", nr.id))
        );
        await batch.commit();
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.DELETE,
          `users/${currentUser.uid}`
        );
      }
    } else {
      setAlumnos([]);
      setClases([]);
      setTocatas([]);
      setNotas([]);
      setNotasRapidas([]);
    }
  };

  const restaurarDatosDemostracion = async (): Promise<void> => {
    const demo = createInitialDemoData();
    if (currentUser) {
      await seedDataToFirestore(currentUser.uid, demo);
    } else {
      setAlumnos(demo.alumnos);
      setClases(demo.clases);
      setTocatas(demo.tocatas);
      setNotas(demo.notas);
      setNotasRapidas(demo.notasRapidas);
      setPreferencias(demo.preferencias);
    }
  };

  // Convert raw entities to Unified Activities
  const alumnoMap = useMemo(() => {
    const map = new Map<string, Alumno>();
    alumnos.forEach((a) => map.set(a.id, a));
    return map;
  }, [alumnos]);

  const getAllActividades = useCallback((): ActividadUnificada[] => {
    const list: ActividadUnificada[] = [];

    clases.forEach((c) => {
      const alumno = alumnoMap.get(c.alumnoId);
      const nombreAlumno = alumno ? alumno.nombre : "Alumno desconocido";
      const cat = c.tipo === "escalera" ? "escalera" : "alma";
      list.push({
        tipoActividad: "clase",
        id: c.id,
        fecha: c.fecha,
        horaInicio: c.horaInicio,
        horaFin: c.horaFin,
        tituloPrincipal: nombreAlumno,
        subtitulo: c.tema,
        categoria: cat,
        estado: c.estado,
        cancelada: c.estado === "cancelada",
        rawClase: c,
      });
    });

    tocatas.forEach((t) => {
      const lugarTexto = t.lugar
        ? t.ciudad && t.ciudad !== t.lugar
          ? `${t.lugar}, ${t.ciudad}`
          : t.lugar
        : t.ciudad || "Lugar por confirmar";

      list.push({
        tipoActividad: "tocata",
        id: t.id,
        fecha: t.fecha,
        horaInicio: t.horaInicio,
        horaFin: t.horaFin,
        tituloPrincipal: t.titulo,
        subtitulo: `${t.proyecto} • ${lugarTexto}`,
        categoria: "dj",
        estado: t.estado,
        cancelada: t.estado === "cancelada",
        rawTocata: t,
      });
    });

    return list.sort((a, b) => {
      const cmpFecha = a.fecha.localeCompare(b.fecha);
      if (cmpFecha !== 0) return cmpFecha;
      return a.horaInicio.localeCompare(b.horaInicio);
    });
  }, [clases, tocatas, alumnoMap]);

  const getActividadesPorFecha = useCallback(
    (fechaIso: string): ActividadUnificada[] => {
      return getAllActividades().filter((act) => act.fecha === fechaIso);
    },
    [getAllActividades]
  );

  // Proxima clase
  const proximaClase = useMemo(() => {
    const hoyIso = getISODate(new Date());
    const validClases = clases
      .filter((c) => c.estado !== "cancelada" && c.fecha >= hoyIso)
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          a.horaInicio.localeCompare(b.horaInicio)
      );

    if (validClases.length === 0) return null;
    const c = validClases[0];
    const alumno = alumnoMap.get(c.alumnoId);
    return {
      tipoActividad: "clase" as const,
      id: c.id,
      fecha: c.fecha,
      horaInicio: c.horaInicio,
      horaFin: c.horaFin,
      tituloPrincipal: alumno ? alumno.nombre : "Alumno",
      subtitulo: c.tema,
      categoria: (c.tipo === "escalera" ? "escalera" : "alma") as
        | "alma"
        | "escalera",
      estado: c.estado,
      cancelada: false,
      rawClase: c,
    };
  }, [clases, alumnoMap]);

  // Proxima tocata
  const proximaTocata = useMemo(() => {
    const hoyIso = getISODate(new Date());
    const validTocatas = tocatas
      .filter((t) => t.estado !== "cancelada" && t.fecha >= hoyIso)
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          a.horaInicio.localeCompare(b.horaInicio)
      );

    if (validTocatas.length === 0) return null;
    const t = validTocatas[0];
    const lugarTexto = t.lugar
      ? t.ciudad && t.ciudad !== t.lugar
        ? `${t.lugar}, ${t.ciudad}`
        : t.lugar
      : t.ciudad || "Lugar por confirmar";

    return {
      tipoActividad: "tocata" as const,
      id: t.id,
      fecha: t.fecha,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      tituloPrincipal: t.titulo,
      subtitulo: `${t.proyecto} • ${lugarTexto}`,
      categoria: "dj" as const,
      estado: t.estado,
      cancelada: false,
      rawTocata: t,
    };
  }, [tocatas]);

  // Hoy
  const actividadesHoy = useMemo(() => {
    const hoyIso = getISODate(new Date());
    return getAllActividades().filter((a) => a.fecha === hoyIso);
  }, [getAllActividades]);

  // Mañana
  const actividadesManana = useMemo(() => {
    const mananaIso = getISODate(addDays(new Date(), 1));
    return getAllActividades().filter((a) => a.fecha === mananaIso);
  }, [getAllActividades]);

  // Próximamente
  const actividadesProximas = useMemo(() => {
    const mananaIso = getISODate(addDays(new Date(), 1));
    const limiteIso = getISODate(
      addDays(new Date(), preferencias.proximaVistaDias)
    );
    return getAllActividades().filter(
      (a) => a.fecha > mananaIso && a.fecha <= limiteIso
    );
  }, [getAllActividades, preferencias.proximaVistaDias]);

  // Global execution layer for upcoming event notifications (1 day before, 2 hours before)
  useEffect(() => {
    registerNotificationServiceWorker();
  }, []);

  useEffect(() => {
    if (loadingData) return;
    if (!preferencias.recordatoriosActivos) return;

    const runChecks = () => {
      checkAndNotifyUpcomingEvents({
        uid: currentUser ? currentUser.uid : null,
        clases,
        tocatas,
        alumnos,
        preferencias,
      });
    };

    // 1. Initial check after user and data are ready
    runChecks();

    // 2. Focus and visibility handlers
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        runChecks();
      }
    };
    const handleFocus = () => {
      runChecks();
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    // 3. Single 60-second periodic interval
    const interval = setInterval(runChecks, 60000);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, [
    currentUser?.uid,
    clases,
    tocatas,
    alumnos,
    preferencias.recordatoriosActivos,
    preferencias.notificacionesPushLocales,
    loadingData,
  ]);

  return (
    <AgendaContext.Provider
      value={{
        alumnos,
        clases,
        tocatas,
        notas,
        notasRapidas,
        preferencias,
        loadingData,
        addAlumno,
        updateAlumno,
        deleteAlumno,
        getAlumnoById,
        addNota,
        updateNota,
        deleteNota,
        getNotasByAlumnoId,
        addNotaRapida,
        updateNotaRapida,
        deleteNotaRapida,
        addClase,
        updateClase,
        deleteClase,
        captureEditPrecondition,
        getClaseById,
        getClasesByAlumnoId,
        addTocata,
        updateTocata,
        deleteTocata,
        getTocataById,
        enableEntityCalendarLink,
        disableEntityCalendarLink,
        retryEntityCalendarSync,
        calendarSyncJobs,
        updatePreferencias,
        exportarRespaldo,
        exportarRespaldoFirestore,
        importarRespaldo,
        borrarTodosLosDatos,
        restaurarDatosDemostracion,
        isMigrationModalOpen,
        localSummary,
        migrateLocalDataToFirestore,
        skipMigrationAndSeedDemo,
        syncStatus,
        lastSyncTime,
        sincronizarAhora,
        proximaClase,
        proximaTocata,
        actividadesHoy,
        actividadesManana,
        actividadesProximas,
        getActividadesPorFecha,
        getAllActividades,
      }}
    >
      {children}
    </AgendaContext.Provider>
  );
};

export function useAgenda() {
  const context = useContext(AgendaContext);
  if (!context) {
    throw new Error("useAgenda must be used within an AgendaProvider");
  }
  return context;
}
