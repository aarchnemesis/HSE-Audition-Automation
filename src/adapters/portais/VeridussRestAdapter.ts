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
  pending_approval: 'IN_REVIEW',
  waived: 'WAIVED',
  exempt: 'WAIVED',
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
    const data = await this.getJson<
      VeridussCompany[] | { data?: VeridussCompany[] }
    >('/api/me/companies')
    const list = Array.isArray(data) ? data : (data.data ?? [])
    return list.filter(c => typeof c.id === 'number')
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
  const companyIds =
    options.companyIds ?? (await client.fetchCompanies()).map(c => c.id)
  const docs: VeridussDocument[] = []
  for (const id of companyIds)
    for (const d of await client.fetchMemberDocuments(id)) docs.push(d)
  return mapVeridussCensus(
    docs,
    options.portalId ?? 'veriduss-goldwind',
    options.capturedAt ?? new Date().toISOString()
  )
}
