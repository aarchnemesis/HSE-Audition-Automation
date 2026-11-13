import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import { scrapeMetacontratasCensus } from '../adapters/portais/MetacontratasScraper.js'
import {
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

async function main() {
  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION - EXTRAÇÃO METACONTRATAS (CPFL / IBITU / ENERGIMP)')
  console.log('================================================================================\n')

  const creds = (await loadPortalCredentials()).filter(c => c.portalId === 'metacontratas')
  if (creds.length === 0) {
    throw new Error('Nenhuma credencial encontrada na planilha para Metacontratas.')
  }

  console.log(`[Metacontratas] ${creds.length} credencial(is) encontrada(s): ${creds.map(c => c.client).join(', ')}`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  })

  const allWorkers: any[] = []
  const seenWorkers = new Set<string>()

  try {
    for (const cred of creds) {
      const slug = cred.username.split('@')[0].replace(/[^a-z0-9]/gi, '_').toLowerCase()
      const sessionPath = path.join(
        process.cwd(),
        'scratch',
        'portais',
        'sessions',
        `metacontratas-${slug}.session.json`
      )
      console.log(`\n[Metacontratas] Conectando (${cred.client}):`, redactCredential(cred))
      const hasSession = fs.existsSync(sessionPath)
      const context = await browser.newContext({
        storageState: hasSession ? sessionPath : undefined,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 }
      })

      try {
        const page = await context.newPage()

        let needsLogin = true
        if (hasSession) {
          console.log('[Metacontratas] Testando sessão persistida...')
          await page.goto('https://hub.metadata.net/app/accesos?plataformaInicio=Metacontratas', {
            waitUntil: 'commit',
            timeout: 20000
          }).catch(() => null)
          await page.waitForTimeout(4000)

          const cardsShown = await page
            .waitForSelector('button:has-text("IBITU"), button:has-text("ENERGIMP"), button:has-text("CPFL"), button:has-text("REPSOL")', { timeout: 15000 })
            .then(() => true)
            .catch(() => false)
          if (cardsShown) {
            console.log('[Metacontratas] Sessão persistida válida! Pulando etapa de login.')
            needsLogin = false
          }
        }

        if (needsLogin) {
          console.log('[Metacontratas] Acessando hub.metadata.net para novo login...')
          await page.goto('https://hub.metadata.net/app/metalogin/accesos', {
            waitUntil: 'commit',
            timeout: 45000
          })
          await page.waitForSelector('input', { timeout: 45000 })

          const userInput = page.locator('input').first()
          await userInput.fill(cred.username)
          await page.click('button:has-text("Continuar"), button[type="submit"]')
          await page.waitForTimeout(2500)

          const passInput = page.locator('input[type="password"]')
          await passInput.fill(cred.password)
          await page.click('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Entrar"), button[type="submit"]')

          const loggedIn = await page
            .waitForURL(url => !url.pathname.includes('metalogin'), { timeout: 30000 })
            .then(() => true)
            .catch(() => false)
          await page.waitForTimeout(4000)

          const bodyTxt = await page.evaluate(() => document.body.innerText || '')
          if (!loggedIn || /expirad|caducad|incorrect|inv[aá]lid|bloquead/i.test(bodyTxt)) {
            console.warn(`[Metacontratas] ⚠️ Falha/senha expirada na conta ${cred.client} (${redactCredential(cred).username}) — pulando.`)
            continue
          }

          const metaBtn = page
            .locator('button:has-text("Accede a Metacontratas"), button:has-text("Metacontratas")')
            .first()
          if (await metaBtn.count()) {
            await metaBtn.click()
            await page.waitForTimeout(4000)
          }
        }

        const partial = await scrapeMetacontratasCensus(page, {
          portalId: 'metacontratas',
          log: msg => console.log(`[Metacontratas] ${msg}`)
        })

        for (const w of partial.workers) {
          const k = `${w.name}|${w.contract || ''}`
          if (!seenWorkers.has(k)) {
            seenWorkers.add(k)
            allWorkers.push(w)
          }
        }

        fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
        await context.storageState({ path: sessionPath })
      } catch (err: any) {
        console.warn(`[Metacontratas] Erro na conta ${cred.client}: ${err.message}`)
      } finally {
        await context.close()
      }
    }

    if (allWorkers.length === 0) {
      console.warn('[Metacontratas] Raspagem retornou 0 colaboradores. Censo existente preservado.')
      return
    }

    const out = savePortalCensus({
      portalId: 'metacontratas',
      capturedAt: new Date().toISOString(),
      workers: allWorkers,
    })
    console.log(`\n[Metacontratas] Sucesso! ${allWorkers.length} colaboradores salvos em -> ${out}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('[Metacontratas] Falha na extração:', err instanceof Error ? err.message : err)
  process.exit(1)
})
