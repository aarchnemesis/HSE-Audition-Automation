/**
 * Publica a leitura do Drive no MongoDB da VPS (arthwind_db), para consulta estruturada e para o
 * agente Prometheus, em vez de só o JSON dentro do git.
 *
 *   hse_drive_collaborators  um por pasta de colaborador (nome, função, pasta, contagem por status)
 *   hse_drive_status         um por colaborador + código: o documento que vale hoje, com status do Book
 *   hse_drive_files          um por arquivo lido: datas, origem da leitura, titular, nome atual
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

const BOOK_STATUS: Record<string, string> = {
  CONFORME: 'VALIDO', VENCE_90: 'PROGRAMAR', VENCE_60: 'BLOQUEADO', VENCE_30: 'BLOQUEADO',
  VENCE_15: 'BLOQUEADO', VENCE_07: 'BLOQUEADO', VENCIDO: 'VENCIDO', NAO_LIDO: 'PENDENTE',
  INDETERMINADO: 'PENDENTE', AUSENTE: 'PENDENTE',
}
const fileIdOf = (url?: string) => url?.match(/\/d\/([^/]+)/)?.[1]

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
  const fileDocs = files.map(f => {
    const d = (f.documents ?? [f])[0] ?? f
    return {
      _id: f.fileId, filename: f.filename, modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
      code: d.code ?? null, statusEHS: d.statusEHS, issueDate: d.issueDate ? new Date(d.issueDate) : null,
      expirationDate: d.expirationDate ? new Date(d.expirationDate) : null, source: d.source ?? f.source,
      extractedClause: d.extractedClause ?? null, holder: f.holder ?? null,
      documentsInFile: (f.documents ?? []).length || 1, syncedAt: now,
    }
  })

  console.log(`[drive-mongo] ${collaborators.length} colaboradores | ${status.length} status | ${fileDocs.length} arquivos${dry ? ' (simulação)' : ''}`)
  if (dry) return

  const uri = process.env.MONGODB_URI || process.env.VPS_MONGO_URI
  if (!uri) throw new Error('MONGODB_URI (ou VPS_MONGO_URI) não configurado')
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'arthwind_db')
    for (const [name, docs] of [['hse_drive_collaborators', collaborators], ['hse_drive_status', status], ['hse_drive_files', fileDocs]] as const) {
      const col = db.collection<any>(name)
      const ops: AnyBulkWriteOperation<any>[] = docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }))
      const w = ops.length ? await col.bulkWrite(ops, { ordered: false }) : null
      // Some do Mongo o que sumiu do Drive (arquivo apagado, colaborador desligado).
      const gone = await col.deleteMany({ _id: { $nin: docs.map(d => d._id) } })
      console.log(`[drive-mongo] ${name}: ${w?.upsertedCount ?? 0} novos, ${w?.modifiedCount ?? 0} alterados, ${gone.deletedCount} removidos`)
    }
    await db.collection('hse_drive_status').createIndex({ bookStatus: 1, expirationDate: 1 })
    await db.collection('hse_drive_status').createIndex({ collaborator: 1 })
    await db.collection('hse_drive_collaborators').createIndex({ blocked: 1 })
  } finally {
    await client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
