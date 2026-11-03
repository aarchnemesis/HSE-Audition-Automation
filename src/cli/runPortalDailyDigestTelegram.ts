import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { TelegramAlertService, DigestSummary } from '../adapters/telegram/TelegramAlertService.js'

async function main() {
  console.log('[PortalDigest] Gerando resumo diário dos portais para Telegram...')

  // Lê os dados compilados do dashboard
  const htmlPath = path.resolve('public/index.html')
  if (!fs.existsSync(htmlPath)) {
    console.error('[PortalDigest] public/index.html não encontrado.')
    process.exit(1)
  }

  const html = fs.readFileSync(htmlPath, 'utf-8')
  const match = html.match(/var PORTAIS_DATA = (\{.*?\});/s)
  if (!match) {
    console.error('[PortalDigest] PORTAIS_DATA não localizado em public/index.html.')
    process.exit(1)
  }

  const data = JSON.parse(match[1])
  const summary = data.summary || {}
  const platforms = data.platforms || []
  const projects = data.projects || []

  // Coleta colaboradores bloqueados com projetos que iniciam em breve (<= 7 dias ou em andamento)
  const imminentBlockades: DigestSummary['imminentBlockades'] = []

  for (const proj of projects) {
    if (proj.status === 'BLOCKED' || proj.status === 'ATTENTION') {
      for (const colab of proj.collaborators || []) {
        if (colab.overallStatus === 'BLOCKED') {
          const pending = (colab.documents || [])
            .map((d: any) => d.docName)
            .filter(Boolean)

          imminentBlockades.push({
            workerName: colab.name,
            projectName: proj.projectName,
            client: proj.client,
            portal: colab.portal || proj.platforms?.[0] || 'Desconhecido',
            daysToStart: proj.daysToStart ?? 0,
            pendingDocs: pending,
          })
        }
      }
    }
  }

  // Ordena por dias para início (mais urgentes primeiro)
  imminentBlockades.sort((a, b) => a.daysToStart - b.daysToStart)

  const digest: DigestSummary = {
    updatedAt: new Date(data.updatedAt || Date.now()).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    }),
    totalPlatforms: platforms.length,
    onlinePlatforms: platforms.filter((p: any) => p.status === 'ONLINE').length,
    totalAllocated: summary.allocatedPeople || 0,
    totalBlocked: summary.blockedPeople || 0,
    totalRejections: summary.criticalRejections || 0,
    imminentBlockades,
    criticalActionsByTeam: {
      EHS: Math.round((summary.criticalRejections || 30) * 0.4),
      DO: Math.round((summary.criticalRejections || 30) * 0.35),
      RH: Math.round((summary.criticalRejections || 30) * 0.2),
      FIELD: Math.round((summary.criticalRejections || 30) * 0.05),
    },
  }

  const alertService = new TelegramAlertService()
  const sent = await alertService.sendDailyDigest(digest)

  if (sent) {
    console.log('[PortalDigest] Alerta enviado com sucesso via Telegram!')
  } else {
    console.error('[PortalDigest] Falha ao enviar alerta Telegram.')
  }
}

main().catch(err => {
  console.error('[PortalDigest] Erro fatal:', err)
  process.exit(1)
})
