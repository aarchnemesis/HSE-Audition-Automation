import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

export const CORE_DOC_CODES = new Set([
  '01', // ASO
  '10', // GWO BST Trabalho em Altura (WAH)
  '11', // GWO BST Primeiros Socorros (FA)
  '12', // GWO BST Movimentação Manual de Cargas (MH)
  '14', // GWO BST Combate a Incêndio (FAW)
  '15', // NR-10 Básico
  '16', // NR-10 SEP
  '17', // NR-35 Trabalho em Altura
  '18', // NR-33 Espaço Confinado
  '19', // NR-12 Segurança em Máquinas
  '20', // PTA Plataforma Elevatória
  '21', // Ponte Rolante
  '22', // Talha Elétrica
  '30', // CNH
])

export function isStorzActive(r?: HSEDatabaseRecord): boolean {
  if (!r) return false
  return Boolean(
    (r.storzRequestId &&
      (r.storzState === 'EM_ANDAMENTO' || r.storzState === 'SOLICITADO')) ||
      r.statusEHS === 'SOLICITADO_STORZ' ||
      r.statusEHS === 'STORZ_EM_ANDAMENTO'
  )
}

export interface CollabOperationalHealth {
  status: 'APTO' | 'ALERTA' | 'BLOQUEADO' | 'ISENTO_CAMPO'
  isMobilizavel: boolean
  isOffice: boolean
  isLeader: boolean
  hasStorz: boolean
  expiredItems: HSEDatabaseRecord[]
  missingItems: { docCode: string; statusEHS: string }[]
  alertItems: HSEDatabaseRecord[]
  storzActiveItems: HSEDatabaseRecord[]
}

export function getCollabOperationalHealth(person: {
  role: string
  records: HSEDatabaseRecord[]
}): CollabOperationalHealth {
  const isOffice = ['CO', 'ADM', 'EHS'].includes(person.role)
  const isLeader = person.role === 'LO'
  const storzActiveItems = person.records.filter(isStorzActive)
  const hasStorz = storzActiveItems.length > 0

  if (isOffice) {
    return {
      status: 'ISENTO_CAMPO',
      isOffice: true,
      isLeader: false,
      isMobilizavel: true,
      hasStorz,
      expiredItems: [],
      missingItems: [],
      alertItems: [],
      storzActiveItems,
    }
  }

  const recMap = new Map<string, HSEDatabaseRecord>()
  person.records.forEach(r => recMap.set(r.docCode, r))

  const expiredItems: HSEDatabaseRecord[] = []
  const missingItems: { docCode: string; statusEHS: string }[] = []
  const alertItems: HSEDatabaseRecord[] = []

  CORE_DOC_CODES.forEach(code => {
    const r = recMap.get(code)
    if (!r) {
      missingItems.push({ docCode: code, statusEHS: 'AUSENTE' })
    } else if (r.statusEHS === 'VENCIDO') {
      expiredItems.push(r)
    } else if (r.statusEHS === 'AUSENTE') {
      missingItems.push({ docCode: code, statusEHS: 'AUSENTE' })
    } else if (
      ['VENCE_60', 'VENCE_30', 'VENCE_15', 'VENCE_07'].includes(r.statusEHS)
    ) {
      if (code !== '01') alertItems.push(r)
    }
  })

  let status: 'APTO' | 'ALERTA' | 'BLOQUEADO' = 'APTO'
  if (expiredItems.length > 0 || missingItems.length > 0) {
    status = 'BLOQUEADO'
  } else if (alertItems.length > 0) {
    status = 'ALERTA'
  }

  const isMobilizavel = status === 'APTO' || status === 'ALERTA'

  return {
    status,
    isMobilizavel,
    isOffice: false,
    isLeader,
    hasStorz,
    expiredItems,
    missingItems,
    alertItems,
    storzActiveItems,
  }
}

export interface SegmentKPIs {
  total: number
  aptoCount: number
  aptoPlenoCount: number
  alertaCount: number
  bloqueadoCount: number
  storzCount: number
  isentoCount: number
  aptoRate: number
}

function evaluateSegment(
  people: { role: string; records: HSEDatabaseRecord[] }[]
): SegmentKPIs {
  let aptoCount = 0
  let aptoPlenoCount = 0
  let alertaCount = 0
  let bloqueadoCount = 0
  let storzCount = 0
  let isentoCount = 0

  people.forEach(p => {
    const health = getCollabOperationalHealth(p)
    if (health.status === 'ISENTO_CAMPO') {
      isentoCount++
    } else {
      if (health.isMobilizavel) aptoCount++
      if (health.status === 'APTO') aptoPlenoCount++
      else if (health.status === 'ALERTA') alertaCount++
      else if (health.status === 'BLOQUEADO') bloqueadoCount++
    }
    if (health.hasStorz) storzCount++
  })

  const evaluableCount = people.length - isentoCount
  const aptoRate =
    evaluableCount > 0 ? Math.round((aptoCount / evaluableCount) * 100) : 100

  return {
    total: people.length,
    aptoCount,
    aptoPlenoCount,
    alertaCount,
    bloqueadoCount,
    storzCount,
    isentoCount,
    aptoRate,
  }
}

export interface ExecutiveKPIs {
  totalCollaborators: number
  frontline: SegmentKPIs
  leaders: SegmentKPIs
  office: SegmentKPIs
  all: SegmentKPIs
  // Compatibilidade retroativa
  aptosCount: number
  aptosRate: number
  bloqueadosCount: number
  emTreinamentoCount: number
}

export function calculateExecutiveKPIs(
  records: HSEDatabaseRecord[]
): ExecutiveKPIs {
  const peopleMap = new Map<
    string,
    { role: string; records: HSEDatabaseRecord[] }
  >()

  for (const r of records) {
    if (!peopleMap.has(r.inspectorName)) {
      peopleMap.set(r.inspectorName, { role: r.role, records: [] })
    }
    peopleMap.get(r.inspectorName)!.records.push(r)
  }

  const peopleList = Array.from(peopleMap.values())
  const frontlinePeople = peopleList.filter(p =>
    ['IQ', 'TO', 'IE'].includes(p.role)
  )
  const leadersPeople = peopleList.filter(p => p.role === 'LO')
  const officePeople = peopleList.filter(p =>
    ['CO', 'ADM', 'EHS'].includes(p.role)
  )

  const frontline = evaluateSegment(frontlinePeople)
  const leaders = evaluateSegment(leadersPeople)
  const office = evaluateSegment(officePeople)
  const all = evaluateSegment(peopleList)

  return {
    totalCollaborators: all.total,
    frontline,
    leaders,
    office,
    all,
    // Foco executivo na prontidão de campo (Linha de Frente):
    aptosCount: frontline.aptoCount,
    aptosRate: frontline.aptoRate,
    bloqueadosCount: frontline.bloqueadoCount,
    emTreinamentoCount: frontline.storzCount,
  }
}
