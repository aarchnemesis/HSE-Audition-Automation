import {
  PortalCensus,
  PortalDocStatus,
  PortalDocument,
  PortalWorker,
} from '../../domain/models/PortalCensus.js'
import { parsePortalDate } from './LegacyCensusNormalizers.js'

// Veriduss (goldwind.veriduss.com.br) is a Strapi + Next.js app with a clean JSON API. One
// authenticated session (cookie) is enough; the document feed is fully REST and paginated, so
// this adapter talks HTTP directly instead of scraping. Endpoints confirmed from captured
// traffic on 2026-10-26:
//   GET /api/me/companies                         -> companies the account can see
//   GET /api/documents?filters[company][id][$eq]=<id>&populate[docTypeObject]=*
//       &populate[approvals]=*&pagination[page]=<n>&pagination[pageSize]=100
//                                                 -> paginated documents (entityType 'member' = worker)

export const DEFAULT_VERIDUSS_BASE_URL = 'https://goldwind.veriduss.com.br'

export interface VeridussApproval {
  status?: string
  comments?: string
}

export interface VeridussDocument {
  id?: number
  title?: string
  status?: string
  expiresAt?: string | null
  entityType?: string
  memberName?: string
  required?: boolean
  mandatory?: boolean
  description?: string | null
  metadata?: { role?: string; position?: string; funcao?: string } | null
  docTypeObject?: { name?: string } | null
  approvals?: VeridussApproval[]
  company?: { id?: number; name?: string } | null
  /** Not confirmed against the live API: the UI marks workers 'Inativo'; tolerate the likely shapes. */
  memberActive?: boolean
  memberStatus?: string
  member?: { active?: boolean; status?: string } | null
}

export interface VeridussMember {
  id: number
  name?: string
  status?: string
  cpf?: string | null
  jobTitle?: string | null
}

export interface VeridussRequiredItem {
  docType?: { name?: string }
  canonicalStatus?: string
  document?: {
    expiresAt?: string | null
    latestRejection?: { comments?: string } | null
    approvals?: VeridussApproval[]
  } | null
}

export interface VeridussCompany {
  id: number
  name?: string
}

const STATUS_MAP: Record<string, PortalDocStatus> = {
  approved: 'APPROVED',
  rejected: 'REJECTED',
  submitted: 'IN_REVIEW',
  in_review: 'IN_REVIEW',
  in_approval: 'IN_REVIEW',
  pending_review: 'IN_REVIEW',
  pending_approval: 'IN_REVIEW',
  waived: 'WAIVED',
  exempt: 'WAIVED',
  expired: 'EXPIRED',
  overdue: 'EXPIRED',
  expiring: 'APPROVED', // 'A vencer' in the UI: still valid, EXPIRING is derived from the date
  expiring_soon: 'APPROVED',
  to_expire: 'APPROVED',
  dispensed: 'WAIVED',
}

function docStatus(raw?: string): PortalDocStatus {
  return STATUS_MAP[(raw ?? '').toLowerCase()] ?? 'MISSING'
}

function rejectionNote(doc: VeridussDocument): string | undefined {
  const fromApproval = doc.approvals?.find(a =>
    /reject/i.test(a.status ?? '')
  )?.comments
  const note = (fromApproval ?? doc.description ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return note || undefined
}

function toDocument(doc: VeridussDocument): PortalDocument {
  const status = docStatus(doc.status)
  return {
    title: (doc.title ?? doc.docTypeObject?.name ?? 'Documento').trim(),
    status,
    // EXPIRING/EXPIRED stay derived from the date by the report builder, not baked here.
    expiresOn: parsePortalDate(doc.expiresAt),
    note: status === 'REJECTED' ? rejectionNote(doc) : undefined,
    required: doc.required ?? doc.mandatory ?? true,
  }
}

/** Inactive members are not billed/required by the portal ("Cobrança documental suspensa"). */
function isInactiveMember(doc: VeridussDocument): boolean {
  if (doc.memberActive === false || doc.member?.active === false) return true
  return /inativ|inactive/i.test(doc.memberStatus ?? doc.member?.status ?? '')
}

/** Pure: Strapi member documents -> a PortalCensus. Drops non-member docs and unnamed workers. */
export function mapVeridussCensus(
  docs: VeridussDocument[],
  portalId: string,
  capturedAt: string
): PortalCensus {
  const byWorker = new Map<string, PortalWorker>()
  for (const doc of docs) {
    if (doc.entityType !== 'member') continue
    const name = (doc.memberName ?? '').trim()
    if (!name || /^desconhecid/i.test(name)) continue
    if (isInactiveMember(doc)) continue
    const key = name.toUpperCase()
    const worker =
      byWorker.get(key) ??
      ({
        name,
        role:
          doc.metadata?.role ||
          doc.metadata?.position ||
          doc.metadata?.funcao ||
          undefined,
        contract: doc.company?.name || undefined,
        documents: [],
      } satisfies PortalWorker)
    worker.documents.push(toDocument(doc))
    byWorker.set(key, worker)
  }
  return { portalId, capturedAt, workers: [...byWorker.values()] }
}


const CANONICAL_MAP: Record<string, PortalDocStatus> = {
  approved: 'APPROVED',
  expiring: 'APPROVED', // still valid: EXPIRING is derived from the date, not trusted from the portal
  waived: 'WAIVED',
  expired: 'EXPIRED',
  rejected: 'REJECTED',
  pending_review: 'IN_REVIEW',
  missing_upload: 'MISSING',
}

/**
 * Pure: members + their required-status items -> a PortalCensus. Inactive members are dropped (the
 * portal suspends their billing and requirements), and waived requirements stay WAIVED instead of
 * surfacing a stale rejected upload as a blocker.
 */
export function mapVeridussRequiredCensus(
  members: { member: VeridussMember; items: VeridussRequiredItem[]; company?: string }[],
  portalId: string,
  capturedAt: string
): PortalCensus {
  const workers: PortalWorker[] = []
  for (const { member, items, company } of members) {
    const name = (member.name ?? '').trim()
    if (!name || member.status === 'inactive') continue
    workers.push({
      name,
      role: member.jobTitle || undefined,
      contract: company || undefined,
      documents: items.map(it => {
        const status = CANONICAL_MAP[it.canonicalStatus ?? ''] ?? 'MISSING'
        const rej = it.document?.latestRejection?.comments ??
          it.document?.approvals?.filter(a => /reject/i.test(a.status ?? '')).pop()?.comments
        return {
          title: (it.docType?.name ?? 'Documento').trim(),
          status,
          expiresOn: parsePortalDate(it.document?.expiresAt),
          note:
            status === 'REJECTED'
              ? (rej ?? '').replace(/\s+/g, ' ').trim() || undefined
              : CANONICAL_MAP[it.canonicalStatus ?? ''] === undefined
                ? `Status não mapeado: ${it.canonicalStatus ?? 'n/d'}`
                : undefined,
          required: true,
        } satisfies PortalDocument
      }),
    })
  }
  return { portalId, capturedAt, workers }
}

export interface StorageState {
  cookies?: { name: string; value: string; domain?: string }[]
}

/** Builds a Cookie header from a Playwright storageState, filtered to the portal host. */
export function cookieHeaderFromStorageState(
  state: StorageState,
  host?: string
): string {
  return (state.cookies ?? [])
    .filter(
      c => !host || !c.domain || c.domain.replace(/^\./, '').endsWith(host)
    )
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}

interface Paginated {
  data?: VeridussDocument[]
  meta?: { pagination?: { pageCount?: number; total?: number } }
}

export class VeridussRestClient {
  constructor(
    private readonly cookieHeader: string,
    private readonly baseUrl = DEFAULT_VERIDUSS_BASE_URL
  ) {}

  private async getJson<T>(pathAndQuery: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${pathAndQuery}`, {
      headers: {
        Cookie: this.cookieHeader,
        Accept: 'application/json, text/plain, */*',
      },
    })
    if (resp.status === 401 || resp.status === 403)
      throw new Error(
        `Veriduss ${resp.status}: sessão inválida ou expirada (renove o cookie)`
      )
    if (!resp.ok) throw new Error(`Veriduss ${resp.status} em ${pathAndQuery}`)
    return (await resp.json()) as T
  }

  async fetchCompanies(): Promise<VeridussCompany[]> {
    const data = await this.getJson<any>('/api/me/companies')
    const list: any[] = Array.isArray(data) ? data : (data.data ?? [])
    const companies: VeridussCompany[] = []
    for (const item of list) {
      if (typeof item.id === 'number') {
        companies.push(item)
      } else if (item.company && typeof item.company.id === 'number') {
        companies.push({ id: item.company.id, name: item.company.name })
      }
    }
    return companies
  }

  /** Company members with their portal status (`active`/`inactive`), CPF and job title. */
  async fetchMembers(companyId: number, pageSize = 100): Promise<VeridussMember[]> {
    const all: VeridussMember[] = []
    let page = 1
    let pageCount = 1
    do {
      const q =
        `/api/company-members?companyId=${companyId}&filters[company][id][$eq]=${companyId}` +
        `&pagination[page]=${page}&pagination[pageSize]=${pageSize}&sort=name:asc`
      const res = await this.getJson<{
        data?: VeridussMember[]
        meta?: { pagination?: { pageCount?: number } }
      }>(q)
      pageCount = res.meta?.pagination?.pageCount ?? 1
      for (const m of res.data ?? []) all.push(m)
      page++
    } while (page <= pageCount)
    return all
  }

  /**
   * The portal's own per-member requirement list: every required document type with its canonical
   * status (approved/expiring/waived/rejected/pending_review/missing_upload/expired). This is what
   * the portal UI shows, so waived requirements (client exemptions) and never-uploaded documents are
   * correct, unlike the raw /api/documents feed.
   */
  async fetchRequiredStatuses(
    companyId: number,
    memberId: number
  ): Promise<VeridussRequiredItem[]> {
    const res = await this.getJson<{ data?: { items?: VeridussRequiredItem[] } }>(
      `/api/documents/required-statuses/member/${memberId}?companyId=${companyId}`
    )
    return res.data?.items ?? []
  }

  async fetchMemberDocuments(
    companyId: number,
    pageSize = 100
  ): Promise<VeridussDocument[]> {
    const all: VeridussDocument[] = []
    let page = 1
    let pageCount = 1
    do {
      const q =
        `/api/documents?filters[company][id][$eq]=${companyId}` +
        `&sort=updatedAt:desc&pagination[page]=${page}&pagination[pageSize]=${pageSize}` +
        `&populate[docTypeObject]=*&populate[approvals]=*&populate[company]=*`
      const res = await this.getJson<Paginated>(q)
      pageCount = res.meta?.pagination?.pageCount ?? 1
      for (const d of res.data ?? []) all.push(d)
      page++
    } while (page <= pageCount)
    return all
  }
}

/** High-level: pull every member document across the account's companies into one census. */
export async function extractVeridussCensus(options: {
  cookieHeader: string
  portalId?: string
  baseUrl?: string
  capturedAt?: string
  companyIds?: number[]
}): Promise<PortalCensus> {
  const client = new VeridussRestClient(
    options.cookieHeader,
    options.baseUrl ?? DEFAULT_VERIDUSS_BASE_URL
  )
  const companies = options.companyIds
    ? options.companyIds.map(id => ({ id, name: undefined as string | undefined }))
    : (await client.fetchCompanies()).map(c => ({ id: c.id, name: c.name }))
  const portalId = options.portalId ?? 'veriduss-goldwind'
  const capturedAt = options.capturedAt ?? new Date().toISOString()

  // Preferred path: the portal's own per-member requirement view.
  try {
    const rows: { member: VeridussMember; items: VeridussRequiredItem[]; company?: string }[] = []
    for (const c of companies) {
      for (const member of await client.fetchMembers(c.id)) {
        if (member.status === 'inactive') continue
        rows.push({ member, items: await client.fetchRequiredStatuses(c.id, member.id), company: c.name })
      }
    }
    if (rows.length > 0) return mapVeridussRequiredCensus(rows, portalId, capturedAt)
  } catch (err) {
    console.warn(
      '[Veriduss] required-statuses indisponível, usando /api/documents:',
      err instanceof Error ? err.message : err
    )
  }

  // Fallback: raw document feed.
  const docs: VeridussDocument[] = []
  for (const c of companies)
    for (const d of await client.fetchMemberDocuments(c.id)) docs.push(d)
  return mapVeridussCensus(docs, portalId, capturedAt)
}
