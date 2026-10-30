import 'dotenv/config'
import { execSync } from 'child_process'
import path from 'path'

// Datas de nome de arquivo viram meia-noite local. Na VPS (UTC) isso gravava 11/05 como 21h do dia
// 10 em Brasília e alternava T00/T03 com os dados gerados no notebook. Herdado pelos subprocessos.
process.env.TZ ||= 'America/Sao_Paulo'

// Só quem publica (a VPS) mexe no git. Em qualquer outra máquina o job gera o dashboard local e para.
const PUBLISH = process.env.HSE_PUBLISH === '1'

const validJobs = [
  'dashboard',
  'do-report',
  'hse-digest',
  'rpo-audit',
  'exec-dashboard',
  'portal-report',
  'sync-wo',
  'all',
] as const
type AgentJob = (typeof validJobs)[number]

function runCommand(cmd: string, description: string): void {
  console.log(`\n[AgentRunner] Executando: ${description}`)
  console.log(`[AgentRunner] $ ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd(), env: process.env })
  } catch (err: any) {
    console.error(`[AgentRunner] Erro ao executar: ${description}`)
    throw err
  }
}

function git(args: string): string {
  return execSync(`git ${args}`, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
}

/** Para comandos que podem não ter o que fazer (ex.: abortar um rebase que não existe). */
function tryGit(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Começa do origin/main: o código mais recente já vale para o sync desta execução, e commits
 * locais de uma publicação que falhou são descartados (os dados são regenerados a cada sync).
 */
function alignWithOrigin(): void {
  console.log('\n[AgentRunner] Alinhando com origin/main...')
  const lockfileBefore = tryGit('rev-parse HEAD:pnpm-lock.yaml')

  // Uma execução anterior pode ter parado no meio de um rebase (HEAD solto): sem limpar isso,
  // todo sync seguinte falharia até alguém entrar na VPS.
  tryGit('rebase --abort')
  tryGit('merge --abort')
  git('fetch origin main')
  git('reset --hard')
  git('checkout -B main origin/main')
  // Arquivo solto em data/ (ex.: .tmp de uma gravação interrompida) seria pego pelo `git add data/`
  git('clean -fd -- data/ public/')

  if (tryGit('rev-parse HEAD:pnpm-lock.yaml') !== lockfileBefore) {
    runCommand(
      'pnpm install --frozen-lockfile',
      'Atualizando dependencias (pnpm-lock.yaml mudou)'
    )
  }
  console.log(
    `[AgentRunner] Rodando o codigo de ${git('log -1 --format="%h %s"')}`
  )
}

function publishDashboard(): void {
  console.log('\n[AgentRunner] Verificando alteracoes para deploy na Vercel...')
  git('add public/index.html data/')
  const changed = git('diff --staged --name-only')
  if (!changed) {
    console.log(
      '[AgentRunner] Nenhuma alteracao no dashboard ou nos dados. Vercel ja esta atualizada.'
    )
    return
  }

  console.log('[AgentRunner] Arquivos modificados:\n' + changed)
  git('commit -m "chore(data): auto-update HSE dashboard via agent"')
  try {
    git('push origin HEAD:main')
  } catch {
    // Um commit de código chegou durante a execução. Como só a VPS commita data/, o rebase não
    // tem conflito; se tiver, é para falhar e alguém olhar (nada de -X theirs silencioso).
    console.log('[AgentRunner] Push recusado, rebase em cima do origin/main...')
    try {
      git('pull --rebase origin main')
    } catch (err) {
      tryGit('rebase --abort')
      throw err
    }
    git('push origin HEAD:main')
  }
  console.log(
    '[AgentRunner] Commit e push efetuados com sucesso. Deploy acionado na Vercel.'
  )
}

function syncAndDeployDashboard(): void {
  if (PUBLISH) alignWithOrigin()

  // Sincroniza WOs ativas do Smartsheet com a aba BASE do Google Drive (Controle do Massude)
  runSyncWoBase()

  // Executa relatorio e dashboard sem disparo de e-mail desnecessario
  runCommand(
    'npx tsx src/cli/runHSEReportExporter.ts --no-email',
    'Sincronizacao SSOT e Geracao do Dashboard HTML'
  )

  if (!PUBLISH) {
    console.log(
      '\n[AgentRunner] HSE_PUBLISH != 1: dashboard gerado localmente, nada foi commitado (quem publica e a VPS).'
    )
    return
  }
  publishDashboard()
}

function runDoReport(): void {
  runCommand(
    'npx tsx src/cli/runStorzHistoryReport.ts',
    'Relatorio de Historico do Aluno (DO) e Envio por E-mail'
  )
}

function runHseDigest(): void {
  runCommand(
    'npx tsx src/cli/runHSEReportExporter.ts',
    'Resumo de Pendencias HSE e Envio por E-mail'
  )
}

function runRpoAudit(): void {
  runCommand(
    'npx tsx src/cli/runDriveRpoAudit.ts',
    'Auditoria de Divergencias de Digitacao (Drive x RPO)'
  )
}

function runExecDashboard(): void {
  runCommand(
    'npx tsx src/cli/runExecutiveDashboardEmail.ts',
    'Atualizacao do Dashboard Executivo e Envio por E-mail'
  )
}

function runPortalReport(): void {
  if (PUBLISH) alignWithOrigin()
  runCommand(
    'npx tsx src/cli/runPortalPendencyReport.ts',
    'Pendencias nos Portais de Clientes e Envio para EHS e Coordenacao'
  )
}

function runSyncWoBase(): void {
  runCommand(
    'npx tsx src/cli/syncSmartsheetToGoogleBase.ts --apply',
    'Sincronizacao de WOs do Smartsheet para a aba BASE do Google Drive'
  )
}

async function main() {
  const jobArg = process.argv[2] as AgentJob | undefined

  if (!jobArg || !validJobs.includes(jobArg)) {
    console.log(
      '================================================================================'
    )
    console.log('   HSE AUDIT AUTOMATION - AGENT JOB RUNNER')
    console.log(
      '================================================================================'
    )
    console.log('Uso: npx tsx src/cli/runAgentJob.ts <job>\n')
    console.log('Jobs disponiveis:')
    console.log(
      '  dashboard      - Sincroniza dados, gera public/index.html e faz push para Vercel'
    )
    console.log(
      '  do-report      - Gera historico do aluno e envia e-mail para a equipe de DO / Treinamentos'
    )
    console.log(
      '  hse-digest     - Gera relatorio HSE e envia resumo de pendencias para equipe HSE'
    )
    console.log(
      '  rpo-audit      - Executa auditoria de digitacao Drive x RPO e envia alerta'
    )
    console.log(
      '  exec-dashboard - Gera e envia e-mail executivo do dashboard para Marcelo e Leonardo'
    )
    console.log(
      '  portal-report  - Cruza portais de clientes com o Briefing de Projetos e envia para EHS e Coordenacao'
    )
    console.log(
      '  sync-wo        - Sincroniza tecnicos/WOs do Smartsheet na aba BASE da planilha do Massude'
    )
    console.log('  all            - Executa dashboard + do-report em sequencia')
    console.log(
      '================================================================================\n'
    )
    process.exit(jobArg ? 1 : 0)
  }

  console.log(`[AgentRunner] Iniciando rotina: ${jobArg}`)
  const startTime = Date.now()

  switch (jobArg) {
    case 'dashboard':
      syncAndDeployDashboard()
      break
    case 'do-report':
      runDoReport()
      break
    case 'hse-digest':
      runHseDigest()
      break
    case 'rpo-audit':
      runRpoAudit()
      break
    case 'exec-dashboard':
      runExecDashboard()
      break
    case 'portal-report':
      runPortalReport()
      break
    case 'sync-wo':
      runSyncWoBase()
      break
    case 'all':
      syncAndDeployDashboard()
      runDoReport()
      break
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000)
  console.log(
    `\n[AgentRunner] Rotina "${jobArg}" concluida com sucesso em ${durationSec}s.`
  )
}

main().catch(err => {
  console.error('[AgentRunner] Falha fatal na execucao da rotina:', err)
  process.exit(1)
})
