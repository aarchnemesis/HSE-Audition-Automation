import { describe, expect, it } from 'vitest'
import { EHSEvaluator } from './EHSEvaluator.js'

const REF = new Date(2026, 7, 13) // 13/08/2026

function daysFromRef(days: number): Date {
  const d = new Date(REF)
  d.setDate(d.getDate() + days)
  return d
}

describe('EHSEvaluator.evaluateDate', () => {
  it('retorna INDETERMINADO para data ausente ou inválida', () => {
    expect(EHSEvaluator.evaluateDate(undefined, REF).status).toBe(
      'INDETERMINADO'
    )
    expect(EHSEvaluator.evaluateDate(null, REF).status).toBe('INDETERMINADO')
    expect(EHSEvaluator.evaluateDate(new Date('invalid'), REF).status).toBe(
      'INDETERMINADO'
    )
  })

  it('retorna VENCIDO para datas no passado', () => {
    expect(EHSEvaluator.evaluateDate(daysFromRef(-1), REF).status).toBe(
      'VENCIDO'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(-100), REF).status).toBe(
      'VENCIDO'
    )
  })

  it('classifica a régua escalonada corretamente nos limites de cada faixa', () => {
    expect(EHSEvaluator.evaluateDate(daysFromRef(0), REF).status).toBe(
      'VENCE_07'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(7), REF).status).toBe(
      'VENCE_07'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(8), REF).status).toBe(
      'VENCE_15'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(15), REF).status).toBe(
      'VENCE_15'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(16), REF).status).toBe(
      'VENCE_30'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(30), REF).status).toBe(
      'VENCE_30'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(31), REF).status).toBe(
      'VENCE_60'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(60), REF).status).toBe(
      'VENCE_60'
    )
    expect(EHSEvaluator.evaluateDate(daysFromRef(61), REF).status).toBe(
      'CONFORME'
    )
  })
})

describe('EHSEvaluator.calculateExpirationFromIssue', () => {
  it('soma o número de anos de validade à data de emissão', () => {
    const issue = new Date(2024, 0, 15)
    const exp = EHSEvaluator.calculateExpirationFromIssue(issue, 2)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(0)
    expect(exp.getDate()).toBe(15)
  })
})
