import { describe, expect, it } from 'vitest'
import {
  badgeClassFor,
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
})
