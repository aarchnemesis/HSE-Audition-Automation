import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export class TesseractOcrAdapter {
  private static isAvailable: boolean | null = null

  /**
   * Verifica se os binarios do sistema pdftoppm e tesseract estao disponiveis no PATH.
   */
  static async checkAvailability(): Promise<boolean> {
    if (this.isAvailable !== null) return this.isAvailable
    try {
      await execFileAsync('pdftoppm', ['-v'])
      await execFileAsync('tesseract', ['--version'])
      this.isAvailable = true
    } catch {
      this.isAvailable = false
    }
    return this.isAvailable
  }

  /**
   * Executa OCR nas primeiras paginas (padrao ate 2 paginas) de um buffer de PDF.
   * Retorna um array de strings com o texto extraido de cada pagina.
   */
  static async extractTextFromScannedPdf(
    pdfBuffer: Buffer,
    maxPages: number = 2
  ): Promise<string[]> {
    const available = await this.checkAvailability()
    if (!available) {
      return []
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse_ocr_'))
    const pdfPath = path.join(tmpDir, 'document.pdf')
    const imgPrefix = path.join(tmpDir, 'page')

    try {
      fs.writeFileSync(pdfPath, pdfBuffer)

      // 1. Converter primeiras paginas do PDF para imagens PNG a 150 DPI
      await execFileAsync('pdftoppm', [
        '-png',
        '-r',
        '150',
        '-f',
        '1',
        '-l',
        String(maxPages),
        pdfPath,
        imgPrefix,
      ])

      // 2. Localizar imagens geradas ordenadas por pagina
      const files = fs
        .readdirSync(tmpDir)
        .filter(f => f.startsWith('page-') && f.endsWith('.png'))
        .sort()

      const pageTexts: string[] = []

      // 3. Executar tesseract para cada imagem
      for (const imgFile of files) {
        const imgPath = path.join(tmpDir, imgFile)
        try {
          const { stdout } = await execFileAsync('tesseract', [
            imgPath,
            'stdout',
            '--oem',
            '1',
            '-l',
            'eng',
          ])
          pageTexts.push(stdout || '')
        } catch (err: any) {
          console.warn(
            `[TesseractOcrAdapter] Falha de OCR na pagina ${imgFile}:`,
            err?.message || err
          )
          pageTexts.push('')
        }
      }

      return pageTexts
    } catch (err: any) {
      console.warn(
        `[TesseractOcrAdapter] Falha geral ao processar PDF para OCR:`,
        err?.message || err
      )
      return []
    } finally {
      // Limpeza segura dos arquivos temporarios
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
    }
  }
}
