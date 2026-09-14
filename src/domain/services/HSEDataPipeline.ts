import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import {
  DashboardSourceHealth,
  SourceHealthInfo,
} from '../../adapters/dashboard/DashboardHtmlGenerator.js'
import { createDriveAdapter } from '../../adapters/drive/driveAdapterFactory.js'
import {
  RPO_TRACKED_DOC_CODES,
  SmartsheetRPOAdapter,
} from '../../adapters/smartsheet/SmartsheetRPOAdapter.js'
import { StorzHttpScraper } from '../../adapters/storz/StorzHttpScraper.js'
import { StorzPlaywrightAdapter } from '../../adapters/storz/StorzPlaywrightAdapter.js'
import { IDocumentProvider } from '../../ports/IDocumentProvider.js'
import { Inspector, ParkRequirement } from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import { AuditTriangulator } from './AuditTriangulator.js'
import { PRESENCIAL_REQUIRED_DOC_CODES } from './ComplianceEngine.js'
import { DriveRpoAuditor, DriveRpoComparisonItem } from './DriveRpoAuditor.js'
import {
  EHS_TRAINING_SCOPE_BRANCHES,
  EmployeeProfile,
  classifyEmployeeProfile,
  getElectiveDocCodesForProfile,
  getRequiredDocCodesForProfile,
} from './EmployeeProfileClassifier.js'
import {
  HSEDatabaseRecord,
  HSEDatabaseRepository,
} from './HSEDatabaseRepository.js'
import { matchesInspector } from './InspectorMatcher.js'
import { buildRoster } from './InspectorRosterBuilder.js'

export const MODALITY_REQUIREMENTS: ParkRequirement['requiredModalities'] =
  Object.fromEntries(
    Array.from(PRESENCIAL_REQUIRED_DOC_CODES, code => [
      code,
      'PRESENCIAL' as const,
    ])
  )

export interface PipelineDependencies {
  driveAdapter?: IDocumentProvider
  rpoAdapter?: SmartsheetRPOAdapter | null
  storzScraper?: StorzHttpScraper
  dbRepo?: HSEDatabaseRepository
  dataDir?: string
  scratchDir?: string
}

export interface PipelineSyncOptions {
  refDate?: Date
  forceLiveStorz?: boolean
  targetCollaborators?: string[]
}

export interface SyncMetadata {
  syncTimestamp: string
  refDate: string
  driveFoldersCount: number
  rpoActiveCount: number
  rpoTotalCount: number
  ehsRosterCount: number
  storzRequestsCount: number
  storzSource: 'LIVE' | 'CACHE'
  divergencesCount: number
  divergencesByKind: Record<string, number>
  complianceTotalRecords: number
}

export interface PipelineSyncResult {
  refDate: Date
  records: HSEDatabaseRecord[]
  rpoDivergences: DriveRpoComparisonItem[]
  storzRequests: StorzRequest[]
  sourceHealth: DashboardSourceHealth
  metadata: SyncMetadata
}

export class HSEDataPipeline {
  private deps: PipelineDependencies
  private dataDir: string
  private scratchDir: string

  constructor(deps: PipelineDependencies = {}) {
    this.deps = deps
    this.dataDir = deps.dataDir || path.join(process.cwd(), 'data')
    this.scratchDir = deps.scratchDir || path.join(process.cwd(), 'scratch')
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    if (!fs.existsSync(this.scratchDir)) {
      fs.mkdirSync(this.scratchDir, { recursive: true })
    }
  }

  /**
   * Converte itens serializados em JSON de volta para instancias validas de DriveRpoComparisonItem com Dates.
   */
  static deserializeDivergences(raw: any[]): DriveRpoComparisonItem[] {
    return raw.map(item => ({
      ...item,
      driveExpiration: item.driveExpiration
        ? new Date(item.driveExpiration)
        : undefined,
      storzExpiration: item.storzExpiration
        ? new Date(item.storzExpiration)
        : undefined,
      rpoExpiration: item.rpoExpiration
        ? new Date(item.rpoExpiration)
        : undefined,
    }))
  }

  /**
   * Exporta a lista de divergencias para formato oficial Excel (usado por e-mails e relatorios).
   */
  static async exportDivergencesToExcel(
    items: DriveRpoComparisonItem[],
    outputPath: string
  ): Promise<void> {
    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Auditoria Drive x RPO')

    sheet.columns = [
      { header: 'Colaborador', key: 'inspectorName', width: 35 },
      { header: 'Código', key: 'docCode', width: 10 },
      { header: 'Documento', key: 'docName', width: 30 },
      { header: 'Validade Drive', key: 'driveExpiration', width: 16 },
      {
        header: 'Validade Storz (estimada)',
        key: 'storzExpiration',
        width: 20,
      },
      { header: 'Validade RPO', key: 'rpoExpiration', width: 16 },
      { header: 'Fonte Confiável', key: 'trustedSource', width: 14 },
      { header: 'Divergente', key: 'divergent', width: 12 },
      { header: 'Tipo', key: 'divergenceKind', width: 18 },
      { header: 'Detalhes', key: 'detail', width: 60 },
    ]

    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0F172A' },
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

    const dateFmt = (d?: Date | string) => {
      if (!d) return ''
      const dateObj = d instanceof Date ? d : new Date(d)
      return Number.isNaN(dateObj.getTime())
        ? ''
        : dateObj.toLocaleDateString('pt-BR')
    }

    for (const item of items) {
      const row = sheet.addRow({
        inspectorName: item.inspectorName,
        docCode: item.docCode,
        docName: item.docName,
        driveExpiration: dateFmt(item.driveExpiration),
        storzExpiration: dateFmt(item.storzExpiration),
        rpoExpiration: dateFmt(item.rpoExpiration),
        trustedSource: item.trustedSource || '',
        divergent: item.divergent ? 'SIM' : 'NÃO',
        divergenceKind: item.divergenceKind || '',
        detail: item.detail,
      })

      if (item.divergent) {
        const cell = row.getCell('divergent')
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FEE2E2' },
        }
        cell.font = { color: { argb: '991B1B' }, bold: true }
      }
    }

    await workbook.xlsx.writeFile(outputPath)
  }

  /**
   * Executa o pipeline de sincronizacao central (ETL, triangulacao e auditoria),
   * persistindo a base unica de verdade nos discos persistente e volatil.
   */
  async executeSync(
    options: PipelineSyncOptions = {}
  ): Promise<PipelineSyncResult> {
    const refDate =
      options.refDate ||
      (process.env.HSE_REF_DATE
        ? new Date(process.env.HSE_REF_DATE)
        : new Date())

    console.log('[HSEDataPipeline] Iniciando ciclo de sincronizacao SSOT...')
    console.log(
      `[HSEDataPipeline] Data de referencia: ${refDate.toLocaleDateString('pt-BR')}`
    )

    // 1. Provedor Drive
    const driveAdapter = this.deps.driveAdapter || createDriveAdapter(refDate)
    const driveInspectorsRaw = await driveAdapter.getInspectors()
    console.log(
      `[HSEDataPipeline] Drive: ${driveInspectorsRaw.length} pasta(s) lida(s).`
    )

    // 2. Provedor RPO (Smartsheet)
    const rpoAdapter =
      this.deps.rpoAdapter !== undefined
        ? this.deps.rpoAdapter
        : SmartsheetRPOAdapter.fromEnv(refDate)

    let rpoInspectorsRaw: Inspector[] = []
    let activeRpoInspectors: Inspector[] = []
    let activeDriveInspectors: Inspector[] = []
    let ehsRoster: {
      inspector: Inspector
      requiredDocCodes: string[]
      profile: EmployeeProfile
      hasDriveFolder: boolean
    }[] = []

    if (rpoAdapter) {
      rpoInspectorsRaw = await rpoAdapter.readRPOData()
      activeRpoInspectors = rpoInspectorsRaw.filter(
        i => classifyEmployeeProfile(i.role) !== null
      )
      activeDriveInspectors = driveInspectorsRaw.filter(d =>
        activeRpoInspectors.some(r => matchesInspector(d, r.name, r.cpf))
      )
      const fullRoster = buildRoster(rpoInspectorsRaw, driveInspectorsRaw)
      ehsRoster = fullRoster.filter(r =>
        EHS_TRAINING_SCOPE_BRANCHES.includes(r.inspector.rpoBranch || '')
      )
      console.log(
        `[HSEDataPipeline] RPO: ${rpoInspectorsRaw.length} linha(s), ${activeRpoInspectors.length} ativo(s).`
      )
      console.log(
        `[HSEDataPipeline] Drive Ativos: ${activeDriveInspectors.length} pasta(s) correspondente(s).`
      )
      console.log(
        `[HSEDataPipeline] Roster EHS: ${ehsRoster.length} pessoa(s) no escopo de campo.`
      )
    } else {
      console.log(
        '[HSEDataPipeline] Smartsheet RPO nao configurada — operando com base restrita ao Drive.'
      )
      activeDriveInspectors = driveInspectorsRaw
      ehsRoster = driveInspectorsRaw.map(inspector => ({
        inspector,
        requiredDocCodes: getRequiredDocCodesForProfile('CAMPO'),
        profile: 'CAMPO' as const,
        hasDriveFolder: true,
      }))
    }

    // 3. Plataforma Storz LMS
    const storzScraper = this.deps.storzScraper || new StorzHttpScraper()
    const targetCollaborators =
      options.targetCollaborators ||
      (activeRpoInspectors.length > 0
        ? activeRpoInspectors.map(i => i.name)
        : ehsRoster.map(r => r.inspector.name))

    let storzRequests: StorzRequest[] = []
    let storzSource: 'LIVE' | 'CACHE' = 'LIVE'

    try {
      const storzResult = await storzScraper.runAuditScrape({
        headless: true,
        targetCollaborators,
      })
      storzRequests = storzResult.requests
    } catch (err) {
      console.warn(
        '[HSEDataPipeline] Aviso ao buscar dados ao vivo na Storz:',
        err
      )
    }

    if (storzRequests.length === 0) {
      storzSource = 'CACHE'
      storzRequests = storzScraper.loadCache()
    }

    if (storzRequests.length === 0) {
      try {
        const storzAdapter = new StorzPlaywrightAdapter()
        storzRequests = await storzAdapter.getAllRequests()
        if (storzRequests.length > 0) storzSource = 'LIVE'
      } catch {
        // Ignora fallback Playwright se nao disponivel
      }
    }

    console.log(
      `[HSEDataPipeline] Storz: ${storzRequests.length} matricula(s) carregada(s) (Fonte: ${storzSource}).`
    )

    // 4. Triangulacao EHS (Compliance)
    const auditResults = ehsRoster.map(
      ({ inspector, requiredDocCodes, profile }) => {
        const park: ParkRequirement = {
          id: `perfil_${profile.toLowerCase()}`,
          parkName: `Perfil ${profile}`,
          clientName: '-',
          description: `Requisitos do perfil ${profile}`,
          requiredDocCodes,
          electiveDocCodes: getElectiveDocCodesForProfile(profile),
          requiredModalities: MODALITY_REQUIREMENTS,
        }
        return AuditTriangulator.performTripleAudit(
          inspector,
          park,
          storzRequests,
          refDate
        )
      }
    )

    const dbRepo = this.deps.dbRepo || new HSEDatabaseRepository()
    dbRepo.saveAuditSnapshot(
      auditResults,
      ehsRoster.map(r => r.inspector)
    )
    const records = dbRepo.getAllRecords()

    // 5. Auditoria de Divergencias Drive + Storz x RPO
    let rpoDivergences: DriveRpoComparisonItem[] = []
    if (activeRpoInspectors.length > 0) {
      rpoDivergences = DriveRpoAuditor.compare(
        activeDriveInspectors,
        activeRpoInspectors,
        Array.from(RPO_TRACKED_DOC_CODES),
        storzRequests
      )
    }

    // 6. Persistencia dos Snapshots SSOT
    this.saveDivergencesSnapshot(rpoDivergences)

    const divergencesCount = rpoDivergences.filter(d => d.divergent).length
    const divergencesByKind: Record<string, number> = {}
    for (const d of rpoDivergences.filter(d => d.divergent)) {
      if (d.divergenceKind) {
        divergencesByKind[d.divergenceKind] =
          (divergencesByKind[d.divergenceKind] || 0) + 1
      }
    }

    const metadata: SyncMetadata = {
      syncTimestamp: new Date().toISOString(),
      refDate: refDate.toISOString(),
      driveFoldersCount: driveInspectorsRaw.length,
      rpoActiveCount: activeRpoInspectors.length,
      rpoTotalCount: rpoInspectorsRaw.length,
      ehsRosterCount: ehsRoster.length,
      storzRequestsCount: storzRequests.length,
      storzSource,
      divergencesCount,
      divergencesByKind,
      complianceTotalRecords: records.length,
    }
    this.saveMetadataSnapshot(metadata)

    // 7. Telemetria de Saude das Fontes para o Dashboard
    const sourceHealth: DashboardSourceHealth = {
      drive: {
        status: driveInspectorsRaw.length > 0 ? 'ONLINE' : 'WARNING',
        message: `${driveInspectorsRaw.length} pastas no Drive`,
        detail: `Sincronizacao com Google Drive via OAuth (${driveInspectorsRaw.length} pastas de colaboradores lidas)`,
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
      smartsheet: {
        status: activeRpoInspectors.length > 0 ? 'ONLINE' : 'WARNING',
        message:
          activeRpoInspectors.length > 0
            ? `${activeRpoInspectors.length} pessoas ativas na RPO`
            : 'RPO Offline / Nao Configurada',
        detail:
          activeRpoInspectors.length > 0
            ? `Sincronizacao OK com a planilha RPO via Smartsheet API (${activeRpoInspectors.length} ativos)`
            : 'Variaveis SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID nao configuradas',
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
      storz: {
        status: storzSource === 'LIVE' ? 'ONLINE' : 'CACHE',
        message:
          storzSource === 'LIVE'
            ? `Ao Vivo via REST API (${storzRequests.length} matriculas)`
            : `Cache Persistente (${storzRequests.length} matriculas)`,
        detail:
          storzSource === 'LIVE'
            ? `Raspagem direta via Storz REST API efetuada com sucesso (${storzRequests.length} matriculas extraidas)`
            : `Fallback seguro ativado do cache local persistente (${storzRequests.length} matriculas)`,
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
    }

    console.log(
      '[HSEDataPipeline] Ciclo de sincronizacao concluido com sucesso.'
    )
    return {
      refDate,
      records,
      rpoDivergences,
      storzRequests,
      sourceHealth,
      metadata,
    }
  }

  /**
   * Carrega instantaneo existente de dados persistidos sem acessar servicos de rede externos.
   * Retorna null se nenhum dado existir.
   */
  loadExistingSnapshot(
    options: { refDate?: Date } = {}
  ): PipelineSyncResult | null {
    const refDate =
      options.refDate ||
      (process.env.HSE_REF_DATE
        ? new Date(process.env.HSE_REF_DATE)
        : new Date())

    const dbRepo = this.deps.dbRepo || new HSEDatabaseRepository()
    const records = dbRepo.getAllRecords()

    const rpoCandidates = [
      path.join(this.dataDir, 'rpo_divergences.json'),
      path.join(this.scratchDir, 'rpo_divergences.json'),
    ]
    let rpoDivergences: DriveRpoComparisonItem[] = []
    for (const p of rpoCandidates) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (Array.isArray(raw)) {
            rpoDivergences = HSEDataPipeline.deserializeDivergences(raw)
            break
          }
        } catch (err) {
          console.warn(
            `[HSEDataPipeline] Erro ao ler divergencias de ${p}:`,
            err
          )
        }
      }
    }

    const storzScraper = this.deps.storzScraper || new StorzHttpScraper()
    const storzRequests = storzScraper.loadCache()

    const metaCandidates = [
      path.join(this.dataDir, 'sync_metadata.json'),
      path.join(this.scratchDir, 'sync_metadata.json'),
    ]
    let metadata: SyncMetadata | null = null
    for (const p of metaCandidates) {
      if (fs.existsSync(p)) {
        try {
          metadata = JSON.parse(fs.readFileSync(p, 'utf-8'))
          break
        } catch {}
      }
    }

    if (
      records.length === 0 &&
      rpoDivergences.length === 0 &&
      storzRequests.length === 0
    ) {
      return null
    }

    const divergencesCount = rpoDivergences.filter(d => d.divergent).length
    const divergencesByKind: Record<string, number> = {}
    for (const d of rpoDivergences.filter(d => d.divergent)) {
      if (d.divergenceKind) {
        divergencesByKind[d.divergenceKind] =
          (divergencesByKind[d.divergenceKind] || 0) + 1
      }
    }

    const effectiveMetadata: SyncMetadata = metadata || {
      syncTimestamp: new Date().toISOString(),
      refDate: refDate.toISOString(),
      driveFoldersCount: 0,
      rpoActiveCount: 0,
      rpoTotalCount: 0,
      ehsRosterCount: 0,
      storzRequestsCount: storzRequests.length,
      storzSource: 'CACHE',
      divergencesCount,
      divergencesByKind,
      complianceTotalRecords: records.length,
    }

    const sourceHealth: DashboardSourceHealth = {
      drive: {
        status: 'ONLINE',
        message: `${effectiveMetadata.driveFoldersCount || 'Snapshot'} pastas no Drive`,
        detail: 'Snapshot persistente carregado da base consolidada',
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
      smartsheet: {
        status: 'ONLINE',
        message: `${effectiveMetadata.rpoActiveCount || 'Snapshot'} pessoas ativas na RPO`,
        detail: 'Snapshot persistente carregado da base consolidada',
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
      storz: {
        status: effectiveMetadata.storzSource === 'LIVE' ? 'ONLINE' : 'CACHE',
        message: `${effectiveMetadata.storzRequestsCount || storzRequests.length} matriculas na Storz`,
        detail: 'Snapshot persistente carregado da base consolidada',
        lastSync: refDate.toLocaleDateString('pt-BR'),
      },
    }

    return {
      refDate,
      records,
      rpoDivergences,
      storzRequests,
      sourceHealth,
      metadata: effectiveMetadata,
    }
  }

  /**
   * Obtem os dados existentes do snapshot persistente ou executa sincronizacao caso nao existam
   * ou caso preferSnapshot seja false.
   */
  async getOrSync(
    options: PipelineSyncOptions & { preferSnapshot?: boolean } = {}
  ): Promise<PipelineSyncResult> {
    if (options.preferSnapshot) {
      const snapshot = this.loadExistingSnapshot(options)
      if (snapshot) return snapshot
    }
    return this.executeSync(options)
  }

  private saveDivergencesSnapshot(divergences: DriveRpoComparisonItem[]): void {
    const json = JSON.stringify(divergences, null, 2)
    for (const dir of [this.dataDir, this.scratchDir]) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const filePath = path.join(dir, 'rpo_divergences.json')
        const tmpPath = `${filePath}.tmp`
        fs.writeFileSync(tmpPath, json, 'utf-8')
        fs.renameSync(tmpPath, filePath)
      } catch (err) {
        console.warn(
          `[HSEDataPipeline] Aviso ao salvar rpo_divergences.json em ${dir}:`,
          err
        )
      }
    }
  }

  private saveMetadataSnapshot(metadata: SyncMetadata): void {
    const json = JSON.stringify(metadata, null, 2)
    for (const dir of [this.dataDir, this.scratchDir]) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const filePath = path.join(dir, 'sync_metadata.json')
        const tmpPath = `${filePath}.tmp`
        fs.writeFileSync(tmpPath, json, 'utf-8')
        fs.renameSync(tmpPath, filePath)
      } catch (err) {
        console.warn(
          `[HSEDataPipeline] Aviso ao salvar sync_metadata.json em ${dir}:`,
          err
        )
      }
    }
  }
}
