import { describe, it, expect } from 'vitest';
import { parseDossieText, mapSituacaoToState, parseBrDate, classifyTrainingCode } from './dossieParser.js';

// Texto aproximado do que page.innerText('body') retornaria na tela real de
// "Dossiê do Aluno" da Storz (baseado no screenshot compartilhado em 20/08/2026).
const SAMPLE_DOSSIE_TEXT = `
Dossiê
Dossiê do Aluno
Jessica Alves Da Silva
CPF: 026.431.793-90
Cargo:
Unidade padrão: ARTH WIND SERVICES E CONSULTING EIRELI
Unidade: ARTH WIND SERVICES E CONSULTING EIRELI
Setor:
Como Aluno
Turma: [STORZ] - NR5 - CIPA - GRAU DE RISCO 3 / Tipo: Turma Contínua
Situação do aluno: Aprovado
Cod. Matrícula: 516258
Iniciado: 02/06/2026
Concluído: 13/07/2026
Progresso: 100%
Tempo de Curso: 60 Dias
`;

describe('parseDossieText', () => {
  it('extrai o CPF do texto do dossiê', () => {
    const result = parseDossieText(SAMPLE_DOSSIE_TEXT);
    expect(result.cpf).toBe('026.431.793-90');
  });

  it('extrai os campos de cada bloco de curso', () => {
    const result = parseDossieText(SAMPLE_DOSSIE_TEXT);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({
      turma: '[STORZ] - NR5 - CIPA - GRAU DE RISCO 3',
      situacao: 'Aprovado',
      codMatricula: '516258',
      iniciado: '02/06/2026',
      concluido: '13/07/2026',
      progresso: '100',
      tempoCursoDias: '60'
    });
  });

  it('extrai progresso e prazo de curso ainda em andamento (regressão 26/08/2026: campos não eram capturados)', () => {
    const emAndamento = `
Turma: [STORZ] - NR33 TRABALHADOR E VIGIA (PERIÓDICO) / Tipo: Turma Contínua
Situação do aluno: Em andamento
Cod. Matrícula: 514657
Iniciado: 10/06/2026
Concluído: -
Progresso: 65%
Tempo de Curso: 60 Dias
`;
    const result = parseDossieText(emAndamento);
    expect(result.courses[0].progresso).toBe('65');
    expect(result.courses[0].tempoCursoDias).toBe('60');
  });

  it('lida com múltiplos blocos de curso no mesmo dossiê', () => {
    const multiCourse = SAMPLE_DOSSIE_TEXT + `
Turma: [STORZ] - NR35 Trabalho em Altura / Tipo: Turma Contínua
Situação do aluno: Em andamento
Cod. Matrícula: 999111
Iniciado: 01/08/2026
`;
    const result = parseDossieText(multiCourse);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[1].situacao).toBe('Em andamento');
    expect(result.courses[1].concluido).toBeUndefined();
  });

  it('retorna cpf undefined e courses vazio quando o texto não bate com o formato esperado', () => {
    const result = parseDossieText('página em branco ou erro 404');
    expect(result.cpf).toBeUndefined();
    expect(result.courses).toHaveLength(0);
  });
});

describe('mapSituacaoToState', () => {
  it('mapeia Aprovado/Concluído para CONCLUIDO', () => {
    expect(mapSituacaoToState('Aprovado')).toBe('CONCLUIDO');
    expect(mapSituacaoToState('Concluído')).toBe('CONCLUIDO');
  });

  it('mapeia Cancelado/Reprovado para CANCELADO', () => {
    expect(mapSituacaoToState('Reprovado')).toBe('CANCELADO');
    expect(mapSituacaoToState('Cancelado')).toBe('CANCELADO');
  });

  it('mapeia Em andamento/Cursando para EM_ANDAMENTO', () => {
    expect(mapSituacaoToState('Em andamento')).toBe('EM_ANDAMENTO');
    expect(mapSituacaoToState('Cursando')).toBe('EM_ANDAMENTO');
  });

  it('usa SOLICITADO como fallback para situações desconhecidas', () => {
    expect(mapSituacaoToState('')).toBe('SOLICITADO');
    expect(mapSituacaoToState('Matriculado')).toBe('SOLICITADO');
  });
});

describe('parseBrDate', () => {
  it('parseia data no formato dd/mm/yyyy', () => {
    const date = parseBrDate('13/07/2026');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6);
    expect(date?.getDate()).toBe(13);
  });

  it('retorna undefined para texto vazio ou sem data', () => {
    expect(parseBrDate(undefined)).toBeUndefined();
    expect(parseBrDate('')).toBeUndefined();
    expect(parseBrDate('em processamento')).toBeUndefined();
  });
});

describe('classifyTrainingCode', () => {
  it('classifica NR-35 corretamente mesmo com variações de hífen', () => {
    expect(classifyTrainingCode('NR-35 Trabalho em Altura')).toBe('21');
  });

  it('separa NR-33 Supervisor (28) de NR-33 Trabalhador/Vigia (20) — nomes reais raspados da Storz', () => {
    expect(classifyTrainingCode('[STORZ] - NR33 SUPERVISOR (PERIÓDICO)')).toBe('28');
    expect(classifyTrainingCode('NR33 SUPERVISOR (INICIAÇÃO)')).toBe('28');
    expect(classifyTrainingCode('[STORZ] - NR33 TRABALHADOR E VIGIA (PERIÓDICO)')).toBe('20');
  });

  it('prioriza SEP sobre NR-10 básico', () => {
    expect(classifyTrainingCode('NR-10 SEP (F+R)')).toBe('13');
    expect(classifyTrainingCode('NR-10 Básico (F+R)')).toBe('12');
  });

  it('classifica CIPA (ex. real raspado da Storz: "NR5 - CIPA - GRAU DE RISCO 3")', () => {
    expect(classifyTrainingCode('[STORZ] - NR5 - CIPA - GRAU DE RISCO 3')).toBe('34');
  });

  it('classifica GWO Primeiros Socorros (16) mesmo sem "NR" ou "GWO" no nome — regressão: caía em 99 (não classificado) e a pessoa aparecia AUSENTE mesmo tendo feito o curso', () => {
    expect(classifyTrainingCode('[STORZ] - ATENDIMENTO PRÉ HOSPITALAR (PRIMEIROS SOCORROS) BÁSICO')).toBe('16');
  });

  it('classifica GWO Combate a Incêndio (19) mesmo sem "NR23" no nome — mesma regressão do 16', () => {
    expect(classifyTrainingCode('[STORZ] - PREVENÇÃO E PROTEÇÃO CONTRA INCÊNDIOS')).toBe('19');
  });

  it('classifica corretamente mesmo com o acento em minúscula que a Storz grava no meio de texto maiúsculo (ex. real: "PREVENçãO E PROTEçãO CONTRA INCêNDIOS")', () => {
    expect(classifyTrainingCode('[STORZ] - PREVENçãO E PROTEçãO CONTRA INCêNDIOS')).toBe('19');
    expect(classifyTrainingCode('[STORZ] - ATENDIMENTO PRé HOSPITALAR (PRIMEIROS SOCORROS) BáSICO')).toBe('16');
  });

  it('retorna null quando não consegue classificar', () => {
    expect(classifyTrainingCode('Curso qualquer sem padrão conhecido')).toBeNull();
  });

  it('NÃO classifica ASO, CNH, SIT/ESO Vestas ou WINDA — a Storz é uma empresa de treinamentos normativos, esses documentos nunca vêm de lá', () => {
    expect(classifyTrainingCode('ASO - Atestado de Saúde Ocupacional')).toBeNull();
    expect(classifyTrainingCode('CNH - Carteira de Habilitação')).toBeNull();
    expect(classifyTrainingCode('SIT VESTAS')).toBeNull();
    expect(classifyTrainingCode('GWO WINDA ID')).toBeNull();
  });
});
