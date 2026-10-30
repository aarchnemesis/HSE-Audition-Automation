import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { wrapEmailHtml } from '../adapters/email/emailTemplates.js'
import {
  buildEhsQueueBodyHtml,
  buildOpsReadinessBodyHtml,
  formatDay,
} from '../adapters/email/portalPendencyTemplates.js'
import { writePortalReportWorkbook } from '../adapters/excel/PortalReportWorkbook.js'
import { loadPortalCensuses } from '../adapters/portais/PortalCensusStore.js'
import { loadProjectBriefing } from '../adapters/smartsheet/SmartsheetBriefingAdapter.js'
import { HSEDatabaseRepository } from '../domain/services/HSEDatabaseRepository.js'
import { buildPortalPendencyReport } from '../domain/services/PortalPendencyReportBuilder.js'
import { EmailMessage, IEmailService } from '../ports/IEmailService.js'

function arg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
}

const refDateArg = arg('ref-date') || process.env.HSE_REF_DATE
const REF_DATE = refDateArg ? new Date(refDateArg) : new Date()
const SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'
const EHS_TO =
  arg('to-ehs') || process.env.PORTAL_EHS_EMAIL_TO || process.env.HSE_EMAIL_TO
const OPS_TO =
  arg('to-ops') || process.env.PORTAL_OPS_EMAIL_TO || process.env.DO_EMAIL_TO

async function main() {
  console.log(
    '================================================================================'
  )
  console.log('   HSE AUDIT AUTOMATION - PENDÊNCIAS NOS PORTAIS DE CLIENTES')
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  const censuses = loadPortalCensuses()
  if (!censuses.length) {
    console.warn(
      '[PortalReport] Nenhum censo em data/portais — nada a reportar.\n'
    )
    return
  }
  for (const c of censuses)
    console.log(
      `[PortalReport] ${c.portalId}: ${c.workers.length} colaboradores (dados de ${formatDay(c.capturedAt)})`
    )

  const { projects, fromCache } = await loadProjectBriefing()
  console.log(
    `[PortalReport] Briefing de Projetos: ${projects.length} linhas${fromCache ? ' (cache)' : ''}`
  )
  const baseRecords = new HSEDatabaseRepository().getAllRecords()

  const report = buildPortalPendencyReport({
    refDate: REF_DATE,
    censuses,
    projects,
    baseRecords,
  })
  console.log(
    `[PortalReport] ${report.projects.length} projetos na janela, ${report.actions.length} ações (${report.actions.filter(a => a.priority < 3).length} para pessoas escaladas), ${report.gaps.length} clientes sem leitura automática\n`
  )

  const outDir = path.join(process.cwd(), 'scratch', 'portais')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = report.refDate
  const workbookPath = path.join(outDir, `pendencias-portais-${stamp}.xlsx`)
  await writePortalReportWorkbook(report, workbookPath)
  console.log(`[PortalReport] Planilha gerada em: ${workbookPath}`)

  const day = formatDay(report.refDate)
  const messages: (EmailMessage & { audience: string; envVar: string })[] = [
    {
      audience: 'ehs',
      envVar: 'PORTAL_EHS_EMAIL_TO',
      to: EHS_TO ?? '',
      subject: `Portais de clientes: fila de documentação (${day})`,
      htmlContent: buildEhsQueueBodyHtml(report),
      attachments: [
        { filename: `pendencias-portais-${stamp}.xlsx`, path: workbookPath },
      ],
    },
    {
      audience: 'coordenacao',
      envVar: 'PORTAL_OPS_EMAIL_TO',
      to: OPS_TO ?? '',
      subject: `Prontidão documental das equipes nos clientes (${day})`,
      htmlContent: buildOpsReadinessBodyHtml(report, EHS_TO || 'equipe EHS'),
    },
  ]

  if (SKIP_EMAIL) {
    for (const m of messages) {
      const previewPath = path.join(
        outDir,
        `preview-${m.audience}-${stamp}.html`
      )
      fs.writeFileSync(previewPath, wrapEmailHtml(m.subject, m.htmlContent))
      console.log(`[PortalReport] Preview ${m.audience}: ${previewPath}`)
    }
    return
  }

  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService(outDir)
  for (const { audience, envVar, ...message } of messages) {
    if (!message.to) {
      console.log(
        `[PortalReport] ${envVar} não configurado: e-mail ${audience} não enviado`
      )
      continue
    }
    const res = await emailService.sendEmail(message)
    console.log(
      `[PortalReport] ${audience}: ${res.success ? 'enviado' : 'falhou'} para ${message.to}`
    )
  }
}

main().catch(err => {
  console.error('[PortalReport] Falha ao gerar o relatório de portais:', err)
  process.exit(1)
})
