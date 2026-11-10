import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { Page } from 'playwright'
import { PortalCensus } from '../../domain/models/PortalCensus.js'
import { normalizeTdoc } from './LegacyCensusNormalizers.js'
import { TdocDocEntry, TdocRawWorker } from './TDocTableParser.js'

export interface TDocSelectors {
  tasksUrl: string
  tasksBackUrl: string
  selectCompanyIcon: string
  tasksTableRows: string
  workersButton: string
  workersTableRows: string
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
    workersButton: 'input[value="Ver lista de funcionários"]',
    workersTableRows: '#form_workers_list_table\\:Table_TrabajadoresDoc\\:tb tr',
    docsTableRows: '#form_item_list_table\\:Table_Deliveries\\:tb tr',
    backIcon: 'img[title="Voltar"], img[title="Volver"]',
  }
}

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

  await page.goto(sel.tasksUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  const icon = page.locator(sel.selectCompanyIcon).first()
  if (await icon.isVisible().catch(() => false)) {
    await icon.click({ timeout: 20000 })
    await page.waitForTimeout(3000)
  }

  const taskCount = await page.locator(sel.tasksTableRows).count()
  log(`Tarefas encontradas na tabela: ${taskCount}`)

  const tasksInfo: { index: number; name: string }[] = []
  for (let i = 0; i < taskCount; i++) {
    const rowText = await page.locator(sel.tasksTableRows).nth(i).innerText().catch(() => '')
    const parts = rowText.split('\t').map(s => s.trim()).filter(Boolean)
    const parque = parts[7] || parts[6] || parts[1] || `Tarefa_${i}`
    tasksInfo.push({ index: i, name: parque })
  }

  const cappedTasks = options.maxTasks ? tasksInfo.slice(0, options.maxTasks) : tasksInfo
  const rawWorkersMap = new Map<string, TdocRawWorker>()

  for (const t of cappedTasks) {
    try {
      log(`Processando Tarefa ${t.index}: ${t.name}...`)
      const taskLink = page.locator(`${sel.tasksTableRows}:nth-child(${t.index + 1}) a`).first()
      await taskLink.click({ timeout: 20000 })
      await page.waitForTimeout(3000)

      const workersBtn = page.locator(sel.workersButton).first()
      if (!(await workersBtn.isVisible().catch(() => false))) {
        log(`Botão colaboradores não visível na tarefa ${t.index}`)
        const back = page.locator(sel.backIcon).first()
        if (await back.isVisible().catch(() => false)) await back.click().catch(() => {})
        continue
      }
      await workersBtn.click({ timeout: 20000 })
      await page.waitForTimeout(3000)

      const workerCount = await page.locator(sel.workersTableRows).count()
      log(`Tarefa ${t.index} (${t.name}): ${workerCount} colaboradores`)

      for (let wIdx = 0; wIdx < workerCount; wIdx++) {
        try {
          const rowData = await page.evaluate(idx => {
            const tr = document.querySelectorAll('#form_workers_list_table\\:Table_TrabajadoresDoc\\:tb tr')[idx]
            if (!tr) return null
            const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim())
            return {
              sobrenome1: cells[1] || '',
              sobrenome2: cells[2] || '',
              nome: cells[3] || '',
              cpf: cells[4] || '',
              cargo: cells[5] || ''
            }
          }, wIdx)

          if (!rowData) continue
          const fullName = `${rowData.nome} ${rowData.sobrenome1} ${rowData.sobrenome2}`.replace(/\s+/g, ' ').trim()
          if (!fullName || fullName.length < 3 || /nombre|nome/i.test(fullName)) continue

          const workerLink = page.locator(`${sel.workersTableRows}:nth-child(${wIdx + 1}) a`).first()
          await workerLink.click({ timeout: 15000 })
          await page.waitForTimeout(2500)

          const docCells = await page.evaluate(s => {
            const trs = Array.from(document.querySelectorAll(s))
            return trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim()))
          }, sel.docsTableRows)

          const docsList: TdocDocEntry[] = []
          for (const d of docCells) {
            const docName = (d[1] || '').trim()
            const docStatus = (d[2] || '').trim()
            if (docName && !/^documento$/i.test(docName)) {
              docsList.push({
                documento: docName,
                status: docStatus
              })
            }
          }

          if (!rawWorkersMap.has(fullName)) {
            rawWorkersMap.set(fullName, {
              nome: fullName,
              cpf: rowData.cpf || undefined,
              funcao: rowData.cargo || undefined,
              proprietario: t.name,
              pendencias: docsList
            })
          } else {
            const existWorker = rawWorkersMap.get(fullName)!
            for (const doc of docsList) {
              if (!existWorker.pendencias.some(pd => pd.documento === doc.documento)) {
                existWorker.pendencias.push(doc)
              }
            }
          }

          // Volta do trabalhador para a lista de colaboradores
          const backFromWorker = page.locator(sel.backIcon).first()
          if (await backFromWorker.isVisible().catch(() => false)) {
            await backFromWorker.click({ timeout: 15000 })
            await page.waitForTimeout(2000)
          }
        } catch (errColab: any) {
          log(`Falha no colaborador [${wIdx}]: ${errColab.message}`)
          const backErr = page.locator(sel.backIcon).first()
          if (await backErr.isVisible().catch(() => false)) {
            await backErr.click().catch(() => {})
            await page.waitForTimeout(2000)
          }
        }
      }

      // Volta da lista de colaboradores para a tarefa
      const backFromWorkers = page.locator(sel.backIcon).first()
      if (await backFromWorkers.isVisible().catch(() => false)) {
        await backFromWorkers.click({ timeout: 15000 })
        await page.waitForTimeout(2000)
      }

      // Volta da tarefa para a lista de tarefas
      const backToTasks = page.locator(sel.backIcon).first()
      if (await backToTasks.isVisible().catch(() => false)) {
        await backToTasks.click({ timeout: 15000 })
        await page.waitForTimeout(3000)
      }
    } catch (e: any) {
      log(`Erro na tarefa ${t.index}: ${e.message}`)
      await page.goto(sel.tasksUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
      const selIcon = page.locator(sel.selectCompanyIcon).first()
      if (await selIcon.isVisible().catch(() => false)) {
        await selIcon.click({ timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(3000)
      }
    }
  }

  const rawWorkersList = Array.from(rawWorkersMap.values())
  const normalizedWorkers = normalizeTdoc(rawWorkersList, capturedAt)
  log(`Censo TDoc finalizado: ${normalizedWorkers.length} colaboradores, ${normalizedWorkers.reduce((acc, w) => acc + w.documents.length, 0)} documentos.`)

  return {
    portalId: options.portalId,
    capturedAt,
    workers: normalizedWorkers,
  }
}
