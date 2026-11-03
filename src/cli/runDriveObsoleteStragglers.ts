import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { drive_v3, google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

// Remediation for a half-finished UPDATE_NEWER run: the superseding copies were created but moving
// the stale originals to Obsoletos failed for files that live in a subfolder (the move removed the
// wrong parent). This reads the reconciliation plan and, for each UPDATE_NEWER whose new canonical
// copy already exists, moves the old original to the collaborator's 00.Obsoleto using its REAL
// parents. Idempotent: a file already under an Obsoletos folder is skipped. Dry-run by default.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DIRECT_EXPIRATION = new Set(['40', '40.1', '04', '04.1'])

interface PlanAction {
  kind: string
  collabName: string
  code: string | null
  src2DateIso?: string | null
  ssotFileId?: string
  ssotFileName?: string
  ssotCollabFolderId?: string
  proposedName?: string
}

function escapeQ(s: string): string {
  return s.replace(/'/g, "\\'")
}

async function nameOf(drive: drive_v3.Drive, id: string): Promise<string> {
  const r = await drive.files.get({
    fileId: id,
    fields: 'name',
    supportsAllDrives: true,
  })
  return r.data.name || ''
}

async function ensureObsoletos(
  drive: drive_v3.Drive,
  parentFolderId: string
): Promise<string> {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  const existing = res.data.files?.find(f =>
    f.name?.toLowerCase().includes('obsolet')
  )
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

async function main() {
  const execute =
    process.argv.includes('--execute') || process.argv.includes('--run')
  const planPath = path.join(
    process.cwd(),
    'scratch',
    'drive_reconciliacao_plan.json'
  )
  const plan: PlanAction[] = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const nowMs = Date.now()

  const targets = plan.filter(
    a =>
      a.kind === 'UPDATE_NEWER' &&
      a.ssotFileId &&
      a.ssotCollabFolderId &&
      a.proposedName &&
      // same future-date guard as the main run: those were intentionally left out
      !(
        a.src2DateIso &&
        !DIRECT_EXPIRATION.has(a.code || '') &&
        new Date(a.src2DateIso).getTime() > nowMs
      )
  )

  console.log(
    `[obsolete] ${targets.length} originais candidatos. Modo: ${execute ? 'EXECUÇÃO' : 'SIMULAÇÃO'}\n`
  )

  const undoPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )
  const undo = fs.existsSync(undoPath)
    ? JSON.parse(fs.readFileSync(undoPath, 'utf8'))
    : []

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  let moved = 0
  let already = 0
  let noCopy = 0
  let err = 0
  for (const a of targets) {
    try {
      // Skip if the original is already under an Obsoletos folder (previous run handled it).
      const file = await drive.files.get({
        fileId: a.ssotFileId as string,
        fields: 'id, name, parents',
        supportsAllDrives: true,
      })
      const parents = file.data.parents || []
      const parentNames = await Promise.all(parents.map(p => nameOf(drive, p)))
      if (parentNames.some(n => /obsolet|^00\./i.test(n.trim()))) {
        already++
        continue
      }

      // Only obsolete the old file once the new canonical copy is confirmed present.
      const copyCheck = await drive.files.list({
        q: `'${a.ssotCollabFolderId}' in parents and name = '${escapeQ(a.proposedName as string)}' and trashed = false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      if (!copyCheck.data.files || copyCheck.data.files.length === 0) {
        noCopy++
        console.log(
          `   [SEM CÓPIA NOVA] ${a.collabName} | cód ${a.code} — não aposentar`
        )
        continue
      }

      if (!execute) {
        console.log(
          `   [SIMULAR] ${a.collabName} | cód ${a.code} | ${a.ssotFileName}`
        )
        moved++
        continue
      }

      const obsoletos = await ensureObsoletos(
        drive,
        a.ssotCollabFolderId as string
      )
      await drive.files.update({
        fileId: a.ssotFileId as string,
        addParents: obsoletos,
        removeParents: parents.join(','),
        fields: 'id, parents',
        supportsAllDrives: true,
      })
      undo.push({
        fileId: a.ssotFileId,
        collaborator: a.collabName,
        previousName: a.ssotFileName,
        renamedTo: `MOVIDO_PARA_OBSOLETOS:${obsoletos}`,
        timestamp: new Date().toISOString(),
      })
      console.log(
        `   [OBSOLETO] ${a.collabName} | cód ${a.code} | ${a.ssotFileName}`
      )
      moved++
      await sleep(150)
    } catch (e) {
      err++
      console.error(
        `   ERRO ${a.collabName} cód ${a.code}: ${(e as Error).message}`
      )
    }
  }

  if (execute) fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(
    `\n[obsolete] ${execute ? 'movidos' : 'a mover'}: ${moved} | já no Obsoletos: ${already} | sem cópia nova: ${noCopy} | erros: ${err}`
  )
}

main().catch(err => {
  console.error('[obsolete] Erro fatal:', err)
  process.exit(1)
})
