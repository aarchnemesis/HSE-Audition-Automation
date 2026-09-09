import { StorzRequest } from '../models/StorzRequest.js'
import { getCourseWorkloadHours } from './ComplianceEngine.js'

export type TrainingPaceCategory =
  | 'NO_RITMO'
  | 'ATENCAO_INERCIA'
  | 'RITMO_LENTO'
  | 'CRITICO_INERCIA'
  | 'RISCO_REPROVACAO'
  | 'CONCLUIDO'
  | 'REPROVADO_INERCIA'
  | 'REPROVADO_EXAME'
  | 'CANCELADO'

export interface TrainingPaceAnalysis {
  workloadHours: number
  idealSlaDays: number
  elapsedDays: number
  storzRemainingDays: number | null
  storzDeadlineDate: Date | null
  hoursPerDayNeeded: number | null
  paceCategory: TrainingPaceCategory
  isOutSideSla: boolean
  formattedDetail: string
}

/**
 * Calcula o SLA ideal em dias úteis com base em 8 horas líquidas por dia (mínimo de 1 dia).
 */
export function calculateIdealSlaDays(workloadHours: number): number {
  return Math.max(1, Math.ceil(workloadHours / 8))
}

/**
 * Analisa a jornada de treinamento do aluno na Storz ponderando a carga horária,
 * inércia de matrícula/início, velocidade de avanço e proximidade da data limite.
 */
export function analyzeTrainingPace(
  req: StorzRequest,
  refDate: Date = new Date()
): TrainingPaceAnalysis {
  const workloadHours =
    req.workloadHours ||
    getCourseWorkloadHours(req.trainingCode, req.trainingName)
  const idealSlaDays = calculateIdealSlaDays(workloadHours)

  const rawSit = req.rawSituacao || req.state || ''
  const situacaoUpper = rawSit.toUpperCase()
  const prog =
    req.progressPercent !== undefined
      ? req.progressPercent
      : req.state === 'CONCLUIDO'
        ? 100
        : 0

  const reqDate = req.requestDate ? new Date(req.requestDate) : null
  const reqDateStr = reqDate ? reqDate.toLocaleDateString('pt-BR') : ''
  const elapsedDays = reqDate
    ? Math.max(
        0,
        Math.floor(
          (refDate.getTime() - reqDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      )
    : 0

  const durationDays = req.courseDurationDays || 60
  let storzDeadlineDate: Date | null = null
  let storzRemainingDays: number | null = null

  if (reqDate && !req.completionDate) {
    storzDeadlineDate = new Date(
      reqDate.getTime() + durationDays * 24 * 60 * 60 * 1000
    )
    storzRemainingDays = Math.ceil(
      (storzDeadlineDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24)
    )
  }

  const remainingHours = workloadHours * (1 - prog / 100)
  let hoursPerDayNeeded: number | null = null
  if (storzRemainingDays !== null && storzRemainingDays > 0 && prog < 100) {
    hoursPerDayNeeded =
      Math.round((remainingHours / storzRemainingDays) * 10) / 10
  }

  // 1. Concluído / Aprovado
  if (
    situacaoUpper.includes('APROV') ||
    situacaoUpper.includes('CONCLU') ||
    req.state === 'CONCLUIDO'
  ) {
    const complDate = req.completionDate ? new Date(req.completionDate) : null
    const complDateStr = complDate
      ? complDate.toLocaleDateString('pt-BR')
      : reqDateStr
    let durStr = ''
    if (complDate && reqDate) {
      const dur = Math.max(
        0,
        Math.round(
          (complDate.getTime() - reqDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      )
      durStr =
        dur === 0
          ? ' • Concluído no mesmo dia'
          : ` • Concluído em ${dur}d (SLA ideal: ${idealSlaDays}d)`
    }
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays: null,
      storzDeadlineDate: null,
      hoursPerDayNeeded: null,
      paceCategory: 'CONCLUIDO',
      isOutSideSla: false,
      formattedDetail: `Aprovado com 100% em ${complDateStr}${durStr}.`,
    }
  }

  // 2. Reprovado
  if (situacaoUpper.includes('REPROV')) {
    const complDate = req.completionDate ? new Date(req.completionDate) : null
    const complDateStr = complDate
      ? complDate.toLocaleDateString('pt-BR')
      : 'data final'

    if (prog === 0) {
      return {
        workloadHours,
        idealSlaDays,
        elapsedDays,
        storzRemainingDays: null,
        storzDeadlineDate: null,
        hoursPerDayNeeded: null,
        paceCategory: 'REPROVADO_INERCIA',
        isOutSideSla: true,
        formattedDetail: `Reprovado por expiração de prazo (sem acesso): Matrícula expirou em ${complDateStr} após ${durationDays} dias sem início do curso. Necessita de rematrícula pelo time de DO.`,
      }
    }

    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays: null,
      storzDeadlineDate: null,
      hoursPerDayNeeded: null,
      paceCategory: 'REPROVADO_EXAME',
      isOutSideSla: true,
      formattedDetail: `Reprovado na avaliação final (${prog}%): Concluiu a grade de ${workloadHours}h mas não atingiu a nota de corte em ${complDateStr}. Necessita de rematrícula para reteste.`,
    }
  }

  // 3. Cancelado
  if (situacaoUpper.includes('CANCEL')) {
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays: null,
      storzDeadlineDate: null,
      hoursPerDayNeeded: null,
      paceCategory: 'CANCELADO',
      isOutSideSla: false,
      formattedDetail: 'Matrícula cancelada no portal Storz.',
    }
  }

  // 4. Não iniciado
  if (
    situacaoUpper.includes('NÃO INICIADO') ||
    situacaoUpper.includes('NAO INICIADO') ||
    req.state === 'SOLICITADO'
  ) {
    if (elapsedDays <= 2) {
      return {
        workloadHours,
        idealSlaDays,
        elapsedDays,
        storzRemainingDays,
        storzDeadlineDate,
        hoursPerDayNeeded,
        paceCategory: 'NO_RITMO',
        isOutSideSla: false,
        formattedDetail: `Matriculado recentemente em ${reqDateStr} • Aguardando primeiro acesso (Carga: ${workloadHours}h • Meta SLA: ${idealSlaDays}d).`,
      }
    }

    if (elapsedDays <= 4) {
      return {
        workloadHours,
        idealSlaDays,
        elapsedDays,
        storzRemainingDays,
        storzDeadlineDate,
        hoursPerDayNeeded,
        paceCategory: 'ATENCAO_INERCIA',
        isOutSideSla: true,
        formattedDetail: `Atenção: Inércia de ${elapsedDays} dias sem primeiro acesso (Carga: ${workloadHours}h • Meta SLA: ${idealSlaDays}d).`,
      }
    }

    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays,
      storzDeadlineDate,
      hoursPerDayNeeded,
      paceCategory: 'CRITICO_INERCIA',
      isOutSideSla: true,
      formattedDetail: `Crítico: Alta inércia de ${elapsedDays} dias sem iniciar o curso (0% • Carga: ${workloadHours}h • Meta SLA: ${idealSlaDays}d).`,
    }
  }

  // 5. Em andamento
  const dlStr = storzDeadlineDate
    ? storzDeadlineDate.toLocaleDateString('pt-BR')
    : ''

  if (storzRemainingDays !== null && storzRemainingDays < 0) {
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays,
      storzDeadlineDate,
      hoursPerDayNeeded: null,
      paceCategory: 'CRITICO_INERCIA',
      isOutSideSla: true,
      formattedDetail: `Prazo Storz expirado há ${Math.abs(storzRemainingDays)} dias (${prog}% concluído) • Prazo era ${dlStr}.`,
    }
  }

  if (hoursPerDayNeeded !== null && hoursPerDayNeeded > 8) {
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays,
      storzDeadlineDate,
      hoursPerDayNeeded,
      paceCategory: 'RISCO_REPROVACAO',
      isOutSideSla: true,
      formattedDetail: `Risco iminente de reprovação: Restam ${storzRemainingDays} dias para ${remainingHours.toFixed(0)}h de conteúdo (exige ${hoursPerDayNeeded}h/dia de estudo até ${dlStr}).`,
    }
  }

  if (prog === 0) {
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays,
      storzDeadlineDate,
      hoursPerDayNeeded,
      paceCategory: 'ATENCAO_INERCIA',
      isOutSideSla: true,
      formattedDetail: `Inércia de execução: 0% de progresso após ${elapsedDays} dias de início (restam ${storzRemainingDays} dias até ${dlStr}).`,
    }
  }

  if (elapsedDays > idealSlaDays * 2) {
    return {
      workloadHours,
      idealSlaDays,
      elapsedDays,
      storzRemainingDays,
      storzDeadlineDate,
      hoursPerDayNeeded,
      paceCategory: 'RITMO_LENTO',
      isOutSideSla: true,
      formattedDetail: `Ritmo lento: ${prog}% concluído em ${elapsedDays} dias (Meta SLA era ${idealSlaDays}d para ${workloadHours}h • Restam ${storzRemainingDays}d até ${dlStr}).`,
    }
  }

  return {
    workloadHours,
    idealSlaDays,
    elapsedDays,
    storzRemainingDays,
    storzDeadlineDate,
    hoursPerDayNeeded,
    paceCategory: 'NO_RITMO',
    isOutSideSla: false,
    formattedDetail: `No ritmo: ${prog}% concluído em ${elapsedDays} dias (Carga: ${workloadHours}h • Meta SLA: ${idealSlaDays}d • Restam ${storzRemainingDays}d até ${dlStr}).`,
  }
}
