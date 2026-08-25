import { StorzRequest } from '../models/StorzRequest.js';

export type AttemptOutcome = 'APROVADO' | 'REPROVADO' | 'PENDENTE';

export interface RetestAttempt {
  request: StorzRequest;
  attemptNumber: number;
  outcome: AttemptOutcome;
}

export interface RetestGroup {
  collaboratorName: string;
  trainingCode: string;
  attempts: RetestAttempt[];
  hasFailedAttempt: boolean;
  latestOutcome: AttemptOutcome;
  /** Reprovou em algum momento, mas a tentativa mais recente é aprovação — reteste OK. */
  retestApproved: boolean;
  /** Reprovou e ainda não tem uma aprovação depois disso — precisa refazer ou está parado. */
  pendingRetest: boolean;
}

/**
 * "Situação do aluno" original da Storz (rawSituacao) tem mais granularidade que o `state`
 * interno — precisamos distinguir Reprovado de Cancelado/Pendente pra saber se teve reteste.
 */
function classifyOutcome(situacao: string): AttemptOutcome {
  const upper = situacao.toUpperCase();
  if (upper.includes('APROVADO') || upper.includes('CONCLU')) return 'APROVADO';
  if (upper.includes('REPROVADO')) return 'REPROVADO';
  return 'PENDENTE';
}

/**
 * Agrupa as matrículas por (colaborador, código do documento) e ordena por data de matrícula —
 * cada grupo é o histórico de tentativas daquela pessoa naquele curso, permitindo ver se uma
 * reprovação foi seguida de um reteste aprovado ou se ainda está pendente.
 */
export function groupRetests(requests: StorzRequest[]): RetestGroup[] {
  const groups = new Map<string, StorzRequest[]>();

  for (const req of requests) {
    const key = `${req.collaboratorName.trim().toUpperCase()}::${req.trainingCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(req);
  }

  const result: RetestGroup[] = [];
  for (const groupRequests of groups.values()) {
    const sorted = [...groupRequests].sort((a, b) => a.requestDate.getTime() - b.requestDate.getTime());
    const attempts: RetestAttempt[] = sorted.map((request, idx) => ({
      request,
      attemptNumber: idx + 1,
      outcome: classifyOutcome(request.rawSituacao || request.state)
    }));

    const hasFailedAttempt = attempts.some((a) => a.outcome === 'REPROVADO');
    const latestOutcome = attempts[attempts.length - 1].outcome;

    result.push({
      collaboratorName: sorted[0].collaboratorName,
      trainingCode: sorted[0].trainingCode,
      attempts,
      hasFailedAttempt,
      latestOutcome,
      retestApproved: hasFailedAttempt && latestOutcome === 'APROVADO',
      pendingRetest: hasFailedAttempt && latestOutcome !== 'APROVADO'
    });
  }

  return result;
}
