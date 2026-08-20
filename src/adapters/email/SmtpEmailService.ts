import nodemailer, { Transporter } from 'nodemailer';
import { IEmailService, EmailMessage, DigestInspectorGroup } from '../../ports/IEmailService.js';

const EMAIL_TITLE = 'Alerta EHS - Documentação';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export class SmtpEmailService implements IEmailService {
  private transporter: Transporter;
  private from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass }
    });
  }

  static fromEnv(): SmtpEmailService | null {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

    return new SmtpEmailService({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10),
      secure: parseInt(SMTP_PORT, 10) === 465,
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: process.env.SMTP_FROM || SMTP_USER
    });
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.htmlContent,
        text: message.textContent
      });
      console.log(`[SmtpEmailService] ✉️ E-mail enviado para ${message.to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[SmtpEmailService] Falha ao enviar e-mail para ${message.to}:`, err);
      return { success: false };
    }
  }

  async sendEHSAlert(
    recipient: string,
    inspectorName: string,
    parkName: string,
    auditItems: any[]
  ): Promise<{ success: boolean; filePath?: string }> {
    const subject = `${EMAIL_TITLE} - ${inspectorName}`;

    let rowsHtml = '';
    for (const item of auditItems) {
      rowsHtml += `<tr><td><strong>${item.code}</strong> - ${item.reqName}</td><td>${item.status}</td><td>${item.detail}</td></tr>`;
    }

    const htmlContent = `
      <p><strong>Inspetor:</strong> ${inspectorName}</p>
      <p><strong>Parque Destino:</strong> ${parkName}</p>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr><th>Documento / Requisito</th><th>Status EHS</th><th>Detalhes & Storz</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    const res = await this.sendEmail({ to: recipient, subject, htmlContent });
    return { success: res.success };
  }

  async sendDailyDigest(
    recipient: string,
    groups: DigestInspectorGroup[],
    refDate: Date
  ): Promise<{ success: boolean; filePath?: string }> {
    const subject = `${EMAIL_TITLE} - Resumo (${refDate.toLocaleDateString('pt-BR')})`;

    let groupsHtml = '';
    for (const group of groups) {
      let rowsHtml = '';
      for (const item of group.items) {
        rowsHtml += `<tr><td><strong>${item.docCode}</strong> - ${item.docName}</td><td>${item.status}</td><td>${item.detail}</td></tr>`;
      }
      groupsHtml += `
        <h4>${group.inspectorName} — ${group.role}${group.sector ? ` — ${group.sector}` : ''} (${group.items.length} pendência(s))</h4>
        <table border="1" cellpadding="6" cellspacing="0">
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    const htmlContent = groups.length === 0
      ? '<p>Nenhuma pendência encontrada — todo mundo está em dia.</p>'
      : `<p>${groups.length} pessoa(s) com pendência.</p>${groupsHtml}`;

    const res = await this.sendEmail({ to: recipient, subject, htmlContent });
    return { success: res.success };
  }
}
