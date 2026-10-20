import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildComplianceSnapshot,
  loadComplianceHistory,
  mergeComplianceHistory,
  saveComplianceHistory,
  snapshotsFromRevisions,
} from './ComplianceHistory.js'

const records = (statuses: string[]) =>
  statuses.map(statusEHS => ({ statusEHS })) as Parameters<
    typeof buildComplianceSnapshot
  >[0]

describe('ComplianceHistory', () => {
  it('counts documents by compliance bucket', () => {
    const snapshot = buildComplianceSnapshot(
      records([
        'CONFORME',
        'CONFORME',
        'INDETERMINADO',
        'VENCE_60',
        'VENCE_07',
        'VENCIDO',
        'AUSENTE',
        'SOLICITADO_STORZ',
      ]),
      new Date('2026-10-20T12:00:00-03:00')
    )

    expect(snapshot).toEqual({
      date: '2026-10-20',
      documents: 8,
      onTime: 3,
      expiringSoon: 2,
      expired: 1,
      missing: 1,
    })
  })

  it('uses the Sao Paulo calendar day, not UTC', () => {
    const snapshot = buildComplianceSnapshot(
      records(['CONFORME']),
      new Date('2026-10-21T01:30:00Z')
    )
    expect(snapshot.date).toBe('2026-10-20')
  })

  it('replaces the entry of the same day, keeps order and honors the limit', () => {
    const day = (date: string, onTime: number) => ({
      date,
      documents: onTime,
      onTime,
      expiringSoon: 0,
      expired: 0,
      missing: 0,
    })
    const merged = mergeComplianceHistory(
      [day('2026-10-18', 1), day('2026-10-19', 2)],
      day('2026-10-19', 9),
      2
    )
    expect(merged.map(e => [e.date, e.onTime])).toEqual([
      ['2026-10-18', 1],
      ['2026-10-19', 9],
    ])

    const trimmed = mergeComplianceHistory(merged, day('2026-10-20', 3), 2)
    expect(trimmed.map(e => e.date)).toEqual(['2026-10-19', '2026-10-20'])
  })

  it('keeps only the latest revision of each day when backfilling from git', () => {
    const snapshots = snapshotsFromRevisions([
      {
        committedAt: '2026-10-19T17:45:00-03:00',
        records: records(['CONFORME', 'VENCIDO']),
      },
      {
        committedAt: '2026-10-19T06:45:00-03:00',
        records: records(['VENCIDO', 'VENCIDO']),
      },
      {
        committedAt: '2026-10-20T06:45:00-03:00',
        records: records(['CONFORME', 'CONFORME']),
      },
    ])

    expect(snapshots.map(s => [s.date, s.onTime, s.expired])).toEqual([
      ['2026-10-19', 1, 1],
      ['2026-10-20', 2, 0],
    ])
  })

  it('skips stub revisions below the minimum document count', () => {
    const snapshots = snapshotsFromRevisions(
      [
        {
          committedAt: '2026-09-04T10:00:00-03:00',
          records: records(['CONFORME']),
        },
        {
          committedAt: '2026-09-05T10:00:00-03:00',
          records: records(['CONFORME', 'CONFORME', 'VENCIDO']),
        },
      ],
      3
    )
    expect(snapshots.map(s => s.date)).toEqual(['2026-09-05'])
  })

  it('round-trips through disk and tolerates missing or corrupt files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-history-'))
    const file = path.join(dir, 'history.json')
    expect(loadComplianceHistory(file)).toEqual([])

    const history = [
      buildComplianceSnapshot(
        records(['CONFORME']),
        new Date('2026-10-20T12:00:00Z')
      ),
    ]
    saveComplianceHistory(file, history)
    expect(loadComplianceHistory(file)).toEqual(history)

    fs.writeFileSync(file, '{not json', 'utf-8')
    expect(loadComplianceHistory(file)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
