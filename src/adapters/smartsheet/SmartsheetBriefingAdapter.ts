import fs from 'fs'
import path from 'path'
import { ProjectAssignment } from '../../domain/models/ProjectAssignment.js'

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0'
// ATW_OP_CT_001_PAINEL DE CAMPANHAS (replaces old '8309908081430404')
export const DEFAULT_BRIEFING_SHEET_ID = '4246973141962628'
export const BRIEFING_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'portais',
  'project_briefing_cache.json'
)

interface SheetResponse {
  columns: { id: number; title: string }[]
  rows: {
    rowNumber?: number
    cells: { columnId: number; value?: unknown; displayValue?: string }[]
  }[]
}

function cellText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

function cleanTechnicianName(raw: string): string | null {
  if (!raw) return null
  let clean = raw.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '')
  clean = clean.replace(
    /^(principal|secundario|secundário|lider|líder|resp|tecnico|técnico)\s*:\s*/i,
    ''
  )
  clean = clean.trim().replace(/^[-–\s]+|[-–\s]+$/g, '')
  return clean || null
}

function normalizeStatus(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Parses either ATW_OP_CT_001_PAINEL DE CAMPANHAS (4246973141962628) or legacy Briefing sheet.
 * For ATW_OP_CT_001:
 * - Only recognizes active projects with status 'Em execução' or 'Previsto'
 * - Client = EMPRESA column
 * - Project / Windfarm = PARQUE column
 * - Date = MOB or INICIO PROGRAMADO or INICIO [A] or INICIO
 * - Team = aggregated from LIDER, EQUIPE 01, EQUIPE 02, EQUIPE 03
 */
export function parseBriefingSheet(sheet: SheetResponse): ProjectAssignment[] {
  const titleById = new Map(sheet.columns.map(c => [c.id, c.title.trim()]))
  const projects: ProjectAssignment[] = []

  // Detect whether this is ATW_OP_CT_001 or legacy sheet
  const allTitles = new Set(sheet.columns.map(c => c.title.trim()))
  const isPainelCampanhas = allTitles.has('EMPRESA') && allTitles.has('PARQUE')

  for (const row of sheet.rows) {
    const cells: Record<string, string> = {}
    for (const cell of row.cells) {
      cells[titleById.get(cell.columnId) ?? ''] = cellText(
        cell.value ?? cell.displayValue
      )
    }

    if (isPainelCampanhas) {
      const statusRaw = cells['STATUS'] ?? ''
      const statusNorm = normalizeStatus(statusRaw)

      // Regra operacional: reconhecer como projetos ativos SOMENTE os com status "Em execução" e "Previsto"
      const isActive =
        statusNorm.includes('execucao') || statusNorm.includes('previsto')
      if (!isActive) continue

      const client = cells['EMPRESA'] ?? ''
      const windfarm = cells['PARQUE'] ?? ''
      if (!client && !windfarm) continue

      const rawDate =
        cells['MOB'] ||
        cells['INICIO PROGRAMADO'] ||
        cells['INICIO [A]'] ||
        cells['INICIO'] ||
        ''
      const start = rawDate.match(/^\d{4}-\d{2}-\d{2}/)

      // Team aggregation from leadership and team columns
      const techFields = [
        cells['LIDER'],
        cells['EQUIPE 01'],
        cells['EQUIPE 02'],
        cells['EQUIPE 03'],
      ].filter(Boolean)

      const techSet = new Set<string>()
      for (const field of techFields) {
        const parts = field.split(/[\r\n,;/]+/)
        for (const part of parts) {
          const name = cleanTechnicianName(part)
          if (name) techSet.add(name)
        }
      }
      const team = Array.from(techSet).sort().join(', ')

      const statusColor =
        cells['STATUS DO PROJETO'] ||
        (statusNorm.includes('execucao') ? 'Verde' : 'Amarelo')

      projects.push({
        wo: cells['WO'] || undefined,
        client,
        windfarm,
        scope: cells['ESCOPO'] || undefined,
        startDate: start?.[0],
        status: statusColor,
        team,
      })
    } else {
      // Legacy Briefing Sheet format
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
    const resp = await fetch(
      `${SMARTSHEET_API_BASE}/sheets/${sheetId}?pageSize=2000`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
      }
    )
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
