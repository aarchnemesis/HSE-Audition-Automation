import { describe, expect, it } from 'vitest'
import { StorzRequest } from '../models/StorzRequest.js'
import {
  analyzeTrainingPace,
  calculateIdealSlaDays,
} from './TrainingPaceCalculator.js'

describe('TrainingPaceCalculator', () => {
  const refDate = new Date('2026-09-09T10:00:00.000Z')

  describe('calculateIdealSlaDays', () => {
    it('calcula 1 dia para cursos de até 8 horas', () => {
      expect(calculateIdealSlaDays(4)).toBe(1)
      expect(calculateIdealSlaDays(8)).toBe(1)
    })

    it('calcula 2 dias para cursos de 16 horas', () => {
      expect(calculateIdealSlaDays(16)).toBe(2)
    })

    it('calcula 5 dias para cursos de 40 horas', () => {
      expect(calculateIdealSlaDays(40)).toBe(5)
    })

    it('calcula 3 dias para cursos de 21 horas (GWO ART)', () => {
      expect(calculateIdealSlaDays(21)).toBe(3)
    })
  })

  describe('analyzeTrainingPace', () => {
    it('detecta curso não iniciado recente como NO_RITMO', () => {
      const req: StorzRequest = {
        id: 'REQ-1',
        collaboratorName: 'JOAO SILVA',
        trainingCode: '10', // NR-01 (4h)
        trainingName: 'NR-01 Integração EHS',
        modality: 'ONLINE',
        requestDate: new Date('2026-09-08T10:00:00.000Z'), // 1 dia atrás
        state: 'SOLICITADO',
        rawSituacao: 'Não iniciado',
        progressPercent: 0,
        courseDurationDays: 60,
      }

      const result = analyzeTrainingPace(req, refDate)
      expect(result.workloadHours).toBe(4)
      expect(result.idealSlaDays).toBe(1)
      expect(result.paceCategory).toBe('NO_RITMO')
      expect(result.isOutSideSla).toBe(false)
      expect(result.formattedDetail).toContain('Matriculado recentemente')
    })

    it('detecta inércia moderada em não iniciado após 3 dias', () => {
      const req: StorzRequest = {
        id: 'REQ-2',
        collaboratorName: 'JOAO SILVA',
        trainingCode: '10',
        trainingName: 'NR-01 Integração EHS',
        modality: 'ONLINE',
        requestDate: new Date('2026-09-06T10:00:00.000Z'), // 3 dias atrás
        state: 'SOLICITADO',
        rawSituacao: 'Não iniciado',
        progressPercent: 0,
        courseDurationDays: 60,
      }

      const result = analyzeTrainingPace(req, refDate)
      expect(result.paceCategory).toBe('ATENCAO_INERCIA')
      expect(result.isOutSideSla).toBe(true)
      expect(result.formattedDetail).toContain(
        'Inércia de 3 dias sem primeiro acesso'
      )
    })

    it('detecta alta inércia crítica em não iniciado após mais de 4 dias', () => {
      const req: StorzRequest = {
        id: 'REQ-3',
        collaboratorName: 'JOAO SILVA',
        trainingCode: '12', // NR-10 (40h)
        trainingName: 'NR-10 Básico Eletricidade',
        modality: 'ONLINE',
        requestDate: new Date('2026-09-01T10:00:00.000Z'), // 8 dias atrás
        state: 'SOLICITADO',
        rawSituacao: 'Não iniciado',
        progressPercent: 0,
        courseDurationDays: 60,
      }

      const result = analyzeTrainingPace(req, refDate)
      expect(result.paceCategory).toBe('CRITICO_INERCIA')
      expect(result.isOutSideSla).toBe(true)
      expect(result.formattedDetail).toContain(
        'Alta inércia de 8 dias sem iniciar o curso'
      )
    })

    it('detecta risco iminente de reprovação quando faltam poucos dias e a carga horária restante exige > 8h/dia', () => {
      const req: StorzRequest = {
        id: 'REQ-4',
        collaboratorName: 'JOAO SILVA',
        trainingCode: '12', // NR-10 (40h)
        trainingName: 'NR-10 Básico Eletricidade',
        modality: 'ONLINE',
        requestDate: new Date('2026-07-13T10:00:00.000Z'), // 58 dias atrás
        state: 'EM_ANDAMENTO',
        rawSituacao: 'Em andamento',
        progressPercent: 10, // faltam 36h
        courseDurationDays: 60, // restam 2 dias
      }

      const result = analyzeTrainingPace(req, refDate)
      expect(result.paceCategory).toBe('RISCO_REPROVACAO')
      expect(result.isOutSideSla).toBe(true)
      expect(result.hoursPerDayNeeded).toBeGreaterThan(8)
      expect(result.formattedDetail).toContain('Risco iminente de reprovação')
    })

    it('diferencia reprovado por decurso de prazo (0%) de reprovado em exame final', () => {
      const reprovadoInercia: StorzRequest = {
        id: 'REQ-5',
        collaboratorName: 'JOÃO VICTOR COSTA CAMPOS',
        trainingCode: '10',
        trainingName: 'NR1 - DISPOSIÇÕES GERAIS',
        modality: 'ONLINE',
        requestDate: new Date('2026-07-01T03:00:00.000Z'),
        completionDate: new Date('2026-08-30T03:00:00.000Z'),
        state: 'CANCELADO',
        rawSituacao: 'Reprovado',
        progressPercent: 0,
        courseDurationDays: 60,
      }

      const resInercia = analyzeTrainingPace(reprovadoInercia, refDate)
      expect(resInercia.paceCategory).toBe('REPROVADO_INERCIA')
      expect(resInercia.formattedDetail).toContain(
        'Reprovado por expiração de prazo (sem acesso)'
      )

      const reprovadoExame: StorzRequest = {
        id: 'REQ-6',
        collaboratorName: 'DAVID KELSON',
        trainingCode: '20',
        trainingName: 'NR33 TRABALHADOR E VIGIA',
        modality: 'ONLINE',
        requestDate: new Date('2026-06-10T03:00:00.000Z'),
        completionDate: new Date('2026-07-22T03:00:00.000Z'),
        state: 'CANCELADO',
        rawSituacao: 'Reprovado',
        progressPercent: 65,
        courseDurationDays: 60,
      }

      const resExame = analyzeTrainingPace(reprovadoExame, refDate)
      expect(resExame.paceCategory).toBe('REPROVADO_EXAME')
      expect(resExame.formattedDetail).toContain(
        'Reprovado na avaliação final (65%)'
      )
    })

    it('formata aprovado com sucesso exibindo duração e meta de SLA', () => {
      const aprovado: StorzRequest = {
        id: 'REQ-7',
        collaboratorName: 'MARIA SANTOS',
        trainingCode: '12', // 40h
        trainingName: 'NR-10 Básico Eletricidade',
        modality: 'ONLINE',
        requestDate: new Date('2026-08-01T10:00:00.000Z'),
        completionDate: new Date('2026-08-05T10:00:00.000Z'), // 4 dias
        state: 'CONCLUIDO',
        rawSituacao: 'Aprovado',
        progressPercent: 100,
        courseDurationDays: 60,
      }

      const result = analyzeTrainingPace(aprovado, refDate)
      expect(result.paceCategory).toBe('CONCLUIDO')
      expect(result.formattedDetail).toContain('Aprovado com 100%')
      expect(result.formattedDetail).toContain(
        'Concluído em 4d (SLA ideal: 5d)'
      )
    })
  })
})
