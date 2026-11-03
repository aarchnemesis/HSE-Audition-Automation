import { PortalRejectionRecord, RejectionPlaybook } from '../adapters/mongodb/PortalRejectionStore.js'

export interface AnalysisResult {
  causeDiagnosis: string
  recommendedAction: string
  targetTeam: 'EHS' | 'DO' | 'RH' | 'FIELD'
  confidence: number
}

interface DiagnosisRule {
  id: string
  pattern: RegExp
  diagnosis: string
  action: string
  team: 'EHS' | 'DO' | 'RH' | 'FIELD'
  confidence: number
}

const DIAGNOSIS_RULES: DiagnosisRule[] = [
  {
    id: 'aso-pcmso-missing',
    pattern: /pcmso|apresente o aso \+ o pcmso|aso acompanhado de pcmso/i,
    diagnosis: 'ASO enviado desacompanhado do PCMSO vigente da respectiva usina/cliente.',
    action: 'Localizar o PCMSO vigente do projeto/usina, anexar ao ASO em arquivo único ou campo complementar e ressubmeter no portal.',
    team: 'EHS',
    confidence: 0.95,
  },
  {
    id: 'signature-digital-invalid',
    pattern: /assinatura digital|sem assinatura|assinatura n[aã]o verific[aá]vel|icp-brasil|assinar digitalmente/i,
    diagnosis: 'Documento recusado por ausência de assinatura digital verificável (padrão ICP-Brasil ou certificado válido).',
    action: 'Solicitar reemissão do documento com assinatura digital certificada (Gov.br / ICP-Brasil / DocuSign com manifesto completo) e reenviar ao portal.',
    team: 'RH',
    confidence: 0.92,
  },
  {
    id: 'crm-medical-stamp',
    pattern: /crm|carimbo m[eé]dico|m[eé]dico examinador|assinatura do m[eé]dico/i,
    diagnosis: 'ASO ou laudo médico sem identificação clara, carimbo ou assinatura do médico examinador/coordenador.',
    action: 'Verificar se o arquivo possui a folha de assinatura do médico examinador e reemitir com a clínica de medicina ocupacional credenciada.',
    team: 'RH',
    confidence: 0.9,
  },
  {
    id: 'document-illegible-cut',
    pattern: /ileg[ií]vel|cortad[oa]|incomplet[oa]|baixa resolu[cç][aã]o|digitaliza[cç][aã]o/i,
    diagnosis: 'Arquivo com digitalização de baixa qualidade, texto cortado ou páginas faltantes.',
    action: 'Localizar a via física ou escaneamento de alta resolução completo e substituir o arquivo no portal.',
    team: 'RH',
    confidence: 0.95,
  },
  {
    id: 'nr-anuencia-eletrica',
    pattern: /anu[eê]ncia|carta de anu[eê]ncia|sep|nr-?10/i,
    diagnosis: 'Carta de Anuência NR10/SEP recusada ou reprovada pelo cliente.',
    action: 'Emitir carta de anuência formal em papel timbrado Arthwind com o escopo e usina específicos assinada pelo responsável técnico e pelo colaborador.',
    team: 'EHS',
    confidence: 0.9,
  },
  {
    id: 'gwo-validation-winda',
    pattern: /winda|gwo|btt|bst|id winda/i,
    diagnosis: 'Certificado GWO não validado na base WINDA ou sem o respectivo WINDA ID do colaborador.',
    action: 'Verificar o WINDA ID do colaborador, baixar o extrato oficial diretamente do portal GWO WINDA e ressubmeter.',
    team: 'DO',
    confidence: 0.93,
  },
  {
    id: 'nr-training-practical-hours',
    pattern: /conte[uú]do program[aá]tico|carga hor[aá]ria|parte pr[aá]tica|reciclagem|instrutor|profici[eê]ncia/i,
    diagnosis: 'Certificado de treinamento sem verso (conteúdo programático, carga teórica/prática ou proficiência do instrutor).',
    action: 'Localizar o certificado completo com frente e verso demonstrando o conteúdo programático e registro do instrutor credenciado.',
    team: 'DO',
    confidence: 0.92,
  },
  {
    id: 'epi-fardamento-ca',
    pattern: /epi|ficha de epi|ca vencido|certificado de aprova[cç][aã]o/i,
    diagnosis: 'Ficha de EPI incompleta, sem assinatura do colaborador ou com número de CA não vigente/divergente.',
    action: 'Revisar a Ficha de Registro de EPI com os CAs atualizados dos equipamentos entregues, coletar assinatura e anexar.',
    team: 'EHS',
    confidence: 0.88,
  },
  {
    id: 'divergent-date-or-expired',
    pattern: /vencid[oa]|validade expirada|data divergente/i,
    diagnosis: 'Documento vencido ou com data de emissão/validade divergente do cadastro no portal.',
    action: 'Verificar a base de dados interna: se houver via renovada, anexar; caso contrário, providenciar nova emissão ou reciclagem.',
    team: 'DO',
    confidence: 0.85,
  },
]

export class RejectionAnalyzer {
  /**
   * Analisa um motivo bruto de recusa e documento, associando causa raiz e plano de ação.
   */
  public analyze(rejection: {
    portalId: string
    docTitle: string
    rejectionReasonRaw: string
    workerName?: string
  }): AnalysisResult {
    const raw = rejection.rejectionReasonRaw || ''
    const title = rejection.docTitle || ''
    const combined = `${raw} ${title}`.toLowerCase()

    // 1. Testa as regras conhecidas de diagnóstico
    for (const rule of DIAGNOSIS_RULES) {
      if (rule.pattern.test(raw) || rule.pattern.test(combined)) {
        return {
          causeDiagnosis: rule.diagnosis,
          recommendedAction: rule.action,
          targetTeam: rule.team,
          confidence: rule.confidence,
        }
      }
    }

    // 2. Heurística pelo tipo de documento quando o motivo for genérico (ex: "Documento reprovado")
    if (/aso|exame/i.test(title)) {
      return {
        causeDiagnosis: 'ASO recusado pelo analista do cliente (pendente validação de exames complementares ou PCMSO).',
        recommendedAction: 'Conferir se todos os exames complementares (audiometria, acuidade, ECG) e o PCMSO da usina foram anexados junto ao ASO.',
        targetTeam: 'EHS',
        confidence: 0.75,
      }
    }

    if (/nr-?10|nr-?35|nr-?33|nr-?12|dire[cç][aã]o defensiva|primeiros socorros|gwo|btt|bst/i.test(title)) {
      return {
        causeDiagnosis: 'Certificado de treinamento normativo recusado pelo cliente.',
        recommendedAction: 'Conferir se o certificado possui frente e verso legíveis, assinatura digital do instrutor/responsável e registro de ART/proficiência.',
        targetTeam: 'DO',
        confidence: 0.75,
      }
    }

    if (/anu[eê]ncia|ordem de servi[cç]o|os|termo/i.test(title)) {
      return {
        causeDiagnosis: 'Documento legal ou ordem de serviço recusada.',
        recommendedAction: 'Reemitir formulário com data de emissão atualizada e assinatura de todas as partes.',
        targetTeam: 'EHS',
        confidence: 0.7,
      }
    }

    // 3. Fallback genérico
    return {
      causeDiagnosis: `Recusa registrada no portal: ${raw.trim() || 'Sem motivo específico detalhado'}.`,
      recommendedAction: 'Auditar o documento submetido contra os requisitos de homologação do cliente e reenviar via corrigida.',
      targetTeam: 'RH',
      confidence: 0.6,
    }
  }

  /**
   * Converte o plano de ação gerado em um objeto compatível com PortalRejectionRecord['actionPlan']
   */
  public toActionPlan(result: AnalysisResult): NonNullable<PortalRejectionRecord['actionPlan']> {
    return {
      causeDiagnosis: result.causeDiagnosis,
      recommendedAction: result.recommendedAction,
      targetTeam: result.targetTeam,
      confidence: result.confidence,
      updatedAt: new Date().toISOString(),
    }
  }

  /**
   * Gera a síntese para a coleção de playbooks
   */
  public toPlaybook(
    rejection: { portalId: string; docTitle: string; rejectionReasonRaw: string },
    result: AnalysisResult
  ): RejectionPlaybook {
    return {
      clientPattern: rejection.portalId,
      docType: rejection.docTitle,
      rejectionPattern: rejection.rejectionReasonRaw.slice(0, 150),
      rootCause: result.causeDiagnosis,
      standardAction: result.recommendedAction,
      timesEncountered: 1,
      lastSeenAt: new Date().toISOString(),
    }
  }
}
