import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { isDayAllowedForEmail } from '../adapters/email/emailScheduleValidator.js'
import {
  ExecutiveDashboardSummary,
  buildExecutiveDashboardHtml,
} from '../adapters/email/emailTemplates.js'
import { calculateExecutiveKPIs } from '../domain/services/ExecutiveDashboardCalculator.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'
import { IEmailService } from '../ports/IEmailService.js'

const refDateArg = process.argv
  .find(a => a.startsWith('--ref-date='))
  ?.split('=')[1]
const REF_DATE = refDateArg
  ? new Date(refDateArg)
  : process.env.HSE_REF_DATE
    ? new Date(process.env.HSE_REF_DATE)
    : new Date()

const toArg = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]
const DEFAULT_EXEC_EMAIL_RECIPIENTS =
  'marcelo.freitas@arthwind.com.br,leonardo.gaem@arthwind.com.br'
const EXEC_EMAIL_RECIPIENT =
  toArg || process.env.EXEC_EMAIL_TO || DEFAULT_EXEC_EMAIL_RECIPIENTS

let SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'
const FORCE_EMAIL =
  process.argv.includes('--force-email') || process.env.FORCE_EMAIL === 'true'
const FORCE_SYNC =
  process.argv.includes('--force-sync') || process.argv.includes('--sync')

const allowedDaysArg = process.argv
  .find(a => a.startsWith('--allowed-days='))
  ?.split('=')[1]
const allowedDaysEnv =
  process.env.ALLOWED_EMAIL_DAYS || allowedDaysArg || '1,3,5'

if (allowedDaysEnv && !SKIP_EMAIL && !FORCE_EMAIL) {
  if (!isDayAllowedForEmail(allowedDaysEnv, REF_DATE)) {
    const currentDow = new Date(
      REF_DATE.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    ).getDay()
    console.log(
      `[ExecDashboardEmail] Hoje (dia da semana ${currentDow}) não é dia de envio do Dashboard Executivo (${allowedDaysEnv}) — gerando preview com SKIP_EMAIL=true.\n`
    )
    SKIP_EMAIL = true
  }
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   HSE AUDIT AUTOMATION - ATUALIZAÇÃO DO DASHBOARD EXECUTIVO (SSOT)'
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(`   Destinatários: ${EXEC_EMAIL_RECIPIENT}`)
  console.log(
    '================================================================================\n'
  )

  const scratchDir = path.join(process.cwd(), 'scratch')
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })

  // 1. Obter dados unificados via SSOT
  const pipeline = new HSEDataPipeline()
  const syncResult = await pipeline.getOrSync({
    refDate: REF_DATE,
    preferSnapshot: !FORCE_SYNC,
  })

  // 2. Calcular KPIs Executivos
  const kpis = calculateExecutiveKPIs(syncResult.records)
  const rpoDivergencesCount = syncResult.rpoDivergences.filter(
    d => d.divergent
  ).length

  console.log('[ExecDashboardEmail] Indicadores calculados:')
  console.log(`   - Total de Colaboradores: ${kpis.totalCollaborators}`)
  console.log(`   - Aptos P/ Campo: ${kpis.aptosCount} (${kpis.aptosRate}%)`)
  console.log(`   - Bloqueados (Pendência): ${kpis.bloqueadosCount}`)
  console.log(`   - Em Treinamento (Storz): ${kpis.emTreinamentoCount}`)
  console.log(`   - Divergências RPO: ${rpoDivergencesCount}\n`)

  const summary: ExecutiveDashboardSummary = {
    refDate: REF_DATE,
    dashboardUrl:
      process.env.HSE_DASHBOARD_URL ||
      'https://hse-audition-automation.vercel.app',
    totalCollaborators: kpis.totalCollaborators,
    aptosCount: kpis.aptosCount,
    aptosRate: kpis.aptosRate,
    bloqueadosCount: kpis.bloqueadosCount,
    emTreinamentoCount: kpis.emTreinamentoCount,
    rpoDivergencesCount,
    sourceHealth: {
      driveStatus: syncResult.sourceHealth?.drive?.status || 'ONLINE',
      smartsheetStatus: syncResult.sourceHealth?.smartsheet?.status || 'ONLINE',
      storzStatus: syncResult.sourceHealth?.storz?.status || 'ONLINE',
      lastSync: syncResult.metadata.syncTimestamp,
    },
  }

  // 3. Gerar pré-visualização do corpo do e-mail
  const bodyHtml = buildExecutiveDashboardHtml(summary)
  const previewPath = path.join(scratchDir, 'executive_dashboard_preview.html')
  fs.writeFileSync(previewPath, bodyHtml, 'utf-8')
  console.log(`[ExecDashboardEmail] Preview HTML salvo em: ${previewPath}\n`)

  if (SKIP_EMAIL) {
    console.log(
      '================================================================================'
    )
    console.log(
      '   PULANDO DISPARO DE E-MAIL (--no-email, SKIP_EMAIL=true ou dia não agendado)'
    )
    console.log(
      '================================================================================\n'
    )
    return
  }

  if (!EXEC_EMAIL_RECIPIENT) {
    console.log(
      '[ExecDashboardEmail] Nenhum destinatário configurado — pulando envio.\n'
    )
    return
  }

  console.log(
    '================================================================================'
  )
  console.log('   ENVIANDO E-MAIL DO DASHBOARD EXECUTIVO')
  console.log(
    '================================================================================'
  )

  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()
  const subject = `Dashboard HSE ArthWind — Atualização Executiva (${REF_DATE.toLocaleDateString('pt-BR')})`

  const emailRes = await emailService.sendEmail({
    to: EXEC_EMAIL_RECIPIENT,
    subject,
    htmlContent: bodyHtml,
  })

  console.log(
    `   ${emailRes.success ? 'Enviado com sucesso' : 'Falha no envio'} para ${EXEC_EMAIL_RECIPIENT}\n`
  )
}

main().catch(err => {
  console.error('[ExecDashboardEmail] Erro fatal:', err)
  process.exit(1)
})
