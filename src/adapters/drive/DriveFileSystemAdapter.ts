import fs from 'fs';
import path from 'path';
import { IDocumentProvider } from '../../ports/IDocumentProvider.js';
import { Inspector, Certificate } from '../../domain/models/Certificate.js';
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';
import { parseDateFromFilename, parseDocCode, calculateDocExpiration } from './certificateFilenameParser.js';

export class DriveFileSystemAdapter implements IDocumentProvider {
  private baseDir: string;
  private refDate: Date;

  constructor(baseDir: string, refDate: Date = new Date()) {
    this.baseDir = baseDir;
    this.refDate = refDate;
  }

  async getInspectors(filterNames?: string[]): Promise<Inspector[]> {
    const inspectors: Inspector[] = [];

    if (!fs.existsSync(this.baseDir)) {
      console.warn(`[DriveFileSystemAdapter] Diretório não encontrado: ${this.baseDir}`);
      return inspectors;
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const folderName = entry.name;

      if (filterNames && filterNames.length > 0) {
        const matchesFilter = filterNames.some((fname) =>
          folderName.toUpperCase().includes(fname.toUpperCase())
        );
        if (!matchesFilter) continue;
      }

      const nameParts = folderName.split('-');
      const name = nameParts[0].trim();
      const role = nameParts.length > 1 ? nameParts[1].trim() : 'TÉCNICO / INSPETOR';

      const certificates = new Map<string, Certificate>();
      const inspectorDir = path.join(this.baseDir, folderName);

      this.scanDirectoryRecursive(inspectorDir, certificates);

      inspectors.push({
        id: folderName,
        name,
        role,
        certificates
      });
    }

    return inspectors;
  }

  private scanDirectoryRecursive(dirPath: string, certificates: Map<string, Certificate>): void {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().includes('obsoleto')) continue;
        this.scanDirectoryRecursive(fullPath, certificates);
      } else if (entry.isFile()) {
        const filename = entry.name;
        const code = parseDocCode(filename);

        if (code) {
          const parsedDate = parseDateFromFilename(filename);
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
            sourcePath: fullPath
          };

          if (!certificates.has(code) || (expirationDate && (!certificates.get(code)?.expirationDate || expirationDate > certificates.get(code)!.expirationDate!))) {
            certificates.set(code, cert);
          }
        }
      }
    }
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    const inspectors = await this.getInspectors([id]);
    return inspectors[0] || null;
  }
}
