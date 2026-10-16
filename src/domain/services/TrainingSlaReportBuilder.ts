import ExcelJS from 'exceljs'
import { StorzRequest } from '../models/StorzRequest.js'
import { Inspector } from '../models/Certificate.js'
import { analyzeTrainingPace, TrainingPaceAnalysis } from './TrainingPaceCalculator.js'
import { DOC_CATALOG_MAP } from './ComplianceEngine.js'
import { matchesInspector } from './InspectorMatcher.js'

export interface CollabSlaSummary {
  collaboratorName: string
  collaboratorCpf: string
  employmentType: 'CLT' | 'PJ' | 'N/A'
  role: string
  sector: string
  rpoBranch: string
  totalAssignedCourses: number
  activeOnTrackCount: number
  idleZeroProgressCount: number
  slowPaceCount: number
  completedCount: number
  maxIdleDays: number
  overallStatus: 'ATIVO_NO_DIA' | 'OCIOSO' | 'DESVIO_SLA' | 'CONCLUIDO' | 'CANCELADO'
  vaRecommendation: 'MANTER_INTEGRAL' | 'DESCONTAR_DIAS' | 'PJ_ISENTO' | 'AVALIAR_GESTAO'
  actionNote: string
}

const PACE_CATEGORY_LABELS: Record<string, string> = {
  NO_RITMO: 'NO RITMO / ATIVO NO DIA',
  ATENCAO_INERCIA: 'ATENÇÃO: INÉRCIA RECENTE',
  CRITICO_INERCIA: 'CRÍTICO: PARADO EM OCIOSIDADE',
  RITMO_LENTO: 'RITMO LENTO (DESVIO DE SLA)',
  RISCO_REPROVACAO: 'RISCO IMINENTE DE REPROVAÇÃO',
  CONCLUIDO: 'CONCLUÍDO NO PRAZO',
  REPROVADO_INERCIA: 'REPROVADO POR INÉRCIA (SEM ACESSO)',
  REPROVADO_EXAME: 'REPROVADO NA AVALIAÇÃO FINAL',
  CANCELADO: 'CANCELADO',
}

const PACE_CATEGORY_COLORS: Record<string, { bg: string; font: string }> = {
  NO_RITMO: { bg: 'DCFCE7', font: '166534' }, // verde
  ATENCAO_INERCIA: { bg: 'FEF9C3', font: '854D0E' }, // amarelo
  CRITICO_INERCIA: { bg: 'FEE2E2', font: '991B1B' }, // vermelho
  RITMO_LENTO: { bg: 'FFEDD5', font: '9A3412' }, // laranja
  RISCO_REPROVACAO: { bg: 'FCA5A5', font: '7F1D1D' }, // vermelho escuro
  CONCLUIDO: { bg: 'E0F2FE', font: '075985' }, // azul claro
  REPROVADO_INERCIA: { bg: 'FECACA', font: '991B1B' }, // vermelho
  REPROVADO_EXAME: { bg: 'FED7AA', font: '9A3412' }, // laranja
  CANCELADO: { bg: 'F1F5F9', font: '475569' }, // cinza
}

export class TrainingSlaReportBuilder {
  /**
   * Constrói mapa de informações de colaboradores do RPO por nome
   */
  static buildRpoMap(rpoInspectors: Inspector[]): Map<string, { role: string; sector: string; rpoBranch: string; employmentType: 'CLT' | 'PJ' }> {
    const map = new Map<string, { role: string; sector: string; rpoBranch: string; employmentType: 'CLT' | 'PJ' }>()
    for (const insp of rpoInspectors) {
      const cleanName = insp.name.toUpperCase().trim()
      map.set(cleanName, {
        role: insp.role || 'TÉCNICO',
        sector: insp.sector || 'EXTERNAS',
        rpoBranch: insp.rpoBranch || 'GERAL',
        employmentType: insp.employmentType === 'PJ' ? 'PJ' : 'CLT',
      })
    }
    return map
  }

  /**
   * Encontra dados do colaborador no RPO usando o InspectorMatcher resiliente a acentos
   */
  static findRpoData(
    collabName: string,
    rpoMap: Map<string, { role: string; sector: string; rpoBranch: string; employmentType: 'CLT' | 'PJ' }>,
    rpoInspectors: Inspector[]
  ): { role: string; sector: string; rpoBranch: string; employmentType: 'CLT' | 'PJ' } {
    const clean = collabName.toUpperCase().trim()
    const direct = rpoMap.get(clean)
    if (direct) return direct

    const matched = rpoInspectors.find(i => matchesInspector(i.name, collabName))
    if (matched) {
      return {
        role: matched.role || 'TÉCNICO',
        sector: matched.sector || 'EXTERNAS',
        rpoBranch: matched.rpoBranch || 'GERAL',
        employmentType: matched.employmentType === 'PJ' ? 'PJ' : 'CLT',
      }
    }

    return {
      role: 'TÉCNICO',
      sector: 'EXTERNAS',
      rpoBranch: 'GERAL',
      employmentType: 'CLT',
    }
  }

  /**
   * Aba Detalhada: Controle de SLA e Ociosidade (RH) por Curso/Matrícula
   */
  static buildSlaOciosidadeSheet(
    workbook: ExcelJS.Workbook,
    requests: StorzRequest[],
    rpoInspectors: Inspector[] = [],
    refDate: Date = new Date()
  ): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Controle de SLA e Ociosidade')
    const rpoMap = this.buildRpoMap(rpoInspectors)

    sheet.columns = [
      { header: 'Colaborador', key: 'collaboratorName', width: 35 },
      { header: 'CPF', key: 'collaboratorCpf', width: 16 },
      { header: 'Contrato', key: 'employmentType', width: 12 },
      { header: 'Função / Cargo', key: 'role', width: 16 },
      { header: 'Ramo / Setor', key: 'rpoBranch', width: 25 },
      { header: 'Código', key: 'trainingCode', width: 10 },
      { header: 'Treinamento / Exame', key: 'trainingName', width: 42 },
      { header: 'Carga Horária', key: 'workloadHours', width: 14 },
      { header: 'Meta SLA (Dias)', key: 'idealSlaDays', width: 16 },
      { header: 'Data Matrícula', key: 'requestDate', width: 14 },
      { header: 'Situação Storz', key: 'rawSituacao', width: 16 },
      { header: 'Progresso (%)', key: 'progressPercent', width: 14 },
      { header: 'Dias Decorridos', key: 'elapsedDays', width: 16 },
      { header: 'Classificação de SLA / Ritmo', key: 'paceCategoryLabel', width: 32 },
      { header: 'Apontamento Vale Alimentação (RH)', key: 'vaImpact', width: 35 },
      { header: 'Dias Ociosos p/ Desconto', key: 'idleDays', width: 22 },
      { header: 'Diagnóstico Operacional / Ação Mayana', key: 'formattedDetail', width: 65 },
    ]

    // Estilo do cabeçalho oficial Arthwind
    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }, // Slate escuro
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

    const sorted = [...requests].sort((a, b) => {
      const cmp = a.collaboratorName.localeCompare(b.collaboratorName)
      if (cmp !== 0) return cmp
      const tA = a.requestDate ? new Date(a.requestDate).getTime() : 0
      const tB = b.requestDate ? new Date(b.requestDate).getTime() : 0
      return tB - tA
    })

    for (const req of sorted) {
      const analysis: TrainingPaceAnalysis = analyzeTrainingPace(req, refDate)
      const rpo = this.findRpoData(req.collaboratorName, rpoMap, rpoInspectors)

      const isClt = rpo.employmentType === 'CLT'
      const prog = req.progressPercent !== undefined ? req.progressPercent : (req.state === 'CONCLUIDO' ? 100 : 0)

      // Cálculo de dias ociosos e impacto em VA
      let idleDays = 0
      let vaImpact = ''

      if (analysis.paceCategory === 'CONCLUIDO' || analysis.paceCategory === 'NO_RITMO') {
        idleDays = 0
        vaImpact = isClt ? 'MANTER VA (Em atividade no dia)' : 'PJ (Isento de VA)'
      } else if (analysis.paceCategory === 'ATENCAO_INERCIA') {
        idleDays = analysis.elapsedDays
        vaImpact = isClt ? `ALERTA INÉRCIA (${idleDays}d sem acesso - Acompanhar)` : 'PJ (Isento de VA / Acompanhar)'
      } else if (analysis.paceCategory === 'CRITICO_INERCIA' || analysis.paceCategory === 'REPROVADO_INERCIA') {
        idleDays = analysis.elapsedDays
        vaImpact = isClt ? `DESCONTAR VA (${idleDays} dias ociosos sem atividade)` : 'PJ (Isento de VA / Sem atividade)'
      } else if (analysis.paceCategory === 'RITMO_LENTO' || analysis.paceCategory === 'RISCO_REPROVACAO') {
        idleDays = Math.max(0, analysis.elapsedDays - analysis.idealSlaDays)
        vaImpact = isClt ? `DESVIO SLA (Excedeu meta em ${idleDays}d - Avaliar RH)` : 'PJ (Isento de VA / Desvio de prazo)'
      } else {
        idleDays = 0
        vaImpact = isClt ? 'CANCELADO / SEM IMPACTO' : 'PJ (Isento de VA)'
      }

      const reqDateStr = req.requestDate ? new Date(req.requestDate).toLocaleDateString('pt-BR') : '-'

      const row = sheet.addRow({
        collaboratorName: req.collaboratorName,
        collaboratorCpf: req.collaboratorCpf || '-',
        employmentType: rpo.employmentType,
        role: rpo.role,
        rpoBranch: rpo.rpoBranch,
        trainingCode: req.trainingCode,
        trainingName: DOC_CATALOG_MAP[req.trainingCode] ? `${req.trainingName} (${DOC_CATALOG_MAP[req.trainingCode]})` : req.trainingName,
        workloadHours: `${analysis.workloadHours}h`,
        idealSlaDays: `${analysis.idealSlaDays} dia(s)`,
        requestDate: reqDateStr,
        rawSituacao: req.rawSituacao || req.state,
        progressPercent: `${prog}%`,
        elapsedDays: `${analysis.elapsedDays}d`,
        paceCategoryLabel: PACE_CATEGORY_LABELS[analysis.paceCategory] || analysis.paceCategory,
        vaImpact,
        idleDays: idleDays > 0 ? idleDays : 0,
        formattedDetail: analysis.formattedDetail,
      })

      // Cores para o status de SLA / Ritmo
      const paceColor = PACE_CATEGORY_COLORS[analysis.paceCategory]
      if (paceColor) {
        row.getCell('paceCategoryLabel').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${paceColor.bg}` },
        }
        row.getCell('paceCategoryLabel').font = {
          color: { argb: `FF${paceColor.font}` },
          bold: true,
        }
      }

      // Destaque visual no Apontamento de VA
      if (vaImpact.startsWith('DESCONTAR VA')) {
        row.getCell('vaImpact').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' },
        }
        row.getCell('vaImpact').font = {
          color: { argb: 'FF991B1B' },
          bold: true,
        }
      } else if (vaImpact.startsWith('MANTER VA')) {
        row.getCell('vaImpact').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCFCE7' },
        }
        row.getCell('vaImpact').font = {
          color: { argb: 'FF166534' },
        }
      } else if (vaImpact.startsWith('ALERTA INÉRCIA') || vaImpact.startsWith('DESVIO SLA')) {
        row.getCell('vaImpact').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' },
        }
        row.getCell('vaImpact').font = {
          color: { argb: 'FF92400E' },
          bold: true,
        }
      }
    }

    sheet.autoFilter = {
      from: 'A1',
      to: `Q${sorted.length + 1}`,
    }

    return sheet
  }

  /**
   * Aba Consolidada: Resumo de Ociosidade por Colaborador (Para a Folha de Pagamento do RH)
   */
  static buildResumoColaboradorRhSheet(
    workbook: ExcelJS.Workbook,
    requests: StorzRequest[],
    rpoInspectors: Inspector[] = [],
    refDate: Date = new Date()
  ): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Resumo Ociosidade (RH - Folha)')
    const rpoMap = this.buildRpoMap(rpoInspectors)

    sheet.columns = [
      { header: 'Colaborador', key: 'collaboratorName', width: 35 },
      { header: 'CPF', key: 'collaboratorCpf', width: 16 },
      { header: 'Tipo Contrato', key: 'employmentType', width: 14 },
      { header: 'Cargo / Função', key: 'role', width: 16 },
      { header: 'Ramo Operacional', key: 'rpoBranch', width: 25 },
      { header: 'Cursos Atribuídos', key: 'totalCourses', width: 16 },
      { header: 'Em Andamento / No Ritmo', key: 'activeCount', width: 22 },
      { header: 'Parados / Sem Acesso (0%)', key: 'idleCount', width: 24 },
      { header: 'Com Desvio de SLA', key: 'slowCount', width: 18 },
      { header: 'Concluídos', key: 'completedCount', width: 14 },
      { header: 'Maior Inércia (Dias Parados)', key: 'maxIdleDays', width: 24 },
      { header: 'Status Geral do Aluno', key: 'overallStatusLabel', width: 28 },
      { header: 'Recomendação Vale Alimentação (RH)', key: 'vaRecommendationLabel', width: 38 },
      { header: 'Ação Operacional Recomendada', key: 'actionNote', width: 55 },
    ]

    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }, // Slate profundo
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

    // Agrupa requisições por colaborador
    const byCollab = new Map<string, StorzRequest[]>()
    for (const r of requests) {
      const name = r.collaboratorName.toUpperCase().trim()
      if (!byCollab.has(name)) byCollab.set(name, [])
      byCollab.get(name)!.push(r)
    }

    const collabSummaries: CollabSlaSummary[] = []

    for (const [collabName, collabReqs] of byCollab.entries()) {
      const rpo = this.findRpoData(collabName, rpoMap, rpoInspectors)
      const cpf = collabReqs[0]?.collaboratorCpf || '-'

      let activeCount = 0
      let idleCount = 0
      let slowCount = 0
      let completedCount = 0
      let maxIdleDays = 0

      for (const req of collabReqs) {
        const analysis = analyzeTrainingPace(req, refDate)
        if (analysis.paceCategory === 'CONCLUIDO') {
          completedCount++
        } else if (analysis.paceCategory === 'NO_RITMO') {
          activeCount++
        } else if (analysis.paceCategory === 'ATENCAO_INERCIA' || analysis.paceCategory === 'CRITICO_INERCIA' || analysis.paceCategory === 'REPROVADO_INERCIA') {
          idleCount++
          if (analysis.elapsedDays > maxIdleDays) maxIdleDays = analysis.elapsedDays
        } else if (analysis.paceCategory === 'RITMO_LENTO' || analysis.paceCategory === 'RISCO_REPROVACAO' || analysis.paceCategory === 'REPROVADO_EXAME') {
          slowCount++
          const diff = Math.max(0, analysis.elapsedDays - analysis.idealSlaDays)
          if (diff > maxIdleDays) maxIdleDays = diff
        }
      }

      const isClt = rpo.employmentType === 'CLT'
      let overallStatus: CollabSlaSummary['overallStatus'] = 'ATIVO_NO_DIA'
      let vaRecommendation: CollabSlaSummary['vaRecommendation'] = 'MANTER_INTEGRAL'
      let actionNote = ''

      if (idleCount > 0) {
        overallStatus = 'OCIOSO'
        if (isClt) {
          vaRecommendation = 'DESCONTAR_DIAS'
          actionNote = `Colaborador com ${idleCount} curso(s) sem acesso há até ${maxIdleDays} dias. Apontar desconto de VA no período de inércia.`
        } else {
          vaRecommendation = 'PJ_ISENTO'
          actionNote = `Piloto/Prestador PJ com ${idleCount} curso(s) sem acesso há ${maxIdleDays} dias. Alinhar com coordenação.`
        }
      } else if (slowCount > 0) {
        overallStatus = 'DESVIO_SLA'
        vaRecommendation = isClt ? 'AVALIAR_GESTAO' : 'PJ_ISENTO'
        actionNote = `Colaborador avançando com ritmo lento em ${slowCount} curso(s) (acima da meta SLA). Monitorar entrega.`
      } else if (activeCount > 0) {
        overallStatus = 'ATIVO_NO_DIA'
        vaRecommendation = isClt ? 'MANTER_INTEGRAL' : 'PJ_ISENTO'
        actionNote = 'Treinamentos em andamento no ritmo regular (sem desvios detectados).'
      } else if (completedCount > 0) {
        overallStatus = 'CONCLUIDO'
        vaRecommendation = isClt ? 'MANTER_INTEGRAL' : 'PJ_ISENTO'
        actionNote = 'Todos os cursos atribuídos foram concluídos.'
      } else {
        overallStatus = 'CANCELADO'
        vaRecommendation = 'PJ_ISENTO'
        actionNote = 'Cursos cancelados.'
      }

      collabSummaries.push({
        collaboratorName: collabName,
        collaboratorCpf: cpf,
        employmentType: rpo.employmentType,
        role: rpo.role,
        sector: rpo.sector,
        rpoBranch: rpo.rpoBranch,
        totalAssignedCourses: collabReqs.length,
        activeOnTrackCount: activeCount,
        idleZeroProgressCount: idleCount,
        slowPaceCount: slowCount,
        completedCount,
        maxIdleDays,
        overallStatus,
        vaRecommendation,
        actionNote,
      })
    }

    // Ordena: primeiro quem está ocioso/com desconto de VA, depois desvios de SLA, depois ativos
    collabSummaries.sort((a, b) => {
      const order = { OCIOSO: 0, DESVIO_SLA: 1, ATIVO_NO_DIA: 2, CONCLUIDO: 3, CANCELADO: 4 }
      const diff = order[a.overallStatus] - order[b.overallStatus]
      if (diff !== 0) return diff
      return b.maxIdleDays - a.maxIdleDays || a.collaboratorName.localeCompare(b.collaboratorName)
    })

    for (const c of collabSummaries) {
      let statusLabel = ''
      let statusColor = { bg: 'F1F5F9', font: '475569' }
      let vaLabel = ''

      if (c.overallStatus === 'OCIOSO') {
        statusLabel = 'OCIOSO NO PERÍODO'
        statusColor = { bg: 'FEE2E2', font: '991B1B' }
        vaLabel = c.employmentType === 'CLT'
          ? `DESCONTAR VA (${c.maxIdleDays} dias ociosos)`
          : 'PJ (Isento de VA / Contrato Faturado)'
      } else if (c.overallStatus === 'DESVIO_SLA') {
        statusLabel = 'COM DESVIO DE SLA'
        statusColor = { bg: 'FFEDD5', font: '9A3412' }
        vaLabel = c.employmentType === 'CLT' ? 'AVALIAR COM GESTOR (Ritmo Lento)' : 'PJ (Isento de VA)'
      } else if (c.overallStatus === 'ATIVO_NO_DIA') {
        statusLabel = 'EM ATIVIDADE (NO DIA)'
        statusColor = { bg: 'DCFCE7', font: '166534' }
        vaLabel = c.employmentType === 'CLT' ? 'PAGAR VA INTEGRAL (Em dia)' : 'PJ (Isento de VA)'
      } else if (c.overallStatus === 'CONCLUIDO') {
        statusLabel = '100% REGULAR / CONCLUÍDO'
        statusColor = { bg: 'E0F2FE', font: '075985' }
        vaLabel = c.employmentType === 'CLT' ? 'PAGAR VA INTEGRAL' : 'PJ (Isento de VA)'
      } else {
        statusLabel = 'CANCELADO'
        vaLabel = 'SEM APONTAMENTO'
      }

      const row = sheet.addRow({
        collaboratorName: c.collaboratorName,
        collaboratorCpf: c.collaboratorCpf,
        employmentType: c.employmentType,
        role: c.role,
        rpoBranch: c.rpoBranch,
        totalCourses: c.totalAssignedCourses,
        activeCount: c.activeOnTrackCount,
        idleCount: c.idleZeroProgressCount,
        slowCount: c.slowPaceCount,
        completedCount: c.completedCount,
        maxIdleDays: c.maxIdleDays > 0 ? c.maxIdleDays : 0,
        overallStatusLabel: statusLabel,
        vaRecommendationLabel: vaLabel,
        actionNote: c.actionNote,
      })

      row.getCell('overallStatusLabel').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${statusColor.bg}` },
      }
      row.getCell('overallStatusLabel').font = {
        color: { argb: `FF${statusColor.font}` },
        bold: true,
      }

      if (vaLabel.startsWith('DESCONTAR VA')) {
        row.getCell('vaRecommendationLabel').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' },
        }
        row.getCell('vaRecommendationLabel').font = {
          color: { argb: 'FF991B1B' },
          bold: true,
        }
      } else if (vaLabel.startsWith('PAGAR VA')) {
        row.getCell('vaRecommendationLabel').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCFCE7' },
        }
        row.getCell('vaRecommendationLabel').font = {
          color: { argb: 'FF166534' },
        }
      }
    }

    sheet.autoFilter = {
      from: 'A1',
      to: `N${collabSummaries.length + 1}`,
    }

    return sheet
  }

  /**
   * Exporta arquivo Excel standalone dedicado exclusivamente para o RH
   */
  static async exportStandaloneRhReport(
    requests: StorzRequest[],
    rpoInspectors: Inspector[] = [],
    outputPath: string,
    refDate: Date = new Date()
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook()
    this.buildResumoColaboradorRhSheet(workbook, requests, rpoInspectors, refDate)
    this.buildSlaOciosidadeSheet(workbook, requests, rpoInspectors, refDate)
    await workbook.xlsx.writeFile(outputPath)
  }
}
