import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  DEFAULT_CENSUS_DIR,
  loadPortalCensuses,
} from '../adapters/portais/PortalCensusStore.js'
import { loadProjectBriefing } from '../adapters/smartsheet/SmartsheetBriefingAdapter.js'
import { loadPortalAccessRows } from '../adapters/smartsheet/SmartsheetPortalAccessAdapter.js'
import { buildPortalCoverage } from '../domain/services/PortalCoverage.js'

const refDateArg = process.argv
  .find(a => a.startsWith('--ref-date='))
  ?.split('=')[1]
const REF_DATE = refDateArg ? new Date(refDateArg) : new Date()

async function main() {
  const [accessRows, { projects }] = await Promise.all([
    loadPortalAccessRows(),
    loadProjectBriefing(),
  ])
  const coverage = buildPortalCoverage({
    refDate: REF_DATE,
    accessRows,
    projects,
    censuses: loadPortalCensuses(),
  })

  const outPath = path.join(DEFAULT_CENSUS_DIR, 'portal_coverage.json')
  fs.writeFileSync(outPath, JSON.stringify(coverage, null, 2), 'utf-8')

  for (const row of coverage.portals)
    console.log(
      [
        row.portal.category.padEnd(9),
        row.portal.automation.padEnd(14),
        (row.activity ?? '-').padEnd(11),
        String(row.accessRows).padStart(2),
        row.portal.name,
      ].join(' ')
    )
  console.log(
    `\n[PortalCoverage] ${coverage.portals.length} plataformas; ${coverage.unmatchedRows.length} linhas da base sem plataforma no catálogo; ${coverage.clientsWithoutPortal.length} clientes do Briefing sem canal de documentação`
  )
  for (const r of coverage.unmatchedRows)
    console.log(`  sem catálogo: ${r.client} | ${r.channel} | ${r.host}`)
  for (const c of coverage.clientsWithoutPortal)
    console.log(`  sem canal: ${c.client} (${c.activity})`)
  console.log(`[PortalCoverage] Gravado em ${outPath}`)
}

main().catch(err => {
  console.error('[PortalCoverage] Falha:', err)
  process.exit(1)
})
