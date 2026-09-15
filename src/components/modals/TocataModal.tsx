import React, { useState, useRef, useEffect } from "react";
import { Tocata, ProyectoDJ, EstadoTocata } from "../../types";
import { useAgenda, agendaCrudErrorMessage, AgendaCrudError, type AgendaEditPrecondition, type AgendaAuthorizedLink } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { Modal } from "../common/Modal";
import { DetailedErrorBanner } from "../common/DetailedErrorBanner";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { GoogleCalendarSyncToggle } from "../common/GoogleCalendarSyncToggle";
import { getISODate, formatTimeRange } from "../../utils/dateUtils";
import { Clock, MapPin, DollarSign, Phone, Trash2, Radio, Copy } from "lucide-react";

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

export const TocataModal: React.FC<TocataModalProps> = ({
  isOpen,
  onClose,
  tocataToEdit,
  defaultFecha,
}) => {
  const {
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

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [precondition, setPrecondition] = useState<AgendaEditPrecondition | null>(null);
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const openedEntity = useRef<string | null>(null);
  const pending = useRef(false);
  const closeWhenIdle = () => { if (!pending.current) onClose(); };

  useEffect(() => {
    if (!isOpen) { openedEntity.current = null; return; }
    if (isOpen) {
      const key = tocataToEdit?.id ?? "new";
      if (openedEntity.current === key) return;
      openedEntity.current = key;
      setPrecondition(tocataToEdit ? captureEditPrecondition("tocata", tocataToEdit) : null);
      setOperationError(null);
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
            ? String(tocataToEdit.honorarios)
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

    if (honorarios.trim() !== "") {
      const num = Number(honorarios);
      if (isNaN(num) || num < 0) {
        errs.honorarios = "Los honorarios deben ser un valor numérico mayor o igual a 0.";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !validate()) return;
    pending.current = true; setSaving(true); setOperationError(null);
    try {

    const parsedHonorarios =
      honorarios.trim() !== "" ? Number(honorarios.trim()) : null;

    const isCalendarAuthorized =
      calendarAuth.status === "authorized_temporarily" && Boolean(calendarAuth.identity);
    const wasEnabled = Boolean(tocataToEdit?.googleCalendar?.enabled);

    if (syncWithGoogle && !wasEnabled && !isCalendarAuthorized) {
      setOperationError("Debes autorizar Google Calendar para activar la sincronización.");
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
      if (!precondition) throw new AgendaCrudError("invalid_argument");
      await updateTocata(editingTocataId, {
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
      }, precondition);

      const wasEnabled = Boolean(tocataToEdit?.googleCalendar?.enabled);
      if (syncWithGoogle && !wasEnabled && authorizedLink) {
        await enableEntityCalendarLink("tocata", editingTocataId, authorizedLink);
      } else if (!syncWithGoogle && wasEnabled) {
        await disableEntityCalendarLink("tocata", editingTocataId);
      }
    } else {
      await addTocata({
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
      }, authorizedLink);
    }

    onClose();
    } catch (error) { setOperationError(agendaCrudErrorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
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
    pending.current = true; setSaving(true); setOperationError(null);
    try {
      if (!precondition) throw new AgendaCrudError("invalid_argument");
      await deleteTocata(editingTocataId, precondition);
      setShowDeleteConfirm(false);
      onClose();
    } catch (error) { setOperationError(agendaCrudErrorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
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
            <label htmlFor="tocata-honorarios" className="block text-xs font-medium text-slate-300 mb-1.5">
              Honorarios acordados en CLP (opcional)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">$</span>
              <input
                type="number"
                id="tocata-honorarios"
                placeholder="Ej: 250000"
                min="0"
                step="1000"
                value={honorarios}
                onChange={(e) => {
                  setHonorarios(e.target.value);
                  if (errors.honorarios) setErrors((prev) => ({ ...prev, honorarios: "" }));
                }}
                className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {errors.honorarios && (
              <p className="text-xs text-rose-400 mt-1">{errors.honorarios}</p>
            )}
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

          {/* Sincronización con Google Calendar */}
          <GoogleCalendarSyncToggle
            enabled={syncWithGoogle}
            onChange={setSyncWithGoogle}
            metadata={tocataToEdit?.googleCalendar}
            onRetry={editingTocataId ? handleRetrySync : undefined}
            isRetrying={isRetryingSync}
          />

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800 gap-2 flex-wrap">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-eliminar-tocata"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-900/50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                </button>
                <button
                  type="button"
                  id="btn-duplicar-tocata"
                  onClick={handleDuplicate}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:text-slate-50 bg-slate-850 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors active:scale-[0.98] shadow-sm"
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
                disabled={saving}
                id="btn-guardar-tocata"
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isEditing ? "Guardar cambios" : "Crear Fecha DJ"}
              </button>
              <button
                type="button"
                id="btn-cancelar-tocata"
                onClick={closeWhenIdle}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
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
