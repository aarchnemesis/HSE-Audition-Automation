import { Browser, Page, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DriveRpoComparisonItem } from '../../domain/services/DriveRpoAuditor.js'
import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js'
import { buildDashboardHtml } from './DashboardHtmlGenerator.js'

const STATUSES: HSEDatabaseRecord['statusEHS'][] = [
  'CONFORME',
  'VENCIDO',
  'VENCE_30',
  'CONFORME',
  'AUSENTE',
]

function detailFor(status: HSEDatabaseRecord['statusEHS'], person: number) {
  if (status === 'VENCIDO') return `VENCIDO há ${10 + person} dias (01/10/2026)`
  if (status === 'VENCE_30')
    return 'ALERTA MÉDIO: Vence em 20 dias (10/11/2026)'
  return 'Válido até 10/10/2027'
}

const DAY = 86400000
const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString()

const RPO_ITEMS = [
  // RPO says expired, the Drive certificate is valid: flips the status
  {
    divergent: true,
    divergenceKind: 'DATA_DIVERGENTE',
    trustedSource: 'DRIVE',
    driveExpiration: iso(400),
    rpoExpiration: iso(-30),
    inspectorName: 'Colaborador Teste 01',
    docName: 'ASO',
    docCode: '01',
    diffDays: 430,
    detail: 'x',
  },
  // both valid, only the typed date differs: does not flip
  {
    divergent: true,
    divergenceKind: 'DATA_DIVERGENTE',
    trustedSource: 'DRIVE',
    driveExpiration: iso(400),
    rpoExpiration: iso(300),
    inspectorName: 'Colaborador Teste 02',
    docName: 'CNH',
    docCode: '08',
    diffDays: 100,
    detail: 'x',
  },
  {
    divergent: true,
    divergenceKind: 'SOMENTE_DRIVE',
    trustedSource: 'DRIVE',
    driveExpiration: iso(200),
    inspectorName: 'Colaborador Teste 03',
    docName: 'NR-35',
    docCode: '21',
    detail: 'x',
  },
] as unknown as DriveRpoComparisonItem[]

const HISTORY = Array.from({ length: 5 }, (_, i) => ({
  date: `2026-10-${String(10 + i).padStart(2, '0')}`,
  documents: 200,
  onTime: 170 + i * 3,
  expiringSoon: 10,
  expired: 15 - i * 2,
  missing: 5,
}))

function buildRecords(people: number): HSEDatabaseRecord[] {
  const docs = [
    ['01', 'ASO'],
    ['08', 'CNH'],
    ['10', 'NR-01 Integração'],
    ['12', 'NR-10 Básico'],
    ['21', 'NR-35 Trabalho em Altura'],
  ]
  const records: HSEDatabaseRecord[] = []
  for (let p = 0; p < people; p++) {
    docs.forEach(([docCode, docName], d) => {
      records.push({
        inspectorId: `COL-${p}`,
        inspectorName: `Colaborador Teste ${String(p).padStart(2, '0')}`,
        role: 'IQ',
        sector: 'INTERNAS',
        docCode,
        docName,
        statusEHS: STATUSES[(p + d) % STATUSES.length],
        detail: detailFor(STATUSES[(p + d) % STATUSES.length], p),
        modality: d % 2 === 0 ? 'PRESENCIAL' : 'ONLINE',
        lastUpdated: '2026-09-17T00:00:00.000Z',
      })
    })
  }
  return records
}

async function launchBrowser(): Promise<Browser | null> {
  const attempts: Array<Parameters<typeof chromium.launch>[0]> = [
    undefined,
    { channel: 'chrome' },
    { channel: 'msedge' },
  ]
  for (const options of attempts) {
    try {
      return await chromium.launch(options)
    } catch {
      // try the next browser
    }
  }
  return null
}

const VIEWS = ['cockpit', 'matrix', 'table', 'rpo', 'storz'] as const

let browser: Browser | null = null
const html = buildDashboardHtml(buildRecords(40), {
  rpoDivergences: RPO_ITEMS,
  complianceHistory: HISTORY,
})

beforeAll(async () => {
  browser = await launchBrowser()
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

async function openPage(width: number, height: number): Promise<Page> {
  const page = await (browser as Browser).newPage({
    viewport: { width, height },
  })
  await page.route(/^https?:/, route => route.abort())
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  return page
}

describe('Dashboard layout (real browser)', () => {
  it('desktop: single top navigation, no sidebar, scrollable cockpit, no page errors', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(1440, 900)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await page.evaluate(() => {
      const view = document.getElementById('view-cockpit') as HTMLElement
      const kpi = document.querySelector('.cockpit-kpi-row') as HTMLElement
      return {
        sidebar: document.querySelectorAll('.sidebar').length,
        nav: document.querySelectorAll('header.topbar nav').length,
        tabs: document.querySelectorAll('.topbar .pill-opt').length,
        kpiHeight: kpi.getBoundingClientRect().height,
        cockpitScrollable: view.scrollHeight > view.clientHeight + 100,
        rows: document.querySelectorAll('.cockpit-collab-card').length,
        hScroll: document.documentElement.scrollWidth > innerWidth,
      }
    })
    await page.close()

    expect(errors).toEqual([])
    expect(result.sidebar).toBe(0)
    expect(result.nav).toBe(1)
    expect(result.tabs).toBe(5)
    expect(result.kpiHeight).toBeGreaterThan(60)
    expect(result.cockpitScrollable).toBe(true)
    expect(result.rows).toBeGreaterThan(30)
    expect(result.hScroll).toBe(false)
  }, 60_000)

  it('mobile: bottom tab bar, no horizontal scroll in any view', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(390, 844)

    const bar = await page.evaluate(() => {
      const nav = document.querySelector('.topbar-filters') as HTMLElement
      const rect = nav.getBoundingClientRect()
      return {
        position: getComputedStyle(nav).position,
        bottom: Math.round(rect.bottom),
        innerHeight,
      }
    })
    expect(bar.position).toBe('fixed')
    expect(bar.bottom).toBe(bar.innerHeight)

    for (const view of VIEWS) {
      await page.evaluate(v => (window as any).switchNav(v), view)
      await page.waitForTimeout(150)
      const hScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
      expect(hScroll, `horizontal scroll in ${view}`).toBe(false)
    }
    await page.close()
  }, 60_000)

  it('mobile: tables become labeled cards and long lists are capped with a counter', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(390, 844)
    await page.evaluate(() => (window as any).switchNav('table'))
    await page.waitForTimeout(400)

    const result = await page.evaluate(() => {
      const firstRow = document.querySelector(
        '#dataTableBody tr'
      ) as HTMLElement
      const count = document.querySelector('#dataTableBody tr.count-row')
      return {
        theadDisplay: getComputedStyle(
          document.querySelector('#view-table thead') as HTMLElement
        ).display,
        rowDisplay: getComputedStyle(firstRow).display,
        labeledCells: firstRow.querySelectorAll('td[data-label]').length,
        counter: count?.textContent?.trim() ?? '',
      }
    })
    await page.close()

    expect(result.theadDisplay).toBe('none')
    expect(result.rowDisplay).toBe('grid')
    expect(result.labeledCells).toBe(6)
    expect(result.counter).toMatch(/Exibindo 150 de 200 registros/)
    expect(result.counter).toContain('Mostrar mais')
  }, 60_000)

  it('command palette opens with Ctrl+K, filters by person and opens the dossier', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(1440, 900)
    await page.keyboard.press('Control+k')
    expect(await page.locator('#cmdk.open').count()).toBe(1)

    await page.fill('#cmdkInput', 'teste 07')
    await page.waitForTimeout(100)
    expect(await page.locator('.cmdk-item').count()).toBe(1)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)

    const state = await page.evaluate(() => ({
      paletteClosed: !document
        .getElementById('cmdk')
        ?.classList.contains('open'),
      modalOpen: document
        .getElementById('collabModal')
        ?.classList.contains('show'),
      title: document.getElementById('modalCollabName')?.textContent ?? '',
    }))
    await page.close()

    expect(state.paletteClosed).toBe(true)
    expect(state.modalOpen).toBe(true)
    expect(state.title).toContain('Colaborador Teste 07')
  }, 60_000)

  it('cockpit cards show how many days a document is overdue, most overdue first', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(1440, 900)
    const days = await page.evaluate(() => {
      const blocked = Array.from(
        document.querySelectorAll('.cockpit-collab-card')
      ).filter(card => card.querySelector('.pill-danger'))
      return blocked.map(card => {
        const overdue = Array.from(card.querySelectorAll('.pill-danger'))
          .map(pill => pill.textContent?.match(/Vencido há (\d+) d/))
          .filter((match): match is RegExpMatchArray => match !== null)
          .map(match => Number(match[1]))
        return overdue.length ? Math.max(...overdue) : null
      })
    })
    await page.close()

    const dated = days.filter((d): d is number => d !== null)
    expect(dated.length).toBeGreaterThan(5)
    // people with a dated overdue document come first, most overdue on top
    expect(days.slice(0, dated.length)).toEqual(
      [...dated].sort((a, b) => b - a)
    )
  }, 60_000)

  it('rankings drawer sits above the top bar and shows the expiry agenda and the trend', async ctx => {
    if (!browser) return ctx.skip()
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      const page = await openPage(width, height)
      await page.evaluate(() => (window as any).toggleRankingsPanel())
      await page.waitForTimeout(350)

      const result = await page.evaluate(() => {
        const panel = document.getElementById('rankingsPanel') as HTMLElement
        const close = panel.querySelector('.drawer-close-btn') as HTMLElement
        const rect = close.getBoundingClientRect()
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        )
        return {
          parent: panel.parentElement?.tagName,
          closeReachable: hit === close || close.contains(hit),
          agendaRows: document.querySelectorAll('.agenda-row').length,
          trendSvg: document.querySelectorAll('#trendBox svg').length,
          trendText: document.getElementById('trendBox')?.textContent ?? '',
        }
      })
      await page.close()

      expect(result.parent, `drawer parent @${width}`).toBe('BODY')
      expect(result.closeReachable, `close button @${width}`).toBe(true)
      expect(result.agendaRows).toBe(13)
      expect(result.trendSvg).toBe(1)
      expect(result.trendText).toContain('dos documentos em dia hoje')
    }
  }, 60_000)

  it('RPO tab opens on the divergences that change a status and the badge counts only those', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(1440, 900)
    await page.evaluate(() => (window as any).switchNav('rpo'))
    await page.waitForTimeout(300)
    const result = await page.evaluate(() => ({
      badge: document.getElementById('rpoBadgeTab')?.textContent,
      activeChip: document.querySelector('[id^="rpoChip-"].active')?.id,
      rows: document.querySelectorAll('#rpoTableBody tr:not(.count-row)')
        .length,
      firstName: document
        .querySelector('#rpoTableBody tr td')
        ?.textContent?.trim(),
      total: document.getElementById('rpoKpiActionable')?.textContent,
    }))
    await page.close()

    expect(result.badge).toBe('1')
    expect(result.activeChip).toBe('rpoChip-IMPACT')
    expect(result.rows).toBe(1)
    expect(result.firstName).toBe('Colaborador Teste 01')
    expect(result.total).toBe('3')
  }, 60_000)

  it('shows the stale data banner when a source is old or offline', async ctx => {
    if (!browser) return ctx.skip()
    const page = await openPage(1440, 900)
    const result = await page.evaluate(() => {
      const w = window as any
      const before = document
        .getElementById('staleBanner')
        ?.classList.contains('show')
      const health = (0, eval)('sourceHealth')
      health.smartsheet = {
        status: 'ONLINE',
        message: 'ok',
        lastSync: new Date(Date.now() - 31 * 3600000).toISOString(),
      }
      health.storz = { status: 'CACHE', message: 'Cache persistente' }
      w.updateStaleBanner()
      const banner = document.getElementById('staleBanner') as HTMLElement
      return {
        before,
        after: banner.classList.contains('show'),
        text: banner.textContent ?? '',
      }
    })
    await page.close()

    expect(result.before).toBe(false)
    expect(result.after).toBe(true)
    expect(result.text).toContain('Smartsheet RPO')
    expect(result.text).toContain('Storz LMS')
  }, 60_000)
})
