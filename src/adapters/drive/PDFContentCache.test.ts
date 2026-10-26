import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTRACT_EXTRACTOR_VERSION,
  CachedPDFEntry,
  PDFContentCache,
  SIGNATURE_DATE_EXTRACTOR_VERSION,
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

describe('PDFContentCache — versão da extração de data de emissão', () => {
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

  it('descarta entrada cuja data veio do log do Clicksign (sem sv)', () => {
    const cache = load([
      entry({
        fileId: 'a',
        code: '16',
        extractedClause: 'Assinou em 26 nov 2024',
      }),
      entry({
        fileId: 'b',
        code: '16',
        extractedClause: 'Log gerado em 26 de novembro de 2024',
      }),
    ])
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBeNull()
  })

  it('descarta entrada cuja data veio da assinatura de cidade', () => {
    const cache = load([
      entry({
        fileId: 'c',
        code: '12',
        extractedClause: 'Sorocaba, 26 de novembro de 2024',
      }),
    ])
    expect(cache.get('c')).toBeNull()
  })

  it('descarta quando a assinatura está em um dos documentos do PDF', () => {
    const cache = load([
      entry({
        fileId: 'd',
        code: '16',
        extractedClause:
          'no período de 31 de Outubro de 2024 a 8 de Novembro de 2024',
        documents: [
          {
            code: '17',
            statusEHS: 'CONFORME',
            statusDetail: '',
            source: 'PDF_CONTENT',
            extractedClause: 'Assinou em 26 nov 2024',
          },
        ],
      }),
    ])
    expect(cache.get('d')).toBeNull()
  })

  it('mantém entrada de assinatura já extraída pela versão atual', () => {
    const cache = load([
      entry({
        fileId: 'e',
        code: '16',
        extractedClause: 'Assinou em 26 nov 2024',
        sv: SIGNATURE_DATE_EXTRACTOR_VERSION,
      }),
    ])
    expect(cache.get('e')?.code).toBe('16')
  })

  it('mantém entrada cuja data veio de início explícito no texto', () => {
    const cache = load([
      entry({
        fileId: 'f',
        code: '12',
        extractedClause:
          'no período de 31 de Outubro de 2024 a 8 de Novembro de 2024',
      }),
    ])
    expect(cache.get('f')?.code).toBe('12')
  })
})
