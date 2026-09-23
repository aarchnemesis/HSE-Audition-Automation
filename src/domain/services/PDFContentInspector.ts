import {
  calculateDocExpiration,
  getValidityYearsForCode,
  parseDateFromFilename,
} from '../../adapters/drive/certificateFilenameParser.js'
import {
  CertificateClassifier,
  ClassificationResult,
} from './CertificateClassifier.js'
import { EHSEvaluator } from './EHSEvaluator.js'

export interface InspectedDocumentResult {
  code: string | null
  issueDate?: Date
  expirationDate?: Date
  statusEHS: string
  statusDetail: string
  source: 'PDF_CONTENT' | 'FILENAME' | 'IMAGE_FALLBACK'
  classificationSource?: 'SEMANTIC' | 'PREFIX' | 'NONE'
  matchedTerm?: string
  extractedClause?: string
}

const PORTUGUESE_MONTHS: Record<string, number> = {
  janeiro: 0,
  jan: 0,
  fevereiro: 1,
  fev: 1,
  marco: 2,
  março: 2,
  mar: 2,
  abril: 3,
  abr: 3,
  maio: 4,
  mai: 4,
  junho: 5,
  jun: 5,
  julho: 6,
  jul: 6,
  agosto: 7,
  ago: 7,
  setembro: 8,
  set: 8,
  outubro: 9,
  out: 9,
  novembro: 10,
  nov: 10,
  dezembro: 11,
  dez: 11,
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  '01': 1,
  '1': 1,
  dois: 2,
  duas: 2,
  '02': 2,
  '2': 2,
  tres: 3,
  três: 3,
  '03': 3,
  '3': 3,
  quatro: 4,
  '04': 4,
  '4': 4,
  cinco: 5,
  '05': 5,
  '5': 5,
  seis: 6,
  '06': 6,
  '6': 6,
  doze: 12,
  '12': 12,
  vinte: 20,
  '24': 24,
  'vinte e quatro': 24,
  '36': 36,
  'trinta e seis': 36,
}

const DATE_CAPTURE_PATTERN =
  '(?:[0-9]{1,2}[\\/\\.-][0-9]{1,2}[\\/\\.-][0-9]{2,4}|[0-9]{1,2}\\s*(?:de\\s*)?[a-zç]+\\s*(?:de\\s*)?[0-9]{2,4})'

/**
 * Converte strings contendo datas no formato numérico (DD/MM/YYYY) ou por extenso (DD de Mês de YYYY)
 * em um objeto Date válido.
 */
export function parsePortugueseDate(raw: string): Date | null {
  if (!raw) return null
  const cleaned = raw.trim().replace(/\s+/g, ' ')

  // 1. Formato numérico DMY: "21/01/2025", "21.01.2025", "21-01-2025"
  const dmyMatch = cleaned.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/)
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

  // 2. Formato textual: "26 de junho de 2026", "27de Agosto de 2026", "08 de Janeiro de 2026"
  const textMatch = cleaned.match(
    /(\d{1,2})\s*(?:de\s*)?([a-zç]+)\s*(?:de\s*)?(\d{2,4})/i
  )
  if (textMatch) {
    const day = parseInt(textMatch[1], 10)
    const monthKey = textMatch[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    let year = parseInt(textMatch[3], 10)
    if (year < 100) year += 2000

    if (PORTUGUESE_MONTHS[monthKey] !== undefined) {
      const month = PORTUGUESE_MONTHS[monthKey]
      if (day >= 1 && day <= 31 && year >= 1990 && year <= 2050) {
        const d = new Date(year, month, day)
        if (!isNaN(d.getTime())) return d
      }
    }
  }

  // 3. Formato ISO: "YYYY-MM-DD"
  const isoMatch = cleaned.match(/(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/)
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

/**
 * Adiciona período (meses ou anos) a uma data base.
 */
export function addDuration(
  baseDate: Date,
  amount: number,
  unit: 'months' | 'years'
): Date {
  const result = new Date(baseDate.getTime())
  if (unit === 'years') {
    result.setFullYear(result.getFullYear() + amount)
  } else {
    result.setMonth(result.getMonth() + amount)
  }
  return result
}

export class PDFContentInspector {
  /**
   * Inspeciona um PDF analisando tanto o nome do arquivo quanto o texto extraído internamente.
   * Dá prevalência ao conteúdo do PDF para determinação de vigência contratual e validade de certificados.
   */
  static inspect(
    filename: string,
    pdfText: string | undefined | null,
    refDate: Date = new Date()
  ): InspectedDocumentResult {
    const text = (pdfText || '').trim()
    const isScannedImage = text.length < 50

    // 1. Classificação do documento (nome + texto do PDF)
    const classification: ClassificationResult = CertificateClassifier.classify(
      filename,
      isScannedImage ? undefined : text
    )
    const code = classification.code

    // Se o PDF for um scan/imagem pura sem OCR, faz fallback direto para metadados de nome
    if (isScannedImage) {
      return this.inspectFromFilenameFallback(filename, classification, refDate)
    }

    // 2. Extração para Contratos PJ e Termos Aditivos (Códigos 40 e 40.1, ou 04 e 04.1 em pastas de piloto)
    if (code === '40' || code === '40.1' || code === '04' || code === '04.1') {
      const contractResult = this.extractContractDates(text, code, refDate)
      if (contractResult) {
        const evalResult = EHSEvaluator.evaluateDate(
          contractResult.expirationDate,
          refDate
        )
        return {
          code,
          issueDate: contractResult.issueDate,
          expirationDate: contractResult.expirationDate,
          statusEHS: evalResult.status,
          statusDetail: evalResult.detail,
          source: 'PDF_CONTENT',
          classificationSource: classification.source,
          matchedTerm: classification.matchedTerm || 'Contrato/Aditivo',
          extractedClause: contractResult.clause,
        }
      }
    }

    // 3. Extração para Certificados Normativos (NRs, GWO, ASO, Treinamentos)
    const certResult = this.extractCertificateDates(text, code, refDate)
    if (certResult && (certResult.expirationDate || certResult.issueDate)) {
      const finalExpDate =
        certResult.expirationDate ||
        (certResult.issueDate && code
          ? calculateDocExpiration(code, certResult.issueDate, refDate)
          : undefined)

      const evalResult = EHSEvaluator.evaluateDate(finalExpDate, refDate)
      return {
        code,
        issueDate: certResult.issueDate,
        expirationDate: finalExpDate,
        statusEHS: evalResult.status,
        statusDetail: evalResult.detail,
        source: 'PDF_CONTENT',
        classificationSource: classification.source,
        matchedTerm: classification.matchedTerm,
        extractedClause: certResult.clause,
      }
    }

    // 4. Se não conseguiu datas expressas no texto, utiliza fallback de data do nome do arquivo
    return this.inspectFromFilenameFallback(filename, classification, refDate)
  }

  /**
   * Extração de datas a partir de cláusulas de vigência e duração contratual.
   */
  private static extractContractDates(
    text: string,
    code: string,
    refDate: Date
  ): { issueDate?: Date; expirationDate?: Date; clause: string } | null {
    // Normaliza quebras de linha e múltiplos espaços
    const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')

    // Caso A: Cláusula de encerramento explícito:
    // Ex.: "encerrando-se em 08/01/2027", "encerrando-se em 08 de janeiro de 2027"
    const encerramentoRegex = new RegExp(
      `encerrando-se\\s+em\\s+(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const encerramentoMatch = clean.match(encerramentoRegex)
    if (encerramentoMatch) {
      const parsedExp = parsePortugueseDate(encerramentoMatch[1])
      if (parsedExp) {
        return {
          expirationDate: parsedExp,
          clause: encerramentoMatch[0],
        }
      }
    }

    // Caso B: "com término previsto para DD/MM/AAAA" ou "com término em DD/MM/AAAA"
    const terminoRegex = new RegExp(
      `com\\s+t[eé]rmino\\s+(?:previsto\\s+para|em)\\s+(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const terminoMatch = clean.match(terminoRegex)
    if (terminoMatch) {
      const parsedExp = parsePortugueseDate(terminoMatch[1])
      if (parsedExp) {
        return {
          expirationDate: parsedExp,
          clause: terminoMatch[0],
        }
      }
    }

    // Caso C: "vigência até DD/MM/AAAA" ou "vigência inicialmente prevista até DD/MM/AAAA"
    const vigenciaAteRegex = new RegExp(
      `vig[eê]ncia\\s+(?:inicialmente\\s+prevista\\s+)?at[eé]\\s+(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const vigenciaAteMatch = clean.match(vigenciaAteRegex)
    if (vigenciaAteMatch) {
      const parsedExp = parsePortugueseDate(vigenciaAteMatch[1])
      if (parsedExp) {
        return {
          expirationDate: parsedExp,
          clause: vigenciaAteMatch[0],
        }
      }
    }

    // Caso D: "passa a vigorar [a partir de|de] [DATA] e terá [vigência|duração] de [X] [meses|ano|anos]"
    const vigorarRegex = new RegExp(
      `passa\\s+a\\s+vigorar\\s+(?:a\\s+partir\\s+de|de)\\s+(${DATE_CAPTURE_PATTERN})\\s+e\\s+ter[aá]\\s+(?:vig[eê]ncia|dura[cç][aã]o)\\s+de\\s+([^\\.,;\\n]+?)(?:meses|mes|anos|ano)`,
      'i'
    )
    const vigorarMatch = clean.match(vigorarRegex)
    if (vigorarMatch) {
      const startDate = parsePortugueseDate(vigorarMatch[1])
      const durationSnippet = vigorarMatch[0]
      const isYears = /ano/i.test(durationSnippet)
      const numberMatch = durationSnippet.match(
        /\b(um|uma|01|1|dois|duas|02|2|tres|três|03|3|quatro|04|4|doze|12|vinte e quatro|24|36)\b/i
      )
      const amount = numberMatch
        ? NUMBER_WORDS[numberMatch[1].toLowerCase()] || 1
        : 1
      if (startDate) {
        const expirationDate = addDuration(
          startDate,
          amount,
          isYears ? 'years' : 'months'
        )
        return {
          issueDate: startDate,
          expirationDate,
          clause: vigorarMatch[0],
        }
      }
    }

    // Caso E: "prorrogar a vigência do Contrato por mais 12 (doze) meses"
    const prorrogarMatch = clean.match(
      /prorrogar\s+a\s+vig[eê]ncia\s+do\s+Contrato\s+por\s+mais\s+([^\.,;\n]+?)(?:meses|mes|anos|ano)/i
    )
    if (prorrogarMatch) {
      // Procura data da celebração ou assinatura próxima
      const dateNearRegex = new RegExp(
        `(?:Sorocaba|Caucaia|Fortaleza)[\\s\\/A-Z]*,?\\s*(${DATE_CAPTURE_PATTERN})`,
        'i'
      )
      const dateNear = clean.match(dateNearRegex)
      if (dateNear) {
        const base = parsePortugueseDate(dateNear[1])
        const isYears = /ano/i.test(prorrogarMatch[0])
        const numberMatch = prorrogarMatch[0].match(
          /\b(um|uma|01|1|dois|duas|02|2|doze|12|vinte e quatro|24)\b/i
        )
        const amount = numberMatch
          ? NUMBER_WORDS[numberMatch[1].toLowerCase()] || 1
          : 1
        if (base) {
          const expirationDate = addDuration(
            base,
            amount,
            isYears ? 'years' : 'months'
          )
          return {
            issueDate: base,
            expirationDate,
            clause: prorrogarMatch[0],
          }
        }
      }
    }

    return null
  }

  /**
   * Extração de datas a partir do corpo de certificados e atestados de treinamento.
   */
  private static extractCertificateDates(
    text: string,
    code: string | null,
    refDate: Date
  ): { issueDate?: Date; expirationDate?: Date; clause: string } | null {
    const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')

    let explicitExpDate: Date | undefined
    let explicitIssueDate: Date | undefined
    let foundClause = ''

    // 1. Procura validade explícita direta: "Válido até DD/MM/AAAA" ou "Validade: DD/MM/AAAA"
    const validadeAteRegex = new RegExp(
      `(?:v[aá]lido\\s+at[eé]|validade(?:\\s+at[eé])?)\\s*:?\\s*(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const validadeAteMatch = clean.match(validadeAteRegex)
    if (validadeAteMatch) {
      const parsed = parsePortugueseDate(validadeAteMatch[1])
      if (parsed) {
        explicitExpDate = parsed
        foundClause = validadeAteMatch[0]
      }
    }

    // 2. Procura cláusula de validade por período: "Treinamento válido por 02 (Dois) anos", "válido por 1 ano"
    let validityYearsFromText: number | undefined
    const validadePeriodoMatch = clean.match(
      /(?:treinamento\s+)?v[aá]lido\s+por\s+([^\.,;\n]+?)(?:anos?|ano|meses?)/i
    )
    if (validadePeriodoMatch) {
      const snippet = validadePeriodoMatch[0]
      const numberMatch = snippet.match(
        /\b(um|uma|01|1|dois|duas|02|2|tres|três|03|3|quatro|04|4|cinco|05|5)\b/i
      )
      if (numberMatch) {
        const val = NUMBER_WORDS[numberMatch[1].toLowerCase()]
        if (val) validityYearsFromText = val
      }
    }

    // 3. Procura data de realização / conclusão do curso
    // Ex. A: "Concluído em 12 de Maio de 2025" / "Concluido em 12 de Maio de 2025"
    const concluidoRegex = new RegExp(
      `conclu[ií]do\\s+em\\s+(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const concluidoMatch = clean.match(concluidoRegex)
    if (concluidoMatch) {
      const parsed = parsePortugueseDate(concluidoMatch[1])
      if (parsed) {
        explicitIssueDate = parsed
        if (!foundClause) foundClause = concluidoMatch[0]
      }
    }

    // Ex. B: "nos dias 07 e 08 de Janeiro de 2026", "no dia 27de Agosto de 2026", "no dia 27/01/2026"
    if (!explicitIssueDate) {
      const noDiaRegex = new RegExp(
        `(?:no[s]?\\s+dia[s]?|completou.*?no\\s+dia)\\s*(?:[0-9]{1,2}\\s*e\\s*)?(${DATE_CAPTURE_PATTERN})`,
        'i'
      )
      const noDiaMatch = clean.match(noDiaRegex)
      if (noDiaMatch) {
        const parsed = parsePortugueseDate(noDiaMatch[1])
        if (parsed) {
          explicitIssueDate = parsed
          if (!foundClause) foundClause = noDiaMatch[0]
        }
      }
    }

    // Ex. C: "Realizado no período de ... à DD/MM/AAAA"
    if (!explicitIssueDate) {
      const periodoRegex = new RegExp(
        `per[ií]odo\\s+de.*?[\\u00e0a]\\s+(${DATE_CAPTURE_PATTERN})`,
        'i'
      )
      const periodoMatch = clean.match(periodoRegex)
      if (periodoMatch) {
        const parsed = parsePortugueseDate(periodoMatch[1])
        if (parsed) {
          explicitIssueDate = parsed
          if (!foundClause) foundClause = periodoMatch[0]
        }
      }
    }

    // Ex. D: Assinatura de cidade no rodapé: "Fortaleza, 08 de Janeiro de 2026", "Sorocaba (SP), 29 de Março de 2023"
    if (!explicitIssueDate) {
      const cidadeRegex = new RegExp(
        `(?:Fortaleza|Caucaia|Sorocaba|Mossor[oó]|Parnamirim|S[aã]o\\s+Paulo|Natal)[\\s\\/\\(A-Z]*,?\\s*(${DATE_CAPTURE_PATTERN})`,
        'i'
      )
      const cidadeMatch = clean.match(cidadeRegex)
      if (cidadeMatch) {
        const parsed = parsePortugueseDate(cidadeMatch[1])
        if (parsed) {
          explicitIssueDate = parsed
          if (!foundClause) foundClause = cidadeMatch[0]
        }
      }
    }

    // Se temos validade explícita (data final), retornamos
    if (explicitExpDate) {
      return {
        issueDate: explicitIssueDate,
        expirationDate: explicitExpDate,
        clause: foundClause,
      }
    }

    // Se temos data de emissão e período de validade explícito no texto (ex: 2 anos):
    if (explicitIssueDate && validityYearsFromText) {
      const calculatedExp = addDuration(
        explicitIssueDate,
        validityYearsFromText,
        'years'
      )
      return {
        issueDate: explicitIssueDate,
        expirationDate: calculatedExp,
        clause: `${foundClause} (validade ${validityYearsFromText} anos)`,
      }
    }

    if (explicitIssueDate) {
      return {
        issueDate: explicitIssueDate,
        clause: foundClause,
      }
    }

    return null
  }

  /**
   * Fallback quando o PDF não possui camada de texto ou é imagem escaneada.
   */
  private static inspectFromFilenameFallback(
    filename: string,
    classification: ClassificationResult,
    refDate: Date
  ): InspectedDocumentResult {
    const code = classification.code
    const parsedDate = parseDateFromFilename(filename)
    const expirationDate = code
      ? calculateDocExpiration(code, parsedDate, refDate)
      : undefined
    const evalResult = EHSEvaluator.evaluateDate(expirationDate, refDate)

    return {
      code,
      issueDate: parsedDate || undefined,
      expirationDate,
      statusEHS: evalResult.status,
      statusDetail: evalResult.detail,
      source: 'FILENAME',
      classificationSource: classification.source,
      matchedTerm: classification.matchedTerm,
    }
  }
}
