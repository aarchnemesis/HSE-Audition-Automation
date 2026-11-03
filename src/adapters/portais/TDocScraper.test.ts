import { describe, expect, it } from 'vitest'
import { defaultTDocSelectors, parseTaskRows } from './TDocScraper.js'

describe('parseTaskRows', () => {
  it('keeps rows with an id and carries the owner, dropping the header', () => {
    const tasks = parseTaskRows([
      ['', 'ID', '', '', '', '', '', '', 'Proprietário'],
      ['', '134690', '', '', 'LATAM', '', '', 'BRAZIL', 'SANTO AGOSTINHO'],
      ['', '', '', '', '', '', '', '', ''],
    ])
    expect(tasks).toEqual([{ index: 1, proprietario: 'SANTO AGOSTINHO' }])
  })
})

describe('defaultTDocSelectors', () => {
  it('points each tenant at its own host', () => {
    expect(defaultTDocSelectors('tdoc-sgre').tasksUrl).toContain(
      'wplatam.tdoc.es'
    )
    expect(defaultTDocSelectors('tdoc-pegasus').tasksUrl).toContain(
      'pegasus.tdoc.es'
    )
    expect(defaultTDocSelectors('tdoc-acciona-chile').tasksUrl).toContain(
      'acciona-chile.tdoc.es'
    )
  })
})
