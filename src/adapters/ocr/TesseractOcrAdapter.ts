import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const DPI = '300'
const LANGS = 'por+eng'
const PAGE_TIMEOUT_MS = 120_000

export class OcrUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `OCR indisponível (${detail}). Instale: apt install tesseract-ocr tesseract-ocr-por poppler-utils`
    )
    this.name = 'OcrUnavailableError'
  }
}

export class TesseractOcrAdapter {
  private static availability: Promise<void> | null = null

  static assertAvailable(): Promise<void> {
    if (!this.availability) {
      this.availability = (async () => {
        try {
          await execFileAsync('pdftoppm', ['-v'])
        } catch {
          throw new OcrUnavailableError('pdftoppm ausente')
        }
        let langs: string
        try {
          const { stdout, stderr } = await execFileAsync('tesseract', [
            '--list-langs',
          ])
          langs = `${stdout}\n${stderr}`
        } catch {
          throw new OcrUnavailableError('tesseract ausente')
        }
        if (!/^por$/m.test(langs))
          throw new OcrUnavailableError('modelo "por" do tesseract ausente')
      })()
    }
    return this.availability
  }

  static async checkAvailability(): Promise<boolean> {
    try {
      await this.assertAvailable()
      return true
    } catch {
      return false
    }
  }

  static async extractTextFromScannedPdf(
    pdfBuffer: Buffer,
    maxPages = 4
  ): Promise<string[]> {
    await this.assertAvailable()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse_ocr_'))
    const pdfPath = path.join(tmpDir, 'document.pdf')
    try {
      fs.writeFileSync(pdfPath, pdfBuffer)
      await execFileAsync(
        'pdftoppm',
        [
          '-png',
          '-r',
          DPI,
          '-f',
          '1',
          '-l',
          String(maxPages),
          pdfPath,
          path.join(tmpDir, 'page'),
        ],
        { timeout: PAGE_TIMEOUT_MS * maxPages }
      )
      const images = fs
        .readdirSync(tmpDir)
        .filter(f => f.startsWith('page-') && f.endsWith('.png'))
        .sort()
      const pages: string[] = []
      for (const img of images)
        pages.push(await this.ocrImage(path.join(tmpDir, img)))
      return pages
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  static async extractTextFromImage(imageBuffer: Buffer): Promise<string> {
    await this.assertAvailable()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse_ocr_'))
    try {
      const imgPath = path.join(tmpDir, 'image')
      fs.writeFileSync(imgPath, imageBuffer)
      return await this.ocrImage(imgPath)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  private static async ocrImage(imgPath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'tesseract',
      [imgPath, 'stdout', '--oem', '1', '-l', LANGS],
      {
        timeout: PAGE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      }
    )
    return stdout || ''
  }
}
