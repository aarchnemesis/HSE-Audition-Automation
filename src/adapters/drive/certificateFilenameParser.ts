import { CertificateClassifier } from '../../domain/services/CertificateClassifier.js'
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js'

// Baseado no "Guia de Treinamentos Normativos SST" (ARTH-Wind SSMA, v2.0, ago/2026).
// '05' (Cartão de Vacina / SUS) é documento permanente / pessoal e NÃO possui periodicidade anual.
const ANNUAL_VALIDITY_CODES = ['01', '06', '20', '28', '34']

// Documentos permanentes ou sem periodicidade fixa por calendário:
// - 02 (Ordem de Serviço): emitida na admissão/mudança de função
// - 03 (Ficha de Registro / Comprovante PJ): cadastro inicial
// - 04 (CTPS Digital / Contrato de Trabalho CLT): vínculo trabalhista permanente
// - 05 (Cartão de Vacina / SUS): registro vitalício de imunizações
// - 10 (NR-01 Integração EHS) e 11 (NR-06 Uso de EPI): retreinados apenas por gatilho de evento
// - 23 (CRT - Conselho de Técnicos) e 24 (Diploma Técnico): registro e titulação permanentes
// - 30 (GWO WINDA ID): identificação única e vitalícia do profissional na GWO
// Todos esses usam validade de 50 anos como proxy de documento permanente / CONFORME.
export const EVENT_TRIGGERED_ONLY_CODES = [
  '02',
  '03',
  '04',
  '05',
  '10',
  '11',
  '23',
  '24',
  '30',
]
export const EVENT_TRIGGERED_VALIDITY_YEARS = 50

// Contrato PJ (40) e Aditivo ao Contrato (40.1) — confirmado pelo usuário em 27/08/2026: a data
// no nome do arquivo já É o prazo final (não uma data de emissão pra somar anos de validade em
// cima). Diferente de todo o resto do catálogo, onde a data no nome costuma ser emissão/conclusão.
const DIRECT_EXPIRATION_CODES = ['40', '40.1']

export function parseDateFromFilename(filename: string): Date | null {
  // Normaliza underscores para espaços para evitar quebra de boundary antes de nomes
  const normalized = filename.replace(/_/g, ' ')

  // 1. Padrão DMY: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY ou DD MM YYYY
  const dmyMatch = normalized.match(
    /(?:^|\D)(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})(?:\D|$)/
  )
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10)
    const month = parseInt(dmyMatch[2], 10) - 1
    let year = parseInt(dmyMatch[3], 10)
    if (year < 100) year += 2000

    if (
      month >= 0 &&
      month <= 11 &&
      day >= 1 &&
      day <= 31 &&
      year >= 1990 &&
      year <= 2050
    ) {
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return d
    }
  }

  // 2. Padrão ISO: YYYY-MM-DD
  const isoMatch = normalized.match(
    /(?:^|\D)(\d{4})[\.\/-](\d{2})[\.\/-](\d{2})(?:\D|$)/
  )
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10)
    const month = parseInt(isoMatch[2], 10) - 1
    const day = parseInt(isoMatch[3], 10)

    if (
      month >= 0 &&
      month <= 11 &&
      day >= 1 &&
      day <= 31 &&
      year >= 1990 &&
      year <= 2050
    ) {
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return d
    }
  }

  return null
}

export function parseDocCode(filename: string): string | null {
  return CertificateClassifier.classify(filename).code
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
  if (EVENT_TRIGGERED_ONLY_CODES.includes(code)) {
    return EHSEvaluator.calculateExpirationFromIssue(
      parsedDate || refDate,
      EVENT_TRIGGERED_VALIDITY_YEARS
    )
  }

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
