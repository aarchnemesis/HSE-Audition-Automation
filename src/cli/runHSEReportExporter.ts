import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { buildDashboardHtml } from '../adapters/dashboard/DashboardHtmlGenerator.js'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'
import { HSEDatabaseRepository } from '../domain/services/HSEDatabaseRepository.js'
import { HSEFilterEngine } from '../domain/services/HSEFilterEngine.js'
import { buildPendencyDigest } from '../domain/services/PendencyDigestBuilder.js'
import { IEmailService } from '../ports/IEmailService.js'

const REF_DATE = process.env.HSE_REF_DATE
  ? new Date(process.env.HSE_REF_DATE)
  : new Date()
const DEFAULT_HSE_EMAIL_RECIPIENTS =
  'massude.afonso@arthwind.com.br,marcelo.freitas@arthwind.com.br,darliane.caetano@arthwind.com.br,joao.oliveira@arthwind.com.br'
const EMAIL_RECIPIENT = process.env.HSE_EMAIL_TO || DEFAULT_HSE_EMAIL_RECIPIENTS
const SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   HSE AUDIT AUTOMATION - RELATÓRIO CONSOLIDADO E DASHBOARD HSE (SSOT)'
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  // 1. Executar sincronizacao central via Fonte Unica da Verdade (SSOT)
  const pipeline = new HSEDataPipeline()
  const syncResult = await pipeline.executeSync({ refDate: REF_DATE })
  const dbRepo = new HSEDatabaseRepository()
  const filterEngine = new HSEFilterEngine(dbRepo)

  // 2. Consultas informativas para acompanhamento
  console.log(
    '\n================================================================================'
  )
  console.log('   CONSULTAS DE FILTROS HSE NO BANCO DE DADOS CONSOLIDADO')
  console.log(
    '================================================================================'
  )

  const storzPendingRecords = filterEngine.query({ storzOnly: true })
  console.log(
    `\nConsulta 1: Solicitacoes em Andamento na Storz (${storzPendingRecords.length} resultado(s)):`
  )
  storzPendingRecords.slice(0, 10).forEach(r => {
    console.log(
      ` - Inspetor: ${r.inspectorName} | Doc: ${r.docCode} (${r.docName}) | Storz ID: ${r.storzRequestId} [${r.storzState}]`
    )
  })

  const warningRecords = filterEngine.query({
    statusEHS: ['VENCE_30', 'SOLICITADO_STORZ', 'STORZ_EM_ANDAMENTO'],
  })
  console.log(
    `\nConsulta 2: Itens em Alerta (Vence 30d ou Storz) (${warningRecords.length} resultado(s)):`
  )
  warningRecords.slice(0, 10).forEach(r => {
    console.log(
      ` - ${r.inspectorName} | ${r.docName} | Status: ${r.statusEHS} | Detalhes: ${r.detail}`
    )
  })

  // 3. Exportar Relatorio Excel Oficial de HSE
  console.log(
    '\n================================================================================'
  )
  console.log('   GERANDO RELATORIO EXCEL CONSOLIDADO PARA A EQUIPE HSE')
  console.log(
    '================================================================================'
  )
  const excelPath = await filterEngine.exportToExcel(syncResult.records)
  console.log(`[HSEReportExporter] Relatorio Excel gerado em: ${excelPath}\n`)

  // 4. Gerar Dashboard HTML Autocontido
  console.log(
    '================================================================================'
  )
  console.log('   GERANDO DASHBOARD HTML PARA A EQUIPE HSE')
  console.log(
    '================================================================================'
  )
  const dashboardPath = path.join(
    process.cwd(),
    'scratch',
    'hse_dashboard.html'
  )
  const publicDir = path.join(process.cwd(), 'public')
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
  const publicDashboardPath = path.join(publicDir, 'index.html')

  const dashboardHtml = buildDashboardHtml(syncResult.records, {
    rpoDivergences: syncResult.rpoDivergences,
    storzHistory: syncResult.storzRequests,
    sourceHealth: syncResult.sourceHealth,
  })
  fs.writeFileSync(dashboardPath, dashboardHtml)
  fs.writeFileSync(publicDashboardPath, dashboardHtml)
  console.log(
    `[HSEReportExporter] Dashboard gerado em: ${dashboardPath} e ${publicDashboardPath}\n`
  )

  // 5. Enviar Resumo Diario por E-mail (ignorado se --no-email ou SKIP_EMAIL=true)
  if (SKIP_EMAIL) {
    console.log(
      '================================================================================'
    )
    console.log('   PULANDO ENVIO DE E-MAIL (--no-email ou SKIP_EMAIL=true)')
    console.log(
      '================================================================================\n'
    )
    return
  }

  console.log(
    '================================================================================'
  )
  console.log('   ENVIANDO RESUMO DIARIO DE PENDENCIAS')
  console.log(
    '================================================================================'
  )
  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()
  const digestGroups = buildPendencyDigest(syncResult.records)
  const digestRes = await emailService.sendDailyDigest(
    EMAIL_RECIPIENT,
    digestGroups,
    REF_DATE,
    [{ filename: 'hse_relatorio_consolidado.xlsx', path: excelPath }]
  )
  console.log(
    `   ${digestGroups.length} pessoa(s) com pendencia incluida(s) no resumo.`
  )
  console.log(
    `   Resumo ${digestRes.success ? 'enviado' : 'falhou'}${digestRes.filePath ? ` (${digestRes.filePath})` : ''}\n`
  )
}

main().catch(err => {
  console.error('[HSEReportExporter] Erro na execucao do relatorio HSE:', err)
  process.exit(1)
})
