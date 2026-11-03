/**
 * Status of a document as reported by a client's contractor-compliance portal (TDoc, Veriduss,
 * Surisoft, eGestiona...). Every portal speaks its own dialect; normalizers map them here.
 * EXPIRING and EXPIRED are derived from `expiresOn` against the report date, not trusted from
 * the portal, so a snapshot taken last week still reads correctly today.
 */
export type PortalDocStatus =
  | 'APPROVED'
  | 'EXPIRING'
  | 'EXPIRED'
  | 'IN_REVIEW'
  | 'MISSING'
  | 'REJECTED'
  | 'WAIVED'

export interface PortalDocument {
  title: string
  status: PortalDocStatus
  /** YYYY-MM-DD */
  expiresOn?: string
  /** Rejection reason or reviewer remark shown by the portal */
  note?: string
  required: boolean
}

export interface PortalWorker {
  name: string
  role?: string
  /**
   * Client key (see clientKey()) when the portal serves several clients and tells them apart
   * per worker, as Surisoft does for Serena and GE. Absent means every client of the portal.
   */
  client?: string
  /** Contract, site or task label as shown by the portal */
  contract?: string
  documents: PortalDocument[]
}

export interface PortalCensus {
  portalId: string
  /** ISO timestamp of the extraction */
  capturedAt: string
  workers: PortalWorker[]
}
