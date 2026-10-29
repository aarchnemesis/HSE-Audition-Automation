import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { scanBranch } from '../adapters/drive/DriveTreeScanner.js'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

// Fixes SSOT files whose name still carries "– SEM_DATA –".
//   - Permanent/cadastral codes (02,03,04,05,10,11,23,24,30 and their 03.x/05.x variants) have no
//     calendar validity, so the SEM_DATA token is simply removed.
//   - Every other code (contracts 40/40.1/04.1, drone 24.1, courses, ...) gets its real ISSUE date
//     from the content cache, swapped in place of the token. A date whose year is beyond
//     currentYear+10 is rejected as the 50-year "permanent" proxy and the file is left untouched.
// The original extension is preserved (a .zip stays a .zip). Read-only until --execute; undo logged.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const SEM_DATA = /SEM[_\s]?DATA/i

// Permanent / event-triggered codes: the date in the name is meaningless, so drop SEM_DATA.
const PERMANENT_EXACT = new Set([
  '02',
  '03',
  '04',
  '05',
  '10',
  '11',
  '23',
  '24',
  '30',
])

function leadingCode(name: string): string | null {
  const m = name.match(/^(\d{1,2}(?:\.\d+)?)\s*[–-]/)
  return m ? m[1] : null
}

function isPermanent(code: string): boolean {
  // 04.1 is a dated contract addendum and 24.1 is a dated drone inspection — not permanent. Only the
  // registry cards (03.x, 05.x) and WINDA (30.x) sub-codes are permanent beyond the exact list.
  if (code === '04.1') return false
  return PERMANENT_EXACT.has(code) || /^(03|05|30)\./.test(code)
}

function cacheDate(entry: any): Date | null {
  const raw = entry?.issueDate || entry?.expirationDate
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  // Reject the 50-year permanent proxy (and any absurd far-future date).
  if (d.getUTCFullYear() > new Date().getUTCFullYear() + 10) return null
  if (d.getUTCFullYear() < 1990) return null
  return d
}

function formatDateDots(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${d.getUTCFullYear()}`
}

/** Remove the "– SEM_DATA" segment, keeping the "- NAME" tail. */
function stripSemData(name: string): string {
  return name.replace(/\s*[–-]\s*SEM[_\s]?DATA\s*([–-]\s)/i, ' $1')
}

interface FixItem {
  fileId: string
  collab: string
  folderId: string
  oldName: string
  newName: string
  kind: 'DATE_FILLED' | 'SEMDATA_REMOVED'
}

async function main() {
  const execute =
    process.argv.includes('--execute') || process.argv.includes('--run')
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 150

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

  const fixes: FixItem[] = []
  const noSolution: Array<{ collab: string; oldName: string; why: string }> = []
  let semDataTotal = 0

  for (const root of roots) {
    const collabs = await scanBranch(drive, root)
    for (const c of collabs) {
      for (const d of c.docs) {
        if (!SEM_DATA.test(d.fileName)) continue
        semDataTotal++
        const code = leadingCode(d.fileName)

        if (code && isPermanent(code)) {
          const newName = stripSemData(d.fileName)
          if (newName !== d.fileName)
            fixes.push({
              fileId: d.fileId,
              collab: c.name,
              folderId: d.parentFolderId,
              oldName: d.fileName,
              newName,
              kind: 'SEMDATA_REMOVED',
            })
          continue
        }

        const date = cacheDate(cache.get(d.fileId))
        if (!date) {
          noSolution.push({
            collab: c.name,
            oldName: d.fileName,
            why: code ? 'sem data real no cache' : 'sem código no nome',
          })
          continue
        }
        const newName = d.fileName.replace(SEM_DATA, formatDateDots(date))
        fixes.push({
          fileId: d.fileId,
          collab: c.name,
          folderId: d.parentFolderId,
          oldName: d.fileName,
          newName,
          kind: 'DATE_FILLED',
        })
      }
    }
  }

  const dateFilled = fixes.filter(f => f.kind === 'DATE_FILLED').length
  const removed = fixes.filter(f => f.kind === 'SEMDATA_REMOVED').length
  console.log(`\n=== SEM_DATA fix (${execute ? 'EXECUÇÃO' : 'SIMULAÇÃO'}) ===`)
  console.log(`SEM_DATA no nome: ${semDataTotal}`)
  console.log(
    `  a corrigir: ${fixes.length} (data preenchida ${dateFilled} | SEM_DATA removido ${removed})`
  )
  console.log(`  sem solução: ${noSolution.length}`)

  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'semdata_fix_plan.json'),
    JSON.stringify({ fixes, noSolution }, null, 2),
    'utf8'
  )
  console.log('\n--- amostra DATE_FILLED ---')
  fixes
    .filter(f => f.kind === 'DATE_FILLED')
    .slice(0, 12)
    .forEach(f => console.log(`  ${f.oldName}\n    -> ${f.newName}`))
  console.log('\n--- amostra SEMDATA_REMOVED ---')
  fixes
    .filter(f => f.kind === 'SEMDATA_REMOVED')
    .slice(0, 6)
    .forEach(f => console.log(`  ${f.oldName}\n    -> ${f.newName}`))

  if (!execute) {
    console.log(
      '\n[SEM_DATA] SIMULAÇÃO — nada renomeado. Revise scratch/semdata_fix_plan.json e rode com --execute.'
    )
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
        collaborator: f.collab,
        previousName: f.oldName,
        renamedTo: f.newName,
        timestamp: new Date().toISOString(),
      })
      ok++
      await sleep(delayMs)
    } catch (e) {
      err++
      console.error(`   ERRO ${f.oldName}: ${(e as Error).message}`)
    }
  }
  fs.writeFileSync(undoPath, JSON.stringify(undo, null, 2), 'utf8')
  console.log(
    `\n[SEM_DATA] Renomeados ${ok} | erros ${err} | undo: ${undoPath}`
  )
}

main().catch(err => {
  console.error('[SEM_DATA] Erro fatal:', err)
  process.exit(1)
})
