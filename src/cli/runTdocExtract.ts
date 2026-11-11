import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  closeSession,
  getLoginConfig,
  launchAndLogin,
} from '../adapters/portais/PortalLoginHarness.js'
import { scrapeTdocCensus } from '../adapters/portais/TDocScraper.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

// Logs into a TDoc tenant (Keycloak) and scrapes its tasks/workers/documents into a PortalCensus.
//   pnpm run tdoc-extract -- tdoc-sgre [--client="..."] [--max-tasks=5] [--headful]

async function main() {
  const portalId =
    process.argv.slice(2).find(a => !a.startsWith('--')) || 'tdoc-sgre'
  const client = process.argv
    .find(a => a.startsWith('--client='))
    ?.split('=')[1]
    ?.replace(/^["']|["']$/g, '')
  const maxTasks = Number(
    process.argv.find(a => a.startsWith('--max-tasks='))?.split('=')[1]
  )
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config || config.system !== 'TDoc')
    throw new Error(`"${portalId}" não é um portal TDoc com login mapeado`)

  const cred = findCredential(await loadPortalCredentials(), {
    portalId,
    client,
  })
  if (!cred) throw new Error(`Sem credencial na planilha para ${portalId}`)

  console.log('[TDoc] entrando:', redactCredential(cred))
  const session = await launchAndLogin({ config, cred, headless: !headful })
  try {
    const census = await scrapeTdocCensus(session.page, {
      portalId,
      maxTasks:
        Number.isFinite(maxTasks) && maxTasks > 0 ? maxTasks : undefined,
      log: msg => console.log(`[TDoc] ${msg}`),
    })
    if (census.workers.length === 0) {
      console.warn(
        '[TDoc] Raspagem vazia (0 colaboradores) — censo existente preservado, nada gravado.'
      )
      return
    }
    // A flaky run (JSF navigation drifting) can return a fraction of the workers. Never overwrite a
    // fuller census with a much smaller one unless explicitly forced.
    const prevPath = path.join(process.cwd(), 'data', 'portais', `${portalId}.census.json`)
    if (!process.argv.includes('--force') && fs.existsSync(prevPath)) {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf-8'))
      const prevCount = prev.workers?.length ?? 0
      if (prevCount > 0 && census.workers.length < prevCount * 0.8) {
        console.warn(
          `[TDoc] Censo incompleto (${census.workers.length} colaboradores vs ${prevCount} anteriores) — nada gravado. Use --force para sobrescrever.`
        )
        process.exitCode = 2
        return
      }
    }
    const out = savePortalCensus(census)
    const docs = census.workers.reduce((n, w) => n + w.documents.length, 0)
    console.log(
      `[TDoc] ${census.workers.length} colaboradores, ${docs} documentos -> ${out}`
    )
  } finally {
    await closeSession(session)
  }
}

main().catch(err => {
  console.error('[TDoc] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
