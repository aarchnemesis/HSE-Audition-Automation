import { describe, expect, it, vi } from 'vitest'
import { PortalCredential } from '../smartsheet/SmartsheetCredentialVault.js'
import {
  LoginPage,
  PORTAL_LOGIN_CONFIGS,
  PortalLoginConfig,
  applyLogin,
  getLoginConfig,
} from './PortalLoginHarness.js'

function cred(over: Partial<PortalCredential> = {}): PortalCredential {
  return {
    portalId: 'egestiona-vestaslatam',
    client: 'VESTAS LATAM',
    clientKey: 'VESTAS LATAM',
    host: 'vestaslatam.egestiona.com',
    url: 'https://vestaslatam.egestiona.com/',
    username: 'operator',
    password: 's3cret',
    clientCode: 'vestaslatam',
    ...over,
  }
}

function fakePage(finalUrl = 'https://vestaslatam.egestiona.com/home') {
  const calls = { fills: [] as [string, string][], clicks: [] as string[] }
  const page: LoginPage = {
    goto: vi.fn(async () => {}),
    fill: vi.fn(async (s: string, v: string) => {
      calls.fills.push([s, v])
    }),
    click: vi.fn(async (s: string) => {
      calls.clicks.push(s)
    }),
    waitForSelector: vi.fn(async () => {}),
    waitForURL: vi.fn(async () => {}),
    url: () => finalUrl,
  }
  return { page, calls }
}

describe('applyLogin', () => {
  it('navigates, fills every field with the resolved value, and submits', async () => {
    const { page, calls } = fakePage()
    await applyLogin(
      page,
      PORTAL_LOGIN_CONFIGS['egestiona-vestaslatam'],
      cred()
    )
    expect(page.goto).toHaveBeenCalledWith(
      'https://vestaslatam.egestiona.com/',
      expect.anything()
    )
    expect(calls.fills).toEqual([
      ['input[name="ClientName"]', 'vestaslatam'],
      ['input[name="Username"]', 'operator'],
      ['input[name="Password"]', 's3cret'],
    ])
    expect(calls.clicks).toContain('button[type="submit"]')
    expect(page.waitForURL).toHaveBeenCalled()
  })

  it('resolves literal fields and dismisses banners best-effort', async () => {
    const { page, calls } = fakePage()
    const config: PortalLoginConfig = {
      portalId: 'x',
      system: 'X',
      url: 'https://x.test/login',
      dismissSelectors: ['#cookies'],
      fields: [
        { selector: '#u', from: 'username' },
        { selector: '#lang', from: { literal: 'pt' } },
      ],
      submitSelector: '#go',
      successSelector: '#dashboard',
      confidence: 'derived',
    }
    page.click = vi.fn(async (s: string) => {
      if (s === '#cookies') throw new Error('no banner')
      calls.clicks.push(s)
    })
    await applyLogin(page, config, cred())
    expect(calls.fills).toEqual([
      ['#u', 'operator'],
      ['#lang', 'pt'],
    ])
    expect(calls.clicks).toContain('#go')
    expect(page.waitForSelector).toHaveBeenCalledWith(
      '#dashboard',
      expect.anything()
    )
  })

  it('throws when a clientCode is required but missing', async () => {
    const { page } = fakePage()
    await expect(
      applyLogin(
        page,
        PORTAL_LOGIN_CONFIGS['egestiona-vestaslatam'],
        cred({ clientCode: undefined })
      )
    ).rejects.toThrow(/clientCode/)
  })

  it('throws when the config defines no success check', async () => {
    const { page } = fakePage()
    const config: PortalLoginConfig = {
      portalId: 'x',
      system: 'X',
      url: 'https://x.test',
      fields: [{ selector: '#u', from: 'username' }],
      submitSelector: '#go',
      confidence: 'derived',
    }
    await expect(applyLogin(page, config, cred())).rejects.toThrow(
      /sucesso de login/
    )
  })
})

describe('PORTAL_LOGIN_CONFIGS', () => {
  it('only lists Tier-3 systems and every config has a success check', () => {
    for (const [id, config] of Object.entries(PORTAL_LOGIN_CONFIGS)) {
      expect(config.portalId).toBe(id)
      expect(config.successUrlPattern || config.successSelector).toBeTruthy()
    }
    expect(getLoginConfig('egestiona-vestaslatam')?.confidence).toBe(
      'confirmed'
    )
    // Captcha / MFA portals must never get a form-filler config.
    for (const blocked of [
      'atlas-eletrosul',
      'greenlegis',
      'obrasoft',
      'adaptspro-weg',
      'winda',
    ])
      expect(getLoginConfig(blocked)).toBeUndefined()
  })
})
