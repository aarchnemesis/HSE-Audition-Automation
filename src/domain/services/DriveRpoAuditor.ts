import {
  EVENT_TRIGGERED_ONLY_CODES,
  getValidityYearsForCode,
} from '../../adapters/drive/certificateFilenameParser.js'
import { Inspector } from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import {
  DOC_CATALOG_MAP,
  STORZ_SEARCHABLE_DOC_CODES,
} from './ComplianceEngine.js'
import { EHSEvaluator } from './EHSEvaluator.js'
import { findInspectorMatch, matchesInspector } from './InspectorMatcher.js'

export type DriveRpoDivergenceKind =
  | 'SOMENTE_DRIVE'
  | 'SOMENTE_STORZ'
  | 'SOMENTE_RPO'
  | 'DATA_DIVERGENTE'
export type TrustedSource = 'DRIVE' | 'STORZ'

export interface DriveRpoComparisonItem {
  inspectorName: string
  docCode: string
  docName: string
  driveExpiration?: Date
  /** Validade estimada a partir da conclusão do curso na Storz (data de conclusão + anos de
   *  validade do documento) — é uma aproximação, não a validade gravada num documento real. */
  storzExpiration?: Date
  trustedSource?: TrustedSource
  rpoExpiration?: Date
  divergent: boolean
  divergenceKind?: DriveRpoDivergenceKind
  detail: string
  diffDays?: number
  recommendedAction?: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// Pequena tolerância pra não gerar ruído por diferença de 1 dia entre "data de emissão + validade
// calculada" (Drive) e a data-limite gravada manualmente na RPO — divergências reais tendem a ser
// de semanas/meses, não de 1-2 dias.
const DATE_TOLERANCE_DAYS = 2

export class DriveRpoAuditor {
  /**
   * Compara as fontes CONFIÁVEIS (Drive — documento real anexado; Storz — curso efetivamente
   * concluído na plataforma) com os registros DIGITADOS À MÃO na planilha RPO, pessoa por pessoa
   * e documento por documento. O objetivo é achar erro de digitação na RPO, não julgar quem está
   * "certo" — Drive e Storz são o que realmente aconteceu, RPO é o que alguém digitou.
   *
   * Quando as duas fontes confiáveis existem pro mesmo documento, o Drive tem prioridade (é o
   * documento real, a Storz só dá uma validade ESTIMADA a partir da data de conclusão do curso +
   * anos de validade do catálogo — pode não bater exatamente com a data gravada no documento real).
   *
   * SOMENTE LEITURA — não altera nada em nenhuma das três fontes.
   */
  static compare(
    driveInspectors: Inspector[],
    rpoInspectors: Inspector[],
    docCodes?: string[],
    storzRequests: StorzRequest[] = []
  ): DriveRpoComparisonItem[] {
    const items: DriveRpoComparisonItem[] = []

    for (const driveInspector of driveInspectors) {
      const rpoInspector = rpoInspectors.find(r =>
        matchesInspector(driveInspector, r.name)
      )
      const inspectorStorzReqs = findInspectorMatch(
        driveInspector,
        storzRequests,
        r => r.collaboratorName,
        r => r.collaboratorCpf
      )

      const codesToCheck =
        docCodes || this.unionOfCodes(driveInspector, rpoInspector)

      for (const code of codesToCheck) {
        const driveCert = driveInspector.certificates.get(code)
        const rpoCert = rpoInspector?.certificates.get(code)
        const storzExpiration = this.estimateStorzExpiration(
          code,
          inspectorStorzReqs
        )

        const trustedExpiration = driveCert?.expirationDate ?? storzExpiration
        const trustedSource: TrustedSource | undefined =
          driveCert?.expirationDate
            ? 'DRIVE'
            : storzExpiration
              ? 'STORZ'
              : undefined

        if (!trustedExpiration && !rpoCert?.expirationDate) continue

        const docName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`

        if (trustedExpiration && !rpoCert?.expirationDate) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            driveExpiration: driveCert?.expirationDate,
            storzExpiration,
            trustedSource,
            divergent: true,
            divergenceKind:
              trustedSource === 'STORZ' ? 'SOMENTE_STORZ' : 'SOMENTE_DRIVE',
            detail: `Curso/certificado confirmado via ${trustedSource === 'STORZ' ? 'Storz (conclusão de curso)' : 'Drive'}, mas sem registro correspondente na planilha RPO (${rpoInspector ? 'pessoa encontrada na RPO' : 'pessoa não encontrada na RPO'}).`,
            recommendedAction:
              trustedSource === 'STORZ'
                ? 'Incluir na RPO com base na Storz'
                : 'Incluir na RPO com base no Drive',
          })
          continue
        }

        if (!trustedExpiration && rpoCert?.expirationDate) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            rpoExpiration: rpoCert.expirationDate,
            divergent: true,
            divergenceKind: 'SOMENTE_RPO',
            detail:
              'Registro presente na planilha RPO, mas nenhum certificado no Drive nem curso concluído na Storz encontrado.',
            recommendedAction: 'Verificar ausência no Drive / Storz',
          })
          continue
        }

        // NR-01/NR-06 (event-triggered, sem periodicidade fixa) não têm data comparável entre as
        // fontes: o Drive usa uma validade de 50 anos como proxy de "não vence", a RPO tem uma
        // data real digitada com a regra padrão de 2 anos — comparar as duas sempre diverge em
        // ~17.500 dias, mesmo quando não há erro nenhum de digitação. Pra esses dois, só a
        // presença em ambas as fontes importa.
        if (EVENT_TRIGGERED_ONLY_CODES.includes(code)) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            driveExpiration: driveCert?.expirationDate,
            storzExpiration,
            trustedSource,
            rpoExpiration: rpoCert!.expirationDate,
            divergent: false,
            detail: `${trustedSource === 'STORZ' ? 'Storz' : 'Drive'} e RPO têm o documento — sem comparação de data (evento-gatilho, não periódico).`,
            recommendedAction: 'Nenhuma ação necessária (Consistente)',
          })
          continue
        }

        // As duas pontas têm data — compara com tolerância
        const diffDays =
          Math.abs(
            trustedExpiration!.getTime() - rpoCert!.expirationDate!.getTime()
          ) / ONE_DAY_MS
        const roundedDiff = Math.round(diffDays)
        if (diffDays > DATE_TOLERANCE_DAYS) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            driveExpiration: driveCert?.expirationDate,
            storzExpiration,
            trustedSource,
            rpoExpiration: rpoCert!.expirationDate,
            divergent: true,
            divergenceKind: 'DATA_DIVERGENTE',
            diffDays: roundedDiff,
            detail: `Datas de validade divergem em ${roundedDiff} dia(s) entre ${trustedSource === 'STORZ' ? 'Storz (estimado pela conclusão do curso)' : 'Drive'} e RPO — provável erro de digitação na RPO.`,
            recommendedAction: `Corrigir data na RPO para ${this.formatDate(trustedExpiration!)}`,
          })
          continue
        }

        items.push({
          inspectorName: driveInspector.name,
          docCode: code,
          docName,
          driveExpiration: driveCert?.expirationDate,
          storzExpiration,
          trustedSource,
          rpoExpiration: rpoCert!.expirationDate,
          divergent: false,
          diffDays: roundedDiff,
          detail: `${trustedSource === 'STORZ' ? 'Storz' : 'Drive'} e RPO consistentes.`,
          recommendedAction: 'Nenhuma ação necessária (Consistente)',
        })
      }
    }

    return items
  }

  private static formatDate(d?: Date): string {
    if (!d) return ''
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  }

  /** Validade ESTIMADA a partir do curso concluído mais recente na Storz pra esse código de
   *  documento — data de conclusão + anos de validade do catálogo. Só se aplica a documentos que
   *  a Storz realmente administra (normativos); ver STORZ_SEARCHABLE_DOC_CODES. */
  private static estimateStorzExpiration(
    code: string,
    storzReqs: StorzRequest[]
  ): Date | undefined {
    if (!STORZ_SEARCHABLE_DOC_CODES.has(code)) return undefined

    const completed = storzReqs
      .filter(
        r =>
          r.trainingCode === code && r.state === 'CONCLUIDO' && r.completionDate
      )
      .sort((a, b) => b.completionDate!.getTime() - a.completionDate!.getTime())

    if (!completed.length) return undefined

    return EHSEvaluator.calculateExpirationFromIssue(
      completed[0].completionDate!,
      getValidityYearsForCode(code)
    )
  }

  private static unionOfCodes(
    driveInspector: Inspector,
    rpoInspector: Inspector | undefined
  ): string[] {
    const codes = new Set<string>(driveInspector.certificates.keys())
    if (rpoInspector) {
      for (const code of rpoInspector.certificates.keys()) codes.add(code)
    }
    return Array.from(codes)
  }
}
