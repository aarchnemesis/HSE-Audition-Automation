export interface TelegramAlertConfig {
  botToken: string
  chatId: string
  apiBaseUrl?: string
}

export interface DigestSummary {
  updatedAt: string
  totalPlatforms: number
  onlinePlatforms: number
  totalAllocated: number
  totalBlocked: number
  totalRejections: number
  imminentBlockades: Array<{
    workerName: string
    projectName: string
    client: string
    portal: string
    daysToStart: number
    pendingDocs: string[]
  }>
  criticalActionsByTeam: {
    EHS: number
    DO: number
    RH: number
    FIELD: number
  }
}

export class TelegramAlertService {
  private botToken: string
  private chatId: string
  private apiBaseUrl: string

  constructor(config?: Partial<TelegramAlertConfig>) {
    this.botToken =
      config?.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      '8835022101:AAFUwlqhSYtl3lMQgEZcO2raARugAiLC7hk'
    this.chatId = config?.chatId || process.env.TELEGRAM_ALERT_CHAT_ID || '7319954065'
    this.apiBaseUrl = config?.apiBaseUrl || 'https://api.telegram.org'
  }

  /**
   * Formata e envia o resumo operacional matinal/vespertino
   */
  public async sendDailyDigest(summary: DigestSummary): Promise<boolean> {
    const lines: string[] = []
    lines.push('📋 *[HSE-Automation] Panorama Operacional dos Portais*')
    lines.push(`🕒 Atualizado em: \`${summary.updatedAt}\``)
    lines.push('')
    lines.push(
      `🌐 *Portais Online:* ${summary.onlinePlatforms}/${summary.totalPlatforms} | *Auditados:* ${summary.totalAllocated}`
    )
    lines.push(
      `⚠️ *Colaboradores Bloqueados:* ${summary.totalBlocked} | *Recusas Ativas:* ${summary.totalRejections}`
    )
    lines.push('')

    if (summary.imminentBlockades.length > 0) {
      lines.push('🚨 *Alerta de Mobilizações nos Próximos 7 Dias:*')
      for (const item of summary.imminentBlockades.slice(0, 5)) {
        const days =
          item.daysToStart === 0
            ? 'Hoje'
            : item.daysToStart < 0
            ? `Há ${Math.abs(item.daysToStart)} dias`
            : `Em ${item.daysToStart} dias`
        lines.push(`• *${item.workerName}* (${days})`)
        lines.push(`  └ Usina: ${item.projectName} | Cliente: ${item.client}`)
        lines.push(`  └ Portal: ${item.portal}`)
        if (item.pendingDocs.length > 0) {
          lines.push(`  └ Pendências: ${item.pendingDocs.slice(0, 2).join(', ')}`)
        }
      }
      if (summary.imminentBlockades.length > 5) {
        lines.push(`  _...e mais ${summary.imminentBlockades.length - 5} colaboradores com pendência._`)
      }
      lines.push('')
    }

    lines.push('🎯 *Distribuição de Planos de Ação por Time:*')
    lines.push(
      `• EHS: *${summary.criticalActionsByTeam.EHS}* | DO: *${summary.criticalActionsByTeam.DO}* | RH: *${summary.criticalActionsByTeam.RH}* | Campo: *${summary.criticalActionsByTeam.FIELD}*`
    )
    lines.push('')
    lines.push('🔗 [Acessar Dashboard Completo](https://hse-audition-automation.vercel.app)')

    const text = lines.join('\n')
    return await this.sendMessage(text, 'Markdown')
  }

  /**
   * Envia uma mensagem para o Telegram
   */
  public async sendMessage(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<boolean> {
    if (!this.botToken || !this.chatId) {
      console.warn('[TelegramAlert] botToken ou chatId não configurados.')
      return false
    }

    try {
      const url = `${this.apiBaseUrl}/bot${this.botToken}/sendMessage`
      const payload = {
        chat_id: this.chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[TelegramAlert] Falha ao enviar (${res.status}):`, errText)
        return false
      }

      return true
    } catch (err) {
      console.error('[TelegramAlert] Erro de rede:', err)
      return false
    }
  }
}
