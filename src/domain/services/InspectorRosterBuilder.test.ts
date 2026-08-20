import { describe, it, expect } from 'vitest';
import { buildRoster } from './InspectorRosterBuilder.js';
import { Inspector, Certificate } from '../models/Certificate.js';

function cert(code: string, expirationDate: Date): Certificate {
  return { code, name: `Doc ${code}`, expirationDate, statusEHS: 'CONFORME' };
}

function inspector(name: string, role: string, certs: Certificate[] = []): Inspector {
  return { id: name, name, role, certificates: new Map(certs.map((c) => [c.code, c])) };
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
    expect(roster[0].requiredDocCodes).toEqual(['01']);
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
});
