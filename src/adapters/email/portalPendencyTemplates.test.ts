import { describe, expect, it } from 'vitest'
import { PortalPendencyReport } from '../../domain/services/PortalPendencyReportBuilder.js'
import {
  buildEhsQueueBodyHtml,
  buildOpsReadinessBodyHtml,
  countClearances,
  displayName,
  shortTitle,
} from './portalPendencyTemplates.js'

const sgre = {
  id: 'tdoc-sgre',
  name: 'Siemens Gamesa (TDoc)',
  system: 'TDoc',
  url: 'https://wplatam.tdoc.es',
  hosts: ['wplatam.tdoc.es'],
  category: 'DOCUMENTS' as const,
  automation: 'AUTOMATED' as const,
  clients: ['SGRE'],
}

const project = {
  wo: '2023-0051-8',
  client: 'SGRE',
  windfarm: 'Santo <Agostinho>',
  startDate: '2026-10-30',
  daysToStart: 3,
}

const report: PortalPendencyReport = {
  refDate: '2026-10-27',
  window: { lookbackDays: 45, lookaheadDays: 60, urgentDays: 14 },
  portals: [
    {
      portal: sgre,
      capturedAt: '2026-10-20T10:00:00Z',
      workers: 2,
      cleared: 1,
      waiting: 0,
      blocked: 1,
      actions: { RESUBMIT: 1, UPLOAD_FROM_BASE: 0, OBTAIN: 0, RENEW: 0 },
    },
  ],
  actions: [
    {
      portalId: 'tdoc-sgre',
      portalName: sgre.name,
      worker: 'JOAO CARLOS GUARDIANO',
      document: 'Direção Defensiva (Favor atender primeiro o item CTPS)',
      kind: 'RESUBMIT',
      status: 'REJECTED',
      note: 'Ilegível',
      project,
      priority: 1,
      onActiveRoster: true,
    },
  ],
  projects: [
    {
      project,
      monitored: [{ portal: sgre, capturedAt: '2026-10-20T10:00:00Z' }],
      unmonitored: [],
      members: [
        {
          name: 'JOAO CARLOS GUARDIANO',
          resolved: true,
          clearance: 'BLOCKED',
          portalName: sgre.name,
          blockers: [{ title: 'Direção Defensiva', status: 'REJECTED' }],
          waiting: [],
          expiring: [],
        },
        {
          name: 'JOAO CARLOS GUARDIANO',
          resolved: true,
          clearance: 'BLOCKED',
          blockers: [],
          waiting: [],
          expiring: [],
        },
        {
          name: 'Gerardo Silva',
          resolved: false,
          clearance: 'NOT_REGISTERED',
          blockers: [],
          waiting: [],
          expiring: [],
        },
      ],
    },
  ],
  gaps: [
    {
      client: 'ENGIE',
      portals: [],
      projects: 1,
      people: 2,
      nextStart: '2026-12-06',
    },
  ],
}

const EMOJI = /\p{Extended_Pictographic}/u

describe('helpers', () => {
  it('formats names and trims portal instructions', () => {
    expect(displayName('JOSE MARCOS LIMA DE MOURA')).toBe(
      'Jose Marcos Lima de Moura'
    )
    expect(shortTitle('ASO válido (Favor atender primeiro o item CTPS)')).toBe(
      'ASO válido'
    )
  })

  it('counts each person once, by their worst situation', () => {
    expect(countClearances(report.projects)).toMatchObject({
      total: 2,
      BLOCKED: 1,
      NOT_REGISTERED: 1,
    })
  })
})

describe('buildOpsReadinessBodyHtml', () => {
  const html = buildOpsReadinessBodyHtml(report, 'ehs@arthwind.com.br')

  it('shows each scheduled person with their clearance and escapes portal text', () => {
    expect(html).toContain('Joao Carlos Guardiano')
    expect(html).toContain('Bloqueado')
    expect(html).toContain('Santo &lt;Agostinho&gt;')
    expect(html).toContain('nome não encontrado no RPO')
    expect(html).toContain('Portal não cadastrado na base EHS')
    expect(html).not.toMatch(EMOJI)
  })
})

describe('buildEhsQueueBodyHtml', () => {
  const html = buildEhsQueueBodyHtml(report)

  it('lists scheduled actions, flags stale data and uses no emoji', () => {
    expect(html).toContain('Reenviar')
    expect(html).toContain('Direção Defensiva</td>')
    expect(html).toContain('(6 dias)')
    expect(html).not.toMatch(EMOJI)
  })
})
