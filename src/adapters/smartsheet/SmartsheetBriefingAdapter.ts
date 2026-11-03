import fs from 'fs'
import path from 'path'
import { ProjectAssignment } from '../../domain/models/ProjectAssignment.js'

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0'
export const DEFAULT_BRIEFING_SHEET_ID = '8309908081430404'
export const BRIEFING_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'portais',
  'project_briefing_cache.json'
)

interface SheetResponse {
  columns: { id: number; title: string }[]
  rows: {
    cells: { columnId: number; value?: unknown; displayValue?: string }[]
  }[]
}

function cellText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export function parseBriefingSheet(sheet: SheetResponse): ProjectAssignment[] {
  const titleById = new Map(sheet.columns.map(c => [c.id, c.title.trim()]))
  const projects: ProjectAssignment[] = []
  for (const row of sheet.rows) {
    const cells: Record<string, string> = {}
    for (const cell of row.cells)
      cells[titleById.get(cell.columnId) ?? ''] = cellText(
        cell.value ?? cell.displayValue
      )
    if (!cells.Cliente) continue
    const start = (cells['Inicio do Projeto'] ?? '').match(/^\d{4}-\d{2}-\d{2}/)
    projects.push({
      wo: cells.WO || undefined,
      client: cells.Cliente,
      windfarm: cells.Windfarm ?? '',
      scope: cells.Escopo || undefined,
      startDate: start?.[0],
      status: cells['Status.'] || undefined,
      team: cells.Equipe ?? '',
    })
  }
  return projects
}

/**
 * Read-only. Falls back to the last good copy in data/ when the API is unreachable, like the
 * RPO and Drive adapters do, so a Smartsheet hiccup never blocks the e-mail.
 */
export async function loadProjectBriefing(
  apiToken = process.env.SMARTSHEET_API_TOKEN,
  sheetId = process.env.SMARTSHEET_BRIEFING_SHEET_ID ||
    DEFAULT_BRIEFING_SHEET_ID,
  cachePath = BRIEFING_CACHE_PATH
): Promise<{ projects: ProjectAssignment[]; fromCache: boolean }> {
  try {
    if (!apiToken) throw new Error('SMARTSHEET_API_TOKEN não definido')
    const resp = await fetch(`${SMARTSHEET_API_BASE}/sheets/${sheetId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    if (!resp.ok) throw new Error(`Smartsheet API retornou ${resp.status}`)
    const projects = parseBriefingSheet(await resp.json())
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(projects, null, 2), 'utf-8')
    return { projects, fromCache: false }
  } catch (err) {
    if (!fs.existsSync(cachePath)) throw err
    console.warn(
      `[SmartsheetBriefingAdapter] ${(err as Error).message}; usando cache ${cachePath}`
    )
    return {
      projects: JSON.parse(fs.readFileSync(cachePath, 'utf-8')),
      fromCache: true,
    }
  }
}
