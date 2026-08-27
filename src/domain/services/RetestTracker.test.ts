import { describe, it, expect } from 'vitest';
import { groupRetests } from './RetestTracker.js';
import { StorzRequest } from '../models/StorzRequest.js';

function makeReq(overrides: Partial<StorzRequest>): StorzRequest {
  return {
    id: 'REQ-1',
    collaboratorName: 'FULANO',
    trainingCode: '20',
    trainingName: 'NR-33',
    modality: 'PRESENCIAL',
    requestDate: new Date(2026, 0, 1),
    state: 'CONCLUIDO',
    ...overrides
  };
}

describe('groupRetests', () => {
  it('marca retestApproved quando reprovou e depois passou', () => {
    const requests = [
      makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
      makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Aprovado' })
    ];

    const groups = groupRetests(requests);
    expect(groups).toHaveLength(1);
    expect(groups[0].hasFailedAttempt).toBe(true);
    expect(groups[0].retestApproved).toBe(true);
    expect(groups[0].pendingRetest).toBe(false);
    expect(groups[0].attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
  });

  it('marca pendingRetest quando reprovou e ainda não tem reteste aprovado', () => {
    const requests = [
      makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' })
    ];

    const groups = groupRetests(requests);
    expect(groups[0].hasFailedAttempt).toBe(true);
    expect(groups[0].pendingRetest).toBe(true);
    expect(groups[0].retestApproved).toBe(false);
  });

  it('pendingRetest continua true se reprovou de novo no reteste', () => {
    const requests = [
      makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
      makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Reprovado' })
    ];

    const groups = groupRetests(requests);
    expect(groups[0].pendingRetest).toBe(true);
    expect(groups[0].retestApproved).toBe(false);
  });

  it('não marca hasFailedAttempt quando nunca reprovou', () => {
    const requests = [
      makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Aprovado' })
    ];

    const groups = groupRetests(requests);
    expect(groups[0].hasFailedAttempt).toBe(false);
    expect(groups[0].pendingRetest).toBe(false);
    expect(groups[0].retestApproved).toBe(false);
  });

  it('agrupa separadamente por pessoa e por código de curso', () => {
    const requests = [
      makeReq({ id: 'A', collaboratorName: 'FULANO', trainingCode: '20' }),
      makeReq({ id: 'B', collaboratorName: 'FULANO', trainingCode: '28' }),
      makeReq({ id: 'C', collaboratorName: 'CICLANO', trainingCode: '20' })
    ];

    const groups = groupRetests(requests);
    expect(groups).toHaveLength(3);
  });

  describe('retestStage — 3 etapas pedidas pelo usuário em 26/08/2026', () => {
    it('AGUARDANDO_RETESTE: reprovou e não tem nenhuma rematrícula ativa ainda', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].retestStage).toBe('AGUARDANDO_RETESTE');
    });

    it('AGUARDANDO_RETESTE também quando a rematrícula existe mas ainda não começou (Não iniciado)', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Não iniciado' })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].retestStage).toBe('AGUARDANDO_RETESTE');
    });

    it('RETESTE_EM_ANDAMENTO: reprovou e já está fazendo o mesmo curso de novo agora', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Em andamento' })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].retestStage).toBe('RETESTE_EM_ANDAMENTO');
      expect(groups[0].pendingRetest).toBe(true); // continua "pendente" no sentido amplo, mas em outra etapa
    });

    it('RETESTE_APROVADO: reprovou, refez e passou', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Em andamento' }),
        makeReq({ id: 'C', requestDate: new Date(2026, 2, 1), rawSituacao: 'Aprovado' })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].retestStage).toBe('RETESTE_APROVADO');
    });

    it('retestStage é undefined quando nunca reprovou', () => {
      const requests = [makeReq({ id: 'A', rawSituacao: 'Aprovado' })];
      const groups = groupRetests(requests);
      expect(groups[0].retestStage).toBeUndefined();
    });
  });

  describe('rematriculado / iniciado / latestProgressPercent — pedido do usuário em 26/08/2026', () => {
    it('reprovou e não rematriculou: rematriculado=false, iniciado=false', () => {
      const requests = [makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' })];
      const groups = groupRetests(requests);
      expect(groups[0].rematriculado).toBe(false);
      expect(groups[0].iniciado).toBe(false);
    });

    it('rematriculado mas "Não iniciado": rematriculado=true, iniciado=false', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Não iniciado', progressPercent: 0 })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].rematriculado).toBe(true);
      expect(groups[0].iniciado).toBe(false);
    });

    it('rematriculado e em andamento: rematriculado=true, iniciado=true, expõe o progresso atual', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Em andamento', progressPercent: 42 })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].rematriculado).toBe(true);
      expect(groups[0].iniciado).toBe(true);
      expect(groups[0].latestProgressPercent).toBe(42);
    });

    it('reprovou de novo no reteste: ainda conta como rematriculado E iniciado (chegou a fazer, só que reprovou outra vez)', () => {
      const requests = [
        makeReq({ id: 'A', requestDate: new Date(2026, 0, 1), rawSituacao: 'Reprovado' }),
        makeReq({ id: 'B', requestDate: new Date(2026, 1, 1), rawSituacao: 'Reprovado' })
      ];
      const groups = groupRetests(requests);
      expect(groups[0].rematriculado).toBe(true);
      expect(groups[0].iniciado).toBe(true);
    });
  });
});
