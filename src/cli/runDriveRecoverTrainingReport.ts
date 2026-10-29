import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { drive_v3, google } from 'googleapis'
import { scanBranch } from '../adapters/drive/DriveTreeScanner.js'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import {
  ScannedCollaborator,
  ScannedDoc,
  collaboratorKey,
  reconcileBranch,
} from '../domain/services/DriveSourceReconciler.js'
import { buildStandardNameForRemainingFile } from './standardizeRemainingDriveFiles.js'

// Review report for the "recovered training" files: second-source files the filename alone could
// not code, now re-read with name + PDF content. Produces (read-only) the list of documents that
// are genuinely training (HSE code) and should be copied into the SSOT, reusing the tested
// reconciler to classify copy-missing vs already-present vs newer. No Drive writes.
//
// Precedence (guards against content false positives — a badge/EPI/declaration that merely mentions
// an NR inside the PDF): a SPECIFIC personal verdict from the name classifier wins and is excluded;
// the content code is only trusted when the name is generic or gives no code (then flagged LOW).

const GENERIC_EXTRA = /Documento Complementar|Certificado Complementar/i

function leadingCode(name: string): string | null {
  const m = name.match(/^(\d{1,2}(?:\.\d+)?)\s*[–-]/)
  return m ? m[1] : null
}

function cleanCollab(folderName: string): string {
  return folderName.split(/[-–—_]/)[0].trim()
}

function cacheDateIso(entry: any, fallbackIso: string | null): string | null {
  const raw = entry?.issueDate || entry?.expirationDate
  if (raw) {
    const d = new Date(raw)
    const y = d.getUTCFullYear()
    if (
      !Number.isNaN(d.getTime()) &&
      y >= 1990 &&
      y <= new Date().getUTCFullYear() + 10
    )
      return d.toISOString()
  }
  return fallbackIso
}

interface Recovered {
  code: string
  codeSource: 'nome' | 'conteúdo'
  confidence: 'ALTA' | 'BAIXA'
  richName: string | null
}

/** Decide whether a second-source file is training, with the false-positive guard. */
function recover(
  fileId: string,
  fileName: string,
  collab: string,
  cache: Map<string, any>
): Recovered | null {
  const res = buildStandardNameForRemainingFile(fileId, fileName, collab, cache)
  const nameCode =
    res?.category === 'CODED_HSE' ? leadingCode(res.newName) : null
  if (nameCode) {
    return {
      code: nameCode,
      codeSource: 'nome',
      confidence: 'ALTA',
      richName: res?.newName || null,
    }
  }
  // A specific (non-generic) personal verdict from the name wins: not training.
  if (res?.category === 'UNCODED_EXTRA' && !GENERIC_EXTRA.test(res.newName)) {
    return null
  }
  const contentCode = cache.get(fileId)?.code
  if (contentCode && /^\d/.test(contentCode)) {
    return {
      code: contentCode,
      codeSource: 'conteúdo',
      confidence: 'BAIXA',
      richName: null,
    }
  }
  return null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

async function rootPrefix(drive: drive_v3.Drive, id: string): Promise<string> {
  const r = await drive.files.get({
    fileId: id,
    fields: 'name',
    supportsAllDrives: true,
  })
  const m = (r.data.name || '').match(/^(\d{2})\s*-/)
  return m ? m[1] : r.data.name || id
}

async function main() {
  const roots = (process.env.HSE_DRIVE_FOLDER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scratch', 'drive_reconciliacao_plan.json'),
      'utf8'
    )
  )
  const cacheArr = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'data', 'pdf_content_cache.json'),
      'utf8'
    )
  )
  const cache = new Map<string, any>(cacheArr.map((e: any) => [e.fileId, e]))
  const unclassified = plan.filter((a: any) => a.kind === 'UNCLASSIFIED')

  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  // Resolve branch prefix -> SSOT root id.
  const rootByPrefix = new Map<string, string>()
  for (const id of roots) rootByPrefix.set(await rootPrefix(drive, id), id)

  // Extra per-file metadata (rich name, confidence) keyed by fileId, for the report.
  const meta = new Map<
    string,
    Recovered & { original: string; collab: string }
  >()

  const rows: any[] = []
  // Carries the full reconcile action (with ids) plus the per-file confidence/rich name, so the
  // execute step can act on exactly what the report shows.
  const actionable: Array<{
    act: any
    confidence: string
    proposedName: string
  }> = []
  let copyCount = 0
  let updateCount = 0
  let alreadyCount = 0
  let personalExcluded = 0

  for (const [prefix, rootId] of rootByPrefix) {
    const branchUnc = unclassified.filter((a: any) => a.branch === prefix)
    if (branchUnc.length === 0) continue

    // Build "recovered" second-source collaborators (training only, deduped by code per collab).
    const byCollab = new Map<string, ScannedCollaborator>()
    for (const a of branchUnc) {
      const collab = cleanCollab(a.collabName)
      const rec = recover(a.src2FileId, a.src2FileName, collab, cache)
      if (!rec) {
        personalExcluded++
        continue
      }
      meta.set(a.src2FileId, {
        ...rec,
        original: a.src2FileName,
        collab: a.collabName,
      })
      const key = collaboratorKey(a.collabName)
      if (!byCollab.has(key))
        byCollab.set(key, {
          key,
          name: a.collabName,
          folderId: undefined,
          docs: [],
        })
      const doc: ScannedDoc = {
        fileId: a.src2FileId,
        fileName: a.src2FileName,
        parentFolderId: '',
        code: rec.code,
        dateIso: cacheDateIso(cache.get(a.src2FileId), a.src2DateIso ?? null),
      }
      byCollab.get(key)!.docs.push(doc)
    }

    const ssot = await scanBranch(drive, rootId)
    const result = reconcileBranch(ssot, [...byCollab.values()], rootId)

    for (const act of result.actions) {
      if (act.kind === 'OK') {
        alreadyCount++
        continue
      }
      if (act.kind !== 'COPY_MISSING' && act.kind !== 'UPDATE_NEWER') continue
      if (act.kind === 'COPY_MISSING') copyCount++
      else updateCount++
      const m = act.src2FileId ? meta.get(act.src2FileId) : undefined
      const proposedName = m?.richName || act.proposedName || ''
      actionable.push({
        act,
        confidence: m?.confidence || '',
        proposedName,
      })
      rows.push({
        branch: prefix,
        collab: act.collabName,
        code: act.code,
        codeSource: m?.codeSource || '',
        confidence: m?.confidence || '',
        action: act.kind,
        original: act.src2FileName,
        date: act.src2DateIso
          ? new Date(act.src2DateIso).toLocaleDateString('pt-BR')
          : '',
        proposed: m?.richName || act.proposedName,
        ssotExisting: act.ssotFileName || '',
      })
    }
  }

  // Excel report.
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Treinamentos recuperados')
  ws.columns = [
    { header: 'Ramo', key: 'branch', width: 7 },
    { header: 'Colaborador', key: 'collab', width: 32 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Código veio de', key: 'codeSource', width: 13 },
    { header: 'Confiança', key: 'confidence', width: 10 },
    { header: 'Ação', key: 'action', width: 14 },
    { header: 'Arquivo original (2ª fonte)', key: 'original', width: 50 },
    { header: 'Data', key: 'date', width: 12 },
    { header: 'Nome proposto', key: 'proposed', width: 50 },
    { header: 'Já no SSOT (seria superado)', key: 'ssotExisting', width: 46 },
  ]
  ws.getRow(1).font = { bold: true }
  // Low-confidence rows highlighted so review focuses there.
  for (const r of rows) {
    const row = ws.addRow(r)
    if (r.confidence === 'BAIXA')
      row.eachCell(c => {
        c.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3CD' },
        }
      })
  }
  const out = path.join(
    process.cwd(),
    'scratch',
    'treinamentos_recuperados.xlsx'
  )
  await wb.xlsx.writeFile(out)
  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'treinamentos_recuperados_plan.json'),
    JSON.stringify(rows, null, 2),
    'utf8'
  )

  const lowConf = rows.filter(r => r.confidence === 'BAIXA').length
  console.log('=== TREINAMENTOS RECUPERADOS (relatório, nada escrito) ===')
  console.log(`A copiar (novo): ${copyCount}`)
  console.log(`A atualizar (mais novo que o SSOT): ${updateCount}`)
  console.log(`Já presente no SSOT (ignorar): ${alreadyCount}`)
  console.log(
    `Excluídos como pessoal/extra (guarda de falso positivo): ${personalExcluded}`
  )
  console.log(
    `  dos acionáveis, confiança BAIXA (revisar com atenção): ${lowConf}`
  )
  console.log(`\nRelatório: ${out}`)

  const execute =
    process.argv.includes('--execute') || process.argv.includes('--run')
  if (!execute) {
    console.log(
      '\n[recover] SIMULAÇÃO — nada escrito. Rode com --execute para aplicar os ALTA (--include-low também aplica os BAIXA).'
    )
    return
  }

  // Execute: copy the recovered training into the SSOT and supersede when newer. By default only
  // ALTA-confidence rows (code from the filename); --include-low also applies the content-only ones.
  const includeLow = process.argv.includes('--include-low')
  const toApply = actionable.filter(
    a => a.confidence === 'ALTA' || (includeLow && a.confidence === 'BAIXA')
  )
  console.log(
    `\n[recover] EXECUÇÃO — aplicando ${toApply.length} (ALTA${includeLow ? ' + BAIXA' : ' apenas'})`
  )
  const undoPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )
  const undo = fs.existsSync(undoPath)
    ? JSON.parse(fs.readFileSync(undoPath, 'utf8'))
    : []
  let ok = 0
  let err = 0
  for (const { act, proposedName } of toApply) {
    try {
      const copied = await drive.files.copy({
        fileId: act.src2FileId,
        requestBody: { name: proposedName, parents: [act.ssotCollabFolderId] },
        fields: 'id',
        supportsAllDrives: true,
      })
      undo.push({
        fileId: copied.data.id,
        collaborator: act.collabName,
        previousName: '(cópia treinamento recuperado)',
        renamedTo: `COPIADO_PARA:${act.ssotCollabFolderId}`,
        timestamp: new Date().toISOString(),
      })
      console.log(
        `   [${act.kind}] ${act.collabName} | cód ${act.code} -> ${proposedName}`
      )
      await sleep(180)

      if (act.kind === 'UPDATE_NEWER' && act.ssotFileId) {
        const obsoletos = await ensureObsoletos(drive, act.ssotCollabFolderId)
        const cur = await drive.files.get({
          fileId: act.ssotFileId,
          fields: 'parents',
          supportsAllDrives: true,
        })
        await drive.files.update({
          fileId: act.ssotFileId,
          addParents: obsoletos,
          removeParents: (cur.data.parents || []).join(','),
          fields: 'id',
          supportsAllDrives: true,
        })
        undo.push({
          fileId: act.ssotFileId,
          collaborator: act.collabName,
          previousName: act.ssotFileName,
          renamedTo: `MOVIDO_PARA_OBSOLETOS:${obsoletos}`,
          timestamp: new Date().toISOString(),
        })
        await sleep(180)
      }
      ok++
    } catch (e) {
      err++
      console.error(
        `   ERRO ${act.collabName} cód ${act.code}: ${(e as Error).message}`
      )
    }
  }
  fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(`\n[recover] Aplicados ${ok} | erros ${err} | undo: ${undoPath}`)
}

main().catch(err => {
  console.error('[recover] Erro fatal:', err)
  process.exit(1)
})
