import React, { useState, useEffect, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Alumno, TipoClase } from "../../types";
import { useAgenda } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { Modal } from "../common/Modal";
import { DetailedErrorBanner } from "../common/DetailedErrorBanner";
import { SaveTimeoutWarning } from "../common/SaveTimeoutWarning";
import { executeSaveAlumno, MENSAJE_OPERACION_EN_CURSO } from "./alumnoSaveHandler";

interface AlumnoModalProps {
  isOpen: boolean;
  onClose: () => void;
  alumnoToEdit?: Alumno | null;
  onAlumnoCreated?: (alumno: Alumno) => void;
}

export const AlumnoModal: React.FC<AlumnoModalProps> = ({
  isOpen,
  onClose,
  alumnoToEdit,
  onAlumnoCreated,
}) => {
  const { addAlumno, updateAlumno } = useAgenda();
  const { currentUser } = useAuth();

  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [tipoClase, setTipoClase] = useState<TipoClase | "">("");
  const [descripcion, setDescripcion] = useState("");
  const [activo, setActivo] = useState(true);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const isOperationActiveRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setSubmitError(null);
      setIsSaving(false);
      setShowTimeoutWarning(false);
      isOperationActiveRef.current = false;
      if (alumnoToEdit) {
        if (alumnoToEdit.apellido) {
          const suffix = alumnoToEdit.apellido.toLowerCase();
          const fullName = alumnoToEdit.nombre;
          if (fullName.toLowerCase().endsWith(suffix)) {
            setNombre(fullName.slice(0, -alumnoToEdit.apellido.length).trim());
          } else {
            setNombre(fullName);
          }
          setApellido(alumnoToEdit.apellido);
        } else {
          const parts = alumnoToEdit.nombre.trim().split(/\s+/);
          if (parts.length > 1) {
            setNombre(parts.slice(0, -1).join(" "));
            setApellido(parts[parts.length - 1]);
          } else {
            setNombre(alumnoToEdit.nombre);
            setApellido("");
          }
        }
        setTelefono(alumnoToEdit.telefono || "");
        setEmail(alumnoToEdit.email || "");
        setTipoClase(alumnoToEdit.tipoClase || "");
        setDescripcion(alumnoToEdit.descripcion || "");
        setActivo(alumnoToEdit.activo);
      } else {
        setNombre("");
        setApellido("");
        setTelefono("");
        setEmail("");
        setTipoClase("");
        setDescripcion("");
        setActivo(true);
      }
      setErrors({});
    }
  }, [isOpen, alumnoToEdit]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!nombre.trim()) {
      errs.nombre = "El nombre del alumno es obligatorio.";
    } else if (nombre.trim().length < 2) {
      errs.nombre = "El nombre debe tener al menos 2 caracteres.";
    }

    if (!apellido.trim() && !alumnoToEdit) {
      errs.apellido = "El apellido del alumno es obligatorio.";
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Ingresa un correo electrónico válido.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!validate()) {
      setSubmitError("Por favor completa los campos obligatorios marcados en rojo.");
      return;
    }

    const trimmedNombre = nombre.trim();
    const trimmedApellido = apellido.trim();
    let nombreCompleto = trimmedNombre;
    if (
      trimmedApellido &&
      !trimmedNombre.toLowerCase().endsWith(trimmedApellido.toLowerCase())
    ) {
      nombreCompleto = `${trimmedNombre} ${trimmedApellido}`;
    }

    const payload = {
      nombre: nombreCompleto,
      apellido: trimmedApellido || undefined,
      telefono: telefono.trim() || undefined,
      email: email.trim() || undefined,
      tipoClase: (tipoClase || undefined) as TipoClase | undefined,
      descripcion: descripcion.trim() || undefined,
      activo,
      ...(alumnoToEdit?.nivel ? { nivel: alumnoToEdit.nivel } : {}),
    };

    if (isSaving || isOperationActiveRef.current) {
      setSubmitError(MENSAJE_OPERACION_EN_CURSO);
      return;
    }

    await executeSaveAlumno({
      alumnoToEdit,
      payload,
      currentUser,
      isDeviceOffline: typeof navigator !== "undefined" && !navigator.onLine,
      addAlumno,
      updateAlumno,
      onAlumnoCreated,
      onClose,
      setIsSaving,
      setSubmitError,
      onTimeoutWarning: setShowTimeoutWarning,
      activeRef: isOperationActiveRef,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSaving && !isOperationActiveRef.current) {
          onClose();
        }
      }}
      title={alumnoToEdit ? "Editar Alumno" : "Nuevo Alumno"}
      subtitle="Datos de contacto, modalidad y estado de matrícula"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error Banner */}
        {submitError && (
          <DetailedErrorBanner
            id="alumno-submit-error"
            error={submitError}
          />
        )}

        {/* Nombre y Apellido */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="alumno-nombre"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Nombre <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              id="alumno-nombre"
              maxLength={100}
              placeholder="Ej: Camila"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                if (errors.nombre)
                  setErrors((prev) => ({ ...prev, nombre: "" }));
              }}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.nombre && (
              <p className="text-xs text-rose-400 mt-1">{errors.nombre}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="alumno-apellido"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Apellido {!alumnoToEdit && <span className="text-rose-400">*</span>}
            </label>
            <input
              type="text"
              id="alumno-apellido"
              maxLength={100}
              placeholder="Ej: Rojas"
              value={apellido}
              onChange={(e) => {
                setApellido(e.target.value);
                if (errors.apellido)
                  setErrors((prev) => ({ ...prev, apellido: "" }));
              }}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.apellido && (
              <p className="text-xs text-rose-400 mt-1">{errors.apellido}</p>
            )}
          </div>
        </div>

        {/* Teléfono y Correo Electrónico */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="alumno-telefono"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Teléfono / WhatsApp (opcional)
            </label>
            <input
              type="tel"
              id="alumno-telefono"
              placeholder="Ej: +56 9 8765 4321"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="alumno-email"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Correo electrónico (opcional)
            </label>
            <input
              type="email"
              id="alumno-email"
              placeholder="Ej: camila@ejemplo.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => ({ ...prev, email: "" }));
              }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.email && (
              <p className="text-xs text-rose-400 mt-1">{errors.email}</p>
            )}
          </div>
        </div>

        {/* Tipo de clase o modalidad compatible con el modelo */}
        <div>
          <label
            htmlFor="alumno-tipo-clase"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Tipo de clase o modalidad principal (opcional)
          </label>
          <select
            id="alumno-tipo-clase"
            value={tipoClase}
            onChange={(e) => setTipoClase(e.target.value as TipoClase | "")}
            className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Sin especificar / Varias modalidades</option>
            <option value="alma">Clases ALMA</option>
            <option value="escalera">Mentorías La Escalera</option>
            <option value="dj">Clases DJ</option>
            <option value="sokolov">Sokolov</option>
          </select>
        </div>

        {/* Descripción / Notas */}
        <div>
          <label
            htmlFor="alumno-descripcion"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Notas generales y objetivos (opcional)
          </label>
          <textarea
            id="alumno-descripcion"
            rows={3}
            maxLength={1000}
            placeholder="Enfoque de aprendizaje, equipamiento propio, software utilizado, notas pedagógicas..."
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Estado activo switch */}
        <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
          <div>
            <span className="text-sm font-medium text-slate-200 block">
              Alumno activo
            </span>
            <span className="text-xs text-slate-400">
              Permite agendar nuevas clases y recibir recordatorios
            </span>
          </div>
          <button
            type="button"
            id="alumno-switch-activo"
            role="switch"
            aria-checked={activo}
            onClick={() => setActivo(!activo)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              activo ? "bg-blue-600" : "bg-slate-800"
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                activo ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {submitError && (
          <div className="pt-2">
            <DetailedErrorBanner
              id="alumno-submit-error-bottom"
              error={submitError}
            />
          </div>
        )}

        {showTimeoutWarning && (
          <div className="pt-2">
            <SaveTimeoutWarning
              id="alumno-timeout-warning"
              onDismiss={() => setShowTimeoutWarning(false)}
            />
          </div>
        )}

        {/* Actions: Alineados a la izquierda [Guardar] [Cancelar] con espacio inferior de seguridad */}
        <div className="flex flex-wrap items-center justify-start gap-3 pt-4 pb-12 sm:pb-2 border-t border-slate-800">
          <button
            type="submit"
            id="btn-guardar-alumno"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shadow-sm cursor-pointer min-w-[140px] active:scale-[0.98]"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white shrink-0" />
                <span>Guardando...</span>
              </>
            ) : alumnoToEdit ? (
              "Guardar cambios"
            ) : (
              "Crear alumno"
            )}
          </button>
          <button
            type="button"
            id="btn-cancelar-alumno"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
};
