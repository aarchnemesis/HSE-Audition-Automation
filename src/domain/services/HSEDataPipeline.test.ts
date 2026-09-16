import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDocumentProvider } from '../../ports/IDocumentProvider.js'
import { Certificate, Inspector } from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import { HSEDataPipeline } from './HSEDataPipeline.js'
import { HSEDatabaseRepository } from './HSEDatabaseRepository.js'

describe('HSEDataPipeline', () => {
  let tmpDir: string
  let testDataDir: string
  let testScratchDir: string
  let dbRepo: HSEDatabaseRepository

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'))
    testDataDir = path.join(tmpDir, 'data')
    testScratchDir = path.join(tmpDir, 'scratch')
    fs.mkdirSync(testDataDir, { recursive: true })
    fs.mkdirSync(testScratchDir, { recursive: true })
    dbRepo = new HSEDatabaseRepository(
      path.join(testScratchDir, 'hse_database.json')
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deserializa datas de divergencias corretamente', () => {
    const raw = [
      {
        inspectorName: 'TESTE COLABORADOR',
        docCode: '01',
        docName: 'ASO',
        driveExpiration: '2025-10-15T00:00:00.000Z',
        storzExpiration: '2025-10-15T00:00:00.000Z',
        rpoExpiration: '2025-11-15T00:00:00.000Z',
        divergent: true,
        divergenceKind: 'DATA_DIVERGENTE',
        detail: 'Divergencia teste',
      },
    ]

    const items = HSEDataPipeline.deserializeDivergences(raw)
    expect(items[0].driveExpiration).toBeInstanceOf(Date)
    expect(items[0].storzExpiration).toBeInstanceOf(Date)
    expect(items[0].rpoExpiration).toBeInstanceOf(Date)
  })

  it('executa sincronizacao central e salva snapshots SSOT', async () => {
    const mockDriveInspectors: Inspector[] = [
      {
        id: '1',
        name: 'CARLOS SILVA',
        role: 'IQ',
        sector: 'OPERAÇÕES',
        certificates: new Map<string, Certificate>([
          [
            '01',
            {
              code: '01',
              name: 'ASO',
              expirationDate: new Date('2026-06-01'),
              statusEHS: 'CONFORME',
            },
          ],
        ]),
      },
      {
        id: '2',
        name: 'EX FUNCIONARIO',
        role: 'DE',
        certificates: new Map(),
      },
    ]

    const mockRpoInspectors: Inspector[] = [
      {
        id: '1',
        name: 'CARLOS SILVA',
        role: 'IQ',
        rpoBranch: 'INSP. QUALIDADE & TÉC. OPERAÇÕES',
        certificates: new Map<string, Certificate>([
          [
            '01',
            {
              code: '01',
              name: 'ASO',
              expirationDate: new Date('2026-06-01'),
              statusEHS: 'CONFORME',
            },
          ],
        ]),
      },
      {
        id: '2',
        name: 'EX FUNCIONARIO',
        role: 'DE',
        certificates: new Map(),
      },
    ]

    const mockStorzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'CARLOS SILVA',
        trainingCode: '01',
        trainingName: 'ASO',
        state: 'CONCLUIDO',
        rawSituacao: 'APROVADO',
        requestDate: new Date('2026-01-01'),
        completionDate: new Date('2026-01-05'),
        modality: 'PRESENCIAL',
      },
    ]

    const mockDriveAdapter: IDocumentProvider = {
      getInspectors: async () => mockDriveInspectors,
      getInspectorById: async () => null,
    }

    const mockRpoAdapter = {
      readRPOData: async () => mockRpoInspectors,
    } as any

    const mockStorzScraper = {
      runAuditScrape: async () => ({
        success: true,
        requests: mockStorzRequests,
        log: [],
      }),
      loadCache: () => mockStorzRequests,
    } as any

    const pipeline = new HSEDataPipeline({
      driveAdapter: mockDriveAdapter,
      rpoAdapter: mockRpoAdapter,
      storzScraper: mockStorzScraper,
      dbRepo,
      dataDir: testDataDir,
      scratchDir: testScratchDir,
    })

    const refDate = new Date('2026-09-14')
    const result = await pipeline.executeSync({ refDate })

    expect(result.metadata.rpoTotalCount).toBe(2)
    expect(result.metadata.rpoActiveCount).toBe(1)
    expect(result.metadata.driveFoldersCount).toBe(2)
    expect(result.metadata.ehsRosterCount).toBe(1)
    expect(result.storzRequests.length).toBe(1)
    expect(result.sourceHealth.drive?.status).toBe('ONLINE')
    expect(result.sourceHealth.smartsheet?.status).toBe('ONLINE')
    expect(result.sourceHealth.storz?.status).toBe('ONLINE')

    expect(fs.existsSync(path.join(testDataDir, 'rpo_divergences.json'))).toBe(
      true
    )
    expect(fs.existsSync(path.join(testDataDir, 'sync_metadata.json'))).toBe(
      true
    )
    expect(
      fs.existsSync(path.join(testScratchDir, 'rpo_divergences.json'))
    ).toBe(true)
    expect(fs.existsSync(path.join(testScratchDir, 'sync_metadata.json'))).toBe(
      true
    )
  })

  it('carrega snapshot existente sem bater em adaptadores externos', async () => {
    const divergenceData = [
      {
        inspectorName: 'ALEXANDRE SILVA',
        docCode: '04',
        docName: 'NR-35',
        driveExpiration: '2026-08-10T00:00:00.000Z',
        storzExpiration: '2026-08-10T00:00:00.000Z',
        rpoExpiration: '2026-09-10T00:00:00.000Z',
        divergent: true,
        divergenceKind: 'DATA_DIVERGENTE',
        detail: 'Data divergente',
      },
    ]
    fs.writeFileSync(
      path.join(testDataDir, 'rpo_divergences.json'),
      JSON.stringify(divergenceData, null, 2),
      'utf-8'
    )

    const metadataData = {
      syncTimestamp: '2026-09-14T12:00:00.000Z',
      refDate: '2026-09-14T00:00:00.000Z',
      driveFoldersCount: 97,
      rpoActiveCount: 359,
      rpoTotalCount: 420,
      ehsRosterCount: 97,
      storzRequestsCount: 372,
      storzSource: 'LIVE',
      divergencesCount: 1,
      divergencesByKind: { DATA_DIVERGENTE: 1 },
      complianceTotalRecords: 1500,
    }
    fs.writeFileSync(
      path.join(testDataDir, 'sync_metadata.json'),
      JSON.stringify(metadataData, null, 2),
      'utf-8'
    )

    const mockStorzScraper = {
      loadCache: () => [
        {
          id: 'REQ-1',
          collaboratorName: 'ALEXANDRE SILVA',
          trainingCode: '04',
          trainingName: 'NR-35',
          state: 'CONCLUIDO',
          requestDate: new Date('2026-01-01'),
          modality: 'PRESENCIAL',
        },
      ],
    } as any

    const pipeline = new HSEDataPipeline({
      storzScraper: mockStorzScraper,
      dbRepo,
      dataDir: testDataDir,
      scratchDir: testScratchDir,
    })

    const snapshot = pipeline.loadExistingSnapshot({
      refDate: new Date('2026-09-14'),
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.rpoDivergences.length).toBe(1)
    expect(snapshot?.rpoDivergences[0].divergent).toBe(true)
    expect(snapshot?.rpoDivergences[0].driveExpiration).toBeInstanceOf(Date)
    expect(snapshot?.metadata.divergencesCount).toBe(1)
    expect(snapshot?.metadata.storzRequestsCount).toBe(372)
  })

  it('exporta divergencias para arquivo Excel oficial', async () => {
    const items = [
      {
        inspectorName: 'ALEXANDRE SILVA',
        docCode: '04',
        docName: 'NR-35',
        driveExpiration: new Date('2026-08-10'),
        storzExpiration: new Date('2026-08-10'),
        rpoExpiration: new Date('2026-09-10'),
        trustedSource: 'DRIVE' as const,
        divergent: true,
        divergenceKind: 'DATA_DIVERGENTE' as const,
        detail: 'Data divergente teste',
      },
    ]

    const outputPath = path.join(testScratchDir, 'auditoria_teste.xlsx')
    await HSEDataPipeline.exportDivergencesToExcel(items, outputPath)
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000)
  })

  it('resiste a falha no Drive Adapter caindo suavemente para o cache local', async () => {
    const cachedInspectors = [
      {
        id: '1',
        name: 'JOAO TESTE',
        role: 'IQ',
        certificates: {
          '01': {
            code: '01',
            name: 'ASO',
            expirationDate: '2027-01-01T00:00:00.000Z',
            statusEHS: 'CONFORME',
          },
        },
      },
    ]
    fs.writeFileSync(
      path.join(testDataDir, 'drive_inspectors_cache.json'),
      JSON.stringify(cachedInspectors, null, 2),
      'utf-8'
    )

    const failingDriveAdapter: IDocumentProvider = {
      getInspectors: async () => {
        throw new Error('Google Drive API 403 Forbidden / Rate Limit')
      },
      getInspectorById: async () => null,
    }

    const mockRpoAdapter = {
      readRPOData: async () => [
        {
          id: '1',
          name: 'JOAO TESTE',
          role: 'IQ',
          rpoBranch: 'INSP. QUALIDADE & TÉC. OPERAÇÕES',
          certificates: new Map(),
        },
      ],
    } as any

    const pipeline = new HSEDataPipeline({
      driveAdapter: failingDriveAdapter,
      rpoAdapter: mockRpoAdapter,
      storzScraper: { loadCache: () => [] } as any,
      dbRepo,
      dataDir: testDataDir,
      scratchDir: testScratchDir,
    })

    const result = await pipeline.executeSync({
      refDate: new Date('2026-09-16'),
    })
    expect(result.metadata.driveFoldersCount).toBe(1)
    expect(result.sourceHealth.drive?.status).toBe('CACHE')
    expect(result.sourceHealth.drive?.message).toContain('Cache')
  })

  it('resiste a falha 404 no Smartsheet RPO caindo suavemente para o cache local', async () => {
    const cachedRpo = [
      {
        id: 'rpo_1',
        name: 'MARIA TESTE',
        role: 'TO',
        rpoBranch: 'RECURSOS HUMANOS',
        certificates: {
          '01': {
            code: '01',
            name: 'ASO',
            expirationDate: '2027-05-01T00:00:00.000Z',
            statusEHS: 'CONFORME',
          },
        },
      },
    ]
    fs.writeFileSync(
      path.join(testDataDir, 'rpo_inspectors_cache.json'),
      JSON.stringify(cachedRpo, null, 2),
      'utf-8'
    )

    const failingRpoAdapter = {
      readRPOData: async () => {
        throw new Error('Smartsheet API retornou 404: Not Found')
      },
    } as any

    const mockDriveAdapter: IDocumentProvider = {
      getInspectors: async () => [
        {
          id: '1',
          name: 'MARIA TESTE',
          role: 'TO',
          certificates: new Map(),
        },
      ],
      getInspectorById: async () => null,
    }

    const pipeline = new HSEDataPipeline({
      driveAdapter: mockDriveAdapter,
      rpoAdapter: failingRpoAdapter,
      storzScraper: { loadCache: () => [] } as any,
      dbRepo,
      dataDir: testDataDir,
      scratchDir: testScratchDir,
    })

    const result = await pipeline.executeSync({
      refDate: new Date('2026-09-16'),
    })
    expect(result.metadata.rpoActiveCount).toBe(1)
    expect(result.sourceHealth.smartsheet?.status).toBe('CACHE')
    expect(result.sourceHealth.smartsheet?.message).toContain('Cache')
  })
})
