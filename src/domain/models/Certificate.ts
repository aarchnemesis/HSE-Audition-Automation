export type EHSStatus =
  | 'CONFORME'
  | 'VENCE_60'
  | 'VENCE_30'
  | 'VENCE_15'
  | 'VENCE_07'
  | 'VENCIDO'
  | 'SOLICITADO_STORZ'
  | 'STORZ_EM_ANDAMENTO'
  | 'INDETERMINADO'
  | 'AUSENTE'

export type TrainingModality = 'PRESENCIAL' | 'ONLINE' | 'HIBRIDO'

export interface Certificate {
  code: string // Ex: "01", "12", "21"
  name: string // Ex: "NR-35 Trabalho em Altura"
  filename?: string // Nome do arquivo original no Drive
  modality?: TrainingModality // Modalidade: Presencial vs Online
  issueDate?: Date // Data de emissão ou data gravada no arquivo
  expirationDate?: Date // Data de validade calculada ou gravada
  statusEHS: EHSStatus // Status calculado de acordo com a régua EHS
  statusDetail?: string // Ex: "Vence em 14 dias (01/09/2026)"
  storzRequestId?: string // ID da solicitação ativa na Storz (se houver)
  storzRequestState?: string // Estado da solicitação Storz (ex: "EM_ANDAMENTO")
  sourcePath?: string // Caminho absoluto do arquivo no Drive
}

export interface Inspector {
  id: string // Nome ou identificador único do inspetor
  name: string // Nome completo
  cpf?: string // CPF (usado como chave primária de matching com a Storz, quando disponível)
  role: string // Ex: "INSP. DE QUALIDADE", "TÉC. EM OPERAÇÃO"
  employmentType?: string // Ex: "CLT", "PJ" — vem da coluna TIPO da RPO
  sector?: string // Ex: "INTERNAS", "OPERAÇÕES"
  /** Ramo hierárquico da RPO (ex.: "INSP. QUALIDADE & TÉC. OPERAÇÕES", "ADMINISTRATIVO",
   *  "VISIBILIDADE") — usado como fonte primária de classificação de perfil (ver
   *  EmployeeProfileClassifier.ts), mais confiável que o texto da coluna FUNÇÃO quando o ramo é
   *  homogêneo. Undefined pra inspetor que só existe no Drive (sem linha correspondente na RPO). */
  rpoBranch?: string
  windaId?: string // WINDA ID (GWO)
  cnhNumber?: string // Número da CNH
  location?: {
    city: string
    state: string
    lat?: number
    lng?: number
  }
  certificates: Map<string, Certificate> // Mapeado pelo código ("01".."30")
}

export interface ParkRequirement {
  id: string
  parkName: string
  clientName: string
  description: string
  requiredDocCodes: string[]
  /** Códigos que estão em requiredDocCodes mas são só MONITORADOS — se ausentes, não contam
   *  como pendência (não entram em missingCount, não aparecem no e-mail/dashboard). Se omitido,
   *  usa o padrão global ELECTIVE_DOC_CODES (ComplianceEngine.ts). Ver getElectiveDocCodesForProfile. */
  electiveDocCodes?: string[]
  requiredModalities?: Record<string, TrainingModality>
  minValidityDays?: number
  location?: {
    city: string
    state: string
    lat?: number
    lng?: number
  }
}

export interface ParkComplianceResult {
  inspectorName: string
  parkName: string
  clientName: string
  overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO'
  missingDocsCount: number
  expiredDocsCount: number
  warningDocsCount: number
  storzPendingCount: number
  validDocsCount: number
  docDetails: {
    code: string
    reqName: string
    status: EHSStatus
    modality?: TrainingModality
    modalityCompliant?: boolean
    storzInfo?: string
    detail: string
  }[]
}
