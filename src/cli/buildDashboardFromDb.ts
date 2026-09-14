import fs from 'fs'
import path from 'path'
import { buildDashboardHtml } from '../adapters/dashboard/DashboardHtmlGenerator.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'

async function main() {
  const pipeline = new HSEDataPipeline()
  const snapshot = pipeline.loadExistingSnapshot()

  if (!snapshot) {
    console.error(
      '[buildDashboardFromDb] Nenhum dado consolidado encontrado em data/ ou scratch/.'
    )
    process.exit(1)
  }

  const html = buildDashboardHtml(snapshot.records, {
    rpoDivergences: snapshot.rpoDivergences,
    storzHistory: snapshot.storzRequests,
    sourceHealth: snapshot.sourceHealth,
  })

  const publicDir = path.join(process.cwd(), 'public')
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })

  fs.writeFileSync(path.join(publicDir, 'index.html'), html)
  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'hse_dashboard.html'),
    html
  )
  console.log(
    `[buildDashboardFromDb] Dashboard gerado com sucesso via SSOT! Tamanho: ${html.length} bytes`
  )
}

main().catch(err => {
  console.error('[buildDashboardFromDb] Erro:', err)
  process.exit(1)
})
