import { Page } from 'playwright'
import { PortalCensus } from '../../domain/models/PortalCensus.js'
import { normalizeTdoc } from './LegacyCensusNormalizers.js'
import {
  TdocRawWorker,
  docFromCells,
  toTdocRawWorker,
  workerFromCells,
} from './TDocTableParser.js'

// Navigation for the TDoc (JSF) document manager, per tenant (WPLATAM/SGRE, Pegasus, Acciona
// Chile). Flow confirmed on WPLATAM (Gemini, 2026-10-26): select the company, list its tasks,
// enter each task's worker list, open each worker to read the document table, go back.
//
// JSF renders volatile client ids (j_id123, j_id242, ...) for the per-row action buttons. They
// drift between renders and versions, so they live in TDocSelectors and can be overridden on a
// live run without touching code. Parsing is TDocTableParser; this file is only navigation and
// degrades gracefully — a task or worker that fails is logged and skipped, not fatal.

export interface TDocSelectors {
  tasksUrl: string
  tasksBackUrl: string
  selectCompanyIcon: string
  tasksTableRows: string
  taskViewButton: (rowIndex: number) => string
  workersButton: string
  workersTableRows: string
  workerViewButton: (rowIndex: number) => string
  docsTableRows: string
  backIcon: string
}

function tenantBase(portalId: string): string {
  if (portalId === 'tdoc-pegasus') return 'https://pegasus.tdoc.es'
  if (portalId === 'tdoc-acciona-chile') return 'https://acciona-chile.tdoc.es'
  return 'https://wplatam.tdoc.es'
}

export function defaultTDocSelectors(portalId: string): TDocSelectors {
  const base = tenantBase(portalId)
  return {
    tasksUrl: `${base}/system/modules/model_4/companyManager/tasks/tasksGestion.jsf`,
    tasksBackUrl: `${base}/system/modules/model_4/companyManager/tasks/tasksCompany.jsf`,
    selectCompanyIcon: 'img[title="Seleccionar"]',
    tasksTableRows: '#tareas_list_form\\:tareasTable\\:tb tr',
    taskViewButton: i => `#tareas_list_form\\:tareasTable\\:${i}\\:j_id123`,
    workersButton:
      'input[value="Ver lista de funcionários"], #j_id239\\:j_id244',
    workersTableRows:
      '#form_workers_list_table\\:Table_TrabajadoresDoc\\:tb tr',
    workerViewButton: i =>
      `#form_workers_list_table\\:Table_TrabajadoresDoc\\:${i}\\:j_id242`,
    docsTableRows: '#form_item_list_table\\:Table_Deliveries\\:tb tr',
    backIcon: 'img[title="Voltar"]',
  }
}

const STEP_TIMEOUT = 30000

async function readRows(page: Page, selector: string): Promise<string[][]> {
  return page.evaluate(sel => {
    const trs = Array.from(document.querySelectorAll(sel))
    return trs.map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td =>
        (td.textContent ?? '').replace(/\s+/g, ' ').trim()
      )
    )
  }, selector)
}

interface TaskRow {
  index: number
  proprietario: string
}

export function parseTaskRows(rows: string[][]): TaskRow[] {
  const tasks: TaskRow[] = []
  rows.forEach((cells, index) => {
    const id = (cells[1] ?? '').trim()
    if (!id || /^id$/i.test(id)) return
    tasks.push({ index, proprietario: (cells[8] ?? '').trim() })
  })
  return tasks
}

/**
 * Drives an already-authenticated TDoc page through every task and returns a census. `maxTasks`
 * caps the crawl for a quick run. The page must be logged in (use the login harness first).
 */
export async function scrapeTdocCensus(
  page: Page,
  options: {
    portalId: string
    capturedAt?: string
    selectors?: TDocSelectors
    maxTasks?: number
    log?: (msg: string) => void
  }
): Promise<PortalCensus> {
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const sel = options.selectors ?? defaultTDocSelectors(options.portalId)
  const log = options.log ?? (() => {})

  await page.goto(sel.tasksUrl, {
    waitUntil: 'networkidle',
    timeout: STEP_TIMEOUT,
  })
  await page
    .locator(sel.selectCompanyIcon)
    .first()
    .click({ timeout: STEP_TIMEOUT })
  await page.waitForTimeout(2500)

  const tasks = parseTaskRows(await readRows(page, sel.tasksTableRows))
  log(`${tasks.length} tarefas encontradas`)
  const capped = options.maxTasks ? tasks.slice(0, options.maxTasks) : tasks

  const rawWorkers: TdocRawWorker[] = []
  for (const task of capped) {
    try {
      await page
        .locator(sel.taskViewButton(task.index))
        .click({ timeout: STEP_TIMEOUT })
      await page.waitForTimeout(2000)

      const workersBtn = page.locator(sel.workersButton).first()
      if (!(await workersBtn.isVisible().catch(() => false))) continue
      await workersBtn.click({ timeout: STEP_TIMEOUT })
      await page.waitForTimeout(2000)

      const workerRows = (await readRows(page, sel.workersTableRows))
        .map((cells, idx) => ({ worker: workerFromCells(cells), idx }))
        .filter(
          (w): w is { worker: NonNullable<typeof w.worker>; idx: number } =>
            w.worker !== null
        )
      log(`tarefa ${task.index}: ${workerRows.length} colaboradores`)

      for (const { worker, idx } of workerRows) {
        try {
          await page
            .locator(sel.workerViewButton(idx))
            .click({ timeout: STEP_TIMEOUT })
          await page.waitForTimeout(2000)
          const docs = (await readRows(page, sel.docsTableRows))
            .map(docFromCells)
            .filter((d): d is NonNullable<typeof d> => d !== null)
          rawWorkers.push(toTdocRawWorker(worker, docs, task.proprietario))
          const back = page.locator(sel.backIcon).first()
          if (await back.isVisible().catch(() => false))
            await back.click({ timeout: STEP_TIMEOUT }).catch(() => {})
          else await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
          await page.waitForTimeout(1500)
        } catch (err) {
          log(`colaborador ${idx} falhou: ${(err as Error).message}`)
        }
      }
    } catch (err) {
      log(`tarefa ${task.index} falhou: ${(err as Error).message}`)
    }
    await page
      .goto(sel.tasksBackUrl, {
        waitUntil: 'networkidle',
        timeout: STEP_TIMEOUT,
      })
      .catch(() => {})
  }

  return {
    portalId: options.portalId,
    capturedAt,
    workers: normalizeTdoc(rawWorkers, capturedAt),
  }
}
