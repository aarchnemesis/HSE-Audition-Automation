import { Frame, Page } from 'playwright'
import { PortalCensus } from '../../domain/models/PortalCensus.js'
import {
  EgestionaRawRow,
  buildEgestionaCensus,
} from './EgestionaCensusParser.js'

// Navigation for the eGestiona workforce grid. Confirmed flow (Gemini, Vestas Latam, 2026-10-26):
//   1. Top menu: Coordinación -> Trabajadores.
//   2. The list lives in a frame whose URL contains trabajadores_subcontratados/default.asp;
//      calling its global buscar() runs the search.
//   3. Results render in a frame named nm_resultados (URL contains busqueda_resultados). Each
//      worker is a <tr> with >=8 <td>; the last three cells hold the DPR/DPE/ACT status images.
//   4. Pagination is an input[value=">"] / a:has-text(">") in the results frame.
// Selectors are portal-specific and verified live per tenant; the parsing is EgestionaCensusParser.

const MAX_PAGES = 30
const STEP_TIMEOUT = 8000

async function findFrame(
  page: Page,
  match: (f: Frame) => boolean,
  label: string
): Promise<Frame> {
  const frame = page.frames().find(match)
  if (!frame) throw new Error(`eGestiona: frame "${label}" não encontrado`)
  return frame
}

async function extractRows(resultsFrame: Frame): Promise<EgestionaRawRow[]> {
  return resultsFrame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr')).filter(
      r => r.querySelectorAll('td').length >= 8
    )
    return rows.map(r => {
      const tds = Array.from(r.querySelectorAll('td'))
      const imgSrc = (i: number) =>
        (tds[tds.length - i]?.querySelector('img') as HTMLImageElement | null)
          ?.src ?? ''
      return {
        firstName: (tds[2]?.textContent ?? '').trim(),
        lastName: (tds[3]?.textContent ?? '').trim(),
        dni: (tds[4]?.textContent ?? '').trim(),
        empresa: (tds[5]?.textContent ?? '').trim(),
        dprImgSrc: imgSrc(3),
        dpeImgSrc: imgSrc(2),
        actImgSrc: imgSrc(1),
      }
    })
  })
}

/**
 * Drives an already-authenticated eGestiona page through the workforce grid and returns a
 * census. The page must be logged in (use the login harness first).
 */
export async function scrapeEgestionaCensus(
  page: Page,
  options: { portalId: string; capturedAt?: string }
): Promise<PortalCensus> {
  const capturedAt = options.capturedAt ?? new Date().toISOString()

  await page
    .locator('text="Coordinación"')
    .first()
    .click({ timeout: STEP_TIMEOUT })
  await page
    .locator('text="Trabajadores"')
    .first()
    .click({ timeout: STEP_TIMEOUT })

  const mainFrame = await findFrame(
    page,
    f => f.url().includes('trabajadores_subcontratados/default.asp'),
    'default.asp'
  )
  await mainFrame.evaluate(() => {
    const fn = (window as unknown as { buscar?: () => void }).buscar
    if (typeof fn === 'function') fn()
  })
  await page.waitForTimeout(STEP_TIMEOUT / 2)

  const resultsFrame = await findFrame(
    page,
    f =>
      f.name() === 'nm_resultados' || f.url().includes('busqueda_resultados'),
    'nm_resultados'
  )

  const allRows: EgestionaRawRow[] = []
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    for (const row of await extractRows(resultsFrame)) allRows.push(row)
    const next = resultsFrame
      .locator('input[value=">"], a:has-text(">")')
      .first()
    if (
      (await next.count()) === 0 ||
      !(await next.isEnabled().catch(() => false))
    )
      break
    await next.click({ timeout: STEP_TIMEOUT }).catch(() => {})
    await page.waitForTimeout(STEP_TIMEOUT / 2)
  }

  return buildEgestionaCensus(allRows, {
    portalId: options.portalId,
    capturedAt,
  })
}
