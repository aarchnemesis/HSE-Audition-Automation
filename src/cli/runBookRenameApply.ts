/**
 * Aplica no Drive SÓ as linhas aprovadas por uma pessoa na página de revisão do Book EHS.
 *   RENOMEAR: renomeia para o nome proposto e move para a subpasta do Book (01/02/03_...).
 *   OBSOLETO: move para 00_OBSOLETOS da pasta do colaborador, mantendo o nome.
 * Antes de cada mudança grava nome e pastas de origem em scratch/book_apply_undo.jsonl (desfazer).
 *
 * Uso: npx tsx src/cli/runBookRenameApply.ts <decisions.json> [--dry]
 *   decisions.json: [{ approved: string[] }] exportado da página (coleção "decisions").
 */
import 'dotenv/config'
import fs from 'fs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

async function main() {
  const [decisionsPath, flag] = process.argv.slice(2)
  const dry = flag === '--dry'
  const decisions: { approved?: string[] }[] = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'))
  const approved = new Set(decisions.flatMap(d => d.approved ?? []))
  const { rows } = JSON.parse(fs.readFileSync('scratch/book_rename_plan.json', 'utf8'))
  const todo = rows.filter((r: any) => approved.has(r.fileId) && (r.action === 'RENOMEAR' || r.action === 'OBSOLETO'))
  console.log(`[book-apply] ${todo.length} aprovados${dry ? ' (simulação)' : ''}`)

  const drive = google.drive({ version: 'v3', auth: (await getAuthorizedClient()) as any })
  const folderCache = new Map<string, string>()
  const subfolder = async (personFolderId: string, name: string) => {
    const key = `${personFolderId}/${name}`
    if (folderCache.has(key)) return folderCache.get(key)!
    const q = `'${personFolderId}' in parents and name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`
    const found = (await drive.files.list({ q, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files?.[0]?.id
    const id = found ?? (dry ? `(nova ${name})` : (await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [personFolderId] }, fields: 'id', supportsAllDrives: true,
    })).data.id!)
    folderCache.set(key, id)
    return id
  }

  let done = 0
  for (const r of todo) {
    const meta = (await drive.files.get({ fileId: r.fileId, fields: 'id,name,parents', supportsAllDrives: true })).data
    // Plano velho: se o arquivo mudou de nome desde a geração do plano, não mexe.
    if (meta.name !== r.currentName) { console.log(`PULADO (nome mudou no Drive): ${meta.name}`); continue }
    const target = await subfolder(r.personFolderId, r.proposedSubfolder)
    const newName = r.action === 'RENOMEAR' ? r.proposedName : meta.name
    console.log(`${r.action} ${meta.name}\n   -> ${r.proposedSubfolder}/${newName}`)
    if (dry) continue
    fs.appendFileSync('scratch/book_apply_undo.jsonl', JSON.stringify({ fileId: r.fileId, name: meta.name, parents: meta.parents, at: new Date().toISOString() }) + '\n')
    const alreadyThere = meta.parents?.length === 1 && meta.parents[0] === target
    await drive.files.update({
      fileId: r.fileId,
      supportsAllDrives: true,
      requestBody: { name: newName },
      ...(alreadyThere ? {} : { addParents: target, removeParents: (meta.parents ?? []).join(',') }),
    })
    done++
  }
  console.log(`[book-apply] ${done} arquivos alterados`)
}

main().catch(e => { console.error(e); process.exit(1) })
