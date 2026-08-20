import { describe, it, expect } from 'vitest';
import { parseDateFromFilename, parseDocCode, calculateDocExpiration } from './certificateFilenameParser.js';

describe('parseDocCode', () => {
  it('extrai o código de 2 dígitos do início do nome do arquivo', () => {
    expect(parseDocCode('01 - ASO - 29.05.2026 - Fulano.pdf')).toBe('01');
    expect(parseDocCode('21 - NR-35.pdf')).toBe('21');
  });

  it('normaliza código de 1 dígito com zero à esquerda', () => {
    expect(parseDocCode('9 - Direção Defensiva.pdf')).toBe('09');
  });

  it('ignora desktop.ini', () => {
    expect(parseDocCode('desktop.ini')).toBeNull();
  });
});

describe('parseDateFromFilename', () => {
  it('parseia data dd.mm.yyyy do nome do arquivo', () => {
    const date = parseDateFromFilename('01 - ASO - 29.05.2026 - Fulano.pdf');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(4);
    expect(date?.getDate()).toBe(29);
  });

  it('retorna null quando não há data no nome', () => {
    expect(parseDateFromFilename('01 - ASO - Fulano.pdf')).toBeNull();
  });
});

describe('calculateDocExpiration', () => {
  const REF_DATE = new Date(2026, 7, 20);

  it('usa a própria data do arquivo quando ainda é futura (já é a validade, não a emissão)', () => {
    const future = new Date(2027, 0, 1);
    expect(calculateDocExpiration('01', future, REF_DATE)).toEqual(future);
  });

  it('códigos anuais (ex. ASO) somam 1 ano à data de emissão passada', () => {
    const issued = new Date(2026, 0, 1); // passado em relação à REF_DATE
    const exp = calculateDocExpiration('01', issued, REF_DATE);
    expect(exp?.getFullYear()).toBe(2027);
  });

  it('códigos padrão (ex. NR-35, código 21) somam 2 anos', () => {
    const issued = new Date(2026, 0, 1);
    const exp = calculateDocExpiration('21', issued, REF_DATE);
    expect(exp?.getFullYear()).toBe(2028);
  });

  it('NR-01 (código 10) e NR-06 (código 11) não têm validade fixa — tratados como válidos por muito tempo (50 anos)', () => {
    const issued = new Date(2020, 0, 1);
    const exp10 = calculateDocExpiration('10', issued, REF_DATE);
    const exp11 = calculateDocExpiration('11', issued, REF_DATE);
    expect(exp10?.getFullYear()).toBe(2070);
    expect(exp11?.getFullYear()).toBe(2070);
  });

  it('retorna undefined quando não há data parseada', () => {
    expect(calculateDocExpiration('01', null, REF_DATE)).toBeUndefined();
  });
});
