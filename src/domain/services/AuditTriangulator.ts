import { getValidityYearsForCode } from '../../adapters/drive/certificateFilenameParser.js'
import { EHSStatus, Inspector, ParkRequirement } from '../models/Certificate.js'
import { StorzRequest, computeCourseDeadline } from '../models/StorzRequest.js'
import {
  DOC_CATALOG_MAP,
  ELECTIVE_DOC_CODES,
  STORZ_SEARCHABLE_DOC_CODES,
  getTrainingModality,
} from './ComplianceEngine.js'
import { EHSEvaluator } from './EHSEvaluator.js'
import { findInspectorMatch } from './InspectorMatcher.js'

export interface TripleAuditResult {
  inspectorName: string
  parkName: string
  clientName: string
  overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO'
  missingDocsCount: number
  expiredDocsCount: number
  warningDocsCount: number
  storzPendingCount: number
  /** Cursos com solicitação na Storz já iniciada (tem data de início) mas ainda não concluída */
  storzInProgressCount: number
  validDocsCount: number
  auditItems: {
    code: string
    reqName: string
    status: EHSStatus
    requiredModality?: string
    actualModality?: string
    isModalityCompliant: boolean
    hasDriveDoc: boolean
    expirationDate?: Date
    storzProgressPercent?: number
    storzDeadline?: Date
    storzRequestFound?: {
      requestId: string
      state: string
      requestDate: Date
      notes?: string
      progressPercent?: number
      deadline?: Date
    }
    detail: string
  }[]
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
    let missingCount = 0
    let expiredCount = 0
    let warningCount = 0
    let storzPendingCount = 0
    let storzInProgressCount = 0
    let validCount = 0

    const inspectorStorzReqs = findInspectorMatch(
      inspector,
      storzRequests,
      r => r.collaboratorName,
      r => r.collaboratorCpf
    )

    // Perfil específico (ex.: COORDENADOR) pode ter seu próprio conjunto de códigos eletivos —
    // ver ParkRequirement.electiveDocCodes. Sem override, usa o padrão global (Vestas/Elevador/CIPA).
    const electiveCodes = park.electiveDocCodes
      ? new Set(park.electiveDocCodes)
      : ELECTIVE_DOC_CODES

    const auditItems = park.requiredDocCodes.map(code => {
      const reqName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`
      const cert = inspector.certificates.get(code)

      const requiredModality = park.requiredModalities
        ? park.requiredModalities[code]
        : undefined
      const derivedModality = getTrainingModality(code, reqName)
      const actualModality =
        code === '25' || code === '26' || code === '31'
          ? 'ONLINE'
          : cert?.modality || derivedModality

      let isModalityCompliant = true
      if (requiredModality && requiredModality !== actualModality) {
        isModalityCompliant = false
      }

      // A Storz é uma empresa de treinamentos normativos — não faz sentido buscar lá documentos
      // pessoais/médicos (ASO, CTPS, vacina), de trânsito (CNH) ou certificações de terceiros
      // (SIT/ESO Vestas, WINDA). Pra esses, nem tentamos casar com solicitação na Storz.
      const matchingStorzReqs = STORZ_SEARCHABLE_DOC_CODES.has(code)
        ? inspectorStorzReqs.filter(
            sr => sr.trainingCode === code && sr.state !== 'CANCELADO'
          )
        : []

      // Curso mais recente concluído e aprovado na Storz
      const completedReq = matchingStorzReqs
        .filter(sr => sr.state === 'CONCLUIDO')
        .sort((a, b) => {
          const timeA = a.completionDate?.getTime() ?? a.requestDate.getTime()
          const timeB = b.completionDate?.getTime() ?? b.requestDate.getTime()
          return timeB - timeA
        })[0]

      // Solicitação em andamento ou pendente mais recente
      const activeReq = matchingStorzReqs
        .filter(sr => sr.state === 'EM_ANDAMENTO' || sr.state === 'SOLICITADO')
        .sort((a, b) => b.requestDate.getTime() - a.requestDate.getTime())[0]

      let storzCompletionDate: Date | undefined
      let storzExpDate: Date | undefined

      if (completedReq) {
        storzCompletionDate =
          completedReq.completionDate || completedReq.requestDate
        if (storzCompletionDate && !isNaN(storzCompletionDate.getTime())) {
          storzExpDate = EHSEvaluator.calculateExpirationFromIssue(
            storzCompletionDate,
            getValidityYearsForCode(code)
          )
        }
      }

      let status: EHSStatus = 'AUSENTE'
      let detail = ''
      let effectiveExpiration: Date | undefined

      // Se o curso foi concluído e aprovado na Storz, consideramos a Storz quando não há documento no Drive
      // ou quando a conclusão na Storz é mais recente que o documento existente no Drive (renovação).
      const preferStorz =
        Boolean(completedReq && storzExpDate) &&
        (!cert ||
          !cert.expirationDate ||
          storzExpDate!.getTime() > cert.expirationDate.getTime())

      let storzProgressPercent: number | undefined
      let storzDeadline: Date | undefined

      if (completedReq) {
        storzProgressPercent = 100
      } else if (activeReq) {
        storzProgressPercent = activeReq.progressPercent ?? 0
        storzDeadline = computeCourseDeadline(activeReq)
      }

      const formatPaceNotice = (
        active: StorzRequest,
        certDate?: Date
      ): string => {
        const prog =
          active.progressPercent !== undefined
            ? `${active.progressPercent}%`
            : '0%'
        const dl = computeCourseDeadline(active)
        const dlStr = dl ? dl.toLocaleDateString('pt-BR') : undefined
        if (certDate && dl && certDate.getTime() < dl.getTime()) {
          return ` | EM ANDAMENTO NA STORZ (${active.id} - Progresso: ${prog}) [Prazo Storz: ${dlStr}]. ATENÇÃO AO RITMO: o certificado vence em ${certDate.toLocaleDateString('pt-BR')}, ANTES do prazo da Storz (${dlStr})!`
        }
        if (dlStr) {
          return ` | EM ANDAMENTO NA STORZ (${active.id} - Progresso: ${prog}) [Prazo Storz: ${dlStr}] — o prazo que vale é o vencimento do documento.`
        }
        return ` | EM ANDAMENTO NA STORZ (${active.id} - Progresso: ${prog}) — o prazo que vale é o vencimento do documento.`
      }

      if (preferStorz && storzExpDate) {
        effectiveExpiration = storzExpDate
        const evaluation = EHSEvaluator.evaluateDate(storzExpDate, refDate)
        status = evaluation.status
        const completionStr = storzCompletionDate?.toLocaleDateString('pt-BR')
        const expStr = storzExpDate.toLocaleDateString('pt-BR')

        if (status === 'CONFORME') {
          validCount++
          detail = cert
            ? `Curso renovado e aprovado na Storz (${completedReq!.id}) em ${completionStr} — Válido até ${expStr} (aguardando upload no Drive).`
            : `Curso concluído e aprovado na Storz (${completedReq!.id}) em ${completionStr} — Válido até ${expStr} (aguardando upload no Drive).`
        } else if (status === 'VENCIDO') {
          expiredCount++
          detail = `${evaluation.detail} | Concluído na Storz (${completedReq!.id}) em ${completionStr} (aguardando upload no Drive).`
        } else {
          warningCount++
          detail = `${evaluation.detail} | Concluído na Storz (${completedReq!.id}) em ${completionStr} (aguardando upload no Drive).`
        }

        if (activeReq) {
          detail += ` | Próxima reciclagem já solicitada na Storz (${activeReq.id} - Status: ${activeReq.state}).`
        }
      } else if (cert) {
        effectiveExpiration = cert.expirationDate
        const evaluation = EHSEvaluator.evaluateDate(
          cert.expirationDate,
          refDate
        )
        status = evaluation.status
        detail = evaluation.detail

        if (status === 'CONFORME') {
          validCount++
          if (activeReq) {
            detail += ` | Reciclagem já solicitada na Storz (${activeReq.id} - Status: ${activeReq.state}).`
          }
        } else if (status === 'VENCIDO') {
          expiredCount++
          if (activeReq) {
            if (activeReq.state === 'EM_ANDAMENTO') {
              storzInProgressCount++
              detail += formatPaceNotice(activeReq, cert.expirationDate)
            } else {
              storzPendingCount++
              detail += ` | SOLICITADO NA STORZ (${activeReq.id} - Não iniciado / 0% de progresso) — o prazo que vale é o vencimento do documento.`
            }
          }
        } else {
          warningCount++
          if (activeReq) {
            if (activeReq.state === 'EM_ANDAMENTO') {
              storzInProgressCount++
              detail += formatPaceNotice(activeReq, cert.expirationDate)
            } else {
              storzPendingCount++
              detail += ` | SOLICITADO NA STORZ (${activeReq.id} - Não iniciado / 0% de progresso) — o prazo que vale é o vencimento do documento.`
            }
          }
        }
      } else {
        if (activeReq) {
          if (activeReq.state === 'EM_ANDAMENTO') {
            storzInProgressCount++
            status = 'STORZ_EM_ANDAMENTO'
            const prog =
              activeReq.progressPercent !== undefined
                ? `${activeReq.progressPercent}%`
                : '0%'
            const dl = computeCourseDeadline(activeReq)
            const dlStr = dl
              ? ` [Prazo Storz: ${dl.toLocaleDateString('pt-BR')}]`
              : ''
            detail = `Documento ausente no Drive, mas EM ANDAMENTO NA STORZ (${activeReq.id} - Progresso: ${prog})${dlStr}.`
          } else {
            storzPendingCount++
            status = 'SOLICITADO_STORZ'
            detail = `Documento ausente no Drive, mas SOLICITADO NA STORZ (${activeReq.id} - Não iniciado / 0% de progresso).`
          }
        } else {
          status = 'AUSENTE'
          if (electiveCodes.has(code)) {
            detail =
              'Documento eletivo/monitorado não encontrado no Drive — não é cobrado como pendência.'
          } else if (STORZ_SEARCHABLE_DOC_CODES.has(code)) {
            detail =
              'Documento obrigatório não encontrado no Drive nem solicitado na Storz.'
            missingCount++
          } else {
            detail = 'Documento obrigatório não encontrado no Drive.'
            missingCount++
          }
        }
      }

      const primaryStorzReq = preferStorz
        ? completedReq
        : activeReq || completedReq

      if (!isModalityCompliant) {
        detail += ` ALERTA MODALIDADE: Requerido ${requiredModality}, mas certificado é ${actualModality}`
      }

      return {
        code,
        reqName,
        status,
        requiredModality,
        actualModality,
        isModalityCompliant,
        hasDriveDoc: !!cert,
        expirationDate: effectiveExpiration,
        storzProgressPercent,
        storzDeadline,
        storzRequestFound: primaryStorzReq
          ? {
              requestId: primaryStorzReq.id,
              state: primaryStorzReq.state,
              requestDate: primaryStorzReq.requestDate,
              notes: primaryStorzReq.notes,
              progressPercent: storzProgressPercent,
              deadline: storzDeadline,
            }
          : undefined,
        detail,
      }
    })

    let overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO'

    if (missingCount === 0 && expiredCount === 0) {
      if (
        warningCount === 0 &&
        storzPendingCount === 0 &&
        storzInProgressCount === 0
      ) {
        overallStatus = 'APTO'
      } else {
        overallStatus = 'APTO_COM_ATENCAO'
      }
    } else {
      overallStatus = 'INAPTO'
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
      auditItems,
    }
  }
}
