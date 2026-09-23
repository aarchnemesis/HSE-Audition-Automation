import fs from 'fs'
import path from 'path'

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
