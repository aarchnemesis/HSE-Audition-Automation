import { describe, expect, it } from 'vitest'
import {
  PDFContentInspector,
  addDuration,
  parsePortugueseDate,
} from './PDFContentInspector.js'

describe('PDFContentInspector', () => {
  describe('parsePortugueseDate', () => {
    it('deve converter datas textuais com mês por extenso', () => {
      const d1 = parsePortugueseDate('26 de junho de 2026')
      expect(d1).not.toBeNull()
      expect(d1?.getDate()).toBe(26)
      expect(d1?.getMonth()).toBe(5) // Junho (0-indexed)
      expect(d1?.getFullYear()).toBe(2026)

      const d2 = parsePortugueseDate('08 de Janeiro de 2026')
      expect(d2?.getDate()).toBe(8)
      expect(d2?.getMonth()).toBe(0) // Janeiro
      expect(d2?.getFullYear()).toBe(2026)

      const d3 = parsePortugueseDate('27de Agosto de 2026')
      expect(d3?.getDate()).toBe(27)
      expect(d3?.getMonth()).toBe(7) // Agosto
      expect(d3?.getFullYear()).toBe(2026)
    })

    it('deve converter datas numéricas no formato DMY', () => {
      const d = parsePortugueseDate('21/01/2025')
      expect(d?.getDate()).toBe(21)
      expect(d?.getMonth()).toBe(0)
      expect(d?.getFullYear()).toBe(2025)
    })
  })

  describe('addDuration', () => {
    it('deve somar meses e anos corretamente', () => {
      const base = new Date(2026, 5, 26) // 26/06/2026
      const in12Months = addDuration(base, 12, 'months')
      expect(in12Months.getFullYear()).toBe(2027)
      expect(in12Months.getMonth()).toBe(5)
      expect(in12Months.getDate()).toBe(26)

      const in2Years = addDuration(base, 2, 'years')
      expect(in2Years.getFullYear()).toBe(2028)
      expect(in2Years.getMonth()).toBe(5)
    })
  })

  describe('inspect - Contratos e Aditivos', () => {
    const refDate = new Date(2026, 8, 23) // 23/09/2026

    it('deve extrair vigência de 12 meses a partir do caput do contrato PJ (caso Nardel)', () => {
      const text = `
        INSTRUMENTO PARTICULAR DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS ESPECIALIZADOS
        CLÁUSULA PRIMEIRA – O presente Contrato tem como OBJETO a prestação de serviços...
        CLÁUSULA DÉCIMA OITAVA – O presente Contrato passa a vigorar a partir de 26 de junho de 2026 e terá vigência de 12 (doze) meses.
        Parágrafo Único: O presente Contrato somente será renovado mediante acordo expresso...
      `
      const filename =
        'CONTRATO DE PRESTAÇÃO DE SERVIÇOS - NARDEL DELON - Clicksign (1).pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('40')
      expect(result.source).toBe('PDF_CONTENT')
      expect(result.expirationDate).toBeDefined()
      expect(result.expirationDate?.getFullYear()).toBe(2027)
      expect(result.expirationDate?.getMonth()).toBe(5) // Junho
      expect(result.statusEHS).toBe('CONFORME')
    })

    it('deve extrair encerramento explícito em termo aditivo (caso José Marcelo)', () => {
      const text = `
        TERMO ADITIVO ao CONTRATO DE PRESTAÇÃO DE SERVIÇOS
        Cláusula 1ª. Mediante mútuo acordo, as partes decidem alterar as condições...
        Parágrafo Primeiro. As partes decidem prorrogar a vigência do Contrato por mais 12 (doze) meses, encerrando-se em 08/01/2027, podendo ser rescindido a qualquer momento...
        Sorocaba/SP, 8 de janeiro de 2026.
      `
      const filename =
        '04.1 - Aditivo ao Contrato - 08.01.2027 - JOSE MARCELO MAGALHAES SOUSA - Clicksign.pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('04.1')
      expect(result.source).toBe('PDF_CONTENT')
      expect(result.expirationDate).toBeDefined()
      expect(result.expirationDate?.getFullYear()).toBe(2027)
      expect(result.expirationDate?.getMonth()).toBe(0) // Janeiro
      expect(result.expirationDate?.getDate()).toBe(8)
      expect(result.statusEHS).toBe('CONFORME')
    })

    it('deve classificar como 40.1 termo aditivo sem prefixo numérico', () => {
      const text = `
        TERMO ADITIVO ao CONTRATO DE PRESTAÇÃO DE SERVIÇOS
        Parágrafo Primeiro. As partes decidem prorrogar a vigência do Contrato por mais 12 (doze) meses, encerrando-se em 08/01/2027...
      `
      const filename = 'Aditivo ao Contrato - Clicksign.pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('40.1')
      expect(result.source).toBe('PDF_CONTENT')
      expect(result.expirationDate?.getFullYear()).toBe(2027)
    })
  })

  describe('inspect - Certificados Normativos', () => {
    const refDate = new Date(2026, 8, 23) // 23/09/2026

    it('deve extrair conclusão e validade expressa em certificado GWO ART-H', () => {
      const text = `
        Certificado
        Certifico para os devidos fins que Francisco Thiago de Abreu
        participou do Curso GWO (Global Wind Organisation) – ART-H – Módulo Hub, Spinner e Blade
        de acordo com Norma GWO Versão 04, realizado no Centro de Treinamentos da Storz em Caucaia/CE,
        nos dias 07 e 08 de Janeiro de 2026, totalizando 07 horas/aula.
        Fortaleza, 08 de Janeiro de 2026.
        Treinamento válido por 02 (Dois) anos.
      `
      const filename = 'Francisco Thiago de Abreu - ART-H - Clicksign.pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('32') // GWO ART
      expect(result.source).toBe('PDF_CONTENT')
      expect(result.issueDate?.getFullYear()).toBe(2026)
      expect(result.issueDate?.getMonth()).toBe(0) // Janeiro
      expect(result.expirationDate?.getFullYear()).toBe(2028)
      expect(result.expirationDate?.getMonth()).toBe(0)
      expect(result.statusEHS).toBe('CONFORME')
    })

    it('deve extrair conclusão de NR-33 com validade de 1 ano', () => {
      const text = `
        Jose Marcelo Magalhães Sousa
        Concluiu com proficiência o treinamento NR33 Trabalhador e Vigia (Periódico)
        Concluido em 12 de Maio de 2025 realizado na empresa Storz Serviços Técnicos Ltda, em Caucaia/CE.
        Treinamento válido por 01 (Um) ano.
      `
      const filename = '20 – NR – 33 (Vigia F+R) – Jose Marcelo.pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('20')
      expect(result.issueDate?.getFullYear()).toBe(2025)
      expect(result.issueDate?.getMonth()).toBe(4) // Maio
      expect(result.expirationDate?.getFullYear()).toBe(2026)
      expect(result.expirationDate?.getMonth()).toBe(4) // Maio
      expect(result.statusEHS).toBe('VENCIDO') // Maio 2026 < refDate Setembro 2026
    })

    it('deve fazer fallback suave para o nome do arquivo se o texto for vazio/imagem', () => {
      const text = ''
      const filename =
        '14 – NR – 11 Uso de Talha – 24.06.24 – JOSE MARCELO MAGALHAES SOUSA - Clicksign.pdf'
      const result = PDFContentInspector.inspect(filename, text, refDate)

      expect(result.code).toBe('14')
      expect(result.source).toBe('FILENAME')
      expect(result.issueDate?.getFullYear()).toBe(2024)
      expect(result.expirationDate?.getFullYear()).toBe(2026)
    })
  })
})
