import { StorzRequestState } from '../../domain/models/StorzRequest.js';

export interface ParsedDossieCourse {
  turma: string;
  situacao: string;
  codMatricula?: string;
  iniciado?: string;
  concluido?: string;
}

export interface ParsedDossie {
  cpf?: string;
  courses: ParsedDossieCourse[];
}

/**
 * O Dossiê do Aluno na Storz é uma página de "impressão" com texto estruturado, não uma tabela
 * HTML semântica confiável — por isso parseamos o texto puro (page.innerText) por regex em vez
 * de depender de classes CSS que não conseguimos inspecionar sem uma sessão logada real.
 */
export function parseDossieText(text: string): ParsedDossie {
  const cpfMatch = text.match(/CPF:\s*([\d.\-]{11,14})/i);
  const cpf = cpfMatch ? cpfMatch[1] : undefined;

  const courses: ParsedDossieCourse[] = [];
  // Cada bloco de curso começa com "Turma: <nome>" e vai até o próximo "Turma:" ou fim do texto.
  const blocks = text.split(/(?=Turma:\s*)/i).filter((b) => /^Turma:/i.test(b.trim()));

  for (const block of blocks) {
    const turmaMatch = block.match(/Turma:\s*([^\n/]+)/i);
    const situacaoMatch = block.match(/Situação do aluno:\s*([^\n]+)/i);
    const matriculaMatch = block.match(/Cod\.?\s*Matrícula:\s*([^\n]+)/i);
    const iniciadoMatch = block.match(/Iniciado:\s*([^\n]+)/i);
    const concluidoMatch = block.match(/Conclu[ií]do:\s*([^\n]+)/i);

    if (!turmaMatch) continue;

    courses.push({
      turma: turmaMatch[1].trim(),
      situacao: situacaoMatch ? situacaoMatch[1].trim() : '',
      codMatricula: matriculaMatch ? matriculaMatch[1].trim() : undefined,
      iniciado: iniciadoMatch ? iniciadoMatch[1].trim() : undefined,
      concluido: concluidoMatch ? concluidoMatch[1].trim() : undefined
    });
  }

  return { cpf, courses };
}

export function mapSituacaoToState(situacao: string): StorzRequestState {
  const upper = situacao.toUpperCase();
  if (upper.includes('APROVADO') || upper.includes('CONCLU')) return 'CONCLUIDO';
  if (upper.includes('CANCELADO') || upper.includes('REPROVADO')) return 'CANCELADO';
  if (upper.includes('ANDAMENTO') || upper.includes('CURSANDO')) return 'EM_ANDAMENTO';
  return 'SOLICITADO';
}

export function parseBrDate(text?: string): Date | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  return isNaN(date.getTime()) ? undefined : date;
}

// Tenta identificar o código do treinamento (01..30) pelo nome da turma. Confirmado contra
// nomes reais raspados da Storz, que usam "NR<n>" sem hífen e sem zero à esquerda (ex.:
// "NR1", "NR6", "NR12", "NR18" — não "NR-01"). \b evita que "NR1" confunda com "NR12"/"NR18"
// (o dígito seguinte quebra o boundary). SEP é checado antes de NR10 puro, pois um nome como
// "NR10 ... SEP ..." deve virar 13 (SEP), não 12 (básico).
const NR_CODE_MAP: [RegExp, string][] = [
  [/\bNR-?0?1\b/, '10'],  // NR-01 Integração EHS
  [/\bNR-?0?6\b/, '11'],  // NR-06 Uso de EPI
  [/\bNR-?11\b/, '14'],   // NR-11 Uso de Talha
  [/\bNR-?12\b/, '15'],   // NR-12 Segurança em Máquinas
  [/\bNR-?17\b/, '17'],   // NR-17 Ergonomia
  [/\bNR-?18\b/, '18'],   // NR-18 Integração EHS
  [/\bNR-?23\b/, '19'],   // NR-23 Combate a Incêndio
  [/\bNR-?33\b/, '20'],   // NR-33 Espaço Confinado
  [/\bNR-?35\b/, '21']    // NR-35 Trabalho em Altura
];

export function classifyTrainingCode(trainingName: string): string | null {
  const upperTrainingName = trainingName.toUpperCase();
  // ASO, CNH, SIT/ESO Vestas e GWO WINDA ID NÃO são classificados aqui de propósito: a Storz é
  // uma empresa de treinamentos NORMATIVOS (NRs/GWO/LOTO/CIPA) — ASO é exame médico, CNH é
  // documento de trânsito, SIT/ESO/WINDA são certificações de terceiros (Vestas/GWO), nenhum
  // desses é emitido ou administrado pela Storz. As classificações antigas pra esses tipos eram
  // especulativas (nunca confirmadas em nome de curso real raspado) e foram removidas.
  if (upperTrainingName.includes('SEP')) return '13';
  if (upperTrainingName.includes('LOTO')) return '22';
  if (upperTrainingName.includes('CIPA')) return '34'; // ex. real: "NR5 - CIPA - GRAU DE RISCO 3"

  for (const [regex, code] of NR_CODE_MAP) {
    if (regex.test(upperTrainingName)) return code;
  }

  if (/\bNR-?10\b/.test(upperTrainingName)) return '12'; // NR-10 Básico (sem SEP no nome)
  return null;
}
