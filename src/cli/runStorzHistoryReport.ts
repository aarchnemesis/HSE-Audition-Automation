import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { buildDoDashboardHtml } from '../adapters/dashboard/DoDashboardHtmlGenerator.js'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { isDayAllowedForEmail } from '../adapters/email/emailScheduleValidator.js'
import {
  StorzRequest,
  computeCourseDeadline,
} from '../domain/models/StorzRequest.js'
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'
import {
  RetestAttempt,
  groupRetests,
} from '../domain/services/RetestTracker.js'
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
const DEFAULT_DO_EMAIL_RECIPIENTS =
  'mayanna.gomes@arthwind.com.br,joao.oliveira@arthwind.com.br'
const DO_EMAIL_RECIPIENT =
  toArg || process.env.DO_EMAIL_TO || DEFAULT_DO_EMAIL_RECIPIENTS
let SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'
const FORCE_EMAIL =
  process.argv.includes('--force-email') || process.env.FORCE_EMAIL === 'true'
const FORCE_SYNC =
  process.argv.includes('--force-sync') || process.argv.includes('--sync')

const allowedDaysArg = process.argv
  .find(a => a.startsWith('--allowed-days='))
  ?.split('=')[1]
const allowedDaysEnv = process.env.ALLOWED_EMAIL_DAYS || allowedDaysArg

if (allowedDaysEnv && !SKIP_EMAIL && !FORCE_EMAIL) {
  if (!isDayAllowedForEmail(allowedDaysEnv)) {
    const currentDow = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    ).getDay()
    console.log(
      `[StorzHistoryReport] Hoje (dia da semana ${currentDow}) não é dia de envio de e-mail (${allowedDaysEnv}) — gerando artefatos e dashboard com SKIP_EMAIL=true.\n`
    )
    SKIP_EMAIL = true
  }
}

const dateFmt = (d?: Date | string) => {
  if (!d) return ''
  const dateObj = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dateObj.getTime())
    ? ''
    : dateObj.toLocaleDateString('pt-BR')
}

const situacaoColors: Record<string, string> = {
  APROVADO: 'DCFCE7',
  CONCLUIDO: 'DCFCE7',
  REPROVADO: 'FEE2E2',
  CANCELADO: 'FEE2E2',
  'EM ANDAMENTO': 'FEF9C3',
}

const docLabel = (code: string, name: string) =>
  DOC_CATALOG_MAP[code] ? `${name} (${DOC_CATALOG_MAP[code]})` : name

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '25386B' },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
}

function buildHistorySheet(
  workbook: ExcelJS.Workbook,
  requests: StorzRequest[]
): void {
  const sheet = workbook.addWorksheet('Histórico do Aluno')

  sheet.columns = [
    { header: 'Colaborador', key: 'collaboratorName', width: 35 },
    { header: 'CPF', key: 'collaboratorCpf', width: 16 },
    { header: 'Código', key: 'trainingCode', width: 10 },
    { header: 'Nome do Curso', key: 'trainingName', width: 45 },
    { header: 'Modalidade', key: 'modality', width: 14 },
    { header: 'Carga Horária', key: 'workloadHours', width: 14 },
    { header: 'Meta SLA', key: 'idealSlaDays', width: 12 },
    { header: 'Data Matrícula', key: 'requestDate', width: 16 },
    { header: 'Data Conclusão', key: 'completionDate', width: 16 },
    { header: 'Situação', key: 'situacao', width: 18 },
    { header: 'Progresso', key: 'progresso', width: 12 },
    { header: 'Prazo (a partir do início)', key: 'prazo', width: 20 },
    { header: 'Tentativa', key: 'attemptNumber', width: 12 },
    { header: 'Nº Matrícula (Storz)', key: 'id', width: 20 },
  ]
  styleHeader(sheet)

  const groups = groupRetests(requests)
  const attemptByRequestId = new Map<string, RetestAttempt>()
  for (const group of groups) {
    for (const attempt of group.attempts)
      attemptByRequestId.set(attempt.request.id, attempt)
  }

  const sorted = [...requests].sort(
    (a, b) =>
      a.collaboratorName.localeCompare(b.collaboratorName) ||
      a.requestDate.getTime() - b.requestDate.getTime()
  )

  for (const req of sorted) {
    const situacao = req.rawSituacao || req.state
    const attempt = attemptByRequestId.get(req.id)
    const totalAttempts =
      groups.find(
        g =>
          g.collaboratorName === req.collaboratorName &&
          g.trainingCode === req.trainingCode
      )?.attempts.length || 1

    const deadline = computeCourseDeadline(req)
    const isOverdue = deadline ? deadline.getTime() < REF_DATE.getTime() : false

    const row = sheet.addRow({
      collaboratorName: req.collaboratorName,
      collaboratorCpf: req.collaboratorCpf || '',
      trainingCode: req.trainingCode,
      trainingName: docLabel(req.trainingCode, req.trainingName),
      modality: req.modality,
      workloadHours: req.workloadHours ? `${req.workloadHours}h` : '',
      idealSlaDays: req.idealSlaDays ? `${req.idealSlaDays}d` : '',
      requestDate: dateFmt(req.requestDate),
      completionDate: dateFmt(req.completionDate),
      situacao,
      progresso:
        req.progressPercent !== undefined ? `${req.progressPercent}%` : '',
      prazo: deadline
        ? `${dateFmt(deadline)}${isOverdue ? ' (atrasado)' : ''}`
        : '',
      attemptNumber:
        totalAttempts > 1
          ? `${attempt?.attemptNumber || 1}/${totalAttempts}`
          : '',
      id: req.id,
    })

    const bg = situacaoColors[situacao.toUpperCase()]
    if (bg)
      row.getCell('situacao').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bg },
      }
    if (deadline) {
      row.getCell('prazo').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isOverdue ? 'FEE2E2' : 'FEF9C3' },
      }
    }
  }
}

const RETEST_STAGE_LABEL: Record<string, string> = {
  AGUARDANDO_RETESTE: 'Aguardando reteste',
  RETESTE_EM_ANDAMENTO: 'Reteste em andamento',
  RETESTE_APROVADO: 'Reteste aprovado',
}
const RETEST_STAGE_COLOR: Record<string, string> = {
  AGUARDANDO_RETESTE: 'FEE2E2',
  RETESTE_EM_ANDAMENTO: 'FEF9C3',
  RETESTE_APROVADO: 'DCFCE7',
}
const RETEST_STAGE_ORDER = [
  'AGUARDANDO_RETESTE',
  'RETESTE_EM_ANDAMENTO',
  'RETESTE_APROVADO',
]

function buildRetestSheet(
  workbook: ExcelJS.Workbook,
  requests: StorzRequest[]
): void {
  const sheet = workbook.addWorksheet('Controle de Retestes')

  sheet.columns = [
    { header: 'Colaborador', key: 'collaboratorName', width: 35 },
    { header: 'Código', key: 'trainingCode', width: 10 },
    { header: 'Nome do Curso', key: 'trainingName', width: 45 },
    { header: 'Nº Tentativas', key: 'totalAttempts', width: 14 },
    { header: 'Data da Reprovação', key: 'failedDate', width: 18 },
    { header: 'Rematriculado?', key: 'rematriculado', width: 14 },
    { header: 'Iniciado?', key: 'iniciado', width: 12 },
    { header: 'Progresso Atual', key: 'progresso', width: 14 },
    { header: 'Etapa do Reteste', key: 'retestStage', width: 20 },
    {
      header: 'Data do Reteste Aprovado',
      key: 'retestApprovedDate',
      width: 22,
    },
    { header: 'Situação Atual', key: 'latestOutcome', width: 16 },
  ]
  styleHeader(sheet)

  const groups = groupRetests(requests).filter(g => g.hasFailedAttempt)
  groups.sort(
    (a, b) =>
      RETEST_STAGE_ORDER.indexOf(a.retestStage!) -
        RETEST_STAGE_ORDER.indexOf(b.retestStage!) ||
      a.collaboratorName.localeCompare(b.collaboratorName)
  )

  for (const group of groups) {
    const firstFailed = group.attempts.find(a => a.outcome === 'REPROVADO')!
    const approvedRetest =
      group.retestStage === 'RETESTE_APROVADO'
        ? [...group.attempts].reverse().find(a => a.outcome === 'APROVADO')
        : undefined

    const row = sheet.addRow({
      collaboratorName: group.collaboratorName,
      trainingCode: group.trainingCode,
      trainingName: docLabel(
        group.trainingCode,
        firstFailed.request.trainingName
      ),
      totalAttempts: group.attempts.length,
      failedDate: dateFmt(
        firstFailed.request.completionDate || firstFailed.request.requestDate
      ),
      rematriculado: group.rematriculado ? 'SIM' : 'NÃO',
      iniciado: group.iniciado ? 'SIM' : 'NÃO',
      progresso:
        group.latestProgressPercent !== undefined
          ? `${group.latestProgressPercent}%`
          : '',
      retestStage: RETEST_STAGE_LABEL[group.retestStage!],
      retestApprovedDate: approvedRetest
        ? dateFmt(
            approvedRetest.request.completionDate ||
              approvedRetest.request.requestDate
          )
        : '',
      latestOutcome: group.latestOutcome,
    })

    row.getCell('retestStage').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: RETEST_STAGE_COLOR[group.retestStage!] },
    }
  }

  const byStage: Record<string, number> = {}
  for (const g of groups)
    byStage[g.retestStage!] = (byStage[g.retestStage!] || 0) + 1
  console.log(
    `   ${groups.length} pessoa(s) com reprovação em algum momento — aguardando: ${byStage.AGUARDANDO_RETESTE || 0}, em andamento: ${byStage.RETESTE_EM_ANDAMENTO || 0}, aprovado: ${byStage.RETESTE_APROVADO || 0}.`
  )
}

async function exportToExcel(
  requests: StorzRequest[],
  outputPath: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  buildHistorySheet(workbook, requests)
  buildRetestSheet(workbook, requests)
  await workbook.xlsx.writeFile(outputPath)
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   HSE AUDIT AUTOMATION - HISTÓRICO DO ALUNO (DESENVOLVIMENTO ORGANIZACIONAL - SSOT)'
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  const scratchDir = path.join(process.cwd(), 'scratch')
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })

  // 1. Obter dados da base unica consolidada (SSOT)
  const pipeline = new HSEDataPipeline()
  const syncResult = await pipeline.getOrSync({
    refDate: REF_DATE,
    preferSnapshot: !FORCE_SYNC,
  })

  console.log(
    `[StorzHistoryReport] ${syncResult.storzRequests.length} matrícula(s)/curso(s) carregada(s) da Storz (${syncResult.metadata.storzSource}).`
  )

  // 2. Gerar Relatorio Excel de Historico do Aluno
  const outputPath = path.join(scratchDir, 'historico_aluno_storz.xlsx')
  await exportToExcel(syncResult.storzRequests, outputPath)
  console.log(`[StorzHistoryReport] Relatório gerado em: ${outputPath}\n`)

  // 3. Garantir geracao da Auditoria Drive x RPO correspondente
  const auditPath = path.join(scratchDir, 'auditoria_drive_rpo.xlsx')
  await HSEDataPipeline.exportDivergencesToExcel(
    syncResult.rpoDivergences,
    auditPath
  )
  console.log(
    `[StorzHistoryReport] Relatório de divergências RPO gerado em: ${auditPath}`
  )

  // 4. Gerar Dashboard DO
  const dashboardPath = path.join(scratchDir, 'do_dashboard.html')
  fs.writeFileSync(
    dashboardPath,
    buildDoDashboardHtml(syncResult.storzRequests)
  )
  console.log(`[StorzHistoryReport] Dashboard DO gerado em: ${dashboardPath}\n`)

  if (SKIP_EMAIL) {
    console.log(
      '[StorzHistoryReport] --no-email informado ou SKIP_EMAIL=true — pulando envio de e-mail (arquivos gerados com sucesso).\n'
    )
    return
  }

  if (!DO_EMAIL_RECIPIENT) {
    console.log(
      '[StorzHistoryReport] DO_EMAIL_TO não configurado — pulando envio de e-mail.\n'
    )
    return
  }

  if (syncResult.storzRequests.length === 0) {
    console.warn(
      '[StorzHistoryReport] Nenhuma matrícula encontrada — cancelando envio para não notificar com dados zerados.\n'
    )
    return
  }

  console.log(
    '================================================================================'
  )
  console.log('   ENVIANDO HISTÓRICO DO ALUNO (DESENVOLVIMENTO ORGANIZACIONAL)')
  console.log(
    '================================================================================'
  )
  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()
  const groups = groupRetests(syncResult.storzRequests).filter(
    g => g.hasFailedAttempt
  )
  const aguardando = groups.filter(
    g => g.retestStage === 'AGUARDANDO_RETESTE'
  ).length
  const emAndamento = groups.filter(
    g => g.retestStage === 'RETESTE_EM_ANDAMENTO'
  ).length
  const aprovado = groups.filter(
    g => g.retestStage === 'RETESTE_APROVADO'
  ).length
  const dashboardUrl =
    process.env.HSE_DASHBOARD_URL ||
    'https://hse-audition-automation.vercel.app'

  const ctaButtonHtml = `
    <div style="text-align: center; margin: 20px 0 24px; padding: 18px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
      <p style="margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #1E293B;">
        Acompanhe a Matriz de Qualificação (Skill Matrix) e as matrículas da Storz ao vivo:
      </p>
      <a href="${dashboardUrl}" target="_blank" style="background-color: #00D2B4; color: #090D16; font-weight: 700; font-size: 13px; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; box-shadow: 0 2px 6px rgba(0,210,180,0.25);">
        Acessar Portal de DO & Treinamentos ao Vivo
      </a>
      <div style="margin-top: 8px; font-size: 11px; color: #64748B;">
        Não é necessário baixar arquivos HTML anexos.
      </div>
    </div>
  `

  const divergencesCount = syncResult.rpoDivergences.filter(
    d => d.divergent
  ).length

  const bodyHtml = `
    <p>Olá, Equipe,</p>
    <p>Seguem em anexo as planilhas consolidadas e atualizadas sobre os treinamentos e a auditoria de conformidade (Fonte Única da Verdade — SSOT):</p>
    <ol>
      <li><strong>historico_aluno_storz.xlsx:</strong> Histórico completo de matrículas na Storz com controle de retestes (${syncResult.storzRequests.length} matrículas rastreadas).</li>
      <li><strong>auditoria_drive_rpo.xlsx:</strong> Relatório consolidado da Auditoria Drive x RPO (${divergencesCount} divergências identificadas, 100% alinhado com o Dashboard).</li>
    </ol>
    ${ctaButtonHtml}
    <p><strong>Resumo do Histórico Storz:</strong> <strong>${syncResult.storzRequests.length}</strong> matrícula(s)/curso(s) no total. <strong>${groups.length}</strong> pessoa(s) com reprovação em algum momento:</p>
    <ul>
      <li><strong>${aguardando}</strong> aguardando reteste (sem rematrícula ativa)</li>
      <li><strong>${emAndamento}</strong> com reteste em andamento agora</li>
      <li><strong>${aprovado}</strong> já refizeram e foram aprovados</li>
    </ul>
  `

  const subject = `Relatório de Treinamentos & Auditoria RPO — ${REF_DATE.toLocaleDateString('pt-BR')}`

  const attachments = [
    { filename: 'historico_aluno_storz.xlsx', path: outputPath },
    { filename: 'auditoria_drive_rpo.xlsx', path: auditPath },
  ]

  const emailRes = await emailService.sendEmail({
    to: DO_EMAIL_RECIPIENT,
    subject,
    htmlContent: bodyHtml,
    attachments,
  })
  console.log(
    `   ${emailRes.success ? 'Enviado' : 'Falhou'} para ${DO_EMAIL_RECIPIENT}\n`
  )
}

main().catch(err => {
  console.error('[StorzHistoryReport] Erro ao gerar Histórico do Aluno:', err)
  process.exit(1)
})
