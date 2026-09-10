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
  | 'DRIVE_SEM_DATA'
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
  /** Indica qual ponta tem a data mais recente quando há divergência */
  direction?: 'RPO_NEWER' | 'DRIVE_NEWER'
  /** Indica se a divergência decorre de provável inversão de dia/mês (DD/MM vs MM/DD) */
  isSwappedDayMonth?: boolean
  detail: string
  diffDays?: number
  recommendedAction?: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// Tolerância para acomodar variações operacionais legítimas (ex.: turmas modulares de 3 a 5 dias,
// assinaturas digitais via Clicksign feitas poucos dias após o curso, e anos bissextos)
const DATE_TOLERANCE_DAYS = 5

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
        const trustedSource: TrustedSource | undefined = driveCert
          ? 'DRIVE'
          : storzExpiration
            ? 'STORZ'
            : undefined

        if (!driveCert && !storzExpiration && !rpoCert?.expirationDate) continue

        const docName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`

        // Caso 1: Drive ou Storz tem data, mas RPO não tem nada registrado
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

        // Caso 2: Certificado físico existe no Drive, mas SEM data de validade identificada
        if (driveCert && !driveCert.expirationDate && !storzExpiration) {
          if (rpoCert?.expirationDate) {
            items.push({
              inspectorName: driveInspector.name,
              docCode: code,
              docName,
              driveExpiration: undefined,
              trustedSource: 'DRIVE',
              rpoExpiration: rpoCert.expirationDate,
              divergent: true,
              divergenceKind: 'DRIVE_SEM_DATA',
              detail: `Certificado presente no Drive (${driveCert.filename || 'anexo'}), porém data de validade não identificada no arquivo. RPO registra ${this.formatDate(rpoCert.expirationDate)}.`,
              recommendedAction: 'Conferir data no documento físico anexado',
            })
          } else {
            items.push({
              inspectorName: driveInspector.name,
              docCode: code,
              docName,
              driveExpiration: undefined,
              trustedSource: 'DRIVE',
              divergent: true,
              divergenceKind: 'SOMENTE_DRIVE',
              detail: `Certificado presente no Drive (${driveCert.filename || 'anexo'}), porém sem data identificada e sem registro na RPO.`,
              recommendedAction: 'Conferir data e incluir na RPO',
            })
          }
          continue
        }

        // Caso 3: RPO tem registro, mas NENHUM certificado no Drive nem curso na Storz encontrado
        if (!trustedExpiration && rpoCert?.expirationDate) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            rpoExpiration: rpoCert.expirationDate,
            divergent: true,
            divergenceKind: 'SOMENTE_RPO',
            direction: 'RPO_NEWER',
            detail: `Registro presente na planilha RPO (${this.formatDate(rpoCert.expirationDate)}), mas nenhum certificado no Drive nem curso concluído na Storz encontrado.`,
            recommendedAction:
              'Checar documento físico e fazer upload do backup no Drive',
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
          const isRpoNewer =
            rpoCert!.expirationDate!.getTime() > trustedExpiration!.getTime()
          const sourceName = trustedSource === 'STORZ' ? 'Storz' : 'Drive'
          const direction: 'RPO_NEWER' | 'DRIVE_NEWER' = isRpoNewer
            ? 'RPO_NEWER'
            : 'DRIVE_NEWER'

          // Verificar se a divergência decorre de provável inversão de dia/mês (DD/MM vs MM/DD)
          // comum ao preencher Smartsheet com locale em inglês (ex.: 04/09 vs 09/04)
          const tParts = this.extractCalendarParts(trustedExpiration!)
          const rParts = this.extractCalendarParts(rpoCert!.expirationDate!)

          const isSwappedDayMonth =
            tParts.year === rParts.year &&
            tParts.day === rParts.month &&
            tParts.month === rParts.day &&
            tParts.day !== tParts.month

          let detail: string
          let recommendedAction: string

          if (isSwappedDayMonth) {
            detail = `Provável inversão de dia/mês (DD/MM vs MM/DD) ao preencher a planilha RPO: ${this.formatDate(trustedExpiration!)} no ${sourceName} vs ${this.formatDate(rpoCert!.expirationDate!)} na RPO.`
            recommendedAction = `Corrigir inversão de dia/mês na RPO para ${this.formatDate(trustedExpiration!)}`
          } else if (isRpoNewer) {
            detail = `RPO mais recente que o ${sourceName} em ${roundedDiff} dia(s) (${this.formatDate(rpoCert!.expirationDate!)} na RPO vs ${this.formatDate(trustedExpiration!)} no ${sourceName}) — provável renovação registrada na RPO sem upload do novo documento de backup no Drive.`
            recommendedAction =
              'Checar documento físico e atualizar backup no Drive'
          } else {
            detail = `${sourceName} mais recente que a RPO em ${roundedDiff} dia(s) (${this.formatDate(trustedExpiration!)} no ${sourceName} vs ${this.formatDate(rpoCert!.expirationDate!)} na RPO) — certificado atualizado no Drive, mas planilha RPO desatualizada.`
            recommendedAction = `Atualizar data na RPO para ${this.formatDate(trustedExpiration!)}`
          }

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
            direction,
            isSwappedDayMonth,
            diffDays: roundedDiff,
            detail,
            recommendedAction,
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

  private static extractCalendarParts(d: Date): {
    day: number
    month: number
    year: number
  } {
    // Se foi criada como UTC (horas 12 ou 0), getUTCDate() preserva o dia intencional.
    // Se foi criada como horário local meia-noite (horas 0 local), getDate() preserva o dia intencional.
    if (d.getUTCHours() === 12 || d.toISOString().endsWith('T00:00:00.000Z')) {
      return {
        day: d.getUTCDate(),
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
      }
    }
    return {
      day: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    }
  }

  private static formatDate(d?: Date): string {
    if (!d) return ''
    const { day, month, year } = this.extractCalendarParts(d)
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
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
