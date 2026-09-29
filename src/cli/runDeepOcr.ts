import fs from 'fs'
import path from 'path'
import { PDFContentCache } from '../adapters/drive/PDFContentCache.js'
import { TesseractOcrAdapter } from '../adapters/ocr/TesseractOcrAdapter.js'
import { PDFContentInspector } from '../domain/services/PDFContentInspector.js'

async function run() {
  console.log(
    '================================================================================'
  )
  console.log('   HSE AUDIT AUTOMATION - PIPELINE DE OCR PROFUNDO (FASE 3)')
  console.log(
    '================================================================================'
  )

  const isAvailable = await TesseractOcrAdapter.checkAvailability()
  if (!isAvailable) {
    console.error(
      '[DeepOCR] Erro: Binarios pdftoppm ou tesseract nao estao disponiveis no sistema.'
    )
    process.exit(1)
  }

  console.log(
    '[DeepOCR] Motor OCR verificado com sucesso (pdftoppm + tesseract 5.x).'
  )

  const cache = PDFContentCache.getInstance()
  const cachePath = path.join(process.cwd(), 'data', 'pdf_content_cache.json')
  if (!fs.existsSync(cachePath)) {
    console.log(
      '[DeepOCR] Arquivo de cache data/pdf_content_cache.json nao encontrado.'
    )
    return
  }

  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<
    string,
    any
  >
  const entries = Object.values(data)
  console.log(
    `[DeepOCR] Total de arquivos indexados no cache: ${entries.length}`
  )

  const candidates = entries.filter(
    e =>
      e.statusEHS === 'INDETERMINADO' &&
      e.code !== null &&
      !/passaporte|passport/i.test(e.filename || '')
  )

  console.log(
    `[DeepOCR] Arquivos com status INDETERMINADO identificados para avaliacao: ${candidates.length}`
  )
  for (const c of candidates.slice(0, 10)) {
    console.log(
      ` - ID: ${c.fileId} | Arquivo: ${c.filename} | Codigo: ${c.code}`
    )
  }

  console.log(
    '\n[DeepOCR] Pipeline de OCR pronto e integrado ao GoogleDriveOAuthAdapter.'
  )
  console.log(
    '[DeepOCR] Na proxima sincronizacao ou download desses arquivos, o OCR sera executado'
  )
  console.log(
    '[DeepOCR] automaticamente e persistido em data/pdf_content_cache.json.'
  )
  console.log(
    '================================================================================'
  )
}

run().catch(err => {
  console.error('[DeepOCR] Erro fatal:', err)
  process.exit(1)
})
