import { describe, expect, it } from 'vitest'
import { PORTALS, clientKey, portalsForClient } from './PortalCatalog.js'

describe('clientKey', () => {
  it('normalizes accents, punctuation and known aliases', () => {
    expect(clientKey('ALIANÇA')).toBe('ALIANCA')
    expect(clientKey('VESTAS R. DOMINICANA')).toBe('VESTAS R DOMINICANA')
    expect(clientKey('Siemens Gamesa')).toBe('SGRE')
    expect(clientKey('  GE  ')).toBe('GE VERNOVA')
  })
})

describe('portalsForClient', () => {
  it('lists every portal a client uses', () => {
    expect(portalsForClient('GE VERNOVA').map(p => p.id)).toEqual([
      'surisoft',
      'tesseg-sgt',
      'datalife',
    ])
    expect(portalsForClient('ENGIE')).toEqual([])
  })

  it('has unique ids', () => {
    expect(new Set(PORTALS.map(p => p.id)).size).toBe(PORTALS.length)
  })
})
