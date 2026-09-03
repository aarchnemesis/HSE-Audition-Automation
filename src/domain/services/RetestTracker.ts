import { StorzRequest } from '../models/StorzRequest.js'

export type AttemptOutcome =
  | 'APROVADO'
  | 'REPROVADO'
  | 'EM_ANDAMENTO'
  | 'NAO_INICIADO'
  | 'PENDENTE'

/**
 * As 3 etapas de reteste pedidas pelo usuário em 26/08/2026 — não é só "aprovou depois ou não":
 *   1. AGUARDANDO_RETESTE: reprovou e não tem nenhuma rematrícula em andamento ainda (só reprovado,
 *      ou rematriculado mas "Não iniciado")
 *   2. RETESTE_EM_ANDAMENTO: reprovou e JÁ ESTÁ fazendo o mesmo curso de novo agora
 *   3. RETESTE_APROVADO: reprovou e a tentativa mais recente foi aprovada
 */
export type RetestStage =
  | 'AGUARDANDO_RETESTE'
  | 'RETESTE_EM_ANDAMENTO'
  | 'RETESTE_APROVADO'

export interface RetestAttempt {
  request: StorzRequest
  attemptNumber: number
  outcome: AttemptOutcome
}

export interface RetestGroup {
  collaboratorName: string
  trainingCode: string
  attempts: RetestAttempt[]
  hasFailedAttempt: boolean
  latestOutcome: AttemptOutcome
  /** Só definido quando hasFailedAttempt é true — ver RetestStage. */
  retestStage?: RetestStage
  /** Existe uma matrícula depois da reprovação (nova tentativa registrada), independente de já
   *  ter começado ou não. Pedido do usuário em 26/08/2026: quer ver esse fato separado da etapa. */
  rematriculado: boolean
  /** A tentativa mais recente já tem data de início real (não é mais "Não iniciado"). */
  iniciado: boolean
  /** Progresso (0-100) da tentativa mais recente, quando disponível — só relevante se `iniciado`
   *  for true e ainda não tiver concluído. */
  latestProgressPercent?: number
  /** @deprecated mantido por compatibilidade — equivalente a retestStage === 'RETESTE_APROVADO'. */
  retestApproved: boolean
  /** @deprecated mantido por compatibilidade — equivalente a retestStage !== 'RETESTE_APROVADO'.
   *  Não distingue mais "aguardando" de "em andamento" — usar retestStage pra isso. */
  pendingRetest: boolean
}

/**
 * "Situação do aluno" original da Storz (rawSituacao) tem mais granularidade que o `state`
 * interno — precisamos distinguir Reprovado/Em andamento/Não iniciado pra saber em que etapa do
 * reteste a pessoa está, não só se "passou depois ou não".
 */
function classifyOutcome(situacao: string): AttemptOutcome {
  const upper = situacao.toUpperCase()
  if (upper.includes('APROVADO') || upper.includes('CONCLU')) return 'APROVADO'
  if (upper.includes('REPROVADO')) return 'REPROVADO'
  if (upper.includes('ANDAMENTO') || upper.includes('CURSANDO'))
    return 'EM_ANDAMENTO'
  if (upper.includes('NÃO INICIADO') || upper.includes('NAO INICIADO'))
    return 'NAO_INICIADO'
  return 'PENDENTE'
}

function computeRetestStage(latestOutcome: AttemptOutcome): RetestStage {
  if (latestOutcome === 'APROVADO') return 'RETESTE_APROVADO'
  if (latestOutcome === 'EM_ANDAMENTO') return 'RETESTE_EM_ANDAMENTO'
  return 'AGUARDANDO_RETESTE' // REPROVADO, NAO_INICIADO ou PENDENTE — nenhuma rematrícula ativa
}

/**
 * Agrupa as matrículas por (colaborador, código do documento) e ordena por data de matrícula —
 * cada grupo é o histórico de tentativas daquela pessoa naquele curso, permitindo ver em que
 * etapa do reteste a pessoa está (ver RetestStage).
 */
export function groupRetests(requests: StorzRequest[]): RetestGroup[] {
  const groups = new Map<string, StorzRequest[]>()

  for (const req of requests) {
    const key = `${req.collaboratorName.trim().toUpperCase()}::${req.trainingCode}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(req)
  }

  const result: RetestGroup[] = []
  for (const groupRequests of groups.values()) {
    const sorted = [...groupRequests].sort(
      (a, b) => a.requestDate.getTime() - b.requestDate.getTime()
    )
    const attempts: RetestAttempt[] = sorted.map((request, idx) => ({
      request,
      attemptNumber: idx + 1,
      outcome: classifyOutcome(request.rawSituacao || request.state),
    }))

    const hasFailedAttempt = attempts.some(a => a.outcome === 'REPROVADO')
    const latestAttempt = attempts[attempts.length - 1]
    const latestOutcome = latestAttempt.outcome
    const retestStage = hasFailedAttempt
      ? computeRetestStage(latestOutcome)
      : undefined

    // Rematriculado = teve mais de uma matrícula nesse curso (a primeira reprovou, existe pelo
    // menos mais uma depois) — vale mesmo que a rematrícula tenha reprovado de novo.
    const rematriculado = hasFailedAttempt && attempts.length > 1
    // Iniciado = a rematrícula já tem data de início real (deixou de ser "Não iniciado").
    const iniciado = rematriculado && latestOutcome !== 'NAO_INICIADO'

    result.push({
      collaboratorName: sorted[0].collaboratorName,
      trainingCode: sorted[0].trainingCode,
      attempts,
      hasFailedAttempt,
      latestOutcome,
      retestStage,
      rematriculado,
      iniciado,
      latestProgressPercent: hasFailedAttempt
        ? latestAttempt.request.progressPercent
        : undefined,
      retestApproved: retestStage === 'RETESTE_APROVADO',
      pendingRetest: hasFailedAttempt && retestStage !== 'RETESTE_APROVADO',
    })
  }

  return result
}
