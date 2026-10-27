import { describe, expect, it } from 'vitest'
import {
  hostOf,
  parsePortalAccessSheet,
} from './SmartsheetPortalAccessAdapter.js'

describe('hostOf', () => {
  it('reads hosts with or without scheme and ignores placeholders', () => {
    expect(hostOf('www.surisoft.com.br')).toBe('www.surisoft.com.br')
    expect(hostOf('https://pegasus.tdoc.es/TDoc-pegasus/general.jsf')).toBe(
      'pegasus.tdoc.es'
    )
    expect(hostOf('N/A')).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('parsePortalAccessSheet', () => {
  it('keeps status words and drops credentials written in the observations', () => {
    const [row] = parsePortalAccessSheet({
      columns: [
        { id: 1, title: 'CLIENTE' },
        { id: 2, title: 'LINK DE ACESSO' },
        { id: 3, title: 'USUÁRIO' },
        { id: 4, title: 'SENHA' },
        { id: 5, title: 'OBSERVAÇÕES' },
      ],
      rows: [
        {
          cells: [
            { columnId: 1, value: 'CPFL TECH SOCIAL' },
            {
              columnId: 2,
              value: 'https://cpfl-sym-supply.techsocial.com.br/index.php',
            },
            { columnId: 3, value: 'someone' },
            { columnId: 4, value: 's3cret' },
            {
              columnId: 5,
              value: 'Documentos trabalhistas fulano@arthwind.com.br s3cret',
            },
          ],
        },
      ],
    })
    expect(row).toEqual({
      client: 'CPFL TECH SOCIAL',
      channel: '',
      host: 'cpfl-sym-supply.techsocial.com.br',
      status: 'Documentos trabalhistas',
      hasCredentials: true,
    })
    expect(JSON.stringify(row)).not.toContain('s3cret')
  })
})
