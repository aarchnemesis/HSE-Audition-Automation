import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { DrivePdfMerger } from './DrivePdfMerger.js'

describe('DrivePdfMerger', () => {
  it('ordena reciclagem recente antes da formação inicial', () => {
    const files = [
      {
        buffer: Buffer.from([]),
        filename: 'NR-10 40h Formacao.pdf',
        isFormacao: true,
        date: new Date('2022-01-01'),
      },
      {
        buffer: Buffer.from([]),
        filename: 'NR-10 Reciclagem 2026.pdf',
        isReciclagem: true,
        date: new Date('2026-02-01'),
      },
    ]

    const sorted = DrivePdfMerger.sortFilesForAudit(files)
    expect(sorted[0].filename).toBe('NR-10 Reciclagem 2026.pdf')
    expect(sorted[1].filename).toBe('NR-10 40h Formacao.pdf')
  })

  it('mescla dois PDFs reais preservando o total de páginas', async () => {
    // Cria doc 1 com 2 páginas
    const doc1 = await PDFDocument.create()
    doc1.addPage([200, 200])
    doc1.addPage([200, 200])
    const bytes1 = await doc1.save()

    // Cria doc 2 com 1 página
    const doc2 = await PDFDocument.create()
    doc2.addPage([200, 200])
    const bytes2 = await doc2.save()

    const mergedBuffer = await DrivePdfMerger.mergePdfs([
      { buffer: Buffer.from(bytes1), filename: 'reciclagem.pdf', isReciclagem: true },
      { buffer: Buffer.from(bytes2), filename: 'formacao.pdf', isFormacao: true },
    ])

    const loadedMerged = await PDFDocument.load(mergedBuffer)
    expect(loadedMerged.getPageCount()).toBe(3)
  })
})
