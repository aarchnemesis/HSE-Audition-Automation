import { describe, it, expect } from 'vitest';
import { AuditTriangulator } from './AuditTriangulator.js';
import { Inspector, Certificate, ParkRequirement } from '../models/Certificate.js';
import { StorzRequest } from '../models/StorzRequest.js';

const REF_DATE = new Date(2026, 7, 19);

function makeCert(code: string, expirationDate?: Date): Certificate {
  return {
    code,
    name: `Doc ${code}`,
    expirationDate,
    statusEHS: 'CONFORME',
    modality: 'PRESENCIAL'
  };
}

function makeInspector(certs: Certificate[]): Inspector {
  const certificates = new Map(certs.map((c) => [c.code, c]));
  return { id: '1', name: 'FULANO DE TAL', role: 'TÉCNICO', certificates };
}

const PARK: ParkRequirement = {
  id: 'p1',
  parkName: 'Parque Teste',
  clientName: 'Cliente Teste',
  description: '',
  requiredDocCodes: ['21']
};

const FAR_FUTURE = new Date(2028, 0, 1);
const NEAR_EXPIRY = new Date(2026, 7, 25); // 6 dias após REF_DATE -> VENCE_07

describe('AuditTriangulator — auditoria de vencimentos', () => {
  it('marca APTO quando o único documento exigido está em dia', () => {
    const inspector = makeInspector([makeCert('21', FAR_FUTURE)]);
    const result = AuditTriangulator.performTripleAudit(inspector, PARK, [], REF_DATE);

    expect(result.auditItems[0].status).toBe('CONFORME');
    expect(result.overallStatus).toBe('APTO');
    expect(result.validDocsCount).toBe(1);
  });

  it('marca INAPTO quando o documento exigido está ausente', () => {
    const inspector = makeInspector([]);
    const result = AuditTriangulator.performTripleAudit(inspector, PARK, [], REF_DATE);

    expect(result.auditItems[0].status).toBe('AUSENTE');
    expect(result.overallStatus).toBe('INAPTO');
    expect(result.missingDocsCount).toBe(1);
  });

  it('promove para SOLICITADO_STORZ quando o curso na Storz ainda não foi iniciado (state SOLICITADO)', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)]);
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'SOLICITADO'
      }
    ];

    const result = AuditTriangulator.performTripleAudit(inspector, PARK, storzRequests, REF_DATE);

    expect(result.auditItems[0].status).toBe('SOLICITADO_STORZ');
    expect(result.storzPendingCount).toBe(1);
    expect(result.storzInProgressCount).toBe(0);
    expect(result.overallStatus).toBe('APTO_COM_ATENCAO');
  });

  it('promove para STORZ_EM_ANDAMENTO quando o curso já foi iniciado mas ainda não concluído (state EM_ANDAMENTO)', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)]);
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'EM_ANDAMENTO'
      }
    ];

    const result = AuditTriangulator.performTripleAudit(inspector, PARK, storzRequests, REF_DATE);

    expect(result.auditItems[0].status).toBe('STORZ_EM_ANDAMENTO');
    expect(result.storzInProgressCount).toBe(1);
    expect(result.storzPendingCount).toBe(0);
    expect(result.overallStatus).toBe('APTO_COM_ATENCAO');
  });

  it('ignora solicitações CANCELADO na Storz (trata como se não houvesse solicitação)', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)]);
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'CANCELADO'
      }
    ];

    const result = AuditTriangulator.performTripleAudit(inspector, PARK, storzRequests, REF_DATE);

    expect(result.auditItems[0].status).toBe('VENCE_07');
    expect(result.storzPendingCount).toBe(0);
    expect(result.warningDocsCount).toBe(1);
  });

  it('não busca na Storz documentos que ela não administra (ex.: ASO), mesmo que exista um registro coincidente por engano', () => {
    const parkAso: ParkRequirement = { ...PARK, requiredDocCodes: ['01'] };
    const inspector = makeInspector([makeCert('01', NEAR_EXPIRY)]);
    // Registro "coincidente" — não deveria nunca influenciar o status de um documento não-Storz
    const storzRequests: StorzRequest[] = [
      { id: 'REQ-X', collaboratorName: 'FULANO DE TAL', trainingCode: '01', trainingName: 'Algo', modality: 'PRESENCIAL', requestDate: new Date(), state: 'SOLICITADO' }
    ];

    const result = AuditTriangulator.performTripleAudit(inspector, parkAso, storzRequests, REF_DATE);

    expect(result.auditItems[0].status).toBe('VENCE_07');
    expect(result.auditItems[0].storzRequestFound).toBeUndefined();
    expect(result.storzPendingCount).toBe(0);
  });

  it('sinaliza incompatibilidade de modalidade sem mudar o status EHS', () => {
    const parkPresencial: ParkRequirement = {
      ...PARK,
      requiredModalities: { '21': 'PRESENCIAL' }
    };
    const cert = { ...makeCert('21', FAR_FUTURE), modality: 'ONLINE' as const };
    const inspector = makeInspector([cert]);

    const result = AuditTriangulator.performTripleAudit(inspector, parkPresencial, [], REF_DATE);

    expect(result.auditItems[0].isModalityCompliant).toBe(false);
    expect(result.auditItems[0].status).toBe('CONFORME');
    expect(result.auditItems[0].detail).toContain('ALERTA MODALIDADE');
  });
});
