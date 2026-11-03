import fs from 'fs'
import path from 'path'
import { PortalCensus, PortalWorker } from '../../domain/models/PortalCensus.js'
import {
  normalizeEgestiona,
  normalizeSurisoft,
  normalizeTdoc,
  normalizeVeriduss,
} from './LegacyCensusNormalizers.js'

export const DEFAULT_CENSUS_DIR = path.join(process.cwd(), 'data', 'portais')

const LEGACY_FILES: Record<
  string,
  { file: string; normalize: (raw: any, capturedAt: string) => PortalWorker[] }
> = {
  'tdoc-sgre': { file: 'gamesa-census.json', normalize: normalizeTdoc },
  'veriduss-goldwind': {
    file: 'goldwind-census.json',
    normalize: normalizeVeriduss,
  },
  surisoft: { file: 'suricatta-census.json', normalize: normalizeSurisoft },
  'egestiona-vestaslatam': {
    file: 'vestas-census.json',
    normalize: normalizeEgestiona,
  },
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

/**
 * Loads one census per portal: the newer of `<portalId>.census.json` (already a PortalCensus)
 * and the legacy raw snapshot, whose capture time is the file's mtime.
 */
export function loadPortalCensuses(
  dir: string = DEFAULT_CENSUS_DIR
): PortalCensus[] {
  if (!fs.existsSync(dir)) return []
  const censuses = new Map<string, PortalCensus>()

  for (const [portalId, legacy] of Object.entries(LEGACY_FILES)) {
    const filePath = path.join(dir, legacy.file)
    if (!fs.existsSync(filePath)) continue
    const capturedAt = fs.statSync(filePath).mtime.toISOString()
    censuses.set(portalId, {
      portalId,
      capturedAt,
      workers: legacy.normalize(readJson(filePath), capturedAt),
    })
  }

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.census.json')) continue
    const census = readJson(path.join(dir, file)) as PortalCensus
    if (!census.portalId || !Array.isArray(census.workers)) continue
    const legacy = censuses.get(census.portalId)
    if (!legacy || census.capturedAt >= legacy.capturedAt)
      censuses.set(census.portalId, census)
  }

  return Array.from(censuses.values())
}

export function savePortalCensus(
  census: PortalCensus,
  dir: string = DEFAULT_CENSUS_DIR
): string {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${census.portalId}.census.json`)
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(census, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
  return filePath
}
