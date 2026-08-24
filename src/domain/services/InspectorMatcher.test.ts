import { describe, it, expect } from 'vitest';
import { matchesInspector } from './InspectorMatcher.js';
import { Inspector } from '../models/Certificate.js';

function makeInspector(name: string, cpf?: string): Inspector {
  return { id: name, name, cpf, role: 'TÉCNICO', certificates: new Map() };
}

describe('matchesInspector', () => {
  it('usa CPF como chave exata quando disponível dos dois lados', () => {
    const inspector = makeInspector('ADRIANO CIRILO GARCIA LIMA', '123.456.789-00');
    expect(matchesInspector(inspector, 'ADRIANO C. LIMA', '12345678900')).toBe(true);
  });

  it('não confunde dois nomes parecidos quando o CPF diverge', () => {
    const inspector = makeInspector('ADRIANO CIRILO GARCIA LIMA', '111.111.111-11');
    expect(matchesInspector(inspector, 'ADRIANO CIRILO GARCIA LIMA', '222.222.222-22')).toBe(false);
  });

  it('cai para substring de nome quando o CPF não está disponível', () => {
    const inspector = makeInspector('ADRIANO CIRILO GARCIA LIMA');
    expect(matchesInspector(inspector, 'ADRIANO CIRILO GARCIA LIMA - Solicitação Storz')).toBe(true);
    expect(matchesInspector(inspector, 'OUTRO COLABORADOR')).toBe(false);
  });

  it('ignora diferença de acentuação entre as fontes (bug real: Hamilcar Campos dos Santos Júnior)', () => {
    const inspectorDrive = makeInspector('HAMILCAR CAMPOS DOS SANTOS JÚNIOR');
    expect(matchesInspector(inspectorDrive, 'HAMILCAR CAMPOS DOS SANTOS JUNIOR')).toBe(true);

    const inspectorSemAcento = makeInspector('HAMILCAR CAMPOS DOS SANTOS JUNIOR');
    expect(matchesInspector(inspectorSemAcento, 'HAMILCAR CAMPOS DOS SANTOS JÚNIOR')).toBe(true);
  });
});
