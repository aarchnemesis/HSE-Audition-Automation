import { google, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'googleapis-common';
import { IDocumentProvider } from '../../ports/IDocumentProvider.js';
import { Inspector, Certificate } from '../../domain/models/Certificate.js';
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';
import { parseDateFromFilename, parseDocCode, calculateDocExpiration } from './certificateFilenameParser.js';
import { getAuthorizedClient } from './googleAuth.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Cada pasta de ramo tem sua PRÓPRIA numeração de documento — o mesmo código pode significar
 * coisas diferentes em ramos diferentes (achado real em 27/08/2026: código "04" é "CTPS Digital"
 * na pasta de Inspetores/Técnicos, mas "Contrato (Piloto Drone)" na pasta de Drone/LPS-SPDA).
 * Sem remapear, os dois se misturariam no catálogo global único (DOC_CATALOG_MAP). Mapeado por
 * ID da pasta raiz — se o ID mudar (pasta recriada), esse remap para de funcionar silenciosamente,
 * mas os documentos ainda aparecem com o código original errado, não desaparecem.
 */
const BRANCH_CODE_REMAP: Record<string, Record<string, string>> = {
  '1AyOLeSdD5S3fcELziWhT1ORwij3UbPgC': { '04': '40', '04.1': '40.1' }, // 03 - Drone Insp. Equipamento
  '1Yn9_peIcUruJkfVsDHLbEeHzwyVCqEX3': { '04': '40', '04.1': '40.1' }  // 04 - LPS - SPDA
};

export class GoogleDriveOAuthAdapter implements IDocumentProvider {
  private rootFolderIds: string[];
  private refDate: Date;
  private authClient: OAuth2Client | null = null;
  private drive: drive_v3.Drive | null = null;

  /**
   * Aceita uma ou várias pastas raiz — o Drive real tem uma pasta separada por ramo hierárquico
   * (01 - Inspetores/Técnicos, 02 - Líderes & EHS, 03 - Drone Insp. Equipamento, 04 - LPS-SPDA),
   * confirmado com o usuário em 27/08/2026. Cada pasta é escaneada e os inspetores são mesclados.
   */
  constructor(rootFolderId: string | string[], refDate: Date = new Date()) {
    this.rootFolderIds = Array.isArray(rootFolderId) ? rootFolderId : [rootFolderId];
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

    for (const rootFolderId of this.rootFolderIds) {
      const topLevel = await this.listChildren(rootFolderId);

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
        await this.scanFolderRecursive(entry.id, certificates, BRANCH_CODE_REMAP[rootFolderId]);

        inspectors.push({ id: entry.id, name, role, certificates });
      }
    }

    return inspectors;
  }

  private async scanFolderRecursive(folderId: string, certificates: Map<string, Certificate>, codeRemap?: Record<string, string>): Promise<void> {
    const children = await this.listChildren(folderId);

    for (const entry of children) {
      if (!entry.name) continue;

      if (entry.mimeType === FOLDER_MIME) {
        if (entry.name.toLowerCase().includes('obsoleto') || !entry.id) continue;
        await this.scanFolderRecursive(entry.id, certificates, codeRemap);
        continue;
      }

      const filename = entry.name;
      let code = parseDocCode(filename);
      if (!code) continue;
      if (codeRemap && codeRemap[code]) code = codeRemap[code];

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
