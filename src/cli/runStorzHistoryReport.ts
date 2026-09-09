import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { buildDoDashboardHtml } from '../adapters/dashboard/DoDashboardHtmlGenerator.js'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { wrapEmailHtml } from '../adapters/email/emailTemplates.js'
import { SmartsheetRPOAdapter } from '../adapters/smartsheet/SmartsheetRPOAdapter.js'
import { StorzHttpScraper } from '../adapters/storz/StorzHttpScraper.js'
import { StorzPlaywrightAdapter } from '../adapters/storz/StorzPlaywrightAdapter.js'
import {
  StorzRequest,
  computeCourseDeadline,
} from '../domain/models/StorzRequest.js'
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js'
import { classifyEmployeeProfile } from '../domain/services/EmployeeProfileClassifier.js'
import {
  RetestAttempt,
  groupRetests,
} from '../domain/services/RetestTracker.js'
import { IEmailService } from '../ports/IEmailService.js'

const REF_DATE = process.env.HSE_REF_DATE
  ? new Date(process.env.HSE_REF_DATE)
  : new Date()
const toArg = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]
const DEFAULT_DO_EMAIL_RECIPIENTS =
  'mayanna.gomes@arthwind.com.br,joao.oliveira@arthwind.com.br'
const DO_EMAIL_RECIPIENT =
  toArg || process.env.DO_EMAIL_TO || DEFAULT_DO_EMAIL_RECIPIENTS
const SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'

/**
 * Gera um "Histórico do Aluno" — um registro por colaborador+curso, no molde do exemplo que a
 * analista de treinamentos mandou (extrato tipo transcript, não status de conformidade). Fonte é
 * só a Storz (é lá que mora o histórico de matrícula/conclusão de curso). Não tem carga horária
 * porque o Dossiê do Aluno na Storz não expõe esse dado — omitido em vez de inventado.
 */
const dateFmt = (d?: Date) => (d ? d.toLocaleDateString('pt-BR') : '')
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
  } // navy ArthWind
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
}

/**
 * Aba principal: um registro por matrícula, no molde do exemplo da analista de treinamentos —
 * mas com colunas extras de tentativa (Nº da tentativa / total) pra já mostrar reteste aqui
 * também, sem precisar ir na outra aba pra correlacionar.
 */
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

/**
 * Aba dedicada — controle de reteste: só quem já reprovou pelo menos uma vez em algum curso.
 * 3 etapas (pedido do usuário em 26/08/2026, não é só "aprovou depois ou não"):
 *   1. Aguardando reteste — reprovou, sem rematrícula ativa ainda
 *   2. Reteste em andamento — reprovou e já está fazendo o mesmo curso de novo agora
 *   3. Reteste aprovado — reprovou, refez e passou
 */
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
  console.log('   HSE AUDIT AUTOMATION - HISTÓRICO DO ALUNO (STORZ)')
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  // Diferente do runHSEReportExporter.ts, esse CLI não instancia HSEDatabaseRepository (que cria
  // scratch/ como efeito colateral) — sem isso, num checkout limpo (ex.: CI), o writeFile do
  // Excel/dashboard falha com ENOENT porque a pasta nunca existiu.
  const scratchDir = path.join(process.cwd(), 'scratch')
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })

  const rpoAdapter = SmartsheetRPOAdapter.fromEnv(REF_DATE)
  let targetCollaborators: string[] | undefined
  if (rpoAdapter) {
    console.log(
      '📊 Lendo planilha RPO via Smartsheet (só pra saber quem auditar — não editamos nada)...'
    )
    const rpoInspectorsRaw = await rpoAdapter.readRPOData()
    const rpoInspectors = rpoInspectorsRaw.filter(
      i => classifyEmployeeProfile(i.role) !== null
    )
    console.log(
      `   ${rpoInspectors.length} pessoa(s) ativa(s) (de ${rpoInspectorsRaw.length} linhas na RPO).`
    )
    targetCollaborators = rpoInspectors.map(i => i.name)
  } else {
    console.log(
      '⚠️  SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID não configurados no .env — buscando solicitações disponíveis na Storz/cache.'
    )
  }

  console.log(
    '🤖 Executando raspagem do histórico completo na plataforma Storz...'
  )
  const storzScraper = new StorzHttpScraper()
  const storzResult = await storzScraper.runAuditScrape({
    headless: true,
    targetCollaborators,
  })
  let requests = storzResult.requests
  if (requests.length === 0) {
    const storzAdapter = new StorzPlaywrightAdapter()
    requests = await storzAdapter.getAllRequests()
  }
  console.log(`   ${requests.length} matrícula(s)/curso(s) carregada(s).`)

  const outputPath = path.join(
    process.cwd(),
    'scratch',
    'historico_aluno_storz.xlsx'
  )
  await exportToExcel(requests, outputPath)
  console.log(`\n✅ Relatório gerado em: ${outputPath}\n`)

  // Dashboard separado do EHS — público diferente (Desenvolvimento Organizacional), não é uma
  // aba dentro do dashboard de EHS. Ver DoDashboardHtmlGenerator.ts.
  const dashboardPath = path.join(process.cwd(), 'scratch', 'do_dashboard.html')
  fs.writeFileSync(dashboardPath, buildDoDashboardHtml(storzResult.requests))
  console.log(`[INFO] Dashboard DO gerado em: ${dashboardPath}\n`)

  if (SKIP_EMAIL) {
    console.log(
      '[INFO] --no-email informado ou SKIP_EMAIL=true — pulando envio de e-mail (arquivos gerados com sucesso).\n'
    )
    return
  }

  if (!DO_EMAIL_RECIPIENT) {
    console.log(
      '[INFO] DO_EMAIL_TO não configurado — pulando envio de e-mail (só gerou os arquivos).\n'
    )
    return
  }

  if (storzResult.requests.length === 0) {
    console.warn(
      '[WARN] Nenhuma matrícula/curso carregada da Storz — cancelando envio de e-mail vazio para não notificar com dados zerados.\n'
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
  const groups = groupRetests(storzResult.requests).filter(
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

  const bodyHtml = `
    <p>Segue em anexo a planilha consolidada com o histórico completo de matrículas na Storz e o controle de retestes.</p>
    ${ctaButtonHtml}
    <p><strong>${storzResult.requests.length}</strong> matrícula(s)/curso(s) no total. <strong>${groups.length}</strong> pessoa(s) com reprovação em algum momento:</p>
    <ul>
      <li><strong>${aguardando}</strong> aguardando reteste (sem rematrícula ativa)</li>
      <li><strong>${emAndamento}</strong> com reteste em andamento agora</li>
      <li><strong>${aprovado}</strong> já refizeram e foram aprovados</li>
    </ul>
  `

  const emailRes = await emailService.sendEmail({
    to: DO_EMAIL_RECIPIENT,
    subject: `Histórico do Aluno (DO) — ${REF_DATE.toLocaleDateString('pt-BR')}`,
    htmlContent: bodyHtml,
    attachments: [{ filename: 'historico_aluno_storz.xlsx', path: outputPath }],
  })
  console.log(
    `   ${emailRes.success ? 'Enviado' : 'Falhou'} para ${DO_EMAIL_RECIPIENT}\n`
  )
}

main().catch(err => {
  console.error('Erro ao gerar Histórico do Aluno:', err)
  process.exit(1)
})
