const PARTICLES = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'])

/** Folds the spellings that drift between sheets: SOUZA/SOUSA, MENEZES/MENESES, MATTOS/MATOS. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .split(' ')
    .filter(t => t && !PARTICLES.has(t))
    .map(t =>
      t
        .replace(/Z/g, 'S')
        .replace(/Y/g, 'I')
        .replace(/(.)\1+/g, '$1')
    )
}

function isSubsequence(short: string[], long: string[]): boolean {
  let i = 0
  for (const token of long) if (token === short[i]) i++
  return i === short.length
}

/**
 * The same person is "Gabriel Lima" in the project briefing, "Gabriel Lima Feitosa" in a portal
 * and "GABRIEL LIMA FEITOSA" in the RPO. Two names match when they share the first name and the
 * shorter one (at least two tokens) appears, in order, inside the longer one.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.length < 2 || short[0] !== long[0]) return false
  return isSubsequence(short, long)
}

export interface TeamMember {
  /** Name as written in the briefing */
  raw: string
  /** Canonical name from the roster, or `raw` when unresolved */
  name: string
  resolved: boolean
  /** Several roster people fit `raw` and none could be preferred */
  ambiguous: boolean
}

export function splitTeam(text: string): string[] {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/[,;\n/+]|\s+-\s+|\s+e\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => nameTokens(s).length > 0)
}

/** Keeps one name per person when the roster lists the same person twice (RPO and portal). */
function distinctPeople(names: string[]): string[] {
  const out: string[] = []
  for (const name of [...names].sort((x, y) => y.length - x.length)) {
    if (!out.some(kept => namesMatch(kept, name))) out.push(name)
  }
  return out
}

function candidatesFor(piece: string, roster: string[]): string[] {
  const tokens = nameTokens(piece)
  if (tokens.length === 1)
    return distinctPeople(roster.filter(r => nameTokens(r)[0] === tokens[0]))
  return distinctPeople(roster.filter(r => namesMatch(piece, r)))
}

/** Briefing cells sometimes glue two names without a separator: "Eraldo Moura Wilden Alves". */
function splitGluedNames(piece: string, roster: string[]): string[] {
  const tokens = nameTokens(piece).join(' ')
  return distinctPeople(
    roster.filter(r => {
      const rt = nameTokens(r)
      return rt.length >= 2 && ` ${tokens} `.includes(` ${rt[0]} ${rt[1]} `)
    })
  )
}

export function resolveTeam(text: string, roster: string[]): TeamMember[] {
  const members: TeamMember[] = []
  for (const raw of splitTeam(text)) {
    const candidates = candidatesFor(raw, roster)
    const rawTokens = nameTokens(raw).length
    const leftover =
      candidates.length === 1
        ? rawTokens - nameTokens(candidates[0]).length
        : rawTokens
    if (rawTokens >= 4 && (candidates.length > 1 || leftover >= 2)) {
      const glued = splitGluedNames(raw, roster)
      if (glued.length >= 2) {
        for (const name of glued)
          members.push({ raw, name, resolved: true, ambiguous: false })
        continue
      }
    }
    if (candidates.length === 1) {
      members.push({
        raw,
        name: candidates[0],
        resolved: true,
        ambiguous: false,
      })
      continue
    }
    members.push({
      raw,
      name: raw,
      resolved: false,
      ambiguous: candidates.length > 1,
    })
  }
  const seen = new Set<string>()
  return members.filter(m => {
    const key = nameTokens(m.name).join(' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
