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
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
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
  // Escada de leitura: --vision (degrau 2), --tier=3 (imagem em alta, modelos fortes de famílias diferentes),
  // --arbiter (degrau 4: Árbitro C decide o que ainda diverge). Degrau 3 e árbitro só pegam o que não tem acordo.
  const tierArg = Number(process.argv.find(a => a.startsWith('--tier='))?.split('=')[1]) || 0
  const arbiter = process.argv.includes('--arbiter')
  const tier = arbiter ? 4 : tierArg || (process.argv.includes('--vision') ? 2 : 1)
  const vision = tier >= 2
  const DPI = tier >= 3 ? '200' : '110'
  const MAX_PAGES = tier >= 3 ? '6' : '3'
  // Cota do Codex é curta: modelos pesados (Sol, Astra) esgotam em minutos. Padrão é o modelo do Prometheus;
  // modelo pesado só por variável de ambiente, de propósito.
  const STRONG_A = { provider: process.env.HSE_LLM_STRONG_A_PROVIDER || 'openai-codex', model: process.env.HSE_LLM_STRONG_A_MODEL || 'gpt-5.6-luna' }
  const STRONG_B = { provider: process.env.HSE_LLM_STRONG_B_PROVIDER || 'openai-codex', model: process.env.HSE_LLM_STRONG_B_MODEL || 'gpt-5.6-luna' }
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
  // --ids=arquivo.json: lê exatamente esses fileIds (ex.: pendentes do plano do Book), sem filtro de dúvida.
  const idsPath = process.argv.find(a => a.startsWith('--ids='))?.split('=')[1]
  if (idsPath) {
    const byId = new Map(files.map(f => [f.fileId, f]))
    const planRows = new Map<string, any>()
    try { for (const r of JSON.parse(fs.readFileSync('scratch/book_rename_plan.json', 'utf8')).rows) planRows.set(r.fileId, r) } catch {}
    for (const id of JSON.parse(fs.readFileSync(idsPath, 'utf8')) as string[]) {
      const f = byId.get(id) ?? { fileId: id, filename: planRows.get(id)?.currentName ?? id }
      const person = owner.get(id)
      if (!person) continue
      const k = `${f.md5 || f.fileId}|v${LLM_PROMPT_VERSION}`
      if (tier === 1 && llm[k]?.at && !llm[k]?.error) continue
      if (tier === 2 && llm[k]?.vision) continue
      if (tier >= 3 && (llm[k]?.agreed || (llm[k]?.tier ?? 1) >= tier)) continue
      queue.push({ f, person, strong: true })
    }
  }
  for (const f of idsPath ? [] : files) {
    const person = owner.get(f.fileId)
    if (!person) continue
    const prev = llm[`${f.md5 || f.fileId}|v${LLM_PROMPT_VERSION}`]
    // Degrau 1: só o que nunca foi lido. Degraus 2+: o que já foi lido no degrau anterior e não teve acordo
    // (ou acordou sem data, caso típico de data manuscrita), sem repetir o degrau.
    if (tier === 1 && prev?.at && !prev?.error) continue
    if (tier >= 2) {
      const d0 = prev?.consensus?.[0]
      const semData = !!d0 && [d0.data_conclusao, d0.data_assinatura].every((x: string) => !x || x === 'ausente' || x === 'ilegivel')
      if (!prev?.at || (prev.tier ?? 1) >= tier || (prev.tier ?? 1) < tier - 1 || (prev.agreed && !(tier === 2 && semData))) continue
      queue.push({ f, person, strong: true })
      continue
    }
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
    const prepared: { key: string; pages: string[]; images?: string[]; agreesWithRules: (a: any[]) => boolean }[] = []
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
          // --vision: páginas como imagem (até 3, 110 dpi, JPEG) para o Prometheus ler o que o OCR não lê.
          let images: string[] | undefined
          if (vision) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-vis-'))
            try {
              const src = path.join(dir, buf.subarray(0, 1024).includes('%PDF-') ? 'f.pdf' : 'f.img')
              fs.writeFileSync(src, buf)
              if (src.endsWith('.pdf')) execFileSync('pdftoppm', ['-r', DPI, '-f', '1', '-l', MAX_PAGES, '-jpeg', '-jpegopt', 'quality=80', src, path.join(dir, 'p')])
              else execFileSync('convert', [src + '[0]', '-resize', tier >= 3 ? '2400x2400>' : '1600x1600>', '-quality', '80', path.join(dir, 'p-1.jpg')])
              images = fs.readdirSync(dir).filter(n => n.endsWith('.jpg')).sort().map(n => fs.readFileSync(path.join(dir, n)).toString('base64'))
            } catch { images = undefined } finally { fs.rmSync(dir, { recursive: true, force: true }) }
            if (!images?.length) continue
          }
          if (!pages.join('').trim() && !images?.length) continue
          const rules = (f.documents?.length ? f.documents : [f]).filter((d: any) => d.statusEHS !== 'NAO_LIDO' && d.code)
          prepared.push({
            key: f.md5 || f.fileId,
            pages,
            images,
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
    if (arbiter) await PrometheusReader.arbitrate(prepared.filter(p => p.images?.length) as any, STRONG_A, threads)
    else await PrometheusReader.readMany(prepared, threads, undefined, vision, tier >= 3 ? { tier, modelA: STRONG_A, modelB: STRONG_B } : { tier })
    const c: Record<string, any> = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8'))
    const mine = prepared.map(p => c[`${p.key}|v${LLM_PROMPT_VERSION}`]).filter(Boolean)
    const min = (Date.now() - started) / 60000
    const doneN = Math.min(from + CHUNK, todo.length)
    console.log(`[llm-queue] ${doneN}/${todo.length} em ${min.toFixed(1)} min | lote: ${mine.filter(r => r.agreed).length} concordam (${mine.filter(r => r.confirmedBy === 'REGRAS').length} pelas regras, ${mine.filter(r => r.confirmedBy === 'B').length} pelo Leitor B, ${mine.filter(r => r.confirmedBy === 'C').length} pelo Árbitro C) [degrau ${tier}], ${mine.filter(r => !r.agreed && !r.error).length} divergem, ${mine.filter(r => r.error).length} erros | faltam ~${Math.round(((todo.length - doneN) * min) / doneN)} min`)
  }
  PrometheusReader.save()
}

main().catch(e => { console.error(e); process.exit(1) })
