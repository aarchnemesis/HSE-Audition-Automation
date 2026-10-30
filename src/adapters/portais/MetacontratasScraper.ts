import { Page } from 'playwright'
import { PortalCensus, PortalWorker } from '../../domain/models/PortalCensus.js'

export interface MetacontratasScrapeOptions {
  portalId?: string
  log?: (msg: string) => void
}

export const METACONTRATAS_TARGETS = [
  { match: 'IBITU', client: 'IBITU ENERGIA S.A' },
  { match: 'CE', client: 'ENERGIMP (CE)' },
  { match: 'SC', client: 'ENERGIMP (SC)' },
  { match: 'REPSOL', client: 'REPSOL CHILE' }
]

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

  for (const target of METACONTRATAS_TARGETS) {
    log(`\n--- Extraindo contrato: ${target.client} (filtro: "${target.match}") ---`)

    try {
      // Garantir que estamos na tela com os cards de contrato
      await hubPage.goto('https://hub.metadata.net/app/accesos?plataformaInicio=Metacontratas', {
        waitUntil: 'commit',
        timeout: 25000
      })
      await hubPage.waitForSelector('button:has-text("IBITU"), button:has-text("ENERGIMP")', { timeout: 20000 })
      await hubPage.waitForTimeout(2000)

      const btn = hubPage.locator(`button:has-text("${target.match}")`).first()
      if (!(await btn.count())) {
        log(`Botão com termo "${target.match}" não localizado. Pulando.`)
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

      const extracted = await workPage.evaluate((clientName: string) => {
        const rows = Array.from(document.querySelectorAll('table tr'))
        const list: any[] = []

        for (const r of rows) {
          const cells = Array.from(r.querySelectorAll('td')).map(td => td.innerText ? td.innerText.trim().replace(/\s+/g, ' ') : '')
          if (cells.length < 8) continue

          const cpfMatch = cells.find(c => /^\d{11}$/.test(c.replace(/\D/g, '')))
          if (!cpfMatch) continue

          const cpf = cpfMatch.replace(/\D/g, '')
          const nome = cells[2] || ''
          const sobrenome = cells[3] || ''
          const fullName = `${nome} ${sobrenome}`.trim()
          const funcao = cells[4] || ''
          const necss = parseInt(cells[6] || '0', 10) || 0
          const ok = parseInt(cells[7] || '0', 10) || 0
          const pend = parseInt(cells[8] || '0', 10) || 0
          const venc = parseInt(cells[9] || '0', 10) || 0
          const status = cells[10] || ''
          const situacao = cells[11] || ''

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
        return list
      }, target.client)

      log(`Encontrados ${extracted.length} colaboradores para ${target.client}`)

      for (const w of extracted) {
        const isApproved = w.situation.toLowerCase() === 'ok' || (w.approved === w.totalRequired && w.totalRequired > 0)
        workers.push({
          name: w.name,
          role: w.role,
          contract: w.client,
          documents: [
            {
              title: 'Conformidade Geral Metacontratas',
              status: isApproved ? 'APPROVED' : 'PENDING',
              required: true
            }
          ]
        })
      }

      if (popup && !popup.isClosed()) {
        await popup.close().catch(() => null)
      }
    } catch (err: any) {
      log(`Erro durante extração de ${target.client}: ${err.message}`)
    }
  }

  log(`\nExtração Metacontratas finalizada com ${workers.length} colaboradores catalogados.`)
  return {
    portalId,
    capturedAt,
    workers
  }
}
