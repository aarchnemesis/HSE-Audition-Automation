import { Browser, Page, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DriveRpoComparisonItem } from '../../domain/services/DriveRpoAuditor.js'
import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js'
import { PortalsDashboardData } from '../../domain/services/PortalsDashboardData.js'
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

const VIEWS = ['cockpit', 'matrix', 'table', 'rpo', 'storz', 'portais'] as const

const MALICIOUS = '<img src=x onerror="window.__xss=1">'

const PORTALS: PortalsDashboardData = {
  updatedAt: '2026-11-03T12:00:00.000Z',
  refDate: '2026-11-03',
  summary: {
    totalProjects: 3,
    automatedProjects: 2,
    manualProjects: 1,
    automatedPct: 67,
    allocatedPeople: 3,
    blockedPeople: 1,
    scheduledActions: 2,
    backlogActions: 0,
    criticalRejections: 1,
  },
  platforms: [
    {
      id: 'tdoc-sgre',
      name: 'SGRE (TDoc)',
      automation: 'AUTOMATED',
      status: 'ONLINE',
      capturedAt: '2026-11-03T08:00:00Z',
      ageDays: 0,
      collaboratorsCount: 7,
      cleared: 5,
      waiting: 0,
      blocked: 2,
    },
    {
      id: 'surisoft',
      name: 'GE Vernova (Surisoft)',
      automation: 'AUTOMATED',
      status: 'STALE',
      capturedAt: '2026-10-27T09:00:00Z',
      ageDays: 7,
      collaboratorsCount: 44,
      cleared: 30,
      waiting: 4,
      blocked: 10,
    },
  ],
  projects: [
    {
      projectName: 'Parque Dom Inocêncio',
      client: 'SGRE',
      platforms: ['SGRE (TDoc)'],
      channelType: 'AUTOMATED',
      startDate: '2026-11-08',
      daysToStart: 5,
      status: 'BLOCKED',
      counts: { cleared: 1, waiting: 0, blocked: 2, other: 0 },
      collaborators: [
        {
          name: MALICIOUS,
          portal: 'SGRE (TDoc)',
          overallStatus: 'BLOCKED',
          documents: [
            {
              docName: 'GWO Working at Heights',
              status: 'REJECTED',
              rejectionReason: 'Certificado ilegível',
              suggestedAction: 'Reenviar ao SGRE (TDoc) o documento corrigido.',
              actionKind: 'RESUBMIT',
              driveUrl: 'https://drive.google.com/drive/folders/abc',
            },
            {
              docName: 'ASO',
              status: 'EXPIRING',
              expiryDate: '2026-11-20',
              driveUrl: 'javascript:alert(1)',
            },
          ],
        },
        {
          name: 'ANA LIMA',
          portal: 'SGRE (TDoc)',
          overallStatus: 'CLEARED',
          documents: [],
        },
        {
          name: 'BRUNO REIS',
          portal: 'SGRE (TDoc)',
          overallStatus: 'BLOCKED',
          documents: [{ docName: 'NR-35', status: 'MISSING' }],
        },
      ],
    },
    {
      projectName: 'Complexo Folha Larga',
      client: 'Vestas',
      platforms: ['Vestas (eGestiona)'],
      channelType: 'AUTOMATED',
      startDate: '2026-11-05',
      daysToStart: 2,
      status: 'OK',
      counts: { cleared: 1, waiting: 0, blocked: 0, other: 0 },
      collaborators: [
        {
          name: 'CARLA DIAS',
          portal: 'Vestas (eGestiona)',
          overallStatus: 'CLEARED',
          documents: [],
        },
      ],
    },
    {
      projectName: 'Parque Wayra II',
      client: 'NAWP Peru',
      platforms: [],
      channelType: 'MANUAL',
      startDate: '2026-11-12',
      daysToStart: 9,
      status: 'ATTENTION',
      counts: { cleared: 0, waiting: 0, blocked: 0, other: 1 },
      collaborators: [
        {
          name: 'DIEGO SOUZA',
          overallStatus: 'NOT_MONITORED',
          documents: [],
        },
      ],
    },
  ],
  manualGaps: [
    {
      client: 'NAWP Peru',
      channel: 'Sem leitura automática',
      projects: 1,
      allocatedCount: 1,
      nextStart: '2026-11-12',
    },
    // already running: the start date is in the past relative to refDate
    {
      client: 'VESTAS R. DOMINICANA',
      channel: 'Sem leitura automática',
      projects: 1,
      allocatedCount: 2,
      nextStart: '2026-10-05',
    },
  ],
}

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
    expect(result.tabs).toBe(6)
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

describe('Portais de Clientes tab (real browser)', () => {
  const portalsHtml = buildDashboardHtml(buildRecords(5), {
    complianceHistory: HISTORY,
    portals: PORTALS,
  })

  async function openPortals(width: number, height: number) {
    const page = await (browser as Browser).newPage({
      viewport: { width, height },
    })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.route(/^https?:/, route => route.abort())
    await page.setContent(portalsHtml, { waitUntil: 'load' })
    await page.waitForTimeout(300)
    await page.evaluate(() => (window as any).switchNav('portais'))
    await page.waitForTimeout(150)
    return { page, errors }
  }

  it('renders KPIs, projects ordered by urgency, the stale-platform notice and manual gaps', async ctx => {
    if (!browser) return ctx.skip()
    const { page, errors } = await openPortals(1440, 900)
    const r = await page.evaluate(() => ({
      active: document
        .getElementById('view-portais')
        ?.classList.contains('active'),
      kpis: document.querySelectorAll('#ptKpis .pt-kpi').length,
      firstKpi: document.querySelector('#ptKpis .pt-kpi-value')?.textContent,
      projects: [
        ...document.querySelectorAll('#ptProjects .pt-item strong'),
      ].map(e => e.textContent),
      notice: document.getElementById('ptNotice')?.textContent ?? '',
      platforms: document.querySelectorAll('#ptPlatforms .pt-plat').length,
      gaps: document.querySelectorAll('#ptGaps tbody tr').length,
      gapsText: document.getElementById('ptGaps')?.textContent ?? '',
      tabBadge: (document.getElementById('ptBadgeTab') as HTMLElement).style
        .display,
    }))
    await page.close()

    expect(errors).toEqual([])
    expect(r.active).toBe(true)
    expect(r.kpis).toBe(5)
    expect(r.firstKpi).toBe('3')
    expect(r.projects[0]).toBe('Parque Dom Inocêncio')
    expect(r.notice).toContain('GE Vernova (Surisoft)')
    expect(r.platforms).toBe(2)
    expect(r.gaps).toBe(2)
    // a start date already in the past is shown as running, not as an upcoming start
    expect(r.gapsText).toContain('em andamento desde 05/10/2026')
    expect(r.gapsText).toContain('12/11/2026')
    expect(r.gapsText).not.toContain('Próximo início')
    expect(r.tabBadge).not.toBe('none')
  }, 60_000)

  it('filters, shows the technicians of the selected project and escapes portal text', async ctx => {
    if (!browser) return ctx.skip()
    const { page, errors } = await openPortals(1440, 900)
    const r = await page.evaluate(() => {
      const w = window as any
      const names = () =>
        [...document.querySelectorAll('#ptCollabs .pt-item strong')].map(
          e => e.textContent
        )
      const first = names()
      w.portaisToggleBlocked()
      const onlyBlocked = document.querySelectorAll(
        '#ptProjects .pt-item'
      ).length
      w.portaisToggleBlocked()
      w.portaisSet('status', 'MANUAL')
      const manual = [
        ...document.querySelectorAll('#ptProjects .pt-item strong'),
      ].map(e => e.textContent)
      w.portaisSet('status', 'ALL')
      w.portaisSet('q', 'carla')
      const bySearch = [
        ...document.querySelectorAll('#ptProjects .pt-item strong'),
      ].map(e => e.textContent)
      return {
        first,
        onlyBlocked,
        manual,
        bySearch,
        xss: (window as any).__xss,
        injectedImgs: document.querySelectorAll('#view-portais img').length,
      }
    })
    await page.close()

    expect(errors).toEqual([])
    // blocked technicians come before the cleared one
    expect(r.first[r.first.length - 1]).toBe('ANA LIMA')
    expect(r.onlyBlocked).toBe(1)
    expect(r.manual).toEqual(['Parque Wayra II'])
    expect(r.bySearch).toEqual(['Complexo Folha Larga'])
    // portal-supplied text is shown as text, never executed
    expect(r.xss).toBeUndefined()
    expect(r.injectedImgs).toBe(0)
  }, 60_000)

  it('drawer shows the client reason and next step, links only to Drive, closes with Escape', async ctx => {
    if (!browser) return ctx.skip()
    const { page, errors } = await openPortals(1440, 900)
    const opened = await page.evaluate(() => {
      const w = window as any
      // technician 0 of project 0 is the one with the rejected document
      w.portaisOpenDrawer(0, 0)
      const drawer = document.getElementById('ptDrawer') as HTMLElement
      const body = document.getElementById('ptDrawerBody') as HTMLElement
      return {
        open: drawer.classList.contains('is-open'),
        links: [...body.querySelectorAll('a')].map(a => a.getAttribute('href')),
        text: body.textContent ?? '',
        title: document.getElementById('ptDrawerTitle')?.textContent,
      }
    })
    // let the 180 ms slide-in finish: hit-testing a drawer that is still off-screen proves nothing
    await page.waitForTimeout(400)
    const stacking = await page.evaluate(() => {
      const drawer = document.getElementById('ptDrawer') as HTMLElement
      // the top bar spans the whole width; the drawer must paint over it, not hide behind it
      const atTopBar = document.elementFromPoint(innerWidth - 40, 10)
      return { coversTopBar: !!atTopBar && drawer.contains(atTopBar) }
    })
    const closed = await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      const drawer = document.getElementById('ptDrawer') as HTMLElement
      return {
        closed: !drawer.classList.contains('is-open'),
        hidden: drawer.getAttribute('aria-hidden'),
      }
    })
    const r = { ...opened, ...stacking, ...closed }
    await page.close()

    expect(errors).toEqual([])
    expect(r.open).toBe(true)
    expect(r.coversTopBar).toBe(true)
    expect(r.text).toContain('Certificado ilegível')
    expect(r.text).toContain('Reenviar ao SGRE (TDoc)')
    expect(r.title).toBe(MALICIOUS)
    // the javascript: URL is dropped, only the Drive link survives
    expect(r.links).toEqual(['https://drive.google.com/drive/folders/abc'])
    expect(r.closed).toBe(true)
    expect(r.hidden).toBe('true')
  }, 60_000)

  it('mobile: no horizontal scroll with data and the drawer fits the viewport', async ctx => {
    if (!browser) return ctx.skip()
    const { page, errors } = await openPortals(390, 844)
    const r = await page.evaluate(() => {
      ;(window as any).portaisOpenDrawer(0, 0)
      const dr = (
        document.getElementById('ptDrawer') as HTMLElement
      ).getBoundingClientRect()
      const pills = [...document.querySelectorAll('.topbar .pill-opt')]
      const rects = pills.map(p => p.getBoundingClientRect())
      return {
        hScroll: document.documentElement.scrollWidth > innerWidth,
        drawerWidth: Math.round(dr.width),
        innerWidth,
        // with six tabs the bottom bar must stay a single row inside the viewport
        navRows: new Set(rects.map(x => Math.round(x.top))).size,
        navOverflow: rects.some(x => x.right > innerWidth + 1),
      }
    })
    await page.close()

    expect(errors).toEqual([])
    expect(r.navRows).toBe(1)
    expect(r.navOverflow).toBe(false)
    expect(r.hScroll).toBe(false)
    expect(r.drawerWidth).toBeLessThanOrEqual(r.innerWidth)
  }, 60_000)

  it('renders an empty state instead of failing when there is no portal data', async ctx => {
    if (!browser) return ctx.skip()
    const page = await (browser as Browser).newPage({
      viewport: { width: 1440, height: 900 },
    })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.route(/^https?:/, route => route.abort())
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => (window as any).switchNav('portais'))
    const text = await page.evaluate(
      () => document.getElementById('view-portais')?.textContent ?? ''
    )
    await page.close()

    expect(errors).toEqual([])
    expect(text).toContain('indisponíveis nesta geração')
  }, 60_000)
})
