import ExcelJS from 'exceljs'
import { PortalPendencyReport } from '../../domain/services/PortalPendencyReportBuilder.js'
import {
  ACTION_LABEL,
  CLEARANCE_LABEL,
  DOC_STATUS_LABEL,
  displayName,
  formatDay,
} from '../email/portalPendencyTemplates.js'

const PRIORITY_LABEL = {
  1: 'Escalado (urgente)',
  2: 'Escalado',
  3: 'Sem projeto na janela',
} as const

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFF' } }
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '25386B' },
  }
  header.alignment = { vertical: 'middle' }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  }
}

export async function writePortalReportWorkbook(
  report: PortalPendencyReport,
  filePath: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  const queue = workbook.addWorksheet('Fila de ações')
  queue.columns = [
    { header: 'Prioridade', key: 'priority', width: 22 },
    { header: 'Portal', key: 'portal', width: 30 },
    { header: 'Contrato / parque no portal', key: 'contract', width: 34 },
    { header: 'Colaborador', key: 'worker', width: 36 },
    { header: 'No RPO ativo', key: 'roster', width: 13 },
    { header: 'Documento', key: 'document', width: 50 },
    { header: 'Ação', key: 'action', width: 18 },
    { header: 'Situação no portal', key: 'status', width: 22 },
    { header: 'Validade no portal', key: 'expires', width: 16 },
    { header: 'Motivo / observação', key: 'note', width: 40 },
    { header: 'Base HSE', key: 'evidence', width: 40 },
    { header: 'Link base HSE', key: 'evidenceUrl', width: 30 },
    { header: 'Projeto', key: 'project', width: 40 },
    { header: 'Início', key: 'start', width: 12 },
  ]
  for (const a of report.actions) {
    queue.addRow({
      priority: PRIORITY_LABEL[a.priority],
      portal: a.portalName,
      contract: a.contract ?? '',
      worker: displayName(a.worker),
      roster: a.onActiveRoster ? 'Sim' : 'Não',
      document: a.document,
      action: ACTION_LABEL[a.kind],
      status: DOC_STATUS_LABEL[a.status],
      expires: formatDay(a.expiresOn),
      note: a.note ?? '',
      evidence: a.evidence
        ? `${a.evidence.docName}${a.evidence.expiresOn ? ` até ${formatDay(a.evidence.expiresOn)}` : ''}`
        : '',
      evidenceUrl: a.evidence?.url ?? '',
      project: a.project
        ? `${a.project.client} / ${a.project.windfarm}${a.project.wo ? ` (WO ${a.project.wo})` : ''}`
        : '',
      start: formatDay(a.project?.startDate),
    })
  }
  styleHeader(queue)

  const readiness = workbook.addWorksheet('Prontidão por projeto')
  readiness.columns = [
    { header: 'Início', key: 'start', width: 12 },
    { header: 'Cliente', key: 'client', width: 22 },
    { header: 'Parque', key: 'windfarm', width: 36 },
    { header: 'WO', key: 'wo', width: 16 },
    { header: 'Colaborador', key: 'member', width: 36 },
    { header: 'Situação', key: 'clearance', width: 24 },
    { header: 'Portal', key: 'portal', width: 32 },
    { header: 'O que falta', key: 'missing', width: 70 },
  ]
  for (const p of report.projects) {
    const portal =
      p.monitored.map(m => m.portal.name).join(', ') ||
      p.unmonitored.map(u => u.name).join(', ')
    const members = p.members.length
      ? p.members
      : [
          {
            name: '(equipe não informada)',
            resolved: false,
            clearance: undefined,
            blockers: [],
            waiting: [],
            expiring: [],
          },
        ]
    for (const m of members) {
      readiness.addRow({
        start: formatDay(p.project.startDate),
        client: p.project.client,
        windfarm: p.project.windfarm,
        wo: p.project.wo ?? '',
        member: m.resolved ? displayName(m.name) : m.name,
        clearance: m.clearance ? CLEARANCE_LABEL[m.clearance] : '',
        portal,
        missing: [
          ...m.blockers.map(b => `${b.title} (${DOC_STATUS_LABEL[b.status]})`),
          ...m.waiting.map(w => `${w.title} (em análise)`),
          ...m.expiring.map(
            e => `${e.title} (vence ${formatDay(e.expiresOn)})`
          ),
        ].join('; '),
      })
    }
  }
  styleHeader(readiness)

  if (report.expiringAlerts && report.expiringAlerts.length > 0) {
    const alertsSheet = workbook.addWorksheet('Alertas Vencimento (30d)')
    alertsSheet.columns = [
      { header: 'Urgência', key: 'urgency', width: 22 },
      { header: 'Tipo de Alerta', key: 'categoryLabel', width: 38 },
      { header: 'Dias para Vencer', key: 'daysToExpiry', width: 18 },
      { header: 'Colaborador', key: 'worker', width: 34 },
      { header: 'Cliente', key: 'client', width: 22 },
      { header: 'Parque / Empreendimento', key: 'windfarm', width: 34 },
      { header: 'WO', key: 'wo', width: 16 },
      { header: 'Início da Campanha', key: 'startDate', width: 18 },
      { header: 'Documento', key: 'docName', width: 40 },
      { header: 'Código', key: 'docCode', width: 10 },
      { header: 'Data de Vencimento', key: 'expirationDate', width: 18 },
      { header: 'Status HSE', key: 'statusEHS', width: 14 },
      { header: 'Status no Portal', key: 'portalStatus', width: 30 },
      { header: 'Ação Recomendada', key: 'recommendedAction', width: 45 },
      { header: 'Solicitação Storz', key: 'storzState', width: 20 },
      { header: 'Risco Operacional', key: 'risk', width: 55 },
    ]

    for (const a of report.expiringAlerts) {
      alertsSheet.addRow({
        urgency:
          a.urgency === 'CRITICAL_7D'
            ? '🔴 Vence em até 7 dias'
            : a.urgency === 'HIGH_15D'
              ? '🟠 Vence em até 15 dias'
              : '🟡 Vence em até 30 dias',
        categoryLabel: a.categoryLabel,
        daysToExpiry: a.daysToExpiry,
        worker: displayName(a.worker),
        client: a.client,
        windfarm: a.windfarm,
        wo: a.wo || '',
        startDate: formatDay(a.startDate),
        docName: a.docName,
        docCode: a.docCode || '',
        expirationDate: formatDay(a.expirationDate),
        statusEHS: a.statusEHS,
        portalStatus: a.portalStatus || '',
        recommendedAction: a.recommendedAction,
        storzState: a.storzState || 'NÃO SOLICITADO',
        risk: a.risk,
      })
    }
    styleHeader(alertsSheet)
  }

  await workbook.xlsx.writeFile(filePath)
}
