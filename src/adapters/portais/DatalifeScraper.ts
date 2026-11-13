import { Page } from 'playwright'
import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../../domain/models/PortalCensus.js'

export interface DatalifeScrapeOptions {
  portalId?: string
  token?: string
  clientLabel?: string
  log?: (msg: string) => void
}

interface DatalifeWorkerRow {
  id: number
  name: string
  status: number
  plantsName?: string
  cpf?: string
  client?: string
  jobPosition?: string
  company?: string
  countDocuments?: number
  countPending?: number
  lastUpdateDate?: string
}

interface DatalifeRawDoc {
  id: number
  classification?: number
  initialDate?: string | null
  finalDate?: string | null
  file?: string | null
  status: number
  text?: string | null
  documentBase?: {
    id?: number
    name?: string
    expire?: boolean
    required?: boolean | null
  }
}

function cleanWorkerName(raw: string): string {
  if (!raw) return ''
  const clean =
    raw.split(/\b(Líder|Inspetor|Técnico|Tecnico|Engenheiro|Supervisor|Operador)\b/i)[0] || raw
  return clean.replace(/[-–|]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeClient(raw?: string, fallback?: string): string {
  const src = (raw || fallback || 'GE VERNOVA').trim()
  const upper = src.toUpperCase()
  if (upper.includes('EGP') || upper.includes('ENEL')) return 'ENEL'
  if (upper.includes('GE')) return 'GE VERNOVA'
  if (upper.includes('NEO')) return 'NEOENERGIA'
  return upper
}

function mapDocStatus(doc: DatalifeRawDoc): PortalDocStatus {
  switch (doc.status) {
    case 0:
    case 10:
      return 'APPROVED'
    case 1:
      return 'EXPIRED'
    case 2:
      return 'EXPIRING'
    case 3:
      return doc.text && doc.text.trim().length > 0 ? 'REJECTED' : 'EXPIRED'
    case 9:
      return 'WAIVED'
    default:
      return doc.file ? 'IN_REVIEW' : 'MISSING'
  }
}

function deduplicateAndMapDocs(rawDocs: DatalifeRawDoc[]): PortalDocument[] {
  const byBase = new Map<string, DatalifeRawDoc>()
  const rank = (d: DatalifeRawDoc): number => {
    // Prefer active/approved/waived (0, 10, 9) over superseded/expired (2, 1, 3)
    if (d.status === 0 || d.status === 10 || d.status === 9) return 3
    if (d.status === 2) return 2
    return 1
  }
  const dateKey = (d: DatalifeRawDoc): string =>
    (d.finalDate || d.initialDate || '').slice(0, 10)

  for (const doc of rawDocs) {
    const key = String(doc.documentBase?.id ?? doc.documentBase?.name ?? doc.id)
    const prev = byBase.get(key)
    if (!prev) {
      byBase.set(key, doc)
      continue
    }
    const rNew = rank(doc)
    const rPrev = rank(prev)
    if (
      rNew > rPrev ||
      (rNew === rPrev && dateKey(doc) > dateKey(prev)) ||
      (rNew === rPrev && dateKey(doc) === dateKey(prev) && doc.id > prev.id)
    ) {
      byBase.set(key, doc)
    }
  }

  return [...byBase.values()].map(doc => ({
    title: (doc.documentBase?.name || `Documento #${doc.id}`).trim(),
    status: mapDocStatus(doc),
    ...(doc.finalDate ? { expiresOn: doc.finalDate.slice(0, 10) } : {}),
    ...(doc.text && doc.text.trim() ? { note: doc.text.trim() } : {}),
    required: doc.documentBase?.required !== false,
  }))
}

export async function scrapeDatalifeCensus(
  page: Page,
  options: DatalifeScrapeOptions = {}
): Promise<PortalCensus & { portalName: string; system: string; summary: any }> {
  const log = options.log ?? console.log
  const portalId = options.portalId ?? 'datalife'
  const capturedAt = new Date().toISOString()
  const workers: Array<PortalWorker & Record<string, any>> = []

  let authToken = options.token || ''
  page.on('request', req => {
    const auth = req.headers()['authorization']
    if (auth && auth.startsWith('Bearer ')) {
      authToken = auth.slice('Bearer '.length)
    }
  })

  let firstPageJson: { count?: number; rows?: DatalifeWorkerRow[] } | null = null
  const capturePage = (j: { count?: number; rows?: DatalifeWorkerRow[] } | null) => {
    firstPageJson = j
  }
  page.on('response', async resp => {
    if (resp.url().includes('listForReportWorker')) {
      try {
        const ct = resp.headers()['content-type'] || ''
        if (ct.includes('application/json')) {
          capturePage(await resp.json())
        }
      } catch (_) {}
    }
  })

  log('[DatalifeScraper] Navegando para #/Workers/report...')
  await page.goto('https://appv3.datalife.global/#/Workers/report', {
    waitUntil: 'load',
    timeout: 35000,
  })

  await page
    .waitForResponse(
      resp => resp.url().includes('listForReportWorker') && resp.status() === 200,
      { timeout: 25000 }
    )
    .catch(() => null)
  await page.waitForTimeout(2000)

  const allRows: DatalifeWorkerRow[] = []

  if (authToken) {
    // Pagina diretamente pela API para obter 100% dos profissionais (limit=100)
    let skip = 0
    const limit = 100
    let totalCount = Infinity
    while (skip < totalCount) {
      const res = await page.evaluate(
        async ({ skip, limit, tok }) => {
          const r = await fetch(
            `https://appv3.datalife.global/workers/listForReportWorker?skip=${skip}&limit=${limit}&sortBy=name&sortOrder=ASC`,
            { headers: { Authorization: `Bearer ${tok}` } }
          )
          if (!r.ok) return { error: r.status }
          return r.json()
        },
        { skip, limit, tok: authToken }
      )
      if (res?.error || !Array.isArray(res?.rows) || res.rows.length === 0) break
      totalCount = typeof res.count === 'number' ? res.count : res.rows.length
      allRows.push(...res.rows)
      skip += res.rows.length
      if (res.rows.length < limit) break
    }
    log(`[DatalifeScraper] Paginação API concluída: ${allRows.length} profissionais (total=${totalCount}).`)
  } else {
    const fp = firstPageJson as { count?: number; rows?: DatalifeWorkerRow[] } | null
    if (fp?.rows?.length) {
      allRows.push(...fp.rows)
      log(`[DatalifeScraper] Fallback listener: ${allRows.length} linhas.`)
    }
  }

  // Busca os documentos de cada profissional em lotes de 5 via /workers/findById/:id
  const BATCH = 5
  for (let i = 0; i < allRows.length; i += BATCH) {
    const chunk = allRows.slice(i, i + BATCH)
    const details = authToken
      ? await page.evaluate(
          async ({ ids, tok }) => {
            return Promise.all(
              ids.map(async id => {
                try {
                  const r = await fetch(`https://appv3.datalife.global/workers/findById/${id}`, {
                    headers: { Authorization: `Bearer ${tok}` },
                  })
                  if (!r.ok) return null
                  const j = await r.json()
                  return j?.worker ?? null
                } catch {
                  return null
                }
              })
            )
          },
          { ids: chunk.map(c => c.id), tok: authToken }
        )
      : chunk.map(() => null)

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]
      const detail = details[j]
      const rawDocs: DatalifeRawDoc[] = Array.isArray(detail?.documents) ? detail.documents : []
      const documents = deduplicateAndMapDocs(rawDocs)
      const isCleared = row.status === 0 && (row.countPending ?? 0) === 0
      workers.push({
        name: cleanWorkerName(row.name),
        cpf: row.cpf?.trim(),
        status: isCleared ? 'CLEARED' : 'BLOCKED',
        cleared: isCleared,
        pendingCount: row.countPending ?? 0,
        totalDocuments: row.countDocuments ?? documents.length,
        plant: row.plantsName,
        role: row.jobPosition?.trim(),
        jobRole: row.jobPosition?.trim(),
        client: normalizeClient(row.client, options.clientLabel),
        documents,
      })
    }
  }

  log(`[DatalifeScraper] Total catalogado nesta conta: ${workers.length} profissionais.`)

  return {
    portalId,
    portalName: 'Datalife (Neoenergia, Enel, GE Vernova)',
    system: 'Datalife',
    capturedAt,
    workers,
    summary: {
      totalWorkers: workers.length,
      clearedWorkers: workers.filter(w => w.cleared).length,
      blockedWorkers: workers.filter(w => !w.cleared).length,
    },
  }
}
