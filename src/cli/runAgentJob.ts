import 'dotenv/config'
import { execSync } from 'child_process'
import path from 'path'

const validJobs = [
  'dashboard',
  'do-report',
  'hse-digest',
  'rpo-audit',
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

function syncAndDeployDashboard(): void {
  // 1. Executa relatorio e dashboard sem disparo de e-mail desnecessario
  runCommand(
    'npx tsx src/cli/runHSEReportExporter.ts --no-email',
    'Sincronizacao SSOT e Geracao do Dashboard HTML'
  )

  // 2. Commit e push para publicar na Vercel
  console.log('\n[AgentRunner] Verificando alteracoes para deploy na Vercel...')
  try {
    execSync('git add public/index.html data/', {
      stdio: 'inherit',
      cwd: process.cwd(),
    })
    const diff = execSync('git diff --staged --name-only', {
      cwd: process.cwd(),
    })
      .toString()
      .trim()
    if (!diff) {
      console.log(
        '[AgentRunner] Nenhuma alteracao no dashboard ou nos dados. Vercel ja esta atualizada.'
      )
      return
    }

    console.log('[AgentRunner] Arquivos modificados:\n' + diff)
    const commitMsg = 'chore(data): auto-update HSE dashboard via agent'
    execSync(`git commit -m "${commitMsg}"`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    })
    execSync('git pull origin main --rebase -X theirs', {
      stdio: 'inherit',
      cwd: process.cwd(),
    })
    execSync('git push origin main', { stdio: 'inherit', cwd: process.cwd() })
    console.log(
      '[AgentRunner] Commit e push efetuados com sucesso. Deploy acionado na Vercel.'
    )
  } catch (gitErr: any) {
    console.warn(
      '[AgentRunner] Aviso durante etapa de git push:',
      gitErr?.message || gitErr
    )
  }
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
      '  dashboard    - Sincroniza dados, gera public/index.html e faz push para Vercel'
    )
    console.log(
      '  do-report    - Gera historico do aluno e envia e-mail para a equipe de DO / Treinamentos'
    )
    console.log(
      '  hse-digest   - Gera relatorio HSE e envia resumo de pendencias para equipe HSE'
    )
    console.log(
      '  rpo-audit    - Executa auditoria de digitacao Drive x RPO e envia alerta'
    )
    console.log('  all          - Executa dashboard + do-report em sequencia')
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
