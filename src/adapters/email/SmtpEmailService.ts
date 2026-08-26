import nodemailer, { Transporter } from 'nodemailer';
import { IEmailService, EmailMessage, DigestInspectorGroup, EmailAttachment } from '../../ports/IEmailService.js';
import { EMAIL_TITLE, wrapEmailHtml, buildEHSAlertBodyHtml, buildDigestBodyHtml } from './emailTemplates.js';

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

  /**
   * `message.htmlContent` é só o CORPO do e-mail (mesmo formato usado pelo DummyEmailService) —
   * sempre envolvido no template com a identidade visual da ArthWind antes de enviar, pra
   * garantir que o e-mail real fique idêntico ao preview gerado localmente.
   */
  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: wrapEmailHtml(message.subject, message.htmlContent),
        text: message.textContent,
        attachments: message.attachments
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
    const res = await this.sendEmail({
      to: recipient,
      subject,
      htmlContent: buildEHSAlertBodyHtml(inspectorName, parkName, auditItems)
    });
    return { success: res.success };
  }

  async sendDailyDigest(
    recipient: string,
    groups: DigestInspectorGroup[],
    refDate: Date,
    attachments?: EmailAttachment[]
  ): Promise<{ success: boolean; filePath?: string }> {
    const subject = `${EMAIL_TITLE} - Resumo (${refDate.toLocaleDateString('pt-BR')})`;
    const res = await this.sendEmail({ to: recipient, subject, htmlContent: buildDigestBodyHtml(groups), attachments });
    return { success: res.success };
  }
}
