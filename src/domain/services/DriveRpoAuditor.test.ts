import { describe, it, expect } from 'vitest';
import { DriveRpoAuditor } from './DriveRpoAuditor.js';
import { Inspector, Certificate } from '../models/Certificate.js';

function makeCert(code: string, expirationDate: Date): Certificate {
  return { code, name: `Doc ${code}`, expirationDate, statusEHS: 'CONFORME' };
}

function makeInspector(name: string, certs: Certificate[]): Inspector {
  return { id: name, name, role: 'TÉCNICO', certificates: new Map(certs.map((c) => [c.code, c])) };
}

describe('DriveRpoAuditor.compare', () => {
  it('não reporta nada quando as datas batem (dentro da tolerância)', () => {
    const drive = [makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))])];
    const rpo = [makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 11))])]; // 1 dia de diferença

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(1);
    expect(result[0].divergent).toBe(false);
  });

  it('marca SOMENTE_DRIVE quando o certificado só existe no Drive', () => {
    const drive = [makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))])];
    const rpo = [makeInspector('FULANO', [])];

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(1);
    expect(result[0].divergenceKind).toBe('SOMENTE_DRIVE');
  });

  it('marca SOMENTE_RPO quando o certificado só existe na planilha', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))])];

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(1);
    expect(result[0].divergenceKind).toBe('SOMENTE_RPO');
  });

  it('marca DATA_DIVERGENTE quando as datas diferem além da tolerância', () => {
    const drive = [makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))])];
    const rpo = [makeInspector('FULANO', [makeCert('01', new Date(2027, 2, 10))])]; // ~2 meses de diferença

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(1);
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE');
  });

  it('não gera item quando o documento está ausente nas duas fontes', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [])];

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(0);
  });

  it('casa inspetor do Drive com o da RPO por substring de nome', () => {
    const drive = [makeInspector('FULANO DE TAL', [makeCert('01', new Date(2027, 0, 10))])];
    const rpo = [makeInspector('Fulano de Tal - Solicitação', [makeCert('01', new Date(2027, 0, 10))])];

    const result = DriveRpoAuditor.compare(drive, rpo, ['01']);
    expect(result).toHaveLength(1);
    expect(result[0].divergent).toBe(false);
  });
});
