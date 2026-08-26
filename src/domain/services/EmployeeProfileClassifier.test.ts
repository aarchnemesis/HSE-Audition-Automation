import { describe, it, expect } from 'vitest';
import { classifyEmployeeProfile, getRequiredDocCodesForProfile, getElectiveDocCodesForProfile } from './EmployeeProfileClassifier.js';
import { DOC_CATALOG_MAP } from './ComplianceEngine.js';

describe('classifyEmployeeProfile', () => {
  it('classifica códigos de campo (IQ, TO, LO, IE) como CAMPO', () => {
    for (const code of ['IQ', 'TO', 'LO', 'IE']) {
      expect(classifyEmployeeProfile(code)).toBe('CAMPO');
    }
  });

  it('classifica CO (Coordenador) como COORDENADOR, não CAMPO — perfil próprio desde 25/08/2026 (caso real: João Victor Costa Campos)', () => {
    expect(classifyEmployeeProfile('CO')).toBe('COORDENADOR');
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

  it('ramo homogêneo da RPO decide o perfil, mesmo com FUNÇÃO ambígua/desconhecida', () => {
    expect(classifyEmployeeProfile('XYZ', 'INSP. QUALIDADE & TÉC. OPERAÇÕES')).toBe('CAMPO');
    expect(classifyEmployeeProfile('XYZ', 'DRONE INSP. EQUIPAMENTO')).toBe('CAMPO');
    expect(classifyEmployeeProfile('XYZ', 'LPS - SPDA')).toBe('CAMPO');
    expect(classifyEmployeeProfile('XYZ', 'ENGENHARIA')).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile('XYZ', 'ADMINISTRATIVO')).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile('XYZ', 'VISIBILIDADE')).toBe('ADMINISTRATIVO');
  });

  it('ramo "LÍDERES / EHS" é misto — não decide sozinho, cai no fallback por FUNÇÃO', () => {
    expect(classifyEmployeeProfile('LO', 'LÍDERES / EHS')).toBe('CAMPO');
    expect(classifyEmployeeProfile('ADM', 'LÍDERES / EHS')).toBe('ADMINISTRATIVO');
    expect(classifyEmployeeProfile('CO', 'LÍDERES / EHS')).toBe('COORDENADOR');
  });

  it('CO (Coordenador) tem prioridade sobre o ramo — coordenador é sempre COORDENADOR, não importa em qual ramo esteja', () => {
    expect(classifyEmployeeProfile('CO', 'INSP. QUALIDADE & TÉC. OPERAÇÕES')).toBe('COORDENADOR');
    expect(classifyEmployeeProfile('CO', 'ADMINISTRATIVO')).toBe('COORDENADOR');
  });

  it('DE (desligado) tem prioridade sobre o ramo — desligado é sempre excluído, não importa o ramo', () => {
    expect(classifyEmployeeProfile('DE', 'INSP. QUALIDADE & TÉC. OPERAÇÕES')).toBeNull();
  });
});

describe('getRequiredDocCodesForProfile', () => {
  it('CAMPO exige o pacote completo', () => {
    const codes = getRequiredDocCodesForProfile('CAMPO');
    expect(codes).toContain('21'); // NR-35
    expect(codes).toContain('01'); // ASO
    expect(codes.length).toBeGreaterThan(1);
  });

  it('ADMINISTRATIVO exige o básico (ASO) mais CIPA, que é eletivo — só conta pra quem for membro (código 34)', () => {
    const codes = getRequiredDocCodesForProfile('ADMINISTRATIVO');
    expect(codes).toEqual(['01', '34']);
  });

  it('CAMPO cobre todas as variações de GWO do catálogo, não só uma (regressão: só WINDA ID aparecia antes)', () => {
    const gwoCodes = Object.entries(DOC_CATALOG_MAP)
      .filter(([, name]) => name.toUpperCase().includes('GWO'))
      .map(([code]) => code);
    const codes = getRequiredDocCodesForProfile('CAMPO');

    expect(gwoCodes.length).toBeGreaterThanOrEqual(5); // 16,17,19,21,30,32 no catálogo atual
    for (const code of gwoCodes) {
      expect(codes).toContain(code);
    }
  });

  it('ADMINISTRATIVO + PJ não exige nenhum documento — ASO é sobre risco de campo ou vínculo CLT, PJ+ADM não tem nenhum dos dois (confirmado com HSE em 22/08/2026)', () => {
    expect(getRequiredDocCodesForProfile('ADMINISTRATIVO', 'PJ')).toEqual([]);
    expect(getRequiredDocCodesForProfile('ADMINISTRATIVO', 'pj')).toEqual([]); // case-insensitive
  });

  it('ADMINISTRATIVO + CLT continua exigindo ASO (obrigação legal da CLT independente da função)', () => {
    expect(getRequiredDocCodesForProfile('ADMINISTRATIVO', 'CLT')).toEqual(['01', '34']);
  });

  it('CAMPO exige ASO mesmo sendo PJ — o motivo é a atividade de risco no parque, não o vínculo', () => {
    const codes = getRequiredDocCodesForProfile('CAMPO', 'PJ');
    expect(codes).toContain('01');
  });

  it('CAMPO inclui os eletivos Elevador (JASO, 31) e CIPA (34) — não são obrigatórios de fato (ELECTIVE_DOC_CODES), mas precisam estar na lista pra aparecer quando a pessoa TEM o documento', () => {
    const codes = getRequiredDocCodesForProfile('CAMPO');
    expect(codes).toContain('31');
    expect(codes).toContain('34');
  });

  it('COORDENADOR exige ASO e monitora o resto do catálogo de campo (confirmado 25/08/2026, caso real: João Victor Costa Campos)', () => {
    const codes = getRequiredDocCodesForProfile('COORDENADOR');
    expect(codes).toContain('01');
    expect(codes).toContain('21'); // NR-35 aparece se a pessoa tiver, mas é monitorado — ver getElectiveDocCodesForProfile
  });

  it('COORDENADOR + PJ não exige nada — sem o mesmo motivo de exposição a risco do perfil CAMPO', () => {
    expect(getRequiredDocCodesForProfile('COORDENADOR', 'PJ')).toEqual([]);
  });
});

describe('getElectiveDocCodesForProfile', () => {
  it('COORDENADOR trata todo o catálogo de treinamentos como monitoramento, exceto ASO', () => {
    const elective = getElectiveDocCodesForProfile('COORDENADOR');
    expect(elective).toContain('21'); // NR-35
    expect(elective).toContain('12'); // NR-10
    expect(elective).not.toContain('01'); // ASO continua obrigatório de verdade
  });

  it('CAMPO usa o conjunto eletivo global (Vestas, Elevador, CIPA) — NR-35 continua obrigatório de verdade', () => {
    const elective = getElectiveDocCodesForProfile('CAMPO');
    expect(elective).toContain('25'); // SIT Vestas
    expect(elective).toContain('31'); // Elevador
    expect(elective).toContain('34'); // CIPA
    expect(elective).not.toContain('21'); // NR-35 NÃO é eletivo pro perfil CAMPO
  });
});
