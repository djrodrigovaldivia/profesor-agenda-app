import React from "react";
import { useAgenda } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { FirestoreSyncStatus } from "../../types";

interface SyncStatusDotProps {
  variant?: "compact" | "detailed";
  className?: string;
  showTextOnMobile?: boolean;
}

export function getSyncStatusConfig(
  status: FirestoreSyncStatus,
  currentUser: unknown,
  isDeviceOffline: boolean = typeof navigator !== "undefined" && !navigator.onLine
) {
  if (!currentUser) {
    if (isDeviceOffline) {
      return {
        dotBg: "bg-amber-400",
        pingBg: "bg-amber-400",
        glowShadow: "shadow-[0_0_8px_rgba(251,191,36,0.5)]",
        border: "border-amber-500/30",
        badgeBg: "bg-amber-950/40 text-amber-300",
        text: "Sin red",
        subtext: "Modo local (sin internet)",
        title: "Dispositivo sin conexión a internet. Datos guardados localmente.",
      };
    }
    return {
      dotBg: "bg-emerald-400",
      pingBg: "bg-emerald-400",
      glowShadow: "shadow-[0_0_8px_rgba(52,211,153,0.6)]",
      border: "border-emerald-500/30",
      badgeBg: "bg-emerald-950/40 text-emerald-300",
      text: "Local",
      subtext: "Datos guardados en este dispositivo",
      title: "Datos guardados en este dispositivo",
    };
  }

  const isOffline = isDeviceOffline || status === "offline";

  if (isOffline) {
    return {
      dotBg: "bg-rose-500",
      pingBg: "bg-rose-500",
      glowShadow: "shadow-[0_0_8px_rgba(244,63,94,0.5)]",
      border: "border-rose-500/30",
      badgeBg: "bg-rose-950/40 text-rose-300",
      text: "Offline",
      subtext: "Sin conexión • Comprueba tu conexión antes de guardar",
      title: "Sin conexión a internet (modo offline)",
    };
  }

  switch (status) {
    case "connected":
      return {
        dotBg: "bg-emerald-400",
        pingBg: "bg-emerald-400",
        glowShadow: "shadow-[0_0_8px_rgba(52,211,153,0.6)]",
        border: "border-emerald-500/30",
        badgeBg: "bg-emerald-950/40 text-emerald-300",
        text: "En línea",
        subtext: "Cloud Firestore conectado",
        title: "Conectado a Cloud Firestore (red activa)",
      };
    case "syncing":
      return {
        dotBg: "bg-amber-400",
        pingBg: "bg-amber-400",
        glowShadow: "shadow-[0_0_8px_rgba(251,191,36,0.6)]",
        border: "border-amber-500/30",
        badgeBg: "bg-amber-950/40 text-amber-300",
        text: "Sincronizando",
        subtext: "Conectando con Firestore...",
        title: "Sincronizando datos con Cloud Firestore",
      };
    default:
      return {
        dotBg: "bg-rose-500",
        pingBg: "bg-rose-500",
        glowShadow: "shadow-[0_0_8px_rgba(244,63,94,0.5)]",
        border: "border-rose-500/30",
        badgeBg: "bg-rose-950/40 text-rose-300",
        text: "Offline",
        subtext: "Modo sin conexión",
        title: "Sin conexión a internet (modo offline)",
      };
  }
}

export const SyncStatusDot: React.FC<SyncStatusDotProps> = ({
  variant = "compact",
  className = "",
  showTextOnMobile = false,
}) => {
  const { syncStatus } = useAgenda();
  const { currentUser } = useAuth();

  const isDeviceOffline =
    typeof navigator !== "undefined" && !navigator.onLine;

  const config = getSyncStatusConfig(syncStatus, currentUser, isDeviceOffline);

  if (variant === "detailed") {
    return (
      <div
        id="sync-status-detailed"
        title={config.title}
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border ${config.border} ${config.badgeBg} text-xs font-medium transition-all ${className}`}
      >
        <span className="relative flex h-2 w-2">
          {syncStatus === "connected" && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pingBg} opacity-75`}
            />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${config.dotBg} ${config.glowShadow}`}
          />
        </span>
        <span className="text-[11px] font-medium tracking-tight">
          {config.subtext}
        </span>
      </div>
    );
  }

  return (
    <div
      id="sync-status-indicator"
      title={config.title}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/90 hover:bg-slate-850 border border-slate-800 transition-colors select-none ${className}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {syncStatus === "connected" && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pingBg} opacity-75`}
          />
        )}
        {syncStatus === "syncing" && (
          <span
            className={`animate-pulse absolute inline-flex h-full w-full rounded-full ${config.pingBg} opacity-75`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${config.dotBg} ${config.glowShadow}`}
        />
      </span>
      <span
        className={`text-[11px] font-medium text-slate-300 tracking-tight ${
          showTextOnMobile ? "inline" : "hidden sm:inline"
        }`}
      >
        {config.text}
      </span>
    </div>
  );
};
