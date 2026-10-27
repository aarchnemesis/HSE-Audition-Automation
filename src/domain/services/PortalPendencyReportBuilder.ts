import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../models/PortalCensus.js'
import { ProjectAssignment } from '../models/ProjectAssignment.js'
import { CertificateClassifier } from './CertificateClassifier.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'
import { namesMatch, resolveTeam } from './PersonNameMatcher.js'
import {
  PortalInfo,
  clientKey,
  getPortal,
  portalsForClient,
} from './PortalCatalog.js'

const DAY_MS = 86_400_000

/**
 * RESUBMIT: the client rejected what was sent.
 * UPLOAD_FROM_BASE: the portal lacks a document we already hold valid in the HSE base.
 * OBTAIN: nothing valid on file, the document has to be produced (exam, course, signature).
 * RENEW: approved but expiring inside the alert window.
 */
export type ActionKind = 'RESUBMIT' | 'UPLOAD_FROM_BASE' | 'OBTAIN' | 'RENEW'

export type Clearance =
  | 'CLEARED'
  | 'WAITING_CLIENT'
  | 'BLOCKED'
  | 'NOT_REGISTERED'
  | 'NOT_MONITORED'

export interface BaseEvidence {
  docName: string
  expiresOn?: string
  url?: string
}

export interface ProjectRef {
  wo?: string
  client: string
  windfarm: string
  startDate?: string
  daysToStart?: number
}

export interface PortalAction {
  portalId: string
  portalName: string
  contract?: string
  worker: string
  document: string
  kind: ActionKind
  status: PortalDocStatus
  expiresOn?: string
  note?: string
  evidence?: BaseEvidence
  /** Nearest project in the window that sends this worker to this portal's client */
  project?: ProjectRef
  /** 1: on a project starting within the urgent window or already running; 2: later; 3: none */
  priority: 1 | 2 | 3
  /** False when the worker is not in the active HSE base: likely dismissed or a third party */
  onActiveRoster: boolean
}

export interface DocIssue {
  title: string
  status: PortalDocStatus
  expiresOn?: string
  note?: string
}

export interface MemberReadiness {
  name: string
  resolved: boolean
  clearance: Clearance
  portalName?: string
  blockers: DocIssue[]
  waiting: DocIssue[]
  expiring: DocIssue[]
}

export interface ProjectReadiness {
  project: ProjectRef & { scope?: string }
  monitored: { portal: PortalInfo; capturedAt: string }[]
  /** Portals the client also uses that we cannot read yet */
  unmonitored: PortalInfo[]
  members: MemberReadiness[]
}

export interface PortalSummary {
  portal: PortalInfo
  capturedAt: string
  workers: number
  cleared: number
  waiting: number
  blocked: number
  actions: Record<ActionKind, number>
}

export interface CoverageGap {
  client: string
  portals: PortalInfo[]
  projects: number
  people: number
  nextStart?: string
}

export interface PortalPendencyReport {
  refDate: string
  window: { lookbackDays: number; lookaheadDays: number; urgentDays: number }
  portals: PortalSummary[]
  actions: PortalAction[]
  projects: ProjectReadiness[]
  gaps: CoverageGap[]
}

export interface PortalReportInput {
  refDate: Date
  censuses: PortalCensus[]
  projects: ProjectAssignment[]
  baseRecords: HSEDatabaseRecord[]
  lookbackDays?: number
  lookaheadDays?: number
  urgentDays?: number
  expiringDays?: number
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS)
}

/** Expiry is recomputed against the report date: a snapshot from last week still reads right. */
export function effectiveStatus(
  doc: PortalDocument,
  refIso: string,
  expiringDays = 30
): PortalDocStatus {
  if (doc.status !== 'APPROVED' && doc.status !== 'EXPIRING') return doc.status
  if (!doc.expiresOn) return doc.status
  if (doc.expiresOn < refIso) return 'EXPIRED'
  if (daysBetween(refIso, doc.expiresOn) <= expiringDays) return 'EXPIRING'
  return 'APPROVED'
}

interface WorkerState {
  clearance: Exclude<Clearance, 'NOT_REGISTERED' | 'NOT_MONITORED'>
  blockers: DocIssue[]
  waiting: DocIssue[]
  expiring: DocIssue[]
}

function evaluateWorker(
  worker: PortalWorker,
  refIso: string,
  expiringDays: number
): WorkerState {
  const blockers: DocIssue[] = []
  const waiting: DocIssue[] = []
  const expiring: DocIssue[] = []
  const seen = new Set<string>()
  for (const doc of worker.documents) {
    const status = effectiveStatus(doc, refIso, expiringDays)
    // TDoc lists a requirement once per task the worker is on.
    const dedupe = `${doc.title}|${status}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const issue = {
      title: doc.title,
      status,
      expiresOn: doc.expiresOn,
      note: doc.note,
    }
    if (
      doc.required &&
      (status === 'MISSING' || status === 'REJECTED' || status === 'EXPIRED')
    )
      blockers.push(issue)
    else if (status === 'IN_REVIEW') waiting.push(issue)
    else if (status === 'EXPIRING') expiring.push(issue)
  }
  const clearance = blockers.length
    ? 'BLOCKED'
    : waiting.length
      ? 'WAITING_CLIENT'
      : 'CLEARED'
  return { clearance, blockers, waiting, expiring }
}

function servesClient(
  worker: PortalWorker,
  portal: PortalInfo,
  key: string
): boolean {
  return worker.client ? worker.client === key : portal.clients.includes(key)
}

const VALID_BASE_STATUSES = new Set([
  'CONFORME',
  'VENCE_60',
  'VENCE_30',
  'VENCE_15',
  'VENCE_07',
])

/**
 * Catalog code a portal requirement is satisfied by. The Drive classifier reads "Equipe de
 * emergência e salvamento NR-33" as plain NR-33 and "Espaço Confinado - Supervisor" as the
 * worker course; on a portal those are different requirements, and a wrong match would tell
 * the EHS team a document is on file when it is not.
 */
export function portalDocCode(title: string): string | null {
  const norm = title.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/emergencia|salvamento|resgate|brigada/i.test(norm)) return null
  if (/supervisor/i.test(norm) && /confinado|NR\s*-?\s*33/i.test(norm))
    return '28'
  return CertificateClassifier.classify(norm).code
}

class BaseEvidenceIndex {
  private byPerson = new Map<string, HSEDatabaseRecord[]>()

  constructor(
    records: HSEDatabaseRecord[],
    private refIso: string
  ) {
    for (const rec of records) {
      const list = this.byPerson.get(rec.inspectorName) ?? []
      list.push(rec)
      this.byPerson.set(rec.inspectorName, list)
    }
  }

  isOnRoster(workerName: string): boolean {
    for (const person of this.byPerson.keys())
      if (namesMatch(person, workerName)) return true
    return false
  }

  find(workerName: string, docTitle: string): BaseEvidence | undefined {
    const code = portalDocCode(docTitle)
    if (!code) return undefined
    for (const [person, records] of this.byPerson) {
      if (!namesMatch(person, workerName)) continue
      const rec = records.find(r => r.docCode === code)
      if (!rec || !VALID_BASE_STATUSES.has(rec.statusEHS)) return undefined
      const expiresOn = rec.expirationDate?.slice(0, 10)
      if (expiresOn && expiresOn < this.refIso) return undefined
      return {
        docName: rec.docName,
        expiresOn,
        url: rec.evidenceUrl ?? rec.driveFolderUrl,
      }
    }
    return undefined
  }
}

function actionFor(
  issue: DocIssue,
  evidence: BaseEvidence | undefined
): { kind: ActionKind; evidence?: BaseEvidence } | null {
  if (issue.status === 'REJECTED') return { kind: 'RESUBMIT', evidence }
  if (issue.status === 'MISSING' || issue.status === 'EXPIRED')
    return evidence
      ? { kind: 'UPLOAD_FROM_BASE', evidence }
      : { kind: 'OBTAIN' }
  if (issue.status === 'EXPIRING') {
    const newer =
      evidence?.expiresOn &&
      issue.expiresOn &&
      evidence.expiresOn > issue.expiresOn
    return newer ? { kind: 'UPLOAD_FROM_BASE', evidence } : { kind: 'RENEW' }
  }
  return null
}

interface WindowProject {
  assignment: ProjectAssignment
  key: string
  ref: ProjectRef
}

function projectsInWindow(
  projects: ProjectAssignment[],
  refIso: string,
  lookbackDays: number,
  lookaheadDays: number
): WindowProject[] {
  // The briefing repeats a WO when its start is rescheduled; keep the start closest to today.
  const byKey = new Map<string, WindowProject>()
  for (const p of projects) {
    if (!p.startDate || p.status === 'Vermelho') continue
    const daysToStart = daysBetween(refIso, p.startDate)
    if (daysToStart < -lookbackDays || daysToStart > lookaheadDays) continue
    const dedupe = [p.wo, p.client, p.windfarm, p.team].join('|')
    const current = byKey.get(dedupe)
    if (current && Math.abs(current.ref.daysToStart!) <= Math.abs(daysToStart))
      continue
    byKey.set(dedupe, {
      assignment: p,
      key: clientKey(p.client),
      ref: {
        wo: p.wo,
        client: p.client,
        windfarm: p.windfarm,
        startDate: p.startDate,
        daysToStart,
      },
    })
  }
  return Array.from(byKey.values()).sort((a, b) =>
    (a.ref.startDate ?? '').localeCompare(b.ref.startDate ?? '')
  )
}

const ACTION_ORDER: Record<ActionKind, number> = {
  RESUBMIT: 0,
  UPLOAD_FROM_BASE: 1,
  OBTAIN: 2,
  RENEW: 3,
}

export function buildPortalPendencyReport(
  input: PortalReportInput
): PortalPendencyReport {
  const refIso = isoDay(input.refDate)
  const lookbackDays = input.lookbackDays ?? 45
  const lookaheadDays = input.lookaheadDays ?? 60
  const urgentDays = input.urgentDays ?? 14
  const expiringDays = input.expiringDays ?? 30

  const censusByPortal = new Map(
    input.censuses.filter(c => getPortal(c.portalId)).map(c => [c.portalId, c])
  )
  const roster = [
    ...new Set([
      ...input.baseRecords.map(r => r.inspectorName),
      ...input.censuses.flatMap(c => c.workers.map(w => w.name)),
    ]),
  ]
  const evidence = new BaseEvidenceIndex(input.baseRecords, refIso)
  const window = projectsInWindow(
    input.projects,
    refIso,
    lookbackDays,
    lookaheadDays
  )

  const projects: ProjectReadiness[] = []
  // portalId -> worker name -> nearest project sending them to that portal's client
  const assignmentByWorker = new Map<string, Map<string, ProjectRef>>()

  for (const wp of window) {
    const portals = portalsForClient(wp.key)
    const monitored = portals
      .filter(p => censusByPortal.has(p.id))
      .map(p => ({
        portal: p,
        capturedAt: censusByPortal.get(p.id)!.capturedAt,
      }))
    const unmonitored = portals.filter(p => !censusByPortal.has(p.id))

    const members: MemberReadiness[] = resolveTeam(
      wp.assignment.team,
      roster
    ).map(member => {
      if (!monitored.length)
        return {
          name: member.name,
          resolved: member.resolved,
          clearance: 'NOT_MONITORED',
          blockers: [],
          waiting: [],
          expiring: [],
        }
      for (const { portal } of monitored) {
        const worker = censusByPortal
          .get(portal.id)!
          .workers.find(
            w =>
              servesClient(w, portal, wp.key) &&
              (namesMatch(w.name, member.name) ||
                namesMatch(w.name, member.raw))
          )
        if (!worker) continue
        const byWorker = assignmentByWorker.get(portal.id) ?? new Map()
        const current = byWorker.get(worker.name)
        if (
          !current ||
          Math.abs(wp.ref.daysToStart!) < Math.abs(current.daysToStart!)
        )
          byWorker.set(worker.name, wp.ref)
        assignmentByWorker.set(portal.id, byWorker)
        return {
          name: member.name,
          resolved: member.resolved,
          portalName: portal.name,
          ...evaluateWorker(worker, refIso, expiringDays),
        }
      }
      return {
        name: member.name,
        resolved: member.resolved,
        clearance: 'NOT_REGISTERED',
        blockers: [],
        waiting: [],
        expiring: [],
      }
    })

    projects.push({
      project: { ...wp.ref, scope: wp.assignment.scope },
      monitored,
      unmonitored,
      members,
    })
  }

  const actions: PortalAction[] = []
  const portals: PortalSummary[] = []

  for (const census of censusByPortal.values()) {
    const portal = getPortal(census.portalId)!
    const summary: PortalSummary = {
      portal,
      capturedAt: census.capturedAt,
      workers: census.workers.length,
      cleared: 0,
      waiting: 0,
      blocked: 0,
      actions: { RESUBMIT: 0, UPLOAD_FROM_BASE: 0, OBTAIN: 0, RENEW: 0 },
    }
    for (const worker of census.workers) {
      const state = evaluateWorker(worker, refIso, expiringDays)
      if (state.clearance === 'CLEARED') summary.cleared++
      else if (state.clearance === 'WAITING_CLIENT') summary.waiting++
      else summary.blocked++

      const project = assignmentByWorker.get(portal.id)?.get(worker.name)
      const priority: PortalAction['priority'] = !project
        ? 3
        : project.daysToStart! <= urgentDays
          ? 1
          : 2
      const onActiveRoster = evidence.isOnRoster(worker.name)
      for (const issue of [...state.blockers, ...state.expiring]) {
        const next = actionFor(issue, evidence.find(worker.name, issue.title))
        if (!next) continue
        summary.actions[next.kind]++
        actions.push({
          portalId: portal.id,
          portalName: portal.name,
          contract: worker.contract,
          worker: worker.name,
          document: issue.title,
          kind: next.kind,
          status: issue.status,
          expiresOn: issue.expiresOn,
          note: issue.note,
          evidence: next.evidence,
          project,
          priority,
          onActiveRoster,
        })
      }
    }
    portals.push(summary)
  }

  actions.sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.project?.startDate ?? '').localeCompare(b.project?.startDate ?? '') ||
      a.worker.localeCompare(b.worker) ||
      ACTION_ORDER[a.kind] - ACTION_ORDER[b.kind]
  )
  portals.sort((a, b) => b.blocked - a.blocked)

  const gapsByClient = new Map<string, CoverageGap>()
  for (const p of projects) {
    if (p.monitored.length) continue
    const key = clientKey(p.project.client)
    const gap = gapsByClient.get(key) ?? {
      client: p.project.client,
      portals: p.unmonitored,
      projects: 0,
      people: 0,
      nextStart: p.project.startDate,
    }
    gap.projects++
    gap.people += p.members.length
    gapsByClient.set(key, gap)
  }

  return {
    refDate: refIso,
    window: { lookbackDays, lookaheadDays, urgentDays },
    portals,
    actions,
    projects,
    gaps: Array.from(gapsByClient.values()),
  }
}
