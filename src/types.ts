export type TipoClase = "alma" | "escalera" | "dj" | "sokolov";

export interface Alumno {
  id: string;
  nombre: string;
  apellido?: string;
  telefono?: string;
  email?: string;
  tipoClase?: TipoClase;
  descripcion?: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  nivel?: string;
}

export type UnidadTiempoRecordatorio = "minutos" | "horas" | "dias";

export interface RecordatorioClase {
  activo: boolean;
  antelacionValor: number;
  antelacionUnidad: UnidadTiempoRecordatorio;
  notificadoAt?: string;
}

export type GoogleCalendarSyncStatus =
  | "not_synced"
  | "pending"
  | "synced"
  | "error"
  | "unlinked";

export interface GoogleCalendarSyncError {
  code: string;
  message: string;
  at: string;
  retryable: boolean;
}

/** Persist only coordination data under users/{uid}/calendarSyncJobs/{id}. */
export interface GoogleCalendarSyncJob {
  id: string;
  entityType: "clase" | "tocata";
  entityId: string;
  googleAccountId: string;
  calendarId: "primary";
  googleCalendarEventId: string;
  operation: "upsert" | "delete";
  revision: number;
  status: "pending" | "processing" | "completed" | "error";
  attempts: number;
  nextAttemptAt: string | null;
  lastError: GoogleCalendarSyncError | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarSyncMetadata {
  enabled: boolean;
  status: GoogleCalendarSyncStatus;
  calendarId: "primary";
  googleAccountId?: string;
  googleCalendarEventId?: string;
  revision: number;
  syncedRevision: number;
  lastSyncedAt?: string | null;
  lastError?: GoogleCalendarSyncError | null;
  etag?: string | null;
}

export interface Clase {
  id: string;
  alumnoId: string;
  tipo: TipoClase;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  tema: string;
  notas?: string;
  estado: "programada" | "realizada" | "cancelada";
  recordatorio?: RecordatorioClase;
  googleCalendar?: GoogleCalendarSyncMetadata;
  createdAt: string;
  updatedAt: string;
}

export type ProyectoDJ =
  | "Rodrigo Valdivia"
  | "Sokolov"
  | "Área 51"
  | "Otro";

export type EstadoTocata =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada";

export interface Tocata {
  id: string;
  titulo: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  proyecto: ProyectoDJ;
  lugar?: string;
  ciudad?: string;
  direccion?: string;
  contacto?: string;
  honorarios?: number | null;
  estado: EstadoTocata;
  notas?: string;
  googleCalendar?: GoogleCalendarSyncMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface NotaAlumno {
  id: string;
  alumnoId: string;
  texto: string;
  fecha: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preferencias {
  recordatoriosActivos: boolean;
  recordatorios: "un_dia_antes" | "mismo_dia" | "ambos";
  proximaVistaDias: 7 | 30;
  notificacionesPushLocales?: boolean;
  antelacionNotificacionMinutos?: number;
  notificarClases?: boolean;
  notificarTocatas?: boolean;
}

export interface PreferenciasRespaldo extends Preferencias {
  filtrosGuardados?: string[];
}

export type CategoriaNotaRapida = "setlist" | "pedagogica" | "idea" | "general";

export interface NotaRapida {
  id: string;
  titulo: string;
  contenido: string;
  categoria: CategoriaNotaRapida;
  color?: string;
  fijada?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RespaldoProfesorAgenda {
  version: 1;
  exportadoEn: string;
  alumnos: Alumno[];
  clases: Clase[];
  tocatas: Tocata[];
  notas: NotaAlumno[];
  notasRapidas?: NotaRapida[];
  preferencias: PreferenciasRespaldo;
}

export type SeccionNav = "agenda" | "calendario" | "alumnos" | "mas";

export type FirestoreSyncStatus = "connected" | "syncing" | "offline";

export type ActividadTipo = "clase" | "tocata";

export type CategoriaActividad = "alma" | "escalera" | "dj" | "sokolov" | "tocata";

export interface ActividadUnificada {
  tipoActividad: ActividadTipo;
  id: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  tituloPrincipal: string;
  subtitulo: string;
  categoria: CategoriaActividad;
  estado: "programada" | "realizada" | "cancelada" | "pendiente" | "confirmada";
  cancelada: boolean;
  rawClase?: Clase;
  rawTocata?: Tocata;
}

