import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { scrapeDgtssCensus } from '../adapters/portais/DgtssScraper.js'
import { savePortalCensus } from '../adapters/portais/PortalCensusStore.js'
import {
  findCredential,
  loadPortalCredentials,
  redactCredential,
} from '../adapters/smartsheet/SmartsheetCredentialVault.js'

async function main() {
  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION - EXTRAÇÃO DGTSS (INVENERGY)')
  console.log('================================================================================\n')

  const creds = await loadPortalCredentials()
  const cred =
    creds.find(c => c.portalId === 'dgtss-invenergy') ||
    findCredential(creds, { portalId: 'dgtss-invenergy' })

  if (!cred || !cred.password) {
    throw new Error('Nenhuma credencial encontrada na planilha para DGTSS / Invenergy.')
  }

  console.log('[DGTSS] Conectando com:', redactCredential(cred))

  const sessionPath = path.join(
    process.cwd(),
    'scratch',
    'portais',
    'sessions',
    'dgtss-invenergy.session.json'
  )

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  })

  const hasSession = fs.existsSync(sessionPath)
  const context = await browser.newContext({
    storageState: hasSession ? sessionPath : undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }
  })

  try {
    const page = await context.newPage()

    // 1. Verificar se sessão existente ainda está ativa
    let needsLogin = true
    if (hasSession) {
      console.log('[DGTSS] Testando sessão persistida...')
      await page.goto('https://invenergy.dgtss.com.br/MPD/Module.aspx', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      }).catch(() => null)
      await page.waitForTimeout(2000)

      if (page.url().includes('Module.aspx') && !page.url().includes('login.aspx')) {
        console.log('[DGTSS] Sessão persistida válida! Pulando etapa de login.')
        needsLogin = false
      }
    }

    // 2. Se precisar de login, executar o formulário
    if (needsLogin) {
      console.log('[DGTSS] Acessando formulário de login...')
      await page.goto('https://invenergy.dgtss.com.br/lgn/login.aspx', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })

      console.log('[DGTSS] Preenchendo credenciais...')
      await page.fill('#txtUsername', cred.username)
      await page.fill('#txtPassword', cred.password)

      console.log('[DGTSS] Submetendo login...')
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
          console.log('[DGTSS] Aviso de navegação:', e.message)
        }),
        page.click('#btnLoginHtml')
      ])

      await page.waitForTimeout(3000)
      if (page.url().includes('login.aspx')) {
        throw new Error('Falha no login do DGTSS. Permaneceu na página de login.')
      }
      console.log('[DGTSS] Login realizado com sucesso. URL:', page.url())
    }

    // 3. Extração do Censo
    const census = await scrapeDgtssCensus(page, {
      portalId: 'dgtss-invenergy',
      log: msg => console.log(msg)
    })

    if (census.workers.length === 0) {
      console.warn('[DGTSS] Raspagem retornou 0 colaboradores. Censo existente preservado.')
      return
    }

    // Salvar censo oficial
    const out = savePortalCensus(census)
    console.log(`\n[DGTSS] Sucesso! ${census.workers.length} colaboradores salvos em -> ${out}`)

    // Salvar estado da sessão para reuso
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    await context.storageState({ path: sessionPath })
    console.log(`[DGTSS] Sessão autenticada persistida em: ${sessionPath}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('[DGTSS] Falha na extração:', err instanceof Error ? err.message : err)
  process.exit(1)
})
