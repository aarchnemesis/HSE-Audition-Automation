import fs from 'fs'
import path from 'path'
import {
  Certificate,
  EHSStatus,
  Inspector,
  TrainingModality,
} from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import { TripleAuditResult } from './AuditTriangulator.js'
import { ELECTIVE_DOC_CODES } from './ComplianceEngine.js'
import { matchesInspector } from './InspectorMatcher.js'

export interface HSEDatabaseRecord {
  inspectorId: string
  inspectorName: string
  role: string
  sector?: string
  city?: string
  state?: string
  docCode: string
  docName: string
  modality: TrainingModality
  issueDate?: string
  expirationDate?: string
  statusEHS: EHSStatus
  storzRequestId?: string
  storzState?: string
  detail: string
  lastUpdated: string
}

export class HSEDatabaseRepository {
  private dbPath: string

  constructor(
    dbPath: string = path.join(process.cwd(), 'scratch', 'hse_database.json')
  ) {
    this.dbPath = dbPath
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Salva e consolida os resultados da auditoria tripla no banco de dados central HSE
   */
  saveAuditSnapshot(
    auditResults: TripleAuditResult[],
    inspectors: Inspector[]
  ): void {
    const records: HSEDatabaseRecord[] = []
    const timestamp = new Date().toISOString()

    for (const audit of auditResults) {
      const inspector = inspectors.find(i =>
        matchesInspector(i, audit.inspectorName)
      )

      for (const item of audit.auditItems) {
        // Eletivo (SIT/ESO Vestas) e ausente: revisado em 25/08/2026 — não é pra apontar em lugar
        // nenhum (Excel, dashboard, e-mail), nem como "visibilidade". É um treinamento muito
        // específico do parque Vestas, a maioria da equipe nunca vai precisar dele.
        if (item.status === 'AUSENTE' && ELECTIVE_DOC_CODES.has(item.code))
          continue

        records.push({
          inspectorId: inspector?.id || audit.inspectorName,
          inspectorName: audit.inspectorName,
          role: inspector?.role || 'TÉCNICO',
          sector: inspector?.sector || 'OPERAÇÕES',
          city: inspector?.location?.city,
          state: inspector?.location?.state,
          docCode: item.code,
          docName: item.reqName,
          modality: (item.actualModality as TrainingModality) || 'PRESENCIAL',
          issueDate: undefined,
          expirationDate: undefined,
          statusEHS: item.status,
          storzRequestId: item.storzRequestFound?.requestId,
          storzState: item.storzRequestFound?.state,
          detail: item.detail,
          lastUpdated: timestamp,
        })
      }
    }

    // Escrita atômica (arquivo temp + rename) evita corromper o banco em caso de crash a meio da escrita
    const tmpPath = `${this.dbPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), 'utf-8')
    fs.renameSync(tmpPath, this.dbPath)
    console.log(
      `[HSEDatabaseRepository] 💾 Banco de dados HSE atualizado com ${records.length} registro(s) em: ${this.dbPath}`
    )
  }

  /**
   * Carrega todos os registros do banco de dados HSE
   */
  getAllRecords(): HSEDatabaseRecord[] {
    if (!fs.existsSync(this.dbPath)) return []
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        console.error(
          '[HSEDatabaseRepository] Banco de dados HSE em formato inesperado (esperado array). Ignorando.'
        )
        return []
      }
      return parsed.filter(
        r =>
          typeof r === 'object' &&
          r !== null &&
          typeof r.inspectorName === 'string' &&
          typeof r.docCode === 'string'
      )
    } catch (e) {
      console.error(
        '[HSEDatabaseRepository] Erro ao ler banco de dados HSE:',
        e
      )
      return []
    }
  }
}
