import React, { useState } from "react";
import { Alumno, Clase, NotaAlumno } from "../../types";
import { useAgenda } from "../../context/AgendaContext";
import { Modal } from "../common/Modal";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { EstadoAlumnoBadge, CategoryBadge, EstadoBadge } from "../common/Badge";
import {
  formatFechaLarga,
  formatFechaCorta,
  formatTimeRange,
  getISODate,
} from "../../utils/dateUtils";
import {
  Phone,
  Mail,
  FileText,
  Calendar,
  Clock,
  Plus,
  Trash2,
  Edit2,
  CalendarPlus,
  Check,
  X,
  Tag,
} from "lucide-react";

interface AlumnoFichaModalProps {
  isOpen: boolean;
  onClose: () => void;
  alumno: Alumno | null;
  onEditAlumno: (alumno: Alumno) => void;
  onNewClaseForAlumno: (alumnoId: string) => void;
  onOpenClaseDetail: (clase: Clase) => void;
}

export const AlumnoFichaModal: React.FC<AlumnoFichaModalProps> = ({
  isOpen,
  onClose,
  alumno,
  onEditAlumno,
  onNewClaseForAlumno,
  onOpenClaseDetail,
}) => {
  const {
    deleteAlumno,
    getNotasByAlumnoId,
    addNota,
    updateNota,
    deleteNota,
    getClasesByAlumnoId,
  } = useAgenda();

  const [nuevaNotaTexto, setNuevaNotaTexto] = useState("");
  const [editingNotaId, setEditingNotaId] = useState<string | null>(null);
  const [editingNotaTexto, setEditingNotaTexto] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notaToDelete, setNotaToDelete] = useState<NotaAlumno | null>(null);

  if (!alumno) return null;

  const notas = getNotasByAlumnoId(alumno.id);
  const todasClases = getClasesByAlumnoId(alumno.id);

  // Proximas clases no canceladas
  const hoyIso = getISODate(new Date());
  const proximasClases = todasClases
    .filter((c) => c.estado !== "cancelada" && c.fecha >= hoyIso)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio));

  const handleAddNota = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaNotaTexto.trim()) return;

    addNota({
      alumnoId: alumno.id,
      texto: nuevaNotaTexto.trim(),
      fecha: getISODate(new Date()),
    });
    setNuevaNotaTexto("");
  };

  const handleStartEditNota = (nota: NotaAlumno) => {
    setEditingNotaId(nota.id);
    setEditingNotaTexto(nota.texto);
  };

  const handleSaveEditNota = (notaId: string) => {
    if (!editingNotaTexto.trim()) return;
    updateNota(notaId, editingNotaTexto.trim());
    setEditingNotaId(null);
    setEditingNotaTexto("");
  };

  const handleDeleteAlumno = () => {
    deleteAlumno(alumno.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  const tipoClaseLabel =
    alumno.tipoClase === "alma"
      ? "Clases ALMA"
      : alumno.tipoClase === "escalera"
      ? "Mentorías La Escalera"
      : alumno.tipoClase === "dj"
      ? "Clases DJ"
      : alumno.tipoClase === "sokolov"
      ? "Sokolov"
      : null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={alumno.nombre}
        subtitle="Ficha y seguimiento del alumno"
        maxWidth="lg"
      >
        <div className="space-y-6">
          {/* Header Card / Info */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <EstadoAlumnoBadge activo={alumno.activo} size="md" />
                {tipoClaseLabel && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-950/80 text-blue-300 border border-blue-800/60">
                    <Tag className="w-3 h-3" />
                    {tipoClaseLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-editar-ficha-alumno"
                  onClick={() => {
                    onClose();
                    onEditAlumno(alumno);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Editar alumno
                </button>
                <button
                  type="button"
                  id="btn-eliminar-ficha-alumno"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition-colors border border-rose-900/40"
                  title="Eliminar alumno"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Teléfono */}
            <div className="flex items-center gap-2.5 text-sm text-slate-300">
              <Phone className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                {alumno.telefono ? (
                  <a
                    href={`tel:${alumno.telefono}`}
                    className="text-blue-400 hover:underline"
                  >
                    {alumno.telefono}
                  </a>
                ) : (
                  <span className="text-slate-500 italic">No registrado</span>
                )}
              </span>
            </div>

            {/* Correo Electrónico */}
            {alumno.email && (
              <div className="flex items-center gap-2.5 text-sm text-slate-300">
                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                <a
                  href={`mailto:${alumno.email}`}
                  className="text-blue-400 hover:underline"
                >
                  {alumno.email}
                </a>
              </div>
            )}

            {/* Descripción */}
            <div className="flex items-start gap-2.5 text-sm text-slate-300">
              <FileText className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                {alumno.descripcion ? (
                  alumno.descripcion
                ) : (
                  <span className="text-slate-500 italic">Sin descripción</span>
                )}
              </p>
            </div>

            {/* Fecha creación */}
            <div className="text-xs text-slate-500 pt-1">
              Registrado el {formatFechaLarga(alumno.createdAt.slice(0, 10))}
            </div>
          </div>

          {/* Próximas Clases Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                Próximas Clases ({proximasClases.length})
              </h4>
              <button
                type="button"
                id="btn-nueva-clase-para-alumno"
                onClick={() => {
                  onClose();
                  onNewClaseForAlumno(alumno.id);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-300 hover:text-white bg-blue-950/60 hover:bg-blue-900/80 border border-blue-800/80 rounded-lg transition-colors"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Nueva clase
              </button>
            </div>

            {proximasClases.length === 0 ? (
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                No hay clases próximas agendadas para este alumno.
              </div>
            ) : (
              <div className="space-y-2">
                {proximasClases.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      onClose();
                      onOpenClaseDetail(c);
                    }}
                    className="p-3 bg-slate-950 hover:bg-slate-900/90 border border-slate-800 rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CategoryBadge category={c.tipo} size="sm" />
                        <span className="text-xs font-medium text-slate-300">
                          {formatFechaCorta(c.fecha)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatTimeRange(c.horaInicio, c.horaFin)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-100">
                        {c.tema}
                      </p>
                    </div>
                    <EstadoBadge estado={c.estado} size="sm" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notas de Aprendizaje Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              Notas de Seguimiento y Ejercicios ({notas.length})
            </h4>

            {/* Add note input */}
            <form onSubmit={handleAddNota} className="space-y-2">
              <textarea
                id="input-nueva-nota"
                rows={2}
                placeholder="Escribe una observación pedagógica, tarea o avance del alumno..."
                value={nuevaNotaTexto}
                onChange={(e) => setNuevaNotaTexto(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  id="btn-agregar-nota"
                  disabled={!nuevaNotaTexto.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Agregar nota
                </button>
              </div>
            </form>

            {/* Notes list */}
            {notas.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                Sin notas todavía.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {notas.map((nota) => (
                  <div
                    key={nota.id}
                    className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2"
                  >
                    {editingNotaId === nota.id ? (
                      <div className="space-y-2">
                        <textarea
                          rows={2}
                          value={editingNotaTexto}
                          onChange={(e) => setEditingNotaTexto(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingNotaId(null)}
                            className="p-1 text-slate-400 hover:text-slate-200 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEditNota(nota.id)}
                            className="p-1 text-emerald-400 hover:text-emerald-300 rounded"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {nota.texto}
                          </p>
                          <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                            <button
                              type="button"
                              onClick={() => handleStartEditNota(nota)}
                              className="p-1 text-slate-500 hover:text-slate-300 rounded"
                              title="Editar nota"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              id={`btn-eliminar-nota-${nota.id}`}
                              onClick={() => setNotaToDelete(nota)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                              title="Eliminar nota"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatFechaCorta(nota.fecha)}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmación para Alumno (Borrado en cascada) */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAlumno}
        title="Eliminar alumno"
        message={`¿Eliminar definitivamente a ${alumno.nombre}? Se eliminarán todas sus clases y notas asociadas en Firestore para evitar datos huérfanos. Esta acción es irreversible.`}
        confirmText="Eliminar alumno y datos"
        isDestructive={true}
      />

      {/* Confirmación para Nota individual */}
      <ConfirmDialog
        isOpen={!!notaToDelete}
        onClose={() => setNotaToDelete(null)}
        onConfirm={() => {
          if (notaToDelete) {
            deleteNota(notaToDelete.id);
            setNotaToDelete(null);
          }
        }}
        title="Eliminar nota de seguimiento"
        message="¿Estás seguro de que deseas eliminar esta nota pedagógica? Esta acción no se puede deshacer."
        confirmText="Eliminar nota"
        isDestructive={true}
      />
    </>
  );
};
