import React, { useState } from "react";
import { CloudUpload, ShieldCheck, Loader2, CheckCircle2 } from "lucide-react";

interface MigrationModalProps {
  isOpen: boolean;
  onMigrate: () => Promise<void>;
  onSkipAndSeedDefault: () => Promise<void>;
  localSummary: {
    alumnosCount: number;
    clasesCount: number;
    tocatasCount: number;
  };
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  isOpen,
  onMigrate,
  onSkipAndSeedDefault,
  localSummary,
}) => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  if (!isOpen) return null;

  const totalActividades = localSummary.clasesCount + localSummary.tocatasCount;

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      await onMigrate();
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSkip = async () => {
    setIsSeeding(true);
    try {
      await onSkipAndSeedDefault();
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="p-2.5 rounded-xl bg-sky-950 border border-sky-800 text-sky-400">
            <CloudUpload className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">
              Migración a Cloud Firestore
            </h3>
            <p className="text-xs text-slate-400">
              Sincroniza tus datos locales con tu cuenta privada
            </p>
          </div>
        </div>

        {/* Info Content */}
        <div className="space-y-3 text-xs sm:text-sm text-slate-300">
          <div className="p-3.5 bg-slate-950 border border-slate-800/90 rounded-xl space-y-2">
            <p className="font-semibold text-slate-200">
              Datos locales encontrados en este navegador:
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 text-slate-300">
                <span className="text-slate-400 block text-[11px]">Alumnos</span>
                <span className="text-sm font-bold text-sky-400">
                  {localSummary.alumnosCount}
                </span>
              </div>
              <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 text-slate-300">
                <span className="text-slate-400 block text-[11px]">Actividades</span>
                <span className="text-sm font-bold text-emerald-400">
                  {totalActividades} ({localSummary.clasesCount} clases + {localSummary.tocatasCount} Fechas DJ)
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Se mantendrán todos los identificadores originales.</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Tu copia local en este navegador no será eliminada.</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={handleMigrate}
            disabled={isMigrating || isSeeding}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            {isMigrating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Migrando datos...</span>
              </>
            ) : (
              <>
                <CloudUpload className="w-4 h-4" />
                <span>Migrar mis datos a la Nube</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            disabled={isMigrating || isSeeding}
            className="px-4 py-2.5 bg-slate-950 hover:bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-800 font-medium text-xs rounded-xl transition-all disabled:opacity-50"
          >
            {isSeeding ? "Iniciando..." : "Cargar datos demo iniciales"}
          </button>
        </div>
      </div>
    </div>
  );
};
