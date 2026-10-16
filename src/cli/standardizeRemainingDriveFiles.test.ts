import { describe, expect, it } from 'vitest'
import { buildStandardNameForRemainingFile } from './standardizeRemainingDriveFiles.js'

describe('standardizeRemainingDriveFiles', () => {
  const emptyCache = new Map<string, any>()

  it('standardizes extra uncoded documents without code prefix and omits SEM_DATA when undated', () => {
    const p1 = buildStandardNameForRemainingFile(
      'f1',
      '05.2 - Plano de Saúde - Pedro Eduardo de Oliveira Cavalcanti Silva.pdf',
      'PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA',
      emptyCache
    )
    expect(p1?.newName).toBe(
      'Plano de Saúde - PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA.pdf'
    )
    expect(p1?.category).toBe('UNCODED_EXTRA')

    const p2 = buildStandardNameForRemainingFile(
      'f2',
      '34 - Passaporte - 12.03.2034 - Raimundo Nonato de Holanda Filho.pdf',
      'RAIMUNDO NONATO DE HOLANDA FILHO',
      emptyCache
    )
    expect(p2?.newName).toBe(
      'Passaporte – 12.03.2034 - RAIMUNDO NONATO DE HOLANDA FILHO.pdf'
    )
    expect(p2?.category).toBe('UNCODED_EXTRA')

    const p3 = buildStandardNameForRemainingFile(
      'f3',
      'Crachá de identificação - Alisson Mateus Almeida da Costa .pdf',
      'ALISSON MATEUS ALMEIDA DA COSTA',
      emptyCache
    )
    expect(p3?.newName).toBe(
      'Crachá de Identificação - ALISSON MATEUS ALMEIDA DA COSTA.pdf'
    )
  })

  it('standardizes GWO ART sub-modules (ART-H, ART-N, SART-H, SART-N) with module tag and start date', () => {
    const cache = new Map([
      ['f-art', { issueDate: '2025-11-10T00:00:00.000Z' }],
    ])
    const res = buildStandardNameForRemainingFile(
      'f-art',
      'Luana Queiroz de Sousa - ART-H - Clicksign.pdf',
      'LUANA QUEIROZ DE SOUSA',
      cache
    )
    expect(res?.newName).toBe(
      '32 – GWO ART (ART-H) – 10.11.2025 - LUANA QUEIROZ DE SOUSA.pdf'
    )
    expect(res?.category).toBe('CODED_HSE')
  })

  it('standardizes EPI checklists with brand qualifier and 1-year validity expiration date', () => {
    const res = buildStandardNameForRemainingFile(
      'f-epi',
      '06.1 - Checklist EPI de Altura (Honeywell) - 22.01.2026 - Pedro Eduardo de Oliveira Cavalcanti Silva - Clicksign.pdf',
      'PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA',
      emptyCache
    )
    expect(res?.newName).toBe(
      '06 – Checklist EPI de Altura (Honeywell) – 22.01.2027 - PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA.pdf'
    )
    expect(res?.category).toBe('CODED_HSE')
  })

  it('converts 04.1 – Doc 04.1 to Contrato de Trabalho CLT', () => {
    const res = buildStandardNameForRemainingFile(
      'f-041',
      '04.1 – Doc 04.1 – 23.10.2027 - LUANA QUEIROZ DE SOUSA.pdf',
      'LUANA QUEIROZ DE SOUSA',
      emptyCache
    )
    expect(res?.newName).toBe(
      'Contrato de Trabalho CLT – 23.10.2027 - LUANA QUEIROZ DE SOUSA.pdf'
    )
    expect(res?.category).toBe('FIX_DOC_04_1')
  })
})
