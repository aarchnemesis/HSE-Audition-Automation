import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../../domain/models/PortalCensus.js'

// eGestiona (classic ASP, frame-based) shows the subcontractor workforce as a grid whose
// compliance is encoded in traffic-light icons, not a document list:
//   DPR  Documentación Preventiva de Riesgos  — corporate preventive docs
//   DPE  Documentación Preventiva Específica  — site-specific clearance (park access)
//   ACT  cadastro ativo na Extranet Subcontratas
// Each is a green/red/grey image. This is coarse (three synthetic documents per worker) but
// honest: a red DPE is a real operational block. Per-document detail would need drilling into
// each worker's ficha (empleados_ficha.asp), left as a later enhancement.
//
// The scraper reads the grid rows into EgestionaRawRow[] inside page.evaluate(); everything from
// there on is this pure module, tested against fixtures.

export interface EgestionaRawRow {
  firstName: string
  lastName: string
  dni?: string
  empresa?: string
  dprImgSrc?: string
  dpeImgSrc?: string
  actImgSrc?: string
}

type Light = 'green' | 'red' | 'other'

function light(src?: string): Light {
  const s = (src ?? '').toLowerCase()
  if (s.includes('verde') || s.includes('green') || s.includes('check'))
    return 'green'
  if (s.includes('rojo') || s.includes('red')) return 'red'
  return 'other'
}

/** Header rows and separators have no real name/DNI; drop them. */
export function isDataRow(row: EgestionaRawRow): boolean {
  const first = (row.firstName ?? '').trim()
  const last = (row.lastName ?? '').trim()
  if (!first && !last) return false
  if (/nombre|nome/i.test(first)) return false
  if ((row.dni ?? '').trim().toUpperCase() === 'DNI') return false
  return true
}

function doc(
  title: string,
  status: PortalDocStatus,
  note?: string
): PortalDocument {
  return { title, status, required: true, note }
}

export function rowToWorker(row: EgestionaRawRow): PortalWorker | null {
  if (!isDataRow(row)) return null
  const dpr = light(row.dprImgSrc)
  const dpe = light(row.dpeImgSrc)
  const act = light(row.actImgSrc)
  const documents: PortalDocument[] = [
    doc(
      'DPR — Documentación Preventiva de Riesgos (normas corporativas)',
      dpr === 'green' ? 'APPROVED' : 'MISSING',
      dpr === 'green' ? undefined : 'Documentação preventiva pendente no portal'
    ),
    doc(
      'DPE — Documentación Preventiva Específica (acesso ao parque)',
      dpe === 'green' ? 'APPROVED' : dpe === 'red' ? 'REJECTED' : 'MISSING',
      dpe === 'green'
        ? undefined
        : 'Sem liberação específica para acesso ao parque'
    ),
    doc(
      'Cadastro ativo (Extranet Subcontratas)',
      act === 'green' ? 'APPROVED' : 'REJECTED',
      act === 'green' ? undefined : 'Cadastro inativo no portal'
    ),
  ]
  const name = `${(row.firstName ?? '').trim()} ${(row.lastName ?? '').trim()}`
    .replace(/\s+/g, ' ')
    .trim()
  return {
    name,
    contract: row.empresa?.trim() || undefined,
    documents,
  }
}

/** Pure: grid rows -> a PortalCensus, dropping header rows and de-duplicating by name. */
export function buildEgestionaCensus(
  rows: EgestionaRawRow[],
  options: { portalId: string; capturedAt: string }
): PortalCensus {
  const byName = new Map<string, PortalWorker>()
  for (const row of rows) {
    const worker = rowToWorker(row)
    if (!worker || !worker.name) continue
    byName.set(worker.name.toUpperCase(), worker)
  }
  return {
    portalId: options.portalId,
    capturedAt: options.capturedAt,
    workers: [...byName.values()],
  }
}
