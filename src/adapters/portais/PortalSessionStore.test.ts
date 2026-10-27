import { describe, expect, it } from 'vitest'
import { summarizeSessionHealth } from './PortalSessionStore.js'

const NOW = 1_800_000_000 // fixed reference in Unix seconds

describe('summarizeSessionHealth', () => {
  it('counts valid, expired and session-only cookies and finds the next expiry', () => {
    const health = summarizeSessionHealth(
      {
        cookies: [
          { name: 'a', expires: NOW + 3600 },
          { name: 'b', expires: NOW + 7200 },
          { name: 'c', expires: NOW - 10 },
          { name: 'session', expires: -1 },
          { name: 'legacy', expires: 0 },
        ],
      },
      NOW
    )
    expect(health.persistentValid).toBe(2)
    expect(health.persistentExpired).toBe(1)
    expect(health.sessionOnly).toBe(2)
    expect(health.usable).toBe(true)
    expect(health.nextExpiry).toBe(new Date((NOW + 3600) * 1000).toISOString())
  })

  it('is not usable when every persistent cookie has expired', () => {
    const health = summarizeSessionHealth(
      {
        cookies: [
          { name: 'a', expires: NOW - 1 },
          { name: 's', expires: -1 },
        ],
      },
      NOW
    )
    expect(health.usable).toBe(false)
    expect(health.nextExpiry).toBeUndefined()
  })

  it('handles an empty or cookieless session', () => {
    const health = summarizeSessionHealth({}, NOW)
    expect(health).toMatchObject({
      persistentValid: 0,
      persistentExpired: 0,
      sessionOnly: 0,
      usable: false,
    })
  })
})
