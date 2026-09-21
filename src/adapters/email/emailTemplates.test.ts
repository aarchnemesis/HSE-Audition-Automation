import { describe, expect, it } from 'vitest'
import {
  badgeClassFor,
  buildExecutiveDashboardHtml,
  statusLabelFor,
  wrapEmailHtml,
} from './emailTemplates.js'

describe('emailTemplates', () => {
  it('envelopa bodyHtml com cabeçalho corporativo ArthWind', () => {
    const html = wrapEmailHtml('Assunto Teste', '<p>Conteúdo de teste</p>')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div class="container">')
    expect(html).toContain('<div class="header">')
    expect(html).toContain('Assunto Teste')
    expect(html).toContain('<p>Conteúdo de teste</p>')

    // Deve conter exatamente um container e um header
    const containerMatches = (html.match(/class="container"/g) || []).length
    const headerMatches = (html.match(/class="header"/g) || []).length
    expect(containerMatches).toBe(1)
    expect(headerMatches).toBe(1)
  })

  it('é idempotente e não duplica container nem cabeçalho se chamado múltiplas vezes', () => {
    const wrappedOnce = wrapEmailHtml(
      'Assunto Teste',
      '<p>Conteúdo de teste</p>'
    )
    const wrappedTwice = wrapEmailHtml('Assunto Teste', wrappedOnce)
    const wrappedThrice = wrapEmailHtml('Outro Assunto', wrappedTwice)

    expect(wrappedTwice).toBe(wrappedOnce)
    expect(wrappedThrice).toBe(wrappedOnce)

    const containerMatches = (wrappedTwice.match(/class="container"/g) || [])
      .length
    const headerMatches = (wrappedTwice.match(/class="header"/g) || []).length
    expect(containerMatches).toBe(1)
    expect(headerMatches).toBe(1)
  })

  it('retorna classes de badge e rótulos de status corretos', () => {
    expect(badgeClassFor('AUSENTE')).toBe('badge-ausente')
    expect(badgeClassFor('VENCIDO')).toBe('badge-vencido')
    expect(badgeClassFor('VENCE_15')).toBe('badge-atenção')
    expect(badgeClassFor('CONFORME')).toBe('badge-conforme')

    expect(statusLabelFor('AUSENTE')).toContain('Ausente')
    expect(statusLabelFor('VENCIDO')).toContain('Vencido')
    expect(statusLabelFor('CONFORME')).toContain('Em Dia')
  })

  it('gera HTML do Dashboard Executivo com saudações neutras, KPIs e links corretos', () => {
    const summary = {
      refDate: new Date('2026-09-21T07:30:00Z'),
      dashboardUrl: 'https://hse-audition-automation.vercel.app',
      totalCollaborators: 77,
      frontlineTotal: 67,
      aptosCount: 48,
      aptosRate: 72,
      aptoPlenoCount: 28,
      alertaCount: 20,
      bloqueadosCount: 19,
      emTreinamentoCount: 35,
      totalEmTreinamentoCount: 39,
      rpoDivergencesCount: 385,
      leadersCount: 5,
      officeCount: 5,
      sourceHealth: {
        driveStatus: 'ONLINE',
        smartsheetStatus: 'ONLINE',
        storzStatus: 'ONLINE',
      },
    }

    const html = buildExecutiveDashboardHtml(summary)
    expect(html).toContain('Olá, Equipe Executiva,')
    expect(html).toContain('https://hse-audition-automation.vercel.app')
    expect(html).toContain('Acessar Painel Executivo ao Vivo')
    expect(html).toContain('67')
    expect(html).toContain('48')
    expect(html).toContain('72%')
    expect(html).toContain('19')
    expect(html).toContain('35')
    expect(html).toContain('39 colaboradores')
    expect(html).toContain('385')
    expect(html).toContain('77 colaboradores monitorados')
    expect(html).toContain('Google Drive (Prontuários Oficiais):')

    const wrapped = wrapEmailHtml(
      'Dashboard HSE ArthWind — Atualização Executiva (21/09/2026)',
      html
    )
    expect(wrapped).toContain('class="container"')
    expect(wrapped).toContain('Dashboard HSE ArthWind')
  })
})
