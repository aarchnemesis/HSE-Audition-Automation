/**
 * Publica a leitura do Drive no MongoDB da VPS (arthwind_db), para consulta estruturada e para o
 * agente Prometheus, em vez de só o JSON dentro do git.
 *
 *   hse_drive_collaborators  um por pasta de colaborador (nome, função, pasta, contagem por status)
 *   hse_drive_status         um por colaborador + código: o documento que vale hoje, com status do Book
 *   hse_drive_files          um por arquivo lido: datas, origem da leitura, titular, nome atual, e os campos do
 *                            registro Pessoa x Documento: chave da pessoa (CPF), emissor, WINDA ID, status de
 *                            conferência (VERIFICADO, DIVERGENTE, OBSOLETO, PENDENTE), quem conferiu e data de entrada
 *
 * Upsert por chave estável e remoção do que sumiu do Drive, então cada rodada só altera o diff.
 * Conexão: MONGODB_URI (ou VPS_MONGO_URI, o mesmo do sync do Millennium); banco MONGODB_DB_NAME ou arthwind_db.
 *
 * Uso: npx tsx src/cli/runDriveMongoSync.ts [--dry]
 */
import 'dotenv/config'
import fs from 'fs'
import { AnyBulkWriteOperation, MongoClient } from 'mongodb'
import { EHSEvaluator } from '../domain/services/EHSEvaluator.js'
import { personNameTokens } from '../domain/services/PDFContentInspector.js'

const BOOK_STATUS: Record<string, string> = {
  CONFORME: 'VALIDO', VENCE_90: 'PROGRAMAR', VENCE_60: 'BLOQUEADO', VENCE_30: 'BLOQUEADO',
  VENCE_15: 'BLOQUEADO', VENCE_07: 'BLOQUEADO', VENCIDO: 'VENCIDO', NAO_LIDO: 'PENDENTE',
  INDETERMINADO: 'PENDENTE', AUSENTE: 'PENDENTE',
}
const fileIdOf = (url?: string) => url?.match(/\/d\/([^/]+)/)?.[1]
const norm = (t?: string | null) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Tipo do emissor a partir do nome lido no documento. */
export function issuerKind(issuer?: string | null): string | null {
  const n = norm(issuer)
  if (!n) return null
  if (/STORZ/.test(n)) return 'STORZ'
  if (/CLINIC|MEDIC|SAUDE|OCUPACION|LABORAT/.test(n)) return 'CLINICA'
  if (/ARTHWIND/.test(n)) return 'RH'
  return 'EXTERNO'
}

/** WINDA ID (GWO): número de 5 a 8 dígitos ao lado de "WINDA". */
export function windaIdFrom(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) { const m = t?.match(/WINDA[^0-9]{0,20}(\d{5,8})/i); if (m) return m[1] }
  return null
}

async function main() {
  const dry = process.argv.includes('--dry')
  const now = new Date()
  const people = JSON.parse(fs.readFileSync('data/drive_inspectors_cache.json', 'utf8'))
  const raw = JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8'))
  const files: any[] = Array.isArray(raw) ? raw : Object.values(raw)

  const collaborators: any[] = []
  const status: any[] = []
  for (const p of people) {
    const counts: Record<string, number> = {}
    for (const c of Object.values<any>(p.certificates ?? {})) {
      // Reavalia na data de hoje: o status gravado no cache envelhece entre uma leitura e outra.
      const exp = c.expirationDate ? new Date(c.expirationDate) : undefined
      const ev = c.statusEHS === 'NAO_LIDO' ? { status: 'NAO_LIDO', detail: c.statusDetail } : EHSEvaluator.evaluateForCode(c.code, exp, now)
      const book = BOOK_STATUS[ev.status] ?? 'PENDENTE'
      counts[book] = (counts[book] ?? 0) + 1
      status.push({
        _id: `${p.driveFolderId}:${c.code}`,
        collaborator: p.name, role: p.role, driveFolderId: p.driveFolderId,
        code: c.code, statusEHS: ev.status, bookStatus: book, detail: ev.detail,
        issueDate: c.issueDate ? new Date(c.issueDate) : null, expirationDate: exp ?? null,
        filename: c.filename, fileId: fileIdOf(c.sourcePath) ?? null, readSource: c.readSource ?? null,
        divergences: c.divergences ?? [], syncedAt: now,
      })
    }
    collaborators.push({
      _id: p.driveFolderId, name: p.name, role: p.role, driveFolderUrl: p.driveFolderUrl,
      documents: Object.keys(p.certificates ?? {}).length, byBookStatus: counts,
      blocked: (counts.VENCIDO ?? 0) + (counts.BLOQUEADO ?? 0) + (counts.PENDENTE ?? 0) > 0, syncedAt: now,
    })
  }
  // Leitura do LLM (Prometheus) por md5 do arquivo: traz emissor e CPF do titular.
  let llmRaw: Record<string, any> = {}
  try { llmRaw = JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8')) } catch {}
  const llmByMd5 = new Map<string, any>()
  for (const [k, v] of Object.entries(llmRaw)) llmByMd5.set(k.split('|')[0], v)

  // Documento vigente por pessoa + código (o que o hse_drive_status escolheu); os outros do mesmo par são obsoletos.
  const vigente = new Map<string, string>()
  const divergente = new Set<string>()
  for (const st of status) {
    if (!st.fileId) continue
    vigente.set(`h2:${personNameTokens(st.collaborator ?? "").join(" ")}:${st.code}`, st.fileId)
    if (st.divergences?.length) divergente.add(st.fileId)
  }

  const fileDocs = files.map(f => {
    const d = (f.documents ?? [f])[0] ?? f
    const llm = f.md5 ? llmByMd5.get(f.md5) : undefined
    const lr = llm?.consensus?.[0] ?? llm?.a?.[0]
    const issuer: string | null = lr?.emissor && lr.emissor !== 'ausente' ? lr.emissor : null
    const cpf = String(lr?.titular_cpf ?? '').replace(/\D/g, '')
    const vig = f.holder?.key && d.code ? vigente.get(`${f.holder.key}:${d.code}`) : undefined
    const read = (d.source ?? f.source) !== 'FILENAME'
    const reviewStatus = vig && vig !== f.fileId ? 'OBSOLETO'
      : llm?.agreed === false || divergente.has(f.fileId) ? 'DIVERGENTE'
      : read || llm?.agreed ? 'VERIFICADO' : 'PENDENTE'
    const checkedBy = llm?.confirmedBy ?? (llm ? 'LEITOR' : read ? 'REGRAS' : null)
    return {
      personKey: cpf.length === 11 ? cpf : null,
      issuer, issuerKind: issuerKind(issuer),
      windaId: windaIdFrom(lr?.winda_id, d.extractedClause, f.filename, lr?.curso_ou_norma),
      reviewStatus, checkedBy,
      _id: f.fileId, filename: f.filename, modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
      code: d.code ?? null, statusEHS: d.statusEHS, issueDate: d.issueDate ? new Date(d.issueDate) : null,
      expirationDate: d.expirationDate ? new Date(d.expirationDate) : null, source: d.source ?? f.source,
      extractedClause: d.extractedClause ?? null, holder: f.holder ?? null,
      documentsInFile: (f.documents ?? []).length || 1, syncedAt: now,
    }
  })

  const tally = (k: string) => Object.entries(fileDocs.reduce((a: any, x: any) => ((a[x[k] ?? '—'] = (a[x[k] ?? '—'] ?? 0) + 1), a), {})).map(([a, b]) => `${a} ${b}`).join(', ')
  console.log(`[drive-mongo] ${collaborators.length} colaboradores | ${status.length} status | ${fileDocs.length} arquivos${dry ? ' (simulação)' : ''}`)
  console.log(`[drive-mongo] conferência: ${tally('reviewStatus')} | emissor: ${tally('issuerKind')} | com CPF: ${fileDocs.filter(x => x.personKey).length} | com WINDA ID: ${fileDocs.filter(x => x.windaId).length}`)
  if (dry) return

  const uri = process.env.MONGODB_URI || process.env.VPS_MONGO_URI
  if (!uri) throw new Error('MONGODB_URI (ou VPS_MONGO_URI) não configurado')
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'arthwind_db')
    for (const [name, docs] of [['hse_drive_collaborators', collaborators], ['hse_drive_status', status], ['hse_drive_files', fileDocs]] as const) {
      const col = db.collection<any>(name)
      // Data de entrada: gravada só na primeira vez que o arquivo aparece (as outras rodadas não mexem nela).
      const ops: AnyBulkWriteOperation<any>[] = docs.map(d => name === 'hse_drive_files'
        ? { updateOne: { filter: { _id: d._id }, update: { $set: d, $setOnInsert: { enteredAt: d.modifiedTime ?? now } }, upsert: true } }
        : { replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })
      const w = ops.length ? await col.bulkWrite(ops, { ordered: false }) : null
      // Some do Mongo o que sumiu do Drive (arquivo apagado, colaborador desligado).
      const gone = await col.deleteMany({ _id: { $nin: docs.map(d => d._id) } })
      console.log(`[drive-mongo] ${name}: ${w?.upsertedCount ?? 0} novos, ${w?.modifiedCount ?? 0} alterados, ${gone.deletedCount} removidos`)
    }
    await db.collection('hse_drive_status').createIndex({ bookStatus: 1, expirationDate: 1 })
    await db.collection('hse_drive_status').createIndex({ collaborator: 1 })
    await db.collection('hse_drive_collaborators').createIndex({ blocked: 1 })
    await db.collection('hse_drive_files').createIndex({ reviewStatus: 1 })
    await db.collection('hse_drive_files').createIndex({ personKey: 1, code: 1 })
  } finally {
    await client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
