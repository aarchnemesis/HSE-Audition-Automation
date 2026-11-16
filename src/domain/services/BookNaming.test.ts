import { describe, expect, it } from 'vitest'
import { BOOK_CODE, bookName } from './BookNaming.js'
import { BOOK_DOC_TO_CODE, CertificateClassifier } from './CertificateClassifier.js'

describe('Book EHS: ida e volta do nome', () => {
  it('toda sigla do Book é reconhecida de volta pelo classificador', () => {
    expect(Object.entries(BOOK_CODE).filter(([, v]) => !BOOK_DOC_TO_CODE[v.doc]).map(([k]) => k)).toEqual([])
  })
  it.each(Object.keys(BOOK_CODE).filter(k => !['04.1', '40.1'].includes(k)))('código %s volta ao mesmo código', code => {
    const name = bookName(code, 'FORMACAO', '2026-01-10', 'Fulano de Tal')
    expect(name).toBeTruthy()
    expect(CertificateClassifier.classify(name!).code).toBe(code === '04.1' ? '40.1' : code)
  })
})
