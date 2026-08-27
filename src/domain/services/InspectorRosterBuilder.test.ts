import { describe, it, expect } from 'vitest';
import { buildRoster } from './InspectorRosterBuilder.js';
import { Inspector, Certificate } from '../models/Certificate.js';

function cert(code: string, expirationDate: Date): Certificate {
  return { code, name: `Doc ${code}`, expirationDate, statusEHS: 'CONFORME' };
}

function inspector(name: string, role: string, certs: Certificate[] = [], extra: Partial<Inspector> = {}): Inspector {
  return { id: name, name, role, certificates: new Map(certs.map((c) => [c.code, c])), ...extra };
}

describe('buildRoster', () => {
  it('exclui desligados (FUNÇÃO = DE) do resultado', () => {
    const rpo = [inspector('JOAO SILVA', 'DE'), inspector('MARIA SOUZA', 'IQ')];
    const roster = buildRoster(rpo, []);

    expect(roster).toHaveLength(1);
    expect(roster[0].inspector.name).toBe('MARIA SOUZA');
  });

  it('classifica perfil CAMPO com pacote completo de documentos', () => {
    const rpo = [inspector('MARIA SOUZA', 'IQ')];
    const roster = buildRoster(rpo, []);

    expect(roster[0].profile).toBe('CAMPO');
    expect(roster[0].requiredDocCodes.length).toBeGreaterThan(1);
  });

  it('classifica perfil ADMINISTRATIVO com pacote básico (ex.: Jessica visibilidade)', () => {
    const rpo = [inspector('JESSICA ALVES DA SILVA', 'ADM')];
    const roster = buildRoster(rpo, []);

    expect(roster[0].profile).toBe('ADMINISTRATIVO');
    expect(roster[0].requiredDocCodes).toEqual(['01', '34']); // ASO + CIPA (eletivo, só conta pra quem for membro)
    expect(roster[0].hasDriveFolder).toBe(false);
  });

  it('inclui pessoa administrativa mesmo sem pasta no Drive, usando dados da RPO', () => {
    const rpo = [inspector('JESSICA ALVES DA SILVA', 'ADM', [cert('01', new Date(2027, 0, 1))])];
    const roster = buildRoster(rpo, []); // sem pasta no Drive

    expect(roster).toHaveLength(1);
    expect(roster[0].inspector.certificates.get('01')).toBeDefined();
  });

  it('mescla certificados do Drive por cima dos da RPO quando a pessoa tem pasta', () => {
    const rpoDate = new Date(2026, 5, 1);
    const driveDate = new Date(2027, 5, 1);
    const rpo = [inspector('CARLOS PEREIRA', 'IQ', [cert('01', rpoDate)])];
    const drive = [inspector('CARLOS PEREIRA', 'INSP. DE QUALIDADE', [cert('01', driveDate)])];

    const roster = buildRoster(rpo, drive);

    expect(roster[0].hasDriveFolder).toBe(true);
    expect(roster[0].inspector.certificates.get('01')?.expirationDate).toEqual(driveDate);
  });

  describe('Contrato PJ (código 40) / Aditivo (40.1) — pedido do usuário em 27/08/2026', () => {
    it('CAMPO + PJ exige o código 40 (Contrato) além do pacote normal', () => {
      const rpo = [inspector('PILOTO PJ', 'IE', [], { employmentType: 'PJ' })];
      const roster = buildRoster(rpo, []);

      expect(roster[0].requiredDocCodes).toContain('40');
    });

    it('CAMPO + CLT NÃO exige o código 40 — contrato PJ não se aplica', () => {
      const rpo = [inspector('TECNICO CLT', 'TO', [], { employmentType: 'CLT' })];
      const roster = buildRoster(rpo, []);

      expect(roster[0].requiredDocCodes).not.toContain('40');
    });

    it('quando só existe o Contrato (40), usa o prazo dele', () => {
      const contratoDate = new Date(2026, 2, 6);
      const drive = [inspector('PILOTO PJ', 'IE', [cert('40', contratoDate)])];
      const rpo = [inspector('PILOTO PJ', 'IE', [], { employmentType: 'PJ' })];

      const roster = buildRoster(rpo, drive);

      expect(roster[0].inspector.certificates.get('40')?.expirationDate).toEqual(contratoDate);
    });

    it('quando existe Contrato (40) E Aditivo (40.1), o Aditivo substitui o prazo do contrato', () => {
      const contratoDate = new Date(2023, 2, 6);
      const aditivoDate = new Date(2027, 0, 15);
      const drive = [inspector('PILOTO PJ', 'IE', [cert('40', contratoDate), cert('40.1', aditivoDate)])];
      const rpo = [inspector('PILOTO PJ', 'IE', [], { employmentType: 'PJ' })];

      const roster = buildRoster(rpo, drive);

      const merged = roster[0].inspector.certificates.get('40');
      expect(merged?.expirationDate).toEqual(aditivoDate);
      expect(merged?.code).toBe('40'); // continua sob o código exigido, não '40.1'
    });
  });
});
