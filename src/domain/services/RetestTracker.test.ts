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
});
