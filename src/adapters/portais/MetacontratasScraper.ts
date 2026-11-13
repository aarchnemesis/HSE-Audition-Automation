import { Page } from 'playwright'
import { PortalCensus, PortalDocStatus, PortalDocument, PortalWorker } from '../../domain/models/PortalCensus.js'

export interface MetacontratasScrapeOptions {
  portalId?: string
  log?: (msg: string) => void
}

// The hub cards only say "ENERGIMP" (twice); the CE/SC suffix is only visible in the title of the
// page a card opens ("Lista de Colaboradores de ... - CE"). So Energimp cards are picked by order
// and the final label comes from that title when present.
export const METACONTRATAS_TARGETS = [
  { match: /IBITU/i, nth: 0, client: 'IBITU ENERGIA S.A' },
  { match: /ENERGIMP/i, nth: 0, client: 'ENERGIMP (1, desativado)' },
  { match: /ENERGIMP/i, nth: 1, client: 'ENERGIMP (2)' },
  { match: /REPSOL/i, nth: 0, client: 'REPSOL CHILE' },
  { match: /CPFL/i, nth: 0, client: 'CPFL' }
]

function mapDocStatus(raw: string): PortalDocStatus | undefined {
  const n = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/vencid|expirad/.test(n)) return 'EXPIRED'
  if (/pend|valida|analis|revis/.test(n)) return 'IN_REVIEW'
  if (/erro|rejeit|recus|reprov/.test(n)) return 'REJECTED'
  if (/^ok\b|aprovad|valido/.test(n)) return 'APPROVED'
  return undefined
}

function brDate(raw: string): string | undefined {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

/**
 * Opens "Situação de Documentos Solicitados" for one worker (the second icon on the row), reads the
 * whole document table on a single page and goes back to the worker list. Returns null when the
 * screen could not be read, so the caller can fall back to the summary counters.
 */
async function readWorkerDocuments(
  page: Page,
  cpf: string,
  log: (msg: string) => void
): Promise<PortalDocument[] | null> {
  try {
    const row = page.locator('tr', { hasText: cpf }).last()
    await row.locator('input[src*="enviar_docs"], input[title="Situação de Documentos Solicitados"]').first().click({ timeout: 10000 })
    // Portuguese ("Tipos de Documentos solicitados") and Spanish (Repsol) screens differ in text,
    // so wait for the "(NNN) document" rows instead.
    await page.waitForFunction(() => /Tipos de Documentos (solicitados|exigidos) para/i.test(document.body.innerText), undefined, { timeout: 20000 })

    type DocRow = { title: string; affects: string; expires: string; status: string }
    const readPage = (): Promise<DocRow[]> => page.evaluate(() => {
      const out: { title: string; affects: string; expires: string; status: string }[] = []
      const trs = Array.from(document.querySelectorAll('tr'))
      for (let i = 0; i < trs.length; i++) {
        const tds = Array.from(trs[i].querySelectorAll(':scope > td'))
        if (tds.length < 9) continue
        const cells = tds.map(td => ((td as HTMLElement).innerText || '').trim().replace(/\s+/g, ' '))
        // Document rows: <title> | Afeta acesso (Sim/Si/Não/No) | ... | Tipo (Genérico/Específico) | ... | Status.
        // Portuguese rows carry a "(NNN)" prefix on the title, Spanish (Repsol) rows do not.
        const kk = cells.findIndex((c, ix) => ix > 0 && /^(sim|si|não|nao|no)$/i.test(c) && cells[ix - 1].length > 3)
        if (kk < 1) continue
        const tipoIdx = cells.findIndex((c, ix) => ix > kk && /^(gen[eé]rico|espec[ií]fico)$/i.test(c))
        if (tipoIdx < 0) continue
        const c = cells.slice(kk - 1)
        const tail = cells.slice(tipoIdx + 3)
        const st = tail.find(x => /^(ok|-|.*(vencid|expirad|pend|erro|valid|rejeit|recus|reprov|aprov|analis).*)$/i.test(x)) || ''
        out.push({ title: c[0], affects: c[1] || '', expires: c[3] || '', status: st })
      }
      return out
    })

    // Prefer the portal's own "show all on one page" link (an <a>, not an <input>).
    const onePage = page.locator('[title="Mostrar datos en una sola página"]').first()
    if (await onePage.count()) {
      await onePage.click({ timeout: 8000 }).catch(() => null)
      await page.waitForTimeout(3000)
    }

    // Read page 1, then follow the "next page" button until the table stops changing. (The
    // "show all on one page" button is not available on every contract, so paginate instead.)
    const rows: DocRow[] = []
    let lastSignature = ''
    for (let pageNo = 1; pageNo <= 8; pageNo++) {
      const batch = await readPage()
      const signature = batch.map(r => `${r.title}|${r.expires}|${r.status}`).join('|')
      if (batch.length === 0 || signature === lastSignature) break
      lastSignature = signature
      rows.push(...batch)
      const next = page.locator('[title="Ir a la página siguiente"], [title*="próxima" i], [title*="seguinte" i]').first()
      if (!(await next.count()) || (await next.isDisabled().catch(() => false))) break
      await next.click({ timeout: 8000 }).catch(() => null)
      await page.waitForTimeout(2500)
    }

    // Back to the worker list for the next person.
    await page.getByText(/^\s*Lista de (Colaboradores|Empleados)\s*$/).first().click({ timeout: 10000 }).catch(() => null)
    await page.waitForSelector('input[src*="enviar_docs"], input[title="Situação de Documentos Solicitados"]', { timeout: 20000 })

    if (rows.length === 0) return null
    const unmapped = new Set<string>()
    const docs = rows.map(r => {
      const st = mapDocStatus(r.status)
      if (!st && r.status.length > 2 && r.status !== '-') unmapped.add(r.status)
      return {
        title: r.title.replace(/^\(\d{3}\)\s*/, '').trim(),
        status: st ?? ('MISSING' as PortalDocStatus),
        expiresOn: brDate(r.expires),
        note: st
          ? undefined
          : r.status === '-'
            ? 'Sem documento enviado (status "-" no portal).'
          : r.status.length <= 2
            ? 'Status não exibido pelo portal para este documento (sem arquivo enviado?). Conferir na Metacontratas.'
            : `Status não reconhecido na Metacontratas: "${r.status}"`,
        required: !/^n/i.test(r.affects)
      } satisfies PortalDocument
    })
    for (const u of unmapped) log(`ATENÇÃO: status não mapeado: "${u}"`)
    return docs
  } catch (err: any) {
    log(`Falha ao ler documentos de ${cpf}: ${err.message}`)
    return null
  }
}

export async function scrapeMetacontratasCensus(
  hubPage: Page,
  options: MetacontratasScrapeOptions = {}
): Promise<PortalCensus> {
  const log = options.log ?? (() => {})
  const portalId = options.portalId ?? 'metacontratas'
  const capturedAt = new Date().toISOString()
  const workers: PortalWorker[] = []
  const context = hubPage.context()

  log('Iniciando extração dos contratos Metacontratas...')

  // A failed contract is retried once at the end: the hub sometimes does not re-render its cards
  // right after a contract page was open, and dropping the contract would shrink the census.
  const queue = METACONTRATAS_TARGETS.map(t => ({ t, tries: 0 }))
  while (queue.length) {
    const { t: target, tries } = queue.shift()!
    log(`\n--- Extraindo contrato: ${target.client} (filtro: ${target.match}) ---`)

    try {
      // Garantir que estamos na tela com os cards de contrato
      await hubPage.goto('https://hub.metadata.net/app/accesos?plataformaInicio=Metacontratas', {
        waitUntil: 'commit',
        timeout: 25000
      })
      await hubPage.waitForSelector(
        'button:has-text("IBITU"), button:has-text("ENERGIMP"), button:has-text("CPFL"), button:has-text("REPSOL")',
        { timeout: 20000 }
      )
      await hubPage.waitForTimeout(2000)

      const btn = hubPage.locator('button').filter({ hasText: target.match }).nth(target.nth)
      if (!(await btn.count())) {
        log(`Botão com filtro ${target.match} não localizado. Pulando.`)
        continue
      }

      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 12000 }).catch(() => null),
        btn.click()
      ])

      const workPage = popup || hubPage
      await workPage.waitForTimeout(6000)

      if (!workPage.url().includes('TablaEmpleado.jsp')) {
        await workPage.goto('https://cloud.metacontratas.com/acceso1/faces/TablaEmpleado.jsp', {
          waitUntil: 'commit',
          timeout: 20000
        }).catch(() => null)
        await workPage.waitForTimeout(4000)
      }

      if (!workPage.url().includes('TablaEmpleado.jsp')) {
        await workPage.goto('https://cloud.metacontratas.com/acceso2/faces/TablaEmpleado.jsp', {
          waitUntil: 'commit',
          timeout: 20000
        }).catch(() => null)
        await workPage.waitForTimeout(4000)
      }

      log(`Página ativa em: ${workPage.url()}`)

      // A disabled contract card (confirmed for the first ENERGIMP card) never leaves the hub:
      // that is an inactive contract, not an error, so skip it without retrying.
      if (!workPage.url().includes('TablaEmpleado.jsp')) {
        log(`Contrato ${target.client} não abriu (card desativado ou sem acesso). Pulando sem nova tentativa.`)
        if (popup && !popup.isClosed()) await popup.close().catch(() => null)
        continue
      }

      // tsx/esbuild injects a __name() helper into named arrows; the page context does not have it.
      await workPage.evaluate('window.__name = window.__name || (f => f)').catch(() => null)
      const { rows: extracted, siteLabel } = await workPage.evaluate((clientName: string) => {
        const norm = (s: string) =>
          s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
        const txt = (el: Element) => ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ')
        const allRows = Array.from(document.querySelectorAll('table tr'))

        // Locate the header row and map columns by name; fall back to the legacy fixed positions.
        const alias: Record<string, string[]> = { cpf: ['cpf', 'nif'], nome: ['nome', 'nombre'], sobrenome: ['sobrenome', 'apellidos'], funcao: ['funcao', 'puesto'], necess: ['necess', 'req'], ok: ['ok'], pendente: ['pendente', 'pend'], vencido: ['vencido', 'exp'], 'status subcontratado': ['status subcontratado'], 'situacao do colaborador': ['situacao do colaborador', 'estado empleado'] }
        const colNames = Object.keys(alias)
        let headerLen = 0
        const idx: Record<string, number> = {}
        for (const r of allRows) {
          const hs = Array.from(r.querySelectorAll('th, td')).map(c => norm(txt(c)))
          if ((hs.includes('cpf') || hs.includes('nif')) && hs.some(h => h.startsWith('nom'))) {
            headerLen = hs.length
            for (const n of colNames) {
              const i = hs.findIndex(h => alias[n].some(a => (n === 'ok' || a.length <= 3 ? h === a || h === a + '.' : h.startsWith(a))))
              if (i >= 0) idx[n] = i
            }
            break
          }
        }
        const legacy: Record<string, number> = { nome: 2, sobrenome: 3, funcao: 4, necess: 6, ok: 7, pendente: 8, vencido: 9, 'status subcontratado': 10, 'situacao do colaborador': 11 }
        const useHeaders = headerLen > 0 && ['nome', 'necess', 'ok', 'pendente', 'vencido'].every(k => k in idx)

        const heading = (document.body.innerText || '').match(/Lista de Colaboradores de[^\n]*?-\s*([A-Z]{2})\b/)
        const siteLabel = heading ? heading[1] : ''

        const list: any[] = []
        for (const r of allRows) {
          const cells = Array.from(r.querySelectorAll('td')).map(td => txt(td))
          if (cells.length < 8) continue

          // Some CPFs lose their leading zero in the grid (10 digits), so accept 9-11 digits.
          // Brazilian CPFs (9-11 digits, sometimes missing the leading zero) or foreign IDs such as
          // Repsol Chile's passport/RUT numbers (e.g. "GJ933482", "482364306").
          const cpfMatch =
            cells.find(c => /^\d{9,11}$/.test(c.replace(/\D/g, ''))) ||
            cells.find(c => /^[A-Za-z]{0,3}\d{6,10}$/.test(c))
          if (!cpfMatch) continue

          const cpf = /^\d/.test(cpfMatch) ? cpfMatch.replace(/\D/g, '') : cpfMatch
          // Rows can have fewer cells than the header (icon columns): align from the right.
          const shift = useHeaders ? cells.length - headerLen : 0
          const colBy = (n: string, headers: boolean) => {
            const i = headers ? idx[n] : legacy[n]
            return i === undefined ? '' : cells[i + (headers ? shift : 0)] || ''
          }
          // If the header mapping yields no name for this row (layout differs, e.g. Repsol), use the
          // legacy fixed positions instead of emitting an empty worker.
          const headersOk = useHeaders && colBy('nome', true) !== ''
          const col = (n: string) => colBy(n, headersOk)
          const nome = col('nome')
          const sobrenome = col('sobrenome')
          // Some contracts (Repsol) put the full name in "Nome" and a short name in "Sobrenome".
          const fullName = sobrenome && nome.toLowerCase().includes(sobrenome.toLowerCase()) ? nome : `${nome} ${sobrenome}`.trim()
          const funcao = col('funcao')
          const necss = parseInt(col('necess') || '0', 10) || 0
          const ok = parseInt(col('ok') || '0', 10) || 0
          const pend = parseInt(col('pendente') || '0', 10) || 0
          const venc = parseInt(col('vencido') || '0', 10) || 0
          const status = col('status subcontratado')
          const situacao = col('situacao do colaborador')

          list.push({
            cpf,
            name: fullName,
            role: funcao,
            client: clientName,
            totalRequired: necss,
            approved: ok,
            pending: pend,
            expired: venc,
            status,
            situation: situacao
          })
        }
        return { rows: list, siteLabel }
      }, target.client)

      const clientLabel = target.client.startsWith('ENERGIMP') && siteLabel ? `ENERGIMP (${siteLabel})` : target.client
      for (const w of extracted) w.client = clientLabel
      log(`Encontrados ${extracted.length} colaboradores para ${clientLabel}`)

      for (const w of extracted) {
        // The summary row only exposes counters, not per-document rows: emit one synthetic entry
        // per bucket so expired/pending are no longer collapsed, and keep the raw counters visible.
        const counters = `${w.approved}/${w.totalRequired} OK, ${w.pending} pend., ${w.expired} venc. (situação: ${w.situation || 'n/d'})`
        const detailed = await readWorkerDocuments(workPage, w.cpf, log)
        if (detailed) {
          workers.push({ name: w.name, role: w.role, contract: w.client, documents: detailed })
          continue
        }
        const documents: PortalDocument[] = []
        if (w.expired > 0)
          documents.push({ title: 'Metacontratas: documentos vencidos', status: 'EXPIRED', required: true, note: counters })
        if (w.pending > 0)
          documents.push({ title: 'Metacontratas: documentos pendentes de validação', status: 'IN_REVIEW', required: true, note: counters })
        if (w.expired === 0 && w.pending === 0)
          documents.push({
            title: 'Conformidade Geral Metacontratas',
            status: w.totalRequired > 0 && w.approved >= w.totalRequired ? 'APPROVED' : 'IN_REVIEW',
            required: true,
            note: counters
          })
        workers.push({ name: w.name, role: w.role, contract: w.client, documents })
      }

      if (popup && !popup.isClosed()) {
        await popup.close().catch(() => null)
      }
    } catch (err: any) {
      log(`Erro durante extração de ${target.client}: ${err.message}`)
      if (tries < 1) {
        log(`Nova tentativa para ${target.client} ao final.`)
        queue.push({ t: target, tries: tries + 1 })
      }
    }
  }

  log(`\nExtração Metacontratas finalizada com ${workers.length} colaboradores catalogados.`)
  return {
    portalId,
    capturedAt,
    workers
  }
}
