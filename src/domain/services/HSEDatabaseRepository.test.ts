import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../models/Certificate.js'
import { TripleAuditResult } from './AuditTriangulator.js'
import { HSEDatabaseRepository } from './HSEDatabaseRepository.js'

function makeAuditResult(
  items: TripleAuditResult['auditItems']
): TripleAuditResult {
  return {
    inspectorName: 'FULANO',
    parkName: 'Perfil CAMPO',
    clientName: '-',
    overallStatus: 'APTO',
    missingDocsCount: 0,
    expiredDocsCount: 0,
    warningDocsCount: 0,
    storzPendingCount: 0,
    storzInProgressCount: 0,
    validDocsCount: 0,
    auditItems: items,
  }
}

function makeInspector(): Inspector {
  return { id: 'FULANO', name: 'FULANO', role: 'IQ', certificates: new Map() }
}

describe('HSEDatabaseRepository.saveAuditSnapshot', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-db-test-'))

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir)
  })

  it('não grava documento eletivo (Vestas) ausente — revisado 25/08/2026, não é pra apontar em lugar nenhum', () => {
    const dbPath = path.join(tmpDir, 'db.json')
    const repo = new HSEDatabaseRepository(dbPath)

    const auditResult = makeAuditResult([
      {
        code: '25',
        reqName: 'SIT (Vestas)',
        status: 'AUSENTE',
        isModalityCompliant: true,
        hasDriveDoc: false,
        detail: 'Documento eletivo não encontrado no Drive.',
      },
    ])

    repo.saveAuditSnapshot([auditResult], [makeInspector()])
    const records = repo.getAllRecords()
    expect(records).toHaveLength(0)
  })

  it('stores the Drive link as evidenceUrl and ignores local file paths', () => {
    const dbPath = path.join(tmpDir, 'db.json')
    const repo = new HSEDatabaseRepository(dbPath)
    const inspector: Inspector = {
      ...makeInspector(),
      certificates: new Map([
        [
          '01',
          {
            code: '01',
            name: 'ASO',
            statusEHS: 'CONFORME',
            sourcePath: 'https://drive.google.com/file/d/abc123/view',
          },
        ],
        [
          '10',
          {
            code: '10',
            name: 'NR-01',
            statusEHS: 'CONFORME',
            sourcePath: 'C:\\certificados\\nr01.pdf',
          },
        ],
      ]),
    }
    const item = (code: string, reqName: string) => ({
      code,
      reqName,
      status: 'CONFORME' as const,
      isModalityCompliant: true,
      hasDriveDoc: true,
      detail: 'Válido.',
    })

    repo.saveAuditSnapshot(
      [makeAuditResult([item('01', 'ASO'), item('10', 'NR-01')])],
      [inspector]
    )
    const byCode = new Map(repo.getAllRecords().map(r => [r.docCode, r]))

    expect(byCode.get('01')?.evidenceUrl).toBe(
      'https://drive.google.com/file/d/abc123/view'
    )
    expect(byCode.get('10')?.evidenceUrl).toBeUndefined()
  })

  it('stores driveFolderUrl on the records when available on the inspector', () => {
    const dbPath = path.join(tmpDir, 'db.json')
    const repo = new HSEDatabaseRepository(dbPath)
    const inspector: Inspector = {
      ...makeInspector(),
      driveFolderUrl: 'https://drive.google.com/drive/folders/folder_xyz_123',
    }
    const item = {
      code: '01',
      reqName: 'ASO',
      status: 'CONFORME' as const,
      isModalityCompliant: true,
      hasDriveDoc: true,
      detail: 'Válido.',
    }
    repo.saveAuditSnapshot([makeAuditResult([item])], [inspector])
    const records = repo.getAllRecords()
    expect(records).toHaveLength(1)
    expect(records[0].driveFolderUrl).toBe(
      'https://drive.google.com/drive/folders/folder_xyz_123'
    )
  })

  it('grava normalmente documento eletivo (Vestas) quando a pessoa TEM o certificado', () => {
    const dbPath = path.join(tmpDir, 'db.json')
    const repo = new HSEDatabaseRepository(dbPath)

    const auditResult = makeAuditResult([
      {
        code: '25',
        reqName: 'SIT (Vestas)',
        status: 'CONFORME',
        isModalityCompliant: true,
        hasDriveDoc: true,
        detail: 'Válido.',
      },
    ])

    repo.saveAuditSnapshot([auditResult], [makeInspector()])
    const records = repo.getAllRecords()
    expect(records).toHaveLength(1)
    expect(records[0].docCode).toBe('25')
  })

  it('grava normalmente documento não-eletivo ausente (ex.: ASO)', () => {
    const dbPath = path.join(tmpDir, 'db.json')
    const repo = new HSEDatabaseRepository(dbPath)

    const auditResult = makeAuditResult([
      {
        code: '01',
        reqName: 'ASO',
        status: 'AUSENTE',
        isModalityCompliant: true,
        hasDriveDoc: false,
        detail: 'Documento obrigatório não encontrado no Drive.',
      },
    ])

    repo.saveAuditSnapshot([auditResult], [makeInspector()])
    const records = repo.getAllRecords()
    expect(records).toHaveLength(1)
  })
})

describe('HSEDatabaseRepository — lastUpdated só muda quando o registro muda', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-db-lastupdated-'))

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir)
  })

  const aso = (status: 'CONFORME' | 'VENCIDO', detail: string) => ({
    code: '01',
    reqName: 'ASO',
    status,
    isModalityCompliant: true,
    hasDriveDoc: true,
    // Modalidade diferente da padrão: o registro cru precisa bater mesmo assim
    actualModality: 'PRESENCIAL',
    detail,
  })
  const sit = {
    code: '25',
    reqName: 'SIT (Vestas)',
    status: 'CONFORME' as const,
    isModalityCompliant: true,
    hasDriveDoc: true,
    actualModality: 'PRESENCIAL',
    detail: 'Válido.',
  }

  function save(repo: HSEDatabaseRepository, at: string, items: any[]) {
    vi.setSystemTime(new Date(at))
    repo.saveAuditSnapshot([makeAuditResult(items)], [makeInspector()])
    return JSON.parse(fs.readFileSync(path.join(tmpDir, 'db.json'), 'utf-8'))
  }

  it('mantém a data de registros idênticos e atualiza só o que mudou', () => {
    vi.useFakeTimers()
    const repo = new HSEDatabaseRepository(path.join(tmpDir, 'db.json'))

    save(repo, '2026-10-15T10:00:00.000Z', [aso('CONFORME', 'Válido.'), sit])
    const second = save(repo, '2026-10-15T10:45:00.000Z', [
      aso('VENCIDO', 'Vencido.'),
      sit,
    ])

    const byCode = Object.fromEntries(second.map((r: any) => [r.docCode, r]))
    expect(byCode['01'].lastUpdated).toBe('2026-10-15T10:45:00.000Z')
    expect(byCode['25'].lastUpdated).toBe('2026-10-15T10:00:00.000Z')
  })

  it('sem snapshot anterior, todos recebem o timestamp atual', () => {
    vi.useFakeTimers()
    const repo = new HSEDatabaseRepository(path.join(tmpDir, 'db.json'))
    const first = save(repo, '2026-10-15T10:00:00.000Z', [sit])
    expect(first[0].lastUpdated).toBe('2026-10-15T10:00:00.000Z')
  })
})
