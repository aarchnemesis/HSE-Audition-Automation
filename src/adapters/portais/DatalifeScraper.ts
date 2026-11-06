import { Page } from 'playwright'
import { PortalCensus, PortalWorker } from '../../domain/models/PortalCensus.js'

export interface DatalifeScrapeOptions {
  portalId?: string
  log?: (msg: string) => void
}

interface DatalifeWorkerRow {
  id: number
  name: string
  status: number
  plantsName?: string
  cpf?: string
  client?: string
  jobPosition?: string
  company?: string
  countDocuments?: number
  countPending?: number
  lastUpdateDate?: string
}

function cleanWorkerName(raw: string): string {
  if (!raw) return ''
  let clean = raw.split(/\b(Líder|Inspetor|Técnico|Tecnico|Engenheiro|Supervisor|Operador)\b/i)[0] || raw
  return clean.replace(/[-–|]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function scrapeDatalifeCensus(
  page: Page,
  options: DatalifeScrapeOptions = {}
): Promise<PortalCensus> {
  const log = options.log ?? console.log
  const portalId = options.portalId ?? 'datalife'
  const capturedAt = new Date().toISOString()
  const workers: PortalWorker[] = []

  log('[DatalifeScraper] Interceptando resposta de listForReportWorker...')

  let capturedRows: DatalifeWorkerRow[] = []

  page.on('response', async resp => {
    if (resp.url().includes('listForReportWorker')) {
      try {
        const ct = resp.headers()['content-type'] || ''
        if (ct.includes('application/json')) {
          const json = await resp.json()
          if (json && Array.isArray(json.rows)) {
            capturedRows = json.rows
            log(`[DatalifeScraper] Capturadas ${capturedRows.length} linhas via response listener.`)
          }
        }
      } catch (_) {}
    }
  })

  log('[DatalifeScraper] Navegando para #/Workers/report...')
  await page.goto('https://appv3.datalife.global/#/Workers/report', {
    waitUntil: 'load',
    timeout: 35000,
  })

  // Aguarda requisição da tabela
  await page.waitForResponse(
    resp => resp.url().includes('listForReportWorker') && resp.status() === 200,
    { timeout: 25000 }
  ).catch(() => null)

  await page.waitForTimeout(4000)

  // Extrair da tabela HTML do DOM
  log('[DatalifeScraper] Extraindo dados da tabela de profissionais...')
  const domRows = await page.$$eval('table tbody tr', trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g, ' ').trim())
      return {
        name: tds[0] || '',
        polo: tds[1] || '',
        statusText: tds[2] || '',
        lastUpdate: tds[3] || '',
      }
    }).filter(r => r.name.length > 3)
  )

  if (capturedRows.length > 0) {
    for (const row of capturedRows) {
      const isCleared = row.status === 0 && (row.countPending ?? 0) === 0
      workers.push({
        name: cleanWorkerName(row.name),
        cpf: row.cpf?.trim(),
        status: isCleared ? 'CLEARED' : 'BLOCKED',
        cleared: isCleared,
        pendingCount: row.countPending ?? 0,
        totalDocuments: row.countDocuments ?? 0,
        plant: row.plantsName,
        jobRole: row.jobPosition,
        client: row.client ?? 'GE VERNOVA',
        documents: [],
      })
    }
  } else if (domRows.length > 0) {
    for (const dr of domRows) {
      const isCleared = dr.statusText.toLowerCase().includes('habilitado')
      workers.push({
        name: cleanWorkerName(dr.name),
        status: isCleared ? 'CLEARED' : 'BLOCKED',
        cleared: isCleared,
        plant: dr.polo,
        client: 'GE VERNOVA',
        documents: [],
      })
    }
  }

  log(`[DatalifeScraper] Total final de profissionais catalogados: ${workers.length}`)

  return {
    portalId,
    portalName: 'Datalife (GE Vernova)',
    system: 'Datalife',
    capturedAt,
    workers,
    summary: {
      totalWorkers: workers.length,
      clearedWorkers: workers.filter(w => w.cleared).length,
      blockedWorkers: workers.filter(w => !w.cleared).length,
    },
  }
}
