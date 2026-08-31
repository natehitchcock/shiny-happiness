import { describe, expect, it } from 'vitest'
import type { Card, CardType } from '../card.js'
import { oracleId, printingId } from '../ids.js'
import type { Role } from '../role.js'
import type { QueryNode } from './ast.js'
import { describeQuery, formatQuery, toChips } from './format.js'
import { matchesQuery, type AnnotatedCandidate } from './evaluate.js'
import { parseQuery, parseQueryStrict } from './parse.js'

const ast = (input: string): QueryNode | null => {
  const parsed = parseQuery(input)
  if (!parsed.ok) throw new Error('tokenize failed')
  return parsed.value.ast
}
const errorsOf = (input: string) => {
  const parsed = parseQuery(input)
  return parsed.ok ? parsed.value.errors : parsed.error
}

const card = (over: Partial<Card> = {}): Card => ({
  oracleId: oracleId(over.name ?? 'c'),
  name: 'Goblin Bombardment',
  manaCost: '{1}{R}',
  manaValue: 2,
  colorIdentity: ['R'],
  colors: ['R'],
  typeLine: 'Enchantment',
  types: ['enchantment'] as readonly CardType[],
  oracleText: 'Sacrifice a creature: This enchantment deals 1 damage to any target.',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 400,
  defaultPrinting: printingId('p'),
  roles: ['sac-outlet'],
  primaryRole: 'sac-outlet',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

const candidate = (over: Partial<AnnotatedCandidate> = {}): AnnotatedCandidate => ({
  card: over.card ?? card(),
  comboDegree: 0,
  nearCombosAt1: 0,
  roles: (over.card?.roles ?? ['sac-outlet']) as readonly Role[],
  bracketFlags: [],
  priceUsd: 3,
  rarity: 'uncommon',
  setCode: 'tmp',
  power: null,
  toughness: null,
  reserved: false,
  group: null,
  ...over,
})

describe('parsing', () => {
  it('parses a bare word as a name search', () => {
    expect(ast('goblin')).toEqual({
      kind: 'term',
      field: 'name',
      op: ':',
      value: 'goblin',
      quoted: false,
    })
  })

  it('parses a field term', () => {
    expect(ast('t:creature')).toEqual({
      kind: 'term',
      field: 'type',
      op: ':',
      value: 'creature',
      quoted: false,
    })
  })

  it('accepts aliases', () => {
    expect(ast('type:creature')).toEqual(ast('t:creature'))
    expect(ast('cmc<=3')).toEqual(ast('mv<=3'))
    expect(ast('colour:r')).toEqual(ast('c:r'))
  })

  it('parses comparison operators', () => {
    expect(ast('mv<=3')).toMatchObject({ field: 'manaValue', op: '<=', value: '3' })
    expect(ast('combo>=2')).toMatchObject({ field: 'combo', op: '>=', value: '2' })
    expect(ast('pow!=4')).toMatchObject({ field: 'power', op: '!=', value: '4' })
  })

  it('parses a quoted phrase, spaces and all', () => {
    expect(ast('o:"create a treasure token"')).toMatchObject({
      field: 'oracle',
      value: 'create a treasure token',
      quoted: true,
    })
  })

  it('treats juxtaposition as AND', () => {
    expect(ast('t:creature mv<=3')).toMatchObject({
      kind: 'and',
      children: [{ field: 'type' }, { field: 'manaValue' }],
    })
  })

  it('parses or, and negation', () => {
    expect(ast('t:instant or t:sorcery')).toMatchObject({ kind: 'or' })
    expect(ast('-t:land')).toMatchObject({ kind: 'not', child: { field: 'type' } })
  })

  it('parses parentheses', () => {
    expect(ast('t:goblin (kw:haste or o:"can\'t be blocked")')).toMatchObject({
      kind: 'and',
      children: [{ kind: 'term' }, { kind: 'or' }],
    })
  })

  it('is case-insensitive for fields and for or', () => {
    expect(ast('T:Creature OR t:land')).toMatchObject({ kind: 'or' })
  })

  it('parses an empty query as no filter', () => {
    expect(ast('')).toBeNull()
    expect(ast('   ')).toBeNull()
  })
})

describe('errors are reported, never ignored', () => {
  it('rejects an unknown field and suggests a real one', () => {
    const errors = errorsOf('typ:creature')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/unknown field "typ"/)
    expect(errors[0]!.suggestion).toMatch(/t:|type:/)
    expect(errors[0]!.position).toBe(0)
    expect(errors[0]!.length).toBe(3)
  })

  it('does not silently match everything on an unknown field', () => {
    // The failure mode this rule exists to prevent.
    const result = parseQueryStrict('typ:creature')
    expect(result.ok).toBe(false)
  })

  it('rejects a non-numeric value for a numeric field', () => {
    const errors = errorsOf('mv<=lots')
    expect(errors[0]!.message).toMatch(/needs a number/)
  })

  it('rejects an unknown is: predicate and lists real ones', () => {
    const errors = errorsOf('is:shiny')
    expect(errors[0]!.message).toMatch(/unknown predicate/)
    expect(errors[0]!.suggestion).toMatch(/permanent/)
  })

  it('rejects an unknown role', () => {
    expect(errorsOf('role:vibes')[0]!.message).toMatch(/unknown role/)
  })

  it('reports an unclosed quote and an unclosed paren', () => {
    expect(errorsOf('o:"unfinished')[0]!.message).toMatch(/unclosed quote/)
    expect(errorsOf('(t:creature')[0]!.message).toMatch(/unclosed \(/)
  })

  it('keeps the complete prefix usable while a trailing term is incomplete', () => {
    // Without this, results flicker to empty on every keystroke.
    const parsed = parseQuery('t:creature mv<=3 o:')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.errors).toHaveLength(1)
    expect(parsed.value.ast).toMatchObject({ kind: 'and' })
    expect(formatQuery(parsed.value.ast)).toBe('t:creature mv<=3')
  })
})

describe('formatQuery is idempotent', () => {
  it.each([
    't:creature',
    't:creature mv<=3',
    'combo>=2 -flag:game-changer',
    'o:"create a treasure token"',
    't:instant or t:sorcery',
    '-t:land',
    'role:ramp mv<=2 price<=5',
    'is:permanent',
  ])('round-trips %s', (input) => {
    const once = formatQuery(ast(input))
    const twice = formatQuery(ast(once))
    expect(twice).toBe(once)
  })

  it('preserves grouping when an or sits inside an and', () => {
    const text = formatQuery(ast('t:goblin (kw:haste or kw:flying)'))
    expect(formatQuery(ast(text))).toBe(text)
    expect(text).toContain('(')
  })

  it('quotes a value that needs quoting', () => {
    expect(formatQuery(ast('o:"draw a card"'))).toBe('o:"draw a card"')
  })
})

describe('describeQuery', () => {
  it('reads as plain English', () => {
    expect(describeQuery(ast('t:instant mv<=2'))).toBe('type instant, mana value at most 2')
    expect(describeQuery(ast('combo>=2'))).toBe('combos completed at least 2')
    expect(describeQuery(null)).toBe('no filter')
  })
})

describe('toChips', () => {
  it('returns a chip per top-level term', () => {
    expect(toChips(ast('t:creature mv<=3 combo>=2'))).toHaveLength(3)
  })

  it('keeps a negated term as one chip', () => {
    expect(toChips(ast('-t:land'))).toHaveLength(1)
  })

  it('returns null for a nested query rather than faking a chip', () => {
    // doc 13 §13.4 — the bar drops to raw text and says why.
    expect(toChips(ast('t:goblin (kw:haste or kw:flying)'))).toBeNull()
    expect(toChips(ast('t:instant or t:sorcery'))).toBeNull()
  })

  it('returns no chips for an empty query', () => {
    expect(toChips(null)).toEqual([])
  })
})

describe('evaluation', () => {
  const bombardment = candidate()

  it('matches on name, type and oracle text, case-insensitively', () => {
    expect(matchesQuery(ast('bombard'), bombardment)).toBe(true)
    expect(matchesQuery(ast('t:enchantment'), bombardment)).toBe(true)
    expect(matchesQuery(ast('o:"sacrifice a creature"'), bombardment)).toBe(true)
    expect(matchesQuery(ast('t:creature'), bombardment)).toBe(false)
  })

  it('compares mana value', () => {
    expect(matchesQuery(ast('mv<=2'), bombardment)).toBe(true)
    expect(matchesQuery(ast('mv<2'), bombardment)).toBe(false)
    expect(matchesQuery(ast('mv=2'), bombardment)).toBe(true)
  })

  it('filters on combo degree — the field Scryfall cannot express', () => {
    expect(matchesQuery(ast('combo>=2'), candidate({ comboDegree: 3 }))).toBe(true)
    expect(matchesQuery(ast('combo>=2'), candidate({ comboDegree: 1 }))).toBe(false)
    expect(matchesQuery(ast('near>=2'), candidate({ nearCombosAt1: 2 }))).toBe(true)
  })

  it('filters on our derived roles', () => {
    expect(matchesQuery(ast('role:sac-outlet'), bombardment)).toBe(true)
    expect(matchesQuery(ast('role:ramp'), bombardment)).toBe(false)
  })

  it('filters on bracket flags', () => {
    const gc = candidate({ bracketFlags: ['game-changer'] })
    expect(matchesQuery(ast('flag:game-changer'), gc)).toBe(true)
    expect(matchesQuery(ast('-flag:game-changer'), gc)).toBe(false)
    expect(matchesQuery(ast('-flag:game-changer'), bombardment)).toBe(true)
  })

  it('handles colour subset and exact comparisons', () => {
    const gruul = candidate({ card: card({ colors: ['R', 'G'], colorIdentity: ['R', 'G'] }) })
    expect(matchesQuery(ast('c:r'), gruul)).toBe(true)
    expect(matchesQuery(ast('c=rg'), gruul)).toBe(true)
    expect(matchesQuery(ast('c=r'), gruul)).toBe(false)
    expect(matchesQuery(ast('c<=rgw'), gruul)).toBe(true)
    expect(matchesQuery(ast('c:colorless'), candidate({ card: card({ colors: [] }) }))).toBe(true)
  })

  it('handles rarity ordering', () => {
    expect(matchesQuery(ast('r>=uncommon'), bombardment)).toBe(true)
    expect(matchesQuery(ast('r>=mythic'), bombardment)).toBe(false)
  })

  it('handles is: predicates', () => {
    expect(matchesQuery(ast('is:permanent'), bombardment)).toBe(true)
    expect(matchesQuery(ast('is:creature'), bombardment)).toBe(false)
    expect(matchesQuery(ast('is:vanilla'), candidate({ card: card({ oracleText: '' }) }))).toBe(
      true,
    )
  })

  it('combines and, or and not', () => {
    expect(matchesQuery(ast('t:enchantment mv<=2'), bombardment)).toBe(true)
    expect(matchesQuery(ast('t:enchantment mv<=1'), bombardment)).toBe(false)
    expect(matchesQuery(ast('t:creature or t:enchantment'), bombardment)).toBe(true)
    expect(matchesQuery(ast('-t:creature'), bombardment)).toBe(true)
  })

  it('matches everything when there is no query', () => {
    expect(matchesQuery(null, bombardment)).toBe(true)
  })

  it('does not match on a field the candidate has no data for', () => {
    const noPrice = candidate({ priceUsd: null })
    expect(matchesQuery(ast('price<=10'), noPrice)).toBe(false)
  })

  it('never matches printing-level predicates it cannot decide', () => {
    // Better to match nothing than to silently match everything.
    expect(matchesQuery(ast('is:reprint'), bombardment)).toBe(false)
  })
})

describe('filtering by synergy tag', () => {
  // The tags are shown as chips on every row and were the one thing on screen
  // the filter could not reach: "give me the artifact-ETB payoffs" had to be
  // approximated with `o:` over rules text, which is exactly the guessing the
  // tags exist to replace.
  const etbPayoff = candidate({
    card: card({ name: 'Etherium Sculptor', synergyWants: ['artifact-etb'] }),
  })
  const etbCause = candidate({
    card: card({ name: 'Myr Battlesphere', synergyProduces: ['artifact-etb'] }),
  })
  const neither = candidate({ card: card({ name: 'Mountain' }) })

  it('separates the card that causes an event from the card that benefits', () => {
    expect(matchesQuery(ast('produces:artifact-etb'), etbCause)).toBe(true)
    expect(matchesQuery(ast('produces:artifact-etb'), etbPayoff)).toBe(false)
    expect(matchesQuery(ast('wants:artifact-etb'), etbPayoff)).toBe(true)
    expect(matchesQuery(ast('wants:artifact-etb'), etbCause)).toBe(false)
  })

  it('tag: asks the question without caring which side', () => {
    expect(matchesQuery(ast('tag:artifact-etb'), etbCause)).toBe(true)
    expect(matchesQuery(ast('tag:artifact-etb'), etbPayoff)).toBe(true)
    expect(matchesQuery(ast('tag:artifact-etb'), neither)).toBe(false)
  })

  it('accepts the spelling shown on the chip, spaces and all', () => {
    // The chip reads "artifact etb". Typing what you just read must work, or
    // the feature is only usable by someone who has read the source.
    //
    // The NEGATIVE assertions are the ones that bite. A term that fails
    // validation is dropped from the AST, and an empty AST matches everything —
    // so "does this match the card that has the tag" passes either way, and
    // only "does it reject the card that does not" can tell them apart.
    expect(errorsOf('tag:"artifact etb"')).toEqual([])
    expect(matchesQuery(ast('tag:"artifact etb"'), etbCause)).toBe(true)
    expect(matchesQuery(ast('tag:"artifact etb"'), neither)).toBe(false)

    expect(errorsOf('tag:ARTIFACT-ETB')).toEqual([])
    expect(matchesQuery(ast('tag:ARTIFACT-ETB'), etbCause)).toBe(true)
    expect(matchesQuery(ast('tag:ARTIFACT-ETB'), neither)).toBe(false)
  })

  it('reads causes: and benefits: as the words the interface uses', () => {
    expect(matchesQuery(ast('causes:artifact-etb'), etbCause)).toBe(true)
    expect(matchesQuery(ast('causes:artifact-etb'), etbPayoff)).toBe(false)
    expect(matchesQuery(ast('benefits:artifact-etb'), etbPayoff)).toBe(true)
    expect(matchesQuery(ast('benefits:artifact-etb'), etbCause)).toBe(false)
  })

  it('composes with everything else', () => {
    expect(matchesQuery(ast('tag:artifact-etb mv<=2'), etbPayoff)).toBe(true)
    expect(matchesQuery(ast('tag:artifact-etb mv>=5'), etbPayoff)).toBe(false)
    expect(matchesQuery(ast('-tag:artifact-etb'), neither)).toBe(true)
  })

  it('rejects a tag that does not exist, and lists the ones that do', () => {
    const errors = errorsOf('tag:artifcat-etb')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('unknown synergy tag')
    expect(errors[0]?.suggestion).toContain('artifact-etb')
  })

  it('round-trips through the formatter', () => {
    expect(formatQuery(ast('causes:artifact-etb'))).toBe('produces:artifact-etb')
    expect(formatQuery(ast('tag:artifact-etb'))).toBe('tag:artifact-etb')
  })
})
