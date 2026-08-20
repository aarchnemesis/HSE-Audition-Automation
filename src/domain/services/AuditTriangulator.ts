import { Inspector, ParkRequirement, EHSStatus } from '../models/Certificate.js';
import { StorzRequest } from '../models/StorzRequest.js';
import { EHSEvaluator } from './EHSEvaluator.js';
import { DOC_CATALOG_MAP, STORZ_SEARCHABLE_DOC_CODES } from './ComplianceEngine.js';
import { findInspectorMatch } from './InspectorMatcher.js';

export interface TripleAuditResult {
  inspectorName: string;
  parkName: string;
  clientName: string;
  overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO';
  missingDocsCount: number;
  expiredDocsCount: number;
  warningDocsCount: number;
  storzPendingCount: number;
  /** Cursos com solicitação na Storz já iniciada (tem data de início) mas ainda não concluída */
  storzInProgressCount: number;
  validDocsCount: number;
  auditItems: {
    code: string;
    reqName: string;
    status: EHSStatus;
    requiredModality?: string;
    actualModality?: string;
    isModalityCompliant: boolean;
    hasDriveDoc: boolean;
    storzRequestFound?: {
      requestId: string;
      state: string;
      requestDate: Date;
      notes?: string;
    };
    detail: string;
  }[];
}

export class AuditTriangulator {
  /**
   * Executa a Auditoria Tripla Incremental com a Régua Escalonada EHS (60d, 30d, 15d, 7d, Vencidos)
   */
  static performTripleAudit(
    inspector: Inspector,
    park: ParkRequirement,
    storzRequests: StorzRequest[],
    refDate: Date = new Date()
  ): TripleAuditResult {
    let missingCount = 0;
    let expiredCount = 0;
    let warningCount = 0;
    let storzPendingCount = 0;
    let storzInProgressCount = 0;
    let validCount = 0;

    const inspectorStorzReqs = findInspectorMatch(
      inspector,
      storzRequests,
      (r) => r.collaboratorName,
      (r) => r.collaboratorCpf
    );

    // SOLICITADO_STORZ só vale para quem AINDA NÃO iniciou o curso (state SOLICITADO — sem data
    // de início). Quem já iniciou mas não concluiu (state EM_ANDAMENTO) precisa ser monitorado à
    // parte — não pode ficar escondido atrás do mesmo status de "só pedi e não fiz nada ainda".
    // CONCLUIDO conta como resolvido (mesma classe de SOLICITADO_STORZ: "coberto pela Storz").
    const applyStorzOverride = (storzReq: StorzRequest, baseDetail: string): { status: EHSStatus; detail: string } => {
      if (storzReq.state === 'EM_ANDAMENTO') {
        storzInProgressCount++;
        return {
          status: 'STORZ_EM_ANDAMENTO',
          detail: `${baseDetail} | 🟣 EM ANDAMENTO NA STORZ, curso iniciado mas ainda não concluído (${storzReq.id})`
        };
      }
      storzPendingCount++;
      return {
        status: 'SOLICITADO_STORZ',
        detail: `${baseDetail} | 🔵 SOLICITADO NA STORZ (${storzReq.id} - Status: ${storzReq.state})`
      };
    };

    const auditItems = park.requiredDocCodes.map((code) => {
      const reqName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`;
      const cert = inspector.certificates.get(code);

      const requiredModality = park.requiredModalities ? park.requiredModalities[code] : undefined;
      const actualModality = cert?.modality || 'PRESENCIAL';

      let isModalityCompliant = true;
      if (requiredModality && requiredModality !== actualModality) {
        isModalityCompliant = false;
      }

      // A Storz é uma empresa de treinamentos normativos — não faz sentido buscar lá documentos
      // pessoais/médicos (ASO, CTPS, vacina), de trânsito (CNH) ou certificações de terceiros
      // (SIT/ESO Vestas, WINDA). Pra esses, nem tentamos casar com solicitação na Storz.
      const storzReq = STORZ_SEARCHABLE_DOC_CODES.has(code)
        ? inspectorStorzReqs.find((sr) => sr.trainingCode === code && sr.state !== 'CANCELADO')
        : undefined;

      let status: EHSStatus = 'AUSENTE';
      let detail = '';

      if (!cert) {
        if (storzReq) {
          const overridden = applyStorzOverride(storzReq, 'Documento ausente no Drive, mas');
          status = overridden.status;
          detail = overridden.detail;
        } else {
          status = 'AUSENTE';
          detail = 'Documento obrigatório não encontrado no Drive nem solicitado na Storz.';
          missingCount++;
        }
      } else {
        const evaluation = EHSEvaluator.evaluateDate(cert.expirationDate, refDate);
        status = evaluation.status;
        detail = evaluation.detail;

        // Se o documento estiver vencido ou vencendo em 60/30/15/7 dias, checa se a Storz já tem solicitação
        if (['VENCIDO', 'VENCE_07', 'VENCE_15', 'VENCE_30', 'VENCE_60'].includes(status)) {
          if (storzReq) {
            const overridden = applyStorzOverride(storzReq, evaluation.detail);
            status = overridden.status;
            detail = overridden.detail;
          } else {
            if (status === 'VENCIDO') expiredCount++;
            else warningCount++;
          }
        } else {
          validCount++;
        }
      }

      if (!isModalityCompliant) {
        detail += ` ⚠️ ALERTA MODALIDADE: Requerido ${requiredModality}, mas certificado é ${actualModality}`;
      }

      return {
        code,
        reqName,
        status,
        requiredModality,
        actualModality,
        isModalityCompliant,
        hasDriveDoc: !!cert,
        storzRequestFound: storzReq
          ? {
              requestId: storzReq.id,
              state: storzReq.state,
              requestDate: storzReq.requestDate,
              notes: storzReq.notes
            }
          : undefined,
        detail
      };
    });

    let overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO';

    if (missingCount === 0 && expiredCount === 0) {
      if (warningCount === 0 && storzPendingCount === 0 && storzInProgressCount === 0) {
        overallStatus = 'APTO';
      } else {
        overallStatus = 'APTO_COM_ATENCAO';
      }
    } else {
      overallStatus = 'INAPTO';
    }

    return {
      inspectorName: inspector.name,
      parkName: park.parkName,
      clientName: park.clientName,
      overallStatus,
      missingDocsCount: missingCount,
      expiredDocsCount: expiredCount,
      warningDocsCount: warningCount,
      storzPendingCount,
      storzInProgressCount,
      validDocsCount: validCount,
      auditItems
    };
  }
}
