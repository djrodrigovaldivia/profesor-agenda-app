import React, { useState, useEffect } from "react";
import { useAgenda } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { WifiOff, Wifi, CloudOff, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export const OfflineStatusIndicator: React.FC = () => {
  const { syncStatus, sincronizarAhora } = useAgenda();
  const { currentUser } = useAuth();

  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() => {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  });

  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnectedBanner, setShowReconnectedBanner] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Track browser network events
  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
      setShowReconnectedBanner(true);
      const timer = setTimeout(() => {
        setShowReconnectedBanner(false);
        setWasOffline(false);
      }, 3500);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsBrowserOnline(false);
      setWasOffline(true);
      setShowReconnectedBanner(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // An app is considered offline if browser is offline or Firestore sync status is explicitly offline while authenticated
  const isOffline = !isBrowserOnline || (!!currentUser && syncStatus === "offline");

  const handleManualRetry = async () => {
    setIsRetrying(true);
    try {
      await sincronizarAhora();
    } catch {
      // Ignored, syncStatus will reflect state
    } finally {
      setTimeout(() => setIsRetrying(false), 600);
    }
  };

  return (
    <div id="offline-status-container" className="w-full mb-4">
      <AnimatePresence mode="wait">
        {isOffline ? (
          <motion.div
            key="offline-banner"
            id="offline-status-indicator"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-amber-950/40 border border-amber-600/40 text-amber-200 text-xs shadow-sm backdrop-blur-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
              </span>

              <div className="flex items-center gap-1.5 shrink-0 font-semibold text-amber-100">
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Sin conexión</span>
              </div>

              <span className="text-amber-300/90 text-xs">
                • Comprueba tu conexión antes de guardar cambios.
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                id="btn-reintentar-conexion"
                onClick={handleManualRetry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-900/40 hover:bg-amber-900/70 border border-amber-700/50 text-amber-200 text-[11px] font-medium transition-colors disabled:opacity-50 active:scale-95"
                title="Comprobar conexión"
              >
                <RefreshCw
                  className={`w-3 h-3 text-amber-300 ${
                    isRetrying ? "animate-spin" : ""
                  }`}
                />
                <span>Reintentar</span>
              </button>
            </div>
          </motion.div>
        ) : showReconnectedBanner && wasOffline ? (
          <motion.div
            key="reconnected-banner"
            id="reconnected-status-indicator"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-600/40 text-emerald-200 text-xs shadow-sm backdrop-blur-sm"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-emerald-100">
              Conexión restablecida
            </span>
            <span className="text-emerald-300/90 text-[11px]">
              • Ya puedes guardar cambios normalmente.
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
