import { drive_v3, google } from 'googleapis'
import type { OAuth2Client } from 'googleapis-common'
import pdfParse from 'pdf-parse'
import { Certificate, Inspector } from '../../domain/models/Certificate.js'
import { CertificateClassifier } from '../../domain/services/CertificateClassifier.js'
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js'
import {
  InspectedDocumentResult,
  PDFContentInspector,
} from '../../domain/services/PDFContentInspector.js'
import { IDocumentProvider } from '../../ports/IDocumentProvider.js'
import { PDFContentCache } from './PDFContentCache.js'
import {
  calculateDocExpiration,
  parseDateFromFilename,
  parseDocCode,
} from './certificateFilenameParser.js'
import { getAuthorizedClient } from './googleAuth.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

const DRONE_ROOT_FOLDER_ID = '1AyOLeSdD5S3fcELziWhT1ORwij3UbPgC' // 03 - Drone Insp. Equipamento
const LPS_SPDA_ROOT_FOLDER_ID = '1Yn9_peIcUruJkfVsDHLbEeHzwyVCqEX3' // 04 - LPS - SPDA

/**
 * Cada pasta de ramo pode ter sua PRÓPRIA numeração de documento — confirmado em 27/08/2026 contra
 * o arquivo oficial "Nomeclatura de Documentos.txt" e validado com 2 pilotos reais (Alison, Kelvin):
 * o ramo DRONE usa uma numeração inteira diferente do catálogo padrão pros códigos 07-16 (ex.:
 * código "11" = Primeiros Socorros no Drone, mas "NR-06 Uso de EPI" no catálogo padrão). LPS-SPDA
 * usa a numeração PADRÃO (validado contra José Marcelo) — só compartilha o remap de Contrato/Aditivo
 * (04/04.1 → 40/40.1) com o Drone, porque as duas pastas têm pilotos PJ com contrato de prestação
 * de serviço.
 */
const BRANCH_CODE_REMAP: Record<string, Record<string, string>> = {
  [DRONE_ROOT_FOLDER_ID]: {
    '04': '40',
    '04.1': '40.1', // Contrato / Aditivo
    '07': '08', // CNH
    '08': '09', // Direção Defensiva
    '09': '10', // NR-01 Integração
    '10': '11', // NR-06 Uso EPI
    '11': '16', // Primeiros Socorros (GWO)
    '14': '18', // NR-18 Integração de EHS
    '15': '19', // NR-23 C. Incêndio (GWO)
    '16': '15', // NR-12
    '16.1': '15.1', // Carta NR-12
  },
  [LPS_SPDA_ROOT_FOLDER_ID]: { '04': '40', '04.1': '40.1' },
}

/**
 * Achado real em 27/08/2026 (caso Felipe Alan Peghin): dentro das pastas de piloto, a subpasta
 * "Outros" (case-insensitive) tem certificados antigos/duplicados com nomenclatura pré-convenção
 * do Drone — um "16 – Primeiros Socorros" de 2023 ali dentro estava sendo lido como se fosse o
 * documento válido (mesmo código, catálogo padrão), gerando um VENCIDO falso por cima do
 * certificado real de 2025 (que está em "02.Treinamentos", código "11" na convenção do Drone).
 * "Outros" não é "Obsoletos" — passava pelo filtro de exclusão existente sem ser pego. Só
 * excluído nos ramos onde essa pasta lixo foi confirmada (Drone/LPS-SPDA); não assumido pra
 * outros ramos sem verificar.
 */
const BRANCH_EXCLUDED_FOLDER_NAMES: Record<string, string[]> = {
  [DRONE_ROOT_FOLDER_ID]: ['outros'],
  [LPS_SPDA_ROOT_FOLDER_ID]: ['outros'],
}

export class GoogleDriveOAuthAdapter implements IDocumentProvider {
  private rootFolderIds: string[]
  private refDate: Date
  private authClient: OAuth2Client | null = null
  private drive: drive_v3.Drive | null = null

  /**
   * Aceita uma ou várias pastas raiz — o Drive real tem uma pasta separada por ramo hierárquico
   * (01 - Inspetores/Técnicos, 02 - Líderes & EHS, 03 - Drone Insp. Equipamento, 04 - LPS-SPDA),
   * confirmado com o usuário em 27/08/2026. Cada pasta é escaneada e os inspetores são mesclados.
   */
  constructor(rootFolderId: string | string[], refDate: Date = new Date()) {
    this.rootFolderIds = Array.isArray(rootFolderId)
      ? rootFolderId
      : rootFolderId
          .split(',')
          .map(id => id.trim())
          .filter(Boolean)
    this.refDate = refDate
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (this.drive) return this.drive
    this.authClient = await getAuthorizedClient()
    this.drive = google.drive({ version: 'v3', auth: this.authClient })
    return this.drive
  }

  private async listChildren(
    folderId: string
  ): Promise<drive_v3.Schema$File[]> {
    const drive = await this.getDrive()
    const files: drive_v3.Schema$File[] = []
    let pageToken: string | undefined

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)',
        pageSize: 1000,
        pageToken,
      })
      files.push(...(res.data.files || []))
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)

    return files
  }

  async getInspectors(filterNames?: string[]): Promise<Inspector[]> {
    const inspectors: Inspector[] = []

    for (const rootFolderId of this.rootFolderIds) {
      const topLevel = await this.listChildren(rootFolderId)

      for (const entry of topLevel) {
        if (entry.mimeType !== FOLDER_MIME || !entry.id || !entry.name) continue

        const folderName = entry.name
        if (folderName.toLowerCase().includes('obsoleto')) continue
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
        await this.scanFolderRecursive(
          entry.id,
          certificates,
          BRANCH_CODE_REMAP[rootFolderId],
          BRANCH_EXCLUDED_FOLDER_NAMES[rootFolderId]
        )

        inspectors.push({ id: entry.id, name, role, certificates })
      }
    }

    // Persiste cache atualizado de PDFs lidos em disco
    PDFContentCache.getInstance().save()

    return inspectors
  }

  private async scanFolderRecursive(
    folderId: string,
    certificates: Map<string, Certificate>,
    codeRemap?: Record<string, string>,
    excludedFolderNames?: string[]
  ): Promise<void> {
    const children = await this.listChildren(folderId)

    for (const entry of children) {
      if (!entry.name) continue

      if (entry.mimeType === FOLDER_MIME) {
        const lowerName = entry.name.toLowerCase()
        if (lowerName.includes('obsoleto') || !entry.id) continue
        if (excludedFolderNames?.some(excluded => lowerName.includes(excluded)))
          continue
        await this.scanFolderRecursive(
          entry.id,
          certificates,
          codeRemap,
          excludedFolderNames
        )
        continue
      }

      const filename = entry.name
      const isPdf =
        filename.toLowerCase().endsWith('.pdf') ||
        entry.mimeType === 'application/pdf'

      let inspected: InspectedDocumentResult

      if (isPdf && entry.id) {
        const cache = PDFContentCache.getInstance()
        const cached = cache.get(entry.id, entry.modifiedTime || undefined)

        if (cached) {
          inspected = {
            code: cached.code,
            issueDate: cached.issueDate
              ? new Date(cached.issueDate)
              : undefined,
            expirationDate: cached.expirationDate
              ? new Date(cached.expirationDate)
              : undefined,
            statusEHS: cached.statusEHS,
            statusDetail: cached.statusDetail,
            source: cached.source,
            classificationSource: cached.classificationSource,
            matchedTerm: cached.matchedTerm,
            extractedClause: cached.extractedClause,
          }
        } else {
          let pdfText = ''
          try {
            const drive = await this.getDrive()
            const res = await drive.files.get(
              { fileId: entry.id, alt: 'media' },
              { responseType: 'arraybuffer' }
            )
            const parsed = await pdfParse(Buffer.from(res.data as ArrayBuffer))
            pdfText = parsed.text || ''
          } catch (err: any) {
            console.warn(
              `[GoogleDriveOAuthAdapter] Falha ao extrair texto do PDF ${filename} (${entry.id}):`,
              err?.message || err
            )
          }

          inspected = PDFContentInspector.inspect(
            filename,
            pdfText,
            this.refDate
          )

          cache.set({
            fileId: entry.id,
            filename,
            modifiedTime: entry.modifiedTime || undefined,
            code: inspected.code,
            issueDate: inspected.issueDate?.toISOString(),
            expirationDate: inspected.expirationDate?.toISOString(),
            statusEHS: inspected.statusEHS,
            statusDetail: inspected.statusDetail,
            source: inspected.source,
            classificationSource: inspected.classificationSource,
            matchedTerm: inspected.matchedTerm,
            extractedClause: inspected.extractedClause,
          })
        }
      } else {
        const classification = CertificateClassifier.classify(filename)
        const parsedDate = parseDateFromFilename(filename)
        const expirationDate = classification.code
          ? calculateDocExpiration(
              classification.code,
              parsedDate,
              this.refDate
            )
          : undefined
        const evalResult = EHSEvaluator.evaluateDate(
          expirationDate,
          this.refDate
        )

        inspected = {
          code: classification.code,
          issueDate: parsedDate || undefined,
          expirationDate,
          statusEHS: evalResult.status,
          statusDetail: evalResult.detail,
          source: 'FILENAME',
          classificationSource: classification.source,
          matchedTerm: classification.matchedTerm,
        }
      }

      let code = inspected.code
      if (!code) continue

      if (
        inspected.classificationSource !== 'SEMANTIC' &&
        codeRemap &&
        codeRemap[code]
      ) {
        code = codeRemap[code]
      }

      const cert: Certificate = {
        code,
        name: `Doc ${code}`,
        filename,
        issueDate: inspected.issueDate,
        expirationDate: inspected.expirationDate,
        statusEHS: inspected.statusEHS as any,
        statusDetail: inspected.statusDetail,
        sourcePath: entry.id
          ? `https://drive.google.com/file/d/${entry.id}/view`
          : undefined,
      }

      const existing = certificates.get(code)
      if (
        !existing ||
        (inspected.expirationDate &&
          (!existing.expirationDate ||
            inspected.expirationDate > existing.expirationDate))
      ) {
        certificates.set(code, cert)
      }
    }
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    const inspectors = await this.getInspectors()
    return inspectors.find(i => i.id === id) || null
  }
}
