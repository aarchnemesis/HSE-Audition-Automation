import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { StorzRequest } from '../models/StorzRequest.js'
import { Inspector } from '../models/Certificate.js'
import { TrainingSlaReportBuilder } from './TrainingSlaReportBuilder.js'

describe('TrainingSlaReportBuilder', () => {
  const refDate = new Date('2026-10-16T12:00:00Z')

  const mockRequests: StorzRequest[] = [
    {
      id: 'REQ-1',
      collaboratorName: 'JOAO SILVA',
      collaboratorCpf: '111.222.333-44',
      trainingCode: '21',
      trainingName: 'NR-35 Trabalho em Altura',
      modality: 'ONLINE',
      requestDate: new Date('2026-10-15T12:00:00Z'), // 1 dia atras
      state: 'EM_ANDAMENTO',
      rawSituacao: 'Em andamento',
      progressPercent: 40,
      workloadHours: 8,
      idealSlaDays: 1,
    },
    {
      id: 'REQ-2',
      collaboratorName: 'MARCOS OCIOSO',
      collaboratorCpf: '555.666.777-88',
      trainingCode: '20',
      trainingName: 'NR-33 Espaço Confinado',
      modality: 'ONLINE',
      requestDate: new Date('2026-09-10T12:00:00Z'), // 36 dias atras
      state: 'SOLICITADO',
      rawSituacao: 'Não iniciado',
      progressPercent: 0,
      workloadHours: 8,
      idealSlaDays: 1,
    },
    {
      id: 'REQ-3',
      collaboratorName: 'CARLOS PJ',
      collaboratorCpf: '999.888.777-66',
      trainingCode: '10',
      trainingName: 'NR-01 Integração',
      modality: 'ONLINE',
      requestDate: new Date('2026-09-01T12:00:00Z'),
      state: 'SOLICITADO',
      rawSituacao: 'Não iniciado',
      progressPercent: 0,
      workloadHours: 4,
      idealSlaDays: 1,
    },
  ]

  const mockRpoInspectors: Inspector[] = [
    {
      id: '1',
      name: 'JOAO SILVA',
      role: 'TO',
      sector: 'INTERNAS',
      rpoBranch: 'INSP. QUALIDADE',
      employmentType: 'CLT',
      certificates: new Map(),
    },
    {
      id: '2',
      name: 'MARCOS OCIOSO',
      role: 'IQ',
      sector: 'EXTERNAS',
      rpoBranch: 'INSP. QUALIDADE',
      employmentType: 'CLT',
      certificates: new Map(),
    },
    {
      id: '3',
      name: 'CARLOS PJ',
      role: 'IE',
      sector: 'EXTERNAS',
      rpoBranch: 'DRONE INSP. EQUIPAMENTO',
      employmentType: 'PJ',
      certificates: new Map(),
    },
  ]

  it('gera a aba de Controle de SLA e Ociosidade corretamente', () => {
    const wb = new ExcelJS.Workbook()
    const sheet = TrainingSlaReportBuilder.buildSlaOciosidadeSheet(
      wb,
      mockRequests,
      mockRpoInspectors,
      refDate
    )

    expect(sheet).toBeDefined()
    expect(sheet.rowCount).toBe(4) // 1 cabeçalho + 3 linhas

    // Verifica classificação de Marcos Ocioso
    const rowOcioso = sheet.getRow(3) // ordenado
    const values = sheet.getSheetValues()
    const stringified = JSON.stringify(values)
    expect(stringified).toContain('DESCONTAR VA')
    expect(stringified).toContain('MANTER VA')
    expect(stringified).toContain('PJ (Isento de VA')
  })

  it('gera a aba de Resumo de Ociosidade por Colaborador para o RH', () => {
    const wb = new ExcelJS.Workbook()
    const sheet = TrainingSlaReportBuilder.buildResumoColaboradorRhSheet(
      wb,
      mockRequests,
      mockRpoInspectors,
      refDate
    )

    expect(sheet).toBeDefined()
    expect(sheet.rowCount).toBe(4) // 1 cabeçalho + 3 colaboradores únicos

    const values = sheet.getSheetValues()
    const stringified = JSON.stringify(values)
    expect(stringified).toContain('OCIOSO NO PERÍODO')
    expect(stringified).toContain('EM ATIVIDADE (NO DIA)')
  })
})
