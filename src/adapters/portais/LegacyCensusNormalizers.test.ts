import { describe, expect, it } from 'vitest'
import {
  normalizeSurisoft,
  normalizeTdoc,
  normalizeVeriduss,
  parsePortalDate,
} from './LegacyCensusNormalizers.js'

describe('parsePortalDate', () => {
  it('reads the three date dialects the portals use', () => {
    expect(parsePortalDate('OK (28/out/2026)')).toBe('2026-10-28')
    expect(parsePortalDate('7/jul/2031')).toBe('2031-07-07')
    expect(parsePortalDate('26/11/2026')).toBe('2026-11-26')
    expect(parsePortalDate('2034-06-26')).toBe('2034-06-26')
    expect(parsePortalDate('AUSENTE')).toBeUndefined()
    expect(parsePortalDate(null)).toBeUndefined()
  })
})

describe('normalizeTdoc', () => {
  const capturedAt = '2026-10-26T15:00:00.000Z'
  const [worker] = normalizeTdoc(
    [
      {
        nome: 'João Carlos Guardiano',
        cpf: '08787966492',
        proprietario: 'SANTO AGOSTINHO (Manutenção)',
        documentosOK: [
          { documento: 'ASO', status: 'OK (28/out/2026)' },
          { documento: 'CTPS', status: 'OK (8/abr/2026)' },
          'Ficha EPI',
        ],
        pendencias: [
          { documento: 'Perfil SGRE', status: 'NO OK (25/out/2026)' },
          {
            documento: 'Direção Defensiva',
            status: 'Pendente de Validação (26/out/2026)',
          },
          { documento: 'NR-35', status: 'AUSENTE' },
        ],
      },
    ],
    capturedAt
  )

  it('keeps the park and strips the task type', () => {
    expect(worker.contract).toBe('SANTO AGOSTINHO')
    expect(worker.client).toBeUndefined()
  })

  it('treats a past date on an approved document as validation, not expiry', () => {
    const byTitle = Object.fromEntries(worker.documents.map(d => [d.title, d]))
    expect(byTitle.ASO).toMatchObject({
      status: 'APPROVED',
      expiresOn: '2026-10-28',
    })
    expect(byTitle.CTPS).toMatchObject({
      status: 'APPROVED',
      expiresOn: undefined,
    })
    expect(byTitle['Ficha EPI'].status).toBe('APPROVED')
    expect(byTitle['Perfil SGRE'].status).toBe('REJECTED')
    expect(byTitle['Direção Defensiva'].status).toBe('IN_REVIEW')
    expect(byTitle['NR-35'].status).toBe('MISSING')
  })
})

describe('normalizeVeriduss', () => {
  it('drops placeholder workers and keeps the reason only on rejections', () => {
    const workers = normalizeVeriduss([
      { nome: 'DESCONHECIDO', documentos: [] },
      {
        nome: 'DANIEL FERNANDES PACHECO',
        empresa: 'Arthwind',
        documentos: [
          {
            titulo: 'CNH',
            status: 'a',
            validade: '2034-06-26',
            motivoRejeicao: 'Critérios de Aprovação',
          },
          {
            titulo: 'NR-18',
            status: 'r',
            validade: null,
            motivoRejeicao: 'Assinatura ausente',
          },
        ],
      },
    ])
    expect(workers).toHaveLength(1)
    expect(workers[0].documents[0]).toMatchObject({
      status: 'APPROVED',
      note: undefined,
    })
    expect(workers[0].documents[1]).toMatchObject({
      status: 'REJECTED',
      note: 'Assinatura ausente',
    })
  })
})

describe('normalizeSurisoft', () => {
  it('tells Serena and GE workers apart and honours optional requirements', () => {
    const workers = normalizeSurisoft([
      {
        nome: 'A',
        cliente: 'GE Water & Process (Ventos da Bahia)',
        documentos: [
          {
            titulo: 'ASO\t',
            status: 'v',
            validade: '26/11/2026',
            obrigatorio: true,
          },
        ],
      },
      {
        nome: 'B',
        cliente: 'Serena Energia S.A.',
        documentos: [{ titulo: 'Vacina', status: 'p', obrigatorio: false }],
      },
    ])
    expect(workers[0].client).toBe('GE VERNOVA')
    expect(workers[0].documents[0]).toMatchObject({
      title: 'ASO',
      status: 'EXPIRING',
      expiresOn: '2026-11-26',
    })
    expect(workers[1].client).toBe('SERENA')
    expect(workers[1].documents[0].required).toBe(false)
  })
})
