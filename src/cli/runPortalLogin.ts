import 'dotenv/config'
import path from 'path'
import {
  closeSession,
  getLoginConfig,
  launchAndLogin,
  saveStorageState,
} from '../adapters/portais/PortalLoginHarness.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

// Logs into one Tier-3 portal with the credentials from the EHS sheet and saves the authenticated
// session (storageState) for a later REST/scrape run to reuse. Credential values are never
// printed — only the redacted identity.
//   pnpm run portal-login -- egestiona-vestaslatam [--client="VESTAS LATAM"] [--headful]

const SESSION_DIR = path.join(process.cwd(), 'scratch', 'portais', 'sessions')

async function main() {
  const portalId = process.argv[2]
  if (!portalId || portalId.startsWith('--')) {
    console.error(
      'Uso: pnpm run portal-login -- <portalId> [--client="..."] [--headful]'
    )
    process.exit(1)
  }
  const client = process.argv
    .find(a => a.startsWith('--client='))
    ?.split('=')[1]
    ?.replace(/^["']|["']$/g, '')
  const headful = process.argv.includes('--headful')

  const config = getLoginConfig(portalId)
  if (!config)
    throw new Error(
      `Portal "${portalId}" não tem config de login automático (captcha/2FA ou não mapeado). Renove a sessão manualmente.`
    )

  const cred = findCredential(await loadPortalCredentials(), {
    portalId,
    client,
  })
  if (!cred)
    throw new Error(
      `Sem credencial na planilha para ${portalId}${client ? ` / ${client}` : ''}`
    )

  console.log('[PortalLogin] entrando:', redactCredential(cred))
  const session = await launchAndLogin({ config, cred, headless: !headful })
  try {
    const out = path.join(SESSION_DIR, `${portalId}.session.json`)
    await saveStorageState(session, out)
    console.log(`[PortalLogin] sessão salva em ${out}`)
  } finally {
    await closeSession(session)
  }
}

main().catch(err => {
  console.error(
    '[PortalLogin] Falha:',
    err instanceof Error ? err.message : err
  )
  process.exit(1)
})
