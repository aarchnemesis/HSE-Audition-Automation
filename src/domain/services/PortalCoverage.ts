import { PortalCensus } from '../models/PortalCensus.js'
import { ProjectAssignment } from '../models/ProjectAssignment.js'
import { PORTALS, PortalInfo, clientKey } from './PortalCatalog.js'

/** One row of the EHS credentials sheet, reduced to what is safe to keep: no user, no password. */
export interface PortalAccessRow {
  client: string
  channel: string
  host: string
  /** Status words from the observations column (e.g. "Solicita novo acesso", "OBSOLETO") */
  status: string
  hasCredentials: boolean
}

/**
 * IN_FIELD: a project in the report window (started in the last 45 days or starting in 60).
 * RECENT: a project in the last 180 days or scheduled after the window.
 * DORMANT: only older projects. NO_PROJECTS: absent from the briefing.
 */
export type ClientActivity = 'IN_FIELD' | 'RECENT' | 'DORMANT' | 'NO_PROJECTS'

export interface ClientUsage {
  client: string
  activity: ClientActivity
  projectsInWindow: number
  lastStart?: string
  nextStart?: string
}

export interface PortalCoverageRow {
  portal: PortalInfo
  accessRows: number
  /** Rows whose access the sheet says must be requested again */
  accessPending: number
  /** Rows with no user or password filled in */
  missingCredentials: number
  census?: { capturedAt: string; workers: number }
  clients: ClientUsage[]
  /** Most active of the portal's clients; undefined for portals not tied to a client */
  activity?: ClientActivity
}

export interface PortalCoverageReport {
  refDate: string
  portals: PortalCoverageRow[]
  /** Clients in the briefing with no documentation channel in the catalog */
  clientsWithoutPortal: ClientUsage[]
  /** Credentials-sheet rows no catalog entry claims */
  unmatchedRows: PortalAccessRow[]
}

const ACTIVITY_RANK: Record<ClientActivity, number> = {
  IN_FIELD: 0,
  RECENT: 1,
  DORMANT: 2,
  NO_PROJECTS: 3,
}

const PENDING_ACCESS = /novo acesso|novo cadastro|solicitar cadastro/i

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000)
}

export function matchAccessRow(
  row: PortalAccessRow,
  portals: PortalInfo[] = PORTALS
): PortalInfo | undefined {
  const key = clientKey(row.client)
  const byHost = row.host ? portals.filter(p => p.hosts.includes(row.host)) : []
  if (byHost.length === 1) return byHost[0]
  if (byHost.length > 1)
    return byHost.find(p => p.clients.includes(key)) ?? byHost[0]
  return portals.find(p => !p.hosts.length && p.clients.includes(key))
}

export function clientUsage(
  projects: ProjectAssignment[],
  refIso: string
): Map<string, ClientUsage> {
  const usage = new Map<string, ClientUsage>()
  for (const p of projects) {
    const key = clientKey(p.client)
    const u = usage.get(key) ?? {
      client: key,
      activity: 'NO_PROJECTS' as ClientActivity,
      projectsInWindow: 0,
    }
    usage.set(key, u)
    if (!p.startDate || p.status === 'Vermelho') continue
    const days = daysBetween(refIso, p.startDate)
    let activity: ClientActivity = 'DORMANT'
    if (days >= -45 && days <= 60) {
      activity = 'IN_FIELD'
      u.projectsInWindow++
    } else if (days >= -180) activity = 'RECENT'
    if (ACTIVITY_RANK[activity] < ACTIVITY_RANK[u.activity])
      u.activity = activity
    if (days <= 0 && (!u.lastStart || p.startDate > u.lastStart))
      u.lastStart = p.startDate
    if (days > 0 && (!u.nextStart || p.startDate < u.nextStart))
      u.nextStart = p.startDate
  }
  return usage
}

export function buildPortalCoverage(input: {
  refDate: Date
  accessRows: PortalAccessRow[]
  projects: ProjectAssignment[]
  censuses: PortalCensus[]
  portals?: PortalInfo[]
}): PortalCoverageReport {
  const refIso = input.refDate.toISOString().slice(0, 10)
  const portals = input.portals ?? PORTALS
  const usage = clientUsage(input.projects, refIso)
  const censusById = new Map(input.censuses.map(c => [c.portalId, c]))

  const rows = new Map<string, PortalCoverageRow>(
    portals.map(p => {
      const census = censusById.get(p.id)
      const clients = p.clients.map(
        c =>
          usage.get(c) ?? {
            client: c,
            activity: 'NO_PROJECTS' as ClientActivity,
            projectsInWindow: 0,
          }
      )
      const activity = clients.length
        ? clients.reduce((best, c) =>
            ACTIVITY_RANK[c.activity] < ACTIVITY_RANK[best.activity] ? c : best
          ).activity
        : undefined
      return [
        p.id,
        {
          portal: p,
          accessRows: 0,
          accessPending: 0,
          missingCredentials: 0,
          census: census && {
            capturedAt: census.capturedAt,
            workers: census.workers.length,
          },
          clients,
          activity,
        },
      ]
    })
  )

  const unmatchedRows: PortalAccessRow[] = []
  for (const access of input.accessRows) {
    if (!access.client && !access.host) continue
    const portal = matchAccessRow(access, portals)
    const row = portal && rows.get(portal.id)
    if (!row) {
      unmatchedRows.push(access)
      continue
    }
    row.accessRows++
    if (PENDING_ACCESS.test(access.status)) row.accessPending++
    if (!access.hasCredentials) row.missingCredentials++
  }

  const covered = new Set(
    portals
      .filter(p => p.category === 'DOCUMENTS' && !p.obsolete)
      .flatMap(p => p.clients)
  )
  const clientsWithoutPortal = Array.from(usage.values())
    .filter(u => !covered.has(u.client) && u.activity !== 'DORMANT')
    .sort((a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity])

  return {
    refDate: refIso,
    portals: Array.from(rows.values()),
    clientsWithoutPortal,
    unmatchedRows,
  }
}
