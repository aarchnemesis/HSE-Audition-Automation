import { PDFDocument } from 'pdf-lib'

export interface MergeFileInput {
  buffer: Buffer | Uint8Array
  filename?: string
  isReciclagem?: boolean
  isFormacao?: boolean
  date?: Date | null
}

export class DrivePdfMerger {
  /**
   * Ordena os arquivos para mesclagem de auditoria:
   * 1. Reciclagem vigente mais recente primeiro (folhas de comprovação atual).
   * 2. Formação básica / inicial em seguida (requisito de capacitação de base).
   * 3. Demais certificados intermediários por ordem decrescente de data.
   */
  static sortFilesForAudit(files: MergeFileInput[]): MergeFileInput[] {
    return [...files].sort((a, b) => {
      // Prioridade 1: Reciclagem vigente antes de formação inicial
      if (a.isReciclagem && b.isFormacao) return -1
      if (b.isReciclagem && a.isFormacao) return 1

      // Prioridade 2: Data mais recente primeiro
      const timeA = a.date ? a.date.getTime() : 0
      const timeB = b.date ? b.date.getTime() : 0
      return timeB - timeA
    })
  }

  /**
   * Mescla múltiplos PDFs em um único documento padronizado.
   */
  static async mergePdfs(files: MergeFileInput[]): Promise<Buffer> {
    if (files.length === 0) {
      throw new Error('Nenhum arquivo fornecido para mesclagem.')
    }
    if (files.length === 1) {
      return Buffer.from(files[0].buffer)
    }

    const sorted = this.sortFilesForAudit(files)
    const mergedDoc = await PDFDocument.create()

    for (const item of sorted) {
      try {
        const doc = await PDFDocument.load(item.buffer, { ignoreEncryption: true })
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices())
        for (const page of pages) {
          mergedDoc.addPage(page)
        }
      } catch (err: any) {
        console.warn(
          `[DrivePdfMerger] Aviso ao processar páginas de ${item.filename || 'PDF'}:`,
          err?.message || err
        )
      }
    }

    const mergedBytes = await mergedDoc.save()
    return Buffer.from(mergedBytes)
  }
}
