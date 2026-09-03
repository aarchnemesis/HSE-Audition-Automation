import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js'

// Baseado no "Guia de Treinamentos Normativos SST" (ARTH-Wind SSMA, v2.0, ago/2026).
// '33' era código morto — não existe no nosso catálogo (o código interno da NR-33 é '20', não
// '33'; alguém confundiu o número da NR com o código interno do documento).
const ANNUAL_VALIDITY_CODES = ['01', '05', '06', '20']

// NR-01 (Integração, código 10) e NR-06 (Uso de EPI, código 11) NÃO têm periodicidade fixa
// segundo o guia — só são retreinados por gatilho (mudança de risco, acidente grave, troca de
// EPI), nunca por calendário. Calcular uma validade fixa pra eles gera vencimento falso. Como
// nosso modelo de dados não tem um conceito de "documento sem prazo, só por evento", marcamos
// com uma validade bem distante (50 anos) — o documento fica CONFORME indefinidamente até
// alguém decidir modelar retreinamento por gatilho de verdade. Exportado porque DriveRpoAuditor
// precisa saber quais códigos são event-triggered pra NÃO comparar data de validade entre Drive
// e RPO nesses casos — comparar um prazo de "não vence" (proxy de 50 anos) contra uma data real
// digitada na RPO sempre vai divergir em ~17.500 dias, mascarando divergências reais no meio de
// centenas de falsos positivos (achado em 25/08/2026, 118 ocorrências na auditoria real).
export const EVENT_TRIGGERED_ONLY_CODES = ['10', '11']
const EVENT_TRIGGERED_VALIDITY_YEARS = 50

// Contrato PJ (40) e Aditivo ao Contrato (40.1) — confirmado pelo usuário em 27/08/2026: a data
// no nome do arquivo já É o prazo final (não uma data de emissão pra somar anos de validade em
// cima). Diferente de todo o resto do catálogo, onde a data no nome costuma ser emissão/conclusão.
const DIRECT_EXPIRATION_CODES = ['40', '40.1']

export function parseDateFromFilename(filename: string): Date | null {
  const dates = filename.match(/\b(\d{2})[\.\/-](\d{2})[\.\/-](\d{2,4})\b/)
  if (!dates) return null

  const day = parseInt(dates[1], 10)
  const month = parseInt(dates[2], 10) - 1
  let year = parseInt(dates[3], 10)

  if (year < 100) {
    year += 2000
  }

  const d = new Date(year, month, day)
  return isNaN(d.getTime()) ? null : d
}

export function parseDocCode(filename: string): string | null {
  if (filename.toLowerCase() === 'desktop.ini') return null

  const match = filename.match(/^(\d{1,2}(\.\d+)?|\d{2})/)
  if (!match) return null

  let rawCode = match[1]
  if (rawCode.length === 1) {
    rawCode = `0${rawCode}`
  }
  return rawCode
}

/** Anos de validade por código de documento — mesma regra usada pro Drive, reaproveitada por
 *  qualquer lugar que precise estimar validade a partir de uma data de emissão/conclusão (ex.:
 *  DriveRpoAuditor calculando a validade implícita de um curso concluído na Storz). */
export function getValidityYearsForCode(code: string): number {
  if (EVENT_TRIGGERED_ONLY_CODES.includes(code))
    return EVENT_TRIGGERED_VALIDITY_YEARS
  return ANNUAL_VALIDITY_CODES.includes(code) ? 1 : 2
}

export function calculateDocExpiration(
  code: string,
  parsedDate: Date | null,
  refDate: Date
): Date | undefined {
  if (!parsedDate) return undefined

  if (
    DIRECT_EXPIRATION_CODES.includes(code) ||
    parsedDate.getTime() >= refDate.getTime()
  ) {
    return parsedDate
  }

  return EHSEvaluator.calculateExpirationFromIssue(
    parsedDate,
    getValidityYearsForCode(code)
  )
}
