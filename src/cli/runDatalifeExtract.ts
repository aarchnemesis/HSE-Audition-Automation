import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { scrapeDatalifeCensus } from '../adapters/portais/DatalifeScraper.js'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

async function main() {
  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION - EXTRAÇÃO DATALIFE (GE VERNOVA)')
  console.log('================================================================================\n')

  const creds = await loadPortalCredentials()
  const cred =
    creds.find(
      c =>
        c.portalId === 'datalife' &&
        (c.client.toUpperCase().includes('GE') || c.username.includes('darliane'))
    ) || findCredential(creds, { portalId: 'datalife' })

  if (!cred) {
    throw new Error('Nenhuma credencial encontrada na planilha para Datalife.')
  }

  console.log('[Datalife] Conectando com:', redactCredential(cred))

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  })

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  try {
    const page = await context.newPage()

    console.log('[Datalife] Executando login...')
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

    await page.waitForTimeout(7000)

    // Extrair censo diretamente com a página já logada
    const census = await scrapeDatalifeCensus(page, {
      portalId: 'datalife',
      log: msg => console.log(msg),
    })

    console.log(
      `\nExtração Datalife finalizada com ${census.workers.length} colaboradores catalogados.`
    )

    if (census.workers.length > 0) {
      savePortalCensus(census)
      console.log(
        `[Datalife] Censo salvo com sucesso em data/portais/${census.portalId}.census.json`
      )
    } else {
      console.warn('[Datalife] Raspagem retornou 0 colaboradores. Censo existente preservado.')
    }
  } catch (err: any) {
    console.error('[Datalife] Erro fatal durante a extração:', err.message)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
