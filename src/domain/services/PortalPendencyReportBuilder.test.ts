import { describe, expect, it } from 'vitest'
import { PortalCensus } from '../models/PortalCensus.js'
import { ProjectAssignment } from '../models/ProjectAssignment.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'
import {
  buildPortalPendencyReport,
  effectiveStatus,
  portalDocCode,
} from './PortalPendencyReportBuilder.js'

const REF = new Date('2026-10-27T12:00:00Z')

function baseRecord(
  name: string,
  docCode: string,
  docName: string,
  statusEHS: HSEDatabaseRecord['statusEHS'],
  expirationDate?: string
): HSEDatabaseRecord {
  return {
    inspectorId: name,
    inspectorName: name,
    role: 'TO',
    docCode,
    docName,
    modality: 'PRESENCIAL',
    statusEHS,
    expirationDate,
    detail: '',
    driveFolderUrl: 'https://drive.google.com/drive/folders/x',
    lastUpdated: '2026-10-26T00:00:00Z',
  }
}

const sgre: PortalCensus = {
  portalId: 'tdoc-sgre',
  capturedAt: '2026-10-26T15:00:00Z',
  workers: [
    {
      name: 'João Carlos Guardiano',
      contract: 'SANTO AGOSTINHO',
      documents: [
        {
          title: 'ASO',
          status: 'APPROVED',
          expiresOn: '2026-11-10',
          required: true,
        },
        {
          title: 'Trein. Direção Defensiva',
          status: 'REJECTED',
          note: 'Ilegível',
          required: true,
        },
        {
          title: 'Trein. Direção Defensiva',
          status: 'REJECTED',
          note: 'Ilegível',
          required: true,
        },
      ],
    },
    {
      name: 'DAVID KELSON DE SOUZA LOYOLA',
      documents: [{ title: 'NR-35', status: 'APPROVED', required: true }],
    },
    {
      name: 'Pedro Paulo Ferreira de Almeida',
      documents: [
        { title: 'Capacitação NR-12', status: 'MISSING', required: true },
        {
          title: 'Equipe de emergência e salvamento NR-33',
          status: 'MISSING',
          required: true,
        },
        { title: 'Ficha EPI', status: 'IN_REVIEW', required: true },
      ],
    },
    {
      name: 'Ana Desligada',
      documents: [
        {
          title: 'ASO',
          status: 'APPROVED',
          expiresOn: '2026-01-01',
          required: true,
        },
      ],
    },
  ],
}

const projects: ProjectAssignment[] = [
  {
    wo: '2023-0051-8',
    client: 'SGRE',
    windfarm: 'Complexo Eólico Santo Agostinho',
    startDate: '2026-10-30',
    status: 'Azul',
    team: 'João Carlos Guardiano, David Kelson, Francisco Davilo',
  },
  {
    wo: '2023-0051-8',
    client: 'SGRE',
    windfarm: 'Complexo Eólico Santo Agostinho',
    startDate: '2026-09-01',
    status: 'Azul',
    team: 'João Carlos Guardiano, David Kelson, Francisco Davilo',
  },
  {
    wo: '2024-0088-4',
    client: 'SGRE',
    windfarm: 'Complexo Eólico Ventos de São Vitor',
    startDate: '2026-12-10',
    status: 'Azul',
    team: 'Pedro Paulo Ferreira',
  },
  {
    wo: 'WOOPEN09',
    client: 'NAWP PERU',
    windfarm: 'San Juan de Marcona',
    startDate: '2026-11-05',
    status: 'Azul',
    team: 'Lucas Franklin',
  },
  {
    client: 'SGRE',
    windfarm: 'Cancelado',
    startDate: '2026-11-01',
    status: 'Vermelho',
    team: 'João Carlos Guardiano',
  },
  {
    client: 'SGRE',
    windfarm: 'Antigo',
    startDate: '2026-01-10',
    status: 'Verde',
    team: 'João Carlos Guardiano',
  },
]

const baseRecords = [
  baseRecord(
    'JOAO CARLOS GUARDIANO DA SILVA',
    '01',
    'ASO',
    'CONFORME',
    '2027-10-01'
  ),
  baseRecord(
    'DAVID KELSON DE SOUZA LOYOLA',
    '21',
    'NR-35',
    'CONFORME',
    '2028-01-01'
  ),
  baseRecord(
    'PEDRO PAULO FERREIRA DE ALMEIDA',
    '15',
    'NR-12 Segurança em Máquinas',
    'VENCE_60',
    '2026-12-20'
  ),
  baseRecord(
    'PEDRO PAULO FERREIRA DE ALMEIDA',
    '20',
    'NR-33 Espaço Confinado',
    'CONFORME',
    '2027-07-01'
  ),
  baseRecord(
    'FRANCISCO DAVILO MARQUES DE SOUSA',
    '01',
    'ASO',
    'CONFORME',
    '2027-01-01'
  ),
  baseRecord(
    'LUCAS FRANKLIN FALCAO SILVA',
    '01',
    'ASO',
    'VENCIDO',
    '2026-09-01'
  ),
]

const report = buildPortalPendencyReport({
  refDate: REF,
  censuses: [sgre],
  projects,
  baseRecords,
})

describe('effectiveStatus', () => {
  const doc = { title: 'ASO', status: 'APPROVED' as const, required: true }
  it('derives expiry from the report date', () => {
    expect(
      effectiveStatus({ ...doc, expiresOn: '2026-10-01' }, '2026-10-27')
    ).toBe('EXPIRED')
    expect(
      effectiveStatus({ ...doc, expiresOn: '2026-11-20' }, '2026-10-27')
    ).toBe('EXPIRING')
    expect(
      effectiveStatus({ ...doc, expiresOn: '2027-11-20' }, '2026-10-27')
    ).toBe('APPROVED')
    expect(effectiveStatus({ ...doc, status: 'REJECTED' }, '2026-10-27')).toBe(
      'REJECTED'
    )
  })
})

describe('portalDocCode', () => {
  it('refuses to equate rescue-team or supervisor requirements with the worker course', () => {
    expect(
      portalDocCode('Capacitação Equipe de emergência e salvamento NR-33')
    ).toBeNull()
    expect(portalDocCode('Capacitação Espaço Confinado - Supervisor')).toBe(
      '28'
    )
    expect(portalDocCode('Capacitação NR-12 (Em caso de reciclagem)')).toBe(
      '15'
    )
  })
})

describe('buildPortalPendencyReport', () => {
  it('keeps projects in the window, drops cancelled ones and merges rescheduled WOs', () => {
    expect(report.projects.map(p => p.project.windfarm)).toEqual([
      'Complexo Eólico Santo Agostinho',
      'San Juan de Marcona',
      'Complexo Eólico Ventos de São Vitor',
    ])
    expect(report.projects[0].project.startDate).toBe('2026-10-30')
  })

  it('gives each scheduled person their clearance in the client portal', () => {
    const members = report.projects[0].members
    expect(members.map(m => [m.name, m.clearance])).toEqual([
      ['JOAO CARLOS GUARDIANO DA SILVA', 'BLOCKED'],
      ['DAVID KELSON DE SOUZA LOYOLA', 'CLEARED'],
      ['FRANCISCO DAVILO MARQUES DE SOUSA', 'NOT_REGISTERED'],
    ])
    expect(members[0].blockers).toHaveLength(1)
    expect(members[0].expiring.map(e => e.title)).toEqual(['ASO'])
  })

  it('marks clients without a readable portal and lists them as coverage gaps', () => {
    expect(report.projects[1].members[0].clearance).toBe('NOT_MONITORED')
    expect(report.gaps).toEqual([
      expect.objectContaining({
        client: 'NAWP PERU',
        projects: 1,
        people: 1,
        nextStart: '2026-11-05',
      }),
    ])
  })

  it('turns pendencies into actions, using the HSE base to tell upload from obtain', () => {
    const actions = report.actions.map(a => [
      a.worker,
      a.document,
      a.kind,
      a.priority,
    ])
    expect(actions).toEqual([
      ['João Carlos Guardiano', 'Trein. Direção Defensiva', 'RESUBMIT', 1],
      ['João Carlos Guardiano', 'ASO', 'UPLOAD_FROM_BASE', 1],
      [
        'Pedro Paulo Ferreira de Almeida',
        'Capacitação NR-12',
        'UPLOAD_FROM_BASE',
        2,
      ],
      [
        'Pedro Paulo Ferreira de Almeida',
        'Equipe de emergência e salvamento NR-33',
        'OBTAIN',
        2,
      ],
      ['Ana Desligada', 'ASO', 'OBTAIN', 3],
    ])
    expect(report.actions[1].evidence).toMatchObject({
      expiresOn: '2027-10-01',
    })
    expect(report.actions[0].note).toBe('Ilegível')
    expect(
      report.actions.find(a => a.worker === 'Ana Desligada')?.onActiveRoster
    ).toBe(false)
  })

  it('summarizes each portal', () => {
    expect(report.portals).toEqual([
      expect.objectContaining({
        workers: 4,
        cleared: 1,
        waiting: 0,
        blocked: 3,
        actions: { RESUBMIT: 1, UPLOAD_FROM_BASE: 2, OBTAIN: 2, RENEW: 0 },
      }),
    ])
  })
})
