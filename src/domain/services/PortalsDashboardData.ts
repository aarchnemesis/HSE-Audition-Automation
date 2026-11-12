import {
  ActionKind,
  Clearance,
  DocIssue,
  PortalAction,
  PortalPendencyReport,
  ProjectReadiness,
} from './PortalPendencyReportBuilder.js'

/**
 * View model for the "Portais de Clientes" dashboard tab.
 * Built only from the already-normalized pendency report: it carries no CPF (the census files do not
 * hold one) and keeps only the documents that need attention, so the page stays small.
 */

export type PortalChannelType = 'AUTOMATED' | 'PARTIAL' | 'MANUAL'
export type PortalProjectStatus = 'OK' | 'WAITING' | 'ATTENTION' | 'BLOCKED'
export type PortalCollaboratorStatus =
  | 'CLEARED'
  | 'WAITING_CLIENT'
  | 'BLOCKED'
  | 'INCOMPLETE'
  | 'NOT_REGISTERED'
  | 'NOT_MONITORED'
export type PortalDocView =
  | 'APPROVED'
  | 'IN_REVIEW'
  | 'EXPIRING'
  | 'MISSING'
  | 'EXPIRED'
  | 'REJECTED'

export interface PortalsDocumentView {
  docName: string
  status: PortalDocView
  expiryDate?: string
  /** What the client portal said, only for rejections */
  rejectionReason?: string
  /** Deterministic next step derived from the action kind, not free text */
  suggestedAction?: string
  actionKind?: ActionKind
  /** Valid copy we already hold in the HSE base, when the fix is just attaching it */
  driveUrl?: string
}

export interface PortalsCollaboratorView {
  name: string
  portal?: string
  overallStatus: PortalCollaboratorStatus
  /** Por que a leitura do portal não basta para liberar (INCOMPLETE) */
  incompleteReason?: string
  documents: PortalsDocumentView[]
}

export interface PortalsProjectView {
  projectName: string
  client: string
  wo?: string
  platforms: string[]
  channelType: PortalChannelType
  startDate?: string
  daysToStart?: number
  status: PortalProjectStatus
  counts: { cleared: number; waiting: number; blocked: number; other: number }
  collaborators: PortalsCollaboratorView[]
}

export interface PortalsPlatformView {
  id: string
  name: string
  automation: string
  /** ONLINE = census fresh, STALE = older than the freshness window */
  status: 'ONLINE' | 'STALE'
  capturedAt: string
  ageDays: number
  collaboratorsCount: number
  cleared: number
  waiting: number
  blocked: number
  /** Colaboradores com leitura incompleta neste portal */
  incomplete: number
  /** Documentos por colaborador que o portal costuma devolver */
  typicalDocs: number
}

export interface PortalsManualGap {
  client: string
  channel: string
  projects: number
  allocatedCount: number
  nextStart?: string
}

export interface PortalsDashboardData {
  updatedAt: string
  refDate: string
  summary: {
    totalProjects: number
    automatedProjects: number
    manualProjects: number
    automatedPct: number
    allocatedPeople: number
    blockedPeople: number
    /** Actions tied to a project in the window, i.e. people actually scheduled to go */
    scheduledActions: number
    /** Actions for people with no mobilization in the window (not urgent) */
    backlogActions: number
    /** Client rejections of scheduled people: the "fix before they travel" list */
    criticalRejections: number
  }
  platforms: PortalsPlatformView[]
  projects: PortalsProjectView[]
  manualGaps: PortalsManualGap[]
}

/** A census older than this is flagged STALE instead of ONLINE. */
export const CENSUS_FRESH_DAYS = 3

const DAY_MS = 86_400_000

const SUGGESTED_ACTION: Record<ActionKind, (a: PortalAction) => string> = {
  RESUBMIT: a =>
    `Reenviar ao ${a.portalName} o documento corrigido${a.note ? ` (motivo do cliente: ${a.note})` : ''}.`,
  UPLOAD_FROM_BASE: a =>
    `Já existe cópia válida na base HSE${a.evidence?.expiresOn ? ` (vence ${a.evidence.expiresOn})` : ''}: anexar no ${a.portalName}.`,
  OBTAIN: () =>
    'Sem documento válido em lugar nenhum: emitir (exame, curso ou assinatura) antes da mobilização.',
  RENEW: a =>
    `Renovar antes de vencer${a.expiresOn ? ` (${a.expiresOn})` : ''}.`,
}

function channelOf(p: ProjectReadiness): PortalChannelType {
  if (p.monitored.length === 0) return 'MANUAL'
  return p.unmonitored.length > 0 ? 'PARTIAL' : 'AUTOMATED'
}

function projectStatus(
  counts: PortalsProjectView['counts']
): PortalProjectStatus {
  if (counts.blocked > 0) return 'BLOCKED'
  if (counts.other > 0) return 'ATTENTION'
  if (counts.waiting > 0) return 'WAITING'
  return 'OK'
}

function docFromIssue(
  issue: DocIssue,
  action: PortalAction | undefined
): PortalsDocumentView {
  const doc: PortalsDocumentView = {
    docName: issue.title,
    status: issue.status === 'WAIVED' ? 'APPROVED' : issue.status,
  }
  if (issue.expiresOn) doc.expiryDate = issue.expiresOn
  if (issue.status === 'REJECTED' && issue.note)
    doc.rejectionReason = issue.note
  if (action) {
    doc.actionKind = action.kind
    doc.suggestedAction = SUGGESTED_ACTION[action.kind](action)
    if (action.evidence?.url) doc.driveUrl = action.evidence.url
  }
  return doc
}

export function buildPortalsDashboardData(
  report: PortalPendencyReport,
  now: Date = new Date()
): PortalsDashboardData {
  // worker+document -> action, to attach the next step and the Drive link to each issue
  const actionKey = (worker: string, doc: string) =>
    `${worker.toUpperCase()}|${doc.toUpperCase()}`
  const actionByKey = new Map<string, PortalAction>()
  for (const a of report.actions) {
    const k = actionKey(a.worker, a.document)
    const prev = actionByKey.get(k)
    if (!prev || a.priority < prev.priority) actionByKey.set(k, a)
  }

  const projects: PortalsProjectView[] = report.projects.map(p => {
    const counts = { cleared: 0, waiting: 0, blocked: 0, other: 0 }
    const collaborators: PortalsCollaboratorView[] = p.members.map(m => {
      if (m.clearance === 'CLEARED') counts.cleared++
      else if (m.clearance === 'WAITING_CLIENT') counts.waiting++
      else if (m.clearance === 'BLOCKED') counts.blocked++
      else counts.other++
      const issues = [...m.blockers, ...m.waiting, ...m.expiring]
      return {
        name: m.name,
        portal: m.portalName,
        overallStatus: m.clearance satisfies Clearance,
        ...(m.incompleteReason ? { incompleteReason: m.incompleteReason } : {}),
        documents: issues.map(i =>
          docFromIssue(i, actionByKey.get(actionKey(m.name, i.title)))
        ),
      }
    })
    return {
      projectName: p.project.windfarm,
      client: p.project.client,
      wo: p.project.wo,
      platforms: p.monitored.map(x => x.portal.name),
      channelType: channelOf(p),
      startDate: p.project.startDate,
      daysToStart: p.project.daysToStart,
      status: projectStatus(counts),
      counts,
      collaborators,
    }
  })

  // Most urgent first: blocked projects, then by start date
  const rank: Record<PortalProjectStatus, number> = {
    BLOCKED: 0,
    ATTENTION: 1,
    WAITING: 2,
    OK: 3,
  }
  projects.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.daysToStart ?? 9999) - (b.daysToStart ?? 9999)
  )

  const platforms: PortalsPlatformView[] = report.portals.map(s => {
    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - Date.parse(s.capturedAt)) / DAY_MS)
    )
    return {
      id: s.portal.id,
      name: s.portal.name,
      automation: s.portal.automation,
      status: ageDays <= CENSUS_FRESH_DAYS && !s.stale ? 'ONLINE' : 'STALE',
      capturedAt: s.capturedAt,
      ageDays,
      collaboratorsCount: s.workers,
      cleared: s.cleared,
      waiting: s.waiting,
      blocked: s.blocked,
      incomplete: s.incomplete,
      typicalDocs: s.typicalDocs,
    }
  })

  const automated = projects.filter(p => p.channelType !== 'MANUAL').length
  const allocated = new Set(
    projects.flatMap(p => p.collaborators.map(c => c.name.toUpperCase()))
  )
  const blockedPeople = new Set(
    projects.flatMap(p =>
      p.collaborators
        .filter(c => c.overallStatus === 'BLOCKED')
        .map(c => c.name.toUpperCase())
    )
  )

  return {
    updatedAt: now.toISOString(),
    refDate: report.refDate,
    summary: {
      totalProjects: projects.length,
      automatedProjects: automated,
      manualProjects: projects.length - automated,
      automatedPct: projects.length
        ? Math.round((automated / projects.length) * 100)
        : 0,
      allocatedPeople: allocated.size,
      blockedPeople: blockedPeople.size,
      scheduledActions: report.actions.filter(a => a.priority < 3).length,
      backlogActions: report.actions.filter(a => a.priority >= 3).length,
      criticalRejections: report.actions.filter(
        a => a.kind === 'RESUBMIT' && a.priority < 3
      ).length,
    },
    platforms,
    projects,
    manualGaps: report.gaps.map(g => ({
      client: g.client,
      channel:
        g.portals.map(p => p.name).join(' / ') || 'Sem leitura automática',
      projects: g.projects,
      allocatedCount: g.people,
      nextStart: g.nextStart,
    })),
  }
}
