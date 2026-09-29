import { describe, expect, it } from 'vitest'
import { Inspector, ParkRequirement } from '../models/Certificate.js'
import {
  ComplianceEngine,
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

  it('classifica treinamentos Vestas e de Elevador estritamente como ONLINE/remotos', () => {
    expect(getTrainingModality('25')).toBe('ONLINE') // SIT (Vestas)
    expect(getTrainingModality('26')).toBe('ONLINE') // ESO (Vestas)
    expect(getTrainingModality('31')).toBe('ONLINE') // Elevador (JASO)
    expect(getTrainingModality('99', 'Treinamento SIT Vestas')).toBe('ONLINE')
    expect(getTrainingModality('99', 'Treinamento ESO Vestas')).toBe('ONLINE')
    expect(getTrainingModality('99', 'Elevador (JASO)')).toBe('ONLINE')
    expect(getTrainingModality('99', 'Operador de Elevador Cremalheira')).toBe(
      'ONLINE'
    )
    expect(getTrainingModality('99', 'Operador de Elevador JASO')).toBe(
      'ONLINE'
    )
  })
})

describe('ComplianceEngine.evaluateInspectorForPark', () => {
  it('trata CIPA (34) vencida como histórico de gestão anterior (CONFORME) e mantém APTO', () => {
    const refDate = new Date(2026, 7, 19)
    const park: ParkRequirement = {
      id: 'p-cipa',
      parkName: 'Parque Administrativo',
      clientName: 'Cliente Teste',
      description: '',
      requiredDocCodes: ['01', '34'],
    }
    const inspector: Inspector = {
      id: '1',
      name: 'FULANO DA CIPA',
      role: 'ADMINISTRATIVO',
      certificates: new Map([
        [
          '01',
          {
            code: '01',
            name: 'ASO',
            expirationDate: new Date(2028, 0, 1),
            statusEHS: 'CONFORME',
            modality: 'PRESENCIAL',
          },
        ],
        [
          '34',
          {
            code: '34',
            name: 'CIPA',
            expirationDate: new Date(2025, 0, 1), // Vencido em relação a refDate
            statusEHS: 'CONFORME',
            modality: 'ONLINE',
          },
        ],
      ]),
    }

    const result = ComplianceEngine.evaluateInspectorForPark(
      inspector,
      park,
      refDate
    )
    const cipaDoc = result.docDetails.find(d => d.code === '34')
    expect(cipaDoc?.status).toBe('CONFORME')
    expect(cipaDoc?.detail).toContain('Histórico CIPA (Gestão anterior)')
    expect(result.overallStatus).toBe('APTO')
    expect(result.expiredDocsCount).toBe(0)
    expect(result.validDocsCount).toBe(2)
  })
})
