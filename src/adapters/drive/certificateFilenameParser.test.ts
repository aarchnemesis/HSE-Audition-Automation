import { describe, expect, it } from 'vitest'
import {
  calculateDocExpiration,
  parseDateFromFilename,
  parseDocCode,
} from './certificateFilenameParser.js'

describe('parseDocCode', () => {
  it('extrai o código de 2 dígitos do início do nome do arquivo', () => {
    expect(parseDocCode('01 - ASO - 29.05.2026 - Fulano.pdf')).toBe('01')
    expect(parseDocCode('21 - NR-35.pdf')).toBe('21')
  })

  it('normaliza código de 1 dígito com zero à esquerda', () => {
    expect(parseDocCode('9 - Direção Defensiva.pdf')).toBe('09')
  })

  it('ignora desktop.ini', () => {
    expect(parseDocCode('desktop.ini')).toBeNull()
  })

  it('extrai sub-código com ponto (ex.: Aditivo ao Contrato, código real "04.1" na pasta de pilotos)', () => {
    expect(
      parseDocCode(
        '04.1 - Aditivo ao Contrato - 15.01.2027 - Fulano - Clicksign.pdf'
      )
    ).toBe('04.1')
    expect(
      parseDocCode('04 - Contrato (Piloto Drone)– 06.03.23 – Fulano.pdf')
    ).toBe('04')
  })

  it('classifica corretamente arquivos que começam com data (não confunde dia com código)', () => {
    expect(
      parseDocCode(
        '27 08 2026 Curso GWO (Global Wind Organisation) – ART-HR – Módulo Hub.pdf'
      )
    ).toBe('32')
    expect(
      parseDocCode(
        '30-08-2026_FRANCISCO_GEORGE_[STORZ]_-_NR33_TRABALHADOR_E_VIGIA.pdf'
      )
    ).toBe('20')
  })
})

describe('parseDateFromFilename', () => {
  it('parseia data dd.mm.yyyy do nome do arquivo', () => {
    const date = parseDateFromFilename('01 - ASO - 29.05.2026 - Fulano.pdf')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(4)
    expect(date?.getDate()).toBe(29)
  })

  it('parseia data com espaços como separadores (dd mm yyyy)', () => {
    const date = parseDateFromFilename(
      '27 08 2026 Curso GWO ART Lucas Franklin.pdf'
    )
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(7)
    expect(date?.getDate()).toBe(27)
  })

  it('parseia data antes de underscore (ex.: 30-08-2026_NOME)', () => {
    const date = parseDateFromFilename(
      '30-08-2026_FRANCISCO_GEORGE_MARTINS_SILVA.pdf'
    )
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(7)
    expect(date?.getDate()).toBe(30)
  })

  it('parseia data em formato ISO (yyyy-mm-dd)', () => {
    const date = parseDateFromFilename('2026-08-27 - Curso GWO.pdf')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(7)
    expect(date?.getDate()).toBe(27)
  })

  it('retorna null quando não há data no nome', () => {
    expect(parseDateFromFilename('01 - ASO - Fulano.pdf')).toBeNull()
  })
})

describe('calculateDocExpiration', () => {
  const REF_DATE = new Date(2026, 7, 20)

  it('usa a própria data do arquivo quando ainda é futura (já é a validade, não a emissão)', () => {
    const future = new Date(2027, 0, 1)
    expect(calculateDocExpiration('01', future, REF_DATE)).toEqual(future)
  })

  it('códigos anuais (ex. ASO, NR-33 Vigia, NR-33 Sup, CIPA) somam 1 ano à data de emissão passada', () => {
    const issued = new Date(2026, 0, 1) // passado em relação à REF_DATE
    expect(calculateDocExpiration('01', issued, REF_DATE)?.getFullYear()).toBe(
      2027
    )
    expect(calculateDocExpiration('20', issued, REF_DATE)?.getFullYear()).toBe(
      2027
    )
    expect(calculateDocExpiration('28', issued, REF_DATE)?.getFullYear()).toBe(
      2027
    )
    expect(calculateDocExpiration('34', issued, REF_DATE)?.getFullYear()).toBe(
      2027
    )
  })

  it('códigos padrão (ex. NR-11, NR-12, NR-18, NR-35) somam 2 anos', () => {
    const issued = new Date(2026, 0, 1)
    expect(calculateDocExpiration('14', issued, REF_DATE)?.getFullYear()).toBe(
      2028
    )
    expect(calculateDocExpiration('15', issued, REF_DATE)?.getFullYear()).toBe(
      2028
    )
    expect(calculateDocExpiration('18', issued, REF_DATE)?.getFullYear()).toBe(
      2028
    )
    expect(calculateDocExpiration('21', issued, REF_DATE)?.getFullYear()).toBe(
      2028
    )
  })

  it('NR-01 (código 10) e NR-06 (código 11) não têm validade fixa — tratados como válidos por muito tempo (50 anos)', () => {
    const issued = new Date(2020, 0, 1)
    const exp10 = calculateDocExpiration('10', issued, REF_DATE)
    const exp11 = calculateDocExpiration('11', issued, REF_DATE)
    expect(exp10?.getFullYear()).toBe(2070)
    expect(exp11?.getFullYear()).toBe(2070)
  })

  it('retorna undefined quando não há data parseada', () => {
    expect(calculateDocExpiration('01', null, REF_DATE)).toBeUndefined()
  })

  it('Contrato PJ (40) e Aditivo (40.1) usam a data do arquivo direto como prazo, mesmo se já passou — confirmado pelo usuário em 27/08/2026 que a data no nome já é o vencimento, não a emissão', () => {
    const past = new Date(2023, 2, 6) // bem antes da REF_DATE
    expect(calculateDocExpiration('40', past, REF_DATE)).toEqual(past)
    expect(calculateDocExpiration('40.1', past, REF_DATE)).toEqual(past)
  })
})
