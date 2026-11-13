import { Frame, Page } from 'playwright'
import { PortalCensus, PortalDocStatus, PortalDocument, PortalWorker } from '../../domain/models/PortalCensus.js'

// eGestiona (AFJ, Vestas Latam), layout de 2026-11 confirmado ao vivo e no vídeo do Marcelo (13/11):
//   1. Depois do login, a tela de ícones fica no frame nm_contenido (estado_resumen/Pantalla_Iconos.asp).
//   2. "Buscador Documental Coordinación" abre a Coordinación General: uma barra de abas
//      (Resumen, Pendientes Autorizar, Pendientes, Vigentes, Históricos) e um iframe por aba,
//      f{Apartado_ID} -> Estado_Resumen/Coordinacion_Centros_Zonas/buscador.asp?Apartado_ID=N.
//   3. Em cada aba, "Buscar" lista os documentos (todos os centros de trabalho), 15 por página;
//      a paginação é um <select> com opções "1/9", "2/9"...
//   4. Cada linha: CA, Inicio, Fin, Rango, Tipo Documento, Elemento, Empresa, Centro trabajo,
//      Estado, Origen... Origen "Trabajador Ajeno (en CT)" = documento de pessoa; o resto é da
//      empresa ou de equipamento e fica fora do censo de colaboradores.

const STEP = 8000
const MAX_PAGES = 400
const HOME = '/extranet_subcontratas/default_contenido.asp'
/** Abas lidas: Pendientes (o que falta enviar / está em análise) e Vigentes (aprovados, com validade). */
const TABS = [
  { id: 3, label: 'Pendientes' },
  { id: 4, label: 'Vigentes' },
]

export interface EgestionaDocRow {
  tab: string
  inicio: string
  fin: string
  tipo: string
  elemento: string
  empresa: string
  centro: string
  estado: string
  origen: string
}

const brDate = (s: string) => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

export function mapEgestionaStatus(tab: string, estado: string): PortalDocStatus {
  const e = estado.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/rechaz/.test(e)) return 'REJECTED'
  if (/no aplica|exent|dispens/.test(e)) return 'WAIVED'
  if (/caduc|vencid/.test(e)) return 'EXPIRED'
  if (/pendiente enviar|no enviado|sin enviar/.test(e)) return 'MISSING'
  if (/pendiente|recibid|revis|valid/.test(e) && tab === 'Pendientes') return 'IN_REVIEW'
  return tab === 'Vigentes' ? 'APPROVED' : 'IN_REVIEW'
}

/** "FIGUEROA CIFUENTES, ARIEL (12.345.678-9)" -> "ARIEL FIGUEROA CIFUENTES" */
export function egestionaPersonName(elemento: string): string {
  const base = elemento.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
  const [last, first] = base.split(',').map(s => s.trim())
  return first ? `${first} ${last}` : base
}

export function buildEgestionaDocCensus(rows: EgestionaDocRow[], portalId: string, capturedAt: string): PortalCensus {
  const byWorker = new Map<string, PortalWorker>()
  for (const r of rows) {
    if (!/trabajador/i.test(r.origen)) continue
    const name = egestionaPersonName(r.elemento)
    if (!name) continue
    const w = byWorker.get(name) ?? { name, contract: r.centro, documents: [] as PortalDocument[] }
    if (r.centro && w.contract && !w.contract.split(' | ').includes(r.centro)) w.contract += ` | ${r.centro}`
    w.documents.push({
      title: r.tipo.replace(/\s+/g, ' ').trim(),
      status: mapEgestionaStatus(r.tab, r.estado),
      expiresOn: brDate(r.fin),
      note: [r.estado, r.centro].filter(Boolean).join(' · '),
      required: true,
    })
    byWorker.set(name, w)
  }
  // O mesmo requisito pode vir em Pendientes e Vigentes (renovação em curso): o vigente vale.
  for (const w of byWorker.values()) {
    const seen = new Map<string, PortalDocument>()
    for (const d of w.documents) {
      const k = d.title.toUpperCase()
      const prev = seen.get(k)
      if (!prev || (prev.status !== 'APPROVED' && d.status === 'APPROVED')) seen.set(k, d)
    }
    w.documents = [...seen.values()]
  }
  return { portalId, capturedAt, workers: [...byWorker.values()] }
}

async function readPage(frame: Frame, tab: string): Promise<EgestionaDocRow[]> {
  // tsx/esbuild injeta __name() nas arrow functions nomeadas; a página não tem esse helper.
  await frame.evaluate('window.__name = window.__name || (f => f)').catch(() => null)
  return frame.evaluate(tabName => {
    const vis = (td: Element) => (td as HTMLElement).style.display !== 'none'
    const cells = (tr: Element) => Array.from(tr.querySelectorAll(':scope > td')).filter(vis).map(td => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
    const rows = Array.from(document.querySelectorAll('tr'))
    const header = rows.map(cells).find(c => c.includes('Tipo Documento') && c.includes('Elemento'))
    const idx = (n: string) => header?.indexOf(n) ?? -1
    const iTipo = idx('Tipo Documento'), iElem = idx('Elemento')
    if (iTipo < 0 || iElem < 0) return []
    const at = (c: string[], n: string) => (idx(n) >= 0 ? c[idx(n)] ?? '' : '')
    return rows.map(cells).filter(c => c.length >= iElem + 3 && c[iTipo] && c !== header && c[iTipo] !== 'Tipo Documento').map(c => ({
      tab: tabName, inicio: at(c, 'Inicio'), fin: at(c, 'Fin'), tipo: c[iTipo], elemento: c[iElem],
      empresa: at(c, 'Empresa'), centro: at(c, 'Centro trabajo'), estado: at(c, 'Estado'), origen: at(c, 'Origen'),
    }))
  }, tab)
}

/**
 * Lê Pendientes e Vigentes do Buscador Documental de uma sessão eGestiona já autenticada
 * (use o harness de login antes) e devolve o censo por colaborador com os documentos.
 */
export async function scrapeEgestionaCensus(
  page: Page,
  options: { portalId: string; capturedAt?: string; log?: (m: string) => void }
): Promise<PortalCensus> {
  const log = options.log ?? (() => {})
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const origin = new URL(page.url()).origin
  const all: EgestionaDocRow[] = []
  const failedTabs: string[] = []

  // Abre a Coordinación General uma vez; as abas são trocadas dentro dela (voltar à tela inicial
  // depois de uma aba longa estoura o tempo nas contas com muitos registros).
  await page.goto(origin + HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(STEP / 2)
  const icons = page.frame({ name: 'nm_contenido' })
  if (!icons) throw new Error('eGestiona: tela de ícones (nm_contenido) não encontrada')
  await icons.locator('text="Buscador Documental Coordinación"').first().click({ timeout: STEP * 2 })
  await page.waitForTimeout(STEP)

  for (const tab of TABS) {
    // aba: clica na barra; o iframe f{id} carrega o buscador daquela aba
    await page.frame({ name: 'nm_contenido' })?.locator(`text="${tab.label}"`).first().click({ timeout: STEP }).catch(() => {})
    await page.waitForTimeout(STEP / 2)
    const frame = page.frame({ name: `f${tab.id}` })
    // Em contas com muitos registros a aba às vezes não carrega no clique: abre o buscador dela direto.
    if (frame && !/buscador\.asp/i.test(frame.url())) {
      await frame
        .goto(`${origin}/extranet_subcontratas/Estado_Resumen/Coordinacion_Centros_Zonas/buscador.asp?Pantalla_Iconos=0&Apartado_ID=${tab.id}&Filtro_ID=-1&Aplicar_Filtro=-1`, { waitUntil: 'domcontentloaded' })
        .catch(() => null)
      await page.waitForTimeout(STEP / 2)
    }
    if (!frame || !/buscador\.asp/i.test(frame.url())) {
      log(`aba ${tab.label}: buscador não carregou (${frame?.url() ?? 'sem frame'})`)
      continue
    }
    // Contas com muitos registros montam o filtro devagar; uma aba que falha não derruba as outras.
    const ok = await frame.locator('text=Buscar').first().click({ timeout: STEP * 6 }).then(() => true, e => {
      log(`aba ${tab.label}: Buscar não respondeu (${e instanceof Error ? e.message.split('\n')[0] : e})`)
      return false
    })
    if (!ok) { failedTabs.push(tab.label); continue }
    await page.waitForTimeout(STEP * 1.5)
    const total = await frame.evaluate(() => (document.body.innerText.match(/(\d+)\s+Registros/) || [])[1] ?? '?')
    const pager = frame.locator('select').filter({ has: frame.locator('option', { hasText: /^\d+\/\d+$/ }) }).first()
    const pages = (await pager.count()) ? await pager.locator('option').count() : 1
    log(`aba ${tab.label}: ${total} registros em ${pages} página(s)`)
    for (let n = 1; n <= Math.min(pages, MAX_PAGES); n++) {
      if (n > 1) {
        await pager.selectOption(String(n))
        await page.waitForTimeout(STEP / 2)
      }
      const rows = await readPage(frame, tab.label)
      all.push(...rows)
    }
  }
  // Sem a aba Vigentes todo documento pareceria pendente: censo parcial não vale.
  if (failedTabs.length) throw new Error(`abas não lidas: ${failedTabs.join(', ')}`)
  const census = buildEgestionaDocCensus(all, options.portalId, capturedAt)
  log(`${all.length} linhas lidas; ${all.filter(r => /trabajador/i.test(r.origen)).length} de colaboradores; ${census.workers.length} colaboradores`)
  return census
}
