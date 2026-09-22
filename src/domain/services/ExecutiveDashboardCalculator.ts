import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

export const DRONE_CORE_CODES = new Set([
  '01', // ASO
  '08', // CNH
  '09', // Direção Defensiva
  '10', // NR-01
  '11', // NR-06
  '12', // NR-10
  '13', // NR-10 SEP
  '15', // NR-12
  '18', // NR-18
  '19', // NR-23
  '27', // NR-07
])

export const TURBINE_CORE_CODES = new Set([
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

// Manter CORE_DOC_CODES para compatibilidade retroativa
export const CORE_DOC_CODES = TURBINE_CORE_CODES

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
  isDrone: boolean
  hasStorz: boolean
  expiredItems: HSEDatabaseRecord[]
  missingItems: { docCode: string; statusEHS: string }[]
  alertItems: HSEDatabaseRecord[]
  storzActiveItems: HSEDatabaseRecord[]
  storzInProgressItems: HSEDatabaseRecord[]
}

export function getCollabOperationalHealth(person: {
  role: string
  rpoBranch?: string
  records: HSEDatabaseRecord[]
}): CollabOperationalHealth {
  const isOffice = ['CO', 'ADM', 'EHS'].includes(person.role)
  const isLeader = person.role === 'LO'
  const isDrone =
    person.rpoBranch === 'DRONE INSP. EQUIPAMENTO' ||
    (person.role === 'IE' && person.rpoBranch !== 'LPS - SPDA')
  const storzActiveItems = person.records.filter(isStorzActive)
  const hasStorz = storzActiveItems.length > 0

  if (isOffice) {
    return {
      status: 'ISENTO_CAMPO',
      isOffice: true,
      isLeader: false,
      isDrone: false,
      isMobilizavel: true,
      hasStorz,
      expiredItems: [],
      missingItems: [],
      alertItems: [],
      storzActiveItems,
      storzInProgressItems: [],
    }
  }

  const requiredCodes = new Set(isDrone ? DRONE_CORE_CODES : TURBINE_CORE_CODES)
  if (isDrone && person.records.some(r => r.docCode === '40')) {
    requiredCodes.add('40')
  }

  const recMap = new Map<string, HSEDatabaseRecord>()
  person.records.forEach(r => recMap.set(r.docCode, r))

  const expiredItems: HSEDatabaseRecord[] = []
  const missingItems: { docCode: string; statusEHS: string }[] = []
  const alertItems: HSEDatabaseRecord[] = []
  const storzInProgressItems: HSEDatabaseRecord[] = []

  requiredCodes.forEach(code => {
    const r = recMap.get(code)
    if (!r) {
      missingItems.push({ docCode: code, statusEHS: 'AUSENTE' })
    } else if (r.statusEHS === 'VENCIDO') {
      // Se o documento estiver vencido, mas a reciclagem já foi efetivamente iniciada na Storz
      // (progresso > 0%) e não for documento médico/legal estrito (ASO / CNH), flexibiliza para ALERTA
      const hasStorzProgress = Boolean(
        r.storzRequestId &&
          (r.storzProgressPercent || 0) > 0 &&
          code !== '01' &&
          code !== '08'
      )
      if (hasStorzProgress) {
        storzInProgressItems.push(r)
      } else {
        expiredItems.push(r)
      }
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
  } else if (alertItems.length > 0 || storzInProgressItems.length > 0) {
    status = 'ALERTA'
  }

  const isMobilizavel = status === 'APTO' || status === 'ALERTA'

  return {
    status,
    isMobilizavel,
    isOffice: false,
    isLeader,
    isDrone,
    hasStorz,
    expiredItems,
    missingItems,
    alertItems,
    storzActiveItems,
    storzInProgressItems,
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
  people: { role: string; rpoBranch?: string; records: HSEDatabaseRecord[] }[]
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
    { role: string; rpoBranch?: string; records: HSEDatabaseRecord[] }
  >()

  for (const r of records) {
    if (!peopleMap.has(r.inspectorName)) {
      peopleMap.set(r.inspectorName, {
        role: r.role,
        rpoBranch: r.rpoBranch,
        records: [],
      })
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
