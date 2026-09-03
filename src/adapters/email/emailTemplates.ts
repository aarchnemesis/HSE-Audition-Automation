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
        🚀 Acessar Portal de DO & Treinamentos ao Vivo
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
