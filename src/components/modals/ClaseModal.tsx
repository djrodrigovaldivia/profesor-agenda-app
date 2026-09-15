import React, { useState, useEffect, useMemo, useRef } from "react";
import { Clase, TipoClase, UnidadTiempoRecordatorio } from "../../types";
import { useAgenda, agendaCrudErrorMessage, type AgendaAuthorizedLink } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { Modal } from "../common/Modal";
import { DetailedErrorBanner } from "../common/DetailedErrorBanner";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { AlumnoModal } from "../alumnos/AlumnoModal";
import { GoogleCalendarSyncToggle } from "../common/GoogleCalendarSyncToggle";
import { getISODate, formatTimeRange } from "../../utils/dateUtils";
import {
  Clock,
  Calendar,
  BookOpen,
  AlertCircle,
  Trash2,
  Copy,
  Bell,
  Volume2,
  CheckCircle2,
  UserPlus,
} from "lucide-react";
import {
  getNotificationPermission,
  requestNotificationPermission,
  calculateNotificationTriggerTime,
  sendTestClaseNotification,
} from "../../utils/notificationService";

interface ClaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  claseToEdit?: Clase | null;
  defaultAlumnoId?: string;
  defaultFecha?: string;
}

export const ClaseModal: React.FC<ClaseModalProps> = ({
  isOpen,
  onClose,
  claseToEdit,
  defaultAlumnoId,
  defaultFecha,
}) => {
  const {
    alumnos,
    clases = [],
    captureEditPrecondition,
    addClase,
    updateClase,
    deleteClase,
    enableEntityCalendarLink,
    disableEntityCalendarLink,
    retryEntityCalendarSync,
  } = useAgenda();
  const { calendarAuth } = useAuth();

  const [editingClaseId, setEditingClaseId] = useState<string | null>(
    () => claseToEdit?.id || null
  );
  const [isDuplicating, setIsDuplicating] = useState(false);

  const [alumnoId, setAlumnoId] = useState(
    () =>
      claseToEdit?.alumnoId ||
      defaultAlumnoId ||
      alumnos.find((a) => a.activo)?.id ||
      alumnos[0]?.id ||
      ""
  );
  const [tipo, setTipo] = useState<TipoClase>(
    () => claseToEdit?.tipo || "alma"
  );
  const [fecha, setFecha] = useState(
    () => claseToEdit?.fecha || defaultFecha || getISODate(new Date())
  );
  const [horaInicio, setHoraInicio] = useState(
    () => claseToEdit?.horaInicio || "18:00"
  );
  const [horaFin, setHoraFin] = useState(
    () => claseToEdit?.horaFin || "19:30"
  );
  const [tema, setTema] = useState(() => claseToEdit?.tema || "");
  const [notas, setNotas] = useState(() => claseToEdit?.notas || "");
  const [estado, setEstado] = useState<"programada" | "realizada" | "cancelada">(
    () => claseToEdit?.estado || "programada"
  );

  // Notification reminder state per class
  const [recordatorioActivo, setRecordatorioActivo] = useState(
    () => Boolean(claseToEdit?.recordatorio?.activo)
  );
  const [recordatorioValor, setRecordatorioValor] = useState(
    () => claseToEdit?.recordatorio?.antelacionValor || 30
  );
  const [recordatorioUnidad, setRecordatorioUnidad] = useState<UnidadTiempoRecordatorio>(
    () => claseToEdit?.recordatorio?.antelacionUnidad || "minutos"
  );
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | "unsupported">("default");
  const [isTestingNotification, setIsTestingNotification] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  // Atomic CRUD, async save, safe delete & error handling states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Google Calendar Sync state
  const [syncWithGoogle, setSyncWithGoogle] = useState(() => Boolean(claseToEdit?.googleCalendar?.enabled));
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  // Precondition tracking for atomic updates and concurrency conflict detection
  const [precondition, setPrecondition] = useState<any>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isCrearAlumnoModalOpen, setIsCrearAlumnoModalOpen] = useState(false);

  // Active students only for selection, or active + currently selected student if editing
  const alumnosActivos = useMemo(() => {
    return alumnos.filter((a) => a.activo);
  }, [alumnos]);

  const targetAlumnoId = alumnoId || claseToEdit?.alumnoId || defaultAlumnoId || "";

  const alumnosDisponibles = useMemo(() => {
    if (targetAlumnoId) {
      const assigned = alumnos.find((a) => a.id === targetAlumnoId);
      if (assigned && !assigned.activo) {
        return [assigned, ...alumnosActivos];
      }
      if (assigned && !alumnosActivos.some((a) => a.id === assigned.id)) {
        return [assigned, ...alumnosActivos];
      }
    }
    return alumnosActivos;
  }, [alumnos, alumnosActivos, targetAlumnoId]);

  const prevOpenRef = useRef(false);
  const prevClaseIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      setPermissionStatus(getNotificationPermission());
      setTestFeedback(null);
      const hasJustOpened = !prevOpenRef.current;
      const claseChanged = prevClaseIdRef.current !== (claseToEdit?.id ?? null);

      if (hasJustOpened || claseChanged) {
        prevClaseIdRef.current = claseToEdit?.id ?? null;
        setSubmitError(null);
        setIsSubmitting(false);
        setIsDeleting(false);

        if (claseToEdit) {
          setEditingClaseId(claseToEdit.id);
          const capturedPrecondition = captureEditPrecondition(claseToEdit);
          setPrecondition(capturedPrecondition);
          setIsDuplicating(false);
          setAlumnoId(claseToEdit.alumnoId || "");
          setTipo(claseToEdit.tipo || "alma");
          setFecha(claseToEdit.fecha || "");
          setHoraInicio(claseToEdit.horaInicio || "18:00");
          setHoraFin(claseToEdit.horaFin || "19:30");
          setTema(claseToEdit.tema || "");
          setNotas(claseToEdit.notas || "");
          setEstado(claseToEdit.estado || "programada");
          if (claseToEdit.recordatorio) {
            setRecordatorioActivo(!!claseToEdit.recordatorio.activo);
            setRecordatorioValor(claseToEdit.recordatorio.antelacionValor || 30);
            setRecordatorioUnidad(claseToEdit.recordatorio.antelacionUnidad || "minutos");
          } else {
            setRecordatorioActivo(false);
            setRecordatorioValor(30);
            setRecordatorioUnidad("minutos");
          }
          setSyncWithGoogle(Boolean(claseToEdit.googleCalendar?.enabled));
          setIsRetryingSync(false);

          if (!claseToEdit.alumnoId) {
            setErrors({
              alumnoId: "Esta clase no tiene un alumno asignado. Por favor selecciona o crea un alumno.",
            });
          } else if (!alumnos.some((a) => a.id === claseToEdit.alumnoId)) {
            setErrors({
              alumnoId: "El alumno asignado a esta clase no existe o fue eliminado de la agenda. Selecciona un alumno disponible.",
            });
          } else {
            setErrors({});
          }
        } else {
          setEditingClaseId(null);
          setPrecondition(null);
          setIsDuplicating(false);
          const initialAlumno =
            defaultAlumnoId && alumnos.some((a) => a.id === defaultAlumnoId)
              ? defaultAlumnoId
              : alumnosActivos[0]?.id || alumnos[0]?.id || "";

          setAlumnoId(initialAlumno);
          setTipo("alma");
          setFecha(defaultFecha || getISODate(new Date()));
          setHoraInicio("18:00");
          setHoraFin("19:30");
          setTema("");
          setNotas("");
          setEstado("programada");
          setRecordatorioActivo(false);
          setRecordatorioValor(30);
          setRecordatorioUnidad("minutos");
          setSyncWithGoogle(false);
          setIsRetryingSync(false);
          setErrors({});
        }
      }
    } else {
      prevClaseIdRef.current = undefined;
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, claseToEdit, defaultAlumnoId, defaultFecha, alumnos]);

  const handleDuplicate = () => {
    // Switch to creation mode with cloned data, leaving date empty and mandatory
    setEditingClaseId(null);
    setPrecondition(null);
    setIsDuplicating(true);
    setFecha("");
    setSyncWithGoogle(Boolean(claseToEdit?.googleCalendar?.enabled));
    setIsRetryingSync(false);
    setErrors({});
    setSubmitError(null);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    const effectiveAlumnoId =
      alumnoId ||
      defaultAlumnoId ||
      alumnos.find((a) => a.activo)?.id ||
      alumnos[0]?.id ||
      "";

    // Precondición 1: Alumno obligatorio y válido
    if (!effectiveAlumnoId || !effectiveAlumnoId.trim()) {
      errs.alumnoId = "Selecciona un alumno antes de guardar la clase.";
    }

    const effectiveFecha = fecha || defaultFecha || getISODate(new Date());

    // Precondición 2: Fecha válida y no vacía
    if (!effectiveFecha || !effectiveFecha.trim()) {
      errs.fecha = "Ingresa una fecha válida.";
    }

    // Precondición 3: Horarios válidos
    if (!horaInicio) {
      errs.horaInicio = "Ingresa la hora de inicio.";
    }
    if (!horaFin) {
      errs.horaFin = "Ingresa la hora de término.";
    }

    // Precondición 4: Coherencia temporal (término posterior a inicio)
    if (horaInicio && horaFin && horaInicio >= horaFin) {
      errs.horaFin = "La hora de término debe ser posterior a la hora de inicio.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const calculatedTrigger = useMemo(() => {
    if (!fecha || !horaInicio || !recordatorioActivo) return null;
    return calculateNotificationTriggerTime(
      fecha,
      horaInicio,
      Number(recordatorioValor) || 30,
      recordatorioUnidad
    );
  }, [fecha, horaInicio, recordatorioActivo, recordatorioValor, recordatorioUnidad]);

  const totalAnticipacionMinutos = useMemo(() => {
    const val = Number(recordatorioValor) || 0;
    if (recordatorioUnidad === "minutos") return val;
    if (recordatorioUnidad === "horas") return val * 60;
    if (recordatorioUnidad === "dias") return val * 24 * 60;
    return val;
  }, [recordatorioValor, recordatorioUnidad]);

  const formatCalculatedTrigger = (d: Date): string => {
    const dias = [
      "domingo",
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
    ];
    const meses = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];
    const diaSemana = dias[d.getDay()];
    const diaNum = d.getDate();
    const mes = meses[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${diaSemana} ${diaNum} de ${mes} a las ${hh}:${mm} hrs`;
  };

  const handleTestNotification = async () => {
    setIsTestingNotification(true);
    setTestFeedback(null);
    try {
      if (permissionStatus !== "granted") {
        const res = await requestNotificationPermission();
        setPermissionStatus(res);
        if (res !== "granted") {
          setTestFeedback("Permiso no concedido en el navegador.");
          setIsTestingNotification(false);
          return;
        }
      }
      const currentAlumno = alumnos.find((a) => a.id === alumnoId);
      const success = await sendTestClaseNotification(
        currentAlumno?.nombre || "Alumno",
        tema.trim() || "Clase",
        Number(recordatorioValor) || 30,
        recordatorioUnidad
      );
      if (success) {
        setTestFeedback("¡Notificación de prueba emitida con éxito!");
      } else {
        setTestFeedback("No se pudo emitir. Revisa la configuración del navegador.");
      }
    } catch {
      setTestFeedback("Error al emitir notificación.");
    } finally {
      setIsTestingNotification(false);
      setTimeout(() => setTestFeedback(null), 5000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Precondición de atomicidad: evitar múltiples envíos concurrentes
    if (isSubmitting || isDeleting) return;

    if (!validate()) {
      setSubmitError("Por favor completa los campos obligatorios marcados en rojo.");
      return;
    }

    const recordatorioPayload = {
      activo: recordatorioActivo,
      antelacionValor: Number(recordatorioValor) || 30,
      antelacionUnidad: recordatorioUnidad,
    };

    const effectiveAlumnoId =
      alumnoId ||
      defaultAlumnoId ||
      alumnos.find((a) => a.activo)?.id ||
      alumnos[0]?.id ||
      "";
    const effectiveFecha = fecha || defaultFecha || getISODate(new Date());

    const payload = {
      alumnoId: effectiveAlumnoId,
      tipo,
      fecha: effectiveFecha,
      horaInicio,
      horaFin,
      tema: tema.trim(),
      notas: notas.trim() || undefined,
      estado,
      recordatorio: recordatorioPayload,
    };

    const isCalendarAuthorized =
      calendarAuth.status === "authorized_temporarily" && Boolean(calendarAuth.identity);
    const wasEnabled = Boolean(claseToEdit?.googleCalendar?.enabled);

    if (syncWithGoogle && !wasEnabled && !isCalendarAuthorized) {
      setSubmitError("Debes autorizar Google Calendar para activar la sincronización.");
      return;
    }

    const authorizedLink: AgendaAuthorizedLink | undefined =
      syncWithGoogle && isCalendarAuthorized && calendarAuth.identity
        ? {
            authorized: true,
            googleAccountId: calendarAuth.identity.googleAccountId,
            calendarId: "primary",
          }
        : undefined;

    setIsSubmitting(true);
    try {
      if (editingClaseId) {
        await updateClase(editingClaseId, payload, precondition);
        const wasEnabled = Boolean(claseToEdit?.googleCalendar?.enabled);
        if (syncWithGoogle && !wasEnabled && authorizedLink) {
          await enableEntityCalendarLink("clase", editingClaseId, authorizedLink);
        } else if (!syncWithGoogle && wasEnabled) {
          await disableEntityCalendarLink("clase", editingClaseId);
        }
      } else {
        await addClase(payload, authorizedLink);
      }
      onClose();
    } catch (err) {
      console.error("Error al guardar la clase:", err);
      setSubmitError(agendaCrudErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetrySync = async () => {
    if (!editingClaseId) return;
    setIsRetryingSync(true);
    try {
      await retryEntityCalendarSync("clase", editingClaseId);
    } catch (err) {
      console.error("Error al reintentar sincronización:", err);
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleDelete = async () => {
    // Precondición de eliminación segura y atómica
    if (!editingClaseId || isDeleting || isSubmitting) return;

    setSubmitError(null);
    setIsDeleting(true);
    try {
      await deleteClase(editingClaseId, precondition);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error("Error al eliminar la clase:", err);
      setSubmitError(agendaCrudErrorMessage(err));
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const isEditing = !isDuplicating && Boolean(editingClaseId || claseToEdit);

  const isClaseNotFound = Boolean(
    isEditing &&
      editingClaseId &&
      clases.length > 0 &&
      !clases.some((c) => c.id === editingClaseId)
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={
          isDuplicating
            ? "Nueva Clase (Copia)"
            : isEditing
            ? "Editar Clase"
            : "Nueva Clase"
        }
        subtitle={
          isDuplicating
            ? "Selecciona una nueva fecha para programar la clase duplicada"
            : "Registra fecha, alumno y contenido pedagógico"
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Banner de error general / servidor si falla la operación */}
          {submitError && (
            <>
              <div role="alert" className="sr-only">
                {submitError}
              </div>
              <DetailedErrorBanner
                id="clase-submit-error"
                error={submitError}
              />
            </>
          )}

          {isClaseNotFound && (
            <div
              id="clase-not-found-warning"
              className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-200 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <p className="font-semibold text-amber-100">
                  Clase no encontrada o eliminada
                </p>
                <p className="text-amber-300/90 mt-0.5">
                  Esta clase ya no se encuentra en la agenda. Puede haber sido eliminada recientemente.
                </p>
              </div>
            </div>
          )}

          {errors.general && (
            <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-800 text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{errors.general}</span>
            </div>
          )}

          {alumnosDisponibles.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-sm space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-100">
                    Primero debes crear un alumno.
                  </p>
                  <p className="text-xs text-amber-300/80 mt-0.5">
                    Para programar una clase necesitas tener al menos un alumno activo en la agenda.
                  </p>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  id="btn-crear-alumno-desde-clase"
                  onClick={() => setIsCrearAlumnoModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-lg transition-colors shadow-sm cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Crear alumno</span>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="clase-alumno"
                  className="block text-xs font-medium text-slate-300"
                >
                  Alumno <span className="text-rose-400">*</span>
                </label>
                <button
                  type="button"
                  id="btn-nuevo-alumno-enlace-clase"
                  onClick={() => setIsCrearAlumnoModalOpen(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Crear alumno</span>
                </button>
              </div>
              <select
                id="clase-alumno"
                value={alumnoId}
                onChange={(e) => {
                  setAlumnoId(e.target.value);
                  if (errors.alumnoId)
                    setErrors((prev) => ({ ...prev, alumnoId: "" }));
                }}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              >
                <option value="">-- Selecciona un alumno --</option>
                {alumnosDisponibles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}{!a.activo ? " (Inactivo)" : ""}
                  </option>
                ))}
              </select>
              {errors.alumnoId && (
                <p className="text-xs text-rose-400 mt-1">{errors.alumnoId}</p>
              )}
            </div>
          )}

          {/* Tipo de Clase */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Tipo de clase <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="tipo-clase-alma"
                onClick={() => setTipo("alma")}
                style={
                  tipo === "alma" || tipo === "dj"
                    ? {
                        backgroundColor: "rgba(159, 198, 231, 0.15)",
                        color: "#9fc6e7",
                        borderColor: "#9fc6e7",
                      }
                    : undefined
                }
                className={`py-2 px-3 text-sm font-medium rounded-lg border transition-all text-center flex items-center justify-center gap-2 ${
                  tipo === "alma" || tipo === "dj"
                    ? "ring-1 ring-[#9fc6e7]"
                    : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                }`}
              >
                <span
                  style={{ backgroundColor: "#9fc6e7" }}
                  className="w-2 h-2 rounded-full"
                />
                ALMA
              </button>
              <button
                type="button"
                id="tipo-clase-escalera"
                onClick={() => setTipo("escalera")}
                style={
                  tipo === "escalera" || tipo === "sokolov"
                    ? {
                        backgroundColor: "rgba(167, 220, 158, 0.15)",
                        color: "#a7dc9e",
                        borderColor: "#a7dc9e",
                      }
                    : undefined
                }
                className={`py-2 px-3 text-sm font-medium rounded-lg border transition-all text-center flex items-center justify-center gap-2 ${
                  tipo === "escalera" || tipo === "sokolov"
                    ? "ring-1 ring-[#a7dc9e]"
                    : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                }`}
              >
                <span
                  style={{ backgroundColor: "#a7dc9e" }}
                  className="w-2 h-2 rounded-full"
                />
                La Escalera
              </button>
            </div>
          </div>

          {/* Fecha y Horario */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="clase-fecha" className="block text-xs font-medium text-slate-300 mb-1.5">
                Fecha <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  id="clase-fecha"
                  value={fecha}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    if (errors.fecha) setErrors((prev) => ({ ...prev, fecha: "" }));
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {errors.fecha && (
                <p className="text-xs text-rose-400 mt-1">{errors.fecha}</p>
              )}
            </div>

            <div>
              <label htmlFor="clase-hora-inicio" className="block text-xs font-medium text-slate-300 mb-1.5">
                Hora inicio <span className="text-rose-400">*</span>
              </label>
              <input
                type="time"
                id="clase-hora-inicio"
                value={horaInicio}
                onChange={(e) => {
                  setHoraInicio(e.target.value);
                  if (errors.horaInicio) setErrors((prev) => ({ ...prev, horaInicio: "" }));
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.horaInicio && (
                <p className="text-xs text-rose-400 mt-1">{errors.horaInicio}</p>
              )}
            </div>

            <div>
              <label htmlFor="clase-hora-fin" className="block text-xs font-medium text-slate-300 mb-1.5">
                Hora término <span className="text-rose-400">*</span>
              </label>
              <input
                type="time"
                id="clase-hora-fin"
                value={horaFin}
                onChange={(e) => {
                  setHoraFin(e.target.value);
                  if (errors.horaFin) setErrors((prev) => ({ ...prev, horaFin: "" }));
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.horaFin && (
                <p className="text-xs text-rose-400 mt-1">{errors.horaFin}</p>
              )}
            </div>
          </div>

          {horaInicio && horaFin && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Horario programado: <span className="text-slate-300 font-medium">{formatTimeRange(horaInicio, horaFin)}</span>
            </p>
          )}

          {/* Tema */}
          <div>
            <label htmlFor="clase-tema" className="block text-xs font-medium text-slate-300 mb-1.5">
              Tema de la clase (opcional)
            </label>
            <input
              type="text"
              id="clase-tema"
              maxLength={150}
              placeholder="Ej: Mezcla armónica, ecualización, lectura de compases"
              value={tema}
              onChange={(e) => {
                setTema(e.target.value);
                if (errors.tema) setErrors((prev) => ({ ...prev, tema: "" }));
              }}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.tema && (
              <p className="text-xs text-rose-400 mt-1">{errors.tema}</p>
            )}
          </div>

          {/* Notas pedagógicas */}
          <div>
            <label htmlFor="clase-notas" className="block text-xs font-medium text-slate-300 mb-1.5">
              Notas y observaciones (opcional)
            </label>
            <textarea
              id="clase-notas"
              rows={2}
              maxLength={1000}
              placeholder="Material requerido, tareas previas, ejercicios específicos..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Estado */}
          <div>
            <label htmlFor="clase-estado" className="block text-xs font-medium text-slate-300 mb-1.5">
              Estado de la clase
            </label>
            <select
              id="clase-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as "programada" | "realizada" | "cancelada")}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="programada">Programada</option>
              <option value="realizada">Realizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>

          {/* Notificación Local Anticipada */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
                    recordatorioActivo
                      ? "bg-amber-950/70 border-amber-700/80 text-amber-300 shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400"
                  }`}
                >
                  <Bell className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="toggle-recordatorio-clase"
                    className="text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer block truncate"
                  >
                    Notificación local anticipada
                  </label>
                  <p className="text-[11px] text-slate-400 leading-tight truncate">
                    Programar alerta previa en minutos, horas o días
                  </p>
                </div>
              </div>

              {/* Switch Toggle */}
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  id="toggle-recordatorio-clase"
                  checked={recordatorioActivo}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setRecordatorioActivo(checked);
                    if (checked && permissionStatus !== "granted") {
                      const res = await requestNotificationPermission();
                      setPermissionStatus(res);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>

            {recordatorioActivo && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-3">
                {/* Accesos rápidos de tiempo */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Anticipación rápida:
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {[
                      { label: "30 min", val: 30, unit: "minutos" as const },
                      { label: "2 horas", val: 2, unit: "horas" as const },
                      { label: "1 día (24h)", val: 1, unit: "dias" as const },
                      { label: "15 min", val: 15, unit: "minutos" as const },
                      { label: "1 hora", val: 1, unit: "horas" as const },
                      { label: "2 días", val: 2, unit: "dias" as const },
                    ].map((preset) => {
                      const isSelected =
                        recordatorioValor === preset.val &&
                        recordatorioUnidad === preset.unit;
                      return (
                        <button
                          key={`${preset.val}-${preset.unit}`}
                          type="button"
                          onClick={() => {
                            setRecordatorioValor(preset.val);
                            setRecordatorioUnidad(preset.unit);
                          }}
                          className={`py-1.5 px-1.5 text-xs font-medium rounded-lg border text-center transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-amber-950/90 border-amber-600 text-amber-300 shadow-sm"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Personalización fina: valor numérico y unidad */}
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div>
                    <label
                      htmlFor="clase-recordatorio-valor"
                      className="block text-[11px] font-medium text-slate-400 mb-1"
                    >
                      Tiempo de antelación
                    </label>
                    <input
                      type="number"
                      id="clase-recordatorio-valor"
                      min={1}
                      max={
                        recordatorioUnidad === "minutos"
                          ? 240
                          : recordatorioUnidad === "horas"
                          ? 72
                          : 30
                      }
                      value={recordatorioValor}
                      onChange={(e) =>
                        setRecordatorioValor(
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        )
                      }
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="clase-recordatorio-unidad"
                      className="block text-[11px] font-medium text-slate-400 mb-1"
                    >
                      Unidad
                    </label>
                    <select
                      id="clase-recordatorio-unidad"
                      value={recordatorioUnidad}
                      onChange={(e) =>
                        setRecordatorioUnidad(
                          e.target.value as UnidadTiempoRecordatorio
                        )
                      }
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="minutos">Minutos antes</option>
                      <option value="horas">Horas antes</option>
                      <option value="dias">Días antes</option>
                    </select>
                  </div>
                </div>

                {/* Indicador visual de momento de disparo */}
                {calculatedTrigger && (
                  <div className="space-y-1.5">
                    <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/40 text-[11px] text-amber-200/90 flex items-start gap-2">
                      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="leading-tight">
                        <span className="font-semibold text-amber-300">
                          Momento de notificación programado:
                        </span>{" "}
                        <span>{formatCalculatedTrigger(calculatedTrigger)}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-normal px-0.5">
                      {totalAnticipacionMinutos <= 30
                        ? "Este aviso es confiable mientras Profesor Agenda esté abierta o recientemente activa en tu dispositivo."
                        : "Para anticipaciones largas, abre Profesor Agenda cerca de la hora programada para asegurar el aviso. Sin un servidor de notificaciones, no se garantiza el aviso si el dispositivo estuvo bloqueado o la app cerrada por mucho tiempo."}
                    </p>
                  </div>
                )}

                {/* Permisos y botón de prueba */}
                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  {permissionStatus !== "granted" ? (
                    <div className="flex items-center justify-between w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs gap-2">
                      <span className="text-amber-400 text-[11px]">
                        {permissionStatus === "denied"
                          ? "Permiso de notificaciones bloqueado en navegador"
                          : "Requiere permiso para emitir notificaciones"}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await requestNotificationPermission();
                          setPermissionStatus(res);
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-md transition-colors shrink-0"
                      >
                        Habilitar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full text-[11px]">
                      <span className="inline-flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Permisos locales activos
                      </span>
                      <button
                        type="button"
                        onClick={handleTestNotification}
                        disabled={isTestingNotification}
                        className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Volume2 className="w-3 h-3" />
                        {isTestingNotification ? "Probando..." : "Probar alerta y sonido"}
                      </button>
                    </div>
                  )}

                  {testFeedback && (
                    <p className="w-full text-[11px] text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded px-2 py-1">
                      {testFeedback}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sincronización con Google Calendar */}
          <GoogleCalendarSyncToggle
            enabled={syncWithGoogle}
            onChange={setSyncWithGoogle}
            metadata={claseToEdit?.googleCalendar}
            onRetry={editingClaseId ? handleRetrySync : undefined}
            isRetrying={isRetryingSync}
          />

          {submitError && (
            <div className="pt-2">
              <DetailedErrorBanner
                id="clase-submit-error-bottom"
                error={submitError}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800 gap-2 flex-wrap">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-eliminar-clase"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSubmitting || isDeleting}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-900/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? "Eliminando..." : "Eliminar"}
                </button>
                <button
                  type="button"
                  id="btn-duplicar-clase"
                  onClick={handleDuplicate}
                  disabled={isSubmitting || isDeleting}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:text-slate-50 bg-slate-850 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors active:scale-[0.98] shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Copy className="w-4 h-4 text-slate-400" />
                  Duplicar
                </button>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="submit"
                id="btn-guardar-clase"
                disabled={isSubmitting || isDeleting || alumnosDisponibles.length === 0}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : isEditing ? (
                  "Guardar cambios"
                ) : (
                  "Crear clase"
                )}
              </button>
              <button
                type="button"
                id="btn-cancelar-clase"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Eliminar clase"
        message="¿Eliminar esta clase? Esta acción no se puede deshacer."
        confirmText={isDeleting ? "Eliminando..." : "Eliminar clase"}
        isDestructive={true}
      />

      {isCrearAlumnoModalOpen && (
        <AlumnoModal
          isOpen={isCrearAlumnoModalOpen}
          onClose={() => setIsCrearAlumnoModalOpen(false)}
          onAlumnoCreated={(nuevo) => {
            setAlumnoId(nuevo.id);
            setIsCrearAlumnoModalOpen(false);
            setErrors((prev) => ({ ...prev, alumnoId: "" }));
            setSubmitError(null);
          }}
        />
      )}
    </>
  );
};
