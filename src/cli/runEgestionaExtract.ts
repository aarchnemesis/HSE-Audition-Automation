import 'dotenv/config'
import { scrapeEgestionaCensus } from '../adapters/portais/EgestionaScraper.js'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import type { PortalWorker } from '../domain/models/PortalCensus.js'
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
  // Vestas Latam: contas validadas pela auditoria (13/11). Cada uma só enxerga a própria empresa:
  // "VESTAS CHILE 2" = colaboradores Arthwind; "ADENTU" = técnicos da Adentu (subcontratada chilena).
  const clients: (string | undefined)[] = client
    ? [client]
    : portalId === 'egestiona-vestaslatam' ? ['VESTAS CHILE 2', 'ADENTU'] : [undefined]
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config || config.system !== 'eGestiona')
    throw new Error(`"${portalId}" não é um portal eGestiona com login mapeado`)

  const creds = await loadPortalCredentials()
  const workers: PortalWorker[] = []
  let failures = 0
  for (const c of clients) {
    const cred = findCredential(creds, { portalId, client: c })
    if (!cred) {
      console.warn(`[eGestiona] sem credencial na planilha para ${portalId} ${c ?? ''}`)
      failures++
      continue
    }
    console.log('[eGestiona] entrando:', redactCredential(cred))
    const session = await launchAndLogin({ config, cred, headless: !headful }).catch(e => {
      console.warn(`[eGestiona] login falhou (${cred.client}): ${e instanceof Error ? e.message : e}`)
      return null
    })
    if (!session) { failures++; continue }
    try {
      const census = await scrapeEgestionaCensus(session.page, { portalId, log: m => console.log(`[eGestiona] ${cred.client}: ${m}`) })
      for (const w of census.workers) workers.push({ ...w, client: undefined, role: cred.client })
    } catch (e) {
      console.warn(`[eGestiona] leitura falhou (${cred.client}): ${e instanceof Error ? e.message : e}`)
      failures++
    } finally {
      await closeSession(session)
    }
  }
  // Uma conta que falhou encolheria o censo: nesse caso não grava por cima do anterior.
  if (workers.length === 0 || failures > 0) {
    console.warn(`[eGestiona] ${failures} conta(s) falharam, ${workers.length} colaboradores — censo existente preservado, nada gravado.`)
    if (workers.length === 0 || !process.argv.includes('--force')) return
  }
  const out = savePortalCensus({ portalId, capturedAt: new Date().toISOString(), workers })
  const docs = workers.reduce((n, w) => n + w.documents.length, 0)
  console.log(`[eGestiona] ${workers.length} colaboradores, ${docs} documentos -> ${out}`)
}

main().catch(err => {
  console.error('[eGestiona] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
