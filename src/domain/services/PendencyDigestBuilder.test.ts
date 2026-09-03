import { describe, expect, it } from 'vitest'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'
import { buildPendencyDigest } from './PendencyDigestBuilder.js'

function makeRecord(overrides: Partial<HSEDatabaseRecord>): HSEDatabaseRecord {
  return {
    inspectorId: '1',
    inspectorName: 'FULANO DE TAL',
    role: 'IQ',
    docCode: '01',
    docName: 'ASO',
    modality: 'PRESENCIAL',
    statusEHS: 'CONFORME',
    detail: '',
    lastUpdated: new Date().toISOString(),
    ...overrides,
  }
}

describe('buildPendencyDigest', () => {
  it('exclui pessoas 100% CONFORME do resumo', () => {
    const records = [makeRecord({ statusEHS: 'CONFORME' })]
    expect(buildPendencyDigest(records)).toHaveLength(0)
  })

  it('inclui pessoa com pelo menos um item pendente, mas só os itens pendentes dela', () => {
    const records = [
      makeRecord({
        inspectorName: 'FULANO',
        docCode: '01',
        statusEHS: 'CONFORME',
      }),
      makeRecord({
        inspectorName: 'FULANO',
        docCode: '21',
        statusEHS: 'VENCIDO',
        detail: 'venceu',
      }),
    ]
    const digest = buildPendencyDigest(records)

    expect(digest).toHaveLength(1)
    expect(digest[0].items).toHaveLength(1)
    expect(digest[0].items[0].docCode).toBe('21')
  })

  it('agrupa por pessoa e ordena por quem tem mais pendências primeiro', () => {
    const records = [
      makeRecord({
        inspectorName: 'COM_UMA',
        docCode: '01',
        statusEHS: 'VENCIDO',
      }),
      makeRecord({
        inspectorName: 'COM_DUAS',
        docCode: '01',
        statusEHS: 'VENCIDO',
      }),
      makeRecord({
        inspectorName: 'COM_DUAS',
        docCode: '21',
        statusEHS: 'VENCE_07',
      }),
    ]
    const digest = buildPendencyDigest(records)

    expect(digest).toHaveLength(2)
    expect(digest[0].inspectorName).toBe('COM_DUAS')
    expect(digest[0].items).toHaveLength(2)
    expect(digest[1].inspectorName).toBe('COM_UMA')
  })

  it('trata SOLICITADO_STORZ e STORZ_EM_ANDAMENTO como pendência (não CONFORME)', () => {
    const records = [
      makeRecord({
        inspectorName: 'X',
        docCode: '01',
        statusEHS: 'SOLICITADO_STORZ',
      }),
      makeRecord({
        inspectorName: 'Y',
        docCode: '01',
        statusEHS: 'STORZ_EM_ANDAMENTO',
      }),
    ]
    expect(buildPendencyDigest(records)).toHaveLength(2)
  })

  it('não alerta documento eletivo ausente (ex.: SIT Vestas código 25) — não é uma pendência ativa', () => {
    const records = [
      makeRecord({
        inspectorName: 'FULANO',
        docCode: '25',
        statusEHS: 'AUSENTE',
      }),
    ]
    expect(buildPendencyDigest(records)).toHaveLength(0)
  })

  it('mas se o documento eletivo estiver vencendo (tem, mas vai vencer), continua alertando normalmente', () => {
    const records = [
      makeRecord({
        inspectorName: 'FULANO',
        docCode: '25',
        statusEHS: 'VENCE_07',
      }),
    ]
    expect(buildPendencyDigest(records)).toHaveLength(1)
  })
})
