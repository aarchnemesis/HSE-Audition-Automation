import 'dotenv/config'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  closeSession,
  getLoginConfig,
  launchAndLogin,
} from '../adapters/portais/PortalLoginHarness.js'
import { scrapeTechSocialCensus } from '../adapters/portais/TechSocialScraper.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

// Logs into TechSocial CPFL and scrapes the workforce compliance grid.
//   pnpm run techsocial-extract -- [--headful]

async function main() {
  const portalId = 'techsocial-cpfl'
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config) throw new Error('Login do TechSocial não mapeado')

  const cred = findCredential(await loadPortalCredentials(), { portalId })
  if (!cred) throw new Error('Sem credencial na planilha para techsocial-cpfl')

  console.log('[TechSocial] entrando:', redactCredential(cred))
  const session = await launchAndLogin({ config, cred, headless: !headful })
  try {
    const census = await scrapeTechSocialCensus(session.page, {
      portalId,
      log: msg => console.log(`[TechSocial] ${msg}`),
    })
    if (census.workers.length === 0) {
      console.warn(
        '[TechSocial] Raspagem vazia (0 colaboradores) — censo existente preservado, nada gravado.'
      )
      return
    }
    const out = savePortalCensus(census)
    const docs = census.workers.reduce((n, w) => n + w.documents.length, 0)
    console.log(
      `[TechSocial] ${census.workers.length} colaboradores, ${docs} documentos -> ${out}`
    )
  } finally {
    await closeSession(session)
  }
}

main().catch(err => {
  console.error('[TechSocial] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
