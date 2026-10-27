import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  DEFAULT_VERIDUSS_BASE_URL,
  cookieHeaderFromStorageState,
  extractVeridussCensus,
} from '../adapters/portais/VeridussRestAdapter.js'

// Pulls the Veriduss (Goldwind) worker census over its REST API, reusing a session saved by a
// prior login (human-renewed or `portal-login`). Writes data/portais/veriduss-goldwind.census.json.
//   pnpm run veriduss-extract -- [--session=path/to/session.json]

const VERIDUSS_HOST = new URL(DEFAULT_VERIDUSS_BASE_URL).host

async function main() {
  const sessionPath =
    process.argv.find(a => a.startsWith('--session='))?.split('=')[1] ||
    path.join(
      process.cwd(),
      'scratch',
      'portais',
      'sessions',
      'veriduss-goldwind.session.json'
    )
  if (!fs.existsSync(sessionPath))
    throw new Error(
      `Sessão não encontrada em ${sessionPath}. Faça login primeiro (portal-login ou sessão renovada por humano).`
    )

  const state = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
  const cookieHeader = cookieHeaderFromStorageState(state, VERIDUSS_HOST)
  if (!cookieHeader)
    throw new Error('A sessão não contém cookies do domínio Veriduss.')

  const census = await extractVeridussCensus({ cookieHeader })
  const out = savePortalCensus(census)
  const docs = census.workers.reduce((n, w) => n + w.documents.length, 0)
  console.log(
    `[Veriduss] ${census.workers.length} colaboradores, ${docs} documentos -> ${out}`
  )
}

main().catch(err => {
  console.error('[Veriduss] Falha:', err instanceof Error ? err.message : err)
  process.exit(1)
})
