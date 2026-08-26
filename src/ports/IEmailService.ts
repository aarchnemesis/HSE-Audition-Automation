export interface EmailAttachment {
  filename: string;
  path: string; // caminho local do arquivo — nodemailer lê e anexa
}

export interface EmailMessage {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachments?: EmailAttachment[];
}

export interface DigestPendencyItem {
  docCode: string;
  docName: string;
  status: string;
  detail: string;
}

export interface DigestInspectorGroup {
  inspectorName: string;
  role: string;
  sector?: string;
  items: DigestPendencyItem[];
}

export interface IEmailService {
  sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string }>;
  sendEHSAlert(
    recipient: string,
    inspectorName: string,
    parkName: string,
    auditItems: any[]
  ): Promise<{ success: boolean; filePath?: string }>;
  /** Resumo consolidado: um único e-mail agrupando todas as pessoas com pendência e quais são.
   *  `attachments` é usado pra anexar o Excel/relatório completo junto do resumo. */
  sendDailyDigest(
    recipient: string,
    groups: DigestInspectorGroup[],
    refDate: Date,
    attachments?: EmailAttachment[]
  ): Promise<{ success: boolean; filePath?: string }>;
}
