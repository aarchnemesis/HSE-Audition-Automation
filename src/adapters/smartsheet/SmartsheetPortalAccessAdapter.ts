import { PortalAccessRow } from '../../domain/services/PortalCoverage.js'

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0'
export const DEFAULT_PORTAL_ACCESS_SHEET_ID = '8847419602429828'

// The observations column sometimes carries a login and password in free text; only these
// status phrases are kept.
const STATUS_PATTERN =
  /OBSOLETO|Solicita(?:r)? novo (?:acesso|cadastro)|Solicitar cadastro|CONTRATO [^\n]*|emiss[aã]o dos crach[aá]s[^\n]*|Documentos (?:de colaborador|da empresa|de equipamentos[^\n]*|trabalhistas)/i

interface SheetResponse {
  columns: { id: number; title: string }[]
  rows: { cells: { columnId: number; value?: unknown }[] }[]
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export function hostOf(link: string): string {
  if (!link) return ''
  try {
    const host = new URL(link.startsWith('http') ? link : `https://${link}`)
      .host
    return host.includes('.') ? host : ''
  } catch {
    return ''
  }
}

/** Never returns user or password values, only whether they are filled in. */
export function parsePortalAccessSheet(
  sheet: SheetResponse
): PortalAccessRow[] {
  const titleById = new Map(sheet.columns.map(c => [c.id, c.title.trim()]))
  return sheet.rows.map(row => {
    const cells: Record<string, string> = {}
    for (const cell of row.cells)
      cells[titleById.get(cell.columnId) ?? ''] = text(cell.value)
    return {
      client: cells.CLIENTE ?? '',
      channel: cells['FORMA DE ENVIO'] ?? '',
      host: hostOf(cells['LINK DE ACESSO'] ?? ''),
      status: (cells['OBSERVAÇÕES'] ?? '').match(STATUS_PATTERN)?.[0] ?? '',
      hasCredentials: Boolean(cells['USUÁRIO'] && cells.SENHA),
    }
  })
}

export async function loadPortalAccessRows(
  apiToken = process.env.SMARTSHEET_API_TOKEN,
  sheetId = process.env.SMARTSHEET_PORTAL_ACCESS_SHEET_ID ||
    DEFAULT_PORTAL_ACCESS_SHEET_ID
): Promise<PortalAccessRow[]> {
  if (!apiToken) throw new Error('SMARTSHEET_API_TOKEN não definido')
  const resp = await fetch(`${SMARTSHEET_API_BASE}/sheets/${sheetId}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })
  if (!resp.ok) throw new Error(`Smartsheet API retornou ${resp.status}`)
  return parsePortalAccessSheet(await resp.json())
}
