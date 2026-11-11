import { describe, expect, it } from 'vitest'
import {
  CensusCollaborator,
  analyzeCollaborator,
  classifyBand,
  flagFile,
  isObsoletePath,
  summarize,
} from './DriveCensusAnalyzer.js'

const REF = new Date('2026-11-10T12:00:00.000Z')

const file = (
  name: string,
  extra: Partial<CensusCollaborator['files'][0]> = {}
) => ({
  id: name,
  name,
  path: [],
  mimeType: 'application/pdf',
  size: 1000,
  ...extra,
})

describe('classifyBand', () => {
  const at = (days: number) => new Date(REF.getTime() + days * 86_400_000)
  it('treats the exact day corte+60 as BLOQUEADO', () => {
    expect(classifyBand(at(60), REF)).toBe('BLOQUEADO')
    expect(classifyBand(at(61), REF)).toBe('PROGRAMAR')
    expect(classifyBand(at(90), REF)).toBe('PROGRAMAR')
    expect(classifyBand(at(91), REF)).toBe('VALIDO')
    expect(classifyBand(at(-1), REF)).toBe('VENCIDO')
  })
})

describe('isObsoletePath', () => {
  it('detects obsolete folders at any depth and spelling', () => {
    expect(isObsoletePath(['02. Treinamentos', 'Obsoletos'])).toBe(true)
    expect(isObsoletePath(['00_OBSOLETOS'])).toBe(true)
    expect(isObsoletePath(['03_TREINAMENTOS'])).toBe(false)
  })
})

describe('flagFile', () => {
  it('flags empty, double-extension and copy files', () => {
    expect(
      flagFile(file('01 - ASO - 01.01.2026 - A.pdf', { size: 0 }), REF)
    ).toContain('ZERO_BYTES')
    expect(flagFile(file('01 - ASO - 01.01.2026 - A.pdf.pdf'), REF)).toContain(
      'DOUBLE_EXTENSION'
    )
    expect(flagFile(file('01 - ASO - 01.01.2026 - A (1).pdf'), REF)).toContain(
      'COPY_SUFFIX'
    )
  })

  it('flags future dates and missing dates', () => {
    expect(flagFile(file('01 - ASO - 23.09.2027 - A.pdf'), REF)).toContain(
      'FUTURE_DATE'
    )
    expect(flagFile(file('01 - ASO - SEM_DATA - A.pdf'), REF)).toContain(
      'NO_DATE'
    )
  })

  it('accepts the Book naming pattern', () => {
    const f = file(
      '21_NR35-RECICLAGEM_EMI-2026-07-06_VAL-2028-07-06_ADRIANO-CIRILO-GARCIA-LIMA.pdf'
    )
    expect(flagFile(f, REF)).not.toContain('NON_STANDARD_NAME')
  })
})

describe('analyzeCollaborator + summarize', () => {
  const collab = (
    name: string,
    files: CensusCollaborator['files']
  ): CensusCollaborator => ({
    branch: '01',
    name,
    folderId: name,
    files,
    folders: [],
  })

  it('computes ASO band from the latest current ASO, ignoring obsolete ones', () => {
    const a = analyzeCollaborator(
      collab('A', [
        file('01 - ASO - 01.03.2026 - A.pdf'),
        file('01 - ASO - 01.01.2024 - A.pdf', { path: ['Obsoletos'] }),
      ]),
      REF
    )
    expect(a.aso.band).toBe('VALIDO')
    expect(a.obsoleteFileCount).toBe(1)
  })

  it('reports ASO AUSENTE and missing core codes', () => {
    const a = analyzeCollaborator(collab('B', []), REF)
    expect(a.aso.band).toBe('AUSENTE')
    expect(a.missingCoreCodes).toContain('01')
  })

  it('detects identical files shared by different collaborators', () => {
    const x = analyzeCollaborator(
      collab('X', [file('01 - ASO - 01.03.2026 - X.pdf', { md5: 'h1' })]),
      REF
    )
    const y = analyzeCollaborator(
      collab('Y', [file('01 - ASO - 01.03.2026 - Y.pdf', { md5: 'h1' })]),
      REF
    )
    const s = summarize([x, y], REF)
    expect(s.crossCollaboratorDuplicates).toEqual([
      { md5: 'h1', owners: ['X', 'Y'] },
    ])
    expect(s.asoBands.VALIDO).toBe(2)
  })
})
