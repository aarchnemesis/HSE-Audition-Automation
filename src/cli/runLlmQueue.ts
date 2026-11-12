/**
 * Fila de leitura pelo Prometheus dos arquivos duvidosos do Drive, separada do ciclo do painel.
 * Lê o texto (PDF + OCR) de cada arquivo, chama o Leitor A (e o B quando o A diverge das regras) e
 * grava cada resposta em data/llm_reading_cache.json na hora. A leitura normal do Drive
 * (runDriveInspectorsCache com HSE_LLM_READER=1) depois só consulta esse cache.
 *
 * Uso: npx tsx src/cli/runLlmQueue.ts [--all] [--limit=N]
 *   padrão: só duvidosos fortes (não lido, titular não confirmado, código ou data do nome diverge)
 *   --all : também F+R/reciclagem e PDFs com mais de um documento
 * Fora da VPS: HSE_PROMETHEUS_SSH=root@host. Paralelismo: HSE_PROMETHEUS_PARALLEL (padrão 8).
 */
import 'dotenv/config'
import fs from 'fs'
import { google } from 'googleapis'
import pdfParse from 'pdf-parse'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { parseDateFromFilename } from '../adapters/drive/certificateFilenameParser.js'
import { PrometheusReader, LLM_PROMPT_VERSION } from '../adapters/llm/PrometheusReader.js'
import { TesseractOcrAdapter } from '../adapters/ocr/TesseractOcrAdapter.js'
import { CertificateClassifier } from '../domain/services/CertificateClassifier.js'
import { codeForLlmDocument } from '../domain/services/LlmReadingMapper.js'
import { createPdfPageCollector } from '../domain/services/PDFContentInspector.js'
import { namesMatch } from '../domain/services/PersonNameMatcher.js'

const sameDay = (a?: string | Date, b?: string | Date | null) =>
  !!a && !!b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 2 * 86_400_000

async function main() {
  const all = process.argv.includes('--all')
  const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || Infinity
  const raw = JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8'))
  const files: any[] = Array.isArray(raw) ? raw : Object.values(raw)
  const people = JSON.parse(fs.readFileSync('data/drive_inspectors_cache.json', 'utf8'))
  // Dono de cada arquivo: a pasta onde o certificado vigente está, ou o plano do Book (todas as versões).
  const owner = new Map<string, string>()
  try {
    for (const r of JSON.parse(fs.readFileSync('scratch/book_rename_plan.json', 'utf8')).rows) owner.set(r.fileId, r.person)
  } catch {}
  for (const p of people)
    for (const c of Object.values<any>(p.certificates ?? {})) {
      const id = c.sourcePath?.match(/\/d\/([^/]+)/)?.[1]
      if (id) owner.set(id, p.name)
    }
  let llm: Record<string, any> = {}
  try { llm = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8')) } catch {}

  const queue: { f: any; person: string; strong: boolean }[] = []
  for (const f of files) {
    const person = owner.get(f.fileId)
    if (!person) continue
    if (llm[`${f.md5 || f.fileId}|v${LLM_PROMPT_VERSION}`]?.at && !llm[`${f.md5 || f.fileId}|v${LLM_PROMPT_VERSION}`]?.error) continue
    const docs = f.documents?.length ? f.documents : [f]
    const fnCode = CertificateClassifier.classify(f.filename).code
    const fnDate = parseDateFromFilename(f.filename)
    const strong =
      docs.every((d: any) => d.statusEHS === 'NAO_LIDO') ||
      (f.holder && f.holder.status !== 'OK') ||
      (!!fnCode && !docs.some((d: any) => d.code === fnCode)) ||
      (!!fnDate && !docs.some((d: any) => sameDay(d.issueDate, fnDate) || sameDay(d.expirationDate, fnDate)))
    const weak = docs.length > 1 || /F\s*[+&-]\s*R|RECICL|PERI[OÓ]DIC/i.test(f.filename)
    if (strong || (all && weak)) queue.push({ f, person, strong })
  }
  queue.sort((a, b) => Number(b.strong) - Number(a.strong))
  const todo = queue.slice(0, limit)
  console.log(`[llm-queue] ${todo.length} arquivos na fila (${todo.filter(q => q.strong).length} fortes)`)

  const drive = google.drive({ version: 'v3', auth: (await getAuthorizedClient()) as any })
  const started = Date.now()
  const CHUNK = Number(process.env.HSE_LLM_CHUNK) || 100
  const threads = Number(process.env.HSE_PROMETHEUS_PARALLEL) || 12
  for (let from = 0; from < todo.length; from += CHUNK) {
    const chunk = todo.slice(from, from + CHUNK)
    // 1) texto + OCR aqui (CPU local), em paralelo
    const prepared: { key: string; pages: string[]; agreesWithRules: (a: any[]) => boolean }[] = []
    let next = 0
    await Promise.all(Array.from({ length: Number(process.env.HSE_LLM_FILES_PARALLEL) || 12 }, async () => {
      while (next < chunk.length) {
        const { f, person } = chunk[next++]
        try {
          const buf = Buffer.from((await drive.files.get({ fileId: f.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })).data as ArrayBuffer)
          let pages: string[]
          if (buf.subarray(0, 1024).includes('%PDF-')) {
            const col = createPdfPageCollector()
            await pdfParse(buf, { pagerender: col.pagerender })
            pages = col.pages
            if (pages.some(p => p.replace(/\s+/g, '').length < 120)) {
              const ocr = await TesseractOcrAdapter.extractTextFromScannedPdf(buf, Math.min(Math.max(pages.length, 4), 12))
              pages = ocr.map((o, i) => `${(pages[i] ?? '').trim()}\n${o}`)
            }
          } else pages = [await TesseractOcrAdapter.extractTextFromImage(buf)]
          if (!pages.join('').trim()) continue
          const rules = (f.documents?.length ? f.documents : [f]).filter((d: any) => d.statusEHS !== 'NAO_LIDO' && d.code)
          prepared.push({
            key: f.md5 || f.fileId,
            pages,
            agreesWithRules: (a: any[]) =>
              rules.length > 0 &&
              a.every(d => d.titular_nome === 'ausente' || namesMatch(d.titular_nome, person)) &&
              rules.every((x: any) => a.some(d => codeForLlmDocument(d) === x.code && sameDay(x.issueDate, d.data_conclusao !== 'ausente' ? d.data_conclusao : null))),
          })
        } catch {
          // arquivo que não baixou ou não abriu: fica para a próxima rodada
        }
      }
    }))
    // 2) Prometheus em lote (A em todos, B onde A diverge das regras)
    await PrometheusReader.readMany(prepared, threads)
    const c: Record<string, any> = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8'))
    const mine = prepared.map(p => c[`${p.key}|v${LLM_PROMPT_VERSION}`]).filter(Boolean)
    const min = (Date.now() - started) / 60000
    const doneN = Math.min(from + CHUNK, todo.length)
    console.log(`[llm-queue] ${doneN}/${todo.length} em ${min.toFixed(1)} min | lote: ${mine.filter(r => r.agreed).length} concordam (${mine.filter(r => r.confirmedBy === 'REGRAS').length} pelas regras, ${mine.filter(r => r.confirmedBy === 'B').length} pelo Leitor B), ${mine.filter(r => !r.agreed && !r.error).length} divergem, ${mine.filter(r => r.error).length} erros | faltam ~${Math.round(((todo.length - doneN) * min) / doneN)} min`)
  }
  PrometheusReader.save()
}

main().catch(e => { console.error(e); process.exit(1) })
