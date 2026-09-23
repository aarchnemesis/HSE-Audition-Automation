import { describe, expect, it } from 'vitest'
import {
  calculateExecutiveKPIs,
  isStorzActive,
} from './ExecutiveDashboardCalculator.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

describe('ExecutiveDashboardCalculator', () => {
  it('retorna KPIs zerados para lista vazia de registros', () => {
    const kpis = calculateExecutiveKPIs([])
    expect(kpis.totalCollaborators).toBe(0)
    expect(kpis.frontline.total).toBe(0)
    expect(kpis.aptosCount).toBe(0)
    expect(kpis.bloqueadosCount).toBe(0)
    expect(kpis.emTreinamentoCount).toBe(0)
  })

  it('classifica colaboradores office (CO, ADM, EHS) como isentos de campo e mantem linha de frente isolada', () => {
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
    expect(kpis.office.total).toBe(1)
    expect(kpis.office.isentoCount).toBe(1)
    expect(kpis.frontline.total).toBe(0)
    expect(kpis.frontline.aptoCount).toBe(0)
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
    ]

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.frontline.total).toBe(1)
    expect(kpis.frontline.aptoCount).toBe(0)
    expect(kpis.frontline.bloqueadoCount).toBe(1)
    expect(kpis.frontline.aptoRate).toBe(0)
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
    expect(kpis.frontline.total).toBe(1)
    expect(kpis.frontline.aptoCount).toBe(1)
    expect(kpis.frontline.bloqueadoCount).toBe(0)
    expect(kpis.frontline.aptoRate).toBe(100)
  })

  it('identifica treinamentos ativos na Storz com EM_ANDAMENTO e SOLICITADO', () => {
    const r1: HSEDatabaseRecord = {
      inspectorId: '3',
      inspectorName: 'Bruna Inspetora',
      role: 'IQ',
      docCode: '10',
      docName: 'GWO BST Altura',
      modality: 'PRESENCIAL',
      statusEHS: 'CONFORME',
      storzRequestId: '12345',
      storzState: 'EM_ANDAMENTO',
      detail: 'Matricula ativa',
      lastUpdated: '2026-09-21',
    }
    const r2: HSEDatabaseRecord = {
      inspectorId: '3',
      inspectorName: 'Bruna Inspetora',
      role: 'IQ',
      docCode: '11',
      docName: 'GWO BST Primeiros Socorros',
      modality: 'PRESENCIAL',
      statusEHS: 'SOLICITADO_STORZ',
      storzRequestId: '12346',
      storzState: 'SOLICITADO',
      detail: 'Solicitado',
      lastUpdated: '2026-09-21',
    }

    expect(isStorzActive(r1)).toBe(true)
    expect(isStorzActive(r2)).toBe(true)

    const kpis = calculateExecutiveKPIs([r1, r2])
    expect(kpis.emTreinamentoCount).toBe(1)
  })

  it('mantem colaborador BLOQUEADO se documento estiver vencido e na Storz com 0% de progresso', () => {
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
      inspectorId: '10',
      inspectorName: 'Pedro Aluno',
      role: 'TO',
      docCode: code,
      docName: `Doc ${code}`,
      modality: 'PRESENCIAL',
      statusEHS: code === '22' ? 'VENCIDO' : 'CONFORME',
      storzRequestId: code === '22' ? '9991' : undefined,
      storzState: code === '22' ? 'SOLICITADO' : undefined,
      storzProgressPercent: code === '22' ? 0 : undefined,
      detail: 'OK',
      lastUpdated: '2026-09-22',
    }))

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.frontline.bloqueadoCount).toBe(1)
    expect(kpis.frontline.aptoCount).toBe(0)
  })

  it('flexibiliza para ALERTA (Apto com Alerta) se documento vencido tiver reciclagem iniciada na Storz (>0%)', () => {
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
      inspectorId: '11',
      inspectorName: 'Caio Iniciado',
      role: 'TO',
      docCode: code,
      docName: `Doc ${code}`,
      modality: 'PRESENCIAL',
      statusEHS: code === '22' ? 'VENCIDO' : 'CONFORME',
      storzRequestId: code === '22' ? '9992' : undefined,
      storzState: code === '22' ? 'EM_ANDAMENTO' : undefined,
      storzProgressPercent: code === '22' ? 33 : undefined,
      detail: 'OK',
      lastUpdated: '2026-09-22',
    }))

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.frontline.bloqueadoCount).toBe(0)
    expect(kpis.frontline.aptoCount).toBe(1)
    expect(kpis.frontline.alertaCount).toBe(1)
    expect(kpis.frontline.aptoPlenoCount).toBe(0)
  })

  it('mantem BLOQUEADO se ASO (01) estiver vencido mesmo com solicitacao na Storz', () => {
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
      inspectorId: '12',
      inspectorName: 'Marcos Medico',
      role: 'TO',
      docCode: code,
      docName: `Doc ${code}`,
      modality: 'PRESENCIAL',
      statusEHS: code === '01' ? 'VENCIDO' : 'CONFORME',
      storzRequestId: code === '01' ? '9993' : undefined,
      storzState: code === '01' ? 'EM_ANDAMENTO' : undefined,
      storzProgressPercent: code === '01' ? 50 : undefined,
      detail: 'ASO Vencido',
      lastUpdated: '2026-09-22',
    }))

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.frontline.bloqueadoCount).toBe(1)
    expect(kpis.frontline.aptoCount).toBe(0)
  })

  it('avalia colaborador DRONE com requisitos de solo e nao bloqueia por normas de subida', () => {
    const droneCodes = [
      '01',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '15',
      '18',
      '19',
      '27',
    ]
    const records: HSEDatabaseRecord[] = droneCodes.map(code => ({
      inspectorId: '13',
      inspectorName: 'Kelvin Piloto',
      role: 'IE',
      rpoBranch: 'DRONE INSP. EQUIPAMENTO',
      docCode: code,
      docName: `Doc ${code}`,
      modality: 'PRESENCIAL',
      statusEHS: 'CONFORME',
      detail: 'OK',
      lastUpdated: '2026-09-22',
    }))

    const kpis = calculateExecutiveKPIs(records)
    expect(kpis.frontline.total).toBe(1)
    expect(kpis.frontline.aptoCount).toBe(1)
    expect(kpis.frontline.bloqueadoCount).toBe(0)
  })
})
