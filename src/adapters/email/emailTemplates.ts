import { DigestInspectorGroup } from '../../ports/IEmailService.js'

export const EMAIL_TITLE = 'Alerta EHS - Documentação'

export function badgeClassFor(status: string): string {
  if (status === 'AUSENTE') return 'badge-ausente'
  if (status === 'VENCIDO') return 'badge-vencido'
  if (['VENCE_60', 'VENCE_30', 'VENCE_15', 'VENCE_07'].includes(status))
    return 'badge-atenção'
  if (status === 'SOLICITADO_STORZ') return 'badge-storz'
  if (status === 'STORZ_EM_ANDAMENTO') return 'badge-storz-andamento'
  return 'badge-conforme'
}

export function statusLabelFor(status: string): string {
  if (status === 'AUSENTE') return '⚪ Ausente'
  if (status === 'VENCIDO') return '✘ Vencido'
  if (status === 'VENCE_07') return '⚠️ <7d'
  if (status === 'VENCE_15') return '⏳ <15d'
  if (status === 'VENCE_30') return '⏳ <30d'
  if (status === 'VENCE_60') return '⏳ <60d'
  if (status === 'SOLICITADO_STORZ') return '🎓 Storz'
  if (status === 'STORZ_EM_ANDAMENTO') return '🎓 Storz (Andamento)'
  if (status === 'CONFORME') return '✔ Em Dia'
  return status
}

/**
 * Envolve o conteúdo do e-mail no template com a identidade visual da ArthWind (extraída de
 * arthwind.com.br em 21/08/2026: navy #25386B, coral #ED6F57, fundo suave #DEEFF1). Usado por
 * TODOS os adapters de e-mail (Dummy e SMTP) pra garantir que o visual seja idêntico
 * independente de como o e-mail é entregue.
 */
export function wrapEmailHtml(subject: string, bodyHtml: string): string {
  // Previne duplo cabeçalho caso o HTML já tenha sido envelopado no template ArthWind
  if (
    bodyHtml.includes('class="container"') ||
    bodyHtml.includes('<!DOCTYPE html>')
  ) {
    return bodyHtml
  }

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
  <style>
    body { font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif; background-color: #DEEFF1; margin: 0; padding: 24px; color: #1F2937; }
    .container { max-width: 650px; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #D7E6E8; margin: 0 auto; box-shadow: 0 1px 3px rgba(37,56,107,0.08); }
    .header { background-color: #25386B; padding: 20px 28px; }
    .header img { height: 32px; display: block; }
    .header h2 { color: #ffffff; font-size: 16px; font-weight: 500; margin: 12px 0 0; }
    .body { padding: 24px 28px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
    .badge-conforme { background: #E4F3E9; color: #1E7A4C; }
    .badge-atenção { background: #FDF0E6; color: #B45A1E; }
    .badge-vencido { background: #FCE7E3; color: #C1401F; }
    .badge-ausente { background: #F1F5F9; color: #475569; border: 1px dashed #CBD5E1; }
    .badge-storz { background: #E4EAF5; color: #25386B; }
    .badge-storz-andamento { background: #EDE9FE; color: #5B21B6; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #EEF2F3; font-size: 13px; }
    th { background-color: #F5F9FA; font-weight: 600; color: #25386B; }
    .group { margin-bottom: 20px; border: 1px solid #EEF2F3; border-radius: 8px; overflow: hidden; }
    .group-header { background: #F5F9FA; padding: 10px 14px; border-bottom: 1px solid #EEF2F3; }
    .group-header strong { color: #25386B; font-size: 14px; }
    .group-header span { color: #6B7A8D; font-size: 12px; }
    .footer { padding: 16px 28px; background: #F5F9FA; border-top: 1px solid #EEF2F3; font-size: 11px; color: #6B7A8D; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://arthwind.com.br/assets/Img/logo.png" alt="ArthWind" />
      <h2>${subject || EMAIL_TITLE}</h2>
    </div>
    <div class="body">
      ${bodyHtml}
    </div>
    <div class="footer">
      <p style="margin: 0 0 4px;">Gerado automaticamente pelo HSE Audit Automation &middot; ArthWind</p>
      <p style="margin: 0;">Acesse o painel online a qualquer momento através do portal corporativo.</p>
    </div>
  </div>
</body>
</html>
  `
}

export function buildEHSAlertBodyHtml(
  inspectorName: string,
  parkName: string,
  auditItems: any[]
): string {
  let rowsHtml = ''
  for (const item of auditItems) {
    rowsHtml += `
      <tr>
        <td><strong>${item.code}</strong> - ${item.reqName}</td>
        <td><span class="badge ${badgeClassFor(item.status)}">${statusLabelFor(item.status)}</span></td>
        <td>${item.detail}</td>
      </tr>
    `
  }

  return `
    <p style="margin: 0 0 4px; font-size: 14px;"><strong>Inspetor:</strong> ${inspectorName}</p>
    <p style="margin: 0 0 16px; font-size: 14px;"><strong>Parque destino:</strong> ${parkName}</p>

    <table>
      <thead>
        <tr>
          <th>Documento / Requisito</th>
          <th>Status EHS</th>
          <th>Detalhes & Storz</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `
}

export function buildDigestBodyHtml(groups: DigestInspectorGroup[]): string {
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0)
  const dashboardUrl =
    process.env.HSE_DASHBOARD_URL ||
    'https://hse-audition-automation.vercel.app'

  const ctaButtonHtml = `
    <div style="text-align: center; margin: 20px 0 24px; padding: 18px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
      <p style="margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #1E293B;">
        Visualize a Matriz de Qualificação (Skill Matrix) e o Dossiê completo:
      </p>
      <a href="${dashboardUrl}" target="_blank" style="background-color: #00D2B4; color: #090D16; font-weight: 700; font-size: 13px; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; box-shadow: 0 2px 6px rgba(0,210,180,0.25);">
        Acessar Portal de DO & Treinamentos ao Vivo
      </a>
      <div style="margin-top: 8px; font-size: 11px; color: #64748B;">
        Não é necessário baixar arquivos HTML anexos.
      </div>
    </div>
  `

  if (groups.length === 0) {
    return `
      <p style="font-size: 14px; color: #1E7A4C; font-weight: 600;">Nenhuma pendência encontrada — todo mundo está 100% em dia.</p>
      ${ctaButtonHtml}
    `
  }

  let groupsHtml = ''
  for (const group of groups) {
    let rowsHtml = ''
    for (const item of group.items) {
      rowsHtml += `
        <tr>
          <td><strong>${item.docCode}</strong> - ${item.docName}</td>
          <td><span class="badge ${badgeClassFor(item.status)}">${statusLabelFor(item.status)}</span></td>
          <td>${item.detail}</td>
        </tr>
      `
    }

    groupsHtml += `
      <div class="group">
        <div class="group-header">
          <strong>${group.inspectorName}</strong>
          <span> · ${group.role}${group.sector ? ` · ${group.sector}` : ''} · ${group.items.length} pendência(s)</span>
        </div>
        <table>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `
  }

  return `
    ${ctaButtonHtml}
    <p style="margin: 0 0 16px; font-size: 14px; color: #6B7A8D;">
      <strong style="color: #25386B;">${groups.length}</strong> pessoa(s) com pendência, <strong style="color: #25386B;">${totalItems}</strong> item(ns) no total.
    </p>
    ${groupsHtml}
  `
}

export interface ExecutiveDashboardSummary {
  refDate: Date
  dashboardUrl?: string
  totalCollaborators: number
  aptosCount: number
  aptosRate: number
  bloqueadosCount: number
  emTreinamentoCount: number
  rpoDivergencesCount: number
  sourceHealth?: {
    driveStatus?: string
    smartsheetStatus?: string
    storzStatus?: string
    lastSync?: string
  }
}

export function buildExecutiveDashboardHtml(
  summary: ExecutiveDashboardSummary
): string {
  const dashboardUrl =
    summary.dashboardUrl ||
    process.env.HSE_DASHBOARD_URL ||
    'https://hse-audition-automation.vercel.app'
  const dateStr = summary.refDate.toLocaleDateString('pt-BR')

  const driveHealth = summary.sourceHealth?.driveStatus || 'ONLINE'
  const rpoHealth = summary.sourceHealth?.smartsheetStatus || 'ONLINE'
  const storzHealth = summary.sourceHealth?.storzStatus || 'ONLINE'

  return `
    <p style="margin: 0 0 16px; font-size: 15px; color: #1F2937;">Olá, Equipe Executiva,</p>
    <p style="margin: 0 0 20px; font-size: 13px; color: #4B5563; line-height: 1.5;">
      Segue a atualização executiva dos indicadores de conformidade de HSE, prontuários de campo e treinamentos (DO) da ArthWind atualizados para <strong>${dateStr}</strong>.
    </p>

    <div style="text-align: center; margin: 20px 0 24px; padding: 20px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
      <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1E293B;">
        Painel de Controle e Matriz de Qualificação ao Vivo:
      </p>
      <a href="${dashboardUrl}" target="_blank" style="background-color: #00D2B4; color: #090D16; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; box-shadow: 0 2px 6px rgba(0,210,180,0.25);">
        Acessar Painel Executivo ao Vivo
      </a>
      <div style="margin-top: 8px; font-size: 11px; color: #64748B;">
        Visualização interativa em tempo real &middot; Não é necessário baixar arquivos
      </div>
    </div>

    <table style="width: 100%; border-collapse: separate; border-spacing: 10px; margin-top: 10px;">
      <tr>
        <td style="width: 50%; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; vertical-align: top;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">Total Monitorado</div>
          <div style="font-size: 28px; font-weight: 800; color: #25386B; margin: 6px 0 2px;">${summary.totalCollaborators}</div>
          <div style="font-size: 11px; color: #64748B;">Colaboradores ativos na base</div>
        </td>
        <td style="width: 50%; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 16px; vertical-align: top;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #166534; letter-spacing: 0.5px;">Aptos P/ Campo</div>
          <div style="font-size: 28px; font-weight: 800; color: #059669; margin: 6px 0 2px;">${summary.aptosCount} <span style="font-size: 16px; font-weight: 600;">(${summary.aptosRate}%)</span></div>
          <div style="font-size: 11px; color: #166534;">Mobilizáveis de imediato</div>
        </td>
      </tr>
      <tr>
        <td style="width: 50%; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px; vertical-align: top;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #991B1B; letter-spacing: 0.5px;">Bloqueados (Pendência)</div>
          <div style="font-size: 28px; font-weight: 800; color: #DC2626; margin: 6px 0 2px;">${summary.bloqueadosCount}</div>
          <div style="font-size: 11px; color: #991B1B;">Vencimento ou ausência documental</div>
        </td>
        <td style="width: 50%; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px; vertical-align: top;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #1E40AF; letter-spacing: 0.5px;">Em Treinamento / Storz</div>
          <div style="font-size: 28px; font-weight: 800; color: #2563EB; margin: 6px 0 2px;">${summary.emTreinamentoCount}</div>
          <div style="font-size: 11px; color: #1E40AF;">Matrículas e reciclagens em curso</div>
        </td>
      </tr>
    </table>

    <div style="margin-top: 15px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 14px 18px;">
      <table style="width: 100%; border: none; margin: 0;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: middle;">
            <strong style="color: #92400E; font-size: 13px;">Auditoria Drive x RPO (Divergências de Digitação):</strong>
            <span style="color: #B45309; font-size: 13px; margin-left: 6px;">${summary.rpoDivergencesCount} item(ns) identificado(s)</span>
          </td>
        </tr>
      </table>
    </div>

    <div style="margin-top: 20px; border-top: 1px solid #E2E8F0; padding-top: 16px;">
      <p style="margin: 0 0 10px; font-size: 12px; font-weight: 700; color: #25386B; text-transform: uppercase; letter-spacing: 0.5px;">
        Integridade das Fontes (SSOT)
      </p>
      <table style="width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 6px;">
        <tr>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; color: #475569;">Google Drive (Prontuários Oficiais):</td>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; font-weight: 600; color: #059669;">${driveHealth}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; color: #475569;">Smartsheet RPO (Planilha Operacional):</td>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; font-weight: 600; color: #059669;">${rpoHealth}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; color: #475569;">Storz LMS (Plataforma de Treinamentos):</td>
          <td style="padding: 6px 10px; border-bottom: 1px solid #EEF2F3; font-weight: 600; color: #059669;">${storzHealth}</td>
        </tr>
      </table>
    </div>

    <p style="margin: 20px 0 0; font-size: 12px; color: #64748B; line-height: 1.4;">
      Nota: O detalhamento nominal por colaborador, dossiê digital e matriz de parques podem ser consultados diretamente no painel online.
    </p>
  `
}
