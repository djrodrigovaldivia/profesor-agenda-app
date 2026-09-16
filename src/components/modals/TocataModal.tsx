import React, { useState, useRef, useEffect, useMemo } from "react";
import { Tocata, ProyectoDJ, EstadoTocata } from "../../types";
import { useAgenda, agendaCrudErrorMessage, AgendaCrudError, type AgendaEditPrecondition, type AgendaAuthorizedLink } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { Modal } from "../common/Modal";
import { DetailedErrorBanner } from "../common/DetailedErrorBanner";
import { SaveTimeoutWarning } from "../common/SaveTimeoutWarning";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { GoogleCalendarSyncToggle } from "../common/GoogleCalendarSyncToggle";
import { getISODate, formatTimeRange } from "../../utils/dateUtils";
import {
  Clock,
  MapPin,
  DollarSign,
  Phone,
  Trash2,
  Radio,
  Copy,
  Loader2,
  Bell,
  CheckCircle2,
  Volume2,
  AlertCircle,
} from "lucide-react";
import { detectScheduleConflict } from "../../utils/conflictUtils";
import {
  requestNotificationPermission,
  getNotificationPermission,
  showTestNotification,
} from "../../utils/notificationService";

interface TocataModalProps {
  isOpen: boolean;
  onClose: () => void;
  tocataToEdit?: Tocata | null;
  defaultFecha?: string;
}

const PROYECTOS: ProyectoDJ[] = [
  "Rodrigo Valdivia",
  "Sokolov",
  "Área 51",
  "Otro",
];

const ESTADOS_TOCATA: { value: EstadoTocata; label: string }[] = [
  { value: "confirmada", label: "Confirmada" },
  { value: "pendiente", label: "Pendiente" },
  { value: "realizada", label: "Realizada" },
  { value: "cancelada", label: "Cancelada" },
];

/** Formatea números o texto extrayendo solo los dígitos y separando miles con puntos (.) sin conflicto de símbolos */
function formatCLPString(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  return isNaN(num) ? "" : num.toLocaleString("es-CL");
}

/** Extrae el número entero en pesos o null si está vacío, inmune a símbolos como $, puntos o comas */
function parseCLPString(raw: string): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const num = parseInt(digits, 10);
  return isNaN(num) ? null : num;
}

export const TocataModal: React.FC<TocataModalProps> = ({
  isOpen,
  onClose,
  tocataToEdit,
  defaultFecha,
}) => {
  const {
    clases = [],
    tocatas = [],
    alumnos = [],
    captureEditPrecondition,
    addTocata,
    updateTocata,
    deleteTocata,
    enableEntityCalendarLink,
    disableEntityCalendarLink,
    retryEntityCalendarSync,
  } = useAgenda();
  const { calendarAuth } = useAuth();

  const [editingTocataId, setEditingTocataId] = useState<string | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Progressive Disclosure: acordeón para campos secundarios (Ley de Hick)
  const [showOptionalDetails, setShowOptionalDetails] = useState<boolean>(() => {
    return Boolean(
      tocataToEdit?.lugar ||
      tocataToEdit?.ciudad ||
      tocataToEdit?.direccion ||
      tocataToEdit?.contacto ||
      tocataToEdit?.honorarios ||
      tocataToEdit?.notas ||
      tocataToEdit?.googleCalendar?.enabled
    );
  });

  const [titulo, setTitulo] = useState("");
  const [fecha, setFecha] = useState("");
  const [horaInicio, setHoraInicio] = useState("23:00");
  const [horaFin, setHoraFin] = useState("03:00");
  const [proyecto, setProyecto] = useState<ProyectoDJ>("Rodrigo Valdivia");
  const [estado, setEstado] = useState<EstadoTocata>("confirmada");
  const [lugar, setLugar] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [contacto, setContacto] = useState("");
  const [honorarios, setHonorarios] = useState<string>("");
  const [notas, setNotas] = useState("");

  const [syncWithGoogle, setSyncWithGoogle] = useState(() => Boolean(tocataToEdit?.googleCalendar?.enabled));
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  // Alerta y notificación de prueba
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | "unsupported">("default");
  const [isTestingNotification, setIsTestingNotification] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [precondition, setPrecondition] = useState<AgendaEditPrecondition | null>(null);
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const openedEntity = useRef<string | null>(null);
  const pending = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formTopRef = useRef<HTMLDivElement>(null);
  const closeWhenIdle = () => { if (!pending.current) onClose(); };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) { openedEntity.current = null; return; }
    if (isOpen) {
      setPermissionStatus(getNotificationPermission());
      setTestFeedback(null);
      const key = tocataToEdit?.id ?? "new";
      if (openedEntity.current === key) return;
      openedEntity.current = key;
      setPrecondition(tocataToEdit ? captureEditPrecondition("tocata", tocataToEdit) : null);
      setOperationError(null);
      setShowTimeoutWarning(false);
      setShowDeleteConfirm(false);
      if (tocataToEdit) {
        setEditingTocataId(tocataToEdit.id);
        setIsDuplicating(false);
        setTitulo(tocataToEdit.titulo);
        setFecha(tocataToEdit.fecha);
        setHoraInicio(tocataToEdit.horaInicio);
        setHoraFin(tocataToEdit.horaFin);
        setProyecto(tocataToEdit.proyecto);
        setEstado(tocataToEdit.estado);
        setLugar(tocataToEdit.lugar || "");
        setCiudad(tocataToEdit.ciudad || "");
        setDireccion(tocataToEdit.direccion || "");
        setContacto(tocataToEdit.contacto || "");
        setHonorarios(
          tocataToEdit.honorarios !== null && tocataToEdit.honorarios !== undefined
            ? formatCLPString(tocataToEdit.honorarios)
            : ""
        );
        setNotas(tocataToEdit.notas || "");
        setSyncWithGoogle(Boolean(tocataToEdit.googleCalendar?.enabled));
        setIsRetryingSync(false);
      } else {
        setEditingTocataId(null);
        setIsDuplicating(false);
        setTitulo("");
        setFecha(defaultFecha || getISODate(new Date()));
        setHoraInicio("23:00");
        setHoraFin("03:00");
        setProyecto("Rodrigo Valdivia");
        setEstado("confirmada");
        setLugar("");
        setCiudad("");
        setDireccion("");
        setContacto("");
        setHonorarios("");
        setNotas("");
        setSyncWithGoogle(false);
        setIsRetryingSync(false);
      }
      setErrors({});
    }
  }, [isOpen, tocataToEdit, defaultFecha, captureEditPrecondition]);

  const handleDuplicate = () => {
    if (pending.current) return;
    setPrecondition(null);
    setOperationError(null);
    // Switch to creation mode with cloned data, leaving date empty and mandatory
    setEditingTocataId(null);
    setIsDuplicating(true);
    setFecha("");
    setSyncWithGoogle(Boolean(tocataToEdit?.googleCalendar?.enabled));
    setIsRetryingSync(false);
    setErrors({});
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!titulo.trim()) {
      errs.titulo = "El título de la tocata es obligatorio.";
    } else if (titulo.trim().length < 2) {
      errs.titulo = "El título debe tener al menos 2 caracteres.";
    }

    if (!fecha) {
      errs.fecha = "Ingresa una fecha válida.";
    }

    if (!horaInicio) {
      errs.horaInicio = "Ingresa la hora de inicio.";
    }

    if (!horaFin) {
      errs.horaFin = "Ingresa la hora de término.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Schedule Collision Detection (HCI Non-blocking warning banner)
  const scheduleConflict = useMemo(() => {
    return detectScheduleConflict({
      fecha,
      horaInicio,
      horaFin,
      excludeEventId: editingTocataId || undefined,
      clases,
      tocatas,
      alumnos,
    });
  }, [fecha, horaInicio, horaFin, editingTocataId, clases, tocatas, alumnos]);

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
      const sent = await showTestNotification();
      if (sent) {
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
    if (pending.current) {
      setOperationError("Ya hay una operación de guardado en curso. Espera la respuesta o cierra el formulario.");
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!validate()) {
      setOperationError("Por favor completa los campos obligatorios marcados en rojo.");
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    pending.current = true;
    setSaving(true);
    setOperationError(null);
    setShowTimeoutWarning(false);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    timerRef.current = setTimeout(() => {
      setSaving(false);
      setShowTimeoutWarning(true);
      // pending.current PERMANECE en true para evitar dobles envíos
    }, 20000);

    try {
      const parsedHonorarios = parseCLPString(honorarios);

      const isCalendarAuthorized =
        calendarAuth.status === "authorized_temporarily" && Boolean(calendarAuth.identity);
      const wasEnabled = Boolean(tocataToEdit?.googleCalendar?.enabled);

      if (syncWithGoogle && !wasEnabled && !isCalendarAuthorized) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setOperationError("Debes autorizar Google Calendar para activar la sincronización, o desactiva la casilla.");
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

      if (editingTocataId) {
        const effectivePrecondition =
          precondition || (tocataToEdit ? captureEditPrecondition("tocata", tocataToEdit) : null);
        await updateTocata(
          editingTocataId,
          {
            titulo: titulo.trim(),
            fecha,
            horaInicio,
            horaFin,
            proyecto,
            estado,
            lugar: lugar.trim() || undefined,
            ciudad: ciudad.trim() || undefined,
            direccion: direccion.trim() || undefined,
            contacto: contacto.trim() || undefined,
            honorarios: parsedHonorarios,
            notas: notas.trim() || undefined,
          },
          effectivePrecondition
        );

        const wasEnabled = Boolean(tocataToEdit?.googleCalendar?.enabled);
        if (syncWithGoogle && !wasEnabled && authorizedLink) {
          await enableEntityCalendarLink("tocata", editingTocataId, authorizedLink);
        } else if (!syncWithGoogle && wasEnabled) {
          await disableEntityCalendarLink("tocata", editingTocataId);
        }
      } else {
        await addTocata(
          {
            titulo: titulo.trim(),
            fecha,
            horaInicio,
            horaFin,
            proyecto,
            estado,
            lugar: lugar.trim() || undefined,
            ciudad: ciudad.trim() || undefined,
            direccion: direccion.trim() || undefined,
            contacto: contacto.trim() || undefined,
            honorarios: parsedHonorarios,
            notas: notas.trim() || undefined,
          },
          authorizedLink
        );
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      onClose();
    } catch (error) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      console.error("Error al guardar tocata:", error);
      setOperationError(agendaCrudErrorMessage(error));
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pending.current = false;
      setSaving(false);
    }
  };

  const handleRetrySync = async () => {
    if (!editingTocataId) return;
    setIsRetryingSync(true);
    try {
      await retryEntityCalendarSync("tocata", editingTocataId);
    } catch (err) {
      console.error("Error al reintentar sincronización:", err);
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTocataId || pending.current) return;
    pending.current = true;
    setSaving(true);
    setOperationError(null);
    try {
      const effectivePrecondition =
        precondition || (tocataToEdit ? captureEditPrecondition("tocata", tocataToEdit) : null);
      await deleteTocata(editingTocataId, effectivePrecondition);
      setShowDeleteConfirm(false);
      onClose();
    } catch (error) {
      console.error("Error al eliminar tocata:", error);
      setOperationError(agendaCrudErrorMessage(error));
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const isEditing = !!editingTocataId;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={closeWhenIdle}
        title={
          isDuplicating
            ? "Nueva Fecha DJ (Copia)"
            : isEditing
            ? "Editar Fecha DJ"
            : "Nueva Fecha DJ"
        }
        subtitle={
          isDuplicating
            ? "Selecciona una nueva fecha para programar la Fecha DJ duplicada"
            : "Detalles del evento, proyecto DJ, horario y locación"
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={formTopRef} />
          {operationError && (
            <>
              <div role="alert" className="sr-only">
                {operationError}
              </div>
              <DetailedErrorBanner
                id="tocata-submit-error"
                error={operationError}
              />
            </>
          )}
          {/* Título */}
          <div>
            <label htmlFor="tocata-titulo" className="block text-xs font-medium text-slate-300 mb-1.5">
              Título / Evento <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              id="tocata-titulo"
              placeholder="Ej: Club Subterráneo Live Set, Festival Nocturno"
              value={titulo}
              onChange={(e) => {
                setTitulo(e.target.value);
                if (errors.titulo) setErrors((prev) => ({ ...prev, titulo: "" }));
              }}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.titulo && (
              <p className="text-xs text-rose-400 mt-1">{errors.titulo}</p>
            )}
          </div>

          {/* Proyecto y Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tocata-proyecto" className="block text-xs font-medium text-slate-300 mb-1.5">
                Proyecto DJ <span className="text-rose-400">*</span>
              </label>
              <select
                id="tocata-proyecto"
                value={proyecto}
                onChange={(e) => setProyecto(e.target.value as ProyectoDJ)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROYECTOS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tocata-estado" className="block text-xs font-medium text-slate-300 mb-1.5">
                Estado <span className="text-rose-400">*</span>
              </label>
              <select
                id="tocata-estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoTocata)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ESTADOS_TOCATA.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fecha y Horario */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="tocata-fecha" className="block text-xs font-medium text-slate-300 mb-1.5">
                Fecha <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                id="tocata-fecha"
                value={fecha}
                onChange={(e) => {
                  setFecha(e.target.value);
                  if (errors.fecha) setErrors((prev) => ({ ...prev, fecha: "" }));
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.fecha && (
                <p className="text-xs text-rose-400 mt-1">{errors.fecha}</p>
              )}
            </div>

            <div>
              <label htmlFor="tocata-hora-inicio" className="block text-xs font-medium text-slate-300 mb-1.5">
                Hora inicio <span className="text-rose-400">*</span>
              </label>
              <input
                type="time"
                id="tocata-hora-inicio"
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
              <label htmlFor="tocata-hora-fin" className="block text-xs font-medium text-slate-300 mb-1.5">
                Hora término <span className="text-rose-400">*</span>
              </label>
              <input
                type="time"
                id="tocata-hora-fin"
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

          {/* Banner de solapamiento de horario (HCI Alerta no bloqueante) */}
          {scheduleConflict && (
            <div
              id="banner-conflicto-horario-tocata"
              className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-start gap-2.5 text-amber-200"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <p className="font-semibold text-amber-300">
                  Advertencia: Posible solapamiento de horario
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Coincide con {scheduleConflict.tipo === "clase" ? "la clase de" : "la fecha DJ"}{" "}
                  <strong className="text-white font-semibold">{scheduleConflict.nombre}</strong> ({scheduleConflict.horaInicio} - {scheduleConflict.horaFin}).
                </p>
              </div>
            </div>
          )}

          {/* Progressive Disclosure: Acordeón para campos secundarios (Ley de Hick) */}
          <div className="pt-1">
            <button
              type="button"
              id="btn-toggle-detalles-tocata"
              onClick={() => setShowOptionalDetails(!showOptionalDetails)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 transition-colors cursor-pointer select-none"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                <span>
                  {showOptionalDetails
                    ? "Ocultar opciones adicionales"
                    : "Más opciones (locación, honorarios, notas, alertas, calendar)"}
                </span>
              </span>
              <span
                className={`text-[10px] text-slate-400 transition-transform duration-200 inline-block ${
                  showOptionalDetails ? "rotate-180" : ""
                }`}
              >
                ▼
              </span>
            </button>

            {showOptionalDetails && (
              <div className="mt-3 space-y-4 pt-1">
                {/* Lugar y Ciudad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tocata-lugar" className="block text-xs font-medium text-slate-300 mb-1.5">
                Lugar / Club / Evento (opcional)
              </label>
              <input
                type="text"
                id="tocata-lugar"
                placeholder="Ej: Club Subterráneo, Espacio Riesco"
                value={lugar}
                onChange={(e) => setLugar(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="tocata-ciudad" className="block text-xs font-medium text-slate-300 mb-1.5">
                Ciudad (opcional)
              </label>
              <input
                type="text"
                id="tocata-ciudad"
                placeholder="Ej: Santiago, Valparaíso, Viña del Mar"
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Dirección y Contacto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tocata-direccion" className="block text-xs font-medium text-slate-300 mb-1.5">
                Dirección exacta (opcional)
              </label>
              <input
                type="text"
                id="tocata-direccion"
                placeholder="Ej: Paseo Orrego Luco 46"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="tocata-contacto" className="block text-xs font-medium text-slate-300 mb-1.5">
                Contacto / Producción (opcional)
              </label>
              <input
                type="text"
                id="tocata-contacto"
                placeholder="Ej: Matías (+56 9 7711 2233)"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Honorarios */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="tocata-honorarios" className="block text-xs font-medium text-slate-300">
                Honorarios acordados en CLP (opcional)
              </label>
              {honorarios && (
                <button
                  type="button"
                  id="btn-limpiar-honorarios"
                  onClick={() => setHonorarios("")}
                  className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Quitar valor
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono font-medium">$</span>
              <input
                type="text"
                inputMode="numeric"
                id="tocata-honorarios"
                placeholder="Ej: 250.000 (o déjalo en blanco)"
                value={honorarios}
                onChange={(e) => {
                  setHonorarios(formatCLPString(e.target.value));
                  if (errors.honorarios) setErrors((prev) => ({ ...prev, honorarios: "" }));
                }}
                className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Inmune a símbolos: puedes escribir números libres o con puntos. Si no aplica pago, déjalo en blanco o haz clic en "Quitar valor".
            </p>
          </div>

          {/* Notas */}
          <div>
            <label htmlFor="tocata-notas" className="block text-xs font-medium text-slate-300 mb-1.5">
              Notas técnicas y logística (opcional)
            </label>
            <textarea
              id="tocata-notas"
              rows={2}
              placeholder="Soundcheck, formato de pendrives, equipamiento disponible en cabina..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Avisos y Notificaciones Push (24h, 2h y 30m) */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 bg-amber-950/70 border-amber-700/80 text-amber-300 shadow-sm">
                <Bell className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-semibold text-slate-200 block truncate">
                  Recordatorios automáticos en tu celular
                </p>
                <p className="text-[11px] text-slate-400 leading-tight">
                  Avisos programados a las 24 horas, 2 horas y 30 minutos antes de la tocata.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
              {permissionStatus !== "granted" ? (
                <div className="flex items-center justify-between w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs gap-2">
                  <span className="text-amber-400 text-[11px]">
                    {permissionStatus === "denied"
                      ? "Permiso de notificaciones bloqueado en navegador"
                      : "Habilita permisos para recibir alertas push"}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await requestNotificationPermission();
                      setPermissionStatus(res);
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-md transition-colors shrink-0 cursor-pointer"
                  >
                    Habilitar
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between w-full text-[11px]">
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Alertas push habilitadas
                  </span>
                  <button
                    type="button"
                    onClick={handleTestNotification}
                    disabled={isTestingNotification}
                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Volume2 className="w-3 h-3" />
                    {isTestingNotification ? "Probando..." : "Probar sonido y alerta"}
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

          {/* Sincronización con Google Calendar */}
          <GoogleCalendarSyncToggle
            enabled={syncWithGoogle}
            onChange={setSyncWithGoogle}
            metadata={tocataToEdit?.googleCalendar}
            onRetry={editingTocataId ? handleRetrySync : undefined}
            isRetrying={isRetryingSync}
          />
              </div>
            )}
          </div>

          {operationError && (
            <div className="pt-2">
              <DetailedErrorBanner
                id="tocata-submit-error-bottom"
                error={operationError}
              />
            </div>
          )}

          {showTimeoutWarning && (
            <div className="pt-2">
              <SaveTimeoutWarning
                id="tocata-timeout-warning"
                onDismiss={() => setShowTimeoutWarning(false)}
              />
            </div>
          )}

          {/* Actions: [Guardar] [Cancelar] a la izquierda con espacio inferior de seguridad */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pt-4 pb-12 sm:pb-2 border-t border-slate-800 gap-3">
            <div className="flex items-center justify-start gap-2.5 flex-wrap">
              <button
                type="submit"
                disabled={saving}
                id="btn-guardar-tocata"
                className="inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2 text-xs sm:text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shadow-sm cursor-pointer min-w-[140px] active:scale-[0.98]"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white shrink-0" />
                    <span>Guardando...</span>
                  </>
                ) : isEditing ? (
                  "Guardar cambios"
                ) : (
                  "Crear Fecha DJ"
                )}
              </button>
              <button
                type="button"
                id="btn-cancelar-tocata"
                onClick={closeWhenIdle}
                disabled={saving}
                className="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>

            {isEditing && (
              <div className="flex items-center justify-start sm:justify-end gap-2 sm:ml-auto">
                <button
                  type="button"
                  id="btn-duplicar-tocata"
                  onClick={handleDuplicate}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:text-slate-50 bg-slate-850 hover:bg-slate-800 border border-slate-700/80 rounded-xl transition-colors active:scale-[0.98] shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Copy className="w-4 h-4 text-slate-400" />
                  Duplicar
                </button>
                <button
                  type="button"
                  id="btn-eliminar-tocata"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-900/50 rounded-xl transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => { if (!pending.current) setShowDeleteConfirm(false); }}
        onConfirm={handleDelete}
        title="Eliminar tocata"
        message={operationError ?? `¿Eliminar la tocata “${titulo || "sin título"}”? Esta acción no se puede deshacer.`}
        confirmText="Eliminar tocata"
        isDestructive={true}
      />
    </>
  );
};
