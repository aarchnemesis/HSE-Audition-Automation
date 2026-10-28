import 'dotenv/config'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  closeSession,
  getLoginConfig,
  launchAndLogin,
} from '../adapters/portais/PortalLoginHarness.js'
import { scrapeSurisoftCensus } from '../adapters/portais/SurisoftScraper.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

// Logs into Surisoft (Suricatta) and pulls each client's workforce via the internal document API.
//   pnpm run surisoft-extract -- [--headful]

async function main() {
  const portalId = 'surisoft'
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config) throw new Error('Login do Surisoft não mapeado')

  const cred = findCredential(await loadPortalCredentials(), { portalId })
  if (!cred) throw new Error('Sem credencial na planilha para surisoft')

  console.log('[Surisoft] entrando:', redactCredential(cred))
  const session = await launchAndLogin({ config, cred, headless: !headful })
  try {
    const census = await scrapeSurisoftCensus(session.page, {
      portalId,
      log: msg => console.log(`[Surisoft] ${msg}`),
    })
    if (census.workers.length === 0) {
      console.warn(
        '[Surisoft] Raspagem vazia (0 colaboradores) — censo existente preservado, nada gravado.'
      )
      return
    }
    const out = savePortalCensus(census)
    const docs = census.workers.reduce((n, w) => n + w.documents.length, 0)
    console.log(
      `[Surisoft] ${census.workers.length} colaboradores, ${docs} documentos -> ${out}`
    )
  } finally {
    await closeSession(session)
  }
}

main().catch(err => {
  console.error('[Surisoft] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
