// Pure parsing for Surisoft (Suricatta). The scraper reads each worker's encrypted token from the
// Colaboradores page, then calls the internal API POST /consultas/colaborador_requisitos_list
// which returns a document list as JSON. These helpers extract the token and map one API document
// to the LetterWorker.documentos shape that LegacyCensusNormalizers.normalizeSurisoft consumes.

/** Shape of one item in the API response `Dados` array (only the fields used). */
export interface SurisoftApiDoc {
  RequisitoNome?: string
  RequisitoObrigatorio?: boolean
  ArqNome?: string | null
  ArqCodigo?: string | number | null
  ArqValidade?: string | null
  uArqValidade?: string | null
  MotivoReprovacao?: string | null
  ArqObservacao?: string | null
  uArqObservacao?: string | null
}

export interface SurisoftRawDoc {
  titulo: string
  status: string
  validade: string | null
  motivo: string | null
  obrigatorio: boolean
}

/** Parse the id and encrypted token from an `exibirRequisitosColaborador(123, 'tok…')` onclick. */
export function parseWorkerToken(
  onclick: string
): { idColab: string; token: string } | null {
  const m = onclick.match(
    /exibirRequisitosColaborador\(\s*(\d+)\s*,\s*['"](.*?)['"]/
  )
  return m ? { idColab: m[1], token: m[2] } : null
}

const REJECTION_HINT = /reprov|rejeit|apresente|pendente/i

/**
 * Map one API document to the letter-status raw shape. EXPIRING/EXPIRED are left to the report
 * builder (derived from the date), so a document with a file and a valid date is 'a' (approved)
 * here regardless of how close the expiry is.
 */
export function mapSurisoftApiDoc(doc: SurisoftApiDoc): SurisoftRawDoc {
  const validade = doc.ArqValidade || doc.uArqValidade || null
  const observacao = doc.ArqObservacao || doc.uArqObservacao || null
  const hasFile = Boolean(doc.ArqNome || doc.ArqCodigo)
  const rejected =
    Boolean(doc.MotivoReprovacao && doc.MotivoReprovacao.trim()) ||
    Boolean(observacao && REJECTION_HINT.test(observacao))

  let status = 'a'
  if (!hasFile) status = 'p'
  else if (rejected) status = 'r'

  const motivo =
    doc.MotivoReprovacao ||
    (observacao && observacao !== '.' ? observacao : null)

  return {
    titulo: (doc.RequisitoNome || 'Documento').trim(),
    status,
    validade,
    motivo,
    obrigatorio: doc.RequisitoObrigatorio !== false,
  }
}
