import React from "react";
import { TipoClase, EstadoTocata } from "../../types";

export type BadgeCategory = "alma" | "escalera" | "dj" | "sokolov" | "tocata" | "cancelada";

interface BadgeProps {
  category?: BadgeCategory;
  tipoClase?: TipoClase;
  estadoTocata?: EstadoTocata;
  isCancelada?: boolean;
  nivel?: string;
  estadoAlumno?: boolean;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export const CategoryBadge: React.FC<{
  category: "alma" | "escalera" | "dj" | "sokolov" | "tocata";
  isCancelada?: boolean;
  size?: "sm" | "md";
}> = ({ category, isCancelada, size = "sm" }) => {
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";

  const getLabel = (cat: string) => {
    switch (cat) {
      case "alma":
        return "ALMA";
      case "escalera":
        return "La Escalera";
      case "dj":
      case "tocata":
      case "sokolov":
      default:
        return "Fecha DJ";
    }
  };

  if (isCancelada) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`inline-flex items-center font-medium rounded-md bg-slate-900 text-slate-400 border border-slate-800 opacity-80 ${sizeClasses}`}
        >
          {getLabel(category)}
        </span>
        <span
          className={`inline-flex items-center font-semibold rounded-md bg-rose-950/70 text-rose-300 border border-rose-800/80 ${sizeClasses}`}
        >
          Cancelada
        </span>
      </div>
    );
  }

  // ALMA: #9fc6e7
  if (category === "alma") {
    return (
      <span
        style={{
          backgroundColor: "rgba(159, 198, 231, 0.14)",
          color: "#9fc6e7",
          borderColor: "rgba(159, 198, 231, 0.4)",
        }}
        className={`inline-flex items-center gap-1.5 font-medium rounded-md border ${sizeClasses}`}
      >
        <span
          style={{ backgroundColor: "#9fc6e7" }}
          className="w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(159,198,231,0.6)]"
        />
        ALMA
      </span>
    );
  }

  // MENTORÍAS LA ESCALERA: #a7dc9e
  if (category === "escalera") {
    return (
      <span
        style={{
          backgroundColor: "rgba(167, 220, 158, 0.14)",
          color: "#a7dc9e",
          borderColor: "rgba(167, 220, 158, 0.4)",
        }}
        className={`inline-flex items-center gap-1.5 font-medium rounded-md border ${sizeClasses}`}
      >
        <span
          style={{ backgroundColor: "#a7dc9e" }}
          className="w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(167,220,158,0.6)]"
        />
        La Escalera
      </span>
    );
  }

  // FECHAS DJ: #f8995d
  return (
    <span
      style={{
        backgroundColor: "rgba(248, 153, 93, 0.14)",
        color: "#f8995d",
        borderColor: "rgba(248, 153, 93, 0.4)",
      }}
      className={`inline-flex items-center gap-1.5 font-medium rounded-md border ${sizeClasses}`}
    >
      <span
        style={{ backgroundColor: "#f8995d" }}
        className="w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(248,153,93,0.6)]"
      />
      Fecha DJ
    </span>
  );
};

export const EstadoBadge: React.FC<{
  estado: "programada" | "realizada" | "cancelada" | "pendiente" | "confirmada";
  size?: "sm" | "md";
}> = ({ estado, size = "sm" }) => {
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";

  switch (estado) {
    case "confirmada":
      return (
        <span className={`inline-flex items-center font-medium rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 ${sizeClasses}`}>
          Confirmada
        </span>
      );
    case "pendiente":
      return (
        <span className={`inline-flex items-center font-medium rounded-md bg-amber-950/60 text-amber-300 border border-amber-800/60 ${sizeClasses}`}>
          Pendiente
        </span>
      );
    case "programada":
      return (
        <span className={`inline-flex items-center font-medium rounded-md bg-blue-950/60 text-blue-300 border border-blue-800/60 ${sizeClasses}`}>
          Programada
        </span>
      );
    case "realizada":
      return (
        <span className={`inline-flex items-center font-medium rounded-md bg-slate-800 text-slate-300 border border-slate-700 ${sizeClasses}`}>
          Realizada
        </span>
      );
    case "cancelada":
      return (
        <span className={`inline-flex items-center font-medium rounded-md bg-rose-950/60 text-rose-300 border border-rose-800/60 ${sizeClasses}`}>
          Cancelada
        </span>
      );
    default:
      return null;
  }
};

export const NivelBadge: React.FC<{
  nivel?: string;
  size?: "sm" | "md";
}> = () => {
  return null;
};

export const EstadoAlumnoBadge: React.FC<{
  activo: boolean;
  size?: "sm" | "md";
}> = ({ activo, size = "sm" }) => {
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";

  if (activo) {
    return (
      <span className={`inline-flex items-center gap-1 font-medium rounded-md bg-emerald-950/50 text-emerald-300 border border-emerald-800/50 ${sizeClasses}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Activo
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded-md bg-slate-900 text-slate-400 border border-slate-800 ${sizeClasses}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      Inactivo
    </span>
  );
};
