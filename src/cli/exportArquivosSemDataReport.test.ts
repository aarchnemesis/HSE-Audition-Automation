import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildExcelReport,
  buildSemDataItems,
} from './exportArquivosSemDataReport.js'

describe('exportArquivosSemDataReport', () => {
  const tmpDir = path.join(process.cwd(), 'scratch', 'test_cache')

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  const mockSimItems = [
    {
      folderId: 'folder-1',
      collaborator: 'THAYNA NOGUEIRA TAVARES',
      fileId: 'file-thayna',
      currentName:
        '07 – Seguro de Vida – 0612.2026 – Thayna Nogueira Tavares.pdf',
      code: '07',
      docTitle: 'Seguro de Vida',
      modality: 'Avulso',
      date: 'SEM_DATA',
      proposedName:
        '07 – Seguro de Vida – SEM_DATA - THAYNA NOGUEIRA TAVARES.pdf',
      action: 'RENOMEAR',
    },
    {
      folderId: 'folder-2',
      collaborator: 'PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA',
      fileId: 'file-pedro-crt',
      currentName: '23 – CRT - Pedro Eduardo de Oliveira Cavalcanti Silva.pdf',
      code: '23',
      docTitle: 'CRT - Conselho de Técnicos',
      modality: 'Avulso',
      date: 'SEM_DATA',
      proposedName:
        '23 – CRT – SEM_DATA - PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA.pdf',
      action: 'RENOMEAR',
    },
    {
      folderId: 'folder-3',
      collaborator: 'ALISSON MATEUS ALMEIDA DA COSTA',
      fileId: 'file-alisson-nr1',
      currentName: 'Francisco Fabircio - Nr1.zip',
      code: '10',
      docTitle: 'NR-01 Integração EHS',
      modality: 'Avulso',
      date: 'SEM_DATA',
      proposedName:
        '10 – NR-01 Integração – SEM_DATA - ALISSON MATEUS ALMEIDA DA COSTA.pdf',
      action: 'RENOMEAR',
    },
    {
      folderId: 'folder-4',
      collaborator: 'JOÃO BATISTA CRUZ DA SILVA',
      fileId: 'file-joao-aso',
      currentName: '01 - ASO - 10.10.2025 - João.pdf',
      code: '01',
      docTitle: 'ASO Admissional / Periódico',
      modality: 'Avulso',
      date: '10.10.2025',
      proposedName: '01 – ASO – 10.10.2025 - JOÃO BATISTA CRUZ DA SILVA.pdf',
      action: 'RENOMEAR',
    },
  ]

  const mockExecItems = [
    {
      fileId: 'file-thayna',
      folderId: 'folder-1',
      collaborator: 'THAYNA NOGUEIRA TAVARES',
      originalName:
        '07 – Seguro de Vida – 0612.2026 – Thayna Nogueira Tavares.pdf',
      targetName:
        '07 – Seguro de Vida – SEM_DATA - THAYNA NOGUEIRA TAVARES.pdf',
      action: 'RENOMEAR',
      status: 'SUCESSO',
      timestamp: '2026-10-16T11:12:00.000Z',
    },
    {
      fileId: 'file-pedro-crt',
      folderId: 'folder-2',
      collaborator: 'PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA',
      originalName: '23 – CRT - Pedro Eduardo de Oliveira Cavalcanti Silva.pdf',
      targetName:
        '23 – CRT – SEM_DATA - PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA.pdf',
      action: 'RENOMEAR',
      status: 'SUCESSO',
      timestamp: '2026-10-16T11:12:01.000Z',
    },
    {
      fileId: 'file-alisson-nr1',
      folderId: 'folder-3',
      collaborator: 'ALISSON MATEUS ALMEIDA DA COSTA',
      originalName: 'Francisco Fabircio - Nr1.zip',
      targetName:
        '10 – NR-01 Integração – SEM_DATA - ALISSON MATEUS ALMEIDA DA COSTA.pdf',
      action: 'RENOMEAR',
      status: 'SUCESSO',
      timestamp: '2026-10-16T11:12:02.000Z',
    },
  ]

  it('filtra apenas itens SEM_DATA e ignora arquivos com data válida', () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    expect(items.length).toBe(3)
    expect(items.find(x => x.code === '01')).toBeUndefined()
  })

  it('ordena itens com TREINAMENTO / CONTRATUAL antes dos permanentes', () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    expect(items[0].natureza).toBe('TREINAMENTO / CONTRATUAL')
    expect(items[1].natureza).toBe('TREINAMENTO / CONTRATUAL')
    expect(items[2].natureza).toBe('PERMANENTE / VITALÍCIO')
  })

  it('enriquece diagnóstico e orientação específica para Thayna Nogueira Tavares', () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    const thayna = items.find(x => x.collaborator === 'THAYNA NOGUEIRA TAVARES')
    expect(thayna).toBeDefined()
    expect(thayna?.diagnostico).toContain('0612.2026')
    expect(thayna?.orientacao).toContain('06.12.2026')
  })

  it('enriquece diagnóstico e orientação específica para arquivo .zip de Alisson', () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    const alisson = items.find(
      x => x.collaborator === 'ALISSON MATEUS ALMEIDA DA COSTA'
    )
    expect(alisson).toBeDefined()
    expect(alisson?.diagnostico).toContain('Pacote compactado (.zip)')
  })

  it('gera links corretos do Google Drive para arquivo e pasta', () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    const pedro = items.find(x => x.fileId === 'file-pedro-crt')
    expect(pedro?.driveUrl).toBe(
      'https://drive.google.com/file/d/file-pedro-crt/view'
    )
    expect(pedro?.folderUrl).toBe(
      'https://drive.google.com/drive/folders/folder-2'
    )
  })

  it('gera workbook do Excel com abas e hiperlinks válidos', async () => {
    const items = buildSemDataItems(mockSimItems, mockExecItems)
    const testExcelPath = path.join(tmpDir, 'test_sem_data.xlsx')

    await buildExcelReport(items, testExcelPath)
    expect(fs.existsSync(testExcelPath)).toBe(true)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(testExcelPath)

    const sheetNames = wb.worksheets.map(w => w.name)
    expect(sheetNames).toContain('Resumo Executivo & Categorias')
    expect(sheetNames).toContain('Arquivos SEM_DATA (Drive)')

    const wsDetalhe = wb.getWorksheet('Arquivos SEM_DATA (Drive)')
    expect(wsDetalhe?.rowCount).toBe(4) // 1 header + 3 itens

    const row2 = wsDetalhe?.getRow(2)
    const driveLinkCell = row2?.getCell(10)
    expect((driveLinkCell?.value as any)?.text).toBe('Abrir Arquivo')
    expect((driveLinkCell?.value as any)?.hyperlink).toContain(
      'https://drive.google.com/file/d/'
    )
  })
})
