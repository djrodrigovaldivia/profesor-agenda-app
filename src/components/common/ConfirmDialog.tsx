import React, { useEffect } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  isDestructive = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="confirm-dialog-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        id="confirm-dialog-card"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl text-slate-50 space-y-5"
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`p-3 rounded-xl shrink-0 ${
              isDestructive
                ? "bg-rose-950/80 text-rose-400 border border-rose-800/80 shadow-inner"
                : "bg-amber-950/80 text-amber-400 border border-amber-800/80 shadow-inner"
            }`}
          >
            {isDestructive ? (
              <Trash2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="space-y-1.5 min-w-0 flex-1">
            <h4
              id="confirm-dialog-title"
              className="text-base sm:text-lg font-bold text-slate-50 tracking-tight"
            >
              {title}
            </h4>
            <p
              id="confirm-dialog-desc"
              className="text-sm text-slate-300 leading-relaxed"
            >
              {message}
            </p>
          </div>
        </div>

        {/* Action buttons with 44px+ touch targets on mobile and clearance from floating badges */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-start gap-2.5 pt-3 pb-8 sm:pb-0 border-t border-slate-800/90">
          <button
            type="button"
            id="confirm-action-btn"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-sm active:scale-[0.98] flex items-center justify-center cursor-pointer ${
              isDestructive
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/40"
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950/40"
            }`}
          >
            {confirmText}
          </button>
          <button
            type="button"
            id="confirm-cancel-btn"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700/90 active:scale-[0.98] border border-slate-700/60 rounded-xl transition-all flex items-center justify-center cursor-pointer"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
};
