import { describe, expect, it } from 'vitest'
import { censusCompleteness } from './PortalPendencyReportBuilder.js'

const worker = (name: string, docs: number) => ({
  name,
  documents: Array.from({ length: docs }, (_, i) => ({ title: `Doc ${i}`, status: 'APPROVED', required: true })),
}) as any

describe('censusCompleteness', () => {
  it('sets the partial-read threshold at half of what the portal usually returns', () => {
    const c = censusCompleteness(
      { portalId: 'x', capturedAt: '2026-11-12T09:00:00Z', workers: [worker('A', 24), worker('B', 26), worker('C', 1)] } as any,
      '2026-11-12'
    )
    expect(c).toMatchObject({ stale: false, typicalDocs: 24, minDocs: 12 })
  })
  it('flags a census older than two days as stale', () => {
    const c = censusCompleteness({ portalId: 'x', capturedAt: '2026-11-03T11:45:00Z', workers: [worker('A', 3)] } as any, '2026-11-12')
    expect(c.stale).toBe(true)
    expect(c.ageDays).toBe(9)
  })
  it('treats a census with no documents at all as unreliable for everyone', () => {
    const c = censusCompleteness({ portalId: 'x', capturedAt: '2026-11-12T09:00:00Z', workers: [worker('A', 0), worker('B', 0)] } as any, '2026-11-12')
    expect(c.minDocs).toBe(1)
  })
})
