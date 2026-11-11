import { Auth, drive_v3, google } from 'googleapis'
type OAuth2Client = Auth.OAuth2Client
import pdfParse from 'pdf-parse'
import {
  Certificate,
  EHSStatus,
  Inspector,
} from '../../domain/models/Certificate.js'
import { CertificateClassifier } from '../../domain/services/CertificateClassifier.js'
import {
  InspectedDocumentResult,
  PDFContentInspector,
  createPdfPageCollector,
  filenameDivergences,
  outranks,
  readSourceOf,
} from '../../domain/services/PDFContentInspector.js'
import { IDocumentProvider } from '../../ports/IDocumentProvider.js'
import {
  OcrUnavailableError,
  TesseractOcrAdapter,
} from '../ocr/TesseractOcrAdapter.js'
import {
  CONTENT_EXTRACTOR_VERSION,
  CONTRACT_EXTRACTOR_VERSION,
  PDFContentCache,
  SIGNATURE_DATE_EXTRACTOR_VERSION,
} from './PDFContentCache.js'
import { parseDateFromFilename } from './certificateFilenameParser.js'
import { getAuthorizedClient } from './googleAuth.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

const MIN_TEXT_CHARS = 50

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes('%PDF-')
}

export function isImageBuffer(buffer: Buffer): boolean {
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8
  const png = buffer.subarray(0, 4).toString('hex') === '89504e47'
  return jpeg || png
}

const DRONE_ROOT_FOLDER_ID = '1xqXRRSN0Tapg_ACW9-kJhE0qRi4m_lZa' // 03 - Drone Insp. Equipamento
const LPS_SPDA_ROOT_FOLDER_ID = '13Ot7fK8gotTYlLAZm0V9WtGbG0aRiBSI' // 04 - LPS - SPDA

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
          'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, md5Checksum, size)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
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
        if (/obsolet|obesoleto|0bsoleto|^00\./i.test(folderName.trim()))
          continue
        if (filterNames && filterNames.length > 0) {
          const matchesFilter = filterNames.some(fname =>
            folderName.toUpperCase().includes(fname.toUpperCase())
          )
          if (!matchesFilter) continue
        }

        const nameParts = folderName.split(/[-–—_]/)
        const name = nameParts[0].trim()
        const role =
          nameParts.length > 1 && nameParts.slice(1).join(' - ').trim()
            ? nameParts.slice(1).join(' - ').trim()
            : 'TÉCNICO / INSPETOR'

        const certificates = new Map<string, Certificate>()
        await this.scanFolderRecursive(
          entry.id,
          certificates,
          BRANCH_CODE_REMAP[rootFolderId],
          BRANCH_EXCLUDED_FOLDER_NAMES[rootFolderId]
        )

        inspectors.push({
          id: entry.id,
          name,
          role,
          certificates,
          driveFolderId: entry.id,
          driveFolderUrl: `https://drive.google.com/drive/folders/${entry.id}`,
        })
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
        const lowerName = entry.name.toLowerCase().trim()
        if (/obsolet|obesoleto|0bsoleto|^00\./i.test(lowerName) || !entry.id)
          continue
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

      if (!entry.id) continue
      const filename = entry.name
      const inspectedList = await this.inspectFile(entry)
      const filenameCode = CertificateClassifier.classify(filename).code
      const filenameDate = parseDateFromFilename(filename)

      for (const inspected of inspectedList) {
        let code = inspected.code
        if (!code) continue

        if (
          inspected.classificationSource !== 'SEMANTIC' &&
          codeRemap &&
          codeRemap[code]
        ) {
          code = codeRemap[code]
        }

        const readSource = readSourceOf(inspected)
        const cert: Certificate = {
          code,
          name: `Doc ${code}`,
          filename,
          issueDate: inspected.issueDate,
          expirationDate: inspected.expirationDate,
          statusEHS: inspected.statusEHS as EHSStatus,
          statusDetail: inspected.statusDetail,
          sourcePath: `https://drive.google.com/file/d/${entry.id}/view`,
          readSource,
          divergences: filenameDivergences(
            inspected,
            filenameCode,
            filenameDate
          ),
        }

        const existing = certificates.get(code)
        if (!existing || outranks(cert, existing)) certificates.set(code, cert)
      }
    }
  }

  private async inspectFile(
    entry: drive_v3.Schema$File
  ): Promise<InspectedDocumentResult[]> {
    const filename = entry.name as string
    const fileId = entry.id as string
    const mime = entry.mimeType || ''
    const cache = PDFContentCache.getInstance()
    const md5 = entry.md5Checksum || undefined

    if (mime.startsWith('application/vnd.google-apps')) {
      return [
        PDFContentInspector.notReadResult(
          filename,
          CertificateClassifier.classify(filename),
          'é um documento nativo do Google (Docs/Planilhas), não o PDF do documento'
        ),
      ]
    }

    const cached = cache.get(fileId, entry.modifiedTime || undefined, md5)
    if (cached && (cached.ev ?? 0) >= CONTENT_EXTRACTOR_VERSION) {
      return cache.getAllDocuments(cached).map(doc => ({
        code: doc.code,
        issueDate: doc.issueDate ? new Date(doc.issueDate) : undefined,
        expirationDate: doc.expirationDate
          ? new Date(doc.expirationDate)
          : undefined,
        statusEHS: doc.statusEHS,
        statusDetail: doc.statusDetail,
        source: doc.source,
        classificationSource: doc.classificationSource,
        matchedTerm: doc.matchedTerm,
        extractedClause: doc.extractedClause,
      }))
    }

    let buffer: Buffer
    try {
      const drive = await this.getDrive()
      const res = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      )
      buffer = Buffer.from(res.data as ArrayBuffer)
    } catch (err: any) {
      return [
        PDFContentInspector.notReadResult(
          filename,
          CertificateClassifier.classify(filename),
          `o download do arquivo falhou (${err?.message || err})`
        ),
      ]
    }

    let pages: string[] = []
    let ocrUsed = false
    try {
      if (isPdfBuffer(buffer)) {
        const collector = createPdfPageCollector()
        await pdfParse(buffer, { pagerender: collector.pagerender })
        pages = collector.pages
        if (pages.join('').replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
          pages = await TesseractOcrAdapter.extractTextFromScannedPdf(buffer)
          ocrUsed = true
        }
      } else if (isImageBuffer(buffer)) {
        pages = [await TesseractOcrAdapter.extractTextFromImage(buffer)]
        ocrUsed = true
      } else {
        return [
          PDFContentInspector.notReadResult(
            filename,
            CertificateClassifier.classify(filename),
            `o arquivo não é PDF nem imagem (tipo ${mime || 'desconhecido'})`
          ),
        ]
      }
    } catch (err: any) {
      if (err instanceof OcrUnavailableError) throw err
      return [
        PDFContentInspector.notReadResult(
          filename,
          CertificateClassifier.classify(filename),
          `o arquivo está corrompido ou protegido (${err?.message || err})`
        ),
      ]
    }

    const inspectedList = PDFContentInspector.inspectPages(
      filename,
      pages,
      this.refDate
    ).map(item =>
      ocrUsed && item.source === 'PDF_CONTENT'
        ? { ...item, source: 'IMAGE_FALLBACK' as const }
        : item
    )

    const primaryDoc =
      [...inspectedList].sort((a, b) => {
        if (a.code === '40.1' && b.code === '40') return -1
        if (b.code === '40.1' && a.code === '40') return 1
        return (
          (b.expirationDate?.getTime() ?? 0) -
          (a.expirationDate?.getTime() ?? 0)
        )
      })[0] || inspectedList[0]

    cache.set({
      fileId,
      filename,
      v: 2,
      cv: CONTRACT_EXTRACTOR_VERSION,
      sv: SIGNATURE_DATE_EXTRACTOR_VERSION,
      ev: CONTENT_EXTRACTOR_VERSION,
      md5,
      modifiedTime: entry.modifiedTime || undefined,
      code: primaryDoc?.code || null,
      issueDate: primaryDoc?.issueDate?.toISOString(),
      expirationDate: primaryDoc?.expirationDate?.toISOString(),
      statusEHS: primaryDoc?.statusEHS || 'NAO_LIDO',
      statusDetail: primaryDoc?.statusDetail || '',
      source: primaryDoc?.source || 'FILENAME',
      classificationSource: primaryDoc?.classificationSource,
      matchedTerm: primaryDoc?.matchedTerm,
      extractedClause: primaryDoc?.extractedClause,
      documents: inspectedList.map(item => ({
        code: item.code,
        issueDate: item.issueDate?.toISOString(),
        expirationDate: item.expirationDate?.toISOString(),
        statusEHS: item.statusEHS,
        statusDetail: item.statusDetail,
        source: item.source,
        classificationSource: item.classificationSource,
        matchedTerm: item.matchedTerm,
        extractedClause: item.extractedClause,
      })),
    })
    return inspectedList
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    const inspectors = await this.getInspectors()
    return inspectors.find(i => i.id === id) || null
  }
}
