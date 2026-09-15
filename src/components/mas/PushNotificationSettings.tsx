import React, { useState, useEffect } from "react";
import { useAgenda } from "../../context/AgendaContext";
import {
  isNotificationSupported,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  showTestNotification,
  registerNotificationServiceWorker,
  NotificationPermissionStatus,
} from "../../utils/notificationService";
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  Info,
  Loader2,
} from "lucide-react";

export const PushNotificationSettings: React.FC = () => {
  const { preferencias, updatePreferencias } = useAgenda();
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionStatus>("default");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  const isSupported = isNotificationSupported();

  // Always re-check browser permission on mount; do not store in Firestore
  useEffect(() => {
    setPermissionStatus(getNotificationPermissionStatus());
    registerNotificationServiceWorker();
  }, []);

  const handleToggleRecordatorios = async () => {
    const nextState = !preferencias.recordatoriosActivos;
    await updatePreferencias({
      recordatoriosActivos: nextState,
      notificacionesPushLocales: nextState,
    });
  };

  const handleActivarNotificaciones = async () => {
    setTestFeedback(null);
    const result = await requestNotificationPermission();
    const updatedStatus = getNotificationPermissionStatus();
    setPermissionStatus(updatedStatus);

    if (result === "granted") {
      setTestFeedback("Notificaciones permitidas correctamente.");
      if (!preferencias.recordatoriosActivos) {
        await updatePreferencias({
          recordatoriosActivos: true,
          notificacionesPushLocales: true,
        });
      }
    } else if (result === "denied") {
      setTestFeedback("Permiso denegado por el navegador.");
    }
  };

  const handleEnviarPrueba = async () => {
    setIsSendingTest(true);
    setTestFeedback(null);

    const sent = await showTestNotification();
    setIsSendingTest(false);

    if (sent) {
      setTestFeedback("Notificación de prueba enviada con éxito.");
    } else {
      setTestFeedback("No se pudo emitir la notificación. Revisa los permisos del sistema.");
    }
  };

  // Helper label for status
  const getStatusLabel = (status: NotificationPermissionStatus) => {
    switch (status) {
      case "granted":
        return "Permitidas";
      case "denied":
        return "Bloqueadas";
      case "default":
        return "Pendientes";
      case "unsupported":
      default:
        return "No compatibles";
    }
  };

  return (
    <div
      id="card-notificaciones"
      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm"
    >
      {/* Header: Title, Subtitle, Switch */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-950/70 border border-blue-800/70 text-blue-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Notificaciones
            </h3>
            <p className="text-xs text-slate-400">
              Recibe avisos 1 día y 2 horas antes de tus clases y fechas DJ.
            </p>
          </div>
        </div>

        {/* Switch for "Recordatorios activos" */}
        <button
          type="button"
          id="switch-recordatorios-activo"
          role="switch"
          aria-checked={preferencias.recordatoriosActivos}
          onClick={handleToggleRecordatorios}
          className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
            preferencias.recordatoriosActivos ? "bg-blue-600" : "bg-slate-800"
          }`}
          title={
            preferencias.recordatoriosActivos
              ? "Desactivar recordatorios"
              : "Activar recordatorios"
          }
        >
          <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
              preferencias.recordatoriosActivos
                ? "translate-x-5"
                : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Status Details: Compatibilidad & Estado */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Compatibilidad
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isSupported ? "bg-emerald-400" : "bg-slate-500"
              }`}
            />
            <span className="text-sm font-medium text-slate-200">
              {isSupported ? "Compatible" : "No compatible"}
            </span>
          </div>
        </div>

        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Estado
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${
                permissionStatus === "granted"
                  ? "bg-emerald-400"
                  : permissionStatus === "denied"
                  ? "bg-rose-500"
                  : permissionStatus === "default"
                  ? "bg-amber-400"
                  : "bg-slate-500"
              }`}
            />
            <span
              className={`text-sm font-medium ${
                permissionStatus === "granted"
                  ? "text-emerald-300"
                  : permissionStatus === "denied"
                  ? "text-rose-300"
                  : permissionStatus === "default"
                  ? "text-amber-300"
                  : "text-slate-400"
              }`}
            >
              {getStatusLabel(permissionStatus)}
            </span>
          </div>
        </div>
      </div>

      {/* Blocked message */}
      {permissionStatus === "denied" && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2.5 leading-relaxed">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p>
            Las notificaciones están bloqueadas. Actívalas desde los ajustes del navegador o del sistema.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        {/* Botón 'Activar notificaciones': Visible y habilitado cuando el estado sea Pendientes */}
        {permissionStatus === "default" && isSupported && (
          <button
            type="button"
            id="btn-activar-notificaciones"
            onClick={handleActivarNotificaciones}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shadow-sm"
          >
            <Bell className="w-4 h-4" />
            <span>Activar notificaciones</span>
          </button>
        )}

        {/* Botón 'Enviar prueba': Visible y habilitado solo cuando estén Permitidas */}
        {permissionStatus === "granted" && (
          <button
            type="button"
            id="btn-enviar-prueba"
            onClick={handleEnviarPrueba}
            disabled={isSendingTest}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSendingTest ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
            ) : (
              <Send className="w-4 h-4 text-blue-400" />
            )}
            <span>{isSendingTest ? "Enviando..." : "Enviar prueba"}</span>
          </button>
        )}
      </div>

      {/* Feedback message */}
      {testFeedback && (
        <div className="text-xs text-slate-300 flex items-center gap-1.5 py-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>{testFeedback}</span>
        </div>
      )}

      {/* Fixed, discrete, and honest disclaimer */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2.5 leading-relaxed">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p>
            Los avisos se ejecutan mientras Profesor Agenda está abierta, activa o instalada. Las notificaciones con la aplicación cerrada requieren configuración push adicional.
          </p>
        </div>
      </div>
    </div>
  );
};
