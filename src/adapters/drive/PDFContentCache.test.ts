import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTRACT_EXTRACTOR_VERSION,
  CachedPDFEntry,
  PDFContentCache,
} from './PDFContentCache.js'

function entry(overrides: Partial<CachedPDFEntry>): CachedPDFEntry {
  return {
    fileId: 'f1',
    filename: 'arquivo.pdf',
    modifiedTime: '2026-01-01T00:00:00.000Z',
    code: '01',
    statusEHS: 'CONFORME',
    statusDetail: '',
    source: 'PDF_CONTENT',
    v: 2,
    ...overrides,
  }
}

describe('PDFContentCache — versão da extração de contrato', () => {
  let dataDir: string
  let scratchDir: string

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cache-data-'))
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cache-scratch-'))
    ;(PDFContentCache as any).instance = null
  })

  afterEach(() => {
    ;(PDFContentCache as any).instance = null
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(scratchDir, { recursive: true, force: true })
  })

  function load(entries: CachedPDFEntry[]): PDFContentCache {
    fs.writeFileSync(
      path.join(dataDir, 'pdf_content_cache.json'),
      JSON.stringify(entries)
    )
    return PDFContentCache.getInstance(dataDir, scratchDir)
  }

  it('descarta contrato extraído por versão anterior (sem cv) para re-inspecionar', () => {
    const cache = load([
      entry({
        fileId: 'contrato',
        code: '40',
        filename: '40 - Contrato PJ - 11.05.2027.pdf',
      }),
    ])
    expect(cache.get('contrato')).toBeNull()
  })

  it('reconhece contrato pelo código de um dos documentos da página ou pelo nome do arquivo', () => {
    const cache = load([
      entry({
        fileId: 'por-pagina',
        code: '32',
        documents: [
          {
            code: '32',
            statusEHS: 'CONFORME',
            statusDetail: '',
            source: 'PDF_CONTENT',
          },
          {
            code: '04.1',
            statusEHS: 'CONFORME',
            statusDetail: '',
            source: 'PDF_CONTENT',
          },
        ],
      }),
      entry({
        fileId: 'por-nome',
        code: null,
        filename: 'Aditivo ao Contrato - Fulano.pdf',
      }),
    ])
    expect(cache.get('por-pagina')).toBeNull()
    expect(cache.get('por-nome')).toBeNull()
  })

  it('mantém contrato já extraído pela versão atual', () => {
    const cache = load([
      entry({ fileId: 'contrato', code: '40', cv: CONTRACT_EXTRACTOR_VERSION }),
    ])
    expect(cache.get('contrato')?.code).toBe('40')
  })

  it('não mexe em documentos que não são contrato (ASO, GWO v2)', () => {
    const cache = load([
      entry({ fileId: 'aso', code: '01', filename: '01 - ASO - Fulano.pdf' }),
      entry({ fileId: 'gwo', code: '16', filename: '16 - GWO BST.pdf' }),
    ])
    expect(cache.get('aso')?.code).toBe('01')
    expect(cache.get('gwo')?.code).toBe('16')
  })
})
