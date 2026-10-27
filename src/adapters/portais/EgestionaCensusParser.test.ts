import { describe, expect, it } from 'vitest'
import {
  EgestionaRawRow,
  buildEgestionaCensus,
  isDataRow,
  rowToWorker,
} from './EgestionaCensusParser.js'

const captured = '2026-10-27T12:00:00.000Z'

function row(over: Partial<EgestionaRawRow>): EgestionaRawRow {
  return {
    firstName: 'Joao',
    lastName: 'Silva',
    dni: '123',
    empresa: 'Arthwind',
    ...over,
  }
}

describe('isDataRow', () => {
  it('drops header and empty rows', () => {
    expect(isDataRow(row({ firstName: 'Nombre', lastName: '' }))).toBe(false)
    expect(isDataRow(row({ firstName: '', lastName: '' }))).toBe(false)
    expect(isDataRow(row({ dni: 'DNI' }))).toBe(false)
    expect(isDataRow(row({}))).toBe(true)
  })
})

describe('rowToWorker', () => {
  it('maps the three traffic lights to document statuses', () => {
    const worker = rowToWorker(
      row({
        dprImgSrc: '/img/semaforo_verde.png',
        dpeImgSrc: '/img/semaforo_rojo.png',
        actImgSrc: '/img/inactivo.png',
      })
    )!
    const byTitle = (q: string) =>
      worker.documents.find(d => d.title.includes(q))!
    expect(byTitle('DPR').status).toBe('APPROVED')
    expect(byTitle('DPE').status).toBe('REJECTED')
    expect(byTitle('DPE').note).toMatch(/acesso ao parque/)
    expect(byTitle('Cadastro').status).toBe('REJECTED')
  })

  it('treats a green cadastro check and grey DPE correctly', () => {
    const worker = rowToWorker(
      row({
        dprImgSrc: 'green.gif',
        dpeImgSrc: 'gris.gif',
        actImgSrc: 'check.png',
      })
    )!
    const byTitle = (q: string) =>
      worker.documents.find(d => d.title.includes(q))!
    expect(byTitle('DPR').status).toBe('APPROVED')
    expect(byTitle('DPE').status).toBe('MISSING')
    expect(byTitle('Cadastro').status).toBe('APPROVED')
  })

  it('joins first and last name and keeps the company as contract', () => {
    const worker = rowToWorker(row({ firstName: 'Ana', lastName: 'Souza' }))!
    expect(worker.name).toBe('Ana Souza')
    expect(worker.contract).toBe('Arthwind')
  })

  it('returns null for a header row', () => {
    expect(rowToWorker(row({ firstName: 'Nombre', lastName: '' }))).toBeNull()
  })
})

describe('buildEgestionaCensus', () => {
  it('drops headers, keeps workers and de-duplicates by name', () => {
    const census = buildEgestionaCensus(
      [
        row({ firstName: 'Nombre', lastName: '', dni: 'DNI' }),
        row({ firstName: 'Ana', lastName: 'Souza', dprImgSrc: 'verde' }),
        row({ firstName: 'Ana', lastName: 'Souza', dprImgSrc: 'rojo' }),
        row({ firstName: 'Beto', lastName: 'Lima' }),
      ],
      { portalId: 'egestiona-vestaslatam', capturedAt: captured }
    )
    expect(census.portalId).toBe('egestiona-vestaslatam')
    expect(census.workers.map(w => w.name).sort()).toEqual([
      'Ana Souza',
      'Beto Lima',
    ])
    // Last occurrence wins on duplicate (DPR rojo -> MISSING).
    const ana = census.workers.find(w => w.name === 'Ana Souza')!
    expect(ana.documents.find(d => d.title.includes('DPR'))?.status).toBe(
      'MISSING'
    )
  })
})
