import {
  RespaldoProfesorAgenda,
  Alumno,
  Clase,
  Tocata,
  NotaAlumno,
  NotaRapida,
  Preferencias,
} from "../types";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: RespaldoProfesorAgenda;
  summary?: {
    alumnosCount: number;
    clasesCount: number;
    tocatasCount: number;
    notasCount: number;
    notasRapidasCount: number;
  };
}

export function validateRespaldo(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      error: "El archivo no contiene un objeto JSON válido.",
    };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Version check
  if (obj.version !== 1) {
    return {
      valid: false,
      error: "Versión de respaldo incompatible o no reconocida (se requiere versión 1).",
    };
  }

  // 2. Arrays check
  if (!Array.isArray(obj.alumnos)) {
    return {
      valid: false,
      error: "El respaldo no contiene una lista válida de alumnos.",
    };
  }

  if (!Array.isArray(obj.clases)) {
    return {
      valid: false,
      error: "El respaldo no contiene una lista válida de clases.",
    };
  }

  if (!Array.isArray(obj.tocatas)) {
    return {
      valid: false,
      error: "El respaldo no contiene una lista válida de tocatas / fechas DJ.",
    };
  }

  // 3. Deduplicate and sanitize Alumnos
  const alumnoIdSet = new Set<string>();
  const sanitizedAlumnos: Alumno[] = [];
  for (const a of obj.alumnos) {
    if (a && typeof a === "object" && typeof a.id === "string" && typeof a.nombre === "string") {
      if (!alumnoIdSet.has(a.id)) {
        alumnoIdSet.add(a.id);
        const aRecord = a as Record<string, unknown>;
        sanitizedAlumnos.push({
          id: a.id,
          nombre: String(a.nombre).trim(),
          apellido: typeof aRecord.apellido === "string" ? aRecord.apellido : undefined,
          email: typeof aRecord.email === "string" ? aRecord.email : undefined,
          tipoClase: (aRecord.tipoClase === "alma" || aRecord.tipoClase === "escalera" || aRecord.tipoClase === "dj" || aRecord.tipoClase === "sokolov") ? aRecord.tipoClase : undefined,
          telefono: typeof a.telefono === "string" ? a.telefono : "",
          descripcion: typeof a.descripcion === "string" ? a.descripcion : "",
          activo: typeof a.activo === "boolean" ? a.activo : true,
          createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString(),
          updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : new Date().toISOString(),
        });
      }
    }
  }

  // 4. Deduplicate and sanitize Clases (preserving ALMA and La Escalera)
  const claseIdSet = new Set<string>();
  const sanitizedClases: Clase[] = [];
  for (const c of obj.clases) {
    if (c && typeof c === "object" && typeof c.id === "string" && typeof c.fecha === "string") {
      if (!claseIdSet.has(c.id)) {
        claseIdSet.add(c.id);
        const tipoClase = (c.tipo === "alma" || c.tipo === "escalera" || c.tipo === "dj" || c.tipo === "sokolov") ? c.tipo : "alma";
        sanitizedClases.push({
          id: c.id,
          alumnoId: typeof c.alumnoId === "string" ? c.alumnoId : "",
          tipo: tipoClase,
          fecha: c.fecha,
          horaInicio: typeof c.horaInicio === "string" ? c.horaInicio : "16:00",
          horaFin: typeof c.horaFin === "string" ? c.horaFin : "17:30",
          tema: typeof c.tema === "string" ? c.tema : "Clase",
          notas: typeof c.notas === "string" ? c.notas : "",
          estado: (c.estado === "programada" || c.estado === "realizada" || c.estado === "cancelada") ? c.estado : "programada",
          recordatorio: c.recordatorio && typeof c.recordatorio === "object" ? c.recordatorio : undefined,
          createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date().toISOString(),
          updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : new Date().toISOString(),
        });
      }
    }
  }

  // 5. Deduplicate and sanitize Tocatas (Fechas DJ)
  const tocataIdSet = new Set<string>();
  const sanitizedTocatas: Tocata[] = [];
  for (const t of obj.tocatas) {
    if (t && typeof t === "object" && typeof t.id === "string" && typeof t.fecha === "string") {
      if (!tocataIdSet.has(t.id)) {
        tocataIdSet.add(t.id);
        sanitizedTocatas.push({
          id: t.id,
          titulo: typeof t.titulo === "string" ? t.titulo : "Fecha DJ",
          fecha: t.fecha,
          horaInicio: typeof t.horaInicio === "string" ? t.horaInicio : "22:00",
          horaFin: typeof t.horaFin === "string" ? t.horaFin : "02:00",
          proyecto: "Rodrigo Valdivia",
          lugar: typeof t.lugar === "string" ? t.lugar : "",
          ciudad: typeof t.ciudad === "string" ? t.ciudad : "",
          direccion: typeof t.direccion === "string" ? t.direccion : "",
          contacto: typeof t.contacto === "string" ? t.contacto : "",
          honorarios: typeof t.honorarios === "number" ? t.honorarios : null,
          estado: (t.estado === "pendiente" || t.estado === "confirmada" || t.estado === "realizada" || t.estado === "cancelada") ? t.estado : "confirmada",
          notas: typeof t.notas === "string" ? t.notas : "",
          createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
          updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : new Date().toISOString(),
        });
      }
    }
  }

  // 6. Deduplicate and sanitize Notas
  const notaIdSet = new Set<string>();
  const sanitizedNotas: NotaAlumno[] = [];
  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      if (n && typeof n === "object" && typeof n.id === "string") {
        if (!notaIdSet.has(n.id)) {
          notaIdSet.add(n.id);
          sanitizedNotas.push({
            id: n.id,
            alumnoId: typeof n.alumnoId === "string" ? n.alumnoId : "",
            texto: typeof n.texto === "string" ? n.texto : "",
            fecha: typeof n.fecha === "string" ? n.fecha : new Date().toISOString().slice(0, 10),
            createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
            updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date().toISOString(),
          });
        }
      }
    }
  }

  // 7. Deduplicate and sanitize Notas Rápidas
  const notaRapidaIdSet = new Set<string>();
  const sanitizedNotasRapidas: NotaRapida[] = [];
  if (Array.isArray(obj.notasRapidas)) {
    for (const nr of obj.notasRapidas) {
      if (nr && typeof nr === "object" && typeof nr.id === "string") {
        if (!notaRapidaIdSet.has(nr.id)) {
          notaRapidaIdSet.add(nr.id);
          const cat = (nr.categoria === "setlist" || nr.categoria === "pedagogica" || nr.categoria === "idea" || nr.categoria === "general") ? nr.categoria : "general";
          sanitizedNotasRapidas.push({
            id: nr.id,
            titulo: typeof nr.titulo === "string" ? nr.titulo : "Nota rápida",
            contenido: typeof nr.contenido === "string" ? nr.contenido : "",
            categoria: cat,
            color: typeof nr.color === "string" ? nr.color : undefined,
            fijada: Boolean(nr.fijada),
            createdAt: typeof nr.createdAt === "string" ? nr.createdAt : new Date().toISOString(),
            updatedAt: typeof nr.updatedAt === "string" ? nr.updatedAt : new Date().toISOString(),
          });
        }
      }
    }
  }

  // 8. Sanitize Preferencias
  const rawPrefs = (obj.preferencias && typeof obj.preferencias === "object") ? (obj.preferencias as Record<string, unknown>) : {};
  const sanitizedPreferencias: Preferencias & { filtrosGuardados?: string[] } = {
    recordatoriosActivos: typeof rawPrefs.recordatoriosActivos === "boolean" ? rawPrefs.recordatoriosActivos : true,
    recordatorios: (rawPrefs.recordatorios === "un_dia_antes" || rawPrefs.recordatorios === "mismo_dia" || rawPrefs.recordatorios === "ambos") ? rawPrefs.recordatorios : "ambos",
    proximaVistaDias: rawPrefs.proximaVistaDias === 7 ? 7 : 30,
    notificacionesPushLocales: typeof rawPrefs.notificacionesPushLocales === "boolean" ? rawPrefs.notificacionesPushLocales : false,
    antelacionNotificacionMinutos: typeof rawPrefs.antelacionNotificacionMinutos === "number" ? rawPrefs.antelacionNotificacionMinutos : 60,
    notificarClases: typeof rawPrefs.notificarClases === "boolean" ? rawPrefs.notificarClases : true,
    notificarTocatas: typeof rawPrefs.notificarTocatas === "boolean" ? rawPrefs.notificarTocatas : true,
    filtrosGuardados: Array.isArray(rawPrefs.filtrosGuardados) ? rawPrefs.filtrosGuardados : undefined,
  };

  const validatedData: RespaldoProfesorAgenda = {
    version: 1,
    exportadoEn: typeof obj.exportadoEn === "string" ? obj.exportadoEn : new Date().toISOString(),
    alumnos: sanitizedAlumnos,
    clases: sanitizedClases,
    tocatas: sanitizedTocatas,
    notas: sanitizedNotas,
    notasRapidas: sanitizedNotasRapidas,
    preferencias: sanitizedPreferencias,
  };

  return {
    valid: true,
    data: validatedData,
    summary: {
      alumnosCount: sanitizedAlumnos.length,
      clasesCount: sanitizedClases.length,
      tocatasCount: sanitizedTocatas.length,
      notasCount: sanitizedNotas.length,
      notasRapidasCount: sanitizedNotasRapidas.length,
    },
  };
}
