import React, { useState, useRef } from "react";
import { useAgenda } from "../../context/AgendaContext";
import { useAuth } from "../../context/AuthContext";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { RespaldoProfesorAgenda } from "../../types";
import { validateRespaldo } from "../../utils/backupValidation";
import { GoogleDriveExportCard } from "./GoogleDriveExportCard";
import { GoogleCalendarSyncCard } from "./GoogleCalendarSyncCard";
import { PushNotificationSettings } from "./PushNotificationSettings";
import { NotasRapidasSection } from "./NotasRapidasSection";
import {
  Bell,
  Download,
  Upload,
  Trash2,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileJson,
  Info,
  LogOut,
  UserCheck,
  Cloud,
  CloudDownload,
  Loader2,
  HardDrive,
} from "lucide-react";

export const MasView: React.FC = () => {
  const {
    preferencias,
    updatePreferencias,
    exportarRespaldo,
    exportarRespaldoFirestore,
    importarRespaldo,
    borrarTodosLosDatos,
    restaurarDatosDemostracion,
    alumnos,
    clases,
    tocatas,
    notas,
    syncStatus,
    lastSyncTime,
    sincronizarAhora,
  } = useAgenda();

  const { currentUser, logout, signIn } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await signIn();
    } catch (err: unknown) {
      console.warn("Sign in cancelled or failed:", err);
      if (err instanceof Error && !err.message.includes("popup-closed-by-user")) {
        setLoginError(err.message || "No se pudo iniciar sesión con Google.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImportData, setPendingImportData] =
    useState<RespaldoProfesorAgenda | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showRestoreDemoConfirm, setShowRestoreDemoConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [exportingFirestore, setExportingFirestore] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [importStatusMessage, setImportStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    setImportStatusMessage(null);
    try {
      await sincronizarAhora();
      setImportStatusMessage({
        type: "success",
        text: "Sincronización con Cloud Firestore completada con éxito.",
      });
    } catch {
      setImportStatusMessage({
        type: "error",
        text: "Error al sincronizar con Cloud Firestore. Revisa tu conexión a internet.",
      });
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Export JSON directly from Cloud Firestore
  const handleExportFirestore = async () => {
    try {
      setExportingFirestore(true);
      setImportStatusMessage(null);
      const backup = await exportarRespaldoFirestore();
      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(backup, null, 2));
      const downloadAnchor = document.createElement("a");
      const dateIso = new Date().toISOString().slice(0, 10);
      const filename = `profesor-agenda-firestore-backup-${dateIso}.json`;
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setImportStatusMessage({
        type: "success",
        text: `Respaldo de Cloud Firestore exportado exitosamente (${backup.alumnos.length} alumnos, ${backup.clases.length} clases, ${backup.tocatas.length} tocatas).`,
      });
    } catch (error: unknown) {
      console.error("Error al exportar desde Firestore:", error);
      setImportStatusMessage({
        type: "error",
        text: "Error al consultar y exportar el respaldo desde Cloud Firestore.",
      });
    } finally {
      setExportingFirestore(false);
    }
  };

  // Export JSON (in-memory / local)
  const handleExport = () => {
    const backup = exportarRespaldo();
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(backup, null, 2));
    const downloadAnchor = document.createElement("a");
    const filename = `profesor-agenda-respaldo-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setImportStatusMessage({
      type: "success",
      text: "Respaldo local exportado exitosamente.",
    });
  };

  // Handle file select for import
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const validation = validateRespaldo(parsed);
        if (validation.valid && validation.data) {
          setPendingImportData(validation.data);
          setShowImportConfirm(true);
          setImportStatusMessage(null);
        } else {
          setImportStatusMessage({
            type: "error",
            text:
              validation.error ||
              "El archivo seleccionado no tiene el formato de respaldo válido de Profesor Agenda.",
          });
        }
      } catch {
        setImportStatusMessage({
          type: "error",
          text: "Error al leer el archivo JSON. Verifica que sea un archivo válido.",
        });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (pendingImportData) {
      const success = await importarRespaldo(pendingImportData);
      if (success) {
        setImportStatusMessage({
          type: "success",
          text: "Respaldo importado correctamente.",
        });
      } else {
        setImportStatusMessage({
          type: "error",
          text: "No se pudo importar el archivo. Revisa su estructura.",
        });
      }
      setPendingImportData(null);
      setShowImportConfirm(false);
    }
  };

  const handleConfirmWipe = async () => {
    await borrarTodosLosDatos();
    setShowWipeConfirm(false);
    setImportStatusMessage({
      type: "success",
      text: "Todos los datos han sido borrados de la agenda.",
    });
  };

  const handleConfirmRestoreDemo = async () => {
    await restaurarDatosDemostracion();
    setShowRestoreDemoConfirm(false);
    setImportStatusMessage({
      type: "success",
      text: "Datos de demostración restaurados exitosamente en Cloud Firestore.",
    });
  };

  const handleConfirmLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error("Error al cerrar sesión", e);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="pb-2 border-b border-slate-800">
        <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Más</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Configuración, cuenta, sincronización y respaldo de datos
        </p>
      </div>

      {importStatusMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-sm ${
            importStatusMessage.type === "success"
              ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200"
              : "bg-rose-950/40 border-rose-800/60 text-rose-200"
          }`}
        >
          {importStatusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{importStatusMessage.text}</span>
        </div>
      )}

      {/* Card 0: Cuenta & Almacenamiento */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg ${
                currentUser
                  ? "bg-sky-950/70 border border-sky-800/70 text-sky-400"
                  : "bg-emerald-950/70 border border-emerald-800/70 text-emerald-400"
              }`}
            >
              {currentUser ? (
                <UserCheck className="w-5 h-5" />
              ) : (
                <HardDrive className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {currentUser ? "Cuenta y Sincronización" : "Almacenamiento Local"}
              </h3>
              <p className="text-xs text-slate-400">
                {currentUser
                  ? "Conectado con Google"
                  : "Datos guardados en este dispositivo"}
              </p>
            </div>
          </div>

          {currentUser ? (
            syncStatus === "connected" ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-800/70 rounded-full text-emerald-400 text-[11px] font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Conectado a Firestore</span>
              </div>
            ) : syncStatus === "syncing" || isManualSyncing ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-950/60 border border-sky-800/70 rounded-full text-sky-400 text-[11px] font-medium">
                <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                <span>Sincronizando...</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 border border-amber-800/70 rounded-full text-amber-400 text-[11px] font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Sin conexión / Offline</span>
              </div>
            )
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-slate-300 text-[11px] font-medium">
              <HardDrive className="w-3 h-3 text-slate-400" />
              <span>Modo Local</span>
            </div>
          )}
        </div>

        {currentUser ? (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl">
              <div className="flex items-center gap-3">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || "Usuario"}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full border border-slate-700 object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-sky-900 border border-sky-700 flex items-center justify-center font-bold text-sky-200 text-sm">
                    {(currentUser.displayName || currentUser.email || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    {currentUser.displayName || "Profesor Agenda"}
                  </p>
                  <p className="text-xs text-slate-400">{currentUser.email}</p>
                </div>
              </div>

              <button
                type="button"
                id="btn-cerrar-sesion"
                onClick={() => setShowLogoutConfirm(true)}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-400" />
                <span>Cerrar sesión</span>
              </button>
            </div>

            {/* Panel de Sincronización Real multidispositivo */}
            <div className="p-3.5 bg-slate-950/60 border border-slate-800/70 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                  <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Sincronización multidispositivo en tiempo real</span>
                </div>
                <p className="text-slate-400">
                  Última sincronización exitosa:{" "}
                  <span className="text-slate-200 font-mono">
                    {lastSyncTime
                      ? lastSyncTime.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        }) + " — " + lastSyncTime.toLocaleDateString()
                      : "Sincronizado al cargar"}
                  </span>
                </p>
              </div>

              <button
                type="button"
                id="btn-sincronizar-ahora"
                onClick={handleManualSync}
                disabled={isManualSyncing || syncStatus === "syncing"}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white disabled:text-slate-500 font-medium rounded-xl text-xs transition-colors cursor-pointer shadow-sm active:scale-[0.98]"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isManualSyncing || syncStatus === "syncing"
                      ? "animate-spin text-sky-300"
                      : "text-white"
                  }`}
                />
                <span>
                  {isManualSyncing || syncStatus === "syncing"
                    ? "Sincronizando..."
                    : "Sincronizar ahora"}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Tus actividades, clases, alumnos y notas se guardan de forma segura y permanente en el almacenamiento local de este dispositivo.
              </span>
            </div>

            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-slate-200">
                  ¿Deseas sincronizar entre dispositivos y respaldar en la nube?
                </p>
                <p className="text-[11px] text-slate-400">
                  Conecta tu cuenta de Google para activar Cloud Firestore y Google Calendar.
                </p>
              </div>

              <button
                type="button"
                id="btn-login-google-mas"
                onClick={handleSignIn}
                disabled={isLoggingIn}
                className="min-h-[42px] inline-flex items-center justify-center gap-2.5 px-4 py-2 bg-white hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 text-xs font-semibold rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                    <span>Iniciar sesión con Google</span>
                  </>
                )}
              </button>
            </div>

            {loginError && (
              <div className="p-2.5 bg-rose-950/50 border border-rose-800/70 rounded-xl text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card: Notas Rápidas (Setlists DJ, Ideas, Apuntes Pedagógicos) */}
      <NotasRapidasSection />

      {/* Card 1: Notificaciones */}
      <PushNotificationSettings />

      {/* Card: Google Calendar Sync */}
      <GoogleCalendarSyncCard />

      {/* Card 2: Google Drive Export & Backup */}
      <GoogleDriveExportCard
        onGetBackupData={exportarRespaldo}
        onImportBackupData={importarRespaldo}
      />

      {/* Card 3: Respaldo Local y Cloud Firestore (JSON) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-950/70 border border-emerald-800/70 text-emerald-400">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Respaldo</h3>
              <p className="text-xs text-slate-400">
                Exporta e importa tu agenda completa en formato JSON
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/80 border border-slate-800/90 rounded-full text-slate-300 text-[11px] font-medium self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Datos guardados en este dispositivo</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Exportar respaldo Firestore */}
          <button
            type="button"
            id="btn-exportar-respaldo-firestore"
            disabled={exportingFirestore}
            onClick={handleExportFirestore}
            className="min-h-[44px] p-3 bg-slate-950 hover:bg-slate-800 active:scale-[0.99] border border-sky-900/40 hover:border-sky-700/60 rounded-xl text-left transition-all flex items-center gap-3 group cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400 group-hover:bg-sky-900/60 transition-colors shrink-0">
              {exportingFirestore ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-300" />
              ) : (
                <CloudDownload className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-slate-200 block group-hover:text-white truncate">
                {exportingFirestore ? "Consultando..." : "Exportar Firestore"}
              </span>
              <span className="text-[11px] text-sky-400/90 line-clamp-1">
                Consulta en vivo la base de datos
              </span>
            </div>
          </button>

          {/* Exportar Local */}
          <button
            type="button"
            id="btn-exportar-respaldo"
            onClick={handleExport}
            className="min-h-[44px] p-3 bg-slate-950 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 group-hover:bg-emerald-900/50 transition-colors shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-slate-200 block group-hover:text-white truncate">
                Exportar local
              </span>
              <span className="text-[11px] text-slate-400 line-clamp-1">
                Descarga rápida de estado en memoria
              </span>
            </div>
          </button>

          {/* Importar */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              type="button"
              id="btn-importar-respaldo"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-full min-h-[44px] p-3 bg-slate-950 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all flex items-center gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-400 group-hover:bg-blue-900/50 transition-colors shrink-0">
                <Upload className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-slate-200 block group-hover:text-white truncate">
                  Importar respaldo
                </span>
                <span className="text-[11px] text-slate-400 line-clamp-1">
                  Subir archivo JSON
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Card 4: Datos */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-800/70 text-rose-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Datos</h3>
              <p className="text-xs text-slate-400">
                {alumnos.length} alumnos • {clases.length} clases •{" "}
                {tocatas.length} tocatas • {notas.length} notas
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/80 border border-slate-800/90 rounded-full text-slate-300 text-[11px] font-medium self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Datos guardados en este dispositivo</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <button
            type="button"
            id="btn-restaurar-demo"
            onClick={() => setShowRestoreDemoConfirm(true)}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-medium text-xs rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Restaurar datos de demostración</span>
          </button>

          <button
            type="button"
            id="btn-borrar-todos-datos"
            onClick={() => setShowWipeConfirm(true)}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs rounded-xl transition-colors shadow-sm cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Borrar todos los datos</span>
          </button>
        </div>
      </div>

      {/* Card 5: Próximamente IA */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/80">
          <div className="p-2 rounded-lg bg-violet-950/70 border border-violet-800/70 text-violet-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Próximamente: preparación de clases con IA
            </h3>
            <span className="text-[11px] font-medium text-violet-300">
              En desarrollo
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          La futura herramienta podrá usar el historial, nivel y notas de cada
          alumno para proponer ejercicios y preguntas diferentes sin repetir
          contenidos.
        </p>
      </div>

      {/* Confirm Logout Modal */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleConfirmLogout}
        title="Cerrar sesión"
        message="¿Deseas cerrar tu sesión? Podrás volver a iniciarla en cualquier momento con tu cuenta de Google."
        confirmText="Cerrar sesión"
        isDestructive={false}
      />

      {/* Confirm Import Modal */}
      <ConfirmDialog
        isOpen={showImportConfirm}
        onClose={() => {
          setShowImportConfirm(false);
          setPendingImportData(null);
        }}
        onConfirm={handleConfirmImport}
        title="Importar respaldo"
        message="¿Importar este respaldo? Los datos actuales serán reemplazados."
        confirmText="Importar respaldo"
        cancelText="Cancelar"
        isDestructive={false}
      />

      {/* Confirm Wipe Modal */}
      <ConfirmDialog
        isOpen={showWipeConfirm}
        onClose={() => setShowWipeConfirm(false)}
        onConfirm={handleConfirmWipe}
        title="Borrar todos los datos"
        message="¿Borrar todos los alumnos, clases, tocatas y notas? Esta acción no se puede deshacer."
        confirmText="Borrar todo"
        isDestructive={true}
      />

      {/* Confirm Restore Demo Modal */}
      <ConfirmDialog
        isOpen={showRestoreDemoConfirm}
        onClose={() => setShowRestoreDemoConfirm(false)}
        onConfirm={handleConfirmRestoreDemo}
        title="Restaurar datos de demostración"
        message="¿Deseas restaurar los alumnos y eventos de demostración en Cloud Firestore? Tus datos actuales serán reemplazados."
        confirmText="Restaurar demo"
        isDestructive={false}
      />
    </div>
  );
};
