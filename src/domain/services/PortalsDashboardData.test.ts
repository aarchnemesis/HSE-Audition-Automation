import { describe, expect, it } from 'vitest'
import { PortalInfo } from './PortalCatalog.js'
import {
  PortalAction,
  PortalPendencyReport,
  ProjectReadiness,
} from './PortalPendencyReportBuilder.js'
import {
  CENSUS_FRESH_DAYS,
  buildPortalsDashboardData,
} from './PortalsDashboardData.js'

const NOW = new Date('2026-11-03T12:00:00Z')

function portal(id: string, name: string): PortalInfo {
  return {
    id,
    name,
    system: id,
    url: `https://${id}.example`,
    hosts: [],
    category: 'DOCUMENTS',
    automation: 'AUTOMATED',
    clients: [],
  }
}

const suricatta = portal('surisoft', 'GE Vernova (Surisoft)')
const tdoc = portal('tdoc-sgre', 'SGRE (TDoc)')

const rejection: PortalAction = {
  portalId: 'tdoc-sgre',
  portalName: 'SGRE (TDoc)',
  worker: 'PEDRO SILVA',
  document: 'GWO Working at Heights',
  kind: 'RESUBMIT',
  status: 'REJECTED',
  note: 'Certificado ilegível',
  evidence: {
    docName: 'GWO Working at Heights',
    expiresOn: '2027-01-10',
    url: 'https://drive.google.com/drive/folders/abc',
  },
  priority: 1,
  onActiveRoster: true,
}

function project(
  overrides: Partial<ProjectReadiness> & {
    windfarm: string
    daysToStart: number
  }
): ProjectReadiness {
  const { windfarm, daysToStart, ...rest } = overrides
  return {
    project: { client: 'SGRE', windfarm, daysToStart, startDate: '2026-11-08' },
    monitored: [{ portal: tdoc, capturedAt: '2026-11-03T08:00:00Z' }],
    unmonitored: [],
    members: [],
    ...rest,
  }
}

function report(projects: ProjectReadiness[]): PortalPendencyReport {
  return {
    refDate: '2026-11-03',
    window: { lookbackDays: 45, lookaheadDays: 60, urgentDays: 14 },
    portals: [
      {
        portal: suricatta,
        capturedAt: '2026-10-27T09:00:00Z',
        workers: 44,
        cleared: 30,
        waiting: 4,
        blocked: 10,
        incomplete: 0,
        typicalDocs: 20,
        stale: false,
        actions: { RESUBMIT: 0, UPLOAD_FROM_BASE: 0, OBTAIN: 0, RENEW: 0 },
      },
      {
        portal: tdoc,
        capturedAt: '2026-11-03T08:00:00Z',
        workers: 7,
        cleared: 5,
        waiting: 0,
        blocked: 2,
        incomplete: 0,
        typicalDocs: 20,
        stale: false,
        actions: { RESUBMIT: 1, UPLOAD_FROM_BASE: 0, OBTAIN: 0, RENEW: 0 },
      },
    ],
    actions: [
      rejection,
      // same kind of rejection, but for someone with no mobilization in the window
      {
        ...rejection,
        worker: 'FORA DA ESCALA',
        priority: 3,
        onActiveRoster: false,
      },
    ],
    projects,
    gaps: [
      {
        client: 'NAWP Peru',
        portals: [],
        projects: 2,
        people: 4,
        nextStart: '2026-11-12',
      },
    ],
    expiringAlerts: [],
  }
}

describe('buildPortalsDashboardData', () => {
  const blocked = project({
    windfarm: 'Parque Dom Inocêncio',
    daysToStart: 5,
    members: [
      {
        name: 'PEDRO SILVA',
        resolved: true,
        clearance: 'BLOCKED',
        portalName: 'SGRE (TDoc)',
        blockers: [
          {
            title: 'GWO Working at Heights',
            status: 'REJECTED',
            note: 'Certificado ilegível',
          },
        ],
        waiting: [],
        expiring: [],
      },
      {
        name: 'ANA LIMA',
        resolved: true,
        clearance: 'CLEARED',
        portalName: 'SGRE (TDoc)',
        blockers: [],
        waiting: [],
        expiring: [],
      },
    ],
  })
  const clear = project({
    windfarm: 'Complexo Folha Larga',
    daysToStart: 2,
    members: [
      {
        name: 'ANA LIMA',
        resolved: true,
        clearance: 'CLEARED',
        portalName: 'SGRE (TDoc)',
        blockers: [],
        waiting: [],
        expiring: [],
      },
    ],
  })
  const manual = project({
    windfarm: 'Parque Wayra II',
    daysToStart: 9,
    monitored: [],
    unmonitored: [portal('sharepoint', 'SharePoint cliente')],
  })

  const data = buildPortalsDashboardData(report([clear, manual, blocked]), NOW)

  it('ordena projetos bloqueados primeiro, depois por proximidade do início', () => {
    expect(data.projects.map(p => p.projectName)).toEqual([
      'Parque Dom Inocêncio',
      'Complexo Folha Larga',
      'Parque Wayra II',
    ])
    expect(data.projects[0].status).toBe('BLOCKED')
    expect(data.projects[1].status).toBe('OK')
  })

  it('liga a recusa ao motivo do cliente, à ação sugerida e ao link do Drive', () => {
    const doc = data.projects[0].collaborators[0].documents[0]
    expect(doc.status).toBe('REJECTED')
    expect(doc.rejectionReason).toBe('Certificado ilegível')
    expect(doc.actionKind).toBe('RESUBMIT')
    expect(doc.suggestedAction).toContain('Certificado ilegível')
    expect(doc.driveUrl).toBe('https://drive.google.com/drive/folders/abc')
  })

  it('classifica o canal: automático, parcial e manual', () => {
    const byName = Object.fromEntries(
      data.projects.map(p => [p.projectName, p.channelType])
    )
    expect(byName['Parque Dom Inocêncio']).toBe('AUTOMATED')
    expect(byName['Parque Wayra II']).toBe('MANUAL')
  })

  it('marca plataforma com censo antigo como STALE em vez de ONLINE', () => {
    const byId = Object.fromEntries(data.platforms.map(p => [p.id, p]))
    expect(byId['tdoc-sgre'].status).toBe('ONLINE')
    expect(byId.surisoft.status).toBe('STALE')
    expect(byId.surisoft.ageDays).toBeGreaterThan(CENSUS_FRESH_DAYS)
  })

  it('calcula o resumo: projetos, cobertura, pessoas e recusas', () => {
    expect(data.summary.totalProjects).toBe(3)
    expect(data.summary.automatedProjects).toBe(2)
    expect(data.summary.manualProjects).toBe(1)
    expect(data.summary.automatedPct).toBe(67)
    expect(data.summary.allocatedPeople).toBe(2)
    expect(data.summary.blockedPeople).toBe(1)
  })

  it('só conta como urgente a recusa de quem está escalado, não o backlog', () => {
    expect(data.summary.scheduledActions).toBe(1)
    expect(data.summary.backlogActions).toBe(1)
    expect(data.summary.criticalRejections).toBe(1)
  })

  it('expõe os canais manuais sem inventar ponto focal', () => {
    expect(data.manualGaps).toEqual([
      {
        client: 'NAWP Peru',
        channel: 'Sem leitura automática',
        projects: 2,
        allocatedCount: 4,
        nextStart: '2026-11-12',
      },
    ])
  })

  it('não carrega CPF em nenhum ponto do JSON', () => {
    const raw = JSON.stringify(data)
    expect(raw).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/)
    expect(raw).not.toMatch(/"cpf"/i)
  })
})
