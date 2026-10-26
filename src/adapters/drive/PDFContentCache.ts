import fs from 'fs'
import path from 'path'
import { DOC_CATALOG_MAP } from '../../domain/services/ComplianceEngine.js'
import { parseDocCode } from './certificateFilenameParser.js'

/**
 * Versão da extração de datas de Contrato/Aditivo (04, 04.1, 40, 40.1). Subir este número no mesmo
 * commit de qualquer correção na lógica de contrato: no próximo sync, só os PDFs que contêm contrato
 * são baixados e re-inspecionados (~320 em out/2026, muitos são pacotes de admissão com contrato
 * junto), sem precisar apagar entradas do cache na mão.
 * Separado do `v` do GWO porque aquele gate testa `v !== 2` e quebraria com um bump global.
 */
export const CONTRACT_EXTRACTOR_VERSION = 1

/**
 * Versão da extração de data de emissão de certificados. Subir este número no mesmo commit de qualquer
 * correção na prioridade das datas de emissão: no próximo sync, só as entradas cuja data veio de uma
 * assinatura (cidade no rodapé ou log do Clicksign) são baixadas e re-inspecionadas.
 */
export const SIGNATURE_DATE_EXTRACTOR_VERSION = 1

const CONTRACT_CODES = ['04', '04.1', '40', '40.1']

const SIGNATURE_CLAUSE =
  /assinou\s+em|log\s+gerado\s+em|^(?:Fortaleza|Caucaia|Sorocaba|Mossor[oó]|Parnamirim|S[aã]o\s+Paulo|Natal)\b/i

export function getAllowedCodesForFile(
  filename?: string,
  primaryCode?: string | null
): Set<string> | null {
  const fn = (filename || '').toLowerCase()
  const prefix = parseDocCode(filename || '')

  if (
    /\b(?:gwo|bst|winda)\b/i.test(fn) ||
    primaryCode === '16' ||
    prefix === '16'
  ) {
    return new Set(['16', '17', '19', '21', '30', '32'])
  }
  if (
    /\bsep\b/i.test(fn) &&
    (/\bnr-?10\b/i.test(fn) || primaryCode === '12' || prefix === '12')
  ) {
    return new Set(['12', '12.1', '13'])
  }
  if (
    /aditiv/i.test(fn) &&
    (/contrat/i.test(fn) ||
      primaryCode === '40' ||
      primaryCode === '04' ||
      prefix === '04' ||
      prefix === '40')
  ) {
    return new Set(['04', '04.1', '40', '40.1'])
  }
  if (prefix && DOC_CATALOG_MAP[prefix]) {
    const set = new Set([prefix])
    if (prefix === '21') set.add('21.1')
    if (prefix === '21.1') set.add('21')
    if (prefix === '20') set.add('20.1')
    if (prefix === '20.1') set.add('20')
    if (prefix === '15') set.add('15.1')
    if (prefix === '15.1') set.add('15')
    if (prefix === '06') set.add('06.1')
    if (prefix === '06.1') set.add('06')
    if (prefix === '40') set.add('40.1')
    if (prefix === '40.1') set.add('40')
    return set
  }
  if (primaryCode && DOC_CATALOG_MAP[primaryCode]) {
    return new Set([primaryCode])
  }
  return null
}

export function isSignatureDateEntry(entry: CachedPDFEntry): boolean {
  return [
    entry.extractedClause,
    ...(entry.documents || []).map(d => d.extractedClause),
  ].some(clause => SIGNATURE_CLAUSE.test(clause || ''))
}

export function isContractEntry(entry: CachedPDFEntry): boolean {
  return (
    CONTRACT_CODES.includes(entry.code || '') ||
    Boolean(
      entry.documents?.some(d => CONTRACT_CODES.includes(d.code || ''))
    ) ||
    /contrat|aditiv/i.test(entry.filename || '')
  )
}

export interface CachedPDFDocument {
  code: string | null
  issueDate?: string
  expirationDate?: string
  statusEHS: string
  statusDetail: string
  source: 'PDF_CONTENT' | 'FILENAME' | 'IMAGE_FALLBACK'
  classificationSource?: 'SEMANTIC' | 'PREFIX' | 'NONE'
  matchedTerm?: string
  extractedClause?: string
}

export interface CachedPDFEntry {
  fileId: string
  filename: string
  modifiedTime?: string
  code: string | null
  issueDate?: string
  expirationDate?: string
  statusEHS: string
  statusDetail: string
  source: 'PDF_CONTENT' | 'FILENAME' | 'IMAGE_FALLBACK'
  classificationSource?: 'SEMANTIC' | 'PREFIX' | 'NONE'
  matchedTerm?: string
  extractedClause?: string
  /** Lista de múltiplos documentos/normas identificados no mesmo PDF (Fase 2) */
  documents?: CachedPDFDocument[]
  /** Versão do motor de extração */
  v?: number
  /** Versão da extração de contrato (ver CONTRACT_EXTRACTOR_VERSION) */
  cv?: number
  /** Versão da extração de data de emissão (ver SIGNATURE_DATE_EXTRACTOR_VERSION) */
  sv?: number
}

export class PDFContentCache {
  private static instance: PDFContentCache | null = null
  private cache: Map<string, CachedPDFEntry> = new Map()
  private isDirty = false
  private dataDir: string
  private scratchDir: string

  private constructor(
    dataDir: string = path.join(process.cwd(), 'data'),
    scratchDir: string = path.join(process.cwd(), 'scratch')
  ) {
    this.dataDir = dataDir
    this.scratchDir = scratchDir
    this.load()
  }

  static getInstance(dataDir?: string, scratchDir?: string): PDFContentCache {
    if (!PDFContentCache.instance) {
      PDFContentCache.instance = new PDFContentCache(dataDir, scratchDir)
    }
    return PDFContentCache.instance
  }

  load(): void {
    const candidates = [
      path.join(this.dataDir, 'pdf_content_cache.json'),
      path.join(this.scratchDir, 'pdf_content_cache.json'),
    ]

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf-8')
          const entries: CachedPDFEntry[] = JSON.parse(content)
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (entry.fileId) {
                // Invalida o cache de documentos GWO para forçar re-processamento (multi-norma WINDA ID patch)
                // Se for um certificado GWO ('16', '17', '19', '21', '30', '32') e não tiver a flag de versão, ignora
                const isGwo =
                  ['16', '17', '19', '21', '30', '32'].includes(
                    entry.code || ''
                  ) ||
                  (entry.documents &&
                    entry.documents.some(d =>
                      ['16', '17', '19', '21', '30', '32'].includes(
                        d.code || ''
                      )
                    ))

                if (isGwo && (entry as any).v !== 2) {
                  this.isDirty = true // forçará o save sem essas entradas
                  continue
                }

                // Contrato extraído por uma versão anterior da lógica: re-inspeciona no próximo sync
                if (
                  isContractEntry(entry) &&
                  (entry.cv ?? 0) < CONTRACT_EXTRACTOR_VERSION
                ) {
                  this.isDirty = true
                  continue
                }

                // Data de emissão tirada de uma assinatura por uma versão anterior da lógica: re-inspeciona
                if (
                  isSignatureDateEntry(entry) &&
                  (entry.sv ?? 0) < SIGNATURE_DATE_EXTRACTOR_VERSION
                ) {
                  this.isDirty = true
                  continue
                }

                // Saneia entry.documents contra alucinação de normas alheias em páginas secundárias
                const allowed = getAllowedCodesForFile(
                  entry.filename,
                  entry.code
                )
                if (allowed && entry.documents && entry.documents.length > 0) {
                  const filtered = entry.documents.filter(
                    d => d.code && allowed.has(d.code)
                  )
                  if (filtered.length !== entry.documents.length) {
                    entry.documents = filtered.length > 0 ? filtered : undefined
                    this.isDirty = true
                  }
                }
                const prefix = parseDocCode(entry.filename || '')
                if (
                  prefix &&
                  DOC_CATALOG_MAP[prefix] &&
                  prefix !== '16' &&
                  prefix !== '12' &&
                  entry.code !== prefix
                ) {
                  entry.code = prefix
                  this.isDirty = true
                }

                this.cache.set(entry.fileId, entry)
              }
            }
            // Carregado com sucesso
            return
          }
        } catch (err) {
          console.warn(`[PDFContentCache] Erro ao carregar cache de ${p}:`, err)
        }
      }
    }
  }

  get(fileId: string, modifiedTime?: string): CachedPDFEntry | null {
    const entry = this.cache.get(fileId)
    if (!entry) return null

    // Se tivermos modifiedTime para conferir e eles forem diferentes, cache está desatualizado
    if (
      modifiedTime &&
      entry.modifiedTime &&
      entry.modifiedTime !== modifiedTime
    ) {
      return null
    }

    return entry
  }

  /**
   * Retorna todos os documentos associados a esta entrada de cache (seja individual ou lista da Fase 2).
   */
  getAllDocuments(entry: CachedPDFEntry): CachedPDFDocument[] {
    const allowed = getAllowedCodesForFile(entry.filename, entry.code)
    if (entry.documents && entry.documents.length > 0) {
      if (allowed) {
        const filtered = entry.documents.filter(
          d => d.code && allowed.has(d.code)
        )
        if (filtered.length > 0) return filtered
      } else {
        return entry.documents
      }
    }
    return [
      {
        code: entry.code,
        issueDate: entry.issueDate,
        expirationDate: entry.expirationDate,
        statusEHS: entry.statusEHS,
        statusDetail: entry.statusDetail,
        source: entry.source,
        classificationSource: entry.classificationSource,
        matchedTerm: entry.matchedTerm,
        extractedClause: entry.extractedClause,
      },
    ]
  }

  set(entry: CachedPDFEntry): void {
    this.cache.set(entry.fileId, entry)
    this.isDirty = true
  }

  save(): void {
    if (!this.isDirty) return

    const entries = Array.from(this.cache.values())
    const serialized = JSON.stringify(entries, null, 2)

    for (const dir of [this.dataDir, this.scratchDir]) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const targetPath = path.join(dir, 'pdf_content_cache.json')
        const tmpPath = `${targetPath}.tmp`
        fs.writeFileSync(tmpPath, serialized, 'utf-8')
        fs.renameSync(tmpPath, targetPath)
      } catch (err) {
        console.warn(`[PDFContentCache] Erro ao salvar cache em ${dir}:`, err)
      }
    }

    this.isDirty = false
  }

  size(): number {
    return this.cache.size
  }

  clear(): void {
    this.cache.clear()
    this.isDirty = true
  }
}
