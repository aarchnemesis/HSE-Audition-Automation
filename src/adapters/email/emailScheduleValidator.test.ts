import { describe, expect, it } from 'vitest'
import { isDayAllowedForEmail } from './emailScheduleValidator.js'

describe('emailScheduleValidator', () => {
  it('permite envio se nenhuma configuracao de dias restritos for passada', () => {
    expect(isDayAllowedForEmail()).toBe(true)
    expect(isDayAllowedForEmail('')).toBe(true)
    expect(isDayAllowedForEmail('   ')).toBe(true)
  })

  it('permite envio nas tercas-feiras e sabados quando configurado 2,6', () => {
    // 2026-09-15 foi uma terca-feira
    const tuesday = new Date('2026-09-15T06:35:00Z')
    // 2026-09-19 e um sabado
    const saturday = new Date('2026-09-19T06:35:00Z')

    expect(isDayAllowedForEmail('2,6', tuesday)).toBe(true)
    expect(isDayAllowedForEmail('2,6', saturday)).toBe(true)
  })

  it('bloqueia envio em segundas, quartas, quintas, sextas e domingos quando configurado 2,6', () => {
    // 2026-09-14 foi uma segunda-feira (day 1)
    const monday = new Date('2026-09-14T06:35:00Z')
    // 2026-09-16 foi uma quarta-feira (day 3)
    const wednesday = new Date('2026-09-16T06:35:00Z')
    // 2026-09-17 foi uma quinta-feira (day 4)
    const thursday = new Date('2026-09-17T06:35:00Z')
    // 2026-09-18 e uma sexta-feira (day 5)
    const friday = new Date('2026-09-18T06:35:00Z')
    // 2026-09-20 e um domingo (day 0)
    const sunday = new Date('2026-09-20T06:35:00Z')

    expect(isDayAllowedForEmail('2,6', monday)).toBe(false)
    expect(isDayAllowedForEmail('2,6', wednesday)).toBe(false)
    expect(isDayAllowedForEmail('2,6', thursday)).toBe(false)
    expect(isDayAllowedForEmail('2,6', friday)).toBe(false)
    expect(isDayAllowedForEmail('2,6', sunday)).toBe(false)
  })

  it('respeita o fuso horario America/Sao_Paulo mesmo com UTC na transicao da madrugada', () => {
    // 2026-09-15T02:00:00Z em UTC ainda e 2026-09-14 23:00 em BRT (Segunda-feira)
    const lateMondayInBrt = new Date('2026-09-15T02:00:00Z')
    expect(isDayAllowedForEmail('2,6', lateMondayInBrt)).toBe(false)

    // 2026-09-15T03:35:00Z em UTC e 2026-09-15 00:35 em BRT (Terca-feira)
    const earlyTuesdayInBrt = new Date('2026-09-15T03:35:00Z')
    expect(isDayAllowedForEmail('2,6', earlyTuesdayInBrt)).toBe(true)
  })
})
