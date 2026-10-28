import fs from 'fs'
import path from 'path'
import { Browser, BrowserContext, Page, chromium } from 'playwright'
import { PortalCredential } from '../smartsheet/SmartsheetCredentialVault.js'

// One configurable login flow for the Tier-3 portals: a plain username/password form with no
// captcha and no second factor. The mechanism lives here; each portal contributes only its
// selectors (PORTAL_LOGIN_CONFIGS). Portals behind reCAPTCHA (Atlas, Greenlegis, Obrasoft,
// ContractWeb, WeHandle) or a real second factor (Adapts Pro, WINDA) are intentionally absent:
// those need a human-renewed session (storageState), not this form filler.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type FieldSource = 'username' | 'password' | 'clientCode'

export interface LoginField {
  selector: string
  /** Pull the value from the credential, or use a literal (e.g. a language code). */
  from: FieldSource | { literal: string }
}

export interface PortalLoginConfig {
  portalId: string
  system: string
  /** Login URL; falls back to the credential's own URL when omitted. */
  url?: string
  fields: LoginField[]
  submitSelector: string
  /** Login is confirmed when the URL matches this and/or the selector appears. */
  successUrlPattern?: RegExp
  successSelector?: string
  /** Best-effort clicks before filling (cookie/consent banners). Failures are ignored. */
  dismissSelectors?: string[]
  /** `confirmed` = selectors verified on the live portal; `derived` = from field-name evidence. */
  confidence: 'confirmed' | 'derived'
}

/** Structural subset of Playwright's Page used by applyLogin — lets tests pass a fake. */
export interface LoginPage {
  goto(url: string, options?: unknown): Promise<unknown>
  fill(selector: string, value: string, options?: unknown): Promise<void>
  click(selector: string, options?: unknown): Promise<void>
  waitForSelector(selector: string, options?: unknown): Promise<unknown>
  waitForURL(url: RegExp | string, options?: unknown): Promise<void>
  url(): string
}

function resolveValue(field: LoginField, cred: PortalCredential): string {
  if (typeof field.from === 'object') return field.from.literal
  if (field.from === 'username') return cred.username
  if (field.from === 'password') return cred.password
  const code = cred.clientCode
  if (!code)
    throw new Error(
      `Config de ${cred.portalId} exige clientCode, ausente para ${cred.client}`
    )
  return code
}

/**
 * Drives the login form to completion. Throws when a required value is missing or the success
 * check does not pass within the timeout. Leaves the page authenticated for the caller to scrape
 * or snapshot; never logs credential values.
 */
export async function applyLogin(
  page: LoginPage,
  config: PortalLoginConfig,
  cred: PortalCredential,
  timeoutMs = 30000
): Promise<void> {
  const url = config.url ?? cred.url
  if (!url) throw new Error(`Sem URL de login para ${config.portalId}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

  for (const selector of config.dismissSelectors ?? []) {
    try {
      await page.click(selector, { timeout: 2000 })
    } catch {
      // Banner not present — ignore.
    }
  }

  for (const field of config.fields)
    await page.fill(field.selector, resolveValue(field, cred), {
      timeout: timeoutMs,
    })
  await page.click(config.submitSelector, { timeout: timeoutMs })

  if (!config.successUrlPattern && !config.successSelector)
    throw new Error(
      `Config de ${config.portalId} não define verificação de sucesso de login`
    )
  const checks: Promise<unknown>[] = []
  if (config.successUrlPattern)
    checks.push(
      page.waitForURL(config.successUrlPattern, { timeout: timeoutMs })
    )
  if (config.successSelector)
    checks.push(
      page.waitForSelector(config.successSelector, { timeout: timeoutMs })
    )
  await Promise.race(checks)
}

export function getLoginConfig(
  portalId: string
): PortalLoginConfig | undefined {
  return PORTAL_LOGIN_CONFIGS[portalId]
}

export interface LoggedInSession {
  browser: Browser
  context: BrowserContext
  page: Page
}

/**
 * Launches Chromium, logs in, and returns the live session. The caller owns the browser and
 * MUST call closeSession() (or browser.close()) when done. A real browser clears the managed
 * Cloudflare challenge that a bare fetch cannot (eGestiona), which is why login runs here.
 */
export async function launchAndLogin(options: {
  config: PortalLoginConfig
  cred: PortalCredential
  headless?: boolean
  timeoutMs?: number
}): Promise<LoggedInSession> {
  const browser = await chromium.launch({
    headless: options.headless ?? true,
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: USER_AGENT,
    })
    const page = await context.newPage()
    await applyLogin(page, options.config, options.cred, options.timeoutMs)
    return { browser, context, page }
  } catch (err) {
    await browser.close()
    throw err
  }
}

export async function closeSession(session: LoggedInSession): Promise<void> {
  await session.browser.close()
}

/** Persists the authenticated session so a later REST/scrape run can reuse it without re-login. */
export async function saveStorageState(
  session: LoggedInSession,
  filePath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  await session.context.storageState({ path: filePath })
  return filePath
}

/**
 * Tier-3 login configs. eGestiona is confirmed (the Vestas Latam extraction already runs through
 * it); the rest are derived from the login-page field names and are verified portal-by-portal on
 * first live run. Add a portal here once its selectors are confirmed.
 */
export const PORTAL_LOGIN_CONFIGS: Record<string, PortalLoginConfig> = {
  'egestiona-vestaslatam': {
    portalId: 'egestiona-vestaslatam',
    system: 'eGestiona',
    fields: [
      { selector: 'input[name="ClientName"]', from: 'clientCode' },
      { selector: 'input[name="Username"]', from: 'username' },
      { selector: 'input[name="Password"]', from: 'password' },
    ],
    submitSelector: 'button[type="submit"]',
    successUrlPattern: /egestiona\.com\/(?!login)/i,
    confidence: 'confirmed',
  },
  'egestiona-goldwind': {
    portalId: 'egestiona-goldwind',
    system: 'eGestiona',
    fields: [
      { selector: 'input[name="ClientName"]', from: 'clientCode' },
      { selector: 'input[name="Username"]', from: 'username' },
      { selector: 'input[name="Password"]', from: 'password' },
    ],
    submitSelector: 'button[type="submit"]',
    successUrlPattern: /egestiona\.com\/(?!login)/i,
    confidence: 'derived',
  },
  'egestiona-voltalia': {
    portalId: 'egestiona-voltalia',
    system: 'eGestiona',
    fields: [
      { selector: 'input[name="ClientName"]', from: 'clientCode' },
      { selector: 'input[name="Username"]', from: 'username' },
      { selector: 'input[name="Password"]', from: 'password' },
    ],
    submitSelector: 'button[type="submit"]',
    successUrlPattern: /egestiona\.com\/(?!login)/i,
    confidence: 'derived',
  },
  'seyses-statkraft': {
    portalId: 'seyses-statkraft',
    system: 'Seyses',
    fields: [
      { selector: '#username', from: 'username' },
      { selector: '#password', from: 'password' },
    ],
    submitSelector: '#submit',
    successUrlPattern: /seyses\.com\/(?!login)/i,
    confidence: 'derived',
  },
  'portal-one': {
    portalId: 'portal-one',
    system: 'Portal One',
    fields: [
      { selector: 'input[name="usercode"]', from: 'username' },
      { selector: 'input[name="password"]', from: 'password' },
    ],
    submitSelector: 'button[type="submit"], input[type="submit"]',
    successUrlPattern: /:8050\/(?!login)/i,
    confidence: 'derived',
  },
  'techsocial-cpfl': {
    portalId: 'techsocial-cpfl',
    system: 'TechSocial',
    fields: [
      { selector: 'input[name="email"]', from: 'username' },
      { selector: 'input[name="senha"]', from: 'password' },
    ],
    submitSelector: 'button[type="submit"], input[type="submit"]',
    successSelector: 'a[href*="logout"], a[href*="sair"]',
    confidence: 'derived',
  },
  surisoft: {
    portalId: 'surisoft',
    system: 'Surisoft',
    url: 'https://www.surisoft.com.br/?ReturnUrl=%2Ffornecedor',
    fields: [
      { selector: '#Email', from: 'username' },
      { selector: '#Password', from: 'password' },
    ],
    submitSelector: 'button[type="submit"]',
    successUrlPattern: /surisoft\.com\.br\/(?:fornecedor|SQF)/i,
    confidence: 'confirmed',
  },
  // TDoc signs in through Keycloak: the portal URL redirects to auth.tdoc.es, we fill the
  // standard Keycloak form, and success is the redirect back to the tenant host. The document
  // data itself is JSF (no REST), so this only produces the authenticated session; a JSF
  // scraper reads the documents from it.
  'tdoc-sgre': {
    portalId: 'tdoc-sgre',
    system: 'TDoc',
    url: 'https://wplatam.tdoc.es/',
    fields: [
      { selector: '#username', from: 'username' },
      { selector: '#password', from: 'password' },
    ],
    submitSelector: '#kc-login, input[name="login"]',
    successUrlPattern: /\/\/(?!auth\.)[\w-]+\.tdoc\.es/i,
    confidence: 'confirmed',
  },
  'tdoc-pegasus': {
    portalId: 'tdoc-pegasus',
    system: 'TDoc',
    url: 'https://pegasus.tdoc.es/',
    fields: [
      { selector: '#username', from: 'username' },
      { selector: '#password', from: 'password' },
    ],
    submitSelector: '#kc-login, input[name="login"]',
    successUrlPattern: /\/\/(?!auth\.)[\w-]+\.tdoc\.es/i,
    confidence: 'derived',
  },
  'tdoc-acciona-chile': {
    portalId: 'tdoc-acciona-chile',
    system: 'TDoc',
    url: 'https://acciona-chile.tdoc.es/',
    fields: [
      { selector: '#username', from: 'username' },
      { selector: '#password', from: 'password' },
    ],
    submitSelector: '#kc-login, input[name="login"]',
    successUrlPattern: /\/\/(?!auth\.)[\w-]+\.tdoc\.es/i,
    confidence: 'derived',
  },
}
