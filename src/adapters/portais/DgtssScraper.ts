import { Page } from 'playwright'
import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker
} from '../../domain/models/PortalCensus.js'

export interface DgtssScrapeOptions {
  portalId?: string
  log?: (msg: string) => void
}

function parseBrazilianDate(dStr: string): string | undefined {
  if (!dStr) return undefined
  const clean = dStr.trim().slice(0, 10)
  const match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return undefined
  const [, d, m, y] = match
  return `${y}-${m}-${d}`
}

function normalizeDocStatus(statusRaw: string): PortalDocStatus {
  const s = (statusRaw || '').toUpperCase().trim()
  if (s.includes('APROVADO') || s.includes('VALID') || s === 'EM DIA') return 'APPROVED'
  if (s.includes('REPROVADO') || s.includes('REJEITADO')) return 'REJECTED'
  if (s.includes('ANÁLISE') || s.includes('ANALISE') || s.includes('AGUARDANDO')) return 'IN_REVIEW'
  if (s.includes('PENDENTE') || s.includes('FALTA')) return 'MISSING'
  if (s.includes('ISENTO') || s.includes('DISPENSADO')) return 'WAIVED'
  if (s.includes('VENCIDO') || s.includes('EXPIRADO')) return 'EXPIRED'
  return 'IN_REVIEW'
}

export async function scrapeDgtssCensus(
  page: Page,
  options: DgtssScrapeOptions = {}
): Promise<PortalCensus> {
  const log = options.log ?? (() => {})
  const portalId = options.portalId ?? 'dgtss-invenergy'
  const capturedAt = new Date().toISOString()
  const workers: PortalWorker[] = []

  log('[DGTSS] Navegando para Consulta de Funcionários (IntegrationReport.aspx)...')
  await page.goto('https://invenergy.dgtss.com.br/MGI/IntegrationReport.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  log('[DGTSS] Clicando no botão Buscar (#btnReport)...')
  await Promise.all([
    page.waitForResponse(res => res.url().includes('IntegrationReport.aspx') || res.status() === 200, { timeout: 30000 }).catch(() => null),
    page.click('#btnReport')
  ])
  await page.waitForTimeout(3000)

  // Extrair colaboradores da tabela gvIntegration
  const workerRows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#gvIntegration tr'))
    return trs.slice(1).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'))
      const editEl = tds[8]?.querySelector('a')
      return {
        name: tds[0]?.textContent?.trim() || '',
        rg: tds[1]?.textContent?.trim() || '',
        cpf: tds[2]?.textContent?.trim() || '',
        empresa: tds[3]?.textContent?.trim() || '',
        integracaoValidade: tds[4]?.textContent?.trim() || '',
        asoValidade: tds[5]?.textContent?.trim() || '',
        statusSummary: tds[7]?.textContent?.trim() || '',
        detailHref: editEl?.getAttribute('href') || ''
      }
    }).filter(w => w.name && w.detailHref)
  })

  log(`[DGTSS] ${workerRows.length} colaboradores encontrados na lista geral.`)

  for (const w of workerRows) {
    log(`[DGTSS] Inspecionando documentos de: ${w.name}...`)
    const docs: PortalDocument[] = []

    try {
      const detailUrl = w.detailHref.startsWith('http')
        ? w.detailHref
        : `https://invenergy.dgtss.com.br/MGI/${w.detailHref}`

      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await page.waitForTimeout(1500)

      // Clicar na aba Anexos se existir
      const attachTab = page.locator('a[href="#attach"]').first()
      if (await attachTab.count()) {
        await attachTab.click().catch(() => null)
        await page.waitForTimeout(1000)
      }

      // Extrair documentos anexados (gvIntegrationAttachT)
      const uploaded = await page.evaluate(() => {
        const table = document.querySelector('#gvIntegrationAttachT')
        if (!table) return []
        return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
          const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim().replace(/\s+/g, ' ') || '')
          return {
            filename: tds[2] || '',
            category: tds[3] || '',
            status: tds[4] || '',
            note: tds[5] || '',
            refDate: tds[7] || '',
            expDate: tds[8] || '',
            reviewer: tds[9] || ''
          }
        }).filter(r => r.category)
      })

      for (const up of uploaded) {
        const title = up.category || up.filename || 'Documento DGTSS'
        const expiresOn = parseBrazilianDate(up.expDate)
        const note = [up.note, up.reviewer ? `Aprovador: ${up.reviewer}` : '']
          .filter(Boolean)
          .join(' | ')

        docs.push({
          title,
          status: normalizeDocStatus(up.status),
          expiresOn,
          note: note || undefined,
          required: true
        })
      }

      // Extrair documentos faltantes (gvIntegrationAttachRemaining)
      const remaining = await page.evaluate(() => {
        const table = document.querySelector('#gvIntegrationAttachRemaining')
        if (!table) return []
        return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
          const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim().replace(/\s+/g, ' ') || '')
          return {
            category: tds[0] || '',
            isAttached: tds[1] || '',
            isWaived: tds[2] || '',
            status: tds[3] || ''
          }
        }).filter(r => r.category)
      })

      for (const rem of remaining) {
        docs.push({
          title: rem.category,
          status: rem.isWaived.toUpperCase().includes('SIM') ? 'WAIVED' : 'MISSING',
          required: true,
          note: 'Documento pendente de anexação'
        })
      }

      // Se nenhum documento detalhado foi encontrado nas abas, registrar resumo do ASO e Integração
      if (docs.length === 0) {
        if (w.asoValidade) {
          docs.push({
            title: 'ASO',
            status: normalizeDocStatus(w.asoValidade),
            expiresOn: parseBrazilianDate(w.asoValidade),
            required: true
          })
        }
        if (w.integracaoValidade) {
          docs.push({
            title: 'Treinamento de Integração',
            status: normalizeDocStatus(w.integracaoValidade),
            expiresOn: parseBrazilianDate(w.integracaoValidade),
            required: true
          })
        }
      }

      log(`  ✓ ${docs.length} documentos mapeados para ${w.name}`)
    } catch (err: any) {
      log(`  ⚠️ Erro ao extrair detalhes de ${w.name}: ${err.message}`)
      // Adicionar colaborador com status de resumo
      docs.push({
        title: 'Status Geral DGTSS',
        status: normalizeDocStatus(w.statusSummary),
        note: w.statusSummary,
        required: true
      })
    }

    workers.push({
      name: w.name,
      role: 'Técnico de Campo',
      client: 'INVENERGY',
      contract: w.empresa || 'ARTH WIND SERVICES',
      documents: docs
    })
  }

  log(`\n[DGTSS] Extração concluída com sucesso: ${workers.length} colaboradores processados.`)

  return {
    portalId,
    capturedAt,
    workers
  }
}
