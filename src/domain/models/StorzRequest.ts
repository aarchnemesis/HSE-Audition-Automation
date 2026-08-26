export type StorzRequestState = 'SOLICITADO' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

export interface StorzRequest {
  id: string;                    // ID da solicitação na Storz ex: "REQ-8492"
  collaboratorName: string;      // Nome do colaborador
  collaboratorCpf?: string;      // CPF do colaborador
  trainingCode: string;          // Código do treinamento (ex: "21" = NR-35, "01" = ASO)
  trainingName: string;          // Nome do treinamento/exame na Storz
  modality: 'PRESENCIAL' | 'ONLINE' | 'HIBRIDO'; // Modalidade do curso
  requestDate: Date;             // Data da solicitação
  scheduledDate?: Date;          // Data agendada para realização
  completionDate?: Date;         // Data de conclusão
  state: StorzRequestState;      // Estado da solicitação
  /** Texto original da "Situação do aluno" na Storz (ex.: "Aprovado", "Reprovado", "Cancelado",
   *  "Em andamento") — mais granular que `state`, que colapsa Reprovado e Cancelado juntos. Usado
   *  em relatórios que precisam mostrar a situação real, não só o estado interno simplificado. */
  rawSituacao?: string;
  /** Percentual de progresso do curso (0-100), direto do "Progresso: X%" da Storz — só é
   *  significativo pra quem ainda não concluiu (situação "Não iniciado"/"Em andamento"). */
  progressPercent?: number;
  /** Prazo em dias, a partir de `requestDate` (Iniciado), pra concluir o curso — direto do
   *  "Tempo de Curso: X Dias" da Storz. Junto com requestDate dá o prazo real (deadline). */
  courseDurationDays?: number;
  notes?: string;                // Observações (ex: "Agendado via e-mail")
}

/**
 * Prazo real de conclusão de um curso em andamento: data de início (requestDate) + prazo em dias
 * (courseDurationDays). Só faz sentido pra curso que já começou de verdade e ainda não concluiu —
 * "Não iniciado" não tem data de início real (a Storz manda "-", que o scraper falseia pra "hoje",
 * então precisamos checar rawSituacao pra não computar prazo em cima de uma data inventada).
 */
export function computeCourseDeadline(request: StorzRequest): Date | undefined {
  if (request.completionDate) return undefined;
  if (!request.courseDurationDays) return undefined;

  const situacao = (request.rawSituacao || '').toUpperCase();
  if (situacao.includes('NÃO INICIADO') || situacao.includes('NAO INICIADO')) return undefined;

  const deadline = new Date(request.requestDate);
  deadline.setDate(deadline.getDate() + request.courseDurationDays);
  return deadline;
}
