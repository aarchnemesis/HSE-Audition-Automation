import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

// Item 3 — conserta os placeholders "<code> – Doc <code> – ..." que sobraram da fase 1.
// Mantém o CÓDIGO inicial (load-bearing: o audit extrai o código do nome e o BRANCH_CODE_REMAP
// mapeia 04.1->40.1 na leitura — dropar o código quebraria o match) e troca só o TÍTULO
// placeholder "Doc 04.1" pelo nome canônico. Quando a data está "SEM_DATA" e o cache de conteúdo
// tem uma data sã, aproveita e preenche. Dry-run por padrão; --execute renomeia com undo log.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const PLACEHOLDER =
  /^(\d{1,2}(?:\.\d+)?)\s*[–-]\s*Doc\s+\d{1,2}(?:\.\d+)?\s*[–-]\s*(.*)$/i

// Título canônico por código (só 04.1 aparece hoje; fácil estender).
const CANONICAL_TITLE: Record<string, string> = {
  '04.1': 'Contrato de Trabalho CLT',
  '40.1': 'Contrato de Trabalho CLT',
}
// Códigos cuja data é vencimento direto (contratos) — não são permanentes.
const DATED = new Set(['04', '04.1', '40', '40.1'])

function cacheDate(entry: any): Date | null {
  const raw = entry?.expirationDate || entry?.issueDate
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  if (y > new Date().getUTCFullYear() + 10 || y < 1990) return null
  return d
}
function fmt(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getUTCFullYear()}`
}

async function listChildren(drive: any, parentId: string): Promise<any[]> {
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

interface Fix {
  fileId: string
  oldName: string
  newName: string
  dateFilled: boolean
}

async function walk(
  drive: any,
  id: string,
  cache: Map<string, any>,
  fixes: Fix[],
  skipped: string[]
) {
  for (const k of await listChildren(drive, id)) {
    if (isFolder(k)) {
      if (/obsolet/i.test(k.name)) continue
      await walk(drive, k.id, cache, fixes, skipped)
      continue
    }
    const m = k.name.match(PLACEHOLDER)
    if (!m) continue
    const code = m[1]
    const rest = m[2] // "SEM_DATA - NAME.pdf" ou "13.10.2026 - NAME.pdf"
    const title = CANONICAL_TITLE[code]
    if (!title) {
      skipped.push(`${k.name} (sem título canônico p/ código ${code})`)
      continue
    }
    let dateFilled = false
    let restFixed = rest
    if (/^SEM[_\s]?DATA\b/i.test(rest) && DATED.has(code)) {
      const d = cacheDate(cache.get(k.id))
      if (d) {
        restFixed = rest.replace(/^SEM[_\s]?DATA/i, fmt(d))
        dateFilled = true
      }
    }
    const newName = `${code} – ${title} – ${restFixed}`
    if (newName !== k.name)
      fixes.push({ fileId: k.id, oldName: k.name, newName, dateFilled })
  }
}

async function main() {
  const execute =
    process.argv.includes('--execute') || process.argv.includes('--run')
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

  const fixes: Fix[] = []
  const skipped: string[] = []
  for (const root of roots) await walk(drive, root, cache, fixes, skipped)

  console.log(
    `\n=== FIX "Doc <code>" (${execute ? 'EXECUÇÃO' : 'SIMULAÇÃO'}) ===`
  )
  console.log(`placeholders a corrigir: ${fixes.length}`)
  console.log(
    `  dos quais com data preenchida do cache: ${fixes.filter(f => f.dateFilled).length}`
  )
  console.log(`sem título canônico (ignorados): ${skipped.length}`)
  fixes
    .slice(0, 10)
    .forEach(f => console.log(`  ${f.oldName}\n    -> ${f.newName}`))
  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'doc041_fix_plan.json'),
    JSON.stringify({ fixes, skipped }, null, 2),
    'utf8'
  )

  if (!execute) {
    console.log('\n[doc041] SIMULAÇÃO — nada renomeado. Rode com --execute.')
    return
  }

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
  for (const f of fixes) {
    try {
      await drive.files.update({
        fileId: f.fileId,
        requestBody: { name: f.newName },
        fields: 'id, name',
        supportsAllDrives: true,
      })
      undo.push({
        fileId: f.fileId,
        previousName: f.oldName,
        renamedTo: f.newName,
        action: 'FIX_DOC_PLACEHOLDER',
        timestamp: new Date().toISOString(),
      })
      ok++
      await sleep(150)
    } catch (e) {
      err++
      console.error(`   ERRO ${f.oldName}: ${(e as Error).message}`)
    }
  }
  fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(`\n[doc041] Renomeados ${ok} | erros ${err} | undo: ${undoPath}`)
}

main().catch(e => {
  console.error('[doc041] Erro fatal:', e)
  process.exit(1)
})
