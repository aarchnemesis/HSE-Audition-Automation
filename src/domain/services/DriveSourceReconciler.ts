import { DriveNomenclatureStandardizer } from './DriveNomenclatureStandardizer.js'

// Reconciles the current SSOT Drive (what the dashboard reads) against a second source where the
// team has been updating documents. Pure and deterministic: it takes two already-scanned branch
// trees (filename-level, no network) and decides, per collaborator and document code, what must be
// copied or refreshed into the SSOT so the dashboard stops reporting false "missing"/"expired".
//
// Direction is fixed for phase 1 (confirmed with the user 2026-10-28): second source -> SSOT. The
// SSOT keeps being the folder the automation reads; the second source only feeds it.

/** One file as seen by the lightweight scanner (filename-level, no PDF download). */
export interface ScannedDoc {
  fileId: string
  fileName: string
  /** Immediate parent folder id — where the file physically lives. */
  parentFolderId: string
  /** Document code parsed from the filename, or null when unclassifiable. */
  code: string | null
  /** Issue/validity date parsed from the filename as ISO, or null. */
  dateIso: string | null
  modifiedTime?: string
}

export interface ScannedCollaborator {
  /** Normalized match key (name only, accent/role stripped, uppercased). */
  key: string
  /** Original folder display name (kept for the canonical filename and logs). */
  name: string
  /** Collaborator folder id on this side (undefined on the SSOT side when the person is new). */
  folderId?: string
  docs: ScannedDoc[]
}

export type ReconKind =
  | 'COPY_MISSING' // code exists in source2, absent in the SSOT
  | 'UPDATE_NEWER' // code in both, source2 is newer -> refresh, old goes to Obsoletos
  | 'NEW_COLLAB' // whole collaborator missing from the SSOT
  | 'UNCLASSIFIED' // source2 file whose code could not be parsed -> manual
  | 'OK' // SSOT already equal or newer; nothing to do

export interface ReconAction {
  kind: ReconKind
  collabKey: string
  collabName: string
  code: string | null
  // Source (second source) file that would be copied:
  src2FileId?: string
  src2FileName?: string
  src2DateIso?: string | null
  // SSOT side (the target / the superseded original):
  ssotCollabFolderId?: string
  ssotFileId?: string
  ssotFileName?: string
  ssotDateIso?: string | null
  /** Canonical name the copied file should carry inside the SSOT. */
  proposedName?: string
  /** True when the SSOT has no folder for this person yet (create under the branch root). */
  needsFolderCreation?: boolean
}

export interface ReconSummary {
  copyMissing: number
  updateNewer: number
  newCollab: number
  unclassified: number
  ok: number
}

export interface ReconResult {
  actions: ReconAction[]
  summary: ReconSummary
}

function timeOf(dateIso: string | null | undefined): number {
  if (!dateIso) return 0
  const t = new Date(dateIso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Pick the most recent dated document for a code (date desc; a dated file beats an undated one). */
function latestByCode(docs: ScannedDoc[]): Map<string, ScannedDoc> {
  const best = new Map<string, ScannedDoc>()
  for (const d of docs) {
    if (!d.code) continue
    const prev = best.get(d.code)
    if (!prev || timeOf(d.dateIso) > timeOf(prev.dateIso)) best.set(d.code, d)
  }
  return best
}

function proposedNameFor(doc: ScannedDoc, collabName: string): string {
  return DriveNomenclatureStandardizer.buildStandardFilename({
    code: doc.code as string,
    collaboratorName: collabName,
    date: doc.dateIso ? new Date(doc.dateIso) : null,
    originalFilename: doc.fileName,
  })
}

/**
 * Builds the reconciliation plan for ONE branch (e.g. "01 - Inspetores"). Codes are compared raw,
 * side against side within the same branch — both trees use that branch's own numbering, so no
 * remap is applied here.
 */
export function reconcileBranch(
  ssotCollabs: ScannedCollaborator[],
  src2Collabs: ScannedCollaborator[],
  branchRootId: string
): ReconResult {
  const ssotByKey = new Map(ssotCollabs.map(c => [c.key, c]))
  const actions: ReconAction[] = []
  const summary: ReconSummary = {
    copyMissing: 0,
    updateNewer: 0,
    newCollab: 0,
    unclassified: 0,
    ok: 0,
  }

  for (const src2 of src2Collabs) {
    const ssot = ssotByKey.get(src2.key)
    const src2Best = latestByCode(src2.docs)

    // Unclassifiable source files (code null) are surfaced once per collaborator for manual review.
    for (const d of src2.docs) {
      if (!d.code) {
        summary.unclassified++
        actions.push({
          kind: 'UNCLASSIFIED',
          collabKey: src2.key,
          collabName: src2.name,
          code: null,
          src2FileId: d.fileId,
          src2FileName: d.fileName,
          src2DateIso: d.dateIso,
        })
      }
    }

    const isNewCollab = !ssot
    const ssotBest = ssot
      ? latestByCode(ssot.docs)
      : new Map<string, ScannedDoc>()

    for (const [code, srcDoc] of src2Best) {
      const proposedName = proposedNameFor(srcDoc, src2.name)
      const base: ReconAction = {
        kind: 'OK',
        collabKey: src2.key,
        collabName: src2.name,
        code,
        src2FileId: srcDoc.fileId,
        src2FileName: srcDoc.fileName,
        src2DateIso: srcDoc.dateIso,
        ssotCollabFolderId: ssot?.folderId ?? branchRootId,
        proposedName,
      }

      if (isNewCollab) {
        summary.newCollab++
        actions.push({ ...base, kind: 'NEW_COLLAB', needsFolderCreation: true })
        continue
      }

      const ssotDoc = ssotBest.get(code)
      if (!ssotDoc) {
        summary.copyMissing++
        actions.push({ ...base, kind: 'COPY_MISSING' })
        continue
      }

      base.ssotFileId = ssotDoc.fileId
      base.ssotFileName = ssotDoc.fileName
      base.ssotDateIso = ssotDoc.dateIso

      if (timeOf(srcDoc.dateIso) > timeOf(ssotDoc.dateIso)) {
        summary.updateNewer++
        actions.push({ ...base, kind: 'UPDATE_NEWER' })
      } else {
        summary.ok++
        actions.push(base)
      }
    }
  }

  return { actions, summary }
}

/** Normalizes a collaborator folder name to a match key: name before the first dash, no accents. */
export function collaboratorKey(folderName: string): string {
  return folderName
    .split(/[-–—_]/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}
