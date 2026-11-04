import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../src/adapters/drive/googleAuth.js'
import {
  scanBranch,
  resolveBranchFolders,
} from '../src/adapters/drive/DriveTreeScanner.js'
import {
  collaboratorKey,
  ScannedCollaborator,
  ScannedDoc,
} from '../src/domain/services/DriveSourceReconciler.js'

const SRC2_ROOT = '13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2'

function timeOf(dateIso: string | null | undefined): number {
  if (!dateIso) return 0
  const t = new Date(dateIso).getTime()
  return Number.isNaN(t) ? 0 : t
}

function latestByCode(docs: ScannedDoc[]): Map<string, ScannedDoc> {
  const best = new Map<string, ScannedDoc>()
  for (const d of docs) {
    if (!d.code) continue
    const prev = best.get(d.code)
    if (!prev || timeOf(d.dateIso) > timeOf(prev.dateIso)) best.set(d.code, d)
  }
  return best
}

async function main() {
  console.log('=== VERIFICAÇÃO REVERSA: SSOT (Legado) vs TREINAMENTOS (Target) ===')
  const ssotRootsEnv = (process.env.HSE_DRIVE_FOLDER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  const src2Branches = await resolveBranchFolders(drive, SRC2_ROOT)

  const results: any[] = []

  for (const ssotRootId of ssotRootsEnv) {
    const meta = await drive.files.get({
      fileId: ssotRootId,
      fields: 'id, name',
      supportsAllDrives: true,
    })
    const name = meta.data.name || ''
    const prefix = name.match(/^(\d{2})\s*-/)?.[1] || name
    const src2 = src2Branches.get(prefix)
    if (!src2) {
      console.log(`[PULADO] Ramo ${prefix} (${name}) não tem par em TREINAMENTOS`)
      continue
    }

    console.log(`\nAnalisando ramo ${prefix} (${name})...`)
    const [ssotCollabs, src2Collabs] = await Promise.all([
      scanBranch(drive, ssotRootId),
      scanBranch(drive, src2.id),
    ])

    const src2ByKey = new Map(src2Collabs.map(c => [c.key, c]))

    for (const ssot of ssotCollabs) {
      const src2Target = src2ByKey.get(ssot.key)
      if (!src2Target) {
        // Colaborador existe no SSOT legado mas não existe na pasta TREINAMENTOS!
        results.push({
          type: 'COLLAB_MISSING_IN_TREINAMENTOS',
          branch: prefix,
          collab: ssot.name,
          ssotDocsCount: ssot.docs.length,
        })
        continue
      }

      const ssotBest = latestByCode(ssot.docs)
      const src2Best = latestByCode(src2Target.docs)

      for (const [code, ssotDoc] of ssotBest) {
        const src2Doc = src2Best.get(code)
        if (!src2Doc) {
          // Documento existe no SSOT legado mas não existe em TREINAMENTOS!
          results.push({
            type: 'DOC_MISSING_IN_TREINAMENTOS',
            branch: prefix,
            collab: ssot.name,
            code,
            ssotFileName: ssotDoc.fileName,
            ssotDate: ssotDoc.dateIso,
          })
        } else if (timeOf(ssotDoc.dateIso) > timeOf(src2Doc.dateIso)) {
          // SSOT legado tem documento MAIS NOVO do que em TREINAMENTOS!
          results.push({
            type: 'SSOT_IS_NEWER',
            branch: prefix,
            collab: ssot.name,
            code,
            ssotFileName: ssotDoc.fileName,
            ssotDate: ssotDoc.dateIso,
            src2FileName: src2Doc.fileName,
            src2Date: src2Doc.dateIso,
          })
        }
      }
    }
  }

  const outPath = path.join(process.cwd(), 'scratch', 'reverse_check_results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nTotal de itens onde o SSOT legado tem algo ausente ou mais novo que TREINAMENTOS: ${results.length}`)
  const counts: Record<string, number> = {}
  results.forEach(r => counts[r.type] = (counts[r.type] || 0) + 1)
  console.log('Resumo:', counts)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
