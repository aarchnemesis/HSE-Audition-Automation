import { describe, expect, it } from 'vitest'
import { StorzRequest, computeCourseDeadline } from './StorzRequest.js'

function makeRequest(overrides: Partial<StorzRequest>): StorzRequest {
  return {
    id: 'REQ-1',
    collaboratorName: 'FULANO',
    trainingCode: '20',
    trainingName: 'NR-33',
    modality: 'PRESENCIAL',
    requestDate: new Date(2026, 5, 10), // 10/06/2026
    state: 'EM_ANDAMENTO',
    ...overrides,
  }
}

describe('computeCourseDeadline', () => {
  it('calcula o prazo como data de início + dias de curso', () => {
    const req = makeRequest({
      courseDurationDays: 60,
      rawSituacao: 'Em andamento',
    })
    const deadline = computeCourseDeadline(req)
    expect(deadline).toEqual(new Date(2026, 7, 9)) // 10/06 + 60 dias = 09/08/2026
  })

  it('retorna undefined quando já concluiu — prazo só importa pra quem ainda não terminou', () => {
    const req = makeRequest({
      courseDurationDays: 60,
      completionDate: new Date(2026, 6, 1),
    })
    expect(computeCourseDeadline(req)).toBeUndefined()
  })

  it('retorna undefined quando não tem courseDurationDays', () => {
    const req = makeRequest({ rawSituacao: 'Em andamento' })
    expect(computeCourseDeadline(req)).toBeUndefined()
  })

  it('retorna undefined pra "Não iniciado" — requestDate é uma data falsa (fallback pra hoje), não uma data de início real', () => {
    const req = makeRequest({
      courseDurationDays: 60,
      rawSituacao: 'Não iniciado',
    })
    expect(computeCourseDeadline(req)).toBeUndefined()
  })
})
