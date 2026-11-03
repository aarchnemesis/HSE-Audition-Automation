import 'dotenv/config'
import { reportSessions } from '../adapters/portais/PortalSessionStore.js'

// Lists every saved portal session and whether it is still usable, so an operator running the
// human-renewed-session model knows what to re-login. Reads local files only; no network.
//   pnpm run portal-sessions

function main() {
  const reports = reportSessions()
  if (reports.length === 0) {
    console.log(
      '[PortalSessions] Nenhuma sessão salva em scratch/portais/sessions.'
    )
    return
  }
  for (const r of reports) {
    const h = r.health
    const flag = h.usable ? 'OK ' : 'RENOVAR'
    const expiry = h.nextExpiry ? ` até ${h.nextExpiry.slice(0, 10)}` : ''
    console.log(
      `${flag.padEnd(7)} ${r.portalId.padEnd(24)} válidos=${h.persistentValid} expirados=${h.persistentExpired} sessão=${h.sessionOnly}${expiry}`
    )
  }
  const stale = reports.filter(r => !r.health.usable).map(r => r.portalId)
  if (stale.length)
    console.log(`\n[PortalSessions] Renovar login: ${stale.join(', ')}`)
}

main()
