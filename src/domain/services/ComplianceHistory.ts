import fs from 'fs'
import path from 'path'
import type { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

export interface ComplianceSnapshot {
  /** Calendar day in America/Sao_Paulo, formatted as YYYY-MM-DD */
  date: string
  documents: number
  onTime: number
  expiringSoon: number
  expired: number
  missing: number
}

export const COMPLIANCE_HISTORY_LIMIT = 400

const EXPIRING_STATUSES = new Set([
  'VENCE_60',
  'VENCE_30',
  'VENCE_15',
  'VENCE_07',
])

export function toBrazilDay(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function buildComplianceSnapshot(
  records: Pick<HSEDatabaseRecord, 'statusEHS'>[],
  date: Date
): ComplianceSnapshot {
  const snapshot: ComplianceSnapshot = {
    date: toBrazilDay(date),
    documents: records.length,
    onTime: 0,
    expiringSoon: 0,
    expired: 0,
    missing: 0,
  }
  for (const { statusEHS } of records) {
    if (statusEHS === 'CONFORME' || statusEHS === 'INDETERMINADO') {
      snapshot.onTime++
    } else if (EXPIRING_STATUSES.has(statusEHS)) {
      snapshot.expiringSoon++
    } else if (statusEHS === 'VENCIDO') {
      snapshot.expired++
    } else if (statusEHS === 'AUSENTE') {
      snapshot.missing++
    }
  }
  return snapshot
}

export function mergeComplianceHistory(
  history: ComplianceSnapshot[],
  snapshot: ComplianceSnapshot,
  limit: number = COMPLIANCE_HISTORY_LIMIT
): ComplianceSnapshot[] {
  const byDay = new Map(history.map(entry => [entry.date, entry]))
  byDay.set(snapshot.date, snapshot)
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
}

export interface DatabaseRevision {
  committedAt: string
  records: Pick<HSEDatabaseRecord, 'statusEHS'>[]
}

/**
 * Keeps the latest revision of each day, so one point represents the end of that day.
 * Revisions with fewer than `minDocuments` records are skipped: they are stubs, not snapshots.
 */
export function snapshotsFromRevisions(
  revisions: DatabaseRevision[],
  minDocuments = 0
): ComplianceSnapshot[] {
  const latestByDay = new Map<string, DatabaseRevision>()
  const ordered = [...revisions].sort(
    (a, b) =>
      new Date(a.committedAt).getTime() - new Date(b.committedAt).getTime()
  )
  for (const revision of ordered) {
    if (revision.records.length < minDocuments) continue
    latestByDay.set(toBrazilDay(new Date(revision.committedAt)), revision)
  }
  return [...latestByDay.values()].map(revision =>
    buildComplianceSnapshot(revision.records, new Date(revision.committedAt))
  )
}

export function loadComplianceHistory(filePath: string): ComplianceSnapshot[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      entry =>
        entry &&
        typeof entry.date === 'string' &&
        typeof entry.documents === 'number'
    )
  } catch {
    return []
  }
}

export function saveComplianceHistory(
  filePath: string,
  history: ComplianceSnapshot[]
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(history, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}
