import { execFileSync } from 'child_process'
import path from 'path'
import {
  DatabaseRevision,
  loadComplianceHistory,
  mergeComplianceHistory,
  saveComplianceHistory,
  snapshotsFromRevisions,
} from '../domain/services/ComplianceHistory.js'

const DB_PATH = 'data/hse_database.json'
const MIN_DOCUMENTS = 100

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function listRevisions(): Array<{ sha: string; committedAt: string }> {
  return git(['log', '--format=%H %cI', '--', DB_PATH])
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, committedAt] = line.split(' ')
      return { sha, committedAt }
    })
}

function readRevision(
  sha: string,
  committedAt: string
): DatabaseRevision | null {
  try {
    const records = JSON.parse(git(['show', `${sha}:${DB_PATH}`]))
    return Array.isArray(records) ? { committedAt, records } : null
  } catch {
    return null
  }
}

function main() {
  const revisions = listRevisions()
    .map(({ sha, committedAt }) => readRevision(sha, committedAt))
    .filter((revision): revision is DatabaseRevision => revision !== null)

  const historyPath = path.join(
    process.cwd(),
    'data',
    'compliance_history.json'
  )
  let history = loadComplianceHistory(historyPath)
  for (const snapshot of snapshotsFromRevisions(revisions, MIN_DOCUMENTS)) {
    history = mergeComplianceHistory(history, snapshot)
  }
  saveComplianceHistory(historyPath, history)
  console.log(
    `[backfillComplianceHistory] ${history.length} dia(s) em ${historyPath}`
  )
}

main()
