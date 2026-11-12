import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  applyHolderCheck,
  isImageBuffer,
  isPdfBuffer,
} from '../../adapters/drive/GoogleDriveOAuthAdapter.js'
import {
  CONTENT_EXTRACTOR_VERSION,
  PDFContentCache,
} from '../../adapters/drive/PDFContentCache.js'
import { EHSEvaluator, PERMANENT_DETAIL } from './EHSEvaluator.js'
import {
  PDFContentInspector,
  checkHolder,
  dateAppearsInText,
  filenameDivergences,
  outranks,
  readSourceOf,
} from './PDFContentInspector.js'

const REF = new Date(2026, 10, 11)

describe('checkHolder', () => {
  const roster = ['FULANO DE TAL SOUZA', 'BELTRANO PEREIRA NUNES']
  it('accepts the holder name, with or without accents and spaces', () => {
    expect(
      checkHolder('Certifico que Fulano de Tal Souza', roster[0], roster)
    ).toEqual({ status: 'OK' })
    expect(
      checkHolder('Certifico que FulanodeTalSouza', roster[0], roster)
    ).toEqual({ status: 'OK' })
  })
  it('flags a document that belongs to another collaborator', () => {
    expect(
      checkHolder('Certifico que BELTRANO PEREIRA NUNES', roster[0], roster)
    ).toEqual({ status: 'OUTRA_PESSOA', other: 'BELTRANO PEREIRA NUNES' })
  })
  it('a stronger match of another collaborator beats a weak holder match', () => {
    const team = ['FRANCISCO SILVA LIMA', 'FRANCISCO PEREIRA SILVA NUNES']
    expect(
      checkHolder('Certifico que FRANCISCO PEREIRA SILVA NUNES', team[0], team)
    ).toEqual({ status: 'OUTRA_PESSOA', other: team[1] })
  })
  it('keeps the holder when the full name is printed next to a longer signer name', () => {
    const team = ['WILDEN ALVES FERREIRA', 'LEONARDO SIMON COSTA GAEM']
    expect(
      checkHolder(
        'ASSINATURAS LEONARDO SIMON COSTA GAEM CPF ASSINOU ... WILDEN ALVES FERREIRA CPF ASSINOU',
        team[0],
        team
      )
    ).toEqual({ status: 'OK' })
  })
  it('never blocks a single-word holder as another person', () => {
    expect(
      checkHolder('Certifico que BELTRANO PEREIRA NUNES', 'FULANO', roster)
    ).toEqual({ status: 'NAO_ENCONTRADO' })
  })
  it('reports when no known name is printed', () => {
    expect(checkHolder('Certificado de curso', roster[0], roster)).toEqual({
      status: 'NAO_ENCONTRADO',
    })
  })
  it('turns a read document of another person into a blocking NAO_LIDO', () => {
    const item = applyHolderCheck(
      {
        code: '17',
        statusEHS: 'CONFORME',
        statusDetail: '',
        source: 'PDF_CONTENT',
      },
      '17 - NR-17 - FULANO.pdf',
      { status: 'OUTRA_PESSOA', other: 'BELTRANO PEREIRA NUNES' }
    )
    expect(item.statusEHS).toBe('NAO_LIDO')
    expect(item.statusDetail).toContain('pertence a outra pessoa')
  })
})

describe('course date vs signature date', () => {
  it('uses the printed course date when the extractor picked a later signature log', () => {
    const item = PDFContentInspector.inspectPages(
      '17 - NR - 17 Car. Manual Peso (GWO) - 30.09.26 - FULANO DE TAL',
      [
        'Certificado. Certifico que Fulano de Tal participou do Curso GWO/BST Módulo Manuseio Manual de Cargas no dia 30de Setembro de 2026. Treinamento válido por 02 (Dois) anos.',
        'Conteúdo programático do módulo.',
        'Assinaturas FULANO DE TAL Assinou em 02 out 2026 às 12:23:16',
      ],
      REF
    ).find(i => i.code === '17')
    expect(item?.issueDate?.getDate()).toBe(30)
    expect(item?.issueDate?.getMonth()).toBe(8)
  })
})

describe('CLT contract signed for an indefinite term', () => {
  it('does not expire on the signature date', () => {
    const result = PDFContentInspector.inspect(
      '40 – Contrato de Prestação de Serviço – 05.11.2024 - FULANO DE TAL.pdf',
      'CONTRATO INDIVIDUAL DE TRABALHO firmado por prazo indeterminado. PRAZO DE DURAÇÃO DO CONTRATO CLÁUSULA TERCEIRA – O presente Contrato é válido por tempo indeterminado. Sorocaba, 05 de novembro de 2024. FULANO DE TAL',
      REF
    )
    expect(result.statusEHS).toBe('CONFORME')
    expect(result.expirationDate?.getFullYear()).toBe(2099)
  })
  it('treats a CLT trial contract as ongoing after its 45 days', () => {
    const result = PDFContentInspector.inspect(
      '40 – Contrato de Prestação de Serviço – 24.02.2025 - FULANO DE TAL.pdf',
      'CONTRATO DE EXPERIÊNCIA 1 - O Empregado trabalhará para a Empregadora. O prazo deste contrato é de 45 dias, com inicio em 24/02/2025 e término em 09/04/2025. FULANO DE TAL',
      REF
    )
    expect(result.statusEHS).toBe('CONFORME')
  })
})

describe('permanent documents', () => {
  it('are CONFORME without an expiry date', () => {
    expect(EHSEvaluator.evaluateForCode('05', undefined, REF)).toEqual({
      status: 'CONFORME',
      detail: PERMANENT_DETAIL,
    })
    const result = PDFContentInspector.inspect(
      '04 - CTPS Digital - FULANO DE TAL.pdf',
      'CARTEIRA DE TRABALHO DIGITAL FULANO DE TAL contrato de trabalho admissão registrada',
      REF
    )
    expect(result.expirationDate).toBeUndefined()
  })
})

const NR01_AS_ASO_NAME =
  '01 - NR01 DISPOSIÇÕES GERAIS - 22.11.24 -FULANO DE TAL'
const NR01_TEXT =
  'FULANO DE TAL Concluiu com proficiência o treinamento NR1 - Disposições Gerais e Gerenciamento de Riscos Ocupacionais Concluido em 4 de Novembro a 22 de Novembro de 2024 realizado na empresa Exemplo Treinamentos Ltda. Com carga horária de 04:00 conforme determina legislação aplicável.'

describe('content-first regression: NR-01 saved under the ASO code', () => {
  it('classifies the certificate by content, not by the "01" filename prefix', () => {
    const [result] = PDFContentInspector.inspectPages(
      NR01_AS_ASO_NAME,
      [NR01_TEXT],
      REF
    )
    expect(result.code).toBe('10')
    expect(result.source).toBe('PDF_CONTENT')
  })

  it('reports the filename code divergence instead of applying it', () => {
    const [result] = PDFContentInspector.inspectPages(
      NR01_AS_ASO_NAME,
      [NR01_TEXT],
      REF
    )
    const divergences = filenameDivergences(result, '01', null)
    expect(divergences[0]).toContain('código 01')
    expect(divergences[0]).toContain('conteúdo é 10')
  })

  it('a scanned ASO without readable text is NAO_LIDO and never dated by its name', () => {
    const result = PDFContentInspector.inspect(
      '01 - ASO - 24.09.2025 - FULANO DE TAL.pdf',
      '',
      REF
    )
    expect(result.statusEHS).toBe('NAO_LIDO')
    expect(result.expirationDate).toBeUndefined()
    expect(readSourceOf(result)).toBe('NAO_LIDO')
  })

  it('a scanned ASO read by OCR is dated by the printed date', () => {
    const ocrText =
      'ASO - Atestado de Saúde Ocupacional FULANO DE TAL Periódico Apto para função. Declaro que recebi uma via deste ASO no dia 24/09/25. Exame Clínico 24/09/25'
    const result = PDFContentInspector.inspect(
      '01 - ASO - SEM_DATA - FULANO DE TAL.pdf',
      ocrText,
      REF
    )
    expect(result.code).toBe('01')
    expect(result.issueDate?.getFullYear()).toBe(2025)
    expect(result.issueDate?.getMonth()).toBe(8)
    expect(result.statusEHS).toBe('VENCIDO')
  })
})

describe('outranks', () => {
  const read = (y: number) => ({
    readSource: 'CONTENT',
    expirationDate: new Date(y, 0, 1),
  })
  it('a read document beats an unread one even with an older expiry', () => {
    expect(outranks(read(2020), { readSource: 'NAO_LIDO' })).toBe(true)
    expect(outranks({ readSource: 'NAO_LIDO' }, read(2020))).toBe(false)
  })
  it('among read documents the later expiry wins', () => {
    expect(outranks(read(2028), read(2027))).toBe(true)
    expect(outranks(read(2026), read(2027))).toBe(false)
  })
})

describe('dateAppearsInText', () => {
  const d = new Date(2024, 10, 22)
  it.each([
    '22/11/2024',
    '22.11.24',
    '22-11-2024',
    '2024-11-22',
    '22 de Novembro de 2024',
    '22 de novembro 2024',
  ])('finds %s', text => expect(dateAppearsInText(d, `x ${text} y`)).toBe(true))
  it('does not match a different date', () => {
    expect(dateAppearsInText(d, '23/11/2024 e 122/11/2024')).toBe(false)
  })
})

describe('file type sniffing', () => {
  it('detects PDFs by magic bytes even without extension', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\n...'))).toBe(true)
    expect(isPdfBuffer(Buffer.from('PK\u0003\u0004'))).toBe(false)
  })
  it('detects jpeg and png scans', () => {
    expect(isImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(
      isImageBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    ).toBe(true)
    expect(isImageBuffer(Buffer.from('%PDF-'))).toBe(false)
  })
})

describe('PDFContentCache content-first rules', () => {
  const withCache = (entries: unknown[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse_cache_'))
    fs.writeFileSync(
      path.join(dir, 'pdf_content_cache.json'),
      JSON.stringify(entries)
    )
    ;(PDFContentCache as any).instance = null
    const cache = PDFContentCache.getInstance(dir, dir)
    ;(PDFContentCache as any).instance = null
    return cache
  }
  const base = {
    filename: NR01_AS_ASO_NAME,
    statusEHS: 'CONFORME',
    statusDetail: '',
  }

  it('keeps the content code instead of overwriting it with the filename prefix', () => {
    const cache = withCache([
      {
        ...base,
        fileId: 'a',
        code: '10',
        source: 'PDF_CONTENT',
        ev: CONTENT_EXTRACTOR_VERSION,
      },
    ])
    expect(cache.get('a')?.code).toBe('10')
    expect(cache.getAllDocuments(cache.get('a')!)[0].code).toBe('10')
  })

  it('drops old filename-derived entries so they are re-read', () => {
    const cache = withCache([
      { ...base, fileId: 'b', code: '01', source: 'FILENAME' },
      {
        ...base,
        fileId: 'c',
        code: '10',
        source: 'PDF_CONTENT',
        extractedClause: 'Data do arquivo: x',
      },
    ])
    expect(cache.get('b')).toBeNull()
    expect(cache.get('c')).toBeNull()
  })

  it('re-reads a file whose bytes changed (md5)', () => {
    const cache = withCache([
      {
        ...base,
        fileId: 'd',
        code: '10',
        source: 'PDF_CONTENT',
        md5: 'old',
        ev: CONTENT_EXTRACTOR_VERSION,
      },
    ])
    expect(cache.get('d', undefined, 'new')).toBeNull()
    expect(cache.get('d', undefined, 'old')?.code).toBe('10')
  })
})
