import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { drive_v3, google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import {
  CensusCollaborator,
  CensusFile,
  analyzeCollaborator,
  summarize,
} from '../domain/services/DriveCensusAnalyzer.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const CONCURRENCY = 4

async function listChildren(
  drive: drive_v3.Drive,
  folderId: string
): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        'nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    out.push(...(res.data.files ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathSoFar: string[],
  files: CensusFile[],
  folders: string[][]
): Promise<void> {
  for (const e of await listChildren(drive, folderId)) {
    if (!e.id || !e.name) continue
    if (e.mimeType === FOLDER_MIME) {
      const p = [...pathSoFar, e.name]
      folders.push(p)
      await walk(drive, e.id, p, files, folders)
    } else {
      files.push({
        id: e.id,
        name: e.name,
        path: pathSoFar,
        mimeType: e.mimeType ?? '',
        size: e.size != null ? Number(e.size) : undefined,
        md5: e.md5Checksum ?? undefined,
        modifiedTime: e.modifiedTime ?? undefined,
      })
    }
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++])
    })
  )
}

async function main() {
  const roots = (process.env.HSE_DRIVE_FOLDER_ID ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (!roots.length) throw new Error('HSE_DRIVE_FOLDER_ID is not set')

  const refDate = new Date()
  const drive = google.drive({
    version: 'v3',
    auth: await getAuthorizedClient(),
  })
  const collaborators: CensusCollaborator[] = []

  for (const rootId of roots) {
    const meta = await drive.files.get({
      fileId: rootId,
      fields: 'name',
      supportsAllDrives: true,
    })
    const branch = meta.data.name ?? rootId
    const top = (await listChildren(drive, rootId)).filter(
      e => e.mimeType === FOLDER_MIME && e.id && e.name
    )
    console.log(`[census] ${branch}: ${top.length} top-level folders`)
    await pool(top, CONCURRENCY, async entry => {
      const files: CensusFile[] = []
      const folders: string[][] = []
      await walk(drive, entry.id as string, [], files, folders)
      collaborators.push({
        branch,
        name: entry.name as string,
        folderId: entry.id as string,
        files,
        folders,
      })
    })
  }

  const analyses = collaborators
    .map(c => analyzeCollaborator(c, refDate))
    .sort(
      (a, b) => a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name)
    )
  const summary = summarize(analyses, refDate)

  const outDir = path.join(process.cwd(), 'scratch', 'drive-census')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = refDate.toISOString().slice(0, 10)
  fs.writeFileSync(
    path.join(outDir, `census-${stamp}.json`),
    JSON.stringify({ summary, analyses }, null, 2)
  )
  console.log(JSON.stringify(summary, null, 2))
  console.log(
    `[census] written to ${path.join(outDir, `census-${stamp}.json`)}`
  )
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
