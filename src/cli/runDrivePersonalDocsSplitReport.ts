import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { buildStandardNameForRemainingFile } from './standardizeRemainingDriveFiles.js'

// FASE 2 — relatório read-only do split documentação pessoal x treinamento.
//
// A fase 1 copiou os arquivos da 2ª fonte para a RAIZ de cada colaborador no SSOT. Muitos
// documentos pessoais (CNH, passaporte, cartão de vacina, CTPS, RG, ...) ficaram soltos na raiz
// ou dentro de "02. Treinamentos", quando o padrão do Drive é mantê-los em "01. Documentos
// Pessoais". Este tool varre o SSOT, classifica cada arquivo e PROPÕE (sem escrever nada) para
// onde o pessoal deveria ir — criando o destino só quando a pasta não existe. Nada é movido aqui.

type FolderType =
  | 'RAIZ'
  | 'PESSOAIS'
  | 'TREINAMENTOS'
  | 'OBSOLETO'
  | 'OUTROS'
  | 'SUB'
type Klass = 'PESSOAL' | 'TREINAMENTO' | 'AMBIGUO' | 'OUTRO'

// Documentos cadastrais/pessoais (ficam em "01. Documentos Pessoais").
const PERSONAL_CODES = new Set(['03', '04', '05', '07', '08', '23', '24', '40'])
// Cursos/certificações (ficam em "02. Treinamentos").
const TRAINING_CODES = new Set([
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
])
// Zona cinzenta — decisão do João antes de mover.
const AMBIGUOUS_CODES = new Set(['01', '02', '06'])

// Nome canônico de documento civil sem código (saída do classificador => é pessoal).
const CIVIL_NAME =
  /^(Passaporte|Cart[ãa]o SUS|RG|CPF|RG e CPF|RG, CPF|T[íi]tulo de Eleitor|Certid[ãa]o|Comprovante de Resid[êe]ncia|CNH|Reservista|PIS|Carteira)/i

function leadingCode(name: string): string | null {
  const m = name.match(/^(\d{1,2}(?:\.\d+)?)\s*[–-]/)
  if (!m) return null
  // Normaliza 04.1 -> 04 só para a bucketização de categoria.
  return m[1].split('.')[0].padStart(2, '0')
}

function folderTypeOf(name: string, isCollabRoot: boolean): FolderType {
  if (isCollabRoot) return 'RAIZ'
  if (/documentos?\s*pessoa/i.test(name)) return 'PESSOAIS'
  if (/treinament/i.test(name)) return 'TREINAMENTOS'
  if (/obsolet/i.test(name)) return 'OBSOLETO'
  if (/outros/i.test(name)) return 'OUTROS'
  return 'SUB'
}

const COLLAB_SKIP = /^00\.|obsolet|outros|desligad|inativ|editav|^x$|^z$|geral/i

async function listChildren(drive: any, parentId: string) {
  const out: any[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    out.push(...(res.data.files || []))
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  return out
}

const isFolder = (f: any) => f.mimeType === 'application/vnd.google-apps.folder'

interface Row {
  branch: string
  collab: string
  collabFolderId: string
  fileId: string
  fileName: string
  code: string
  klass: Klass
  currentFolderType: FolderType
  currentFolderName: string
  currentParentId: string // real parent folder of the file (for removeParents)
  targetFolderId: string | null // existing "Documentos Pessoais"
  targetAction: 'MOVER' | 'MOVER+CRIAR_PASTA' | 'OK' | 'IGNORAR'
}

function classify(
  fileId: string,
  fileName: string,
  collab: string,
  cache: Map<string, any>
): { code: string; klass: Klass } {
  const code = leadingCode(fileName)
  if (code) {
    if (PERSONAL_CODES.has(code)) return { code, klass: 'PESSOAL' }
    if (AMBIGUOUS_CODES.has(code)) return { code, klass: 'AMBIGUO' }
    if (TRAINING_CODES.has(code)) return { code, klass: 'TREINAMENTO' }
    return { code, klass: 'OUTRO' }
  }
  // Sem código: usa o classificador de nome para ver se é documento civil.
  const res = buildStandardNameForRemainingFile(fileId, fileName, collab, cache)
  if (res && CIVIL_NAME.test(res.newName))
    return { code: '—', klass: 'PESSOAL' }
  return { code: '—', klass: 'OUTRO' }
}

async function walkCollab(
  drive: any,
  branch: string,
  collabFolder: any,
  cache: Map<string, any>,
  rows: Row[]
) {
  const children = await listChildren(drive, collabFolder.id)
  const subFolders = children.filter(isFolder)
  const pessoaisFolder = subFolders.find(f =>
    /documentos?\s*pessoa/i.test(f.name)
  )

  // BFS sobre o colaborador, guardando a pasta pai de cada arquivo.
  const queue: Array<{ folder: any; isRoot: boolean }> = [
    { folder: collabFolder, isRoot: true },
  ]
  const seen = new Set<string>()
  while (queue.length) {
    const { folder, isRoot } = queue.shift()!
    if (seen.has(folder.id)) continue
    seen.add(folder.id)
    const kids = isRoot ? children : await listChildren(drive, folder.id)
    const ft = folderTypeOf(folder.name, isRoot)
    for (const k of kids) {
      if (isFolder(k)) {
        // Não desce em obsoletos.
        if (/obsolet/i.test(k.name)) continue
        queue.push({ folder: k, isRoot: false })
        continue
      }
      const { code, klass } = classify(k.id, k.name, collabFolder.name, cache)
      let targetAction: Row['targetAction'] = 'IGNORAR'
      if (klass === 'PESSOAL') {
        if (ft === 'PESSOAIS') targetAction = 'OK'
        else if (ft === 'OBSOLETO') targetAction = 'IGNORAR'
        else targetAction = pessoaisFolder ? 'MOVER' : 'MOVER+CRIAR_PASTA'
      }
      rows.push({
        branch,
        collab: collabFolder.name,
        collabFolderId: collabFolder.id,
        fileId: k.id,
        fileName: k.name,
        code,
        klass,
        currentFolderType: ft,
        currentFolderName: isRoot ? '(raiz)' : folder.name,
        currentParentId: folder.id,
        targetFolderId: pessoaisFolder?.id || null,
        targetAction,
      })
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const CANONICAL_PESSOAIS_NAME = '01. Documentos Pessoais'

async function main() {
  const execute =
    process.argv.includes('--execute') || process.argv.includes('--run')
  // Decisão do João: ASO (01) conta como documento pessoal; 02 e 06 ficam.
  const asoPersonal =
    process.argv.includes('--aso-personal') ||
    !process.argv.includes('--no-aso')
  if (asoPersonal) {
    PERSONAL_CODES.add('01')
    AMBIGUOUS_CODES.delete('01')
  }
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? Number.parseInt(delayArg, 10) : 150

  const roots = (process.env.HSE_DRIVE_FOLDER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const cacheArr = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'data', 'pdf_content_cache.json'),
      'utf8'
    )
  )
  const cache = new Map<string, any>(cacheArr.map((e: any) => [e.fileId, e]))
  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })

  const rows: Row[] = []
  for (const root of roots) {
    const rootMeta = await drive.files.get({
      fileId: root,
      fields: 'name',
      supportsAllDrives: true,
    })
    const branch = rootMeta.data.name || root
    const collabs = (await listChildren(drive, root)).filter(
      f => isFolder(f) && !COLLAB_SKIP.test(f.name)
    )
    for (const c of collabs) {
      await walkCollab(drive, branch, c, cache, rows)
    }
    console.log(`  varrido ramo "${branch}" (${collabs.length} colabs)`)
  }

  const toMove = rows.filter(
    r => r.targetAction === 'MOVER' || r.targetAction === 'MOVER+CRIAR_PASTA'
  )
  const ambiguous = rows.filter(r => r.klass === 'AMBIGUO')
  const okAlready = rows.filter(r => r.targetAction === 'OK')

  // Resumo por classe e por código.
  const byClass: Record<string, number> = {}
  for (const r of rows) byClass[r.klass] = (byClass[r.klass] || 0) + 1
  const moveByCode: Record<string, number> = {}
  for (const r of toMove) moveByCode[r.code] = (moveByCode[r.code] || 0) + 1

  console.log(
    '\n=== FASE 2 — SPLIT PESSOAL x TREINAMENTO (relatório, nada movido) ==='
  )
  console.log(`Arquivos analisados: ${rows.length}`)
  console.log(`  por classe: ${JSON.stringify(byClass)}`)
  console.log(`\nPESSOAL a mover para "Documentos Pessoais": ${toMove.length}`)
  console.log(
    `  (dos quais exigem CRIAR a pasta: ${toMove.filter(r => r.targetAction === 'MOVER+CRIAR_PASTA').length})`
  )
  console.log(`  por código: ${JSON.stringify(moveByCode)}`)
  console.log(`PESSOAL já no lugar certo: ${okAlready.length}`)
  console.log(
    `AMBÍGUOS (01 ASO / 02 OS / 06 EPI) — decidir: ${ambiguous.length}`
  )

  // Excel.
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Split Pessoal')
  ws.columns = [
    { header: 'Ramo', key: 'branch', width: 30 },
    { header: 'Colaborador', key: 'collab', width: 38 },
    { header: 'Arquivo', key: 'fileName', width: 55 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Classe', key: 'klass', width: 13 },
    { header: 'Pasta atual', key: 'currentFolderType', width: 14 },
    { header: 'Ação', key: 'targetAction', width: 18 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const r of rows) {
    const row = ws.addRow(r)
    if (r.targetAction.startsWith('MOVER'))
      row.getCell('targetAction').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD4EDDA' },
      }
    if (r.klass === 'AMBIGUO')
      row.getCell('klass').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF3CD' },
      }
  }
  const xlsx = path.join(
    process.cwd(),
    'scratch',
    'split_pessoal_treinamento.xlsx'
  )
  await wb.xlsx.writeFile(xlsx)

  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'split_pessoal_plan.json'),
    JSON.stringify({ toMove, ambiguous }, null, 2),
    'utf8'
  )
  console.log(`\nRelatório: ${xlsx}`)
  console.log('Plano: scratch/split_pessoal_plan.json')

  if (!execute) {
    console.log(
      '\n[split] SIMULAÇÃO — nada movido. Revise o Excel e rode com --execute.'
    )
    return
  }

  // === EXECUÇÃO: move cada pessoal fora do lugar para "01. Documentos Pessoais" ===
  const limitArg = process.argv
    .find(a => a.startsWith('--limit='))
    ?.split('=')[1]
  const limit = limitArg
    ? Number.parseInt(limitArg, 10)
    : Number.POSITIVE_INFINITY
  const branchArg = process.argv
    .find(a => a.startsWith('--branch='))
    ?.split('=')[1]

  const undoPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )
  const undo = fs.existsSync(undoPath)
    ? JSON.parse(fs.readFileSync(undoPath, 'utf8'))
    : []

  // Pasta "Documentos Pessoais" por colaborador, criada sob demanda e reaproveitada.
  const pessoaisByCollab = new Map<string, string>()
  for (const r of toMove) {
    if (r.targetFolderId)
      pessoaisByCollab.set(r.collabFolderId, r.targetFolderId)
  }

  const queue = toMove.filter(r => !branchArg || r.branch.startsWith(branchArg))
  console.log(
    `\n[split] EXECUÇÃO — ${Math.min(queue.length, limit)} movimentação(ões)` +
      `${branchArg ? ` (ramo ${branchArg})` : ''}`
  )

  let ok = 0
  let created = 0
  let err = 0
  let done = 0
  for (const r of queue) {
    if (done >= limit) break
    done++
    try {
      // Garante a pasta destino.
      let targetId = pessoaisByCollab.get(r.collabFolderId)
      if (!targetId) {
        const createdFolder = await drive.files.create({
          requestBody: {
            name: CANONICAL_PESSOAIS_NAME,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [r.collabFolderId],
          },
          fields: 'id',
          supportsAllDrives: true,
        })
        targetId = createdFolder.data.id as string
        pessoaisByCollab.set(r.collabFolderId, targetId)
        created++
      }
      // Já está no destino? (segurança)
      if (r.currentParentId === targetId) continue
      await drive.files.update({
        fileId: r.fileId,
        addParents: targetId,
        removeParents: r.currentParentId,
        fields: 'id, parents',
        supportsAllDrives: true,
      })
      undo.push({
        fileId: r.fileId,
        collaborator: r.collab,
        movedFrom: r.currentParentId,
        movedTo: targetId,
        fileName: r.fileName,
        action: 'MOVE_TO_PESSOAIS',
        timestamp: new Date().toISOString(),
      })
      ok++
      await sleep(delayMs)
    } catch (e) {
      err++
      console.error(`   ERRO ${r.fileName}: ${(e as Error).message}`)
    }
  }
  fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(
    `\n[split] Movidos ${ok} | pastas criadas ${created} | erros ${err} | undo: ${undoPath}`
  )
}

main().catch(e => {
  console.error('[split] Erro fatal:', e)
  process.exit(1)
})
