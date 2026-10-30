import { PortalDocStatus } from '../../domain/models/PortalCensus.js'
import {
  ActionKind,
  Clearance,
  CoverageGap,
  DocIssue,
  ExpiringDocAlert,
  MemberReadiness,
  PortalAction,
  PortalPendencyReport,
  ProjectReadiness,
  ProjectRef,
} from '../../domain/services/PortalPendencyReportBuilder.js'

export const ACTION_LABEL: Record<ActionKind, string> = {
  RESUBMIT: 'Reenviar',
  UPLOAD_FROM_BASE: 'Subir (já temos)',
  OBTAIN: 'Providenciar',
  RENEW: 'Renovar',
}

export const DOC_STATUS_LABEL: Record<PortalDocStatus, string> = {
  APPROVED: 'aprovado',
  EXPIRING: 'vence em breve',
  EXPIRED: 'vencido',
  IN_REVIEW: 'em análise no cliente',
  MISSING: 'não enviado',
  REJECTED: 'reprovado',
  WAIVED: 'dispensado',
}

export const CLEARANCE_LABEL: Record<Clearance, string> = {
  CLEARED: 'Liberado',
  WAITING_CLIENT: 'Aguardando cliente',
  BLOCKED: 'Bloqueado',
  NOT_REGISTERED: 'Sem cadastro no portal',
  NOT_MONITORED: 'Portal sem leitura',
}

const CLEARANCE_COLORS: Record<Clearance, [string, string]> = {
  CLEARED: ['#E4F3E9', '#1E7A4C'],
  WAITING_CLIENT: ['#E4EAF5', '#25386B'],
  BLOCKED: ['#FCE7E3', '#C1401F'],
  NOT_REGISTERED: ['#FDF0E6', '#B45A1E'],
  NOT_MONITORED: ['#F1F5F9', '#475569'],
}

const ACTION_COLORS: Record<ActionKind, [string, string]> = {
  RESUBMIT: ['#FCE7E3', '#C1401F'],
  UPLOAD_FROM_BASE: ['#E4F3E9', '#1E7A4C'],
  OBTAIN: ['#FDF0E6', '#B45A1E'],
  RENEW: ['#E4EAF5', '#25386B'],
}

export function esc(text: string | undefined | null): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])

/** Portals and sheets mix "JOSE MARCOS" and "José Marcos"; e-mails show one style. */
export function displayName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && NAME_PARTICLES.has(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ')
}

/** Drops the portal's instructions in parentheses: "ASO válido (Favor atender primeiro o item CTPS)". */
export function shortTitle(title: string): string {
  const short = title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+-\s*$/, '')
    .trim()
  return short || title
}

export function formatDay(iso?: string, withYear = true): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`
}

function pill(label: string, [bg, fg]: [string, string]): string {
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-weight:600;font-size:12px;white-space:nowrap">${esc(label)}</span>`
}

export function startLabel(ref: ProjectRef): string {
  const days = ref.daysToStart ?? 0
  const date = formatDay(ref.startDate, false)
  if (days < 0) return `começou ${date}`
  if (days === 0) return 'começa hoje'
  if (days === 1) return 'começa amanhã'
  return `começa ${date} (em ${days} dias)`
}

function kpiTable(cells: [string, number | string, string?][]): string {
  const tds = cells
    .map(
      ([label, value, color]) =>
        `<td style="padding:10px 8px;text-align:center;border:1px solid #EEF2F3;background:#F5F9FA"><div style="font-size:22px;font-weight:700;color:${color ?? '#25386B'}">${value}</div><div style="font-size:11px;color:#6B7A8D">${esc(label)}</div></td>`
    )
    .join('')
  return `<table style="margin:0 0 20px"><tr>${tds}</tr></table>`
}

function issueText(issue: DocIssue): string {
  const when =
    issue.status === 'EXPIRED' || issue.status === 'EXPIRING'
      ? ` ${formatDay(issue.expiresOn)}`
      : ''
  return `${esc(shortTitle(issue.title))} <span style="color:#6B7A8D">(${DOC_STATUS_LABEL[issue.status]}${when})</span>`
}

const MAX_ISSUES_PER_MEMBER = 4

function memberMissing(member: MemberReadiness): string {
  if (member.clearance === 'NOT_REGISTERED')
    return '<span style="color:#6B7A8D">Não encontrado no portal do cliente: confirmar cadastro.</span>'
  if (member.clearance === 'NOT_MONITORED') return ''
  const parts = member.blockers.map(issueText)
  if (member.waiting.length)
    parts.push(
      `<span style="color:#25386B">${member.waiting.length} em análise no cliente</span>`
    )
  if (member.expiring.length)
    parts.push(
      ...member.expiring.map(
        e =>
          `<span style="color:#6B7A8D">${esc(shortTitle(e.title))} vence ${formatDay(e.expiresOn)}</span>`
      )
    )
  const shown = parts.slice(0, MAX_ISSUES_PER_MEMBER)
  if (parts.length > shown.length)
    shown.push(
      `<span style="color:#6B7A8D">+${parts.length - shown.length} itens</span>`
    )
  return shown.join('<br>')
}

function projectBlock(p: ProjectReadiness): string {
  const ref = p.project
  const allCleared =
    p.members.length > 0 && p.members.every(m => m.clearance === 'CLEARED')

  if (allCleared) {
    return `<div style="border:1px solid #DCFCE7;background:#F0FDF4;border-radius:6px;padding:8px 12px;margin-bottom:8px">
      <span style="color:#166534;font-weight:700">[LIBERADO] ${esc(ref.client)} · ${esc(ref.windfarm)}</span>
      <span style="font-size:11px;color:#15803D"> · ${ref.wo ? `WO ${esc(ref.wo)} · ` : ''}${startLabel(ref)} · Equipe 100% Liberada (${p.members.length} colaboradores)</span>
    </div>`
  }

  const source = p.monitored.length
    ? p.monitored
        .map(m => `${esc(m.portal.name)}, dados de ${formatDay(m.capturedAt)}`)
        .join(' · ')
    : 'sem leitura automática'
  const rows = p.members.length
    ? p.members
        .map(
          m => `<tr>
        <td>${esc(m.resolved ? displayName(m.name) : m.name)}${m.resolved ? '' : ' <span style="color:#6B7A8D">(nome não encontrado no RPO)</span>'}</td>
        <td>${pill(CLEARANCE_LABEL[m.clearance], CLEARANCE_COLORS[m.clearance])}</td>
        <td>${memberMissing(m)}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="color:#6B7A8D">Equipe não informada no Briefing de Projetos.</td></tr>'
  return `<div class="group">
    <div class="group-header">
      <strong>${esc(ref.client)} · ${esc(ref.windfarm)}</strong><br>
      <span>${ref.wo ? `WO ${esc(ref.wo)} · ` : ''}${startLabel(ref)}${ref.scope ? ` · ${esc(ref.scope)}` : ''} · ${source}</span>
    </div>
    <table style="margin:0">
      <thead><tr><th style="width:34%">Colaborador</th><th style="width:22%">Situação</th><th>O que falta</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function laterProjectsTable(projects: ProjectReadiness[]): string {
  if (!projects.length) return ''
  const rows = projects
    .map(p => {
      const ref = p.project
      const cleared = p.members.filter(m => m.clearance === 'CLEARED').length
      const total = p.members.length
      const status =
        total > 0 && cleared === total
          ? `<span style="color:#166534;font-weight:600">Liberado (${cleared}/${total})</span>`
          : `<span style="color:#9A3412;font-weight:600">${cleared}/${total} liberados</span>`

      return `<tr>
        <td><strong>${esc(ref.client)} · ${esc(ref.windfarm)}</strong>${ref.wo ? ` (WO ${esc(ref.wo)})` : ''}</td>
        <td>${formatDay(ref.startDate, false)}</td>
        <td>${total} pessoas</td>
        <td>${status}</td>
      </tr>`
    })
    .join('')

  return `<table style="margin:0 0 16px">
    <thead><tr><th>Projeto</th><th>Início</th><th>Equipe</th><th>Prontidão</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function gapReason(gap: CoverageGap): string {
  if (!gap.portals.length) return 'Portal não cadastrado na base EHS'
  const portal = gap.portals[0]
  if (portal.automation === 'MANUAL')
    return `Documentação enviada por ${portal.system}, sem status para ler`
  if (portal.note) return portal.note
  return 'Leitura automática ainda não construída'
}

function gapsTable(gaps: CoverageGap[]): string {
  if (!gaps.length) return ''
  const rows = gaps
    .map(
      g => `<tr>
      <td><strong>${esc(g.client)}</strong></td>
      <td>${g.projects}</td>
      <td>${g.people}</td>
      <td>${formatDay(g.nextStart, false)}</td>
      <td>${esc(g.portals.map(p => p.name).join(', ') || '—')}<br><span style="color:#6B7A8D">${esc(gapReason(g))}</span></td>
    </tr>`
    )
    .join('')
  return `<table>
    <thead><tr><th>Cliente</th><th>Projetos</th><th>Pessoas</th><th>Início</th><th>Portal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

export function countClearances(
  projects: ProjectReadiness[]
): Record<Clearance, number> & { total: number } {
  const best = new Map<string, Clearance>()
  const rank: Record<Clearance, number> = {
    BLOCKED: 0,
    NOT_REGISTERED: 1,
    WAITING_CLIENT: 2,
    NOT_MONITORED: 3,
    CLEARED: 4,
  }
  // A person on two projects counts once, by their worst situation.
  for (const p of projects)
    for (const m of p.members) {
      const prev = best.get(m.name)
      if (!prev || rank[m.clearance] < rank[prev]) best.set(m.name, m.clearance)
    }
  const counts = {
    total: best.size,
    CLEARED: 0,
    WAITING_CLIENT: 0,
    BLOCKED: 0,
    NOT_REGISTERED: 0,
    NOT_MONITORED: 0,
  }
  for (const c of best.values()) counts[c]++
  return counts
}

export function buildExpiringAlertsHtml(alerts?: ExpiringDocAlert[]): string {
  if (!alerts || !alerts.length) return ''

  const normativos = alerts.filter(a => a.category === 'NORMATIVO')
  const cadastrais = alerts.filter(a => a.category !== 'NORMATIVO')

  const critical = normativos.filter(a => a.urgency === 'CRITICAL_7D')
  const high = normativos.filter(a => a.urgency === 'HIGH_15D')
  const medium = normativos.filter(a => a.urgency === 'MEDIUM_30D')

  let normativosHtml = ''
  if (critical.length > 0) {
    const rows = critical
      .map(a => {
        const urgencyBadge = `<span style="background:#FCE7E3;color:#C1401F;padding:2px 7px;border-radius:999px;font-weight:700;font-size:11px">[CRÍTICO] ${a.daysToExpiry}d</span>`

        return `<tr>
          <td>
            <strong>${esc(displayName(a.worker))}</strong><br>
            <span style="font-size:11px;color:#7C2D12">${esc(a.client)} · ${esc(a.windfarm)}${a.wo ? ` (WO ${esc(a.wo)})` : ''}</span>
          </td>
          <td>
            <strong>${esc(a.docName)}</strong><br>
            <span style="font-size:11px;color:#9A3412">Validade: <strong>${formatDay(a.expirationDate)}</strong></span>
          </td>
          <td style="text-align:center">${urgencyBadge}</td>
          <td>
            <span style="font-size:11px;color:#B91C1C"><strong>Risco:</strong> ${esc(a.risk)}</span><br>
            <span style="font-size:11px;color:#047857"><strong>Ação:</strong> ${esc(a.recommendedAction)}</span>
          </td>
        </tr>`
      })
      .join('')

    normativosHtml = `
      <div style="background:#FFF7ED;border:2px solid #EA580C;border-radius:8px;padding:12px 16px;margin:16px 0">
        <div style="margin-bottom:6px">
          <strong style="color:#9A3412;font-size:14px">[ALERTA OPERACIONAL] CURSOS E EXAMES NORMATIVOS VENCENDO EM CAMPO (&le; 7 DIAS)</strong>
        </div>
        <p style="margin:0 0 8px 0;font-size:12px;color:#7C2D12">
          <strong>Atenção EHS e Coordenação:</strong> ${critical.length} curso(s)/ASO com <strong>vencimento em até 7 dias</strong> geram risco de paralisação ou bloqueio imediato na portaria do parque.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 8px;font-size:11px;background:#FFFFFF;border:1px solid #FDBA74;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#FFEDD5;color:#7C2D12;text-align:left">
              <th style="padding:6px 8px;border-bottom:2px solid #FDBA74">Colaborador / Campanha</th>
              <th style="padding:6px 8px;border-bottom:2px solid #FDBA74">Documento / Validade</th>
              <th style="padding:6px 8px;border-bottom:2px solid #FDBA74;text-align:center">Prazo</th>
              <th style="padding:6px 8px;border-bottom:2px solid #FDBA74">Risco e Ação Necessária</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:11px;color:#9A3412;background:#FED7AA;padding:5px 8px;border-radius:4px">
          <strong>Médio Prazo:</strong> Mais <strong>${high.length} itens vencem em até 15 dias</strong> e <strong>${medium.length} itens em até 30 dias</strong>. A relação nominal completa de todos os ${normativos.length} vencimentos está na aba <em>'Alertas Vencimento (30d)'</em> da planilha anexa.
        </div>
      </div>
    `
  }

  let cadastraisHtml = ''
  if (cadastrais.length > 0) {
    const byWorker = new Map<string, ExpiringDocAlert[]>()
    for (const c of cadastrais) {
      byWorker.set(c.worker, [...(byWorker.get(c.worker) || []), c])
    }

    const workerRows = Array.from(byWorker.entries())
      .map(([worker, list]) => {
        const first = list[0]
        const docList = list.map(d => shortTitle(d.docName)).join(', ')
        const isNovato = first.category === 'EXPERIENCIA_CLT'
        const badge = isNovato
          ? `<span style="background:#DBEAFE;color:#1E40AF;padding:2px 7px;border-radius:999px;font-weight:700;font-size:10px">EXPERIÊNCIA (45D)</span>`
          : `<span style="background:#E0E7FF;color:#3730A3;padding:2px 7px;border-radius:999px;font-weight:700;font-size:10px">REVALIDAÇÃO ANUAL</span>`

        return `<tr>
          <td>
            <strong>${esc(displayName(worker))}</strong><br>
            <span style="font-size:11px;color:#1E3A8A">${esc(first.client)} · ${esc(first.windfarm)}${first.wo ? ` (WO ${esc(first.wo)})` : ''}</span>
          </td>
          <td>
            <span style="font-size:11px"><strong>${esc(docList)}</strong></span><br>
            <span style="font-size:11px;color:#1E40AF">Prazo no portal: ${formatDay(first.expirationDate)} (${first.daysToExpiry} dias)</span>
          </td>
          <td style="text-align:center">${badge}</td>
          <td style="font-size:11px;color:#15803D">
            <strong>Ação RH:</strong> ${esc(first.recommendedAction)}
          </td>
        </tr>`
      })
      .join('')

    cadastraisHtml = `
      <div style="background:#EFF6FF;border:2px solid #3B82F6;border-radius:8px;padding:12px 16px;margin:16px 0">
        <div style="margin-bottom:6px">
          <strong style="color:#1E40AF;font-size:14px">[AVISO RH] REVALIDAÇÕES CADASTRÁIS NO PORTAL DO CLIENTE (EXPERIÊNCIA CLT E E-SOCIAL)</strong>
        </div>
        <p style="margin:0 0 8px 0;font-size:12px;color:#1E3A8A">
          Colaboradores CLT ativos e regulares. As datas no portal decorrem do <strong>término do 1º período de experiência (45d)</strong> de novatos (admitidos em 05/10/2026) ou de ciclo anual no Veriduss/Goldwind. Não há irregularidade contratual, mas requer envio de termo de prorrogação ou e-Social recente antes do prazo para evitar bloqueio automático na portaria.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0;font-size:11px;background:#FFFFFF;border:1px solid #93C5FD;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#DBEAFE;color:#1E40AF;text-align:left">
              <th style="padding:6px 8px;border-bottom:2px solid #93C5FD">Colaborador / Campanha</th>
              <th style="padding:6px 8px;border-bottom:2px solid #93C5FD">Documentos no Portal</th>
              <th style="padding:6px 8px;border-bottom:2px solid #93C5FD;text-align:center">Classificação</th>
              <th style="padding:6px 8px;border-bottom:2px solid #93C5FD">Ação Recomendada (RH)</th>
            </tr>
          </thead>
          <tbody>${workerRows}</tbody>
        </table>
      </div>
    `
  }

  return normativosHtml + cadastraisHtml
}

export function buildOpsReadinessBodyHtml(
  report: PortalPendencyReport,
  ehsContact: string
): string {
  const monitored = report.projects.filter(p => p.monitored.length)
  const urgent = monitored.filter(
    p => (p.project.daysToStart ?? 0) <= report.window.urgentDays
  )
  const later = monitored.filter(
    p => (p.project.daysToStart ?? 0) > report.window.urgentDays
  )
  const c = countClearances(report.projects)

  return `
    <p style="margin:0 0 6px;font-size:14px">Resumo executivo de prontidão documental das equipes escaladas no Briefing.</p>
    <p style="margin:0 0 16px;font-size:12px;color:#6B7A8D">Projetos com início nos últimos ${report.window.lookbackDays} dias e próximos ${report.window.lookaheadDays} dias. Referência: ${formatDay(report.refDate)}.</p>
    ${kpiTable([
      ['Pessoas escaladas', c.total],
      ['Liberadas', c.CLEARED, '#1E7A4C'],
      ['Bloqueadas', c.BLOCKED, '#C1401F'],
      ['Sem cadastro', c.NOT_REGISTERED, '#B45A1E'],
      ['Aguardando cliente', c.WAITING_CLIENT, '#25386B'],
      ['Portal s/ leitura', c.NOT_MONITORED, '#475569'],
    ])}
    ${buildExpiringAlertsHtml(report.expiringAlerts)}
    ${urgent.length ? `<h3 style="color:#25386B;font-size:15px;margin:16px 0 10px">Campanhas em andamento ou iniciando em até ${report.window.urgentDays} dias</h3>${urgent.map(projectBlock).join('')}` : ''}
    ${later.length ? `<h3 style="color:#25386B;font-size:15px;margin:20px 0 8px">Próximas semanas (mobilizações futuras)</h3>${laterProjectsTable(later)}` : ''}
    ${report.gaps.length ? `<h3 style="color:#25386B;font-size:15px;margin:20px 0 6px">Clientes cujo portal ainda não é lido automaticamente</h3><p style="margin:0 0 6px;font-size:12px;color:#6B7A8D">Para estes, confirmar a liberação com a equipe EHS.</p>${gapsTable(report.gaps)}` : ''}
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px 14px;margin-top:16px;font-size:12px;color:#475569">
      <strong>[Planilha Anexa]:</strong> O arquivo <em>pendencias-portais-${report.refDate}.xlsx</em> contém o detalhamento individual completo por colaborador e projeto. Dúvidas: ${esc(ehsContact)}.
    </div>
  `
}

function actionDetail(a: PortalAction): string {
  const parts: string[] = []
  if (a.status === 'EXPIRED' || a.status === 'EXPIRING')
    parts.push(`${DOC_STATUS_LABEL[a.status]} ${formatDay(a.expiresOn)}`)
  else parts.push(DOC_STATUS_LABEL[a.status])
  if (a.note) parts.push(esc(a.note))
  if (a.evidence) {
    const label = `Base HSE: ${esc(a.evidence.docName)}${a.evidence.expiresOn ? ` até ${formatDay(a.evidence.expiresOn)}` : ''}`
    parts.push(label)
  }
  return parts.join(' · ')
}

const MAX_ACTIONS_SHOWN_PER_WORKER = 3

function priorityByWorker(actions: PortalAction[]): string {
  const groups = new Map<string, PortalAction[]>()
  for (const a of actions) {
    const key = `${a.portalId}|${a.worker}`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  return Array.from(groups.values())
    .map(list => {
      const first = list[0]
      const project = first.project!
      const shown = list.slice(0, MAX_ACTIONS_SHOWN_PER_WORKER)
      const remaining = list.length - shown.length
      const rows = shown
        .map(
          a => `<tr>
          <td>${esc(shortTitle(a.document))}</td>
          <td>${pill(ACTION_LABEL[a.kind], ACTION_COLORS[a.kind])}</td>
          <td>${actionDetail(a)}</td>
        </tr>`
        )
        .join('')
      const moreRow =
        remaining > 0
          ? `<tr><td colspan="3" style="color:#6B7A8D;font-size:11px;background:#F8FAFC;padding:6px 10px">+${remaining} outra(s) ação(ões) detalhada(s) na aba 'Fila de ações' da planilha anexa</td></tr>`
          : ''
      return `<div class="group">
        <div class="group-header">
          <strong>${esc(displayName(first.worker))}</strong> (${list.length} pendência(s))<br>
          <span>${esc(first.portalName)} · ${esc(project.client)} / ${esc(project.windfarm)} · ${startLabel(project)}</span>
        </div>
        <table style="margin:0">
          <thead><tr><th style="width:40%">Documento</th><th style="width:20%">Ação</th><th>Detalhe</th></tr></thead>
          <tbody>${rows}${moreRow}</tbody>
        </table>
      </div>`
    })
    .join('')
}

const STALE_AFTER_DAYS = 3

export function buildEhsQueueBodyHtml(report: PortalPendencyReport): string {
  const scheduled = report.actions.filter(a => a.priority < 3)
  const backlog = report.actions.filter(
    a => a.priority === 3 && a.onActiveRoster
  )
  const offRoster = report.actions.filter(
    a => a.priority === 3 && !a.onActiveRoster
  )
  const count = (kind: ActionKind) =>
    scheduled.filter(a => a.kind === kind).length
  const refMs = Date.parse(report.refDate)

  const portalRows = report.portals
    .map(p => {
      const age = Math.floor((refMs - Date.parse(p.capturedAt)) / 86_400_000)
      const stale =
        age > STALE_AFTER_DAYS
          ? ` <span style="color:#C1401F">(${age} dias)</span>`
          : ''
      return `<tr>
        <td><strong>${esc(p.portal.name)}</strong><br><span style="color:#6B7A8D">dados de ${formatDay(p.capturedAt, false)}${stale}</span></td>
        <td style="text-align:center">${p.blocked} de ${p.workers}</td>
        <td style="text-align:center">${p.actions.RESUBMIT}</td>
        <td style="text-align:center">${p.actions.UPLOAD_FROM_BASE}</td>
        <td style="text-align:center">${p.actions.OBTAIN}</td>
        <td style="text-align:center">${p.actions.RENEW}</td>
      </tr>`
    })
    .join('')

  const backlogPeople = new Set(backlog.map(a => `${a.portalId}|${a.worker}`))
    .size

  return `
    <p style="margin:0 0 6px;font-size:14px">Resumo executivo da fila de documentação em portais de clientes (pessoas escaladas no Briefing).</p>
    <p style="margin:0 0 16px;font-size:12px;color:#6B7A8D">Referência: ${formatDay(report.refDate)}. Planilha analítica completa em anexo.</p>
    ${kpiTable([
      ['Ações p/ escalados', scheduled.length],
      ['Reenviar', count('RESUBMIT'), '#C1401F'],
      ['Subir (já temos)', count('UPLOAD_FROM_BASE'), '#1E7A4C'],
      ['Providenciar', count('OBTAIN'), '#B45A1E'],
      ['Renovar', count('RENEW'), '#25386B'],
    ])}
    ${buildExpiringAlertsHtml(report.expiringAlerts)}
    <h3 style="color:#25386B;font-size:15px;margin:16px 0 10px">Pessoas escaladas com pendências</h3>
    ${scheduled.length ? priorityByWorker(scheduled) : '<p style="color:#6B7A8D">Nenhuma pendência para quem está escalado nos portais monitorados.</p>'}
    <h3 style="color:#25386B;font-size:15px;margin:20px 0 10px">Situação consolidada por portal</h3>
    <table>
      <thead><tr><th>Portal</th><th style="text-align:center">Bloqueadas</th><th style="text-align:center">Reenviar</th><th style="text-align:center">Subir</th><th style="text-align:center">Provid.</th><th style="text-align:center">Renovar</th></tr></thead>
      <tbody>${portalRows}</tbody>
    </table>
    <p style="margin:12px 0 0;font-size:13px">Sem projeto na janela: <strong>${backlog.length}</strong> ações para <strong>${backlogPeople}</strong> pessoas do RPO ativo.${offRoster.length ? ` Outras <strong>${offRoster.length}</strong> são de pessoas que não estão no RPO ativo: avaliar se o cadastro no portal deve ser inativado.` : ''}</p>
    ${report.gaps.length ? `<h3 style="color:#25386B;font-size:15px;margin:20px 0 6px">Clientes com equipe escalada e portal sem leitura automática</h3>${gapsTable(report.gaps)}` : ''}
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px 14px;margin-top:16px;font-size:12px;color:#475569">
      <strong>[Planilha Anexa]:</strong> O arquivo <em>pendencias-portais-${report.refDate}.xlsx</em> em anexo contém a íntegra das 591 ações com links diretos do Google Drive para submissão imediata.
    </div>
  `
}
