import { describe, expect, it } from 'vitest'
import { StorzRequest } from '../models/StorzRequest.js'
import { buildAgentBriefing } from './AgentBriefingBuilder.js'
import { DRONE_CORE_CODES } from './ExecutiveDashboardCalculator.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

const REF = new Date('2026-10-16T12:00:00-03:00')
const DRONE = 'DRONE INSP. EQUIPAMENTO'

function dronePilot(
  name: string,
  overrides: Record<string, Partial<HSEDatabaseRecord>> = {}
): HSEDatabaseRecord[] {
  return [...DRONE_CORE_CODES].map(code => ({
    inspectorId: name,
    inspectorName: name,
    role: 'IE',
    rpoBranch: DRONE,
    docCode: code,
    docName: `Doc ${code}`,
    modality: 'PRESENCIAL',
    statusEHS: 'CONFORME',
    expirationDate: '2027-06-01',
    detail: '',
    lastUpdated: '2026-10-16',
    ...overrides[code],
  }))
}

function enrollment(
  name: string,
  overrides: Partial<StorzRequest> = {}
): StorzRequest {
  return {
    id: `${name}-${overrides.trainingName || 'curso'}`,
    collaboratorName: name,
    trainingCode: '20',
    trainingName: 'NR33 TRABALHADOR E VIGIA',
    modality: 'ONLINE',
    requestDate: new Date('2026-10-15T00:00:00-03:00'),
    state: 'SOLICITADO',
    rawSituacao: 'Não iniciado',
    progressPercent: 0,
    courseDurationDays: 60,
    workloadHours: 16,
    ...overrides,
  }
}

describe('buildAgentBriefing', () => {
  it('lista o bloqueado com o motivo e conta as matrículas ativas dele', () => {
    const records = [
      ...dronePilot('ANA', {
        '01': { statusEHS: 'VENCIDO', expirationDate: '2026-10-01' },
      }),
      ...dronePilot('BRUNO'),
    ]
    const briefing = buildAgentBriefing(records, [enrollment('ANA')], {
      refDate: REF,
    })

    expect(briefing.fieldReadiness.frontline).toMatchObject({
      total: 2,
      aptoCount: 1,
      bloqueadoCount: 1,
    })
    expect(briefing.fieldReadiness.byRole.IE).toEqual({
      total: 2,
      apto: 1,
      alerta: 0,
      bloqueado: 1,
    })
    expect(briefing.fieldReadiness.blocked).toEqual([
      expect.objectContaining({
        name: 'ANA',
        activeTrainings: 1,
        items: [expect.objectContaining({ code: '01', status: 'VENCIDO' })],
      }),
    ])
  })

  it('aponta quem vai ser bloqueado pelo ASO, que o alerta do executivo ignora', () => {
    const records = dronePilot('CAIO', {
      '01': { statusEHS: 'VENCE_07', expirationDate: '2026-10-20' },
    })
    const { fieldReadiness } = buildAgentBriefing(records, [], { refDate: REF })

    expect(fieldReadiness.frontline.aptoPlenoCount).toBe(1)
    expect(fieldReadiness.blockingSoon).toEqual([
      expect.objectContaining({
        name: 'CAIO',
        items: [
          expect.objectContaining({ code: '01', expirationDate: '2026-10-20' }),
        ],
      }),
    ])
  })

  it('conta só matrículas ativas de quem está na base e ordena as de risco por gravidade', () => {
    const records = dronePilot('DANI')
    const storz = [
      enrollment('DANI', { trainingName: 'RECENTE' }),
      enrollment('DANI', {
        trainingName: 'PARADO',
        requestDate: new Date('2026-09-01T00:00:00-03:00'),
      }),
      enrollment('DANI', {
        trainingName: 'APERTADO',
        state: 'EM_ANDAMENTO',
        rawSituacao: 'Em andamento',
        progressPercent: 10,
        workloadHours: 40,
        requestDate: new Date('2026-08-20T00:00:00-03:00'),
      }),
      enrollment('DESLIGADO'),
    ]
    const { trainings } = buildAgentBriefing(records, storz, { refDate: REF })

    expect(trainings.active).toEqual({
      total: 3,
      notStarted: 2,
      inProgress: 1,
      collaborators: 1,
    })
    expect(trainings.ignoredNotInBase).toBe(1)
    expect(trainings.outsideSla).toBe(2)
    expect(trainings.atRisk.map(t => [t.course, t.pace])).toEqual([
      ['APERTADO', 'RISCO_REPROVACAO'],
      ['PARADO', 'CRITICO_INERCIA'],
    ])
    expect(trainings.deadlineWithin15Days).toBe(2)
  })

  it('mede os concluídos dos últimos 30 dias contra a meta de SLA e o prazo da Storz', () => {
    const records = dronePilot('EVA')
    const done = (
      requested: string,
      completed: string,
      workloadHours: number
    ) =>
      enrollment('EVA', {
        trainingName: requested,
        state: 'CONCLUIDO',
        rawSituacao: 'Aprovado',
        progressPercent: 100,
        workloadHours,
        requestDate: new Date(`${requested}T00:00:00-03:00`),
        completionDate: new Date(`${completed}T00:00:00-03:00`),
      })
    const storz = [
      done('2026-10-10', '2026-10-11', 8), // 1 dia, meta 1
      done('2026-10-01', '2026-10-05', 8), // 4 dias, meta 1
      done('2026-07-01', '2026-10-01', 8), // 92 dias, passou do prazo de 60
      done('2026-08-01', '2026-08-02', 8), // fora da janela
      enrollment('EVA', {
        state: 'CANCELADO',
        rawSituacao: 'Reprovado',
        completionDate: new Date('2026-10-12T00:00:00-03:00'),
      }),
    ]
    const { last30Days } = buildAgentBriefing(records, storz, {
      refDate: REF,
    }).trainings

    expect(last30Days).toEqual({
      completed: 3,
      withinIdealSla: 1,
      withinStorzDeadline: 2,
      medianDays: 4,
      failed: 1,
    })
  })
})
