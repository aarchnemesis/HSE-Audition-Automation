import {
  EVENT_TRIGGERED_ONLY_CODES,
  calculateDocExpiration,
  getValidityYearsForCode,
  parseDateFromFilename,
  parseDocCode,
} from '../../adapters/drive/certificateFilenameParser.js'
import {
  CertificateClassifier,
  ClassificationResult,
} from './CertificateClassifier.js'
import { DOC_CATALOG_MAP } from './ComplianceEngine.js'
import { EHSEvaluator } from './EHSEvaluator.js'

/**
 * Cria coletor de texto pagina a pagina para uso com pdf-parse (Fase 2).
 */
/**
 * Determina se um arquivo em PDF tem permissão para ser dividido em múltiplas normas independentes.
 * Evita que documentos administrativos ou cursos específicos (ex.: Ordem de Serviço, Elevador JASO,
 * LOTO, Diploma, Ficha de EPI) emitam normas alheias como NR-35 ou NR-10 apenas porque mencionam
 * a norma em seu conteúdo programático ou nas cláusulas de segurança.
 */
export function isMultiNormAllowed(
  filename: string,
  overallCode?: string | null,
  prefixCode?: string | null
): boolean {
  const fn = (filename || '').toLowerCase()

  // 1. Pacotes GWO BST / WINDA (First Aid, Manual Handling, Fire Awareness, Working at Heights, WINDA ID)
  if (
    /\b(?:gwo|bst|winda)\b/i.test(fn) ||
    overallCode === '16' ||
    prefixCode === '16'
  ) {
    return true
  }

  // 2. Pacotes NR-10 Básico + SEP
  if (
    /\bsep\b/i.test(fn) &&
    (/\bnr-?10\b/i.test(fn) || overallCode === '12' || prefixCode === '12')
  ) {
    return true
  }

  // 3. Pacotes Contrato + Aditivo (04/40 e 04.1/40.1)
  if (
    /aditiv/i.test(fn) &&
    (/contrat/i.test(fn) ||
      overallCode === '40' ||
      overallCode === '04' ||
      prefixCode === '04' ||
      prefixCode === '40')
  ) {
    return true
  }

  // 4. Documentos individuais com prefixo padrão de catálogo (01, 02, 06, 21, 22, 31, etc.)
  // São estritamente individuais e nunca devem ser fragmentados em normas diferentes.
  if (prefixCode && DOC_CATALOG_MAP[prefixCode]) {
    return false
  }

  // 5. Arquivos genéricos sem prefixo específico (ex.: "Certificados - Fulano.pdf")
  return !prefixCode
}

export function getAllowedMultiNormCodes(
  filename: string,
  overallCode?: string | null,
  prefixCode?: string | null
): Set<string> | null {
  const fn = (filename || '').toLowerCase()
  if (
    /\b(?:gwo|bst|winda)\b/i.test(fn) ||
    overallCode === '16' ||
    prefixCode === '16'
  ) {
    return new Set(['16', '17', '19', '21', '30', '32'])
  }
  if (
    /\bsep\b/i.test(fn) &&
    (/\bnr-?10\b/i.test(fn) || overallCode === '12' || prefixCode === '12')
  ) {
    return new Set(['12', '12.1', '13'])
  }
  if (
    /aditiv/i.test(fn) &&
    (/contrat/i.test(fn) ||
      overallCode === '40' ||
      overallCode === '04' ||
      prefixCode === '04' ||
      prefixCode === '40')
  ) {
    return new Set(['04', '04.1', '40', '40.1'])
  }
  return null
}

export function createPdfPageCollector(): {
  pages: string[]
  pagerender: (pageData: any) => Promise<string>
} {
  const pages: string[] = []
  const pagerender = async (pageData: any): Promise<string> => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    })
    let lastY: number | undefined
    let text = ''
    for (const item of textContent.items) {
      if (lastY === undefined || lastY === item.transform[5]) {
        text += item.str
      } else {
        text += '\n' + item.str
      }
      lastY = item.transform[5]
    }
    pages.push(text)
    return text
  }
  return { pages, pagerender }
}

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
  // Suporte a meses em inglês para certificados internacionais (GWO, Lift, etc.)
  january: 0,
  february: 1,
  feb: 1,
  march: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  december: 11,
  dec: 11,
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
  '(?:[0-9]{4}[\\/\\.-][0-9]{1,2}[\\/\\.-][0-9]{1,2}|[0-9]{4}\\s[0-9]{1,2}\\s[0-9]{1,2}|[0-9]{1,2}[\\/\\.-][0-9]{1,2}[\\/\\.-][0-9]{2,4}|[0-9]{1,2}\\s*(?:de\\s*)?[a-zç]+\\s*(?:de\\s*)?[0-9]{2,4})'

/**
 * Converte strings contendo datas no formato numérico (DD/MM/YYYY) ou por extenso (DD de Mês de YYYY)
 * em um objeto Date válido.
 */
export function parsePortugueseDate(raw: string): Date | null {
  if (!raw) return null
  let cleaned = raw
    .replace(/[\x00\0]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  // Normaliza casos onde "de" ficou grudado no dia, no mês ou no ano (ex.: "11de Setembrode 2026")
  cleaned = cleaned
    .replace(/(\d{1,2})de\b/gi, '$1 de ')
    .replace(
      /(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)de\b/gi,
      '$1 de '
    )
    .replace(
      /\bde(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/gi,
      'de $1'
    )
    .replace(/\bde(\d{2,4})\b/gi, 'de $1')
    .replace(/\s+/g, ' ')

  // 1. Formato ISO: "YYYY-MM-DD", "YYYY/MM/DD" ou "YYYY MM DD"
  const isoMatch = cleaned.match(
    /(?:^|\D)(\d{4})[\/\.\-\s](\d{1,2})[\/\.\-\s](\d{1,2})(?:\D|$)/
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

  // 2. Formato numérico DMY: "21/01/2025", "21.01.2025", "21-01-2025"
  const dmyMatch = cleaned.match(
    /(?:^|\D)(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})(?:\D|$)/
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

  // 3. Formato textual: "26 de junho de 2026", "27de Agosto de 2026", "08 de Janeiro de 2026"
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
    const text = (pdfText || '').replace(/[\x00\0]/g, ' ').trim()
    const isScannedImage = text.length < 50

    // 1. Classificação do documento (nome + texto do PDF)
    const classification: ClassificationResult = CertificateClassifier.classify(
      filename,
      isScannedImage ? undefined : text
    )
    const code = classification.code

    if (isScannedImage) {
      return this.notReadResult(
        filename,
        classification,
        'o PDF não tem texto legível (nem após OCR)'
      )
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
    const fnDate = evidencedFilenameDate(filename, text)
    let certResult = this.extractCertificateDates(text, code, refDate, fnDate)

    const rawFnDate = parseDateFromFilename(filename)
    if (
      certResult?.issueDate &&
      rawFnDate &&
      code &&
      SIGNATURE_DATE_CLAUSE.test(certResult.clause || '')
    ) {
      const gapDays =
        (certResult.issueDate.getTime() - rawFnDate.getTime()) / 86_400_000
      if (gapDays > 0 && gapDays <= SIGNATURE_GAP_MAX_DAYS) {
        const stricterExp = calculateDocExpiration(code, rawFnDate, refDate)
        certResult = {
          issueDate: rawFnDate,
          expirationDate:
            certResult.expirationDate &&
            stricterExp &&
            certResult.expirationDate < stricterExp
              ? certResult.expirationDate
              : stricterExp,
          clause: `${certResult.clause} | Data do curso (anterior à assinatura) tomada do nome por ser mais restritiva: ${rawFnDate.toLocaleDateString('pt-BR')}`,
        }
      }
    }

    // Reconciliação com data do nome do arquivo (especialmente crucial para PDFs F+R - Formação + Reciclagem):
    // Se o nome do arquivo contém uma data mais recente que a data de emissão extraída do texto
    // (ou se a data de validade extraída do texto já está vencida enquanto a data do nome é posterior),
    // a data do nome reflete a reciclagem mais recente e deve prevalecer.
    if (fnDate) {
      if (!certResult) {
        certResult = {
          issueDate: fnDate,
          clause: `Data do arquivo: ${filename}`,
        }
      } else {
        const textIssueTime = certResult.issueDate?.getTime() || 0
        const textExpTime = certResult.expirationDate?.getTime() || 0
        const isTextExpired = textExpTime > 0 && textExpTime < refDate.getTime()

        if (
          fnDate.getTime() > textIssueTime ||
          (isTextExpired && fnDate.getTime() > textExpTime)
        ) {
          certResult.issueDate = fnDate
          if (isTextExpired || !certResult.expirationDate) {
            certResult.expirationDate = undefined
          }
          certResult.clause = certResult.clause
            ? `${certResult.clause} | Atualizado via nome: ${fnDate.toLocaleDateString('pt-BR')}`
            : `Data do arquivo: ${filename}`
        }
      }
    }

    if (certResult && (certResult.expirationDate || certResult.issueDate)) {
      const finalExpDate =
        code && EVENT_TRIGGERED_ONLY_CODES.includes(code)
          ? calculateDocExpiration(
              code,
              certResult.issueDate || certResult.expirationDate || refDate,
              refDate
            )
          : certResult.expirationDate ||
            (certResult.issueDate && code
              ? calculateDocExpiration(code, certResult.issueDate, refDate)
              : undefined)

      const evalResult = EHSEvaluator.evaluateForCode(
        code,
        finalExpDate,
        refDate
      )
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

    if (code && EVENT_TRIGGERED_ONLY_CODES.includes(code)) {
      const expirationDate = calculateDocExpiration(code, null, refDate)
      const evalResult = EHSEvaluator.evaluateForCode(
        code,
        expirationDate,
        refDate
      )
      return {
        code,
        expirationDate,
        statusEHS: evalResult.status,
        statusDetail: evalResult.detail,
        source: 'PDF_CONTENT',
        classificationSource: classification.source,
        matchedTerm: classification.matchedTerm,
      }
    }

    return this.notReadResult(
      filename,
      classification,
      'o conteúdo foi lido, mas nenhuma data de emissão ou validade está impressa no documento'
    )
  }

  /**
   * Inspeciona um PDF composto por uma ou múltiplas páginas (Fase 2).
   * Se páginas individuais contiverem certificados de normas diferentes (ex.: GWO BST composto por
   * Primeiros Socorros, Carga Manual, Incêndio e Altura em páginas distintas, ou NR-10 Básico + SEP),
   * retorna um resultado independente para cada norma encontrada.
   */
  static inspectPages(
    filename: string,
    pages: string[],
    refDate: Date = new Date()
  ): InspectedDocumentResult[] {
    const text = (pages ?? []).join('\n')
    return this.inspectPagesRaw(filename, pages, refDate).map(item =>
      preferCourseDateOverSignature(item, filename, text, refDate)
    )
  }

  private static inspectPagesRaw(
    filename: string,
    pages: string[],
    refDate: Date
  ): InspectedDocumentResult[] {
    if (!pages || pages.length === 0) {
      return [this.inspect(filename, '', refDate)]
    }

    if (pages.length === 1) {
      return [this.inspect(filename, pages[0], refDate)]
    }

    const combinedText = pages.join('\n\n')
    const overallResult = this.inspect(filename, combinedText, refDate)

    // Se o documento todo for vazio (scan puro sem texto), retorna o fallback geral
    const totalLength = combinedText.replace(/\s+/g, '').length
    if (totalLength < 30) {
      return [overallResult]
    }

    // Proteção SSOT: Se o arquivo é de uma norma específica e não é um pacote reconhecido de múltiplas normas,
    // não deve dividi-lo em normas alheias (ex.: Ordem de Serviço ou Elevador JASO mencionando NR-35).
    const prefixCode = parseDocCode(filename)
    if (!isMultiNormAllowed(filename, overallResult.code, prefixCode)) {
      return [overallResult]
    }

    const allowedCodes = getAllowedMultiNormCodes(
      filename,
      overallResult.code,
      prefixCode
    )

    // Analisa página a página para identificar se há normas distintas
    const pageResultsByCode = new Map<string, InspectedDocumentResult>()

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i]
      if (pageText.replace(/\s+/g, '').length < 30) continue

      // Classifica a página individualmente pelo seu conteúdo textual (não pelo nome compilado do arquivo)
      let pageClassification = CertificateClassifier.classify(
        `pagina_${i + 1}.pdf`,
        pageText
      )
      if (!pageClassification.code) {
        pageClassification = CertificateClassifier.classify(filename, pageText)
      }
      const pageCode = pageClassification.code
      if (!pageCode) continue

      // Se há restrição de códigos permitidos para este pacote (ex.: GWO ou NR-10+SEP), ignora outros códigos
      if (allowedCodes && !allowedCodes.has(pageCode)) continue

      // Extrai datas para a norma identificada nesta página
      const isContractDoc = ['40', '40.1', '04', '04.1'].includes(pageCode)
      const fnDate = evidencedFilenameDate(filename, pageText)
      let pageCert = isContractDoc
        ? this.extractContractDates(pageText, pageCode, refDate)
        : this.extractCertificateDates(pageText, pageCode, refDate, fnDate)

      // Reconciliação com data do nome do arquivo SOMENTE se for a mesma norma do arquivo como um todo
      if (!pageCert && fnDate && pageCode === overallResult.code) {
        pageCert = {
          issueDate: fnDate,
          clause: `Data do arquivo: ${filename}`,
        }
      }

      // Uma página só pode ser considerada um certificado autônomo de norma distinta se trouxer sua própria data
      if (
        !pageCert?.issueDate &&
        !pageCert?.expirationDate &&
        pageCode !== overallResult.code
      ) {
        continue
      }

      let expDate: Date | undefined
      if (EVENT_TRIGGERED_ONLY_CODES.includes(pageCode)) {
        expDate = calculateDocExpiration(
          pageCode,
          pageCert?.issueDate || refDate,
          refDate
        )
      } else if (pageCert?.expirationDate) {
        expDate = pageCert.expirationDate
      } else if (pageCert?.issueDate) {
        expDate = calculateDocExpiration(pageCode, pageCert.issueDate, refDate)
      } else if (
        overallResult.code === pageCode &&
        overallResult.expirationDate
      ) {
        expDate = overallResult.expirationDate
      }

      const evalRes = EHSEvaluator.evaluateForCode(pageCode, expDate, refDate)
      const pageItem: InspectedDocumentResult = {
        code: pageCode,
        issueDate: pageCert?.issueDate || overallResult.issueDate,
        expirationDate: expDate,
        statusEHS: evalRes.status,
        statusDetail: evalRes.detail,
        source: 'PDF_CONTENT',
        classificationSource: pageClassification.source,
        matchedTerm: `${pageClassification.matchedTerm || DOC_CATALOG_MAP[pageCode]} (Pág. ${i + 1})`,
        extractedClause: pageCert?.clause || overallResult.extractedClause,
      }

      // Se a página for de outro certificado GWO mas contiver o WINDA ID no texto, adiciona o 30 também!
      if (
        pageCode !== '30' &&
        /\b(?:WINDA\s+ID|WINDA\b|GWO\s+WINDA)\b/i.test(pageText)
      ) {
        const windaItem: InspectedDocumentResult = {
          code: '30',
          issueDate: pageCert?.issueDate || overallResult.issueDate,
          expirationDate: calculateDocExpiration(
            '30',
            pageCert?.issueDate || overallResult.issueDate || refDate,
            refDate
          ),
          statusEHS: 'CONFORME',
          statusDetail: 'ID Vitalício (Detectado via conteúdo GWO)',
          source: 'PDF_CONTENT',
          classificationSource: 'SEMANTIC',
          matchedTerm: `GWO WINDA ID (Detectado na Pág. ${i + 1})`,
          extractedClause: `Conteúdo da página confirmou o WINDA ID do colaborador.`,
        }
        const existingWinda = pageResultsByCode.get('30')
        if (!existingWinda) {
          pageResultsByCode.set('30', windaItem)
        }
      }

      const existing = pageResultsByCode.get(pageCode)
      if (
        !existing ||
        (pageItem.expirationDate &&
          (!existing.expirationDate ||
            pageItem.expirationDate.getTime() >
              existing.expirationDate.getTime()))
      ) {
        pageResultsByCode.set(pageCode, pageItem)
      }
    }

    // Se encontramos 2 ou mais normas diferentes nas páginas (ex.: 16, 17, 19, 21 ou 12, 13):
    if (pageResultsByCode.size > 1) {
      return Array.from(pageResultsByCode.values())
    }

    // Se encontrou apenas 1 norma nas páginas:
    if (pageResultsByCode.size === 1) {
      const singlePageResult = Array.from(pageResultsByCode.values())[0]
      if (
        singlePageResult.expirationDate &&
        (!overallResult.expirationDate ||
          singlePageResult.expirationDate.getTime() >
            overallResult.expirationDate.getTime())
      ) {
        return [singlePageResult]
      }
      return [overallResult]
    }

    return [overallResult]
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
    const clean = text
      .replace(/[\x00\0]/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')

    // Caso A: Cláusula de encerramento explícito:
    // Ex.: "encerrando-se em 08/01/2027", "encerrando- se em 11/05/2027"
    const encerramentoRegex = new RegExp(
      `encerrando\\s*-\\s*se\\s+em\\s+(${DATE_CAPTURE_PATTERN})`,
      'i'
    )
    const encerramentoMatch = clean.match(encerramentoRegex)
    if (encerramentoMatch) {
      const parsedExp = parsePortugueseDate(encerramentoMatch[1])
      if (parsedExp) {
        let issueDate: Date | undefined
        const dateNearRegex = new RegExp(
          `(?:Sorocaba|Caucaia|Fortaleza|São\\s+Paulo|Curitiba|Rio\\s+de\\s+Janeiro)[\\s\\/A-Z]*,?\\s*(${DATE_CAPTURE_PATTERN})`,
          'i'
        )
        const dateNear = clean.match(dateNearRegex)
        if (dateNear) {
          const base = parsePortugueseDate(dateNear[1])
          if (base && base.getTime() < parsedExp.getTime()) {
            issueDate = base
          }
        }
        return {
          issueDate,
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

    // Caso D: "passa a vigorar [a partir de|de|da data de] [DATA] e terá [vigência|duração] de [X] [meses|ano|anos]"
    const vigorarRegex = new RegExp(
      `passa(?:ndo)?\\s+a\\s+vigorar\\s+(?:a\\s+partir\\s+de|da\\s+data\\s+de|de)\\s+(${DATE_CAPTURE_PATTERN})\\s+e\\s+ter[aá]\\s+(?:vig[eê]ncia|dura[cç][aã]o)\\s+de\\s+([^\\.,;\\n]+?)(?:meses|mes|anos|ano)`,
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
    refDate: Date,
    filenameDate?: Date | null
  ): { issueDate?: Date; expirationDate?: Date; clause: string } | null {
    const clean = text
      .replace(/[\x00\0]/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')

    let explicitExpDate: Date | undefined
    let explicitIssueDate: Date | undefined
    let foundClause = ''

    // 1. Procura validade explícita direta: "Válido até DD/MM/AAAA", "Validade: DD/MM/AAAA", "Expiration Date: YYYY-MM-DD", "Valid until", "Término da vigência: DD/MM/AAAA", "Fim da vigência: DD/MM/AAAA"
    const validadeAteRegex = new RegExp(
      `(?:v[aá]lido\\s+at[eé]|validade(?:\\s+at[eé])?|expiration\\s+date|valid\\s+until|expires|t[eé]rmino\\s*(?:de|da)?\\s*vig[eê]ncia|fim\\s*(?:de|da)?\\s*vig[eê]ncia|vig[eê]ncia\\s+at[eé])\\s*:?\\s*(${DATE_CAPTURE_PATTERN})`,
      'gi'
    )
    for (const match of clean.matchAll(validadeAteRegex)) {
      const parsed = parsePortugueseDate(match[1])
      if (parsed) {
        if (!explicitExpDate || parsed.getTime() > explicitExpDate.getTime()) {
          explicitExpDate = parsed
          foundClause = match[0]
        }
      }
    }

    // 1.1 Apólices e certificados de seguro (ex: MAG Seguros / Mongeral Aegon / Porto): tabela com "Início de Vigência ... Término de Vigência ... DATA ... DATA"
    const seguroTableRegex =
      /In[íi]cio\s*(?:de|da)?\s*Vig[êe]ncia.*?T[éèe]rmino\s*(?:de|da)?\s*Vig[êe]ncia.*?(\d{2}\/\d{2}\/\d{4}).*?(\d{2}\/\d{2}\/\d{4})/i
    const seguroTableMatch = clean.match(seguroTableRegex)
    if (seguroTableMatch) {
      const parsedInicio = parsePortugueseDate(seguroTableMatch[1])
      const parsedTermino = parsePortugueseDate(seguroTableMatch[2])
      if (parsedTermino) {
        if (
          !explicitExpDate ||
          parsedTermino.getTime() > explicitExpDate.getTime()
        ) {
          explicitExpDate = parsedTermino
          foundClause = seguroTableMatch[0].slice(0, 100)
        }
      }
      if (parsedInicio && !explicitIssueDate) {
        explicitIssueDate = parsedInicio
      }
    }

    // 2. Procura cláusula de validade por período: "Treinamento válido por 02 (Dois) anos", "válido por 1 ano"
    let validityYearsFromText: number | undefined
    for (const match of clean.matchAll(
      /(?:treinamento\s+)?v[aá]lido\s+por\s+([^\.,;\n]+?)(?:anos?|ano|meses?)/gi
    )) {
      const snippet = match[0]
      const numberMatch = snippet.match(
        /\b(um|uma|01|1|dois|duas|02|2|tres|três|03|3|quatro|04|4|cinco|05|5)\b/i
      )
      if (numberMatch) {
        const val = NUMBER_WORDS[numberMatch[1].toLowerCase()]
        if (val) validityYearsFromText = val
      }
    }

    // 3. Procura data de realização / início do curso (coleta candidatos dando prioridade à data de início)
    interface DateCandidate {
      date: Date
      clause: string
      priority: number // 0: data de início explícita/período inicial, 1: conclusão direta/período, 2: cidade/assinatura, 3: clicksign log
    }
    const completionCandidates: DateCandidate[] = []

    // Ex. 0: "Iniciado em 31/03/2026 e concluído em 17/04/2026", "Data de início: 28/01/2026", "Início da vigência: 22/04/2026"
    const iniciadoRegex = new RegExp(
      `(?:data\\s+de\\s+in[ií]cio|iniciado\\s+em|realizado\\s+de|per[ií]odo\\s+de|in[ií]cio\\s*(?:de|da)?\\s*vig[eê]ncia)\\s*:?\\s*(${DATE_CAPTURE_PATTERN})`,
      'gi'
    )
    for (const m of clean.matchAll(iniciadoRegex)) {
      const parsed = parsePortugueseDate(m[1])
      if (parsed) {
        completionCandidates.push({ date: parsed, clause: m[0], priority: 0 })
      }
    }

    // Ex. A: "Concluído em 12 de Maio de 2025" / "Date Certified: 2026-06-03" / "Data de Conclusão: <uuid> 2025 07 24"
    const concluidoRegex = new RegExp(
      `(?:data\\s+de\\s+(?:conclus[aã]o|t[eé]rmino|emiss[aã]o|realiza[cç][aã]o)|conclus[aã]o|conclu[ií]do|terminado|finalizado|date\\s+certified|certified\\s+date|issue\\s+date|date\\s+of\\s+issue)\\s*(?:em|on|:)?(?:\\s+[0-9a-f\\s\\-]{16,50})?\\s*(${DATE_CAPTURE_PATTERN})`,
      'gi'
    )
    for (const m of clean.matchAll(concluidoRegex)) {
      const parsed = parsePortugueseDate(m[1])
      if (parsed) {
        completionCandidates.push({ date: parsed, clause: m[0], priority: 1 })
      }
    }

    // Ex. B: "no período de [INICIO] a [FIM]" -> m[1] é a data de início!
    const periodoRegex = new RegExp(
      `(?:conclu[ií]do|realizado|ministrado)?\\s*(?:no\\s+per[ií]odo\\s+de|per[ií]odo\\s+de)\\s+(${DATE_CAPTURE_PATTERN})\\s+[aà]\\s+(${DATE_CAPTURE_PATTERN})`,
      'gi'
    )
    for (const m of clean.matchAll(periodoRegex)) {
      const startParsed = parsePortugueseDate(m[1])
      if (startParsed) {
        completionCandidates.push({
          date: startParsed,
          clause: m[0],
          priority: 0,
        })
      } else {
        const endParsed = parsePortugueseDate(m[2])
        if (endParsed) {
          completionCandidates.push({
            date: endParsed,
            clause: m[0],
            priority: 1,
          })
        }
      }
    }

    // Ex. C: "nos dias 07 e 08 de Janeiro de 2026", "no dia 27de Agosto de 2026", "no dia 27/01/2026", "completou ... no dia [DATA]", "entre os dias 26 A 29 DE NOVEMBRO DE 2025"
    const noDiaRegex = new RegExp(
      `(?:no[s]?\\s+dia[s]?|entre\\s+os\\s+dias|completou.*?no\\s+dia|completou.*?entre\\s+os\\s+dias)\\s*(${DATE_CAPTURE_PATTERN})`,
      'gi'
    )
    for (const m of clean.matchAll(noDiaRegex)) {
      const parsed = parsePortugueseDate(m[1])
      if (parsed) {
        completionCandidates.push({ date: parsed, clause: m[0], priority: 0 })
      }
    }

    // Se encontramos candidatos de início (prioridade 0) ou conclusão (prioridade 1)
    const startCandidates = completionCandidates.filter(c => c.priority === 0)
    if (startCandidates.length > 0) {
      startCandidates.sort((a, b) => b.date.getTime() - a.date.getTime())
      explicitIssueDate = startCandidates[0].date
      foundClause = startCandidates[0].clause
    } else {
      const directCandidates = completionCandidates.filter(
        c => c.priority === 1
      )
      if (directCandidates.length > 0) {
        directCandidates.sort((a, b) => b.date.getTime() - a.date.getTime())
        explicitIssueDate = directCandidates[0].date
        if (!foundClause) foundClause = directCandidates[0].clause
      }
    }

    // A data do nome do arquivo é a data inicial padronizada; datas de assinatura (cidade/Clicksign)
    // só servem de último recurso quando o nome não traz data.
    if (!explicitIssueDate && filenameDate) {
      explicitIssueDate = filenameDate
      if (!foundClause) foundClause = 'Data do nome do arquivo'
    }

    // Ex. D: Assinatura de cidade no rodapé: "Fortaleza, 08 de Janeiro de 2026", "Sorocaba (SP), 29 de Março de 2023"
    if (!explicitIssueDate) {
      const cidadeRegex = new RegExp(
        `(?:Fortaleza|Caucaia|Sorocaba|Mossor[oó]|Parnamirim|S[aã]o\\s+Paulo|Natal)[\\s\\/\\(A-Z]*,?\\s*(${DATE_CAPTURE_PATTERN})`,
        'gi'
      )
      const cidadeCandidates: DateCandidate[] = []
      for (const m of clean.matchAll(cidadeRegex)) {
        const parsed = parsePortugueseDate(m[1])
        if (parsed) {
          cidadeCandidates.push({ date: parsed, clause: m[0], priority: 2 })
        }
      }
      if (cidadeCandidates.length > 0) {
        cidadeCandidates.sort((a, b) => b.date.getTime() - a.date.getTime())
        explicitIssueDate = cidadeCandidates[0].date
        if (!foundClause) foundClause = cidadeCandidates[0].clause
      }
    }

    // Ex. E: Clicksign logs / assinaturas no rodapé: "Assinou em 14 set 2026", "Log gerado em 14 de setembro de 2026"
    if (!explicitIssueDate) {
      const clicksignRegex = new RegExp(
        `(?:assinou\\s+em|log\\s+gerado\\s+em)\\s+(${DATE_CAPTURE_PATTERN})`,
        'gi'
      )
      const clicksignCandidates: DateCandidate[] = []
      for (const m of clean.matchAll(clicksignRegex)) {
        const parsed = parsePortugueseDate(m[1])
        if (parsed) {
          clicksignCandidates.push({ date: parsed, clause: m[0], priority: 3 })
        }
      }
      if (clicksignCandidates.length > 0) {
        clicksignCandidates.sort((a, b) => b.date.getTime() - a.date.getTime())
        explicitIssueDate = clicksignCandidates[0].date
        if (!foundClause) foundClause = clicksignCandidates[0].clause
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
   */
  static notReadResult(
    filename: string,
    classification: ClassificationResult,
    reason: string
  ): InspectedDocumentResult {
    return {
      code: classification.code,
      statusEHS: 'NAO_LIDO',
      statusDetail: notReadDetail(filename, reason),
      source: 'FILENAME',
      classificationSource: classification.source,
      matchedTerm: classification.matchedTerm,
    }
  }
}

export function notReadDetail(filename: string, reason: string): string {
  return `BLOQUEADO — NÃO LIDO: ${reason}. Não existe nenhuma referência válida deste documento no Drive; o nome do arquivo ("${filename}") não é aceito como prova. Ação do responsável: salvar na pasta do colaborador o PDF legível do documento.`
}

const SIGNATURE_DATE_CLAUSE =
  /assinou\s+em|log\s+gerado\s+em|^(?:Fortaleza|Caucaia|Sorocaba|Mossor[oó]|Parnamirim|S[aã]o\s+Paulo|Natal)\b/i
const SIGNATURE_GAP_MAX_DAYS = 60

const PT_MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

export function dateAppearsInText(date: Date, text: string): boolean {
  const d = date.getDate()
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const yy = String(y).slice(2)
  const sep = '\\s*[./-]\\s*'
  const day = `0?${d}`
  const month = `0?${m}`
  const numeric = new RegExp(
    `(?<!\\d)${day}${sep}${month}${sep}(?:${y}|${yy})(?!\\d)|(?<!\\d)${y}${sep}${mm}${sep}${dd}(?!\\d)`
  )
  const normalized = text.toLowerCase().replace(/\s+/g, ' ')
  const written = new RegExp(
    `(?<!\\d)${day}º?\\s*(?:de\\s*)?${PT_MONTHS[m - 1].replace('ç', '[çc]')}\\s*(?:de\\s*)?${y}`
  )
  return numeric.test(normalized) || written.test(normalized)
}

export function readSourceOf(
  item: InspectedDocumentResult
): 'CONTENT' | 'OCR' | 'NAO_LIDO' {
  if (item.statusEHS === 'NAO_LIDO' || item.source === 'FILENAME')
    return 'NAO_LIDO'
  return item.source === 'IMAGE_FALLBACK' ? 'OCR' : 'CONTENT'
}

const fmt = (d: Date) => d.toLocaleDateString('pt-BR')

export function filenameDivergences(
  item: InspectedDocumentResult,
  filenameCode: string | null,
  filenameDate: Date | null
): string[] {
  if (readSourceOf(item) === 'NAO_LIDO') return []
  const out: string[] = []
  if (filenameCode && item.code && filenameCode !== item.code)
    out.push(
      `Nome do arquivo indica código ${filenameCode}, o conteúdo é ${item.code} (${DOC_CATALOG_MAP[item.code] ?? item.code})`
    )
  if (filenameDate && item.issueDate) {
    const days = Math.abs(
      (filenameDate.getTime() - item.issueDate.getTime()) / 86_400_000
    )
    if (days >= 1)
      out.push(
        `Data no nome (${fmt(filenameDate)}) difere da data impressa no documento (${fmt(item.issueDate)})`
      )
  }
  return out
}

function rank(cert: {
  readSource?: string
  expirationDate?: Date
  issueDate?: Date
}): number {
  if (cert.readSource === 'NAO_LIDO') return 0
  return cert.expirationDate || cert.issueDate ? 2 : 1
}

export function outranks(
  candidate: { readSource?: string; expirationDate?: Date; issueDate?: Date },
  current: { readSource?: string; expirationDate?: Date; issueDate?: Date }
): boolean {
  const a = rank(candidate)
  const b = rank(current)
  if (a !== b) return a > b
  return (
    (candidate.expirationDate?.getTime() ?? 0) >
    (current.expirationDate?.getTime() ?? 0)
  )
}

export function preferCourseDateOverSignature(
  item: InspectedDocumentResult,
  filename: string,
  text: string,
  refDate: Date
): InspectedDocumentResult {
  const course = parseDateFromFilename(filename)
  if (
    !item.code ||
    !item.issueDate ||
    !course ||
    !SIGNATURE_DATE_CLAUSE.test(item.extractedClause || '') ||
    !dateAppearsInText(course, text)
  )
    return item
  const gapDays = (item.issueDate.getTime() - course.getTime()) / 86_400_000
  if (gapDays <= 0 || gapDays > SIGNATURE_GAP_MAX_DAYS) return item
  const courseExp = calculateDocExpiration(item.code, course, refDate)
  const expirationDate =
    item.expirationDate && courseExp && item.expirationDate < courseExp
      ? item.expirationDate
      : courseExp
  const evaluation = EHSEvaluator.evaluateForCode(
    item.code,
    expirationDate,
    refDate
  )
  return {
    ...item,
    issueDate: course,
    expirationDate,
    statusEHS: evaluation.status,
    statusDetail: evaluation.detail,
    extractedClause: `Data do curso impressa no documento (${course.toLocaleDateString('pt-BR')}), anterior à assinatura`,
  }
}

export type HolderStatus = 'OK' | 'NAO_ENCONTRADO' | 'OUTRA_PESSOA'

export interface HolderCheck {
  status: HolderStatus
  other?: string
}

const NAME_PARTICLES = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'])

function normalizeForNames(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()} `
}

export function personNameTokens(name: string): string[] {
  return normalizeForNames(name)
    .trim()
    .split(' ')
    .filter(t => t.length >= 2 && !NAME_PARTICLES.has(t))
}

function containsName(
  spaced: string,
  compact: string,
  tokens: string[],
  minSurnames: number
): boolean {
  if (tokens.length < 2) return false
  const [first, ...surnames] = tokens
  const has = (t: string) => spaced.includes(` ${t} `)
  if (has(first) && surnames.filter(has).length >= minSurnames) return true
  const last = surnames[surnames.length - 1]
  return (
    minSurnames <= 1 &&
    first.length >= 4 &&
    last.length >= 4 &&
    compact.includes(first) &&
    compact.includes(last)
  )
}

export function checkHolder(
  text: string,
  holderName: string,
  roster: string[]
): HolderCheck {
  const spaced = normalizeForNames(text)
  const compact = spaced.replace(/ /g, '')
  const holderTokens = personNameTokens(holderName)
  if (containsName(spaced, compact, holderTokens, 1)) return { status: 'OK' }
  const holderKey = holderTokens.join(' ')
  for (const other of roster) {
    const tokens = personNameTokens(other)
    if (tokens.join(' ') === holderKey) continue
    if (containsName(spaced, compact, tokens, 2))
      return { status: 'OUTRA_PESSOA', other }
  }
  return { status: 'NAO_ENCONTRADO' }
}

export function evidencedFilenameDate(
  filename: string,
  text: string
): Date | null {
  const date = parseDateFromFilename(filename)
  return date && dateAppearsInText(date, text) ? date : null
}
