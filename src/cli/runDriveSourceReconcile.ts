import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { drive_v3, google } from 'googleapis'
import {
  resolveBranchFolders,
  scanBranch,
} from '../adapters/drive/DriveTreeScanner.js'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import {
  ReconAction,
  ReconKind,
  reconcileBranch,
} from '../domain/services/DriveSourceReconciler.js'

// Reconciles the second documentation source (shared drive "TREINAMENTOS") into the SSOT the
// dashboard reads (My Drive branches in HSE_DRIVE_FOLDER_ID). Read-only by default: it scans both
// sides and writes a report. With --execute it copies missing/newer docs into the SSOT under the
// canonical name, sends superseded originals to Obsoletos, creates folders for new collaborators,
// and appends to the shared undo log. Never sends e-mail.

const SRC2_ROOT = '13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2' // shared drive "TREINAMENTOS"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const SCOPE_KINDS: ReconKind[] = ['COPY_MISSING', 'UPDATE_NEWER', 'NEW_COLLAB']

interface Args {
  execute: boolean
  branches?: string[]
  collaborator?: string
  kinds: Set<ReconKind>
  limit: number
  delayMs: number
}

function parseArgs(): Args {
  const argv = process.argv
  const get = (p: string) =>
    argv.find(a => a.startsWith(p))?.split('=')[1] ?? undefined
  const kindsArg = get('--kinds=')
  return {
    execute: argv.includes('--execute') || argv.includes('--run'),
    branches: get('--branch=')
      ?.split(',')
      .map(s => s.trim())
      .filter(Boolean),
    collaborator: get('--collaborator=')?.toUpperCase(),
    kinds: new Set(
      kindsArg
        ? (kindsArg.split(',').map(s => s.trim()) as ReconKind[])
        : SCOPE_KINDS
    ),
    limit: get('--limit=') ? parseInt(get('--limit=') as string, 10) : Infinity,
    delayMs: get('--delay=') ? parseInt(get('--delay=') as string, 10) : 200,
  }
}

async function rootPrefix(
  drive: drive_v3.Drive,
  id: string
): Promise<{ prefix: string; name: string }> {
  const r = await drive.files.get({
    fileId: id,
    fields: 'id, name',
    supportsAllDrives: true,
  })
  const name = r.data.name || ''
  const m = name.match(/^(\d{2})\s*-/)
  return { prefix: m ? m[1] : name, name }
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

async function writeReport(
  actions: ReconAction[],
  outputPath: string
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Reconciliação')
  ws.columns = [
    { header: 'Ramo', key: 'branch', width: 8 },
    { header: 'Colaborador', key: 'collab', width: 34 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Ação', key: 'kind', width: 15 },
    { header: 'Arquivo na 2ª fonte', key: 'src2', width: 50 },
    { header: 'Data 2ª fonte', key: 'src2Date', width: 13 },
    { header: 'Arquivo no SSOT', key: 'ssot', width: 50 },
    { header: 'Data SSOT', key: 'ssotDate', width: 13 },
    { header: 'Nome proposto', key: 'proposed', width: 55 },
  ]
  ws.getRow(1).font = { bold: true }
  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR') : ''
  for (const a of actions) {
    ws.addRow({
      branch: (a as ReconAction & { branch?: string }).branch,
      collab: a.collabName,
      code: a.code,
      kind: a.kind,
      src2: a.src2FileName,
      src2Date: fmt(a.src2DateIso),
      ssot: a.ssotFileName,
      ssotDate: fmt(a.ssotDateIso),
      proposed: a.proposedName,
    })
  }
  await wb.xlsx.writeFile(outputPath)
}

async function main() {
  const args = parseArgs()
  console.log(
    '================================================================================'
  )
  console.log('   RECONCILIAÇÃO 2ª FONTE (TREINAMENTOS) -> SSOT (Dashboard)')
  console.log(
    `   Modo: ${args.execute ? 'EXECUÇÃO REAL' : 'SIMULAÇÃO (somente relatório)'}`
  )
  console.log(`   Ações no escopo: ${[...args.kinds].join(', ')}`)
  console.log(
    '================================================================================\n'
  )

  const ssotRootsEnv = (process.env.HSE_DRIVE_FOLDER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (ssotRootsEnv.length === 0)
    throw new Error('HSE_DRIVE_FOLDER_ID não configurado.')

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  // Pair each SSOT root with the matching branch in the second source, by "NN" prefix.
  const src2Branches = await resolveBranchFolders(drive, SRC2_ROOT)
  const pairs: Array<{
    prefix: string
    name: string
    ssotRootId: string
    src2BranchId: string
  }> = []
  for (const ssotRootId of ssotRootsEnv) {
    const { prefix, name } = await rootPrefix(drive, ssotRootId)
    const src2 = src2Branches.get(prefix)
    if (!src2) {
      console.warn(
        `[recon] Ramo ${prefix} (${name}) sem par na 2ª fonte — pulado.`
      )
      continue
    }
    if (args.branches && !args.branches.includes(prefix)) continue
    pairs.push({ prefix, name, ssotRootId, src2BranchId: src2.id })
  }

  const allActions: Array<ReconAction & { branch: string }> = []
  for (const p of pairs) {
    console.log(`[recon] Escaneando ramo ${p.prefix} — ${p.name} ...`)
    const [ssot, src2] = await Promise.all([
      scanBranch(drive, p.ssotRootId),
      scanBranch(drive, p.src2BranchId),
    ])
    const { actions, summary } = reconcileBranch(ssot, src2, p.ssotRootId)
    console.log(
      `   ramo ${p.prefix}: faltando ${summary.copyMissing} | mais novo ${summary.updateNewer} | novos colab ${summary.newCollab} | não classificado ${summary.unclassified} | ok ${summary.ok}`
    )
    for (const a of actions) allActions.push({ ...a, branch: p.prefix })
  }

  if (!fs.existsSync(path.join(process.cwd(), 'scratch')))
    fs.mkdirSync(path.join(process.cwd(), 'scratch'), { recursive: true })

  // Always write the full report + machine-readable plan.
  const reportPath = path.join(
    process.cwd(),
    'scratch',
    'drive_reconciliacao.xlsx'
  )
  await writeReport(allActions, reportPath)
  const planPath = path.join(
    process.cwd(),
    'scratch',
    'drive_reconciliacao_plan.json'
  )
  fs.writeFileSync(planPath, JSON.stringify(allActions, null, 2), 'utf8')

  const actionable = allActions.filter(a => args.kinds.has(a.kind))
  const totals = actionable.reduce(
    (m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m),
    {} as Record<string, number>
  )
  console.log('\n=== PLANO ===')
  for (const [k, v] of Object.entries(totals)) console.log(`   ${k}: ${v}`)
  console.log(`   Total acionável: ${actionable.length}`)
  console.log(`   Relatório Excel: ${reportPath}`)
  console.log(`   Plano JSON:      ${planPath}`)

  if (!args.execute) {
    console.log(
      '\n[recon] SIMULAÇÃO — nada foi alterado no Drive. Revise o relatório e rode com --execute para aplicar.'
    )
    return
  }

  // ---- EXECUÇÃO REAL ----
  const undoPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )
  const undo = fs.existsSync(undoPath)
    ? JSON.parse(fs.readFileSync(undoPath, 'utf8'))
    : []
  const createdFolders = new Map<string, string>() // collabKey -> new folder id

  let done = 0
  let ok = 0
  let err = 0
  for (const a of actionable) {
    if (done >= args.limit) {
      console.log(`[recon] Limite (${args.limit}) atingido.`)
      break
    }
    if (
      args.collaborator &&
      !a.collabName.toUpperCase().includes(args.collaborator)
    )
      continue
    done++

    try {
      let targetFolderId = a.ssotCollabFolderId as string

      // New collaborator: create (or reuse already-created) folder under the branch root.
      if (a.kind === 'NEW_COLLAB') {
        const cached = createdFolders.get(a.collabKey)
        if (cached) {
          targetFolderId = cached
        } else {
          const createdFolder = await drive.files.create({
            requestBody: {
              name: a.collabName,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [a.ssotCollabFolderId as string],
            },
            fields: 'id',
            supportsAllDrives: true,
          })
          targetFolderId = createdFolder.data.id as string
          createdFolders.set(a.collabKey, targetFolderId)
          console.log(`   [NOVA PASTA] ${a.collabName} -> ${targetFolderId}`)
          await sleep(args.delayMs)
        }
      }

      // Copy the source file into the SSOT under the canonical name (source is left untouched).
      const copied = await drive.files.copy({
        fileId: a.src2FileId as string,
        requestBody: { name: a.proposedName, parents: [targetFolderId] },
        fields: 'id, name',
        supportsAllDrives: true,
      })
      console.log(
        `   [${a.kind}] ${a.collabName} | cód ${a.code} -> ${a.proposedName}`
      )
      undo.push({
        fileId: copied.data.id,
        collaborator: a.collabName,
        previousName: '(cópia nova da 2ª fonte)',
        renamedTo: `COPIADO_PARA:${targetFolderId}`,
        timestamp: new Date().toISOString(),
      })
      await sleep(args.delayMs)

      // Supersede: move the stale SSOT original to Obsoletos.
      if (a.kind === 'UPDATE_NEWER' && a.ssotFileId) {
        const obsoletos = await ensureObsoletos(drive, targetFolderId)
        await drive.files.update({
          fileId: a.ssotFileId,
          addParents: obsoletos,
          removeParents: targetFolderId,
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
        console.log(`      original obsoleto: ${a.ssotFileName}`)
        await sleep(args.delayMs)
      }
      ok++
    } catch (e) {
      err++
      console.error(
        `   ERRO ${a.collabName} cód ${a.code}: ${(e as Error).message}`
      )
    }
  }

  fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(
    `\n[recon] Execução concluída. Processados ${done} | sucesso ${ok} | erro ${err}`
  )
  console.log(`[recon] Undo log: ${undoPath}`)
}

main().catch(err => {
  console.error('[recon] Erro fatal:', err)
  process.exit(1)
})
