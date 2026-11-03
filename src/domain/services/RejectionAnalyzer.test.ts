import { describe, expect, it } from 'vitest'
import { RejectionAnalyzer } from './RejectionAnalyzer.js'

describe('RejectionAnalyzer', () => {
  const analyzer = new RejectionAnalyzer()

  it('diagnostica ASO sem PCMSO corretamente com destino EHS', () => {
    const res = analyzer.analyze({
      portalId: 'surisoft',
      docTitle: 'ASO',
      rejectionReasonRaw: 'Por gentileza apresente o ASO + o PCMSO vigente na data do ASO para análise',
      workerName: 'ANTONIO RAFAEL DOS SANTOS',
    })

    expect(res.targetTeam).toBe('EHS')
    expect(res.confidence).toBeGreaterThanOrEqual(0.9)
    expect(res.causeDiagnosis).toContain('PCMSO')
    expect(res.recommendedAction).toContain('PCMSO vigente')
  })

  it('diagnostica documento sem assinatura digital com destino RH', () => {
    const res = analyzer.analyze({
      portalId: 'egestiona-vestaslatam',
      docTitle: 'Ficha de Registro de Empregado',
      rejectionReasonRaw: 'Certificado sem assinatura digital verificável ou ilegível',
    })

    expect(res.targetTeam).toBe('RH')
    expect(res.causeDiagnosis).toContain('assinatura digital')
    expect(res.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('diagnostica rejeição de carta de anuência NR10/SEP com destino EHS', () => {
    const res = analyzer.analyze({
      portalId: 'techsocial-cpfl',
      docTitle: 'Carta de Anuência NR10',
      rejectionReasonRaw: 'Documento reprovado no TechSocial CPFL',
      workerName: 'ADRIANO CIRILO',
    })

    expect(res.targetTeam).toBe('EHS')
    expect(res.causeDiagnosis).toContain('Carta de Anuência')
  })

  it('diagnostica treinamento normativo genérico com destino DO', () => {
    const res = analyzer.analyze({
      portalId: 'tdoc-sgre',
      docTitle: 'NR-35 Trabalho em Altura',
      rejectionReasonRaw: 'Reprovado pelo cliente',
    })

    expect(res.targetTeam).toBe('DO')
    expect(res.causeDiagnosis).toContain('treinamento normativo')
  })
})
