import {
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../../domain/models/PortalCensus.js'

// Raw shapes written by the first round of Playwright extractors (2026-10-26). New extractors
// write PortalCensus directly; these exist so the snapshots already captured stay usable.

const PT_MONTHS: Record<string, string> = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
}

function pad(n: string): string {
  return n.padStart(2, '0')
}

/** "28/out/2026" (TDoc) or "26/11/2026" (Surisoft) or "2026-11-26" (Veriduss) -> "2026-11-26" */
export function parsePortalDate(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const br = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) return `${br[3]}-${pad(br[2])}-${pad(br[1])}`
  const tdoc = raw.match(/(\d{1,2})\/([a-z]{3})\/(\d{4})/i)
  const month = tdoc && PT_MONTHS[tdoc[2].toLowerCase()]
  if (tdoc && month) return `${tdoc[3]}-${month}-${pad(tdoc[1])}`
  return undefined
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function cleanNote(raw?: string | null): string | undefined {
  const note = raw?.replace(/\s+/g, ' ').trim()
  return note ? note : undefined
}

const LETTER_STATUS: Record<string, PortalDocStatus> = {
  a: 'APPROVED',
  v: 'EXPIRING',
  e: 'IN_REVIEW',
  p: 'MISSING',
  r: 'REJECTED',
  d: 'WAIVED',
}

function letterDocument(
  title: string,
  letter: string,
  validade: string | null | undefined,
  note: string | null | undefined,
  required = true
): PortalDocument {
  const status = LETTER_STATUS[letter] ?? 'IN_REVIEW'
  return {
    title: cleanTitle(title),
    status,
    expiresOn: parsePortalDate(validade),
    // Veriduss fills the reason field with the approval criteria even on approved documents.
    note: status === 'REJECTED' ? cleanNote(note) : undefined,
    required,
  }
}

interface TdocEntry {
  documento: string
  status?: string
}

interface TdocWorker {
  nome: string
  cpf?: string
  funcao?: string
  proprietario?: string
  pendencias?: TdocEntry[]
  documentosOK?: (TdocEntry | string)[]
}

/**
 * TDoc prints one date next to every status. On approved documents it is the expiry date when
 * the document expires and the validation date when it does not (CTPS, NR authorizations), and
 * the page does not say which. A date before the capture is therefore read as a validation
 * date, so a still-approved document never shows up as expired.
 */
function tdocDocument(entry: TdocEntry, capturedOn: string): PortalDocument {
  const raw = entry.status ?? ''
  const date = parsePortalDate(raw)
  const base = { title: cleanTitle(entry.documento), required: true }
  if (/^AUSENTE/i.test(raw)) return { ...base, status: 'MISSING' }
  if (/NO OK|Rejeitad/i.test(raw)) return { ...base, status: 'REJECTED' }
  if (/Pendente de Valida/i.test(raw))
    return {
      ...base,
      status: 'IN_REVIEW',
      note: date ? `Enviado em ${date}` : undefined,
    }
  if (/^OK/i.test(raw) || !raw)
    return {
      ...base,
      status: 'APPROVED',
      expiresOn: date && date >= capturedOn ? date : undefined,
    }
  return { ...base, status: 'IN_REVIEW', note: cleanNote(raw) }
}

export function normalizeTdoc(
  raw: TdocWorker[],
  capturedAt: string
): PortalWorker[] {
  const capturedOn = capturedAt.slice(0, 10)
  // CPF stays out: matching is by name and data/ is committed.
  return raw.map(w => ({
    name: w.nome,
    role: w.funcao,
    contract: w.proprietario?.replace(/\s*\(.*?\)\s*$/, ''),
    documents: [
      ...(w.documentosOK ?? []).map(d =>
        tdocDocument(
          typeof d === 'string' ? { documento: d, status: 'OK' } : d,
          capturedOn
        )
      ),
      ...(w.pendencias ?? []).map(d => tdocDocument(d, capturedOn)),
    ],
  }))
}

interface LetterDoc {
  titulo: string
  status: string
  validade?: string | null
  motivo?: string | null
  motivoRejeicao?: string | null
  obrigatorio?: boolean
}

interface LetterWorker {
  nome: string
  cliente?: string
  empresa?: string
  funcao?: string
  documentos?: LetterDoc[]
}

export function normalizeVeriduss(raw: LetterWorker[]): PortalWorker[] {
  return raw
    .filter(w => w.nome && w.nome !== 'DESCONHECIDO')
    .map(w => ({
      name: w.nome,
      role: w.funcao,
      contract: w.empresa,
      documents: (w.documentos ?? []).map(d =>
        letterDocument(d.titulo, d.status, d.validade, d.motivoRejeicao)
      ),
    }))
}

function surisoftClient(cliente = ''): string | undefined {
  if (/serena/i.test(cliente)) return 'SERENA'
  if (/\bGE\b/i.test(cliente)) return 'GE VERNOVA'
  return undefined
}

export function normalizeSurisoft(raw: LetterWorker[]): PortalWorker[] {
  return raw.map(w => ({
    name: w.nome,
    role: w.funcao,
    client: surisoftClient(w.cliente),
    contract: w.cliente,
    documents: (w.documentos ?? []).map(d =>
      letterDocument(
        d.titulo,
        d.status,
        d.validade,
        d.motivo,
        d.obrigatorio !== false
      )
    ),
  }))
}

export function normalizeEgestiona(raw: LetterWorker[]): PortalWorker[] {
  return raw.map(w => ({
    name: w.nome,
    role: w.funcao,
    contract: w.cliente,
    documents: (w.documentos ?? []).map(d =>
      letterDocument(d.titulo, d.status, d.validade, d.motivo)
    ),
  }))
}
