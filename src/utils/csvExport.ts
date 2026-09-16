import { Clase, Tocata, Alumno } from "../types";

export interface ContableCSVExportParams {
  clases: Clase[];
  tocatas: Tocata[];
  alumnos: Alumno[];
}

/**
 * Generates a clean CSV file string encoded in UTF-8 with BOM (\uFEFF)
 * and semicolon delimiters for native Microsoft Excel support in Spanish regions.
 */
export function generateContableCSV({
  clases,
  tocatas,
  alumnos,
}: ContableCSVExportParams): string {
  const headers = [
    "Fecha",
    "Tipo",
    "Categoría",
    "Alumno / Evento",
    "Hora Inicio",
    "Hora Término",
    "Estado",
    "Estado de Pago",
    "Honorarios / Monto CLP",
    "Lugar / Ciudad",
    "Notas",
  ];

  const alumnoMap = new Map<string, Alumno>();
  alumnos.forEach((a) => alumnoMap.set(a.id, a));

  interface ExportRow {
    fecha: string;
    tipo: string;
    categoria: string;
    nombre: string;
    horaInicio: string;
    horaFin: string;
    estado: string;
    estadoPago: string;
    monto: string;
    lugar: string;
    notas: string;
  }

  const rows: ExportRow[] = [];

  // 1. Proyectar clases
  clases.forEach((c) => {
    const alumno = alumnoMap.get(c.alumnoId);
    const alumnoNombre = alumno
      ? `${alumno.nombre}${alumno.apellido ? " " + alumno.apellido : ""}`.trim()
      : "Alumno sin asignar";

    const catLabel =
      c.tipo === "alma"
        ? "ALMA"
        : c.tipo === "escalera"
        ? "La Escalera"
        : c.tipo === "dj"
        ? "Clase DJ"
        : c.tipo === "sokolov"
        ? "Sokolov"
        : "Clase";

    const estadoPago =
      c.estado === "realizada"
        ? "Realizada"
        : c.estado === "cancelada"
        ? "Cancelada"
        : "Pendiente";

    const notasList: string[] = [];
    if (c.tema) notasList.push(`Tema: ${c.tema}`);
    if (c.notas) notasList.push(c.notas);

    rows.push({
      fecha: c.fecha,
      tipo: "Clase",
      categoria: catLabel,
      nombre: alumnoNombre,
      horaInicio: c.horaInicio,
      horaFin: c.horaFin,
      estado: c.estado,
      estadoPago,
      monto: "",
      lugar: c.tipo === "alma" ? "Academia ALMA" : "Particular / Online",
      notas: notasList.join(" | "),
    });
  });

  // 2. Proyectar tocatas
  tocatas.forEach((t) => {
    const locacionPartes = [t.lugar, t.ciudad].filter(Boolean);
    const lugarStr = locacionPartes.length > 0 ? locacionPartes.join(", ") : "Locación";

    const notasList: string[] = [];
    if (t.contacto) notasList.push(`Contacto: ${t.contacto}`);
    if (t.direccion) notasList.push(`Dirección: ${t.direccion}`);
    if (t.notas) notasList.push(t.notas);

    rows.push({
      fecha: t.fecha,
      tipo: "Tocata DJ",
      categoria: t.proyecto || "DJ Set",
      nombre: t.titulo || "Tocata DJ",
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      estado: t.estado,
      estadoPago: t.estado === "realizada" ? "Cobrado/Por cobrar" : t.estado,
      monto: t.honorarios ? String(t.honorarios) : "",
      lugar: lugarStr,
      notas: notasList.join(" | "),
    });
  });

  // Orden cronológico descendente (las más recientes primero)
  rows.sort((a, b) => {
    const dateComp = b.fecha.localeCompare(a.fecha);
    if (dateComp !== 0) return dateComp;
    return a.horaInicio.localeCompare(b.horaInicio);
  });

  const escapeCSV = (val: string): string => {
    if (!val) return '""';
    const escaped = String(val).replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const csvLines = [
    headers.map(escapeCSV).join(";"),
    ...rows.map((r) =>
      [
        r.fecha,
        r.tipo,
        r.categoria,
        r.nombre,
        r.horaInicio,
        r.horaFin,
        r.estado,
        r.estadoPago,
        r.monto,
        r.lugar,
        r.notas,
      ]
        .map(escapeCSV)
        .join(";")
    ),
  ];

  // \uFEFF Byte Order Mark for Excel compatibility
  return "\uFEFF" + csvLines.join("\r\n");
}

export function downloadCSV(filename: string, csvData: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
