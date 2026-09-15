import { RespaldoProfesorAgenda } from "../types";

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
}

/**
 * Upload a complete JSON backup file of Profesor Agenda to Google Drive
 */
export async function uploadBackupToDrive(
  accessToken: string,
  backupData: RespaldoProfesorAgenda,
  customName?: string
): Promise<DriveFileItem> {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const fileName =
    customName || `profesor-agenda-respaldo-${timestamp}.json`;

  const metadata = {
    name: fileName,
    mimeType: "application/json",
    description: `Respaldo automático de Profesor Agenda exportado el ${new Date().toLocaleString(
      "es-CL"
    )}. Contiene ${backupData.alumnos.length} alumnos, ${
      backupData.clases.length
    } clases y ${backupData.tocatas.length} Fechas DJ.`,
    properties: {
      app: "ProfesorAgenda",
      version: "1",
    },
  };

  const fileContent = JSON.stringify(backupData, null, 2);
  const boundary = "-------ProfesorAgendaDriveBoundary314159265";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    fileContent +
    closeDelim;

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,createdTime,size,webViewLink,iconLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody?.error?.message ||
        `Error ${response.status}: No se pudo guardar el archivo en Google Drive`
    );
  }

  return (await response.json()) as DriveFileItem;
}

/**
 * List all Profesor Agenda backups stored in Google Drive
 */
export async function listDriveBackups(
  accessToken: string
): Promise<DriveFileItem[]> {
  const query = encodeURIComponent(
    "name contains 'profesor-agenda' and trashed = false"
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&pageSize=15&fields=files(id,name,mimeType,createdTime,size,webViewLink,iconLink)`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody?.error?.message ||
        `Error ${response.status}: No se pudieron listar los respaldos de Google Drive`
    );
  }

  const data = await response.json();
  return (data.files || []) as DriveFileItem[];
}

/**
 * Download a backup file from Google Drive and parse its JSON content
 */
export async function downloadDriveBackup(
  accessToken: string,
  fileId: string
): Promise<RespaldoProfesorAgenda> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Error ${response.status}: No se pudo descargar el archivo de Google Drive`
    );
  }

  const json = await response.json();
  return json as RespaldoProfesorAgenda;
}

/**
 * Delete a backup file from Google Drive (Requires explicit confirmation from UI)
 */
export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok && response.status !== 204) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody?.error?.message ||
        `Error ${response.status}: No se pudo eliminar el archivo en Google Drive`
    );
  }
}
