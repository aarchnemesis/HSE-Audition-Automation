/**
 * Leitor de documentos do Book com o Antigravity (agy) deste computador como motor, na cota da conta
 * do João, sem gastar a cota do Codex do Prometheus. O agy abre o PDF direto (lê digitalizado e
 * manuscrito). Leitor A e Leitor B em modelos de famílias diferentes; acordo entre os dois vale.
 *
 * Grava num arquivo de remendo (scratch/llm_reading_patch.json) no formato do llm_reading_cache;
 * scripts/mergeLlmPatch.cjs mescla esse remendo no cache da VPS, sob a trava do leitor.
 *
 * Uso: npx tsx src/cli/runAntigravityReader.ts --ids=arquivo.json [--limit=N] [--parallel=2]
 *        [--model-a=gemini-4-hydrogen-medium] [--model-b=claude-sonnet-5-5-medium] [--sem-saude]
 *   --sem-saude: pula ASO (01) e exames (nome com EXAME/ASO/ATESTADO), dado de saúde.
 */
import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync, spawn } from 'child_process'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { consensusOf, LLM_PROMPT_VERSION, LlmDocument, parse, prompt } from '../adapters/llm/PrometheusReader.js'

const AGY = process.env.HSE_AGY_PATH || path.join(os.homedir(), '.gemini', 'bin', 'agy.exe')
const PATCH = 'scratch/llm_reading_patch.json'
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]

/** Uma pergunta ao agy, na pasta do arquivo, sem ferramentas de terminal. Devolve texto e tokens. */
function agy(cwd: string, text: string, model: string): Promise<{ out: string; tokens: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(AGY, ['-p', text, '--model', model, '--output-format', 'json', '--disable-slash-commands', '--print-timeout', '300s'], { cwd })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', reject)
    p.on('close', () => {
      try {
        const j = JSON.parse(out.slice(out.indexOf('{')))
        if (j.status !== 'SUCCESS') return reject(new Error(`agy ${j.status}: ${String(j.response ?? err).slice(0, 200)}`))
        resolve({ out: String(j.response ?? ''), tokens: Number(j.usage?.total_tokens ?? 0) })
      } catch {
        reject(new Error(`agy sem JSON: ${(err || out).slice(0, 200)}`))
      }
    })
  })
}

async function main() {
  const idsPath = arg('ids')
  if (!idsPath) throw new Error('Uso: --ids=arquivo.json')
  const limit = Number(arg('limit')) || Infinity
  const parallel = Number(arg('parallel')) || 2
  const modelA = arg('model-a') || 'gemini-4-hydrogen-medium'
  const modelB = arg('model-b') || 'claude-sonnet-5-5-medium'
  const semSaude = process.argv.includes('--sem-saude')

  const cache = new Map<string, any>(JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8')).map((c: any) => [c.fileId, c]))
  let llm: Record<string, any> = {}
  try { llm = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8')) } catch {}
  let patch: Record<string, any> = {}
  try { patch = JSON.parse(fs.readFileSync(PATCH, 'utf8')) } catch {}

  const todo: { id: string; key: string; name: string }[] = []
  for (const id of JSON.parse(fs.readFileSync(idsPath, 'utf8')) as string[]) {
    const c = cache.get(id)
    const key = `${c?.md5 || id}|v${LLM_PROMPT_VERSION}`
    const name = String(c?.filename ?? '')
    if (semSaude && ((c?.code === '01') || /EXAME|\bASO\b|ATESTADO|AUDIOMETR|LAUDO/i.test(name))) continue
    if (llm[key]?.agreed || patch[key]?.agreed || patch[key]?.engine === 'antigravity') continue
    todo.push({ id, key, name })
  }
  const run = todo.slice(0, limit)
  console.log(`[agy] ${run.length} arquivos (A ${modelA}, B ${modelB}, ${parallel} em paralelo)`)

  const drive = google.drive({ version: 'v3', auth: (await getAuthorizedClient()) as any })
  const started = Date.now()
  let next = 0, done = 0, agreed = 0, tokens = 0, errors = 0
  const save = () => fs.writeFileSync(PATCH, JSON.stringify(patch))
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < run.length) {
      const f = run[next++]
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-agy-'))
      try {
        const buf = Buffer.from((await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })).data as ArrayBuffer)
        // Formato pelo conteúdo, não pelo nome: no Drive há imagem salva com extensão errada.
        const head = buf.subarray(0, 16)
        const ext = buf.subarray(0, 1024).includes('%PDF-') ? 'pdf'
          : head[0] === 0xff && head[1] === 0xd8 ? 'jpg'
          : head.subarray(0, 4).toString('latin1') === '\x89PNG' ? 'png'
          : head.subarray(0, 3).toString('latin1') === 'GIF' ? 'gif'
          : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp'
          : null
        if (!ext) throw new Error(`formato não suportado pelo leitor (${head.subarray(4, 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}): conferir à mão`)
        fs.writeFileSync(path.join(dir, `documento.${ext}`), buf)
        // Páginas em JPG (até 6, 150 dpi): o Claude no Antigravity recusa PDF ("binary file type
        // application/pdf is not supported"); imagem os dois modelos leem.
        let files = [`documento.${ext}`]
        if (ext === 'pdf') {
          try {
            execFileSync('pdftoppm', ['-r', '150', '-f', '1', '-l', '6', '-jpeg', '-jpegopt', 'quality=85', path.join(dir, 'documento.pdf'), path.join(dir, 'pagina')])
            const pages = fs.readdirSync(dir).filter(n => n.startsWith('pagina') && n.endsWith('.jpg')).sort()
            if (pages.length) { files = pages; fs.rmSync(path.join(dir, 'documento.pdf')) }
          } catch { /* sem pdftoppm: segue com o PDF */ }
        }
        const lista = files.join(', ')
        // A ordem de abrir os arquivos vem ANTES do prompt do leitor: no fim, depois de "Conteúdo do arquivo",
        // o agente entendia que o conteúdo já tinha vindo e respondia lista vazia sem abrir nada.
        const ask = (r: 'A' | 'B') =>
          `PRIMEIRO PASSO OBRIGATÓRIO: abra com a sua ferramenta de leitura de arquivos TODOS estes arquivos desta pasta, que são as páginas de um mesmo documento, em ordem: ${lista}. Pode ser digitalizado; datas manuscritas, carimbos e assinaturas valem. Não use terminal nem edite nada. Só responda depois de ver todas as páginas.\n\n` +
          prompt(r, `(o conteúdo está nas páginas ${lista}; use o que você viu nelas)`)
        const ra = await agy(dir, ask('A'), modelA)
        const rb = await agy(dir, ask('B'), modelB)
        tokens += ra.tokens + rb.tokens
        const parseOr = (out: string, who: string) => { try { return parse(out) } catch (e: any) { throw new Error(`${who}: ${e.message} | resposta: ${out.replace(/s+/g, ' ').slice(0, 160)}`) } }
        const a: LlmDocument[] = parseOr(ra.out, 'Leitor A')
        const b: LlmDocument[] = parseOr(rb.out, 'Leitor B')
        const c = consensusOf(a, b)
        if (c.agreed) agreed++
        patch[f.key] = { a, b, consensus: c.consensus, agreed: c.agreed, confirmedBy: c.agreed ? 'B' : undefined, disagreement: c.why, vision: true, tier: 3, engine: 'antigravity', models: [modelA, modelB], at: new Date().toISOString() }
      } catch (e: any) {
        errors++
        patch[f.key] = { ...(patch[f.key] ?? {}), agreed: false, engine: 'antigravity', error: String(e?.message || e).slice(0, 300), at: new Date().toISOString() }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
      done++
      save()
      if (done % 5 === 0 || done === run.length)
        console.log(`[agy] ${done}/${run.length} em ${((Date.now() - started) / 60000).toFixed(1)} min | ${agreed} concordam, ${done - agreed - errors} divergem, ${errors} erros | ~${Math.round(tokens / Math.max(done, 1))} tokens/arquivo`)
    }
  }))
}

main().catch(e => { console.error(e); process.exit(1) })
