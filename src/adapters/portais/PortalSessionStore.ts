import fs from 'fs'
import path from 'path'

// The human-renewed-session model needs one operational answer: which saved sessions are still
// good and which must be re-logged. A Playwright storageState stores each cookie's `expires`
// (Unix seconds; -1 or 0 means a session cookie that dies with the browser). This reads that
// without any network call, so an operator can see at a glance what to renew.

export const DEFAULT_SESSION_DIR = path.join(
  process.cwd(),
  'scratch',
  'portais',
  'sessions'
)

export interface SessionCookie {
  name: string
  value?: string
  domain?: string
  expires?: number
}

export interface StoredSession {
  cookies?: SessionCookie[]
}

export interface SessionHealth {
  /** Persistent cookies with a future expiry. */
  persistentValid: number
  /** Persistent cookies already past their expiry. */
  persistentExpired: number
  /** Session-only cookies (expires <= 0); unusable once reloaded from disk. */
  sessionOnly: number
  /** Soonest future expiry as an ISO date, if any persistent cookie has one. */
  nextExpiry?: string
  /** True when at least one persistent cookie is still valid. */
  usable: boolean
}

function isPersistent(c: SessionCookie): boolean {
  return typeof c.expires === 'number' && c.expires > 0
}

/** Pure: classify a storageState's cookies against `nowSec` (Unix seconds). */
export function summarizeSessionHealth(
  session: StoredSession,
  nowSec: number = Math.floor(Date.now() / 1000)
): SessionHealth {
  const cookies = session.cookies ?? []
  let persistentValid = 0
  let persistentExpired = 0
  let sessionOnly = 0
  let nextExpiry: number | undefined
  for (const c of cookies) {
    if (!isPersistent(c)) {
      sessionOnly++
      continue
    }
    const exp = c.expires as number
    if (exp <= nowSec) {
      persistentExpired++
    } else {
      persistentValid++
      if (nextExpiry === undefined || exp < nextExpiry) nextExpiry = exp
    }
  }
  return {
    persistentValid,
    persistentExpired,
    sessionOnly,
    nextExpiry:
      nextExpiry === undefined
        ? undefined
        : new Date(nextExpiry * 1000).toISOString(),
    usable: persistentValid > 0,
  }
}

export interface PortalSessionReport {
  portalId: string
  filePath: string
  health: SessionHealth
}

export function sessionPath(
  portalId: string,
  dir: string = DEFAULT_SESSION_DIR
): string {
  return path.join(dir, `${portalId}.session.json`)
}

export function loadStoredSession(filePath: string): StoredSession {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StoredSession
}

/** Reports the health of every `<portalId>.session.json` found in `dir`. */
export function reportSessions(
  dir: string = DEFAULT_SESSION_DIR,
  nowSec?: number
): PortalSessionReport[] {
  if (!fs.existsSync(dir)) return []
  const reports: PortalSessionReport[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.session.json')) continue
    const filePath = path.join(dir, file)
    try {
      reports.push({
        portalId: file.replace(/\.session\.json$/, ''),
        filePath,
        health: summarizeSessionHealth(loadStoredSession(filePath), nowSec),
      })
    } catch {
      // Unreadable or malformed session file — skip it rather than fail the whole report.
    }
  }
  return reports.sort((a, b) => a.portalId.localeCompare(b.portalId))
}
