// Pure parsing for the TDoc (JSF) workforce and document tables. The scraper reads each table
// into arrays of cell strings inside page.evaluate(); these helpers turn those into the
// TdocRawWorker shape that LegacyCensusNormalizers.normalizeTdoc already handles (and tests).
// Column order confirmed from the WPLATAM grids (Gemini, 2026-10-26):
//   workers: [_, sobrenome1, sobrenome2, nome, cpf, funcao, _, strikes]
//   docs:    [grupo, documento, status, procedimento]

export interface TdocDocEntry {
  documento: string
  status?: string
}

export interface TdocRawWorker {
  nome: string
  cpf?: string
  funcao?: string
  proprietario?: string
  pendencias: TdocDocEntry[]
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Worker row -> name/cpf/role, or null for header/empty rows (a real row has a CPF). */
export function workerFromCells(
  cells: string[]
): { nome: string; cpf: string; funcao: string } | null {
  const sobrenome1 = clean(cells[1])
  const sobrenome2 = clean(cells[2])
  const nome = clean(cells[3])
  const cpf = clean(cells[4])
  if (!cpf || cpf.toUpperCase() === 'CPF' || cpf.toUpperCase() === 'DNI')
    return null
  const fullName = `${nome} ${sobrenome1} ${sobrenome2}`
    .replace(/\s+/g, ' ')
    .trim()
  if (!fullName) return null
  return { nome: fullName, cpf, funcao: clean(cells[5]) }
}

/** Document row -> title/status, or null for header/empty rows (a real row has a title). */
export function docFromCells(cells: string[]): TdocDocEntry | null {
  const documento = clean(cells[1])
  if (!documento || /^documento$/i.test(documento)) return null
  return { documento, status: clean(cells[2]) || undefined }
}

/**
 * Assemble one worker with all documents into the normalizeTdoc input shape. Every document goes
 * into `pendencias`: tdocDocument() derives the real status from the status string either way, so
 * OK/NO OK/Pendente/AUSENTE are all classified correctly without pre-splitting.
 */
export function toTdocRawWorker(
  worker: { nome: string; cpf: string; funcao: string },
  docs: TdocDocEntry[],
  proprietario?: string
): TdocRawWorker {
  return {
    nome: worker.nome,
    cpf: worker.cpf,
    funcao: worker.funcao || undefined,
    proprietario: proprietario ? clean(proprietario) : undefined,
    pendencias: docs,
  }
}
