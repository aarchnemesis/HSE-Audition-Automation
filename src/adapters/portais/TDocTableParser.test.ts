import { describe, expect, it } from 'vitest'
import { normalizeTdoc } from './LegacyCensusNormalizers.js'
import {
  docFromCells,
  toTdocRawWorker,
  workerFromCells,
} from './TDocTableParser.js'

describe('workerFromCells', () => {
  it('joins name + surnames and requires a CPF', () => {
    expect(
      workerFromCells([
        '',
        'Guardiano',
        '',
        'João Carlos',
        '08787966492',
        'TECNICO',
      ])
    ).toEqual({
      nome: 'João Carlos Guardiano',
      cpf: '08787966492',
      funcao: 'TECNICO',
    })
  })

  it('drops header and cpf-less rows', () => {
    expect(
      workerFromCells(['', 'Sobrenome', '', 'Nome', 'CPF', 'Função'])
    ).toBeNull()
    expect(workerFromCells(['', '', '', '', '', ''])).toBeNull()
  })
})

describe('docFromCells', () => {
  it('reads title and status, dropping header rows', () => {
    expect(
      docFromCells(['Grupo', 'Ficha EPI', 'OK (22/out/2026)', 'proc'])
    ).toEqual({ documento: 'Ficha EPI', status: 'OK (22/out/2026)' })
    expect(docFromCells(['', 'Documento', 'Estado', ''])).toBeNull()
  })
})

describe('toTdocRawWorker + normalizeTdoc', () => {
  it('feeds the existing normalizer so statuses classify correctly', () => {
    const raw = toTdocRawWorker(
      { nome: 'Ana Souza', cpf: '123', funcao: 'TECNICA' },
      [
        { documento: 'ASO', status: 'OK (10/jan/2027)' },
        { documento: 'Perfil treinamento', status: 'NO OK (25/out/2026)' },
        {
          documento: 'Ficha EPI',
          status: 'Pendente de Validação (22/out/2026)',
        },
      ],
      'SANTO AGOSTINHO (Manutenção)'
    )
    const [worker] = normalizeTdoc([raw], '2026-10-27T00:00:00.000Z')
    expect(worker.name).toBe('Ana Souza')
    // normalizeTdoc strips the trailing parenthetical from the owner.
    expect(worker.contract).toBe('SANTO AGOSTINHO')
    const byTitle = (q: string) =>
      worker.documents.find(d => d.title.includes(q))!
    expect(byTitle('ASO').status).toBe('APPROVED')
    expect(byTitle('ASO').expiresOn).toBe('2027-01-10')
    expect(byTitle('Perfil treinamento').status).toBe('REJECTED')
    expect(byTitle('Ficha EPI').status).toBe('IN_REVIEW')
  })

  it('leaves the CPF out of the normalized worker', () => {
    const raw = toTdocRawWorker(
      { nome: 'Beto Lima', cpf: '99988877766', funcao: '' },
      [{ documento: 'CTPS', status: 'OK' }]
    )
    const [worker] = normalizeTdoc([raw], '2026-10-27T00:00:00.000Z')
    expect(JSON.stringify(worker)).not.toContain('99988877766')
  })
})
