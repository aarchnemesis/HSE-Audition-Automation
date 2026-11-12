/**
 * Converte a ficha de extração dos leitores (Prometheus A+B) no resultado de leitura usado pelo
 * resto do sistema. As regras de validade continuam fixas (EHSEvaluator / tabela de códigos): o
 * modelo só extrai curso, modalidade, datas, titular e prazo de contrato.
 */
import type { LlmDocument } from '../../adapters/llm/PrometheusReader.js'
import { getValidityYearsForCode } from '../../adapters/drive/certificateFilenameParser.js'
import { CertificateClassifier } from './CertificateClassifier.js'
import { EHSEvaluator } from './EHSEvaluator.js'
import { INDEFINITE_CONTRACT_END, InspectedDocumentResult } from './PDFContentInspector.js'

/** Aceita AAAA-MM-DD e também DD/MM/AAAA no meio de texto livre (validade de CNH, prazo de contrato). */
const iso = (s?: string) => {
  if (!s) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T03:00:00.000Z`)
  const br = s.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/)
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T03:00:00.000Z`)
  const ymd = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return ymd ? new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T03:00:00.000Z`) : undefined
}
const norm = (s?: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

const CARTA_CODE: Record<string, string> = { '10': '12.1', '12': '15.1', '33': '20.1', '35': '21.1' }
const TYPE_CODE: Record<string, string> = { aso: '01', ordem_servico: '02', cnh: '08', cartao_vacina: '05', ficha_epi: '06' }

/** Código interno do documento lido pelo modelo; null quando não dá para saber. */
export function codeForLlmDocument(d: LlmDocument): string | null {
  if (TYPE_CODE[d.tipo_documento]) return TYPE_CODE[d.tipo_documento]
  const nr = norm(d.curso_ou_norma).match(/\bNR\s*-?\s*(\d{1,2})\b/)?.[1]
  if (d.tipo_documento === 'carta_autorizacao') return nr ? CARTA_CODE[String(Number(nr))] ?? null : null
  if (d.tipo_documento === 'contrato') return /ADITIVO/.test(norm(d.curso_ou_norma)) ? '40.1' : '40'
  return CertificateClassifier.classify(d.curso_ou_norma).code
}

export function mapLlmDocument(d: LlmDocument, refDate: Date, note: string): InspectedDocumentResult | null {
  const code = codeForLlmDocument(d)
  if (!code) return null
  const issue = iso(d.data_conclusao) ?? iso(d.data_inicio) ?? (d.tipo_documento === 'carta_autorizacao' ? iso(d.data_assinatura) : undefined)
  let expiration: Date | undefined
  const prazo = norm(d.prazo_contrato)
  if (code === '40' || code === '40.1') {
    // CLT por prazo indeterminado ou experiência (que segue indeterminada): não vence.
    if (/INDETERMINADO|EXPERIENCIA/.test(prazo)) expiration = INDEFINITE_CONTRACT_END
    else expiration = iso(d.prazo_contrato)
  } else if (code === '08') {
    expiration = iso(d.validade_declarada) // CNH: validade impressa
  } else if (issue) {
    expiration = EHSEvaluator.calculateExpirationFromIssue(issue, getValidityYearsForCode(code))
  }
  const ev = EHSEvaluator.evaluateForCode(code, expiration, refDate)
  return {
    code,
    issueDate: issue,
    expirationDate: expiration,
    statusEHS: ev.status,
    statusDetail: ev.detail,
    source: 'PDF_CONTENT',
    classificationSource: 'SEMANTIC',
    matchedTerm: `${d.curso_ou_norma}${d.modalidade && d.modalidade !== 'ausente' ? ` (${d.modalidade})` : ''}`,
    extractedClause: note,
  }
}
