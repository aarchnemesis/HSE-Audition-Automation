import { Page } from 'playwright'
import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../../domain/models/PortalCensus.js'

function mapStatus(statusText: string): PortalDocStatus {
  const norm = statusText.toUpperCase()
  if (norm.includes('REPROVADO') || norm.includes('RECUSADO')) return 'REJECTED'
  if (norm.includes('APROVADO')) return 'APPROVED'
  if (norm.includes('EM ANÁLISE') || norm.includes('EM ANALISE') || norm.includes('AGUARDANDO')) return 'IN_REVIEW'
  if (norm.includes('NÃO ANEXADO') || norm.includes('NAO ANEXADO') || norm.includes('PENDENTE')) return 'MISSING'
  if (norm.includes('DISPENSADO')) return 'WAIVED'
  return 'MISSING'
}

function parseDate(text: string): string | undefined {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return undefined
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

export async function scrapeTechSocialCensus(
  page: Page,
  options: { portalId?: string; capturedAt?: string; log?: (msg: string) => void } = {}
): Promise<PortalCensus> {
  const portalId = options.portalId || 'techsocial-cpfl'
  const capturedAt = options.capturedAt || new Date().toISOString()
  const log = options.log || console.log

  log('Navegando para lista de colaboradores TechSocial...')
  await page.goto(
    'https://cpfl-sym-supply.techsocial.com.br/empresas.php?pagina=colaboradores&id=370129',
    { waitUntil: 'networkidle', timeout: 30000 }
  )

  const rawWorkers = await page.evaluate(() => {
    const collabRows = Array.from(document.querySelectorAll('tr[id^="colaborador_"]'))
    return collabRows.map(tr => {
      const id = tr.id.replace('colaborador_', '')
      
      // Colunas principais do colaborador
      const tds = Array.from(tr.querySelectorAll('td'))
      const summaryText = tr.innerText.trim()
      const lines = summaryText.split('\n').map(l => l.trim()).filter(Boolean)
      
      const matricula = lines[0] || ''
      const name = lines[1] || ''
      const role = lines[3] || ''
      const overall = lines[4] || ''

      // Documentos de cadastro e eventuais
      const docContainers = [
        document.getElementById(`aplicados_cadastro_${id}`),
        document.getElementById(`aplicados_eventual_${id}`)
      ].filter(Boolean)

      const docs: { title: string; dateText: string; statusText: string }[] = []
      for (const container of docContainers) {
        if (!container) continue
        const docRows = Array.from(container.querySelectorAll('tbody tr, table tr'))
        for (const dr of docRows) {
          const cells = Array.from(dr.querySelectorAll('td, th')).map(c => c.innerText.trim())
          if (cells.length >= 2 && cells[0] && !cells[0].includes('Documentos de') && !cells[0].includes('Inserção')) {
            const rawDetails = cells.slice(1).join('\n')
            docs.push({
              title: cells[0],
              dateText: rawDetails,
              statusText: rawDetails
            })
          }
        }
      }

      return {
        id,
        name,
        role,
        matricula,
        overall,
        docs
      }
    })
  })

  log(`Extraídos ${rawWorkers.length} colaboradores brutos da página.`)

  const workers: PortalWorker[] = rawWorkers
    .filter(w => w.name && w.name.length > 3)
    .map(w => {
      const documents: PortalDocument[] = w.docs.map(d => {
        const cleanTitle = d.title.replace(/^\d+[\.\s\-]+/, '').trim()
        const status = mapStatus(d.statusText)
        const dateMatch = parseDate(d.dateText)

        return {
          title: cleanTitle,
          status,
          expiresOn: dateMatch && dateMatch !== 'Indeterminado' ? dateMatch : undefined,
          note: status === 'REJECTED' ? 'Documento reprovado no TechSocial CPFL' : undefined,
          required: true
        }
      })

      return {
        name: w.name,
        role: w.role,
        client: 'CPFL',
        contract: 'H005 - CPFL Renováveis',
        documents
      }
    })

  log(`Processados ${workers.length} colaboradores normalizados.`)

  return {
    portalId,
    capturedAt,
    workers
  }
}
