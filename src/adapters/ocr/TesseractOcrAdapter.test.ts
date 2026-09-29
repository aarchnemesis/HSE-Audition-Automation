import { describe, expect, it } from 'vitest'
import { TesseractOcrAdapter } from './TesseractOcrAdapter.js'

describe('TesseractOcrAdapter', () => {
  it('detecta a disponibilidade dos binarios pdftoppm e tesseract no sistema', async () => {
    const available = await TesseractOcrAdapter.checkAvailability()
    expect(available).toBe(true)
  })

  it('retorna array vazio graciosamente se o buffer for invalido', async () => {
    const invalidBuffer = Buffer.from('not a pdf')
    const result =
      await TesseractOcrAdapter.extractTextFromScannedPdf(invalidBuffer)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })
})
