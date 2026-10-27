import { describe, expect, it } from 'vitest'
import { namesMatch, resolveTeam, splitTeam } from './PersonNameMatcher.js'

describe('namesMatch', () => {
  it('matches a short form inside the full name, ignoring accents and particles', () => {
    expect(namesMatch('Gabriel Lima', 'GABRIEL LIMA FEITOSA')).toBe(true)
    expect(
      namesMatch('Eraldo Antônio de Moura', 'ERALDO ANTONIO DE MOURA')
    ).toBe(true)
  })

  it('folds spelling drift between sheets', () => {
    expect(namesMatch('Diego Meneses', 'DIEGO MENEZES NUNES COELHO')).toBe(true)
    expect(
      namesMatch('Lucas Andre de Souza Ribeiro', 'LUCAS ANDRE DE SOUSA RIBEIRO')
    ).toBe(true)
  })

  it('needs the same first name and at least two tokens', () => {
    expect(namesMatch('Lima Feitosa', 'GABRIEL LIMA FEITOSA')).toBe(false)
    expect(namesMatch('Gabriel', 'GABRIEL LIMA FEITOSA')).toBe(false)
    expect(namesMatch('Gabriel Souza', 'GABRIEL LIMA FEITOSA')).toBe(false)
  })
})

describe('splitTeam', () => {
  it('splits on the separators the briefing uses and drops annotations', () => {
    expect(
      splitTeam(
        'David Loyola, Diego Menezes; José Orlando [loto] / Ana (backup)'
      )
    ).toEqual(['David Loyola', 'Diego Menezes', 'José Orlando', 'Ana'])
  })
})

describe('resolveTeam', () => {
  const roster = [
    'ERALDO ANTONIO DE MOURA',
    'WILDEN ALVES FERREIRA',
    'FRANCISCO VINICIUS SOUSA DOS SANTOS',
    'FRANCISCO ELVISON PEREIRA DE SOUSA',
    'CAIO VICTOR OLIVEIRA BALBINO',
    'CAIO FELIPE RIBEIRO RODRIGUES',
    'ADENILCO QUEIROZ DA SILVA',
    'Wilden Alves Ferreira',
  ]

  it('resolves short names, unique first names and duplicates across sources', () => {
    const team = resolveTeam('Adenilço, Caio Victor, Wilden Alves', roster)
    expect(team.map(m => m.name)).toEqual([
      'ADENILCO QUEIROZ DA SILVA',
      'CAIO VICTOR OLIVEIRA BALBINO',
      'WILDEN ALVES FERREIRA',
    ])
    expect(team.every(m => m.resolved)).toBe(true)
  })

  it('flags a bare first name shared by two people as ambiguous', () => {
    const [member] = resolveTeam('Caio', roster)
    expect(member).toMatchObject({
      resolved: false,
      ambiguous: true,
      name: 'Caio',
    })
  })

  it('splits names glued without a separator', () => {
    expect(
      resolveTeam('Eraldo Antônio de Moura Wilden Alves Ferreira', roster).map(
        m => m.name
      )
    ).toEqual(['ERALDO ANTONIO DE MOURA', 'WILDEN ALVES FERREIRA'])
    expect(
      resolveTeam(
        'Francisco Vinicius Sousa Dos Santos Francisco Elvison Pereira de Sousa',
        roster
      ).map(m => m.name)
    ).toEqual([
      'FRANCISCO VINICIUS SOUSA DOS SANTOS',
      'FRANCISCO ELVISON PEREIRA DE SOUSA',
    ])
  })

  it('keeps unknown people as written', () => {
    expect(resolveTeam('Gerardo Silva', roster)).toEqual([
      {
        raw: 'Gerardo Silva',
        name: 'Gerardo Silva',
        resolved: false,
        ambiguous: false,
      },
    ])
  })
})
