import { describe, expect, it } from 'vitest'
import {
  findCredential,
  parseCredentialSheet,
  redactCredential,
} from './SmartsheetCredentialVault.js'

const columns = [
  { id: 1, title: 'CLIENTE' },
  { id: 2, title: 'LINK DE ACESSO' },
  { id: 3, title: 'USUÁRIO' },
  { id: 4, title: 'SENHA' },
]

function row(client: string, link: string, user: string, pass: string) {
  return {
    cells: [
      { columnId: 1, value: client },
      { columnId: 2, value: link },
      { columnId: 3, value: user },
      { columnId: 4, value: pass },
    ],
  }
}

describe('parseCredentialSheet', () => {
  it('matches rows to portals and derives clientCode from the subdomain', () => {
    const creds = parseCredentialSheet({
      columns,
      rows: [
        row('GOLDWIND', 'https://goldwind.egestiona.com/', 'u1', 'p1'),
        row(
          'GOLDWIND',
          'https://goldwind.veriduss.com.br/dashboard',
          'u2@arthwind.com.br',
          'p2'
        ),
      ],
    })
    const egestiona = creds.find(c => c.portalId === 'egestiona-goldwind')!
    expect(egestiona.clientCode).toBe('goldwind')
    expect(egestiona.password).toBe('p1')
    expect(creds.find(c => c.portalId === 'veriduss-goldwind')?.username).toBe(
      'u2@arthwind.com.br'
    )
  })

  it('skips rows without both a username and a password', () => {
    const creds = parseCredentialSheet({
      columns,
      rows: [
        row('GOLDWIND', 'https://goldwind.egestiona.com/', 'u1', ''),
        row('GOLDWIND', 'https://goldwind.egestiona.com/', '', 'p1'),
      ],
    })
    expect(creds).toHaveLength(0)
  })
})

describe('findCredential', () => {
  const creds = parseCredentialSheet({
    columns,
    rows: [
      row(
        'CPFL',
        'https://v4.metacontratas.com/app/metalogin/accesos',
        'uc',
        'pc'
      ),
      row(
        'ENERGIMP',
        'https://v4.metacontratas.com/app/metalogin/accesos',
        'ue',
        'pe'
      ),
    ],
  })

  it('prefers an exact client match when several share a portal', () => {
    expect(
      findCredential(creds, { portalId: 'metacontratas', client: 'ENERGIMP' })
        ?.password
    ).toBe('pe')
  })

  it('falls back to the first match when no client is given', () => {
    expect(findCredential(creds, { portalId: 'metacontratas' })).toBeDefined()
    expect(findCredential(creds, { portalId: 'nope' })).toBeUndefined()
  })
})

describe('redactCredential', () => {
  it('never exposes the password and masks the username', () => {
    const [c] = parseCredentialSheet({
      columns,
      rows: [
        row(
          'GOLDWIND',
          'https://goldwind.egestiona.com/',
          'operator',
          'topsecret'
        ),
      ],
    })
    const safe = redactCredential(c)
    expect(JSON.stringify(safe)).not.toContain('topsecret')
    expect(safe.hasPassword).toBe(true)
    expect(safe.username).toBe('op***')
  })
})
