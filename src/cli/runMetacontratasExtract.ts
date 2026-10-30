import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import { scrapeMetacontratasCensus } from '../adapters/portais/MetacontratasScraper.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

async function main() {
  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION - EXTRAÇÃO METACONTRATAS (CPFL / IBITU / ENERGIMP)')
  console.log('================================================================================\n')

  const creds = await loadPortalCredentials()
  const cred =
    creds.find(
      c =>
        c.portalId === 'metacontratas' &&
        c.username.includes('darliane')
    ) ||
    findCredential(creds, { portalId: 'metacontratas' })

  if (!cred) {
    throw new Error('Nenhuma credencial encontrada na planilha para Metacontratas.')
  }

  console.log('[Metacontratas] Conectando com:', redactCredential(cred))

  const sessionPath = path.join(
    process.cwd(),
    'scratch',
    'portais',
    'sessions',
    'metacontratas-darliane.session.json'
  )

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  })

  const hasSession = fs.existsSync(sessionPath)
  const context = await browser.newContext({
    storageState: hasSession ? sessionPath : undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }
  })

  try {
    const page = await context.newPage()

    // 1. Verificar se sessão existente ainda está ativa
    let needsLogin = true
    if (hasSession) {
      console.log('[Metacontratas] Testando sessão persistida...')
      await page.goto('https://hub.metadata.net/app/accesos?plataformaInicio=Metacontratas', {
        waitUntil: 'commit',
        timeout: 20000
      }).catch(() => null)
      await page.waitForTimeout(4000)

      if (page.url().includes('accesos') && !page.url().includes('login')) {
        console.log('[Metacontratas] Sessão persistida válida! Pulando etapa de login.')
        needsLogin = false
      }
    }

    // 2. Se precisar de login, executar o formulário
    if (needsLogin) {
      console.log('[Metacontratas] Acessando hub.metadata.net para novo login...')
      await page.goto('https://hub.metadata.net/app/metalogin/accesos', {
        waitUntil: 'commit',
        timeout: 45000
      })
      console.log('[Metacontratas] Aguardando inicialização do formulário SPA...')
      await page.waitForSelector('input', { timeout: 45000 })

      console.log('[Metacontratas] Submetendo email...')
      const userInput = page.locator('input').first()
      await userInput.fill(cred.username)
      await page.click('button:has-text("Continuar"), button[type="submit"]')
      await page.waitForTimeout(2500)

      console.log('[Metacontratas] Submetendo senha...')
      const passInput = page.locator('input[type="password"]')
      await passInput.fill(cred.password)
      await page.click('button:has-text("Continuar"), button:has-text("Entrar")')

      console.log('[Metacontratas] Aguardando seleção de plataforma...')
      await page.waitForURL(/seleccion-plataforma|accesos/i, { timeout: 30000 })
      await page.waitForTimeout(4000)

      const metaBtn = page
        .locator(
          'button:has-text("Accede a Metacontratas"), button:has-text("Metacontratas")'
        )
        .first()
      if (await metaBtn.count()) {
        console.log('[Metacontratas] Selecionando Metacontratas...')
        await metaBtn.click()
        await page.waitForTimeout(4000)
      }
    }

    // 3. Extração dos contratos
    const census = await scrapeMetacontratasCensus(page, {
      portalId: 'metacontratas',
      log: msg => console.log(`[Metacontratas] ${msg}`)
    })

    if (census.workers.length === 0) {
      console.warn('[Metacontratas] Raspagem retornou 0 colaboradores. Censo existente preservado.')
      return
    }

    // Salvar censo oficial
    const out = savePortalCensus(census)
    console.log(`\n[Metacontratas] Sucesso! ${census.workers.length} colaboradores salvos em -> ${out}`)

    // Salvar estado da sessão para reuso
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    await context.storageState({ path: sessionPath })
    console.log(`[Metacontratas] Sessão autenticada persistida em: ${sessionPath}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('[Metacontratas] Falha na extração:', err instanceof Error ? err.message : err)
  process.exit(1)
})
