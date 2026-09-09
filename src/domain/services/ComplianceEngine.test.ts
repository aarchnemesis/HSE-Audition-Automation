import { describe, expect, it } from 'vitest'
import {
  DOC_CATALOG_MAP,
  PRESENCIAL_REQUIRED_DOC_CODES,
  getTrainingModality,
} from './ComplianceEngine.js'

describe('PRESENCIAL_REQUIRED_DOC_CODES', () => {
  it('inclui ASO (01), CNH (08) e NR-35 (21)', () => {
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('01')).toBe(true) // ASO (Saúde Ocupacional - Exame Clínico)
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('08')).toBe(true) // CNH (Documentação Oficial)
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('21')).toBe(true) // NR-35 (Trabalho em Altura)
  })

  it('inclui todas as variações de treinamento GWO do catálogo ("GWO geral")', () => {
    const gwoCodes = Object.entries(DOC_CATALOG_MAP)
      .filter(([, name]) => name.toUpperCase().includes('GWO'))
      .map(([code]) => code)

    expect(gwoCodes.length).toBeGreaterThan(0)
    for (const code of gwoCodes) {
      expect(PRESENCIAL_REQUIRED_DOC_CODES.has(code)).toBe(true)
    }
  })

  it('não inclui treinamentos normativos que são cursados de forma remota/EAD no LMS Storz (ex.: LOTO, NR-10, NR-12, NR-33)', () => {
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('10')).toBe(false) // NR-01
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('11')).toBe(false) // NR-06
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('12')).toBe(false) // NR-10 Básico
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('13')).toBe(false) // NR-10 SEP
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('14')).toBe(false) // NR-11 Talha
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('15')).toBe(false) // NR-12 Máquinas
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('18')).toBe(false) // NR-18 Construção
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('20')).toBe(false) // NR-33 Vigia
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('22')).toBe(false) // LOTO
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('28')).toBe(false) // NR-33 Supervisor
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('34')).toBe(false) // CIPA
  })
})

describe('getTrainingModality', () => {
  it('identifica corretamente treinamentos presenciais por código e por nome', () => {
    expect(getTrainingModality('01')).toBe('PRESENCIAL')
    expect(getTrainingModality('08')).toBe('PRESENCIAL')
    expect(getTrainingModality('21')).toBe('PRESENCIAL')
    expect(getTrainingModality('16')).toBe('PRESENCIAL')
    expect(getTrainingModality('99', 'GWO BST First Aid')).toBe('PRESENCIAL')
    expect(getTrainingModality('99', 'NR-35 Trabalho em Altura')).toBe(
      'PRESENCIAL'
    )
  })

  it('identifica corretamente treinamentos remotos/online por código', () => {
    expect(getTrainingModality('10')).toBe('ONLINE')
    expect(getTrainingModality('12')).toBe('ONLINE')
    expect(getTrainingModality('15')).toBe('ONLINE')
    expect(getTrainingModality('18')).toBe('ONLINE')
    expect(getTrainingModality('20')).toBe('ONLINE')
    expect(getTrainingModality('28')).toBe('ONLINE')
    expect(getTrainingModality('22')).toBe('ONLINE')
  })
})
