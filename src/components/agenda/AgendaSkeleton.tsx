import React from "react";

export const TopCardsSkeleton: React.FC = () => {
  return (
    <div
      id="agenda-top-cards-skeleton"
      className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
      role="status"
      aria-label="Cargando actividades destacadas"
    >
      {/* Próxima Clase Skeleton */}
      <div className="p-4 bg-slate-900/90 border border-slate-800/80 rounded-2xl animate-pulse">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80 mb-3">
          <div className="h-3 w-24 bg-blue-500/25 rounded-full" />
          <div className="h-4 w-16 bg-slate-800 rounded-full" />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="h-5 w-44 bg-slate-800 rounded-md" />
            <div className="h-3.5 w-14 bg-slate-800/60 rounded-md" />
          </div>
          <div className="h-3.5 w-3/4 bg-slate-800/50 rounded-md" />
          <div className="flex items-center gap-2 pt-1">
            <div className="h-3.5 w-24 bg-slate-800/40 rounded-md" />
          </div>
        </div>
      </div>

      {/* Próxima Fecha DJ Skeleton */}
      <div className="p-4 bg-slate-900/90 border border-slate-800/80 rounded-2xl animate-pulse">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80 mb-3">
          <div className="h-3 w-28 bg-amber-500/25 rounded-full" />
          <div className="h-4 w-16 bg-slate-800 rounded-full" />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="h-5 w-48 bg-slate-800 rounded-md" />
            <div className="h-3.5 w-14 bg-slate-800/60 rounded-md" />
          </div>
          <div className="h-3.5 w-2/3 bg-slate-800/50 rounded-md" />
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="h-3.5 w-24 bg-slate-800/40 rounded-md" />
            <div className="h-4 w-16 bg-slate-800/60 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

export const CommitmentCardSkeleton: React.FC = () => {
  return (
    <div
      className="p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-2xl animate-pulse"
      role="status"
      aria-label="Cargando actividad"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 rounded-full bg-slate-800" />
            <div className="h-3.5 w-20 rounded-md bg-slate-800/60" />
          </div>
          <div className="h-4.5 w-44 rounded-md bg-slate-800" />
          <div className="flex items-center gap-2.5 pt-0.5">
            <div className="h-3 w-28 rounded-md bg-slate-800/50" />
            <div className="h-3 w-20 rounded-md bg-slate-800/40" />
          </div>
        </div>
        <div className="h-5 w-16 rounded-full bg-slate-800/70 shrink-0" />
      </div>
    </div>
  );
};

export const AgendaListSkeleton: React.FC<{ count?: number }> = ({ count = 2 }) => {
  return (
    <div className="space-y-2.5" role="status" aria-label="Cargando lista de actividades">
      {Array.from({ length: count }).map((_, i) => (
        <CommitmentCardSkeleton key={i} />
      ))}
    </div>
  );
};
