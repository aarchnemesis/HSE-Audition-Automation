import { Page } from 'playwright'
import { PortalCensus, PortalWorker } from '../../domain/models/PortalCensus.js'
import { normalizeSurisoft } from './LegacyCensusNormalizers.js'
import {
  SurisoftApiDoc,
  mapSurisoftApiDoc,
  parseWorkerToken,
} from './SurisoftApiParser.js'

// Surisoft (Suricatta) navigation. Confirmed flow (Gemini, 2026-10-26): open a client, go to
// Gestão de Terceiros -> Colaboradores, read each worker's encrypted token from its
// exibirRequisitosColaborador(...) button, then POST that token to the internal API to get the
// document list as JSON. The token/button is stable app code (not an auto-generated id), so this
// is far steadier than pure DOM scraping. Parsing is SurisoftApiParser; statuses normalize via
// the existing normalizeSurisoft.

export interface SurisoftClient {
  /** Text to find the client's row in the clients table. */
  searchQuery: string
  /** Full park label stored as the worker's contract. */
  parque: string
}

export const DEFAULT_SURISOFT_CLIENTS: SurisoftClient[] = [
  {
    searchQuery: 'GE Water',
    parque: 'GE Water & Process (Ventos da Bahia / Delta PI / Delta MA)',
  },
  { searchQuery: 'Serena Energia', parque: 'Serena Energia S.A.' },
]

const CLIENTS_URL = 'https://www.surisoft.com.br/SQF/clientes'
const STEP_TIMEOUT = 20000

interface RawCard {
  onclick: string
  nome: string
  funcao: string
}

async function extractWorkerCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll(
        'button[onclick*="exibirRequisitosColaborador"]'
      )
    )
    return btns.map(btn => {
      const onclick = btn.getAttribute('onclick') ?? ''
      let container: HTMLElement | null = btn.parentElement
      while (
        container &&
        !container.innerText.includes('Função:') &&
        container.parentElement
      )
        container = container.parentElement
      const lines = (container?.innerText ?? '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
      let nome = 'Desconhecido'
      for (const l of lines) {
        if (
          l.length > 3 &&
          l === l.toUpperCase() &&
          !/FUNÇÃO|DATA|REQUISITOS|FILTROS/.test(l)
        ) {
          nome = l.replace(/^[–\-+]\s*/, '').trim()
          break
        }
      }
      const fnLine = lines.find(l => l.startsWith('Função:'))
      const funcao = fnLine
        ? fnLine.split('|')[0].replace('Função:', '').trim()
        : 'Subcontratado'
      return { onclick, nome, funcao }
    })
  })
}

async function fetchRequisitos(
  page: Page,
  token: string
): Promise<SurisoftApiDoc[]> {
  return page.evaluate(token => {
    return new Promise<SurisoftApiDoc[]>(resolve => {
      const w = window as unknown as {
        $?: {
          post: (
            u: string,
            d: unknown,
            cb: (r: { Dados?: SurisoftApiDoc[] }) => void
          ) => { fail: (f: () => void) => void }
        }
      }
      const url = '/consultas/colaborador_requisitos_list'
      if (w.$?.post) {
        w.$.post(url, { colaborador: token }, r => resolve(r.Dados ?? [])).fail(
          () => resolve([])
        )
      } else {
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: `colaborador=${encodeURIComponent(token)}`,
        })
          .then(r => r.json())
          .then(j => resolve(j.Dados ?? []))
          .catch(() => resolve([]))
      }
    })
  }, token)
}

/**
 * Drives an already-authenticated Surisoft page across the given clients and returns a census.
 * The page must be logged in (use the login harness first).
 */
export async function scrapeSurisoftCensus(
  page: Page,
  options: {
    portalId: string
    capturedAt?: string
    clients?: SurisoftClient[]
    log?: (msg: string) => void
  }
): Promise<PortalCensus> {
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const clients = options.clients ?? DEFAULT_SURISOFT_CLIENTS
  const log = options.log ?? (() => {})

  const rawWorkers: Parameters<typeof normalizeSurisoft>[0] = []
  for (const client of clients) {
    try {
      await page.goto(CLIENTS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: STEP_TIMEOUT,
      })
      const row = page.locator(`tr:has-text("${client.searchQuery}")`).first()
      if ((await row.count()) === 0) {
        log(`cliente não encontrado: ${client.searchQuery}`)
        continue
      }
      await row.locator('.btn').first().click({ timeout: STEP_TIMEOUT })
      await page
        .locator('a.dropdown-toggle:has-text("Gestão de Terceiros")')
        .first()
        .click({ timeout: STEP_TIMEOUT })
      await page
        .locator('ul.dropdown-menu a:has-text("Colaboradores")')
        .first()
        .click({ timeout: STEP_TIMEOUT })
      await page.waitForTimeout(3000)

      const cards = await extractWorkerCards(page)
      const seen = new Set<string>()
      let count = 0
      for (const card of cards) {
        const parsed = parseWorkerToken(card.onclick)
        if (!parsed || seen.has(parsed.idColab)) continue
        seen.add(parsed.idColab)
        const docs = (await fetchRequisitos(page, parsed.token)).map(
          mapSurisoftApiDoc
        )
        rawWorkers.push({
          nome: card.nome,
          cliente: client.parque,
          funcao: card.funcao,
          documentos: docs,
        })
        count++
      }
      log(`${client.searchQuery}: ${count} colaboradores`)
    } catch (err) {
      log(`cliente ${client.searchQuery} falhou: ${(err as Error).message}`)
    }
  }

  return {
    portalId: options.portalId,
    capturedAt,
    workers: normalizeSurisoft(rawWorkers) as PortalWorker[],
  }
}
