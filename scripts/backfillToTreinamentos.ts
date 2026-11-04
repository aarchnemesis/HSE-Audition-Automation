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
import { DriveNomenclatureStandardizer } from '../src/domain/services/DriveNomenclatureStandardizer.js'

const SRC2_ROOT = '13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2' // Shared Drive "TREINAMENTOS"

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

async function ensureObsoletos(drive: any, parentFolderId: string): Promise<string> {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  const existing = res.data.files?.find((f: any) => f.name?.toLowerCase().includes('obsolet'))
  if (existing?.id) return existing.id
  const created = await drive.files.create({
    requestBody: {
      name: '00.Obsoleto',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  })
  return created.data.id as string
}

async function ensureFolder(drive: any, parentId: string, name: string): Promise<string> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  })
  return created.data.id
}

async function main() {
  const execute = process.argv.includes('--execute')
  console.log('================================================================================')
  console.log('   BACKFILL / MERGE: SSOT LEGADO -> PASTA TREINAMENTOS')
  console.log(`   Modo: ${execute ? 'EXECUÇÃO REAL' : 'SIMULAÇÃO (DRY RUN)'}`)
  console.log('================================================================================\n')

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  const ssotRootsEnv = (process.env.HSE_DRIVE_FOLDER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const src2Branches = await resolveBranchFolders(drive, SRC2_ROOT)

  let totalMissingCopied = 0
  let totalNewerUpdated = 0
  let totalNewCollabFolders = 0
  let errors = 0

  for (const ssotRootId of ssotRootsEnv) {
    const meta = await drive.files.get({
      fileId: ssotRootId,
      fields: 'id, name',
      supportsAllDrives: true,
    })
    const name = meta.data.name || ''
    const prefix = name.match(/^(\d{2})\s*-/)?.[1] || name
    const src2Branch = src2Branches.get(prefix)
    if (!src2Branch) {
      console.log(`[PULADO] Ramo ${prefix} (${name}) sem par em TREINAMENTOS`)
      continue
    }

    console.log(`\n[backfill] Escaneando ramo ${prefix} — ${name}...`)
    const [ssotCollabs, src2Collabs] = await Promise.all([
      scanBranch(drive, ssotRootId),
      scanBranch(drive, src2Branch.id),
    ])

    const src2ByKey = new Map(src2Collabs.map(c => [c.key, c]))

    for (const ssot of ssotCollabs) {
      let targetFolderId: string
      let targetDocs: ScannedDoc[] = []

      const existingInSrc2 = src2ByKey.get(ssot.key)
      if (!existingInSrc2) {
        // Colaborador inteiro precisa ser criado na pasta TREINAMENTOS
        if (execute) {
          targetFolderId = await ensureFolder(drive, src2Branch.id, ssot.name)
          console.log(`   [NOVA PASTA EM TREINAMENTOS] ${ssot.name} -> ${targetFolderId}`)
        } else {
          targetFolderId = 'dry-run-folder-id'
          console.log(`   [SIMULAÇÃO NOVA PASTA] ${ssot.name}`)
        }
        totalNewCollabFolders++
      } else {
        targetFolderId = existingInSrc2.folderId!
        targetDocs = existingInSrc2.docs
      }

      const ssotBest = latestByCode(ssot.docs)
      const src2Best = latestByCode(targetDocs)

      for (const [code, ssotDoc] of ssotBest) {
        const src2Doc = src2Best.get(code)
        const proposedName = DriveNomenclatureStandardizer.buildStandardFilename({
          code,
          collaboratorName: ssot.name,
          date: ssotDoc.dateIso ? new Date(ssotDoc.dateIso) : null,
          originalFilename: ssotDoc.fileName,
        })

        if (!src2Doc) {
          // Copiar documento ausente em TREINAMENTOS
          totalMissingCopied++
          console.log(`   [COPY TO TREINAMENTOS] ${ssot.name} | cód ${code} -> ${proposedName}`)
          if (execute) {
            try {
              await drive.files.copy({
                fileId: ssotDoc.fileId,
                requestBody: {
                  name: proposedName,
                  parents: [targetFolderId],
                },
                supportsAllDrives: true,
              })
            } catch (err: any) {
              console.error(`      ERRO copiando ${ssotDoc.fileName}: ${err.message}`)
              errors++
            }
          }
        } else if (timeOf(ssotDoc.dateIso) > timeOf(src2Doc.dateIso)) {
          // Documento mais novo no Legado do que em TREINAMENTOS
          totalNewerUpdated++
          console.log(`   [UPDATE IN TREINAMENTOS] ${ssot.name} | cód ${code} -> ${proposedName} (substitui ${src2Doc.fileName})`)
          if (execute) {
            try {
              // 1. Mover o antigo em TREINAMENTOS para 00.Obsoleto
              const obsId = await ensureObsoletos(drive, targetFolderId)
              const existingParents = (await drive.files.get({
                fileId: src2Doc.fileId,
                fields: 'parents',
                supportsAllDrives: true,
              })).data.parents || []

              await drive.files.update({
                fileId: src2Doc.fileId,
                addParents: obsId,
                removeParents: existingParents.join(','),
                supportsAllDrives: true,
              })

              // 2. Copiar o arquivo mais novo do SSOT Legado para a pasta em TREINAMENTOS
              await drive.files.copy({
                fileId: ssotDoc.fileId,
                requestBody: {
                  name: proposedName,
                  parents: [targetFolderId],
                },
                supportsAllDrives: true,
              })
            } catch (err: any) {
              console.error(`      ERRO atualizando ${ssotDoc.fileName}: ${err.message}`)
              errors++
            }
          }
        }
      }
    }
  }

  console.log('\n================================================================================')
  console.log('   RESUMO DO BACKFILL')
  console.log(`   Novas pastas criadas: ${totalNewCollabFolders}`)
  console.log(`   Documentos copiados (ausentes): ${totalMissingCopied}`)
  console.log(`   Documentos atualizados (mais novos): ${totalNewerUpdated}`)
  console.log(`   Erros: ${errors}`)
  console.log('================================================================================')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
