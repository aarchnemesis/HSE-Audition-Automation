/**
 * Nome de arquivo do Book de Padronização EHS (Armando, 10/11/2026, seções 2 a 4):
 *   CC_DOCUMENTO-TIPO_EMI-AAAA-MM-DD_VAL-AAAA-MM-DD_NOME-COMPLETO.pdf
 * Usado pelo plano de renomeação do Drive e pela inclusão de certificados da Storz.
 */

export type BookKind = 'TREINO' | 'ASO' | 'UNICO'

/** Código atual do Drive -> código e sigla do Book (seção 3). As cartas mudam de número (41-44). */
export const BOOK_CODE: Record<string, { cc: string; doc: string; kind: BookKind }> = {
  '01': { cc: '01', doc: 'ASO', kind: 'ASO' },
  '02': { cc: '02', doc: 'OS-SST', kind: 'UNICO' },
  '03': { cc: '03', doc: 'FICHA-REGISTRO', kind: 'UNICO' },
  '04': { cc: '04', doc: 'CONTRATO-CTPS', kind: 'UNICO' },
  '04.1': { cc: '04', doc: 'CONTRATO-ADITIVO', kind: 'UNICO' },
  '40': { cc: '04', doc: 'CONTRATO', kind: 'UNICO' },
  '40.1': { cc: '04', doc: 'CONTRATO-ADITIVO', kind: 'UNICO' },
  '05': { cc: '05', doc: 'VACINA', kind: 'UNICO' },
  '06': { cc: '06', doc: 'FICHA-EPI', kind: 'UNICO' },
  '07': { cc: '07', doc: 'SEGURO-VIDA', kind: 'UNICO' },
  '08': { cc: '08', doc: 'CNH', kind: 'UNICO' },
  '09': { cc: '09', doc: 'DIRECAO-DEFENSIVA', kind: 'TREINO' },
  '10': { cc: '10', doc: 'NR01', kind: 'TREINO' },
  '11': { cc: '11', doc: 'NR06', kind: 'TREINO' },
  '12': { cc: '12', doc: 'NR10', kind: 'TREINO' },
  '13': { cc: '13', doc: 'NR10-SEP', kind: 'TREINO' },
  '14': { cc: '14', doc: 'NR11', kind: 'TREINO' },
  '15': { cc: '15', doc: 'NR12', kind: 'TREINO' },
  '16': { cc: '16', doc: 'GWO-FA', kind: 'TREINO' },
  '17': { cc: '17', doc: 'GWO-MH', kind: 'TREINO' },
  '18': { cc: '18', doc: 'NR18', kind: 'TREINO' },
  '19': { cc: '19', doc: 'GWO-FAW', kind: 'TREINO' },
  '20': { cc: '20', doc: 'NR33', kind: 'TREINO' },
  '28': { cc: '28', doc: 'NR33-SUPERVISOR', kind: 'TREINO' },
  '21': { cc: '21', doc: 'NR35', kind: 'TREINO' },
  '22': { cc: '22', doc: 'LOTO', kind: 'TREINO' },
  '25': { cc: '25', doc: 'SIT', kind: 'TREINO' },
  '26': { cc: '26', doc: 'ESO', kind: 'TREINO' },
  '30': { cc: '30', doc: 'WINDA', kind: 'UNICO' },
  '32': { cc: '32', doc: 'GWO-ART', kind: 'TREINO' },
  '12.1': { cc: '41', doc: 'CARTA-NR10', kind: 'UNICO' },
  '15.1': { cc: '42', doc: 'CARTA-NR12', kind: 'UNICO' },
  '20.1': { cc: '43', doc: 'CARTA-NR33', kind: 'UNICO' },
  '21.1': { cc: '44', doc: 'CARTA-NR35', kind: 'UNICO' },
}

export const BOOK_SUBFOLDER: Record<BookKind, string> = {
  ASO: '02_SAUDE_OCUPACIONAL',
  TREINO: '03_TREINAMENTOS',
  UNICO: '01_DOCUMENTOS_PESSOAIS',
}

/** Sem vencimento (seção 4: registro, OS, contrato, vacina, diploma). */
export const BOOK_NO_EXPIRY = new Set(['02', '03', '04', '05', '24', '40', '40.1', '04.1'])

/** Seção 4: validade em meses a partir da EMI, pelo código do Book (cc). */
export const BOOK_VALIDITY_MONTHS: Record<string, number> = {
  '01': 12, '10': 12, '11': 12, '12': 24, '13': 24, '14': 12, '15': 12, '18': 12, '20': 12, '28': 12,
  '21': 24, '22': 12, '16': 24, '17': 24, '19': 24, '23': 24, '32': 24, '09': 24, '45': 6,
  '41': 12, '42': 12, '43': 12, '44': 12,
}

export function slugPersonName(n: string): string {
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '')
}

/** VAL pela matriz a partir da EMI; se o documento declarar validade menor, vale a menor. */
export function bookVal(code: string, emi?: string, declaredExp?: string | Date): string {
  const map = BOOK_CODE[code]
  if (!map || BOOK_NO_EXPIRY.has(code)) return 'NA'
  const declared = declaredExp ? new Date(declaredExp).toISOString().slice(0, 10) : undefined
  const usable = declared && Number(declared.slice(0, 4)) <= 2070 ? declared : undefined
  let byBook: string | undefined
  const months = BOOK_VALIDITY_MONTHS[map.cc]
  if (emi && months) {
    const d = new Date(`${emi}T12:00:00`)
    d.setMonth(d.getMonth() + months)
    byBook = d.toISOString().slice(0, 10)
  }
  return [byBook, usable].filter(Boolean).sort()[0] ?? 'NA'
}

/** Nome completo no padrão do Book, ou null quando o código não está na tabela. */
export function bookName(
  code: string,
  tipo: string,
  emi: string | undefined,
  person: string,
  declaredExp?: string | Date
): string | null {
  const map = BOOK_CODE[code]
  if (!map) return null
  return `${map.cc}_${map.doc}-${tipo}_EMI-${emi ?? 'NA'}_VAL-${bookVal(code, emi, declaredExp)}_${slugPersonName(person)}.pdf`
}
