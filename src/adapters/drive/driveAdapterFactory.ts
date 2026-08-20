import { IDocumentProvider } from '../../ports/IDocumentProvider.js';
import { DriveFileSystemAdapter } from './DriveFileSystemAdapter.js';
import { GoogleDriveOAuthAdapter } from './GoogleDriveOAuthAdapter.js';

const DEFAULT_LOCAL_DRIVE_PATH = `D:\\Drive\\.shortcut-targets-by-id\\1ftfSSauhVuaCKimKCKUI1bstr1ALZShq\\01 - Inspetores de Qualidade & Técnicos de Operações`;

/**
 * Escolhe o provedor de documentos do Drive: API (folder ID configurado) tem prioridade,
 * caindo para o path local sincronizado quando a API não está configurada. A API funciona
 * em qualquer runner (inclusive ubuntu-latest no CI); o path local só funciona na máquina
 * com o Google Drive Desktop montado.
 */
export function createDriveAdapter(refDate: Date): IDocumentProvider {
  const folderId = process.env.HSE_DRIVE_FOLDER_ID;
  if (folderId) {
    console.log('[driveAdapterFactory] Usando GoogleDriveOAuthAdapter (HSE_DRIVE_FOLDER_ID configurado).');
    return new GoogleDriveOAuthAdapter(folderId, refDate);
  }

  const localPath = process.env.HSE_DRIVE_PATH || DEFAULT_LOCAL_DRIVE_PATH;
  console.log('[driveAdapterFactory] Usando DriveFileSystemAdapter (path local sincronizado).');
  return new DriveFileSystemAdapter(localPath, refDate);
}
