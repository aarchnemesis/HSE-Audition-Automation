import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
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
