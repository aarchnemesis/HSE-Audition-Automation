import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

// Item 5 — relatório read-only dos arquivos SEM data no nome. Separa o que está CORRETO sem data
// (códigos permanentes/cadastrais) do que FALTA data (códigos datados: cursos, exames, contratos),
// e para esses últimos cruza com o cache de conteúdo para ver quantos dá para preencher já e quantos
// ainda precisam de extração (download+OCR). Não escreve nada no Drive.

// Códigos permanentes/cadastrais — sem data é o correto (alinhado ao runDriveFixSemData).
// Códigos permanentes/cadastrais/pessoais — sem data é o correto. Inclui 08 (CNH/passaporte/foto).
const PERMANENT_EXACT = new Set([
  '02',
  '03',
  '04',
  '05',
  '08',
  '10',
  '11',
  '23',
  '24',
  '30',
])
function isUndatedOk(code: string): boolean {
  // Contratos/eSocial 04.1/04.2 são datados; o resto das variantes cadastrais não.
  if (code === '04.1' || code === '04.2') return false
  return PERMANENT_EXACT.has(code) || /^(03|05|08|23|30)\./.test(code)
}

// Data no nome: aceita separadores . / - _ e não exige word-boundary (nome pode colar "_Nome").
// Exige dois separadores, então um código "04.1"/"5.2" não casa como data.
const DATE_IN_NAME = /\d{1,2}[._/-]\d{1,2}[._/-]\d{2,4}/
const SEM_DATA = /SEM[_\s]?DATA/i

function leadingCode(name: string): string | null {
  const m = name.match(/^(\d{1,2}(?:\.\d+)?)\s*[–-]/)
  if (!m) return null
  // Zero-pad da parte inteira: "5.2" -> "05.2", "8.1" -> "08.1".
  const [int, frac] = m[1].split('.')
  return frac ? `${int.padStart(2, '0')}.${frac}` : int.padStart(2, '0')
}
function cacheHasDate(entry: any): boolean {
  const raw = entry?.issueDate || entry?.expirationDate
  if (!raw) return false
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return false
  const y = d.getUTCFullYear()
  return y >= 1990 && y <= new Date().getUTCFullYear() + 10
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

type Bucket =
  | 'CORRETO_SEM_DATA'
  | 'FALTA_DATA_CACHE_OK'
  | 'FALTA_DATA_PRECISA_EXTRAIR'
  | 'SEM_CODIGO'

interface Row {
  branch: string
  fileId: string
  fileName: string
  code: string
  hasSemDataToken: boolean
  bucket: Bucket
}

async function walk(
  drive: any,
  id: string,
  branch: string,
  cache: Map<string, any>,
  rows: Row[]
) {
  for (const k of await listChildren(drive, id)) {
    if (isFolder(k)) {
      if (/obsolet/i.test(k.name)) continue
      await walk(drive, k.id, branch, cache, rows)
      continue
    }
    if (DATE_IN_NAME.test(k.name)) continue // já tem data
    const code = leadingCode(k.name)
    const hasSemDataToken = SEM_DATA.test(k.name)
    let bucket: Bucket
    if (!code) bucket = 'SEM_CODIGO'
    else if (isUndatedOk(code)) bucket = 'CORRETO_SEM_DATA'
    else
      bucket = cacheHasDate(cache.get(k.id))
        ? 'FALTA_DATA_CACHE_OK'
        : 'FALTA_DATA_PRECISA_EXTRAIR'
    rows.push({
      branch,
      fileId: k.id,
      fileName: k.name,
      code: code || '—',
      hasSemDataToken,
      bucket,
    })
  }
}

async function main() {
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
    const meta = await drive.files.get({
      fileId: root,
      fields: 'name',
      supportsAllDrives: true,
    })
    await walk(drive, root, meta.data.name || root, cache, rows)
  }

  const byBucket: Record<string, number> = {}
  for (const r of rows) byBucket[r.bucket] = (byBucket[r.bucket] || 0) + 1
  const needExtract = rows.filter(
    r => r.bucket === 'FALTA_DATA_PRECISA_EXTRAIR'
  )
  const extractByCode: Record<string, number> = {}
  for (const r of needExtract)
    extractByCode[r.code] = (extractByCode[r.code] || 0) + 1

  console.log('\n=== ITEM 5 — ARQUIVOS SEM DATA NO NOME (relatório) ===')
  console.log(`Total sem data no nome: ${rows.length}`)
  console.log(`  por bucket: ${JSON.stringify(byBucket, null, 0)}`)
  console.log(
    `\nFALTA_DATA que precisa extrair conteúdo, por código: ${JSON.stringify(extractByCode)}`
  )

  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'undated_report.json'),
    JSON.stringify(rows, null, 2),
    'utf8'
  )
  // lista de ids para extração (as que faltam data e não têm cache)
  fs.writeFileSync(
    path.join(process.cwd(), 'scratch', 'undated_need_extract.json'),
    JSON.stringify(
      needExtract.map(r => ({ fileId: r.fileId, fileName: r.fileName })),
      null,
      2
    ),
    'utf8'
  )

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sem data')
  ws.columns = [
    { header: 'Ramo', key: 'branch', width: 28 },
    { header: 'Arquivo', key: 'fileName', width: 60 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Token SEM_DATA', key: 'hasSemDataToken', width: 16 },
    { header: 'Bucket', key: 'bucket', width: 26 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const r of rows) ws.addRow(r)
  const xlsx = path.join(process.cwd(), 'scratch', 'undated_report.xlsx')
  await wb.xlsx.writeFile(xlsx)
  console.log(`\nRelatório: ${xlsx}`)
  console.log(
    'Listas: scratch/undated_report.json, scratch/undated_need_extract.json'
  )
}

main().catch(e => {
  console.error('[undated] Erro fatal:', e)
  process.exit(1)
})
