import { describe, it, expect } from 'vitest';
import { DriveRpoAuditor } from './DriveRpoAuditor.js';
import { Inspector, Certificate } from '../models/Certificate.js';
import { StorzRequest } from '../models/StorzRequest.js';

function makeCert(code: string, expirationDate: Date): Certificate {
  return { code, name: `Doc ${code}`, expirationDate, statusEHS: 'CONFORME' };
}

function makeInspector(name: string, certs: Certificate[]): Inspector {
  return { id: name, name, role: 'TÉCNICO', certificates: new Map(certs.map((c) => [c.code, c])) };
}

function makeStorzRequest(overrides: Partial<StorzRequest>): StorzRequest {
  return {
    id: 'REQ-1',
    collaboratorName: 'FULANO',
    trainingCode: '21',
    trainingName: 'NR-35',
    modality: 'PRESENCIAL',
    requestDate: new Date(2026, 0, 1),
    state: 'CONCLUIDO',
    ...overrides
  };
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

  it('usa a validade estimada da Storz (curso concluído) como fonte confiável quando não há Drive', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [makeCert('21', new Date(2028, 0, 15))])]; // NR-35, 2 anos de validade
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })]; // conclusão -> expira 2028-01-15

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz);
    expect(result).toHaveLength(1);
    expect(result[0].trustedSource).toBe('STORZ');
    expect(result[0].divergent).toBe(false);
  });

  it('marca SOMENTE_STORZ quando o curso foi concluído na Storz mas não há registro na RPO', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [])];
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })];

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz);
    expect(result).toHaveLength(1);
    expect(result[0].divergenceKind).toBe('SOMENTE_STORZ');
  });

  it('marca DATA_DIVERGENTE entre Storz (estimado) e RPO quando diferem além da tolerância — provável erro de digitação', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [makeCert('21', new Date(2027, 5, 15))])]; // RPO digitou errado, ~1.5 ano de diferença
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })]; // -> expira 2028-01-15

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz);
    expect(result).toHaveLength(1);
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE');
    expect(result[0].trustedSource).toBe('STORZ');
  });

  it('prioriza o Drive sobre a Storz quando as duas fontes confiáveis existem', () => {
    const drive = [makeInspector('FULANO', [makeCert('21', new Date(2027, 0, 10))])];
    const rpo = [makeInspector('FULANO', [makeCert('21', new Date(2027, 0, 10))])];
    const storz = [makeStorzRequest({ completionDate: new Date(2020, 0, 1) })]; // bem diferente, não deve ser usado

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz);
    expect(result).toHaveLength(1);
    expect(result[0].trustedSource).toBe('DRIVE');
    expect(result[0].divergent).toBe(false);
  });

  it('ignora conclusão na Storz pra código que a Storz não administra (ex.: ASO)', () => {
    const drive = [makeInspector('FULANO', [])];
    const rpo = [makeInspector('FULANO', [])];
    const storz = [makeStorzRequest({ trainingCode: '01', completionDate: new Date(2026, 0, 15) })];

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'], storz);
    expect(result).toHaveLength(0);
  });
});
