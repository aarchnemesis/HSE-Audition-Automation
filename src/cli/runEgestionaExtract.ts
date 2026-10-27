import 'dotenv/config'
import { scrapeEgestionaCensus } from '../adapters/portais/EgestionaScraper.js'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  closeSession,
  getLoginConfig,
  launchAndLogin,
} from '../adapters/portais/PortalLoginHarness.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

// Logs into an eGestiona tenant and scrapes its workforce grid into a PortalCensus.
//   pnpm run egestiona-extract -- [egestiona-vestaslatam] [--client="..."] [--headful]

async function main() {
  const portalId =
    process.argv.slice(2).find(a => !a.startsWith('--')) ||
    'egestiona-vestaslatam'
  const client = process.argv
    .find(a => a.startsWith('--client='))
    ?.split('=')[1]
    ?.replace(/^["']|["']$/g, '')
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config || config.system !== 'eGestiona')
    throw new Error(`"${portalId}" não é um portal eGestiona com login mapeado`)

  const cred = findCredential(await loadPortalCredentials(), {
    portalId,
    client,
  })
  if (!cred) throw new Error(`Sem credencial na planilha para ${portalId}`)

  console.log('[eGestiona] entrando:', redactCredential(cred))
  const session = await launchAndLogin({ config, cred, headless: !headful })
  try {
    const census = await scrapeEgestionaCensus(session.page, { portalId })
    if (census.workers.length === 0) {
      console.warn(
        '[eGestiona] Raspagem vazia (0 colaboradores) — censo existente preservado, nada gravado.'
      )
      return
    }
    const out = savePortalCensus(census)
    const docs = census.workers.reduce((n, w) => n + w.documents.length, 0)
    console.log(
      `[eGestiona] ${census.workers.length} colaboradores, ${docs} documentos -> ${out}`
    )
  } finally {
    await closeSession(session)
  }
}

main().catch(err => {
  console.error('[eGestiona] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
