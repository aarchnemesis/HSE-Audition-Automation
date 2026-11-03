import { describe, expect, it, vi } from 'vitest'
import { TelegramAlertService } from './TelegramAlertService.js'

describe('TelegramAlertService', () => {
  it('formata o daily digest corretamente e chama fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    globalThis.fetch = fetchMock

    const service = new TelegramAlertService({
      botToken: '123456:FAKE_TOKEN',
      chatId: '7319954065',
    })

    const success = await service.sendDailyDigest({
      updatedAt: '03/11/2026 13:00',
      totalPlatforms: 7,
      onlinePlatforms: 7,
      totalAllocated: 45,
      totalBlocked: 15,
      totalRejections: 30,
      imminentBlockades: [
        {
          workerName: 'ANTONIO RAFAEL DOS SANTOS',
          projectName: 'Complexo Eólico Trairi',
          client: 'GE VERNOVA',
          portal: 'Suricatta (Surisoft)',
          daysToStart: 2,
          pendingDocs: ['ASO'],
        },
      ],
      criticalActionsByTeam: {
        EHS: 12,
        DO: 8,
        RH: 7,
        FIELD: 3,
      },
    })

    expect(success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callArgs = fetchMock.mock.calls[0]
    expect(callArgs[0]).toContain('/bot123456:FAKE_TOKEN/sendMessage')
    const body = JSON.parse(callArgs[1].body)
    expect(body.chat_id).toBe('7319954065')
    expect(body.text).toContain('ANTONIO RAFAEL DOS SANTOS')
    expect(body.text).toContain('Panorama Operacional dos Portais')
  })
})
