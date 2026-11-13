import 'dotenv/config'
import { chromium } from 'playwright'
import { scrapeDatalifeCensus } from '../adapters/portais/DatalifeScraper.js'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

async function main() {
  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION - EXTRAÇÃO DATALIFE (MULTI-CONTAS)')
  console.log('================================================================================\n')

  const creds = (await loadPortalCredentials()).filter(c => c.portalId === 'datalife')
  if (creds.length === 0) {
    throw new Error('Nenhuma credencial encontrada na planilha para Datalife.')
  }

  console.log(`[Datalife] ${creds.length} credencial(is) encontrada(s): ${creds.map(c => c.client).join(', ')}`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  })

  const allWorkers: any[] = []
  const seenKeys = new Set<string>()

  try {
    for (const cred of creds) {
      console.log(`\n[Datalife] Conectando (${cred.client}):`, redactCredential(cred))
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      })

      try {
        const page = await context.newPage()
        let token = ''
        page.on('response', async r => {
          if (r.url().includes('/user/loginWeb')) {
            const b = await r.json().catch(() => null)
            if (b?.token) token = b.token
          }
        })

        await page.goto(cred.url || 'https://appv3.datalife.global/#/login', {
          waitUntil: 'load',
          timeout: 45000,
        })
        await page.waitForSelector('#userEntry', { timeout: 30000 })
        await page.fill('#userEntry', cred.username)
        await page.fill('#passEntry', cred.password)

        const submitBtn = await page.$(
          'button[type="submit"], button:has-text("Entrar"), button:has-text("Login")'
        )
        if (submitBtn) await submitBtn.click()
        else await page.keyboard.press('Enter')

        await page.waitForTimeout(6000)

        const bodyText = await page.evaluate(() => document.body.innerText || '')
        if (page.url().includes('#/login') && /bloqueado|inativo|inv[aá]lid/i.test(bodyText)) {
          console.warn(`[Datalife] ⚠️ Conta ${cred.client} bloqueada/inativa no portal — pulando.`)
          continue
        }

        const partial = await scrapeDatalifeCensus(page, {
          portalId: 'datalife',
          token,
          clientLabel: cred.client,
          log: msg => console.log(`  ${msg}`),
        })

        for (const w of partial.workers as Array<typeof partial.workers[number] & { cpf?: string }>) {
          const key = `${w.cpf || w.name}|${w.client || ''}`
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            allWorkers.push(w)
          }
        }
      } catch (err: any) {
        console.error(`[Datalife] Erro na conta ${cred.client}:`, err.message)
      } finally {
        await context.close()
      }
    }

    const census = {
      portalId: 'datalife',
      portalName: 'Datalife (Neoenergia, Enel, GE Vernova)',
      system: 'Datalife',
      capturedAt: new Date().toISOString(),
      workers: allWorkers,
      summary: {
        totalWorkers: allWorkers.length,
        clearedWorkers: allWorkers.filter(w => w.cleared).length,
        blockedWorkers: allWorkers.filter(w => !w.cleared).length,
      },
    }

    console.log(
      `\nExtração Datalife finalizada: ${census.workers.length} colaboradores, ${allWorkers.reduce((s, w) => s + (w.documents?.length || 0), 0)} documentos.`
    )

    if (census.workers.length > 0) {
      savePortalCensus(census)
      console.log(`[Datalife] Censo salvo com sucesso em data/portais/datalife.census.json`)
    } else {
      console.warn('[Datalife] Raspagem retornou 0 colaboradores. Censo existente preservado.')
      process.exitCode = 1
    }
  } catch (err: any) {
    console.error('[Datalife] Erro fatal durante a extração:', err.message)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
