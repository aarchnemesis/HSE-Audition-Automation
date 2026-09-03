import fs from 'fs'
import path from 'path'
import {
  DigestInspectorGroup,
  EmailAttachment,
  EmailMessage,
  IEmailService,
} from '../../ports/IEmailService.js'
import {
  EMAIL_TITLE,
  buildDigestBodyHtml,
  buildEHSAlertBodyHtml,
  wrapEmailHtml,
} from './emailTemplates.js'

export class DummyEmailService implements IEmailService {
  private outputDir: string

  constructor(
    outputDir: string = path.join(process.cwd(), 'scratch', 'emails')
  ) {
    this.outputDir = outputDir
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  async sendEmail(
    message: EmailMessage
  ): Promise<{ success: boolean; messageId: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `email_alert_${timestamp}.html`
    const fullPath = path.join(this.outputDir, filename)

    fs.writeFileSync(
      fullPath,
      wrapEmailHtml(message.subject, message.htmlContent),
      'utf-8'
    )
    console.log(`[DummyEmailService] 📧 E-mail dummy gravado em: ${fullPath}`)
    if (message.attachments?.length) {
      console.log(
        `[DummyEmailService] 📎 Anexo(s) que iriam junto: ${message.attachments.map(a => a.filename).join(', ')}`
      )
    }

    return { success: true, messageId: filename }
  }

  async sendEHSAlert(
    recipient: string,
    inspectorName: string,
    parkName: string,
    auditItems: any[]
  ): Promise<{ success: boolean; filePath: string }> {
    const subject = `${EMAIL_TITLE} - ${inspectorName}`
    const res = await this.sendEmail({
      to: recipient,
      subject,
      htmlContent: buildEHSAlertBodyHtml(inspectorName, parkName, auditItems),
    })

    return { success: res.success, filePath: res.messageId }
  }

  async sendDailyDigest(
    recipient: string,
    groups: DigestInspectorGroup[],
    refDate: Date,
    attachments?: EmailAttachment[]
  ): Promise<{ success: boolean; filePath?: string }> {
    const subject = `${EMAIL_TITLE} - Resumo (${refDate.toLocaleDateString('pt-BR')})`
    const res = await this.sendEmail({
      to: recipient,
      subject,
      htmlContent: buildDigestBodyHtml(groups),
      attachments,
    })
    return { success: res.success, filePath: res.messageId }
  }
}
