import { describe, expect, it } from 'vitest'
import {
  parseDateDmy,
  resolveCourseStartDate,
  resolveTrueFileCode,
  subtractValidityYears,
} from './updateCoursesToStartDate.js'

describe('updateCoursesToStartDate helpers', () => {
  it('parses DMY and ISO dates from filenames accurately', () => {
    const d1 = parseDateDmy('20 - NR - 33 - JOAO SILVA - 16.10.2025.pdf')
    expect(d1?.toISOString().slice(0, 10)).toBe('2025-10-16')

    const d2 = parseDateDmy('21 – NR-35 – JOAO SILVA – 21-01-2028.pdf')
    expect(d2?.toISOString().slice(0, 10)).toBe('2028-01-21')

    const d3 = parseDateDmy('2025-08-27 - NR 10.pdf')
    expect(d3?.toISOString().slice(0, 10)).toBe('2025-08-27')
  })

  it('subtracts 1 year for annual codes (20, 28, 34) and 2 years for biennial codes', () => {
    const expAnnual = new Date(Date.UTC(2027, 0, 15))
    expect(
      subtractValidityYears(expAnnual, '20').toISOString().slice(0, 10)
    ).toBe('2026-01-15')

    const expBiennial = new Date(Date.UTC(2028, 0, 15))
    expect(
      subtractValidityYears(expBiennial, '21').toISOString().slice(0, 10)
    ).toBe('2026-01-15')
  })

  it('prioritizes original filename date (<= 2026) over Clicksign signature date in cache', () => {
    const cache = new Map([
      [
        'file-1',
        {
          issueDate: '2025-11-03T00:00:00.000Z',
          expirationDate: '2027-10-16T00:00:00.000Z',
        },
      ],
    ])
    const resolved = resolveCourseStartDate(
      'file-1',
      '12.1 - Carta de Anuência NR - 10 - ADALTO - 16.10.2025.pdf',
      '12.1 – Carta NR-10 – Adalto – 16-10-2027.pdf',
      '12.1',
      cache
    )
    expect(resolved?.toISOString().slice(0, 10)).toBe('2025-10-16')
  })

  it('falls back to cached issueDate when original filename has no date', () => {
    const cache = new Map([
      [
        'file-2',
        {
          issueDate: '2025-05-12T00:00:00.000Z',
          expirationDate: '2027-05-12T00:00:00.000Z',
        },
      ],
    ])
    const resolved = resolveCourseStartDate(
      'file-2',
      '21 - NR-35 - ADALTO.pdf',
      '21 – NR-35 – Adalto – 12-05-2027.pdf',
      '21',
      cache
    )
    expect(resolved?.toISOString().slice(0, 10)).toBe('2025-05-12')
  })

  it('resolves true file codes for Cartas and multi-pass files', () => {
    expect(
      resolveTrueFileCode(
        '15.1 - Carta NR - 12 - ADALTO - 16.10.2025.pdf',
        '15 – NR-12 – Adalto – 16-10-2027.pdf'
      )
    ).toBe('15.1')

    expect(
      resolveTrueFileCode(
        '20.1 - Carta NR - 33 - ADALTO - 16.10.2025.pdf',
        '20 – NR-33 – Adalto – 16-10-2026.pdf'
      )
    ).toBe('20.1')

    expect(
      resolveTrueFileCode(
        '06 - Ficha de EPI - ADALTO - 10.08.2025.pdf',
        '31 – Elevador (JASO) – Adalto – 10-08-2026.pdf'
      )
    ).toBe('06')
  })
})
