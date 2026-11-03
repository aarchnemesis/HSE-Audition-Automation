import { clientKey } from '../../domain/services/PortalCatalog.js'
import { matchAccessRow } from '../../domain/services/PortalCoverage.js'
import { hostOf } from './SmartsheetPortalAccessAdapter.js'

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0'
const DEFAULT_PORTAL_ACCESS_SHEET_ID = '8847419602429828'

/**
 * A single portal login, resolved at runtime from the EHS credentials sheet. The secret values
 * live only in memory: never log, serialize or commit a PortalCredential. Use redactCredential()
 * before printing anything derived from it.
 */
export interface PortalCredential {
  portalId: string
  client: string
  clientKey: string
  host: string
  url: string
  username: string
  password: string
  /** Third login field some portals ask for (eGestiona ClientName, TDoc realm client, ...). */
  clientCode?: string
}

interface SheetResponse {
  columns: { id: number; title: string }[]
  rows: {
    cells: { columnId: number; value?: unknown; displayValue?: unknown }[]
  }[]
}

function cell(value: unknown, display: unknown): string {
  const v = display ?? value
  return v === undefined || v === null ? '' : String(v).trim()
}

/** eGestiona and TDoc subdomains double as the tenant/client code (goldwind.egestiona.com). */
function clientCodeFromHost(host: string): string | undefined {
  const sub = host.split('.')[0]
  return sub && sub !== 'www' ? sub : undefined
}

export function parseCredentialSheet(sheet: SheetResponse): PortalCredential[] {
  const titleById = new Map(sheet.columns.map(c => [c.id, c.title.trim()]))
  const creds: PortalCredential[] = []
  for (const row of sheet.rows) {
    const c: Record<string, string> = {}
    for (const cl of row.cells)
      c[titleById.get(cl.columnId) ?? ''] = cell(cl.value, cl.displayValue)
    const username = c['USUÁRIO'] ?? ''
    const password = c.SENHA ?? ''
    if (!username || !password) continue
    const host = hostOf(c['LINK DE ACESSO'] ?? '')
    const portal = matchAccessRow({
      client: c.CLIENTE ?? '',
      channel: c['FORMA DE ENVIO'] ?? '',
      host,
      status: '',
      hasCredentials: true,
    })
    if (!portal) continue
    creds.push({
      portalId: portal.id,
      client: c.CLIENTE ?? '',
      clientKey: clientKey(c.CLIENTE ?? ''),
      host,
      url: c['LINK DE ACESSO'] ?? '',
      username,
      password,
      clientCode: clientCodeFromHost(host),
    })
  }
  return creds
}

export async function loadPortalCredentials(
  apiToken = process.env.SMARTSHEET_API_TOKEN,
  sheetId = process.env.SMARTSHEET_PORTAL_ACCESS_SHEET_ID ||
    DEFAULT_PORTAL_ACCESS_SHEET_ID
): Promise<PortalCredential[]> {
  if (!apiToken) throw new Error('SMARTSHEET_API_TOKEN não definido')
  let lastError: any
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(
        `${SMARTSHEET_API_BASE}/sheets/${sheetId}?pageSize=500`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      )
      if (resp.ok) {
        return parseCredentialSheet((await resp.json()) as SheetResponse)
      }
      lastError = new Error(`Smartsheet API retornou ${resp.status}`)
    } catch (e) {
      lastError = e
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt))
  }
  throw lastError
}

export interface CredentialQuery {
  portalId?: string
  host?: string
  client?: string
}

/** First credential matching all provided fields, preferring an exact client match. */
export function findCredential(
  creds: PortalCredential[],
  query: CredentialQuery
): PortalCredential | undefined {
  const wantClient = query.client ? clientKey(query.client) : undefined
  const matches = creds.filter(
    c =>
      (!query.portalId || c.portalId === query.portalId) &&
      (!query.host || c.host === query.host) &&
      (!wantClient || c.clientKey === wantClient)
  )
  return (
    matches.find(c => wantClient && c.clientKey === wantClient) ?? matches[0]
  )
}

/** Safe-to-log view: keeps identity, replaces the password with its presence. */
export function redactCredential(
  c: PortalCredential
): Record<string, string | boolean> {
  return {
    portalId: c.portalId,
    client: c.client,
    host: c.host,
    username: c.username.includes('@')
      ? `${c.username[0]}***@${c.username.split('@')[1] ?? ''}`
      : `${c.username.slice(0, 2)}***`,
    hasPassword: Boolean(c.password),
    clientCode: c.clientCode ?? '',
  }
}
