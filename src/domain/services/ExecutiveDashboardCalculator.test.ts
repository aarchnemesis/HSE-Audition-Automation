import { describe, expect, it } from 'vitest'
import { calculateExecutiveKPIs } from './ExecutiveDashboardCalculator.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

describe('ExecutiveDashboardCalculator', () => {
  it('retorna KPIs zerados para lista vazia de registros', () => {
    const kpis = calculateExecutiveKPIs([])
    expect(kpis.totalCollaborators).toBe(0)
    expect(kpis.aptosCount).toBe(0)
    expect(kpis.bloqueadosCount).toBe(0)
    expect(kpis.emTreinamentoCount).toBe(0)
    expect(kpis.aptosRate).toBe(100)
  })

  it('classifica colaboradores office (CO, ADM, EHS) como aptos e isentos de escalada', () => {
    const records: HSEDatabaseRecord[] = [
      {
        inspectorId: '1',
        inspectorName: 'Ana Gerente',
        role: 'CO',
        docCode: '01',
        docName: 'ASO',
        modality: 'PRESENCIAL',
        statusEHS: 'CONFORME',
        detail: 'OK',
        lastUpdated: '2026-09-21',
      },
    ]

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.totalCollaborators).toBe(1)
    expect(kpis.aptosCount).toBe(1)
    expect(kpis.bloqueadosCount).toBe(0)
    expect(kpis.aptosRate).toBe(100)
  })

  it('classifica colaborador de campo como bloqueado se faltar requisito core', () => {
    const records: HSEDatabaseRecord[] = [
      {
        inspectorId: '2',
        inspectorName: 'Carlos Tecnico',
        role: 'TO',
        docCode: '01',
        docName: 'ASO',
        modality: 'PRESENCIAL',
        statusEHS: 'CONFORME',
        detail: 'OK',
        lastUpdated: '2026-09-21',
      },
      // Sem os demais requisitos core -> bloqueado
    ]

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.totalCollaborators).toBe(1)
    expect(kpis.aptosCount).toBe(0)
    expect(kpis.bloqueadosCount).toBe(1)
    expect(kpis.aptosRate).toBe(0)
  })

  it('classifica colaborador com todos os requisitos core vigentes como apto', () => {
    const coreCodes = [
      '01',
      '10',
      '11',
      '12',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '30',
    ]
    const records: HSEDatabaseRecord[] = coreCodes.map(code => ({
      inspectorId: '4',
      inspectorName: 'Lucas Especialista',
      role: 'IQ',
      docCode: code,
      docName: `Doc ${code}`,
      modality: 'PRESENCIAL',
      statusEHS: 'CONFORME',
      detail: 'OK',
      lastUpdated: '2026-09-21',
    }))

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.totalCollaborators).toBe(1)
    expect(kpis.aptosCount).toBe(1)
    expect(kpis.bloqueadosCount).toBe(0)
    expect(kpis.aptosRate).toBe(100)
  })

  it('identifica colaboradores com treinamentos ativos na Storz', () => {
    const records: HSEDatabaseRecord[] = [
      {
        inspectorId: '3',
        inspectorName: 'Bruna Inspetora',
        role: 'IQ',
        docCode: '10',
        docName: 'GWO BST Altura',
        modality: 'PRESENCIAL',
        statusEHS: 'STORZ_EM_ANDAMENTO',
        storzState: 'EM ANDAMENTO',
        detail: 'Matricula ativa',
        lastUpdated: '2026-09-21',
      },
    ]

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.emTreinamentoCount).toBe(1)
  })
})
