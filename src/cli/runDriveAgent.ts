/**
 * Agente do Drive: faz com o que caiu nas pastas o que uma pessoa faria. Vê o diff, lê o documento,
 * renomeia no padrão do Book, move para a subpasta certa e manda a versão antiga para 00_OBSOLETOS.
 * O que tiver dúvida (pendência no plano) fica como está e aparece na revisão.
 *
 * Passos (orquestrados por scripts/hse-drive-agent.sh, dentro do hse-cycle):
 *   diff    grava scratch/agent_ids.json com os arquivos fora do padrão do Book alterados desde o piso
 *           (HSE_AGENT_SINCE, padrão 2026-11-17). Sai com código 3 se não houver nada.
 *   decide  lê scratch/book_rename_plan.json e grava scratch/agent_decisions.json só com o que é seguro:
 *           RENOMEAR sem pendência de arquivo do diff, e OBSOLETO cuja versão vigente é arquivo do diff
 *           e cuja única pendência é a NC-20 (versão mais antiga).
 */
import fs from 'fs'
import { parseDateFromFilename } from '../adapters/drive/certificateFilenameParser.js'
import { LLM_PROMPT_VERSION } from '../adapters/llm/PrometheusReader.js'

const IDS = 'scratch/agent_ids.json'
const CONFERIR = 'scratch/agent_conferir.json'
const DECISIONS = 'scratch/agent_decisions.json'
// Nome já no padrão: com código (CC_DOC_EMI-…_VAL-…) ou sem código (DESCRICAO_EMI-…_VAL-…).
const BOOK_NAME = /_EMI-(\d{4}-\d{2}-\d{2}|NA)_VAL-(\d{4}-\d{2}-\d{2}|NA)_[A-Z-]+\.[a-z0-9]+$/i

function diff() {
  const since = process.env.HSE_AGENT_SINCE || '2026-11-17T00:00'
  const raw = JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8'))
  const files: any[] = Array.isArray(raw) ? raw : Object.values(raw)
  const ids = files
    .filter(f => (f.modifiedTime ?? '') >= since && !BOOK_NAME.test(String(f.filename ?? '')))
    .map(f => f.fileId)
  fs.writeFileSync(IDS, JSON.stringify(ids))
  console.log(`[agente] diff: ${ids.length} arquivo(s) fora do padrão desde ${since}`)
  if (!ids.length) process.exit(3)
}

function decide() {
  const ids = new Set<string>(JSON.parse(fs.readFileSync(IDS, 'utf8')))
  const { rows } = JSON.parse(fs.readFileSync('scratch/book_rename_plan.json', 'utf8'))
  const approved: string[] = []
  let revisar = 0
  for (const r of rows) {
    if (r.action === 'RENOMEAR' && ids.has(r.fileId) && !r.issues?.length) approved.push(r.fileId)
    else if (r.action === 'OBSOLETO' && ids.has(r.supersededBy) && r.issues?.length === 1 && /^NC-20/.test(r.issues[0])) approved.push(r.fileId)
    else if (ids.has(r.fileId) && r.action !== 'OK') revisar++
  }
  fs.writeFileSync(DECISIONS, JSON.stringify([{ approved, by: 'agente', at: new Date().toISOString() }]))
  console.log(`[agente] decide: ${approved.length} para aplicar, ${revisar} com pendência ficam para revisão`)
}

/**
 * conferir: arquivos cuja data no nome é um ano ou mais MAIS NOVA que a data lida no conteúdo. Sinal forte
 * de leitura errada (ex.: "26" manuscrito lido como "24"), mesmo com os dois leitores de acordo. Grava
 * scratch/agent_conferir.json para o degrau 3 forçado e o árbitro. Cada arquivo só passa uma vez (a leitura
 * fica com degrau 3 ou 4 e sai da lista). Teto por rodada: HSE_AGENT_CONFERIR_MAX (padrão 10), pela cota.
 */
function conferir() {
  const max = Number(process.env.HSE_AGENT_CONFERIR_MAX) || 10
  const raw = JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8'))
  const files: any[] = Array.isArray(raw) ? raw : Object.values(raw)
  let llm: Record<string, any> = {}
  try { llm = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8')) } catch {}
  const YEAR = 365 * 86_400_000
  const hits: { id: string; gap: number }[] = []
  for (const f of files) {
    const fn = parseDateFromFilename(String(f.filename ?? ''))
    if (!fn) continue
    const docs = (f.documents?.length ? f.documents : [f]).filter((d: any) => d.issueDate)
    if (!docs.length) continue
    const newest = Math.max(...docs.map((d: any) => new Date(d.issueDate).getTime()))
    const gap = fn.getTime() - newest
    if (gap < YEAR) continue
    const prev = llm[`${f.md5 || f.fileId}|v${LLM_PROMPT_VERSION}`]
    if ((prev?.tier ?? 1) >= 3) continue
    hits.push({ id: f.fileId, gap })
  }
  hits.sort((a, b) => b.gap - a.gap)
  const ids = hits.slice(0, max).map(h => h.id)
  fs.writeFileSync(CONFERIR, JSON.stringify(ids))
  console.log(`[agente] conferir: ${hits.length} arquivo(s) com data no nome 1 ano ou mais nova que a lida; ${ids.length} nesta rodada`)
  if (!ids.length) process.exit(3)
}

const step = process.argv[2]
if (step === 'diff') diff()
else if (step === 'decide') decide()
else if (step === 'conferir') conferir()
else { console.error('Uso: runDriveAgent.ts diff|decide|conferir'); process.exit(1) }
