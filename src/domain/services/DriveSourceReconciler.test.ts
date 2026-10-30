import { describe, expect, it } from 'vitest'
import {
  ScannedCollaborator,
  collaboratorKey,
  reconcileBranch,
} from './DriveSourceReconciler.js'

const BRANCH = 'branch-root-id'

function collab(
  key: string,
  name: string,
  folderId: string | undefined,
  docs: Array<[string | null, string | null, string]>
): ScannedCollaborator {
  return {
    key,
    name,
    folderId,
    docs: docs.map(([code, dateIso, fileName], i) => ({
      fileId: `${key}-${i}`,
      fileName,
      parentFolderId: folderId ?? BRANCH,
      code,
      dateIso,
    })),
  }
}

describe('collaboratorKey', () => {
  it('strips the role, accents and extra spaces', () => {
    expect(collaboratorKey('JOCELEO ABREU VENÂNCIO - Ass. de operações')).toBe(
      'JOCELEO ABREU VENANCIO'
    )
  })
})

describe('reconcileBranch', () => {
  it('flags a code present in source2 but missing in the SSOT', () => {
    const ssot = [
      collab('ANA', 'ANA SILVA', 'f-ana', [['21', '2026-01-10', 'x']]),
    ]
    const src2 = [
      collab('ANA', 'ANA SILVA', 's-ana', [
        ['21', '2026-01-10', 'x'],
        ['20', '2026-02-01', '20 – NR-33 – 01.02.2026 - ANA SILVA'],
      ]),
    ]
    const { actions, summary } = reconcileBranch(ssot, src2, BRANCH)
    expect(summary.copyMissing).toBe(1)
    const copy = actions.find(a => a.kind === 'COPY_MISSING')!
    expect(copy.code).toBe('20')
    expect(copy.ssotCollabFolderId).toBe('f-ana')
    expect(copy.proposedName).toContain('20 –')
  })

  it('marks source2 as an update only when its date is newer', () => {
    const ssot = [
      collab('BIA', 'BIA LIMA', 'f-bia', [
        ['21', '2025-01-10', 'old'],
        ['22', '2026-05-01', 'current'],
      ]),
    ]
    const src2 = [
      collab('BIA', 'BIA LIMA', 's-bia', [
        ['21', '2026-03-10', 'newer'], // newer -> update
        ['22', '2026-04-01', 'older'], // older -> OK, no churn
      ]),
    ]
    const { actions, summary } = reconcileBranch(ssot, src2, BRANCH)
    expect(summary.updateNewer).toBe(1)
    expect(summary.ok).toBe(1)
    const upd = actions.find(a => a.kind === 'UPDATE_NEWER')!
    expect(upd.code).toBe('21')
    expect(upd.ssotFileId).toBe('BIA-0')
  })

  it('treats a whole unseen collaborator as NEW_COLLAB needing a folder', () => {
    const src2 = [
      collab('NEO', 'NEO NOVO', 's-neo', [['01', '2026-06-01', 'aso']]),
    ]
    const { actions, summary } = reconcileBranch([], src2, BRANCH)
    expect(summary.newCollab).toBe(1)
    const a = actions.find(x => x.kind === 'NEW_COLLAB')!
    expect(a.needsFolderCreation).toBe(true)
    expect(a.ssotCollabFolderId).toBe(BRANCH)
  })

  it('keeps the latest dated file per code and surfaces unclassifiable files', () => {
    const src2 = [
      collab('ZE', 'ZE RAW', 's-ze', [
        ['21', '2026-01-01', 'first'],
        ['21', '2026-09-01', 'latest'],
        [null, null, '2025 GWO FA - raw-D4Sign.pdf'],
      ]),
    ]
    const { actions, summary } = reconcileBranch([], src2, BRANCH)
    expect(summary.unclassified).toBe(1)
    const copy21 = actions.find(a => a.code === '21')!
    expect(copy21.src2FileName).toBe('latest')
  })
})
