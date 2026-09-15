import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  initAuth,
  googleSignIn,
  googleLogout,
  getAccessToken,
  auth,
} from "../../services/googleDriveAuth";
import {
  uploadBackupToDrive,
  listDriveBackups,
  downloadDriveBackup,
  deleteDriveFile,
  DriveFileItem,
} from "../../services/googleDriveService";
import { RespaldoProfesorAgenda } from "../../types";
import { ConfirmDialog } from "../common/ConfirmDialog";
import {
  Cloud,
  CloudUpload,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  DownloadCloud,
  LogOut,
  FolderSync,
} from "lucide-react";

interface GoogleDriveExportCardProps {
  onGetBackupData: () => RespaldoProfesorAgenda;
  onImportBackupData: (data: RespaldoProfesorAgenda) => Promise<boolean>;
}

export const GoogleDriveExportCard: React.FC<GoogleDriveExportCardProps> = ({
  onGetBackupData,
  onImportBackupData,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [driveBackups, setDriveBackups] = useState<DriveFileItem[]>([]);
  const [lastUploadedFile, setLastUploadedFile] = useState<DriveFileItem | null>(
    null
  );

  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    text: string;
    link?: { url: string; label: string };
  } | null>(null);

  // Dialog states for destructive / replacing operations
  const [fileToRestore, setFileToRestore] = useState<DriveFileItem | null>(null);
  const [fileToDelete, setFileToDelete] = useState<DriveFileItem | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
      },
      () => {
        // Fallback check if user is already signed in on Firebase auth
        if (auth.currentUser) {
          setCurrentUser(auth.currentUser);
        } else {
          setCurrentUser(null);
          setAccessToken(null);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Fetch backups whenever accessToken is available
  useEffect(() => {
    if (accessToken) {
      loadBackups(accessToken);
    }
  }, [accessToken]);

  const loadBackups = async (token: string) => {
    setIsLoadingBackups(true);
    try {
      const files = await listDriveBackups(token);
      setDriveBackups(files);
    } catch (err: unknown) {
      console.warn("No se pudieron listar los archivos de Google Drive:", err);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleConnectGoogle = async () => {
    setIsAuthenticating(true);
    setNotification(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
        setNotification({
          type: "success",
          text: `Conectado exitosamente con ${
            result.user.email || "tu cuenta de Google"
          }.`,
        });
        loadBackups(result.accessToken);
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Error al autenticar con Google Drive";
      setNotification({
        type: "error",
        text: `Error de conexión: ${errorMsg}`,
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleDisconnect = async () => {
    await googleLogout();
    setCurrentUser(null);
    setAccessToken(null);
    setDriveBackups([]);
    setLastUploadedFile(null);
    setNotification({
      type: "info",
      text: "Cuenta de Google desconectada.",
    });
  };

  const handleExportToDrive = async () => {
    let token = accessToken || getAccessToken();

    if (!token) {
      // Prompt sign in first
      setIsAuthenticating(true);
      try {
        const result = await googleSignIn();
        if (!result) return;
        token = result.accessToken;
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
      } catch (err: unknown) {
        setNotification({
          type: "error",
          text: "Se requiere autorización para exportar a Google Drive.",
        });
        setIsAuthenticating(false);
        return;
      } finally {
        setIsAuthenticating(false);
      }
    }

    if (!token) return;

    setIsUploading(true);
    setNotification(null);

    try {
      const backupData = onGetBackupData();
      const uploaded = await uploadBackupToDrive(token, backupData);
      setLastUploadedFile(uploaded);
      setNotification({
        type: "success",
        text: `¡Respaldo exportado exitosamente a Google Drive! (${uploaded.name})`,
        link: uploaded.webViewLink
          ? { url: uploaded.webViewLink, label: "Ver archivo en Google Drive" }
          : undefined,
      });

      // Refresh list
      loadBackups(token);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "No se pudo completar la exportación a Google Drive.";
      setNotification({
        type: "error",
        text: errorMsg,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!fileToRestore || !accessToken) return;

    setIsProcessingAction(true);
    try {
      const data = await downloadDriveBackup(accessToken, fileToRestore.id);
      const success = await onImportBackupData(data);
      if (success) {
        setNotification({
          type: "success",
          text: `Respaldo "${fileToRestore.name}" restaurado correctamente en Profesor Agenda.`,
        });
      } else {
        setNotification({
          type: "error",
          text: "El archivo descargado no tiene un formato válido de Profesor Agenda.",
        });
      }
    } catch (err: unknown) {
      setNotification({
        type: "error",
        text: "Error al descargar y restaurar el archivo desde Google Drive.",
      });
    } finally {
      setIsProcessingAction(false);
      setFileToRestore(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!fileToDelete || !accessToken) return;

    setIsProcessingAction(true);
    try {
      await deleteDriveFile(accessToken, fileToDelete.id);
      setNotification({
        type: "success",
        text: `Archivo "${fileToDelete.name}" eliminado de Google Drive.`,
      });
      loadBackups(accessToken);
    } catch (err: unknown) {
      setNotification({
        type: "error",
        text: "No se pudo eliminar el archivo de Google Drive.",
      });
    } finally {
      setIsProcessingAction(false);
      setFileToDelete(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-sky-950/70 border border-sky-800/70 text-sky-400">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              Google Drive
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800/60">
                Respaldo en la nube
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Exporta tu agenda directamente a tu cuenta de Google Drive
            </p>
          </div>
        </div>

        {currentUser && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
            title="Desconectar cuenta"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Desconectar</span>
          </button>
        )}
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs sm:text-sm ${
            notification.type === "success"
              ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200"
              : notification.type === "error"
              ? "bg-rose-950/40 border-rose-800/60 text-rose-200"
              : "bg-sky-950/40 border-sky-800/60 text-sky-200"
          }`}
        >
          <div className="flex items-start sm:items-center gap-2">
            {notification.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
            ) : notification.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
            ) : (
              <Cloud className="w-4 h-4 text-sky-400 shrink-0 mt-0.5 sm:mt-0" />
            )}
            <span className="leading-snug">{notification.text}</span>
          </div>

          {notification.link && (
            <a
              href={notification.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-100 font-medium text-xs transition-colors shrink-0 self-start sm:self-auto"
            >
              <span>{notification.link.label}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Connection & Export Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Account state / Connect button */}
        <div className="p-3.5 bg-slate-950 border border-slate-800/90 rounded-xl flex flex-col justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-slate-300 block mb-1">
              Cuenta de Google
            </span>
            {currentUser ? (
              <div className="flex items-center gap-2.5">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || "Avatar"}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full border border-slate-700"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-900 text-blue-200 flex items-center justify-center font-bold text-xs">
                    {currentUser.email?.charAt(0).toUpperCase() || "G"}
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-xs font-medium text-slate-100 truncate">
                    {currentUser.displayName || "Usuario de Google"}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {currentUser.email}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Conecta tu cuenta para sincronizar y guardar copias de seguridad
                en tu Google Drive.
              </p>
            )}
          </div>

          {!currentUser ? (
            <button
              type="button"
              id="btn-google-drive-login"
              onClick={handleConnectGoogle}
              disabled={isAuthenticating}
              className="w-full inline-flex items-center justify-center gap-2.5 min-h-[44px] px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-800 font-semibold text-xs rounded-xl transition-all shadow-sm active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                  <span>Conectando con Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 48 48">
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
                  <span>Conectar con Google Drive</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sesión activa y lista para exportar</span>
            </div>
          )}
        </div>

        {/* Export Action Card */}
        <div className="p-3.5 bg-slate-950 border border-slate-800/90 rounded-xl flex flex-col justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-slate-300 block mb-1">
              Exportación Instantánea
            </span>
            <p className="text-xs text-slate-400">
              Crea un archivo JSON en tu unidad de Google Drive con todos tus
              alumnos, clases, Fechas DJ y notas.
            </p>
          </div>

          <button
            type="button"
            id="btn-exportar-google-drive"
            onClick={handleExportToDrive}
            disabled={isUploading || isAuthenticating}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 bg-sky-600 hover:bg-sky-500 active:scale-[0.99] text-white font-semibold text-xs sm:text-sm rounded-xl transition-all shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Exportando a Google Drive...</span>
              </>
            ) : (
              <>
                <CloudUpload className="w-4 h-4" />
                <span>Exportar ahora a Google Drive</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Google Drive Backups List */}
      {currentUser && (
        <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <FolderSync className="w-3.5 h-3.5 text-sky-400" />
              Respaldos guardados en tu Google Drive ({driveBackups.length})
            </h4>

            <button
              type="button"
              id="btn-recargar-drive-backups"
              onClick={() => accessToken && loadBackups(accessToken)}
              disabled={isLoadingBackups}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors disabled:opacity-50"
              title="Refrescar lista"
            >
              <RefreshCw
                className={`w-3 h-3 ${
                  isLoadingBackups ? "animate-spin text-sky-400" : ""
                }`}
              />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>

          {isLoadingBackups && driveBackups.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 bg-slate-950/50 rounded-xl">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1 text-slate-400" />
              Consultando archivos en Google Drive...
            </div>
          ) : driveBackups.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 bg-slate-950/50 rounded-xl border border-dashed border-slate-850">
              Aún no has exportado ningún respaldo a Google Drive.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {driveBackups.map((file) => (
                <div
                  key={file.id}
                  className="p-2.5 bg-slate-950 hover:bg-slate-850/80 border border-slate-800/80 rounded-xl flex items-center justify-between gap-2 transition-colors text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-200 truncate">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {new Date(file.createdTime).toLocaleString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {file.size
                        ? ` • ${(Number(file.size) / 1024).toFixed(1)} KB`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {file.webViewLink && (
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-sky-950/60 rounded-lg transition-colors"
                        title="Ver en Google Drive"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setFileToRestore(file)}
                      className="p-1.5 text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/60 rounded-lg transition-colors"
                      title="Restaurar este respaldo"
                    >
                      <DownloadCloud className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFileToDelete(file)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/60 rounded-lg transition-colors"
                      title="Eliminar de Google Drive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation for Restoring from Drive (Destructive/Replacing) */}
      <ConfirmDialog
        isOpen={!!fileToRestore}
        onClose={() => setFileToRestore(null)}
        onConfirm={handleConfirmRestore}
        title="Restaurar desde Google Drive"
        message={`¿Deseas restaurar la agenda desde "${fileToRestore?.name}"? Tus datos locales actuales serán reemplazados por los datos contenidos en este respaldo.`}
        confirmText={
          isProcessingAction ? "Restaurando..." : "Restaurar y reemplazar"
        }
        isDestructive={false}
      />

      {/* Confirmation for Deleting from Drive (Destructive) */}
      <ConfirmDialog
        isOpen={!!fileToDelete}
        onClose={() => setFileToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar archivo de Google Drive"
        message={`¿Estás seguro de que deseas eliminar permanentemente "${fileToDelete?.name}" de tu Google Drive?`}
        confirmText={
          isProcessingAction ? "Eliminando..." : "Eliminar de Drive"
        }
        isDestructive={true}
      />
    </div>
  );
};
