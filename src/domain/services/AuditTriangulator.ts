import { Inspector, ParkRequirement, EHSStatus } from '../models/Certificate.js';
import { StorzRequest } from '../models/StorzRequest.js';
import { EHSEvaluator } from './EHSEvaluator.js';
import { DOC_CATALOG_MAP, STORZ_SEARCHABLE_DOC_CODES, ELECTIVE_DOC_CODES } from './ComplianceEngine.js';
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
        // Documento ausente = não existe um prazo real conhecido pra comparar. A Storz é a
        // única referência que temos, então aqui SIM ela vira o status principal.
        if (storzReq) {
          if (storzReq.state === 'EM_ANDAMENTO') {
            storzInProgressCount++;
            status = 'STORZ_EM_ANDAMENTO';
            detail = `Documento ausente no Drive, mas EM ANDAMENTO NA STORZ, curso iniciado mas ainda não concluído (${storzReq.id}).`;
          } else {
            storzPendingCount++;
            status = 'SOLICITADO_STORZ';
            detail = `Documento ausente no Drive, mas SOLICITADO NA STORZ (${storzReq.id} - Status: ${storzReq.state}).`;
          }
        } else {
          status = 'AUSENTE';

          if (ELECTIVE_DOC_CODES.has(code)) {
            // Eletivo (ex.: SIT/ESO Vestas): não ter ainda não é uma pendência — só aparece na
            // planilha pra visibilidade, sem contar pra INAPTO e sem entrar no alerta por e-mail.
            detail = 'Documento eletivo não encontrado no Drive — depende do cliente/parque, a verificar quando a pessoa for alocada. Não é cobrado como pendência.';
          } else if (STORZ_SEARCHABLE_DOC_CODES.has(code)) {
            detail = 'Documento obrigatório não encontrado no Drive nem solicitado na Storz.';
            missingCount++;
          } else {
            // Documentos que a Storz nunca administra (ASO, CNH etc.) — não faz sentido dizer
            // "nem na Storz" já que ela nunca foi (nem seria) consultada pra esses.
            detail = 'Documento obrigatório não encontrado no Drive.';
            missingCount++;
          }
        }
      } else {
        const evaluation = EHSEvaluator.evaluateDate(cert.expirationDate, refDate);
        status = evaluation.status;
        detail = evaluation.detail;

        // O prazo real é sempre o do próprio documento (data de vencimento), NUNCA o prazo
        // interno da Storz pra concluir o curso (ex.: Storz dá até 60 dias pro aluno concluir,
        // mas se o documento já vence em 30, o prazo que importa é 30 — a Storz só informa "já
        // está em andamento", não estende o vencimento). Por isso, quando o documento vence ou
        // já venceu, mantemos o status de urgência real (VENCE_07/15/30/60/VENCIDO) mesmo que
        // haja solicitação ativa na Storz — só anexamos a informação no detalhe e contamos à
        // parte, sem esconder a urgência.
        if (['VENCIDO', 'VENCE_07', 'VENCE_15', 'VENCE_30', 'VENCE_60'].includes(status)) {
          if (status === 'VENCIDO') expiredCount++;
          else warningCount++;

          if (storzReq) {
            if (storzReq.state === 'EM_ANDAMENTO') {
              storzInProgressCount++;
              detail += ` | 🟣 EM ANDAMENTO NA STORZ, curso iniciado mas ainda não concluído (${storzReq.id}) — o prazo que vale é o vencimento do documento, não o prazo interno da Storz para concluir o curso.`;
            } else {
              storzPendingCount++;
              detail += ` | 🔵 SOLICITADO NA STORZ (${storzReq.id} - Status: ${storzReq.state}) — o prazo que vale é o vencimento do documento, não o prazo interno da Storz para concluir o curso.`;
            }
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
