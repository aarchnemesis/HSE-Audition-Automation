import { describe, expect, it } from 'vitest'
import { ProjectAssignment } from '../models/ProjectAssignment.js'
import { PortalInfo } from './PortalCatalog.js'
import {
  PortalAccessRow,
  buildPortalCoverage,
  clientUsage,
  matchAccessRow,
} from './PortalCoverage.js'

const REF = new Date('2026-10-27T12:00:00Z')

function access(
  client: string,
  host: string,
  extra: Partial<PortalAccessRow> = {}
): PortalAccessRow {
  return {
    client,
    channel: 'PLATAFORMA',
    host,
    status: '',
    hasCredentials: true,
    ...extra,
  }
}

function project(
  client: string,
  startDate: string,
  status = 'Azul'
): ProjectAssignment {
  return { client, windfarm: 'X', startDate, status, team: '' }
}

const portals: PortalInfo[] = [
  {
    id: 'tdoc-sgre',
    name: 'SGRE',
    system: 'TDoc',
    url: '',
    hosts: ['wplatam.tdoc.es'],
    category: 'DOCUMENTS',
    automation: 'AUTOMATED',
    clients: ['SGRE'],
  },
  {
    id: 'forms-a',
    name: 'Forms A',
    system: 'Forms',
    url: '',
    hosts: ['forms.cloud.microsoft'],
    category: 'TRAINING',
    automation: 'MANUAL',
    clients: ['NORDEX ACCIONA'],
  },
  {
    id: 'forms-b',
    name: 'Forms B',
    system: 'Forms',
    url: '',
    hosts: ['forms.cloud.microsoft'],
    category: 'TRAINING',
    automation: 'MANUAL',
    clients: ['SGRE'],
  },
  {
    id: 'drive',
    name: 'Drive',
    system: 'Drive',
    url: '',
    hosts: [],
    category: 'DOCUMENTS',
    automation: 'MANUAL',
    clients: ['ELERA'],
  },
  {
    id: 'old',
    name: 'Old',
    system: 'SG3',
    url: '',
    hosts: ['sg3.example'],
    category: 'DOCUMENTS',
    automation: 'NOT_AUTOMATED',
    clients: ['COPEL'],
    obsolete: true,
  },
]

describe('matchAccessRow', () => {
  it('matches by host and breaks shared hosts by client', () => {
    expect(
      matchAccessRow(
        access('SGRE (Siemens Gamesa)', 'wplatam.tdoc.es'),
        portals
      )?.id
    ).toBe('tdoc-sgre')
    expect(
      matchAccessRow(
        access('SOLICITAÇÃO DE TREINAMENTO- GAMESA', 'forms.cloud.microsoft'),
        portals
      )?.id
    ).toBe('forms-b')
    expect(matchAccessRow(access('ELERA', ''), portals)?.id).toBe('drive')
    expect(matchAccessRow(access('NEW ENERGY', ''), portals)).toBeUndefined()
  })
})

describe('clientUsage', () => {
  it('ranks each client by its most current project', () => {
    const usage = clientUsage(
      [
        project('SGRE', '2026-10-15'),
        project('SGRE', '2025-01-10'),
        project('AUREN', '2026-05-25'),
        project('PONTAL ENERGY', '2026-03-28'),
        project('ENGIE', '2026-12-06'),
        project('ENGIE', '2026-11-01', 'Vermelho'),
      ],
      '2026-10-27'
    )
    expect(usage.get('SGRE')).toMatchObject({
      activity: 'IN_FIELD',
      projectsInWindow: 1,
      lastStart: '2026-10-15',
    })
    expect(usage.get('AUREN')?.activity).toBe('RECENT')
    expect(usage.get('PONTAL')?.activity).toBe('DORMANT')
    expect(usage.get('ENGIE')).toMatchObject({
      activity: 'IN_FIELD',
      nextStart: '2026-12-06',
    })
  })
})

describe('buildPortalCoverage', () => {
  const coverage = buildPortalCoverage({
    refDate: REF,
    portals,
    accessRows: [
      access('SGRE (Siemens Gamesa)', 'wplatam.tdoc.es'),
      access('SGRE', 'wplatam.tdoc.es', {
        status: 'Solicita novo acesso',
        hasCredentials: false,
      }),
      access('NEW ENERGY', ''),
      access('', ''),
    ],
    projects: [
      project('SGRE', '2026-11-01'),
      project('ENGIE', '2026-12-06'),
      project('COPEL', '2026-09-01'),
    ],
    censuses: [
      {
        portalId: 'tdoc-sgre',
        capturedAt: '2026-10-26T10:00:00Z',
        workers: [],
      },
    ],
  })

  it('counts access rows, pending access and missing credentials per portal', () => {
    const sgre = coverage.portals.find(p => p.portal.id === 'tdoc-sgre')!
    expect(sgre).toMatchObject({
      accessRows: 2,
      accessPending: 1,
      missingCredentials: 1,
      activity: 'IN_FIELD',
      census: { capturedAt: '2026-10-26T10:00:00Z', workers: 0 },
    })
  })

  it('lists rows without a portal and active clients without a live channel', () => {
    expect(coverage.unmatchedRows.map(r => r.client)).toEqual(['NEW ENERGY'])
    expect(coverage.clientsWithoutPortal.map(c => c.client)).toEqual([
      'ENGIE',
      'COPEL',
    ])
  })
})
