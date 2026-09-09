import path from 'path'
import ExcelJS from 'exceljs'
import { EHSStatus, TrainingModality } from '../models/Certificate.js'
import {
  HSEDatabaseRecord,
  HSEDatabaseRepository,
} from './HSEDatabaseRepository.js'

export interface HSEFilterCriteria {
  inspectorName?: string
  statusEHS?: EHSStatus[]
  modality?: TrainingModality
  storzOnly?: boolean
  docCode?: string
}

export class HSEFilterEngine {
  private repo: HSEDatabaseRepository

  constructor(repo?: HSEDatabaseRepository) {
    this.repo = repo || new HSEDatabaseRepository()
  }

  /**
   * Executa filtros dinâmicos na base de dados do HSE
   */
  query(criteria: HSEFilterCriteria): HSEDatabaseRecord[] {
    const all = this.repo.getAllRecords()

    return all.filter(rec => {
      // Filtro por Nome do Inspetor
      if (
        criteria.inspectorName &&
        !rec.inspectorName
          .toUpperCase()
          .includes(criteria.inspectorName.toUpperCase())
      ) {
        return false
      }

      // Filtro por Status EHS (ex: VENCE_30, VENCIDO, SOLICITADO_STORZ)
      if (criteria.statusEHS && criteria.statusEHS.length > 0) {
        if (!criteria.statusEHS.includes(rec.statusEHS)) return false
      }

      // Filtro por Modalidade (Presencial / Online)
      if (criteria.modality && rec.modality !== criteria.modality) {
        return false
      }

      // Filtro por Solicitações Abertas na Storz
      if (criteria.storzOnly && !rec.storzRequestId) {
        return false
      }

      // Filtro por Código de Documento (ex: "21")
      if (criteria.docCode && rec.docCode !== criteria.docCode) {
        return false
      }

      return true
    })
  }

  /**
   * Gera um relatório Excel (.xlsx) altamente formatado para a equipe do HSE
   */
  async exportToExcel(
    records: HSEDatabaseRecord[],
    outputPath?: string
  ): Promise<string> {
    const filePath =
      outputPath ||
      path.join(process.cwd(), 'scratch', 'hse_relatorio_consolidado.xlsx')

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Auditoria HSE & Storz')

    // Estilo do Cabeçalho Excel
    sheet.columns = [
      { header: 'Código', key: 'docCode', width: 10 },
      { header: 'Treinamento / Requisito', key: 'docName', width: 35 },
      { header: 'Colaborador / Inspetor', key: 'inspectorName', width: 35 },
      { header: 'Cargo', key: 'role', width: 25 },
      { header: 'Setor', key: 'sector', width: 15 },
      { header: 'Modalidade', key: 'modality', width: 15 },
      { header: 'Status EHS', key: 'statusEHS', width: 20 },
      { header: 'ID Storz', key: 'storzRequestId', width: 15 },
      { header: 'Status Storz', key: 'storzState', width: 18 },
      { header: 'Progresso Storz (%)', key: 'storzProgress', width: 20 },
      { header: 'Prazo Limite Storz', key: 'storzDeadline', width: 20 },
      { header: 'Detalhes da Auditoria', key: 'detail', width: 55 },
    ]

    // Formatar Cabeçalho (Azul Escuro com Texto Branco)
    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0F172A' },
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

    // Adicionar Linhas e Formatação de Cores por Status
    for (const rec of records) {
      const row = sheet.addRow({
        docCode: rec.docCode,
        docName: rec.docName,
        inspectorName: rec.inspectorName,
        role: rec.role,
        sector: rec.sector || 'OPERAÇÕES',
        modality: rec.modality === 'PRESENCIAL' ? 'Presencial' : 'Remoto',
        statusEHS: rec.statusEHS,
        storzRequestId: rec.storzRequestId || 'N/A',
        storzState: rec.storzState || 'N/A',
        storzProgress:
          rec.storzProgressPercent !== undefined
            ? `${rec.storzProgressPercent}%`
            : 'N/A',
        storzDeadline: rec.storzDeadline || 'N/A',
        detail: rec.detail,
      })

      // Estilização da célula de Modalidade
      const modCell = row.getCell('modality')
      if (rec.modality === 'PRESENCIAL') {
        const isPresencialAlert = [
          'VENCIDO',
          'AUSENTE',
          'VENCE_07',
          'VENCE_15',
          'VENCE_30',
        ].includes(rec.statusEHS)
        if (isPresencialAlert) {
          modCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEDD5' }, // Laranja suave
          }
          modCell.font = { color: { argb: '9A3412' }, bold: true }
        } else {
          modCell.font = { color: { argb: '475569' }, bold: true }
        }
      } else {
        modCell.font = { color: { argb: '64748B' } }
      }

      // Estilização condicional de células baseada no Status EHS
      const statusCell = row.getCell('statusEHS')
      if (rec.statusEHS === 'CONFORME') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'DCFCE7' },
        }
        statusCell.font = { color: { argb: '166534' }, bold: true }
      } else if (
        ['VENCE_60', 'VENCE_30', 'VENCE_15', 'VENCE_07'].includes(rec.statusEHS)
      ) {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FEF9C3' },
        }
        statusCell.font = { color: { argb: '854D0E' }, bold: true }
      } else if (rec.statusEHS === 'VENCIDO' || rec.statusEHS === 'AUSENTE') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FEE2E2' },
        }
        statusCell.font = { color: { argb: '991B1B' }, bold: true }
      } else if (rec.statusEHS === 'SOLICITADO_STORZ') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'DBEAFE' },
        }
        statusCell.font = { color: { argb: '1E40AF' }, bold: true }
      } else if (rec.statusEHS === 'STORZ_EM_ANDAMENTO') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'EDE9FE' },
        }
        statusCell.font = { color: { argb: '5B21B6' }, bold: true }
      }

      // Estilização do Progresso da Storz
      const progCell = row.getCell('storzProgress')
      if (rec.storzProgressPercent !== undefined) {
        if (rec.storzProgressPercent === 100) {
          progCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'DCFCE7' },
          }
          progCell.font = { color: { argb: '166534' }, bold: true }
        } else if (rec.storzProgressPercent > 0) {
          progCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'EDE9FE' },
          }
          progCell.font = { color: { argb: '5B21B6' }, bold: true }
        }
      }
    }

    await workbook.xlsx.writeFile(filePath)
    console.log(
      `[HSEFilterEngine] 📊 Relatório Excel exportado com sucesso para a equipe HSE: ${filePath}`
    )

    return filePath
  }
}
