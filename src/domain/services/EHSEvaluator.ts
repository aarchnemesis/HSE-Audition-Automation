import { EHSStatus } from '../models/Certificate.js'

const EVALUATION_PREFIX =
  /^(?:VENCIDO há \d+ dias \(\d{2}\/\d{2}\/\d{4}\)|(?:CRÍTICO|ALERTA [A-ZÉ]+): Vence em \d+ dia(?:\(s\)|s)? \(\d{2}\/\d{2}\/\d{4}\)|Válido até \d{2}\/\d{2}\/\d{4})\s*/

export class EHSEvaluator {
  /**
   * Strips the leading evaluateDate text from an already persisted detail,
   * keeping any extra note (e.g. "(Validado no RPO)").
   */
  static stripEvaluationPrefix(detail: string): string {
    let rest = detail.trim()
    while (EVALUATION_PREFIX.test(rest)) {
      rest = rest.replace(EVALUATION_PREFIX, '')
    }
    return rest
  }

  /**
   * Avalia a data de validade em relação a uma data de referência (padrão: hoje)
   * Aplicando a régua escalonada de auditoria EHS:
   *  - CONFORME (> 60 dias restantes)
   *  - VENCE_60 (entre 31 e 60 dias)
   *  - VENCE_30 (entre 16 e 30 dias)
   *  - VENCE_15 (entre 8 e 15 dias)
   *  - VENCE_07 (entre 1 e 7 dias)
   *  - VENCIDO  (<= 0 dias)
   */
  static evaluateDate(
    expirationDate: Date | null | undefined,
    refDate: Date = new Date()
  ): { status: EHSStatus; detail: string } {
    if (!expirationDate || isNaN(expirationDate.getTime())) {
      return {
        status: 'INDETERMINADO',
        detail: 'Data não informada ou formato inválido',
      }
    }

    const diffMs = expirationDate.getTime() - refDate.getTime()
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    const formattedExpDate = expirationDate.toLocaleDateString('pt-BR')

    if (daysLeft < 0) {
      return {
        status: 'VENCIDO',
        detail: `VENCIDO há ${Math.abs(daysLeft)} dias (${formattedExpDate})`,
      }
    } else if (daysLeft <= 7) {
      return {
        status: 'VENCE_07',
        detail: `CRÍTICO: Vence em ${daysLeft} dia(s) (${formattedExpDate})`,
      }
    } else if (daysLeft <= 15) {
      return {
        status: 'VENCE_15',
        detail: `ALERTA URGENTE: Vence em ${daysLeft} dias (${formattedExpDate})`,
      }
    } else if (daysLeft <= 30) {
      return {
        status: 'VENCE_30',
        detail: `ALERTA MÉDIO: Vence em ${daysLeft} dias (${formattedExpDate})`,
      }
    } else if (daysLeft <= 60) {
      return {
        status: 'VENCE_60',
        detail: `ALERTA INICIAL: Vence em ${daysLeft} dias (${formattedExpDate})`,
      }
    } else {
      return {
        status: 'CONFORME',
        detail: `Válido até ${formattedExpDate}`,
      }
    }
  }

  static calculateExpirationFromIssue(
    issueDate: Date,
    validityYears: number
  ): Date {
    const expDate = new Date(issueDate)
    expDate.setFullYear(expDate.getFullYear() + validityYears)
    return expDate
  }
}
