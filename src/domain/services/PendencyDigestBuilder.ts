import { ELECTIVE_DOC_CODES } from './ComplianceEngine.js'
import { HSEDatabaseRecord } from './HSEDatabaseRepository.js'

export interface PendencyItem {
  docCode: string
  docName: string
  status: string
  modality?: string
  detail: string
}

export interface InspectorPendencyGroup {
  inspectorName: string
  role: string
  sector?: string
  items: PendencyItem[]
}

/**
 * Agrupa os registros do banco HSE por pessoa, incluindo só quem tem pendência (qualquer status
 * diferente de CONFORME). Usado pelo resumo diário — em vez de um e-mail por inspetor, um único
 * e-mail consolidado listando "quem tem pendência e qual é".
 */
export function buildPendencyDigest(
  records: HSEDatabaseRecord[]
): InspectorPendencyGroup[] {
  const groupsByName = new Map<string, InspectorPendencyGroup>()

  for (const rec of records) {
    if (rec.statusEHS === 'CONFORME') continue

    // Documento eletivo (ex.: SIT/ESO Vestas) ausente não é uma pendência ativa — só aparece
    // na planilha pra visibilidade, não gera alerta por e-mail.
    if (rec.statusEHS === 'AUSENTE' && ELECTIVE_DOC_CODES.has(rec.docCode))
      continue

    let group = groupsByName.get(rec.inspectorName)
    if (!group) {
      group = {
        inspectorName: rec.inspectorName,
        role: rec.role,
        sector: rec.sector,
        items: [],
      }
      groupsByName.set(rec.inspectorName, group)
    }

    group.items.push({
      docCode: rec.docCode,
      docName: rec.docName,
      status: rec.statusEHS,
      modality: rec.modality,
      detail: rec.detail,
    })
  }

  return Array.from(groupsByName.values()).sort(
    (a, b) => b.items.length - a.items.length
  )
}
