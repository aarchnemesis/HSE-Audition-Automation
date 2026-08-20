import { describe, it, expect } from 'vitest';
import { classifyEmployeeProfile, getRequiredDocCodesForProfile } from './EmployeeProfileClassifier.js';

describe('classifyEmployeeProfile', () => {
  it('classifica códigos de campo (IQ, TO, LO, IE, CO) como CAMPO', () => {
    for (const code of ['IQ', 'TO', 'LO', 'IE', 'CO']) {
      expect(classifyEmployeeProfile(code)).toBe('CAMPO');
    }
  });

  it('classifica códigos administrativos (ADM, EHS, ENG, DO, DS) como ADMINISTRATIVO', () => {
    for (const code of ['ADM', 'EHS', 'ENG', 'DO', 'DS']) {
      expect(classifyEmployeeProfile(code)).toBe('ADMINISTRATIVO');
    }
  });

  it('retorna null para DE (desligado) — deve ser excluído da auditoria', () => {
    expect(classifyEmployeeProfile('DE')).toBeNull();
  });

  it('usa ADMINISTRATIVO como padrão seguro para códigos desconhecidos ou em branco', () => {
    expect(classifyEmployeeProfile('-')).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile('*')).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile(undefined)).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile('')).toBe('ADMINISTRATIVO');
  });

  it('é case-insensitive', () => {
    expect(classifyEmployeeProfile('iq')).toBe('CAMPO');
    expect(classifyEmployeeProfile('de')).toBeNull();
  });
});

describe('getRequiredDocCodesForProfile', () => {
  it('CAMPO exige o pacote completo', () => {
    const codes = getRequiredDocCodesForProfile('CAMPO');
    expect(codes).toContain('21'); // NR-35
    expect(codes).toContain('01'); // ASO
    expect(codes.length).toBeGreaterThan(1);
  });

  it('ADMINISTRATIVO exige só o básico (ASO)', () => {
    const codes = getRequiredDocCodesForProfile('ADMINISTRATIVO');
    expect(codes).toEqual(['01']);
  });
});
