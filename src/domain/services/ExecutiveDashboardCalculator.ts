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

export interface ExecutiveKPIs {
  totalCollaborators: number
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

  let aptosCount = 0
  let bloqueadosCount = 0
  let emTreinamentoCount = 0

  for (const [, person] of peopleMap.entries()) {
    const isOffice = ['CO', 'ADM', 'EHS'].includes(person.role)
    const recMap = new Map<string, HSEDatabaseRecord>()
    let hasActiveStorz = false

    for (const r of person.records) {
      recMap.set(r.docCode, r)
      if (
        r.statusEHS === 'SOLICITADO_STORZ' ||
        r.statusEHS === 'STORZ_EM_ANDAMENTO' ||
        r.storzState === 'EM ANDAMENTO'
      ) {
        hasActiveStorz = true
      }
    }

    if (hasActiveStorz) {
      emTreinamentoCount++
    }

    if (isOffice) {
      // Funções de gestão/office são isentas de escalada técnica
      aptosCount++
      continue
    }

    let isBlocked = false
    for (const code of CORE_DOC_CODES) {
      const r = recMap.get(code)
      if (!r || r.statusEHS === 'AUSENTE' || r.statusEHS === 'VENCIDO') {
        isBlocked = true
        break
      }
    }

    if (isBlocked) {
      bloqueadosCount++
    } else {
      aptosCount++
    }
  }

  const totalCollaborators = peopleMap.size
  const aptosRate =
    totalCollaborators > 0
      ? Math.round((aptosCount / totalCollaborators) * 100)
      : 100

  return {
    totalCollaborators,
    aptosCount,
    aptosRate,
    bloqueadosCount,
    emTreinamentoCount,
  }
}
