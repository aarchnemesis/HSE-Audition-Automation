import {
  parseDateFromFilename,
  parseDocCode,
} from '../../adapters/drive/certificateFilenameParser.js'

export interface CensusFile {
  id: string
  name: string
  path: string[]
  mimeType: string
  size?: number
  md5?: string
  modifiedTime?: string
}

export interface CensusCollaborator {
  branch: string
  name: string
  folderId: string
  files: CensusFile[]
  folders: string[][]
}

export type FileFlag =
  | 'ZERO_BYTES'
  | 'DOUBLE_EXTENSION'
  | 'NO_EXTENSION'
  | 'NOT_PDF'
  | 'COPY_SUFFIX'
  | 'CLICKSIGN_SUFFIX'
  | 'NO_DATE'
  | 'NO_CODE'
  | 'FUTURE_DATE'
  | 'NON_STANDARD_NAME'

export type DocBand = 'VENCIDO' | 'BLOQUEADO' | 'PROGRAMAR' | 'VALIDO'

export interface AnalyzedFile extends CensusFile {
  code: string | null
  dateIso: string | null
  obsolete: boolean
  flags: FileFlag[]
}

export interface CollaboratorAnalysis {
  branch: string
  name: string
  folderId: string
  fileCount: number
  currentFileCount: number
  obsoleteFileCount: number
  maxDepth: number
  nestedObsoleteFolders: number
  missingCoreCodes: string[]
  duplicateCurrentCodes: string[]
  aso: {
    latestIso: string | null
    expiresIso: string | null
    band: DocBand | 'AUSENTE'
  }
  flagCounts: Partial<Record<FileFlag, number>>
  files: AnalyzedFile[]
}

export interface CensusSummary {
  refDateIso: string
  collaborators: number
  files: number
  currentFiles: number
  filesWithAnyFlag: number
  flagTotals: Partial<Record<FileFlag, number>>
  asoBands: Record<DocBand | 'AUSENTE', number>
  collaboratorsMissingAnyCore: number
  missingByCode: Record<string, number>
  collaboratorsWithDuplicates: number
  collaboratorsWithNestedObsoletes: number
  crossCollaboratorDuplicates: { md5: string; owners: string[] }[]
}

export const CORE_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '10',
  '11',
  '12',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '30',
  '12.1',
  '15.1',
  '20.1',
  '21.1',
]

export const BLOCK_DAYS = 60
export const PROGRAM_DAYS = 90
export const ASO_VALIDITY_MONTHS = 12

const OBSOLETE_FOLDER = /obsolet|obesoleto|0bsoleto|^0?0[.\s_-]/i
const BOOK_NAME =
  /^\d{2}_[A-Z0-9]+-[A-Z]+_EMI-\d{4}-\d{2}-\d{2}_VAL-(\d{4}-\d{2}-\d{2}|NA)_[A-Z-]+\.pdf$/
const LEGACY_NAME = /^\d{2}(\.\d)?\s*[-–]\s*.+[-–]\s*.+\.pdf$/i

export function isObsoletePath(path: string[]): boolean {
  return path.some(seg => OBSOLETE_FOLDER.test(seg.trim()))
}

export function classifyBand(expires: Date, refDate: Date): DocBand {
  const days = Math.floor((expires.getTime() - refDate.getTime()) / 86_400_000)
  if (days < 0) return 'VENCIDO'
  if (days <= BLOCK_DAYS) return 'BLOQUEADO'
  if (days <= PROGRAM_DAYS) return 'PROGRAMAR'
  return 'VALIDO'
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + months)
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return d
}

export function flagFile(file: CensusFile, refDate: Date): FileFlag[] {
  const flags: FileFlag[] = []
  const name = file.name
  const isGoogleNative = file.mimeType.startsWith('application/vnd.google-apps')
  if (file.size === 0 && !isGoogleNative) flags.push('ZERO_BYTES')
  if (/\.pdf\.pdf$/i.test(name)) flags.push('DOUBLE_EXTENSION')
  if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) flags.push('NO_EXTENSION')
  else if (!/\.pdf$/i.test(name)) flags.push('NOT_PDF')
  if (/\(\d+\)(\.[a-z]+)*$/i.test(name.replace(/\.pdf$/i, '')))
    flags.push('COPY_SUFFIX')
  if (/clicksign/i.test(name)) flags.push('CLICKSIGN_SUFFIX')
  if (/sem[\s_-]?data/i.test(name)) flags.push('NO_DATE')
  else if (!parseDateFromFilename(name)) flags.push('NO_DATE')
  if (!parseDocCode(name)) flags.push('NO_CODE')
  const date = parseDateFromFilename(name)
  if (date && date.getTime() > refDate.getTime()) flags.push('FUTURE_DATE')
  if (!BOOK_NAME.test(name) && !LEGACY_NAME.test(name))
    flags.push('NON_STANDARD_NAME')
  return flags
}

export function analyzeCollaborator(
  c: CensusCollaborator,
  refDate: Date
): CollaboratorAnalysis {
  const files: AnalyzedFile[] = c.files.map(f => {
    const date = parseDateFromFilename(f.name)
    return {
      ...f,
      code: parseDocCode(f.name),
      dateIso: date ? date.toISOString() : null,
      obsolete: isObsoletePath(f.path),
      flags: flagFile(f, refDate),
    }
  })
  const current = files.filter(f => !f.obsolete)

  const codesPresent = new Set(current.map(f => f.code).filter(Boolean))
  const missingCoreCodes = CORE_CODES.filter(code => !codesPresent.has(code))

  const byKey = new Map<string, number>()
  for (const f of current) {
    if (!f.code || !f.dateIso) continue
    const key = `${f.code}|${f.dateIso.slice(0, 10)}`
    byKey.set(key, (byKey.get(key) ?? 0) + 1)
  }
  const duplicateCurrentCodes = [...byKey.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)

  const asoDates = current
    .filter(f => f.code === '01' && f.dateIso)
    .map(f => new Date(f.dateIso as string))
    .filter(d => d.getTime() <= refDate.getTime())
    .sort((a, b) => b.getTime() - a.getTime())
  const aso = asoDates.length
    ? (() => {
        const expires = addMonths(asoDates[0], ASO_VALIDITY_MONTHS)
        return {
          latestIso: asoDates[0].toISOString(),
          expiresIso: expires.toISOString(),
          band: classifyBand(expires, refDate),
        }
      })()
    : { latestIso: null, expiresIso: null, band: 'AUSENTE' as const }

  const flagCounts: Partial<Record<FileFlag, number>> = {}
  for (const f of files)
    for (const flag of f.flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1

  const nestedObsoleteFolders = c.folders.filter(
    p => p.length > 1 && OBSOLETE_FOLDER.test(p[p.length - 1].trim())
  ).length

  return {
    branch: c.branch,
    name: c.name,
    folderId: c.folderId,
    fileCount: files.length,
    currentFileCount: current.length,
    obsoleteFileCount: files.length - current.length,
    maxDepth: files.reduce((m, f) => Math.max(m, f.path.length), 0),
    nestedObsoleteFolders,
    missingCoreCodes,
    duplicateCurrentCodes,
    aso,
    flagCounts,
    files,
  }
}

export function summarize(
  analyses: CollaboratorAnalysis[],
  refDate: Date
): CensusSummary {
  const flagTotals: Partial<Record<FileFlag, number>> = {}
  const asoBands: CensusSummary['asoBands'] = {
    VENCIDO: 0,
    BLOQUEADO: 0,
    PROGRAMAR: 0,
    VALIDO: 0,
    AUSENTE: 0,
  }
  const missingByCode: Record<string, number> = {}
  const owners = new Map<string, Set<string>>()
  let files = 0
  let currentFiles = 0
  let filesWithAnyFlag = 0

  for (const a of analyses) {
    files += a.fileCount
    currentFiles += a.currentFileCount
    asoBands[a.aso.band]++
    for (const code of a.missingCoreCodes)
      missingByCode[code] = (missingByCode[code] ?? 0) + 1
    for (const f of a.files) {
      if (f.flags.length) filesWithAnyFlag++
      for (const flag of f.flags) flagTotals[flag] = (flagTotals[flag] ?? 0) + 1
      if (f.md5 && (f.size ?? 0) > 0) {
        const set = owners.get(f.md5) ?? new Set<string>()
        set.add(a.name)
        owners.set(f.md5, set)
      }
    }
  }

  return {
    refDateIso: refDate.toISOString(),
    collaborators: analyses.length,
    files,
    currentFiles,
    filesWithAnyFlag,
    flagTotals,
    asoBands,
    collaboratorsMissingAnyCore: analyses.filter(a => a.missingCoreCodes.length)
      .length,
    missingByCode,
    collaboratorsWithDuplicates: analyses.filter(
      a => a.duplicateCurrentCodes.length
    ).length,
    collaboratorsWithNestedObsoletes: analyses.filter(
      a => a.nestedObsoleteFolders
    ).length,
    crossCollaboratorDuplicates: [...owners.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([md5, set]) => ({ md5, owners: [...set] })),
  }
}
