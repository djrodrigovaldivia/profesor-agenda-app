/**
 * Información centralizada de versión y estado de la aplicación Profesor Agenda.
 * Fuente única de verdad para la versión del sistema.
 */
export const APP_INFO = {
  nombre: "Profesor Agenda",
  version: "1.0.0",
  estado: "versión en prueba",
  descripcion:
    "Agenda personal para gestionar alumnos, clases, tocatas y sincronización de calendario.",
  avisoFase:
    "Proyecto en evolución. Las funciones pueden seguir cambiando durante la fase de prueba.",
  tecnologias: ["React", "TypeScript", "Firebase", "Google Calendar"],
} as const;
