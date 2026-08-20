import { google, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'googleapis-common';
import { IDocumentProvider } from '../../ports/IDocumentProvider.js';
import { Inspector, Certificate } from '../../domain/models/Certificate.js';
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';
import { parseDateFromFilename, parseDocCode, calculateDocExpiration } from './certificateFilenameParser.js';
import { getAuthorizedClient } from './googleAuth.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class GoogleDriveOAuthAdapter implements IDocumentProvider {
  private rootFolderId: string;
  private refDate: Date;
  private authClient: OAuth2Client | null = null;
  private drive: drive_v3.Drive | null = null;

  constructor(rootFolderId: string, refDate: Date = new Date()) {
    this.rootFolderId = rootFolderId;
    this.refDate = refDate;
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (this.drive) return this.drive;
    this.authClient = await getAuthorizedClient();
    this.drive = google.drive({ version: 'v3', auth: this.authClient });
    return this.drive;
  }

  private async listChildren(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = await this.getDrive();
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)',
        pageSize: 1000,
        pageToken
      });
      files.push(...(res.data.files || []));
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return files;
  }

  async getInspectors(filterNames?: string[]): Promise<Inspector[]> {
    const inspectors: Inspector[] = [];
    const topLevel = await this.listChildren(this.rootFolderId);

    for (const entry of topLevel) {
      if (entry.mimeType !== FOLDER_MIME || !entry.id || !entry.name) continue;

      const folderName = entry.name;
      if (filterNames && filterNames.length > 0) {
        const matchesFilter = filterNames.some((fname) => folderName.toUpperCase().includes(fname.toUpperCase()));
        if (!matchesFilter) continue;
      }

      const nameParts = folderName.split('-');
      const name = nameParts[0].trim();
      const role = nameParts.length > 1 ? nameParts[1].trim() : 'TÉCNICO / INSPETOR';

      const certificates = new Map<string, Certificate>();
      await this.scanFolderRecursive(entry.id, certificates);

      inspectors.push({ id: entry.id, name, role, certificates });
    }

    return inspectors;
  }

  private async scanFolderRecursive(folderId: string, certificates: Map<string, Certificate>): Promise<void> {
    const children = await this.listChildren(folderId);

    for (const entry of children) {
      if (!entry.name) continue;

      if (entry.mimeType === FOLDER_MIME) {
        if (entry.name.toLowerCase().includes('obsoleto') || !entry.id) continue;
        await this.scanFolderRecursive(entry.id, certificates);
        continue;
      }

      const filename = entry.name;
      const code = parseDocCode(filename);
      if (!code) continue;

      // Prioriza a data no nome do arquivo; se ausente, usa createdTime do Drive como fallback
      // (metadado real, mais confiável do que tentar adivinhar pelo nome).
      const parsedDate = parseDateFromFilename(filename) || (entry.createdTime ? new Date(entry.createdTime) : null);
      const expirationDate = calculateDocExpiration(code, parsedDate, this.refDate);
      const evalResult = EHSEvaluator.evaluateDate(expirationDate, this.refDate);

      const cert: Certificate = {
        code,
        name: `Doc ${code}`,
        filename,
        issueDate: parsedDate || undefined,
        expirationDate,
        statusEHS: evalResult.status,
        statusDetail: evalResult.detail,
        sourcePath: entry.id ? `https://drive.google.com/file/d/${entry.id}/view` : undefined
      };

      const existing = certificates.get(code);
      if (!existing || (expirationDate && (!existing.expirationDate || expirationDate > existing.expirationDate))) {
        certificates.set(code, cert);
      }
    }
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    const inspectors = await this.getInspectors();
    return inspectors.find((i) => i.id === id) || null;
  }
}
