import { drive_v3 } from 'googleapis'
import {
  ScannedCollaborator,
  ScannedDoc,
  collaboratorKey,
} from '../../domain/services/DriveSourceReconciler.js'
import {
  parseDateFromFilename,
  parseDocCode,
} from './certificateFilenameParser.js'

// Lightweight, filename-level walk of a Drive branch (no PDF download, no OCR). Fast enough to diff
// hundreds of collaborator folders. Works on both My Drive and shared drives.

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Folders that never hold the current valid document — skipped while walking a collaborator. */
const SKIP_SUBFOLDER = /obsolet|obesoleto|0bsoleto|^00\.|outros/i

/** Top-level entries under a branch that are not real collaborators. */
const SKIP_COLLAB =
  /obsolet|desligad|inativ|editav|^x\b|^xx\b|^xz\b|^z\b|^zz\b|^geral\b/i

async function listChildren(
  drive: drive_v3.Drive,
  folderId: string
): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    files.push(...(res.data.files || []))
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  return files
}

async function walkFiles(
  drive: drive_v3.Drive,
  folderId: string,
  acc: drive_v3.Schema$File[]
): Promise<void> {
  for (const entry of await listChildren(drive, folderId)) {
    if (!entry.name || !entry.id) continue
    if (entry.mimeType === FOLDER_MIME) {
      if (SKIP_SUBFOLDER.test(entry.name.trim())) continue
      await walkFiles(drive, entry.id, acc)
    } else {
      acc.push(entry)
    }
  }
}

function toDoc(file: drive_v3.Schema$File, parentFolderId: string): ScannedDoc {
  const name = file.name as string
  const date = parseDateFromFilename(name)
  return {
    fileId: file.id as string,
    fileName: name,
    parentFolderId,
    code: parseDocCode(name),
    dateIso: date ? date.toISOString() : null,
    modifiedTime: file.modifiedTime || undefined,
  }
}

/**
 * Scans one branch root (whose direct children are collaborator folders) and returns a
 * ScannedCollaborator per real person. Files are read by name only.
 */
export async function scanBranch(
  drive: drive_v3.Drive,
  branchRootId: string
): Promise<ScannedCollaborator[]> {
  const top = await listChildren(drive, branchRootId)
  const collaborators: ScannedCollaborator[] = []

  for (const entry of top) {
    if (entry.mimeType !== FOLDER_MIME || !entry.id || !entry.name) continue
    if (SKIP_COLLAB.test(entry.name.trim())) continue

    const files: drive_v3.Schema$File[] = []
    await walkFiles(drive, entry.id, files)

    collaborators.push({
      key: collaboratorKey(entry.name),
      name: entry.name,
      folderId: entry.id,
      docs: files.map(f => toDoc(f, entry.id as string)),
    })
  }

  return collaborators
}

/**
 * Lists the branch sub-folders directly under a source root, keyed by their leading "NN" prefix
 * (01, 02, 03, 04, …). Used to pair the second source's branches with the SSOT roots.
 */
export async function resolveBranchFolders(
  drive: drive_v3.Drive,
  rootId: string
): Promise<Map<string, { id: string; name: string }>> {
  const byPrefix = new Map<string, { id: string; name: string }>()
  for (const entry of await listChildren(drive, rootId)) {
    if (entry.mimeType !== FOLDER_MIME || !entry.id || !entry.name) continue
    const m = entry.name.match(/^(\d{2})\s*-/)
    if (m) byPrefix.set(m[1], { id: entry.id, name: entry.name })
  }
  return byPrefix
}
