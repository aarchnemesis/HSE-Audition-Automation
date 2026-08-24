import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';

// Baseado no "Guia de Treinamentos Normativos SST" (ARTH-Wind SSMA, v2.0, ago/2026).
// '33' era código morto — não existe no nosso catálogo (o código interno da NR-33 é '20', não
// '33'; alguém confundiu o número da NR com o código interno do documento).
const ANNUAL_VALIDITY_CODES = ['01', '05', '06', '20'];

// NR-01 (Integração, código 10) e NR-06 (Uso de EPI, código 11) NÃO têm periodicidade fixa
// segundo o guia — só são retreinados por gatilho (mudança de risco, acidente grave, troca de
// EPI), nunca por calendário. Calcular uma validade fixa pra eles gera vencimento falso. Como
// nosso modelo de dados não tem um conceito de "documento sem prazo, só por evento", marcamos
// com uma validade bem distante (50 anos) — o documento fica CONFORME indefinidamente até
// alguém decidir modelar retreinamento por gatilho de verdade.
const EVENT_TRIGGERED_ONLY_CODES = ['10', '11'];
const EVENT_TRIGGERED_VALIDITY_YEARS = 50;

export function parseDateFromFilename(filename: string): Date | null {
  const dates = filename.match(/\b(\d{2})[\.\/-](\d{2})[\.\/-](\d{2,4})\b/);
  if (!dates) return null;

  const day = parseInt(dates[1], 10);
  const month = parseInt(dates[2], 10) - 1;
  let year = parseInt(dates[3], 10);

  if (year < 100) {
    year += 2000;
  }

  const d = new Date(year, month, day);
  return isNaN(d.getTime()) ? null : d;
}

export function parseDocCode(filename: string): string | null {
  if (filename.toLowerCase() === 'desktop.ini') return null;

  const match = filename.match(/^(\d{1,2}(\.\d+)?|\d{2})/);
  if (!match) return null;

  let rawCode = match[1];
  if (rawCode.length === 1) {
    rawCode = `0${rawCode}`;
  }
  return rawCode;
}

/** Anos de validade por código de documento — mesma regra usada pro Drive, reaproveitada por
 *  qualquer lugar que precise estimar validade a partir de uma data de emissão/conclusão (ex.:
 *  DriveRpoAuditor calculando a validade implícita de um curso concluído na Storz). */
export function getValidityYearsForCode(code: string): number {
  if (EVENT_TRIGGERED_ONLY_CODES.includes(code)) return EVENT_TRIGGERED_VALIDITY_YEARS;
  return ANNUAL_VALIDITY_CODES.includes(code) ? 1 : 2;
}

export function calculateDocExpiration(code: string, parsedDate: Date | null, refDate: Date): Date | undefined {
  if (!parsedDate) return undefined;

  if (parsedDate.getTime() >= refDate.getTime()) {
    return parsedDate;
  }

  return EHSEvaluator.calculateExpirationFromIssue(parsedDate, getValidityYearsForCode(code));
}
