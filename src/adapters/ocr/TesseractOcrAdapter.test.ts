import { describe, expect, it } from 'vitest'
import { TesseractOcrAdapter } from './TesseractOcrAdapter.js'

describe('TesseractOcrAdapter', () => {
  it('fails loudly on an invalid PDF instead of returning an empty read', async () => {
    if (!(await TesseractOcrAdapter.checkAvailability())) return
    await expect(
      TesseractOcrAdapter.extractTextFromScannedPdf(Buffer.from('not a pdf'))
    ).rejects.toThrow()
  })
})
