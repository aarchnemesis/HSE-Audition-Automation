import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  DashboardSourceHealth,
  buildDashboardHtml,
} from '../adapters/dashboard/DashboardHtmlGenerator.js'
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import {
  RPO_TRACKED_DOC_CODES,
  SmartsheetRPOAdapter,
} from '../adapters/smartsheet/SmartsheetRPOAdapter.js'
import { StorzHttpScraper } from '../adapters/storz/StorzHttpScraper.js'
import { Inspector, ParkRequirement } from '../domain/models/Certificate.js'
import { AuditTriangulator } from '../domain/services/AuditTriangulator.js'
import { PRESENCIAL_REQUIRED_DOC_CODES } from '../domain/services/ComplianceEngine.js'
import { DriveRpoAuditor } from '../domain/services/DriveRpoAuditor.js'
import {
  EHS_TRAINING_SCOPE_BRANCHES,
  EmployeeProfile,
  classifyEmployeeProfile,
  getElectiveDocCodesForProfile,
  getRequiredDocCodesForProfile,
} from '../domain/services/EmployeeProfileClassifier.js'
import { HSEDatabaseRepository } from '../domain/services/HSEDatabaseRepository.js'
import { HSEFilterEngine } from '../domain/services/HSEFilterEngine.js'
import { matchesInspector } from '../domain/services/InspectorMatcher.js'
import { buildRoster } from '../domain/services/InspectorRosterBuilder.js'
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

const MODALITY_REQUIREMENTS: ParkRequirement['requiredModalities'] =
  Object.fromEntries(
    Array.from(PRESENCIAL_REQUIRED_DOC_CODES, code => [
      code,
      'PRESENCIAL' as const,
    ])
  )

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    `   HSE AUDIT AUTOMATION - CONSOLIDAÇÃO DE DADOS, STORZ HTTP API & FILTROS`
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  // 1. Instanciar Adaptadores e Repositórios
  const driveAdapter = createDriveAdapter(REF_DATE)
  const rpoAdapter = SmartsheetRPOAdapter.fromEnv(REF_DATE)
  const storzScraper = new StorzHttpScraper()
  const dbRepo = new HSEDatabaseRepository()
  const filterEngine = new HSEFilterEngine(dbRepo)

  // 2. Montar o universo de pessoas a auditar. A RPO é quem decide "quem existe" — cobre campo
  //    E administrativo/visibilidade, diferente do Drive que só tem pasta pra quem é campo. Sem
  //    RPO configurada, cai pro comportamento antigo (só quem tem pasta no Drive, perfil CAMPO).
  const driveInspectors = await driveAdapter.getInspectors()
  console.log(
    `[DriveAdapter] Inspetores lidos do Drive: ${driveInspectors.length}`
  )

  let roster: {
    inspector: Inspector
    requiredDocCodes: string[]
    profile: EmployeeProfile
    hasDriveFolder: boolean
  }[]
  let rpoInspectors: Inspector[] = []
  if (rpoAdapter) {
    const rpoInspectorsRaw = await rpoAdapter.readRPOData()
    rpoInspectors = rpoInspectorsRaw
    console.log(
      `[SmartsheetRPOAdapter] Pessoas lidas da RPO: ${rpoInspectors.length}`
    )
    const fullRoster = buildRoster(rpoInspectors, driveInspectors)
    // Escopo reduzido em 27/08/2026: relatório de EHS é só pra quem está no Drive (campo) — ramos
    // INSP. QUALIDADE & TÉC. OPERAÇÕES, LÍDERES/EHS, DRONE INSP. EQUIPAMENTO, LPS-SPDA. ADMINISTRATIVO
    // e VISIBILIDADE saem do relatório por completo (ver EHS_TRAINING_SCOPE_BRANCHES).
    roster = fullRoster.filter(r =>
      EHS_TRAINING_SCOPE_BRANCHES.includes(r.inspector.rpoBranch || '')
    )
    console.log(
      `[Roster] ${roster.length} pessoa(s) no universo de auditoria (de ${fullRoster.length}, escopo campo — excluídos desligados, administrativo e visibilidade).`
    )
  } else {
    console.log(
      '[Roster] SMARTSHEET_API_TOKEN/SMARTSHEET_RPO_SHEET_ID não configurados — usando só quem tem pasta no Drive (perfil CAMPO).'
    )
    roster = driveInspectors.map(inspector => ({
      inspector,
      requiredDocCodes: getRequiredDocCodesForProfile('CAMPO'),
      profile: 'CAMPO',
      hasDriveFolder: true,
    }))
  }

  // 3. Executar Raspagem/Leitura na Storz (Dossiê do Aluno por colaborador)
  console.log('🤖 Executando raspagem / auditoria na plataforma Storz...')
  const storzResult = await storzScraper.runAuditScrape({
    headless: true,
    targetCollaborators: roster.map(r => r.inspector.name),
  })
  console.log(
    `[StorzScraper] Finalizado. Total de matrículas/cursos raspados: ${storzResult.requests.length}\n`
  )

  let storzRequests = storzResult.requests
  if (storzRequests.length === 0) {
    console.warn(
      '⚠️ [AVISO] Nenhuma matrícula obtida ao vivo da Storz (possível timeout ou falha de conexão).'
    )
    console.warn(
      '🔄 Carregando fallback do cache persistente para não zerar matrículas do dashboard...'
    )
    storzRequests = storzScraper.loadCache()
    console.log(
      `✅ [Fallback Storz] ${storzRequests.length} matrícula(s) recuperada(s) do cache persistente.`
    )
  }

  // 3b. Auditoria RPO (cruzamento Drive + Storz x RPO)
  console.log('🔍 Executando auditoria Drive + Storz x RPO...')
  let rpoDivergences: ReturnType<typeof DriveRpoAuditor.compare> = []
  if (rpoInspectors.length > 0) {
    const activeRpoInspectors = rpoInspectors.filter(
      i => classifyEmployeeProfile(i.role) !== null
    )
    const activeDriveInspectors = driveInspectors.filter((d: Inspector) =>
      activeRpoInspectors.some(r => matchesInspector(d, r.name, r.cpf))
    )
    rpoDivergences = DriveRpoAuditor.compare(
      activeDriveInspectors,
      activeRpoInspectors,
      Array.from(RPO_TRACKED_DOC_CODES),
      storzRequests
    )
    console.log(
      `[DriveRpoAuditor] ${rpoDivergences.length} combinação(ões) comparada(s), ${rpoDivergences.filter(d => d.divergent).length} divergência(s) encontrada(s).`
    )

    // Salvar snapshot em data/rpo_divergences.json e scratch/rpo_divergences.json
    try {
      const dataDir = path.join(process.cwd(), 'data')
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(
        path.join(dataDir, 'rpo_divergences.json'),
        JSON.stringify(rpoDivergences, null, 2),
        'utf-8'
      )
      const scratchDir = path.join(process.cwd(), 'scratch')
      if (!fs.existsSync(scratchDir))
        fs.mkdirSync(scratchDir, { recursive: true })
      fs.writeFileSync(
        path.join(scratchDir, 'rpo_divergences.json'),
        JSON.stringify(rpoDivergences, null, 2),
        'utf-8'
      )
    } catch (e) {
      console.warn('[DriveRpoAuditor] Aviso ao salvar rpo_divergences.json:', e)
    }
  } else {
    // Tenta carregar snapshot persistente se existir
    const persistentRpoPath = path.join(
      process.cwd(),
      'data',
      'rpo_divergences.json'
    )
    if (fs.existsSync(persistentRpoPath)) {
      try {
        rpoDivergences = JSON.parse(fs.readFileSync(persistentRpoPath, 'utf-8'))
        console.log(
          `[DriveRpoAuditor] Snapshot persistente de divergências RPO carregado (${rpoDivergences.length} itens).`
        )
      } catch (e) {
        console.warn(
          '[DriveRpoAuditor] Falha ao ler data/rpo_divergences.json:',
          e
        )
      }
    }
  }

  // 3c. Montar telemetria de integridade / saúde das fontes
  const sourceHealth: DashboardSourceHealth = {
    drive: {
      status: driveInspectors.length > 0 ? 'ONLINE' : 'WARNING',
      message: `${driveInspectors.length} pastas no Drive`,
      detail: `Sincronização com Google Drive via OAuth (${driveInspectors.length} pastas de colaboradores lidas)`,
      lastSync: REF_DATE.toLocaleDateString('pt-BR'),
    },
    smartsheet: {
      status: rpoInspectors.length > 0 ? 'ONLINE' : 'WARNING',
      message:
        rpoInspectors.length > 0
          ? `${rpoInspectors.length} pessoas na RPO`
          : 'RPO Offline / Não Configurada',
      detail:
        rpoInspectors.length > 0
          ? `Sincronização OK com a planilha RPO via Smartsheet API (${rpoInspectors.length} linhas)`
          : 'Variáveis SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID não configuradas',
      lastSync: REF_DATE.toLocaleDateString('pt-BR'),
    },
    storz: {
      status: storzResult.requests.length > 0 ? 'ONLINE' : 'CACHE',
      message:
        storzResult.requests.length > 0
          ? `Ao Vivo via REST API (${storzRequests.length} matrículas)`
          : `Cache Persistente (${storzRequests.length} matrículas)`,
      detail:
        storzResult.requests.length > 0
          ? `Raspagem direta via Storz REST API efetuada com sucesso (${storzResult.requests.length} matrículas extraídas)`
          : `Fallback seguro ativado do cache local persistente (${storzRequests.length} matrículas)`,
      lastSync: REF_DATE.toLocaleDateString('pt-BR'),
    },
  }

  // 4. Rodar a Auditoria Tripla — o pacote de documentos exigido varia por perfil (campo x
  //    administrativo), mas o cruzamento com Drive/Storz é o mesmo para todo mundo.
  const auditResults = roster.map(
    ({ inspector, requiredDocCodes, profile }) => {
      const park: ParkRequirement = {
        id: `perfil_${profile.toLowerCase()}`,
        parkName: `Perfil ${profile}`,
        clientName: '-',
        description: `Requisitos do perfil ${profile}`,
        requiredDocCodes,
        electiveDocCodes: getElectiveDocCodesForProfile(profile),
        requiredModalities: MODALITY_REQUIREMENTS,
      }
      return AuditTriangulator.performTripleAudit(
        inspector,
        park,
        storzRequests,
        REF_DATE
      )
    }
  )

  // 5. Salvar o Instantâneo Consolidado no Banco de Dados HSE
  dbRepo.saveAuditSnapshot(
    auditResults,
    roster.map(r => r.inspector)
  )

  // 6. Testar Consultas / Filtros para a Equipe HSE
  console.log(
    '\n================================================================================'
  )
  console.log('   🔍 TESTANDO FILTROS DA EQUIPE HSE NO BANCO DE DADOS')
  console.log(
    '================================================================================'
  )

  // Consulta 1: Mostrar todas as solicitações ativas na Storz
  const storzPendingRecords = filterEngine.query({ storzOnly: true })
  console.log(
    `\n📌 Consulta 1: Solicitações em Andamento na Storz (${storzPendingRecords.length} resultado(s)):`
  )
  storzPendingRecords.forEach(r => {
    console.log(
      ` - Inspetor: ${r.inspectorName} | Doc: ${r.docCode} (${r.docName}) | Storz ID: ${r.storzRequestId} [${r.storzState}]`
    )
  })

  // Consulta 2: Mostrar itens com vencimento em 30 dias, solicitados ou em andamento na Storz
  const warningRecords = filterEngine.query({
    statusEHS: ['VENCE_30', 'SOLICITADO_STORZ', 'STORZ_EM_ANDAMENTO'],
  })
  console.log(
    `\n⚠️ Consulta 2: Itens em Alerta (Vence 30d ou Storz) (${warningRecords.length} resultado(s)):`
  )
  warningRecords.forEach(r => {
    console.log(
      ` - ${r.inspectorName} | ${r.docName} | Status: ${r.statusEHS} | Details: ${r.detail}`
    )
  })

  // 7. Exportar o Relatório Excel Formato Oficial para HSE
  console.log(
    '\n================================================================================'
  )
  console.log('   📊 GERANDO RELATÓRIO EXCEL CONSOLIDADO PARA A EQUIPE HSE')
  console.log(
    '================================================================================'
  )
  const excelPath = await filterEngine.exportToExcel(dbRepo.getAllRecords())
  console.log(`✅ Relatório gerado em: ${excelPath}\n`)

  // 7b. Gerar o dashboard HTML autocontido (mesmo snapshot do Excel). Não é publicado como site
  //     público — sai como artifact do workflow do GitHub Actions, igual ao Excel, porque o repo
  //     é privado num plano que não suporta Pages com acesso restrito e os dados são pessoais.
  console.log(
    '================================================================================'
  )
  console.log('   🖥️  GERANDO DASHBOARD HTML PARA A EQUIPE HSE')
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
  const dashboardHtml = buildDashboardHtml(dbRepo.getAllRecords(), {
    rpoDivergences,
    storzHistory: storzRequests,
    sourceHealth,
  })
  fs.writeFileSync(dashboardPath, dashboardHtml)
  fs.writeFileSync(publicDashboardPath, dashboardHtml)
  console.log(
    `✅ Dashboard gerado em: ${dashboardPath} e ${publicDashboardPath}\n`
  )

  // 8. Enviar o resumo diário (ignorado se --no-email ou SKIP_EMAIL=true)
  if (SKIP_EMAIL) {
    console.log(
      '================================================================================'
    )
    console.log('   ℹ️  PULANDO ENVIO DE E-MAIL (--no-email ou SKIP_EMAIL=true)')
    console.log(
      '================================================================================\n'
    )
    return
  }

  console.log(
    '================================================================================'
  )
  console.log('   📧 ENVIANDO RESUMO DIÁRIO DE PENDÊNCIAS')
  console.log(
    '================================================================================'
  )
  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()
  const digestGroups = buildPendencyDigest(dbRepo.getAllRecords())
  // Envia o resumo diário com o botão de acesso direto ao dashboard online na Vercel
  // e anexa apenas o relatório oficial em Excel consolidado para o time de HSE.
  const digestRes = await emailService.sendDailyDigest(
    EMAIL_RECIPIENT,
    digestGroups,
    REF_DATE,
    [{ filename: 'hse_relatorio_consolidado.xlsx', path: excelPath }]
  )
  console.log(
    `   ${digestGroups.length} pessoa(s) com pendência incluída(s) no resumo.`
  )
  console.log(
    `   Resumo ${digestRes.success ? 'enviado' : 'falhou'}${digestRes.filePath ? ` (${digestRes.filePath})` : ''}\n`
  )
}

main().catch(err => {
  console.error('Erro na execução do relatório HSE:', err)
  process.exit(1)
})
