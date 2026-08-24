import { describe, it, expect } from 'vitest';
import { PRESENCIAL_REQUIRED_DOC_CODES, DOC_CATALOG_MAP } from './ComplianceEngine.js';

describe('PRESENCIAL_REQUIRED_DOC_CODES', () => {
  it('inclui ASO e NR-35, confirmado com o time de HSE', () => {
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('01')).toBe(true); // ASO
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('21')).toBe(true); // NR-35
  });

  it('inclui todas as variações de treinamento GWO do catálogo ("GWO geral")', () => {
    const gwoCodes = Object.entries(DOC_CATALOG_MAP)
      .filter(([, name]) => name.toUpperCase().includes('GWO'))
      .map(([code]) => code);

    expect(gwoCodes.length).toBeGreaterThan(0);
    for (const code of gwoCodes) {
      expect(PRESENCIAL_REQUIRED_DOC_CODES.has(code)).toBe(true);
    }
  });

  it('não inclui treinamentos que não foram confirmados como presenciais (ex.: LOTO, NR-10)', () => {
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('22')).toBe(false); // LOTO
    expect(PRESENCIAL_REQUIRED_DOC_CODES.has('12')).toBe(false); // NR-10 Básico
  });
});
