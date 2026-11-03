import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import pdfParse from 'pdf-parse'
import {
  CONTRACT_EXTRACTOR_VERSION,
  PDFContentCache,
  SIGNATURE_DATE_EXTRACTOR_VERSION,
} from '../adapters/drive/PDFContentCache.js'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { TesseractOcrAdapter } from '../adapters/ocr/TesseractOcrAdapter.js'
import {
  PDFContentInspector,
  createPdfPageCollector,
} from '../domain/services/PDFContentInspector.js'

// Downloads a GIVEN LIST of Drive files (by id) and populates the PDF content cache the same way
// GoogleDriveOAuthAdapter does during a scan: extract the page text (pdf-parse), OCR-fallback for
// pure scans, run PDFContentInspector, and cache the issue/expiration dates and code. Read-only on
// Drive (download only); it only writes the local cache. Used to give the second-source files the
// name+content classification the filename alone could not provide.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface InputFile {
  fileId: string
  fileName: string
}

function loadInputs(): InputFile[] {
  const inputArg = process.argv
    .find(a => a.startsWith('--input='))
    ?.split('=')[1]
  const planPath =
    inputArg ||
    path.join(process.cwd(), 'scratch', 'drive_reconciliacao_plan.json')
  const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'))

  // Default source is the reconciliation plan: take the UNCLASSIFIED second-source files.
  const seen = new Set<string>()
  const out: InputFile[] = []
  for (const a of raw) {
    const fileId = a.fileId || a.src2FileId
    const fileName = a.fileName || a.src2FileName
    if (!fileId || !fileName) continue
    if (inputArg ? false : a.kind !== 'UNCLASSIFIED') continue
    if (seen.has(fileId)) continue
    seen.add(fileId)
    out.push({ fileId, fileName })
  }
  return out
}

async function main() {
  const files = loadInputs()
  const limitArg = process.argv
    .find(a => a.startsWith('--limit='))
    ?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 120

  console.log(
    `[cache] ${files.length} arquivo(s) para extrair conteúdo (limit ${limit}).`
  )

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })
  const cache = PDFContentCache.getInstance()

  let done = 0
  let withCode = 0
  let withDate = 0
  let ocrUsed = 0
  let errors = 0

  for (const f of files) {
    if (done >= limit) break
    done++
    try {
      const meta = await drive.files.get({
        fileId: f.fileId,
        fields: 'modifiedTime',
        supportsAllDrives: true,
      })
      const res = await drive.files.get(
        { fileId: f.fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      )
      const buffer = Buffer.from(res.data as ArrayBuffer)

      let pdfPages: string[] = []
      let pdfText = ''
      let usedOcr = false
      try {
        const { pages, pagerender } = createPdfPageCollector()
        const parsed = await pdfParse(buffer, { pagerender })
        pdfPages = pages
        pdfText = parsed.text || ''
        if (pdfText.replace(/\s+/g, '').length < 30) {
          const ocrPages = await TesseractOcrAdapter.extractTextFromScannedPdf(
            buffer,
            2
          )
          if (ocrPages.join('').replace(/\s+/g, '').length >= 30) {
            pdfPages = ocrPages
            pdfText = ocrPages.join('\n\n')
            usedOcr = true
          }
        }
      } catch (e) {
        console.warn(`   aviso parse ${f.fileName}: ${(e as Error).message}`)
      }

      const inspected = PDFContentInspector.inspectPages(
        f.fileName,
        pdfPages,
        new Date()
      )
      const primary =
        [...inspected].sort((a, b) => {
          const ta = a.expirationDate ? a.expirationDate.getTime() : 0
          const tb = b.expirationDate ? b.expirationDate.getTime() : 0
          return tb - ta
        })[0] || inspected[0]

      cache.set({
        fileId: f.fileId,
        filename: f.fileName,
        v: 2,
        cv: CONTRACT_EXTRACTOR_VERSION,
        sv: SIGNATURE_DATE_EXTRACTOR_VERSION,
        modifiedTime: meta.data.modifiedTime || undefined,
        code: primary?.code || null,
        issueDate: primary?.issueDate?.toISOString(),
        expirationDate: primary?.expirationDate?.toISOString(),
        statusEHS: primary?.statusEHS || 'INDETERMINADO',
        statusDetail: primary?.statusDetail || '',
        source: usedOcr ? 'IMAGE_FALLBACK' : primary?.source || 'PDF_CONTENT',
        classificationSource: primary?.classificationSource,
        matchedTerm: primary?.matchedTerm,
        extractedClause: primary?.extractedClause,
        documents: inspected.map(d => ({
          code: d.code,
          issueDate: d.issueDate?.toISOString(),
          expirationDate: d.expirationDate?.toISOString(),
          statusEHS: d.statusEHS,
          statusDetail: d.statusDetail,
          source: usedOcr ? 'IMAGE_FALLBACK' : d.source,
          classificationSource: d.classificationSource,
          matchedTerm: d.matchedTerm,
          extractedClause: d.extractedClause,
        })),
      })

      if (primary?.code) withCode++
      if (primary?.issueDate || primary?.expirationDate) withDate++
      if (usedOcr) ocrUsed++

      if (done % 25 === 0) {
        cache.save()
        console.log(
          `   [${done}/${files.length}] com código ${withCode} | com data ${withDate} | OCR ${ocrUsed} | erros ${errors}`
        )
      }
      await sleep(delayMs)
    } catch (e) {
      errors++
      console.error(
        `   ERRO ${f.fileName} (${f.fileId}): ${(e as Error).message}`
      )
    }
  }

  cache.save()
  console.log(
    `\n[cache] Concluído. Processados ${done} | com código ${withCode} | com data ${withDate} | OCR ${ocrUsed} | erros ${errors}`
  )
}

main().catch(err => {
  console.error('[cache] Erro fatal:', err)
  process.exit(1)
})
