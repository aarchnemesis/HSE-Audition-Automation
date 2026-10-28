import { describe, expect, it } from 'vitest'
import { normalizeSurisoft } from './LegacyCensusNormalizers.js'
import {
  SurisoftApiDoc,
  mapSurisoftApiDoc,
  parseWorkerToken,
} from './SurisoftApiParser.js'

describe('parseWorkerToken', () => {
  it('reads the id and token from the onclick', () => {
    expect(
      parseWorkerToken("exibirRequisitosColaborador( 4821 , 'AbC123==', true)")
    ).toEqual({ idColab: '4821', token: 'AbC123==' })
    expect(parseWorkerToken('outraFuncao(1)')).toBeNull()
  })
})

describe('mapSurisoftApiDoc', () => {
  const base: SurisoftApiDoc = {
    RequisitoNome: 'ASO',
    ArqNome: 'aso.pdf',
    ArqValidade: '26/11/2026',
  }

  it('approves a document that has a file and a date, leaving expiry to the builder', () => {
    expect(mapSurisoftApiDoc(base)).toMatchObject({
      titulo: 'ASO',
      status: 'a',
      validade: '26/11/2026',
      obrigatorio: true,
    })
  })

  it('marks a document with no file as pending', () => {
    expect(mapSurisoftApiDoc({ RequisitoNome: 'NR-35' }).status).toBe('p')
  })

  it('marks a rejection from the reason or the observation text', () => {
    expect(
      mapSurisoftApiDoc({ ...base, MotivoReprovacao: 'documento ilegível' })
        .status
    ).toBe('r')
    expect(
      mapSurisoftApiDoc({
        ...base,
        ArqObservacao: 'Apresente a via atualizada',
      }).status
    ).toBe('r')
  })

  it('drops a placeholder observation and reads the optional flag', () => {
    const doc = mapSurisoftApiDoc({
      ...base,
      ArqObservacao: '.',
      RequisitoObrigatorio: false,
    })
    expect(doc.motivo).toBeNull()
    expect(doc.obrigatorio).toBe(false)
  })

  it('flows through normalizeSurisoft into a PortalWorker', () => {
    const [worker] = normalizeSurisoft([
      {
        nome: 'JUAN LIMA',
        cliente: 'GE Water & Process',
        funcao: 'Técnico',
        documentos: [
          mapSurisoftApiDoc(base),
          mapSurisoftApiDoc({
            RequisitoNome: 'NR-33',
            ArqNome: 'nr33.pdf',
            MotivoReprovacao: 'vencido',
          }),
        ],
      },
    ])
    expect(worker.client).toBe('GE VERNOVA')
    const aso = worker.documents.find(d => d.title === 'ASO')!
    expect(aso.status).toBe('APPROVED')
    expect(aso.expiresOn).toBe('2026-11-26')
    expect(worker.documents.find(d => d.title === 'NR-33')?.status).toBe(
      'REJECTED'
    )
  })
})
