import { describe, expect, it } from 'vitest'
import {
  CertificateClassifier,
  startsWithDate,
  stripDatePrefix,
} from './CertificateClassifier.js'

describe('startsWithDate and stripDatePrefix', () => {
  it('identifica datas no início com diferentes separadores', () => {
    expect(startsWithDate('27 08 2026 Curso GWO ART...pdf')).toBe(true)
    expect(startsWithDate('30-08-2026_FRANCISCO_..._NR33...pdf')).toBe(true)
    expect(startsWithDate('26.05.2026 - Certificado CIPA.pdf')).toBe(true)
    expect(startsWithDate('2026-08-27 - Curso.pdf')).toBe(true)
    expect(startsWithDate('01 - ASO.pdf')).toBe(false)
    expect(startsWithDate('NR-35 Trabalho em Altura.pdf')).toBe(false)
  })

  it('remove prefixo de data mantendo o conteúdo da norma', () => {
    expect(stripDatePrefix('27 08 2026 Curso GWO ART.pdf')).toBe(
      'Curso GWO ART.pdf'
    )
    expect(stripDatePrefix('30-08-2026_FRANCISCO_NR33.pdf')).toBe(
      'FRANCISCO_NR33.pdf'
    )
  })
})

describe('CertificateClassifier.classify', () => {
  it('classifica GWO ART mesmo quando o arquivo começa com data', () => {
    const fn =
      '27 08 2026 Curso GWO (Global Wind Organisation) – ART-HR – Módulo Hub, Spinner e BladeReciclagem, de acordo com Norma GWO Versão 06 Lucas Franklin Falção Silva - ARTH-R.pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('32')
    expect(result.confidence).toBe('HIGH')
    expect(result.source).toBe('SEMANTIC')
  })

  it('classifica GWO ART módulo Nacelle/Torre', () => {
    const fn =
      '26 08 2026 Curso GWO (Global Wind Organisation) – ART-NR – Módulo Nacelle, Torre e Porão – Reciclagem, de acordo com Norma GWO Versão 06, Lucas Franklin Falcão Silva - ARTN-R.pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('32')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica NR-33 Trabalhador e Vigia mesmo com data e underscores', () => {
    const fn =
      '30-08-2026_FRANCISCO_GEORGE_MARTINS_SILVA_[STORZ]_-_NR33_TRABALHADOR_E_VIGIA_(PERIóDICO).pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('20')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica NR-33 Supervisor mesmo quando o arquivo físico tem prefixo de pasta 20', () => {
    const files = [
      '20 – NR – 33 (Supervisor F) – 03.11.2025 - Joao Elienai Ribeiro - Clicksign.pdf',
      '20 – NR – 33 (Supervisor F+R) – 10.09.2025 - Eraldo Antonio de Moura.pdf',
      '20 – NR – 33 (Supervisor Rec) - 06.02.2026 - Michel Platini Soares de Barros - Clicksign.pdf',
      '20 – NR – 33 (Supervisor) –  25.05.26 - Diego Patrick Sanches Campos.pdf',
      '26-07-2026_Antonio_Carvalho_Júnior_[STORZ]_-_NR33_SUPERVISOR_(PERIóDICO).pdf',
    ]

    for (const fn of files) {
      const result = CertificateClassifier.classify(fn)
      expect(result.code).toBe('28')
      expect(result.source).toBe('SEMANTIC')
    }
  })

  it('classifica NR-33 Vigia mantendo código 20 quando não há menção a Supervisor', () => {
    const files = [
      '20 – NR – 33 (Vigia F+R) –  28.12.2025 - Erika Naiane de Oliveira Honorato.pdf',
      '20 - NR 33 - 08-09-2026_Antonio_Rafael_Dos_Santos_[STORZ]_-_NR33_TRABALHADOR_E_VIGIA_(PERIóDICO) .pdf',
      '20 – NR – 33 (Trabalhador e Vigia) - Fulano.pdf',
    ]

    for (const fn of files) {
      const result = CertificateClassifier.classify(fn)
      expect(result.code).toBe('20')
    }
  })

  it('classifica NR-10 SEP com data e underscores sem confundir com Cód 27', () => {
    const fn =
      '27-08-2026_Emerson_Pallotta_Ribeiro_[STORZ]_-_NR10_-_CURSO_COMPLEMENTAR_-_SEGURANçA_NO_SISTORZA_ELéTRICO_DE_POTêNCIA_(SEP) (1).pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('13')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica NR-05 CIPA com data no início sem virar código Vestas', () => {
    const fn =
      '26-05-2026_Edward_Thiago_Herculano_Ribeiro_[STORZ]_-_NR5_-_CIPA_-_GRAU_DE_RISCO_3.pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('34')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica NR-12 com data no início sem virar código Direção Defensiva', () => {
    const fn =
      '09-09-2026_ADRIANO_CIRILO_GARCIA_LIMA_[STORZ]_-_NR12_-_SEGURANçA_NO_TRABALHO_EM_MáQUINAS_E_EQUIPAMENTOS_(GERAL)_(PERIóDICO).pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('15')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica NR-01 com data no início sem virar código NR-11', () => {
    const fn =
      '14-07-2026_Alison_Dos_Santos_Ribeiro_[STORZ]_-_NR1_-_DISPOSIçõES_GERAIS_E_GERENCIAMENTO_DE_RISCOS_OCUPACIONAIS.pdf'
    const result = CertificateClassifier.classify(fn)
    expect(result.code).toBe('10')
    expect(result.confidence).toBe('HIGH')
  })

  it('classifica arquivos sem prefixo numérico a partir do nome da norma', () => {
    expect(
      CertificateClassifier.classify('Certificado NR-35 Trabalho em Altura.pdf')
        .code
    ).toBe('21')
    expect(
      CertificateClassifier.classify('Exame_ASO_Admissional_Lucas.pdf').code
    ).toBe('01')
    expect(
      CertificateClassifier.classify('Comprovante_Vacina_Hepatite.pdf').code
    ).toBe('05')
  })

  it('classifica formato canônico clássico (XX - Nome)', () => {
    expect(
      CertificateClassifier.classify('01 - ASO - 29.05.2026 - Fulano.pdf').code
    ).toBe('01')
    expect(
      CertificateClassifier.classify('17 – NR 17 Carga Manual.pdf').code
    ).toBe('17')
  })

  it('dá preferência à semântica da norma caso haja divergência com prefixo digitado', () => {
    // Digitaram 14 (NR-11), mas o texto é claramente NR-10 Básico
    const result = CertificateClassifier.classify(
      '14 - NR-10 Básico - Instalações Elétricas.pdf'
    )
    expect(result.code).toBe('12')
    expect(result.source).toBe('SEMANTIC')
  })

  it('retorna null (quarentena) para arquivos genéricos/ambíguos sem identificação', () => {
    const result = CertificateClassifier.classify('documento_digitalizado.pdf')
    expect(result.code).toBeNull()
    expect(result.confidence).toBe('NONE')
  })

  it('ignora desktop.ini', () => {
    expect(CertificateClassifier.classify('desktop.ini').code).toBeNull()
  })
})
