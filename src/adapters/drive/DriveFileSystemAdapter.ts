import fs from 'fs'
import path from 'path'
import pdfParse from 'pdf-parse'
import { Certificate, Inspector } from '../../domain/models/Certificate.js'
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js'
import { PDFContentInspector } from '../../domain/services/PDFContentInspector.js'
import { IDocumentProvider } from '../../ports/IDocumentProvider.js'
import {
  calculateDocExpiration,
  parseDateFromFilename,
  parseDocCode,
} from './certificateFilenameParser.js'

export class DriveFileSystemAdapter implements IDocumentProvider {
  private baseDir: string
  private refDate: Date

  constructor(baseDir: string, refDate: Date = new Date()) {
    this.baseDir = baseDir
    this.refDate = refDate
  }

  async getInspectors(filterNames?: string[]): Promise<Inspector[]> {
    const inspectors: Inspector[] = []

    if (!fs.existsSync(this.baseDir)) {
      console.warn(
        `[DriveFileSystemAdapter] Diretório não encontrado: ${this.baseDir}`
      )
      return inspectors
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const folderName = entry.name

      if (filterNames && filterNames.length > 0) {
        const matchesFilter = filterNames.some(fname =>
          folderName.toUpperCase().includes(fname.toUpperCase())
        )
        if (!matchesFilter) continue
      }

      const nameParts = folderName.split('-')
      const name = nameParts[0].trim()
      const role =
        nameParts.length > 1 ? nameParts[1].trim() : 'TÉCNICO / INSPETOR'

      const certificates = new Map<string, Certificate>()
      const inspectorDir = path.join(this.baseDir, folderName)

      await this.scanDirectoryRecursive(inspectorDir, certificates)

      inspectors.push({
        id: folderName,
        name,
        role,
        certificates,
      })
    }

    return inspectors
  }

  private async scanDirectoryRecursive(
    dirPath: string,
    certificates: Map<string, Certificate>
  ): Promise<void> {
    if (!fs.existsSync(dirPath)) return
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().includes('obsoleto')) continue
        await this.scanDirectoryRecursive(fullPath, certificates)
      } else if (entry.isFile()) {
        const filename = entry.name
        const isPdf = filename.toLowerCase().endsWith('.pdf')

        let pdfText = ''
        if (isPdf) {
          try {
            const buffer = fs.readFileSync(fullPath)
            const parsed = await pdfParse(buffer)
            pdfText = parsed.text || ''
          } catch (err: any) {
            console.warn(
              `[DriveFileSystemAdapter] Falha ao extrair texto do PDF ${filename}:`,
              err?.message || err
            )
          }
        }

        const inspected = PDFContentInspector.inspect(
          filename,
          isPdf ? pdfText : undefined,
          this.refDate
        )

        const code = inspected.code
        if (code) {
          const cert: Certificate = {
            code,
            name: `Doc ${code}`,
            filename,
            issueDate: inspected.issueDate,
            expirationDate: inspected.expirationDate,
            statusEHS: inspected.statusEHS as any,
            statusDetail: inspected.statusDetail,
            sourcePath: fullPath,
          }

          if (
            !certificates.has(code) ||
            (inspected.expirationDate &&
              (!certificates.get(code)?.expirationDate ||
                inspected.expirationDate >
                  certificates.get(code)!.expirationDate!))
          ) {
            certificates.set(code, cert)
          }
        }
      }
    }
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    const inspectors = await this.getInspectors([id])
    return inspectors[0] || null
  }
}
