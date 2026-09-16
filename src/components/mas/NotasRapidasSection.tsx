import React, { useState, useMemo } from "react";
import { useAgenda } from "../../context/AgendaContext";
import { NotaRapida, CategoriaNotaRapida } from "../../types";
import {
  StickyNote,
  Plus,
  Pin,
  Trash2,
  Edit2,
  Check,
  X,
  Disc3,
  GraduationCap,
  Lightbulb,
  Copy,
  CheckCheck,
  Search,
} from "lucide-react";

const CATEGORIAS_CONFIG: Record<
  CategoriaNotaRapida,
  { label: string; icon: React.ComponentType<{ className?: string }>; colorClass: string }
> = {
  setlist: {
    label: "Setlist DJ",
    icon: Disc3,
    colorClass: "bg-purple-950/60 text-purple-300 border-purple-800/60",
  },
  pedagogica: {
    label: "Pedagógico",
    icon: GraduationCap,
    colorClass: "bg-sky-950/60 text-sky-300 border-sky-800/60",
  },
  idea: {
    label: "Ideas",
    icon: Lightbulb,
    colorClass: "bg-amber-950/60 text-amber-300 border-amber-800/60",
  },
  general: {
    label: "General",
    icon: StickyNote,
    colorClass: "bg-slate-800/80 text-slate-300 border-slate-700",
  },
};

const COLOR_OPTIONS = [
  { id: "purple", bg: "bg-purple-950/30 border-purple-800/60 hover:border-purple-600" },
  { id: "sky", bg: "bg-sky-950/30 border-sky-800/60 hover:border-sky-600" },
  { id: "amber", bg: "bg-amber-950/30 border-amber-800/60 hover:border-amber-600" },
  { id: "emerald", bg: "bg-emerald-950/30 border-emerald-800/60 hover:border-emerald-600" },
  { id: "rose", bg: "bg-rose-950/30 border-rose-800/60 hover:border-rose-600" },
  { id: "slate", bg: "bg-slate-900 border-slate-800 hover:border-slate-700" },
];

export const NotasRapidasSection: React.FC = () => {
  const { notasRapidas, addNotaRapida, updateNotaRapida, deleteNotaRapida } =
    useAgenda();

  const [filterCategory, setFilterCategory] = useState<
    CategoriaNotaRapida | "todas"
  >("todas");
  const [filterSearch, setFilterSearch] = useState("");

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form state
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [categoria, setCategoria] = useState<CategoriaNotaRapida>("setlist");
  const [selectedColor, setSelectedColor] = useState("purple");
  const [fijada, setFijada] = useState(false);

  // Edit form state
  const [editTitulo, setEditTitulo] = useState("");
  const [editContenido, setEditContenido] = useState("");
  const [editCategoria, setEditCategoria] = useState<CategoriaNotaRapida>("setlist");
  const [editColor, setEditColor] = useState("purple");
  const [editFijada, setEditFijada] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredNotas = useMemo(() => {
    return (notasRapidas || []).filter((nota) => {
      if (filterCategory !== "todas" && nota.categoria !== filterCategory) {
        return false;
      }
      if (filterSearch.trim()) {
        const q = filterSearch.toLowerCase();
        const matchTitle = nota.titulo.toLowerCase().includes(q);
        const matchContent = nota.contenido.toLowerCase().includes(q);
        if (!matchTitle && !matchContent) return false;
      }
      return true;
    });
  }, [notasRapidas, filterCategory, filterSearch]);

  const handleStartCreate = (defaultCat?: CategoriaNotaRapida) => {
    setIsCreating(true);
    setEditingId(null);
    setTitulo("");
    setContenido("");
    setCategoria(defaultCat || (filterCategory !== "todas" ? filterCategory : "setlist"));
    setSelectedColor(
      defaultCat === "setlist"
        ? "purple"
        : defaultCat === "pedagogica"
        ? "sky"
        : defaultCat === "idea"
        ? "amber"
        : "purple"
    );
    setFijada(false);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setTitulo("");
    setContenido("");
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() && !contenido.trim()) return;

    await addNotaRapida({
      titulo: titulo.trim() || "Sin título",
      contenido: contenido.trim(),
      categoria,
      color: selectedColor,
      fijada,
    });

    setIsCreating(false);
    setTitulo("");
    setContenido("");
  };

  const handleStartEdit = (nota: NotaRapida) => {
    setEditingId(nota.id);
    setIsCreating(false);
    setEditTitulo(nota.titulo);
    setEditContenido(nota.contenido);
    setEditCategoria(nota.categoria);
    setEditColor(nota.color || "slate");
    setEditFijada(!!nota.fijada);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editTitulo.trim() && !editContenido.trim()) return;

    await updateNotaRapida(id, {
      titulo: editTitulo.trim() || "Sin título",
      contenido: editContenido.trim(),
      categoria: editCategoria,
      color: editColor,
      fijada: editFijada,
    });

    setEditingId(null);
  };

  const handleTogglePin = async (nota: NotaRapida) => {
    await updateNotaRapida(nota.id, {
      fijada: !nota.fijada,
    });
  };

  const handleCopy = (nota: NotaRapida) => {
    const textToCopy = `${nota.titulo}\n\n${nota.contenido}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(nota.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const countForCategory = (cat: CategoriaNotaRapida | "todas") => {
    if (cat === "todas") return (notasRapidas || []).length;
    return (notasRapidas || []).filter((n) => n.categoria === cat).length;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-950/70 border border-amber-800/70 text-amber-400">
            <StickyNote className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-100">
                Notas Rápidas
              </h3>
              <span className="px-2 py-0.5 text-xs font-semibold text-amber-400 bg-amber-950/50 border border-amber-800/50 rounded-full">
                {(notasRapidas || []).length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Ideas para setlists de DJ, recordatorios pedagógicos y apuntes libres
            </p>
          </div>
        </div>

        {!isCreating && (
          <button
            type="button"
            id="btn-nueva-nota-rapida"
            onClick={() => handleStartCreate()}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium text-xs rounded-xl shadow transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva nota</span>
          </button>
        )}
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Category filter pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            id="tab-categoria-todas"
            onClick={() => setFilterCategory("todas")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
              filterCategory === "todas"
                ? "bg-amber-500 text-slate-950"
                : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
            }`}
          >
            Todas ({countForCategory("todas")})
          </button>

          {(["setlist", "pedagogica", "idea", "general"] as CategoriaNotaRapida[]).map(
            (cat) => {
              const conf = CATEGORIAS_CONFIG[cat];
              const Icon = conf.icon;
              const active = filterCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  id={`tab-categoria-${cat}`}
                  onClick={() => setFilterCategory(cat)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-amber-500 text-slate-950 font-semibold"
                      : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{conf.label}</span>
                  <span className="text-[10px] opacity-75">
                    ({countForCategory(cat)})
                  </span>
                </button>
              );
            }
          )}
        </div>

        {/* Quick Search */}
        <div className="relative w-full sm:w-48">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            id="input-buscar-notas-rapidas"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Buscar nota..."
            className="w-full pl-8 pr-2.5 py-1 bg-slate-950/80 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
          />
        </div>
      </div>

      {/* Inline Create Form */}
      {isCreating && (
        <form
          onSubmit={handleSaveNew}
          className="p-4 rounded-xl bg-slate-950/90 border border-amber-500/40 space-y-3 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between pb-1 border-b border-slate-800">
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Nueva Nota Rápida
            </span>
            <button
              type="button"
              onClick={handleCancelCreate}
              className="text-slate-500 hover:text-slate-300 p-1 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              id="input-nota-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Título (ej: Setlist Club Subterráneo, Técnica de slap bass...)"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              autoFocus
            />

            <textarea
              id="input-nota-contenido"
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              rows={4}
              placeholder="Escribe aquí las ideas de tracks, mezclas BPM, notas de armonía o recordatorios..."
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 leading-relaxed font-mono resize-y"
            />
          </div>

          {/* Form Options */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* Category selection */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Tipo:</span>
              <div className="flex items-center gap-1">
                {(["setlist", "pedagogica", "idea", "general"] as CategoriaNotaRapida[]).map(
                  (cat) => {
                    const conf = CATEGORIAS_CONFIG[cat];
                    const isSelected = categoria === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setCategoria(cat);
                          if (cat === "setlist") setSelectedColor("purple");
                          else if (cat === "pedagogica") setSelectedColor("sky");
                          else if (cat === "idea") setSelectedColor("amber");
                        }}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
                          isSelected
                            ? conf.colorClass + " font-semibold ring-1 ring-amber-400/40"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {conf.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Pin toggle */}
            <button
              type="button"
              onClick={() => setFijada(!fijada)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                fijada
                  ? "bg-amber-950/60 border-amber-800/70 text-amber-300 font-medium"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300"
              }`}
            >
              <Pin className={`w-3.5 h-3.5 ${fijada ? "fill-amber-400" : ""}`} />
              <span>{fijada ? "Fijada al inicio" : "Fijar nota"}</span>
            </button>
          </div>

          {/* Actions: Alineados a la izquierda para evitar colisión con sellos flotantes */}
          <div className="flex items-center justify-start gap-2 pt-2 border-t border-slate-800/70">
            <button
              type="submit"
              id="btn-guardar-nota-rapida"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer active:scale-[0.98]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Guardar nota</span>
            </button>
            <button
              type="button"
              onClick={handleCancelCreate}
              className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Grid of Notes */}
      {filteredNotas.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredNotas.map((nota) => {
            const isEditingThis = editingId === nota.id;
            const catConf =
              CATEGORIAS_CONFIG[nota.categoria] || CATEGORIAS_CONFIG.general;
            const CatIcon = catConf.icon;
            const colorOption =
              COLOR_OPTIONS.find((c) => c.id === nota.color) || COLOR_OPTIONS[5];

            if (isEditingThis) {
              return (
                <div
                  key={nota.id}
                  className="sm:col-span-2 p-3.5 rounded-xl bg-slate-950 border border-sky-500/50 space-y-3"
                >
                  <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                    <span className="text-xs font-semibold text-sky-400">
                      Editando Nota
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="text-slate-500 hover:text-slate-300 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={editTitulo}
                    onChange={(e) => setEditTitulo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-medium"
                    placeholder="Título"
                  />

                  <textarea
                    value={editContenido}
                    onChange={(e) => setEditContenido(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono resize-y"
                    placeholder="Contenido"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      {(["setlist", "pedagogico", "idea", "general"] as CategoriaNotaRapida[]).map(
                        (cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setEditCategoria(cat)}
                            className={`px-2 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
                              editCategoria === cat
                                ? "bg-amber-500 text-slate-950 font-semibold"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {CATEGORIAS_CONFIG[cat].label}
                          </button>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setEditFijada(!editFijada)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border cursor-pointer ${
                        editFijada
                          ? "bg-amber-950/60 border-amber-800/70 text-amber-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Pin className={`w-3 h-3 ${editFijada ? "fill-amber-400" : ""}`} />
                      <span>{editFijada ? "Fijada" : "No fijada"}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-start gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(nota.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer active:scale-[0.98]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar cambios</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={nota.id}
                className={`flex flex-col justify-between p-3.5 rounded-xl border transition-all ${
                  nota.fijada
                    ? "bg-slate-950/90 border-amber-500/50 shadow-sm"
                    : colorOption.bg
                }`}
              >
                {/* Note Top Bar */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${catConf.colorClass}`}
                      >
                        <CatIcon className="w-3 h-3" />
                        <span>{catConf.label}</span>
                      </span>

                      {nota.fijada && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Pin className="w-2.5 h-2.5 fill-amber-300" />
                          <span>Fijada</span>
                        </span>
                      )}
                    </div>

                    {/* Actions Menu */}
                    <div className="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleTogglePin(nota)}
                        title={nota.fijada ? "Desfijar" : "Fijar al inicio"}
                        className="p-1 text-slate-400 hover:text-amber-400 rounded transition-colors cursor-pointer"
                      >
                        <Pin
                          className={`w-3.5 h-3.5 ${
                            nota.fijada ? "fill-amber-400 text-amber-400" : ""
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopy(nota)}
                        title="Copiar contenido"
                        className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
                      >
                        {copiedId === nota.id ? (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartEdit(nota)}
                        title="Editar nota"
                        className="p-1 text-slate-400 hover:text-sky-300 rounded transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteNotaRapida(nota.id)}
                        title="Eliminar nota"
                        className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="text-sm font-semibold text-slate-100 mt-2 tracking-tight">
                    {nota.titulo}
                  </h4>

                  {/* Content with whitespace-pre-wrap for nice tracklists/chords */}
                  {nota.contenido && (
                    <p className="text-xs text-slate-300 mt-1.5 whitespace-pre-wrap leading-relaxed font-mono max-h-48 overflow-y-auto pr-1">
                      {nota.contenido}
                    </p>
                  )}
                </div>

                {/* Footer date */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2.5 mt-2 border-t border-slate-800/60">
                  <span>
                    Actualizada {new Date(nota.updatedAt).toLocaleDateString("es-ES")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-6 text-center rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2">
          <StickyNote className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-xs text-slate-400 font-medium">
            {filterSearch || filterCategory !== "todas"
              ? "No se encontraron notas con estos filtros."
              : "Aún no tienes notas rápidas guardadas."}
          </p>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            Anota setlists con BPMs para tus tocatas DJ, ideas de repertorio o conceptos pedagógicos que no dependen de un alumno en específico.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleStartCreate("setlist")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-purple-950/60 border border-purple-800/70 text-purple-300 rounded-lg hover:bg-purple-900/60 cursor-pointer"
            >
              <Disc3 className="w-3 h-3" />
              <span>Nuevo Setlist DJ</span>
            </button>
            <button
              type="button"
              onClick={() => handleStartCreate("pedagogica")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-sky-950/60 border border-sky-800/70 text-sky-300 rounded-lg hover:bg-sky-900/60 cursor-pointer"
            >
              <GraduationCap className="w-3 h-3" />
              <span>Nota Pedagógica</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
