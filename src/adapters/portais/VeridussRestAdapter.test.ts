import { describe, expect, it } from 'vitest'
import {
  VeridussDocument,
  cookieHeaderFromStorageState,
  mapVeridussCensus,
} from './VeridussRestAdapter.js'

const captured = '2026-10-27T12:00:00.000Z'

function doc(over: Partial<VeridussDocument>): VeridussDocument {
  return { entityType: 'member', memberName: 'JOAO SILVA', ...over }
}

describe('mapVeridussCensus', () => {
  it('groups documents by worker and maps Strapi statuses', () => {
    const census = mapVeridussCensus(
      [
        doc({ title: 'ASO', status: 'approved', expiresAt: '2027-01-10' }),
        doc({ title: 'NR-35', status: 'submitted' }),
        doc({
          title: 'CTPS',
          status: 'rejected',
          approvals: [{ status: 'rejected', comments: 'ilegível' }],
        }),
        doc({ memberName: 'MARIA SOUZA', title: 'ASO', status: 'waived' }),
      ],
      'veriduss-goldwind',
      captured
    )
    expect(census.portalId).toBe('veriduss-goldwind')
    expect(census.workers).toHaveLength(2)
    const joao = census.workers.find(w => w.name === 'JOAO SILVA')!
    expect(joao.documents).toHaveLength(3)
    expect(joao.documents.find(d => d.title === 'ASO')).toMatchObject({
      status: 'APPROVED',
      expiresOn: '2027-01-10',
    })
    expect(joao.documents.find(d => d.title === 'NR-35')?.status).toBe(
      'IN_REVIEW'
    )
    expect(joao.documents.find(d => d.title === 'CTPS')).toMatchObject({
      status: 'REJECTED',
      note: 'ilegível',
    })
    expect(
      census.workers.find(w => w.name === 'MARIA SOUZA')?.documents[0].status
    ).toBe('WAIVED')
  })

  it('keeps the note only on rejected documents and never bakes EXPIRING', () => {
    const [worker] = mapVeridussCensus(
      [
        doc({
          title: 'ASO',
          status: 'approved',
          expiresAt: '2026-11-01',
          description: 'critério de aprovação',
        }),
      ],
      'veriduss-goldwind',
      captured
    ).workers
    const aso = worker.documents[0]
    expect(aso.status).toBe('APPROVED')
    expect(aso.note).toBeUndefined()
    expect(aso.expiresOn).toBe('2026-11-01')
  })

  it('maps unknown statuses to MISSING and ignores non-member docs and blanks', () => {
    const census = mapVeridussCensus(
      [
        doc({ title: 'X', status: 'whatever' }),
        doc({ entityType: 'company', title: 'Alvará' }),
        doc({ memberName: '  ', title: 'Y', status: 'approved' }),
        doc({ memberName: 'Desconhecido', title: 'Z', status: 'approved' }),
      ],
      'veriduss-goldwind',
      captured
    )
    expect(census.workers).toHaveLength(1)
    expect(census.workers[0].documents[0].status).toBe('MISSING')
  })

  it('defaults required to true unless the document says otherwise', () => {
    const [w] = mapVeridussCensus(
      [
        doc({ title: 'A', status: 'approved' }),
        doc({ title: 'B', status: 'approved', required: false }),
      ],
      'veriduss-goldwind',
      captured
    ).workers
    expect(w.documents.find(d => d.title === 'A')?.required).toBe(true)
    expect(w.documents.find(d => d.title === 'B')?.required).toBe(false)
  })
})

describe('cookieHeaderFromStorageState', () => {
  it('joins cookies and filters to the host when given one', () => {
    const state = {
      cookies: [
        { name: 'session', value: 'abc', domain: 'goldwind.veriduss.com.br' },
        { name: 'other', value: 'xyz', domain: '.example.com' },
      ],
    }
    expect(cookieHeaderFromStorageState(state)).toBe('session=abc; other=xyz')
    expect(cookieHeaderFromStorageState(state, 'veriduss.com.br')).toBe(
      'session=abc'
    )
  })
})
