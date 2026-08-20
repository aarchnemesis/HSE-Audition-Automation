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
  notes?: string;                // Observações (ex: "Agendado via e-mail")
}
