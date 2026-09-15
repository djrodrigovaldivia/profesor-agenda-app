import React from "react";
import { AlertCircle } from "lucide-react";
import { parseErrorInfo, FormattedErrorInfo } from "../../context/AgendaContext";

export interface DetailedErrorBannerProps {
  id?: string;
  error?: unknown | string | null;
  title?: string;
  details?: string;
  suggestion?: string;
  field?: string;
  className?: string;
}

export function extractErrorInfo(
  error?: unknown | string | null,
  overrideTitle?: string,
  overrideDetails?: string,
  overrideSuggestion?: string,
  overrideField?: string
): FormattedErrorInfo {
  if (overrideTitle || overrideDetails || overrideSuggestion) {
    return {
      title: overrideTitle || (typeof error === "string" ? error : "Error en la operación"),
      details: overrideDetails,
      suggestion: overrideSuggestion,
      field: overrideField,
    };
  }

  if (!error) {
    return {
      title: "Ha ocurrido un error inesperado",
      suggestion: "Intenta nuevamente o recarga la página.",
    };
  }

  if (typeof error === "string") {
    // Check if it was formatted by agendaCrudErrorMessage (multi-line)
    if (error.includes("\n")) {
      const parts = error.split("\n");
      let title = parts[0] || "Error en la operación";
      let details: string | undefined;
      let suggestion: string | undefined;

      for (let i = 1; i < parts.length; i++) {
        const line = parts[i];
        if (line.startsWith("Detalle: ")) {
          details = line.replace("Detalle: ", "").trim();
        } else if (line.startsWith("Cómo solucionarlo: ")) {
          suggestion = line.replace("Cómo solucionarlo: ", "").trim();
        } else if (!details) {
          details = line.trim();
        } else {
          suggestion = (suggestion ? suggestion + " " : "") + line.trim();
        }
      }

      return { title, details, suggestion };
    }

    // Single-line string: pass to parseErrorInfo to resolve context-aware details and suggestions
    return parseErrorInfo(new Error(error));
  }

  return parseErrorInfo(error);
}

export const DetailedErrorBanner: React.FC<DetailedErrorBannerProps> = ({
  id,
  error,
  title: propTitle,
  details: propDetails,
  suggestion: propSuggestion,
  field: propField,
  className = "",
}) => {
  const info = extractErrorInfo(error, propTitle, propDetails, propSuggestion, propField);

  if (!info.title && !info.details && !info.suggestion) {
    return null;
  }

  return (
    <div
      role="alert"
      id={id}
      className={`p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs leading-relaxed space-y-2 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-rose-100 text-sm">
            {info.title}
          </p>
          {info.field && (
            <p className="text-[11px] text-rose-300/80 mt-0.5">
              Campo afectado: <span className="font-mono font-medium">{info.field}</span>
            </p>
          )}
        </div>
      </div>

      {info.details && (
        <div className="p-2.5 rounded-lg bg-rose-900/40 border border-rose-700/50 text-rose-200 text-xs">
          <p className="font-medium text-rose-300 mb-0.5">Detalles del error:</p>
          <p className="text-rose-100/90 whitespace-pre-wrap break-words">{info.details}</p>
        </div>
      )}

      {info.suggestion && (
        <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-700/50 text-amber-200 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-300 mb-0.5">Cómo solucionarlo:</p>
            <p className="text-amber-100/90 whitespace-pre-wrap break-words">{info.suggestion}</p>
          </div>
        </div>
      )}
    </div>
  );
};
