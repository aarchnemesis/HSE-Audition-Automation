import { describe, expect, it } from 'vitest'
import { parseBriefingSheet } from './SmartsheetBriefingAdapter.js'

describe('parseBriefingSheet', () => {
  it('maps the briefing columns and skips rows without a client', () => {
    const projects = parseBriefingSheet({
      columns: [
        { id: 1, title: 'Status.' },
        { id: 2, title: 'WO' },
        { id: 3, title: 'Cliente' },
        { id: 4, title: 'Windfarm' },
        { id: 5, title: 'Inicio do Projeto' },
        { id: 6, title: 'Equipe' },
      ],
      rows: [
        {
          cells: [
            { columnId: 1, value: 'Azul' },
            { columnId: 2, value: 'WOOPEN24' },
            { columnId: 3, value: 'GOLDWIND' },
            { columnId: 4, value: 'Serra da Palmeira' },
            { columnId: 5, value: '2026-10-27' },
          ],
        },
        { cells: [{ columnId: 1, value: 'Verde' }] },
      ],
    })
    expect(projects).toEqual([
      {
        wo: 'WOOPEN24',
        client: 'GOLDWIND',
        windfarm: 'Serra da Palmeira',
        scope: undefined,
        startDate: '2026-10-27',
        status: 'Azul',
        team: '',
      },
    ])
  })
})
