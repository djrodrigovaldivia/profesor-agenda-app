import React from "react";
import { Clock, AlertCircle } from "lucide-react";

export interface SaveTimeoutWarningProps {
  id?: string;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Aviso visual de seguridad cuando una operación de guardado supera los 20 segundos.
 * Informa con prudencia sin dar por hecho que la escritura falló,
 * no ejecuta un segundo guardado automático y permite que el usuario
 * decida conscientemente cerrar o reintentar.
 */
export const SaveTimeoutWarning: React.FC<SaveTimeoutWarningProps> = ({
  id = "save-timeout-warning",
  onDismiss,
  className = "",
}) => {
  return (
    <div
      role="alert"
      id={id}
      className={`p-3.5 rounded-xl bg-amber-950/80 border border-amber-700/70 text-amber-200 text-xs leading-relaxed space-y-2 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-100 text-sm">
            La operación está tardando más de lo habitual
          </p>
          <p className="text-amber-200/90 mt-1">
            El servidor o la red están respondiendo lentamente. La información podría haberse
            guardado ya en la nube o aún estar en proceso.
          </p>
        </div>
      </div>
      <div className="p-2.5 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-100/90 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 text-[11px] leading-normal space-y-1">
          <p>
            • Puedes cerrar el modal o esperar unos instantes a que responda el servidor.
          </p>
          <p>
            • La operación sigue en curso de forma protegida para evitar registros duplicados.
          </p>
        </div>
      </div>
      {onDismiss && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-amber-300 hover:text-amber-100 underline underline-offset-2 cursor-pointer"
          >
            Entendido, descartar aviso
          </button>
        </div>
      )}
    </div>
  );
};
