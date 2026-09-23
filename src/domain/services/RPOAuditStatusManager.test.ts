import { describe, expect, it } from 'vitest'
import { RPOAuditStatusManager } from './RPOAuditStatusManager.js'

describe('RPOAuditStatusManager', () => {
  it('identifica corretamente colaboradores validados por default', () => {
    expect(
      RPOAuditStatusManager.isCollabValidated('JOSÉ MARCELO MAGALHÃES SOUSA')
    ).toBe(true)
    expect(
      RPOAuditStatusManager.isCollabValidated('NARDEL DELON NOVAIS ROCHA')
    ).toBe(true)
    expect(
      RPOAuditStatusManager.isCollabValidated('RAMON RAMIRES COSTA CIRINO')
    ).toBe(true)
  })

  it('retorna false para colaborador nao validado ou desconhecido', () => {
    expect(
      RPOAuditStatusManager.isCollabValidated('DESCONHECIDO OU NAO VALIDADO')
    ).toBe(false)
  })

  it('e insensivel a espacos e caixa alta/baixa', () => {
    expect(
      RPOAuditStatusManager.isCollabValidated('  josé marcelo magalhães sousa  ')
    ).toBe(true)
  })
})
