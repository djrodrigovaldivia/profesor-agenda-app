import React, { useState, useMemo } from "react";
import { Alumno, Clase } from "../../types";
import { useAgenda } from "../../context/AgendaContext";
import { AlumnoModal } from "./AlumnoModal";
import { AlumnoFichaModal } from "./AlumnoFichaModal";
import { EstadoAlumnoBadge } from "../common/Badge";
import { removeAccents, getISODate } from "../../utils/dateUtils";
import { Search, UserPlus, Users, ChevronRight, Calendar, X, Tag } from "lucide-react";

interface AlumnosViewProps {
  onNewClaseForAlumno: (alumnoId: string) => void;
  onOpenClaseDetail: (clase: Clase) => void;
}

export const AlumnosView: React.FC<AlumnosViewProps> = ({
  onNewClaseForAlumno,
  onOpenClaseDetail,
}) => {
  const { alumnos, clases } = useAgenda();

  const [searchQuery, setSearchQuery] = useState("");
  const [isNewAlumnoModalOpen, setIsNewAlumnoModalOpen] = useState(false);
  const [selectedAlumnoForFicha, setSelectedAlumnoForFicha] = useState<Alumno | null>(null);
  const [alumnoToEdit, setAlumnoToEdit] = useState<Alumno | null>(null);

  // Filter and sort alphabetically in real time
  const filteredAlumnos = useMemo(() => {
    const normalizedQuery = removeAccents(searchQuery.trim().toLowerCase());
    return [...alumnos]
      .filter((a) => {
        if (!normalizedQuery) return true;
        const normalizedName = removeAccents(a.nombre.toLowerCase());
        return normalizedName.includes(normalizedQuery);
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  }, [alumnos, searchQuery]);

  // Map of upcoming class counts per student
  const upcomingClassesCount = useMemo(() => {
    const hoyIso = getISODate(new Date());
    const counts = new Map<string, number>();
    clases.forEach((c) => {
      if (c.estado !== "cancelada" && c.fecha >= hoyIso) {
        counts.set(c.alumnoId, (counts.get(c.alumnoId) || 0) + 1);
      }
    });
    return counts;
  }, [clases]);

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">
              Alumnos
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold text-slate-400 bg-slate-900 border border-slate-800 rounded-full">
              {alumnos.length}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            Gestiona alumnos, modalidades de clase y notas de seguimiento.
          </p>
        </div>
        <button
          type="button"
          id="btn-nuevo-alumno"
          onClick={() => setIsNewAlumnoModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl transition-all shadow-sm active:scale-[0.98] cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Nuevo alumno</span>
        </button>
      </div>

      {/* Real-time search bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            type="text"
            id="input-buscar-alumnos"
            aria-label="Buscar alumnos por nombre"
            placeholder="Buscar alumno por nombre en tiempo real…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
          />
          {searchQuery && (
            <button
              type="button"
              id="btn-limpiar-busqueda-alumnos"
              onClick={() => setSearchQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dynamic counter feedback when searching */}
        {searchQuery.trim() !== "" && (
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Resultados: <strong className="text-slate-200 font-semibold">{filteredAlumnos.length}</strong> de {alumnos.length} {alumnos.length === 1 ? "alumno" : "alumnos"}
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Restablecer
            </button>
          </div>
        )}
      </div>

      {/* Students List */}
      {alumnos.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
            <Users className="w-6 h-6" />
          </div>
          <p className="text-sm text-slate-300 font-medium">
            Aún no tienes alumnos registrados. Crea el primero para comenzar.
          </p>
          <button
            type="button"
            onClick={() => setIsNewAlumnoModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Crear mi primer alumno
          </button>
        </div>
      ) : filteredAlumnos.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2">
          <p className="text-sm font-medium text-slate-300">
            No se encontraron alumnos que coincidan con “<span className="text-white font-semibold">{searchQuery}</span>”.
          </p>
          <p className="text-xs text-slate-500">
            Verifica la ortografía o intenta buscar con otro término.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Limpiar filtro de búsqueda
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredAlumnos.map((alumno) => {
            const nextCount = upcomingClassesCount.get(alumno.id) || 0;
            return (
              <div
                key={alumno.id}
                id={`alumno-card-${alumno.id}`}
                onClick={() => setSelectedAlumnoForFicha(alumno)}
                className="p-4 bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl cursor-pointer transition-all duration-150 flex items-center justify-between gap-3 shadow-sm group active:scale-[0.99]"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-slate-100 group-hover:text-blue-400 transition-colors truncate">
                      {alumno.nombre}
                    </h3>
                    <EstadoAlumnoBadge activo={alumno.activo} size="sm" />
                    {alumno.tipoClase && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700/60">
                        {alumno.tipoClase === "alma"
                          ? "ALMA"
                          : alumno.tipoClase === "escalera"
                          ? "La Escalera"
                          : alumno.tipoClase === "dj"
                          ? "DJ"
                          : "Sokolov"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    {nextCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-blue-300">
                        <Calendar className="w-3 h-3 text-blue-400" />
                        {nextCount} {nextCount === 1 ? "próxima clase" : "próximas clases"}
                      </span>
                    ) : (
                      <span className="text-slate-500">Sin clases próximas</span>
                    )}
                    {alumno.telefono && (
                      <span className="hidden sm:inline text-slate-500">• {alumno.telefono}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="text-xs text-slate-400 group-hover:text-slate-200 hidden sm:inline">
                    Ver ficha
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-slate-300 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New / Edit Alumno Modal */}
      <AlumnoModal
        isOpen={isNewAlumnoModalOpen || !!alumnoToEdit}
        onClose={() => {
          setIsNewAlumnoModalOpen(false);
          setAlumnoToEdit(null);
        }}
        alumnoToEdit={alumnoToEdit}
      />

      {/* Alumno Ficha Modal */}
      <AlumnoFichaModal
        isOpen={!!selectedAlumnoForFicha}
        onClose={() => setSelectedAlumnoForFicha(null)}
        alumno={selectedAlumnoForFicha}
        onEditAlumno={(alumno) => setAlumnoToEdit(alumno)}
        onNewClaseForAlumno={(alumnoId) => onNewClaseForAlumno(alumnoId)}
        onOpenClaseDetail={(clase) => onOpenClaseDetail(clase)}
      />
    </div>
  );
};
