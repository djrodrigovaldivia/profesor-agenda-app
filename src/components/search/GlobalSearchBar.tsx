import React, { useState, useRef, useEffect, useMemo } from "react";
import { useAgenda } from "../../context/AgendaContext";
import { Alumno, Clase, Tocata } from "../../types";
import {
  removeAccents,
  formatFechaCorta,
  formatFechaDiaYMes,
  formatTimeRange,
  getISODate,
  parseISODate,
} from "../../utils/dateUtils";
import {
  Search,
  X,
  User,
  GraduationCap,
  Calendar,
  Disc3,
  Clock,
  MapPin,
  Sparkles,
  ChevronRight,
  Filter,
} from "lucide-react";

interface GlobalSearchBarProps {
  onSelectAlumno: (alumno: Alumno) => void;
  onSelectClase: (clase: Clase) => void;
  onSelectTocata: (tocata: Tocata) => void;
}

type SearchCategory = "todos" | "alumnos" | "clases" | "tocatas";

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  onSelectAlumno,
  onSelectClase,
  onSelectTocata,
}) => {
  const { alumnos, clases, tocatas } = useAgenda();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<SearchCategory>("todos");

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Map of student IDs to objects
  const alumnoMap = useMemo(() => {
    const map = new Map<string, Alumno>();
    alumnos.forEach((a) => map.set(a.id, a));
    return map;
  }, [alumnos]);

  // Global keyboard shortcut Ctrl+K / Cmd+K to open & focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Helper to test if text contains all tokens in query
  const matchesQuery = (text: string, tokens: string[]) => {
    if (!tokens.length) return true;
    const normalizedText = removeAccents(text.toLowerCase());
    return tokens.every((token) => normalizedText.includes(token));
  };

  // Build searchable representations of dates
  const getDateSearchStrings = (isoDate: string): string => {
    try {
      const d = parseISODate(isoDate);
      const diaNum = d.getDate().toString();
      const mesNum = (d.getMonth() + 1).toString().padStart(2, "0");
      const short = formatFechaCorta(isoDate);
      const diaMes = formatFechaDiaYMes(isoDate);
      return `${isoDate} ${diaNum}/${mesNum} ${short} ${diaMes}`;
    } catch {
      return isoDate;
    }
  };

  // Perform search
  const { matchedAlumnos, matchedClases, matchedTocatas } = useMemo(() => {
    const rawTokens = query.trim().split(/\s+/).filter(Boolean);
    const tokens = rawTokens.map((t) => removeAccents(t.toLowerCase()));

    if (!tokens.length) {
      return { matchedAlumnos: [], matchedClases: [], matchedTocatas: [] };
    }

    // 1. Search Alumnos
    const matchedA = alumnos.filter((a) => {
      const searchTarget = `${a.nombre} ${a.descripcion || ""} ${
        a.email || ""
      } ${a.telefono || ""} ${a.activo ? "activo" : "inactivo"}`;
      return matchesQuery(searchTarget, tokens);
    });

    // 2. Search Clases
    const matchedC = clases.filter((c) => {
      const alumno = alumnoMap.get(c.alumnoId);
      const alumnoNombre = alumno ? alumno.nombre : "";
      const dateStrings = getDateSearchStrings(c.fecha);
      const tipoStr =
        c.tipo === "escalera"
          ? "escalera la escalera"
          : "alma academia alma";
      const searchTarget = `${alumnoNombre} ${c.tema || ""} ${
        c.fecha
      } ${dateStrings} ${tipoStr} ${c.horaInicio} ${c.horaFin} ${
        c.notas || ""
      } ${c.estado || ""}`;
      return matchesQuery(searchTarget, tokens);
    });

    // 3. Search Tocatas
    const matchedT = tocatas.filter((t) => {
      const dateStrings = getDateSearchStrings(t.fecha);
      const searchTarget = `${t.titulo} ${t.proyecto} ${t.lugar} ${
        t.ciudad || ""
      } ${t.fecha} ${dateStrings} ${t.horaInicio} ${t.horaFin || ""} ${
        t.estado || ""
      } ${t.notas || ""}`;
      return matchesQuery(searchTarget, tokens);
    });

    // Sort classes and tocatas chronologically desc (most recent first)
    matchedC.sort((a, b) => b.fecha.localeCompare(a.fecha));
    matchedT.sort((a, b) => b.fecha.localeCompare(a.fecha));

    return {
      matchedAlumnos: matchedA,
      matchedClases: matchedC,
      matchedTocatas: matchedT,
    };
  }, [query, alumnos, clases, tocatas, alumnoMap]);

  const totalResults =
    matchedAlumnos.length + matchedClases.length + matchedTocatas.length;

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const handleQuickSuggestion = (suggestion: string) => {
    setQuery(suggestion);
    inputRef.current?.focus();
    setIsOpen(true);
  };

  const hoyIso = getISODate(new Date());

  return (
    <div ref={containerRef} className="relative w-full z-40 mb-4 sm:mb-6">
      {/* Search Input Box */}
      <div className="relative flex items-center">
        <div className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center">
          <Search className="w-4 h-4 text-sky-400" />
        </div>

        <input
          ref={inputRef}
          type="text"
          id="input-global-search"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder="Buscar alumno, clase o tocata por nombre o fecha... (ej: Sokolov, Alma, sep)"
          className="w-full pl-10 pr-24 py-2.5 bg-slate-900/95 hover:bg-slate-900 focus:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-sky-500 rounded-xl text-sm text-slate-100 placeholder-slate-500 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-sky-500/20"
        />

        {/* Right side controls (Shortcut badge or clear button) */}
        <div className="absolute right-3 flex items-center gap-1.5">
          {query ? (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Limpiar búsqueda"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-800/80 border border-slate-700 rounded select-none">
              <span className="text-xs">⌘</span>K
            </kbd>
          )}
        </div>
      </div>

      {/* Search Dropdown / Results Modal */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/98 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-[75vh] flex flex-col z-50">
          {/* Quick Filter Header if has query or results */}
          {query.trim() ? (
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/90 bg-slate-950/60 text-xs text-slate-400">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Filter className="w-3 h-3 text-slate-500" />
                <button
                  type="button"
                  onClick={() => setCategory("todos")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    category === "todos"
                      ? "bg-sky-500 text-slate-950"
                      : "hover:text-slate-200"
                  }`}
                >
                  Todos ({totalResults})
                </button>
                <button
                  type="button"
                  onClick={() => setCategory("alumnos")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    category === "alumnos"
                      ? "bg-emerald-500 text-slate-950"
                      : "hover:text-slate-200"
                  }`}
                >
                  Alumnos ({matchedAlumnos.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCategory("clases")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    category === "clases"
                      ? "bg-sky-500 text-slate-950"
                      : "hover:text-slate-200"
                  }`}
                >
                  Clases ({matchedClases.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCategory("tocatas")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    category === "tocatas"
                      ? "bg-purple-500 text-slate-950"
                      : "hover:text-slate-200"
                  }`}
                >
                  Tocatas ({matchedTocatas.length})
                </button>
              </div>

              <span className="text-[11px] text-slate-500 hidden sm:inline">
                {totalResults} resultado{totalResults === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            /* Suggestions when query is empty */
            <div className="p-3.5 bg-slate-950/40 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Búsquedas rápidas sugeridas:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Hoy",
                  "Sokolov",
                  "Rodrigo Valdivia",
                  "Área 51",
                  "Alma",
                  "La Escalera",
                ].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => handleQuickSuggestion(sug)}
                    className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-sky-300 border border-slate-700/80 transition-colors cursor-pointer"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results Scroll Area */}
          <div className="overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-3">
            {totalResults === 0 && query.trim() ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                <p className="font-medium text-slate-300">
                  No se encontraron resultados para &ldquo;{query}&rdquo;
                </p>
                <p className="text-slate-500 mt-1">
                  Intenta buscar por nombre de alumno, proyecto DJ, tema o fecha (ej: 2026, sep, sábado).
                </p>
              </div>
            ) : null}

            {/* Section: Alumnos */}
            {(category === "todos" || category === "alumnos") &&
              matchedAlumnos.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase text-emerald-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span>Alumnos ({matchedAlumnos.length})</span>
                  </div>
                  {matchedAlumnos.map((alumno) => (
                    <button
                      key={alumno.id}
                      type="button"
                      onClick={() => {
                        onSelectAlumno(alumno);
                        setIsOpen(false);
                      }}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-800/80 flex items-center justify-center font-bold text-emerald-300 text-xs shrink-0">
                          {alumno.nombre.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-200 group-hover:text-emerald-300 transition-colors">
                            {alumno.nombre}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            {alumno.telefono ? (
                              <span>{alumno.telefono}</span>
                            ) : alumno.email ? (
                              <span>{alumno.email}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            alumno.activo
                              ? "bg-emerald-950/60 border-emerald-800/60 text-emerald-400"
                              : "bg-slate-900 border-slate-800 text-slate-400"
                          }`}
                        >
                          {alumno.activo ? "Activo" : "Inactivo"}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

            {/* Section: Clases Programadas */}
            {(category === "todos" || category === "clases") &&
              matchedClases.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase text-sky-400 flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5" />
                    <span>Clases Programadas ({matchedClases.length})</span>
                  </div>
                  {matchedClases.map((clase) => {
                    const alumno = alumnoMap.get(clase.alumnoId);
                    const alumnoNombre = alumno
                      ? alumno.nombre
                      : "Alumno registrado";
                    const isHoy = clase.fecha === hoyIso;

                    return (
                      <button
                        key={clase.id}
                        type="button"
                        onClick={() => {
                          onSelectClase(clase);
                          setIsOpen(false);
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center text-sky-300 shrink-0">
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">
                                {alumnoNombre}
                              </p>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                                  clase.tipo === "escalera"
                                    ? "bg-amber-950/60 border-amber-800/60 text-amber-300"
                                    : "bg-sky-950/60 border-sky-800/60 text-sky-300"
                                }`}
                              >
                                {clase.tipo === "escalera"
                                  ? "La Escalera"
                                  : "Academia ALMA"}
                              </span>
                              {isHoy && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-semibold">
                                  Hoy
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span>{formatFechaCorta(clase.fecha)}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {formatTimeRange(
                                  clase.horaInicio,
                                  clase.horaFin
                                )}
                              </span>
                              {clase.tema && <span>• {clase.tema}</span>}
                            </div>
                          </div>
                        </div>

                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

            {/* Section: Tocatas */}
            {(category === "todos" || category === "tocatas") &&
              matchedTocatas.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase text-purple-400 flex items-center gap-1.5">
                    <Disc3 className="w-3.5 h-3.5" />
                    <span>Tocatas DJ ({matchedTocatas.length})</span>
                  </div>
                  {matchedTocatas.map((tocata) => {
                    const isHoy = tocata.fecha === hoyIso;
                    return (
                      <button
                        key={tocata.id}
                        type="button"
                        onClick={() => {
                          onSelectTocata(tocata);
                          setIsOpen(false);
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-800/80 flex items-center justify-center text-purple-300 shrink-0">
                            <Disc3 className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-200 group-hover:text-purple-300 transition-colors">
                                {tocata.titulo}
                              </p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-950/60 border border-purple-800/60 text-purple-300">
                                {tocata.proyecto}
                              </span>
                              {isHoy && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-semibold">
                                  Hoy
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span>{formatFechaCorta(tocata.fecha)}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {formatTimeRange(
                                  tocata.horaInicio,
                                  tocata.horaFin || ""
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {tocata.lugar}
                                {tocata.ciudad ? `, ${tocata.ciudad}` : ""}
                              </span>
                            </div>
                          </div>
                        </div>

                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
          </div>

          {/* Footer with hint */}
          <div className="px-3 py-2 bg-slate-950/80 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Presiona ESC para cerrar</span>
            <span>Tip: puedes buscar por mes o día como &ldquo;septiembre&rdquo; o &ldquo;sábado&rdquo;</span>
          </div>
        </div>
      )}
    </div>
  );
};
