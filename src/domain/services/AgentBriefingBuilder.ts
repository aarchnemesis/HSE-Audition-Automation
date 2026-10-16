import { StorzRequest } from '../models/StorzRequest.js'
import { DOC_CATALOG_MAP } from './ComplianceEngine.js'
import {
  SegmentKPIs,
  calculateExecutiveKPIs,
  getCollabOperationalHealth,
} from './ExecutiveDashboardCalculator.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'
import {
  TrainingPaceCategory,
  analyzeTrainingPace,
} from './TrainingPaceCalculator.js'

/**
 * Resumo operacional para o agente (Prometheus): aptidão de campo, treinamentos ativos e SLA da
 * Storz, calculados com as mesmas regras do dashboard executivo. O agente só formata; nenhuma
 * regra de aptidão ou SLA é reimplementada do lado dele.
 */
export const AGENT_BRIEFING_VERSION = 1

const FRONTLINE_ROLES = ['IQ', 'IE', 'TO']
const SOON_STATUSES = ['VENCE_07', 'VENCE_15', 'VENCE_30']
const DAY_MS = 24 * 60 * 60 * 1000
/** Gravidade para ordenar matrículas fora do ritmo: a primeira da lista é a mais urgente. */
const PACE_SEVERITY: TrainingPaceCategory[] = [
  'RISCO_REPROVACAO',
  'CRITICO_INERCIA',
  'RITMO_LENTO',
  'ATENCAO_INERCIA',
]

export interface BriefingDocItem {
  code: string
  name: string
  status: string
  expirationDate?: string
}

export interface BriefingPerson {
  name: string
  role: string
  branch?: string
  items: BriefingDocItem[]
  /** Matrículas ativas na Storz (não iniciadas ou em andamento) da pessoa. */
  activeTrainings: number
}

export interface BriefingTraining {
  name: string
  role?: string
  course: string
  situation: string
  progressPercent: number
  pace: TrainingPaceCategory
  elapsedDays: number
  remainingDays: number | null
  deadline?: string
  idealSlaDays: number
  detail: string
}

export interface AgentBriefing {
  version: number
  generatedAt: string
  refDate: string
  sources: Record<string, { status: string; message: string }>
  fieldReadiness: {
    frontline: SegmentKPIs
    leaders: SegmentKPIs
    office: SegmentKPIs
    byRole: Record<
      string,
      { total: number; apto: number; alerta: number; bloqueado: number }
    >
    blocked: BriefingPerson[]
    attention: BriefingPerson[]
    /** Mobilizáveis hoje com requisito obrigatório vencendo em até 30 dias (ASO incluso). */
    blockingSoon: BriefingPerson[]
  }
  trainings: {
    active: {
      total: number
      notStarted: number
      inProgress: number
      collaborators: number
    }
    paceCounts: Partial<Record<TrainingPaceCategory, number>>
    outsideSla: number
    deadlineWithin15Days: number
    atRisk: BriefingTraining[]
    last30Days: {
      completed: number
      withinIdealSla: number
      withinStorzDeadline: number
      medianDays: number | null
      /** Reprovados (exame ou prazo expirado). Cancelados não entram: a Storz não traz a data. */
      failed: number
    }
    /** Matrículas de quem não está na base (desligados, nome divergente): fora das contas acima. */
    ignoredNotInBase: number
  }
}

function docItem(r: HSEDatabaseRecord): BriefingDocItem {
  return {
    code: r.docCode,
    name: r.docName || DOC_CATALOG_MAP[r.docCode] || r.docCode,
    status: r.statusEHS,
    expirationDate: r.expirationDate,
  }
}

function isoDay(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString().slice(0, 10) : undefined
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildAgentBriefing(
  records: HSEDatabaseRecord[],
  storzRequests: StorzRequest[],
  options: {
    refDate?: Date
    sourceHealth?: Record<
      string,
      { status: string; message: string } | undefined
    >
  } = {}
): AgentBriefing {
  const refDate = options.refDate || new Date()

  const people = new Map<
    string,
    { role: string; rpoBranch?: string; records: HSEDatabaseRecord[] }
  >()
  for (const r of records) {
    if (!people.has(r.inspectorName)) {
      people.set(r.inspectorName, {
        role: r.role,
        rpoBranch: r.rpoBranch,
        records: [],
      })
    }
    people.get(r.inspectorName)!.records.push(r)
  }

  const activeRequests = storzRequests.filter(
    s =>
      people.has(s.collaboratorName) &&
      (s.state === 'SOLICITADO' || s.state === 'EM_ANDAMENTO')
  )
  const activeByPerson = new Map<string, number>()
  for (const s of activeRequests) {
    activeByPerson.set(
      s.collaboratorName,
      (activeByPerson.get(s.collaboratorName) || 0) + 1
    )
  }

  // ---- Aptidão de campo
  const kpis = calculateExecutiveKPIs(records)
  const byRole: AgentBriefing['fieldReadiness']['byRole'] = {}
  const blocked: BriefingPerson[] = []
  const attention: BriefingPerson[] = []
  const blockingSoon: BriefingPerson[] = []

  for (const [name, person] of people) {
    if (!FRONTLINE_ROLES.includes(person.role)) continue
    const health = getCollabOperationalHealth(person)
    const roleStats = (byRole[person.role] ||= {
      total: 0,
      apto: 0,
      alerta: 0,
      bloqueado: 0,
    })
    roleStats.total++
    if (health.status === 'APTO') roleStats.apto++
    else if (health.status === 'ALERTA') roleStats.alerta++
    else if (health.status === 'BLOQUEADO') roleStats.bloqueado++

    const base = {
      name,
      role: person.role,
      branch: person.rpoBranch,
      activeTrainings: activeByPerson.get(name) || 0,
    }

    if (health.status === 'BLOQUEADO') {
      blocked.push({
        ...base,
        items: [
          ...health.expiredItems.map(docItem),
          ...health.missingItems.map(m => ({
            code: m.docCode,
            name: DOC_CATALOG_MAP[m.docCode] || m.docCode,
            status: 'AUSENTE',
          })),
        ],
      })
      continue
    }

    if (health.status === 'ALERTA') {
      attention.push({
        ...base,
        items: [...health.storzInProgressItems, ...health.alertItems].map(
          docItem
        ),
      })
    }

    // alertItems deixa o ASO de fora de propósito; aqui ele conta, porque ASO vencido bloqueia
    const soon = [
      ...health.alertItems.filter(r => SOON_STATUSES.includes(r.statusEHS)),
      ...person.records.filter(
        r => r.docCode === '01' && SOON_STATUSES.includes(r.statusEHS)
      ),
    ]
    if (soon.length > 0)
      blockingSoon.push({ ...base, items: soon.map(docItem) })
  }

  const byExpiration = (a: BriefingPerson, b: BriefingPerson) =>
    (a.items[0]?.expirationDate || '').localeCompare(
      b.items[0]?.expirationDate || ''
    )
  blockingSoon.forEach(p =>
    p.items.sort((a, b) =>
      (a.expirationDate || '').localeCompare(b.expirationDate || '')
    )
  )
  blockingSoon.sort(byExpiration)

  // ---- Treinamentos ativos e SLA
  const paceCounts: Partial<Record<TrainingPaceCategory, number>> = {}
  const atRisk: BriefingTraining[] = []
  let outsideSla = 0
  let deadlineWithin15Days = 0

  for (const s of activeRequests) {
    const pace = analyzeTrainingPace(s, refDate)
    paceCounts[pace.paceCategory] = (paceCounts[pace.paceCategory] || 0) + 1
    if (pace.isOutSideSla) outsideSla++
    if (
      pace.storzRemainingDays !== null &&
      pace.storzRemainingDays >= 0 &&
      pace.storzRemainingDays <= 15
    ) {
      deadlineWithin15Days++
    }
    if (PACE_SEVERITY.includes(pace.paceCategory)) {
      atRisk.push({
        name: s.collaboratorName,
        role: people.get(s.collaboratorName)?.role,
        course: s.trainingName,
        situation: s.rawSituacao || s.state,
        progressPercent: s.progressPercent || 0,
        pace: pace.paceCategory,
        elapsedDays: pace.elapsedDays,
        remainingDays: pace.storzRemainingDays,
        deadline: isoDay(pace.storzDeadlineDate),
        idealSlaDays: pace.idealSlaDays,
        detail: pace.formattedDetail,
      })
    }
  }
  atRisk.sort(
    (a, b) =>
      PACE_SEVERITY.indexOf(a.pace) - PACE_SEVERITY.indexOf(b.pace) ||
      (a.remainingDays ?? Infinity) - (b.remainingDays ?? Infinity)
  )

  const since = refDate.getTime() - 30 * DAY_MS
  const closedRecently = storzRequests.filter(s => {
    if (!people.has(s.collaboratorName)) return false
    const closedAt = s.completionDate
      ? new Date(s.completionDate).getTime()
      : NaN
    return closedAt >= since && closedAt <= refDate.getTime()
  })
  const completed = closedRecently.filter(s => s.state === 'CONCLUIDO')
  const durations = completed.map(s =>
    Math.max(
      0,
      Math.round(
        (new Date(s.completionDate!).getTime() -
          new Date(s.requestDate).getTime()) /
          DAY_MS
      )
    )
  )
  const idealSla = completed.map(
    s => analyzeTrainingPace(s, refDate).idealSlaDays
  )

  return {
    version: AGENT_BRIEFING_VERSION,
    generatedAt: new Date().toISOString(),
    refDate: isoDay(refDate)!,
    sources: Object.fromEntries(
      Object.entries(options.sourceHealth || {})
        .filter(([, v]) => v)
        .map(([k, v]) => [k, { status: v!.status, message: v!.message }])
    ),
    fieldReadiness: {
      frontline: kpis.frontline,
      leaders: kpis.leaders,
      office: kpis.office,
      byRole,
      blocked,
      attention,
      blockingSoon,
    },
    trainings: {
      active: {
        total: activeRequests.length,
        notStarted: activeRequests.filter(s => s.state === 'SOLICITADO').length,
        inProgress: activeRequests.filter(s => s.state === 'EM_ANDAMENTO')
          .length,
        collaborators: activeByPerson.size,
      },
      paceCounts,
      outsideSla,
      deadlineWithin15Days,
      atRisk,
      last30Days: {
        completed: completed.length,
        withinIdealSla: durations.filter((d, i) => d <= idealSla[i]).length,
        withinStorzDeadline: completed.filter(
          (s, i) => durations[i] <= (s.courseDurationDays || 60)
        ).length,
        medianDays: median(durations),
        failed: closedRecently.filter(s => /REPROV/i.test(s.rawSituacao || ''))
          .length,
      },
      ignoredNotInBase: storzRequests.filter(
        s => !people.has(s.collaboratorName)
      ).length,
    },
  }
}
