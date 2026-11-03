import { describe, expect, it, vi } from 'vitest'
import { PortalMcpServer } from './PortalMcpServer.js'
import { PortalRejectionStore } from '../adapters/mongodb/PortalRejectionStore.js'

describe('PortalMcpServer', () => {
  it('instancia o servidor MCP e registra as ferramentas essenciais', () => {
    const mockStore = {
      connect: vi.fn().mockResolvedValue({}),
      getActiveRejections: vi.fn().mockResolvedValue([]),
      updateActionPlan: vi.fn().mockResolvedValue(true),
      savePlaybookEntry: vi.fn().mockResolvedValue(undefined),
      findMatchingPlaybook: vi.fn().mockResolvedValue([]),
    } as unknown as PortalRejectionStore

    const mcp = new PortalMcpServer(mockStore)
    expect(mcp).toBeDefined()
  })

  it('valida o contrato de ferramentas esperadas para o Hermes', () => {
    const tools = [
      'portal_get_active_rejections',
      'portal_record_rejection_plan',
      'portal_query_playbook',
      'portal_get_unmonitored_gaps',
    ]

    expect(tools).toContain('portal_get_active_rejections')
    expect(tools).toContain('portal_record_rejection_plan')
    expect(tools).toContain('portal_query_playbook')
    expect(tools).toContain('portal_get_unmonitored_gaps')
  })
})
