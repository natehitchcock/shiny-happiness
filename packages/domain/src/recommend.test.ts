import { describe, expect, it } from 'vitest'
import { compositionTargets } from './archetype-targets.js'
import type { Card, CardType } from './card.js'
import type { Combo } from './combo.js'
import { buildComboIndex } from './combo-index.js'
import { countComposition } from './composition-analysis.js'
import type { Deck } from './deck.js'
import { comboId, deckId, oracleId, printingId } from './ids.js'
import { parseQuery } from './query/parse.js'
import { recommend, type CardStats, type PoolCard, type RecommendInput } from './recommend.js'
import type { Role } from './role.js'
import { DEFAULT_WEIGHTS, weightsFor } from './scoring.js'

const card = (name: string, over: Partial<Card> = {}): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  colorIdentity: ['R'],
  colors: ['R'],
  typeLine: 'Creature — Goblin',
  types: ['creature'] as readonly CardType[],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 500,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

const pooled = (name: string, over: Partial<PoolCard> = {}): PoolCard => ({
  card: over.card ?? card(name),
  roles: (over.roles ?? ['synergy']) as readonly Role[],
  bracketFlags: over.bracketFlags ?? [],
  priceUsd: over.priceUsd ?? 1,
  rarity: 'rare',
  setCode: 'tst',
  power: null,
  toughness: null,
  reserved: false,
})

const combo = (id: string, pieces: string[]): Combo => ({
  id: comboId(id),
  pieces: pieces.map(oracleId),
  prerequisites: '',
  steps: [],
  produces: ['infinite-damage'],
  colorIdentity: ['R'],
})

const emptyDeck: Deck = {
  id: deckId('d'),
  name: 'd',
  description: '',
  commanders: [oracleId('Krenko')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries: [],
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 1,
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: '',
}

const baseInput = (over: Partial<RecommendInput> = {}): RecommendInput => ({
  pool: [],
  comboIndex: buildComboIndex([]),
  accepted: new Set([oracleId('Krenko')]),
  excluded: new Set(),
  colorIdentity: ['R'],
  targets: compositionTargets('midrange', null, { bracket: 3 }),
  counts: countComposition(emptyDeck, new Map()),
  weights: DEFAULT_WEIGHTS,
  query: null,
  stats: null,
  ...over,
})

const ast = (q: string) => {
  const parsed = parseQuery(q)
  return parsed.ok ? parsed.value.ast : null
}
const groupKeys = (r: ReturnType<typeof recommend>) => r.groups.map((g) => g.key)
const idsIn = (r: ReturnType<typeof recommend>, key: string) =>
  r.groups.find((g) => g.key === key)?.items.map((i) => i.oracleId) ?? []

describe('eligibility (doc 05 §5.2)', () => {
  it('excludes cards outside the deck colour identity', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('green', { card: card('green', { colorIdentity: ['G'] }) }), pooled('red')],
      }),
    )
    expect(idsIn(result, 'staple')).toEqual([oracleId('red')])
  })

  it('excludes banned and non-legal cards', () => {
    const result = recommend(
      baseInput({
        pool: [
          pooled('banned', { card: card('banned', { legalities: { commander: 'banned' } }) }),
          pooled('ok'),
        ],
      }),
    )
    expect(idsIn(result, 'staple')).toEqual([oracleId('ok')])
  })

  it('excludes cards already accepted', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('have'), pooled('want')],
        accepted: new Set([oracleId('Krenko'), oracleId('have')]),
      }),
    )
    expect(idsIn(result, 'staple')).toEqual([oracleId('want')])
  })

  it('never re-suggests an excluded card (pillar P6)', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('rejected'), pooled('fine')],
        excluded: new Set([oracleId('rejected')]),
      }),
    )
    expect(idsIn(result, 'staple')).toEqual([oracleId('fine')])
  })

  it('excludes basic lands entirely', () => {
    const result = recommend(
      baseInput({
        pool: [
          pooled('Mountain', {
            card: card('Mountain', { typeLine: 'Basic Land — Mountain', types: ['land'] }),
          }),
        ],
      }),
    )
    expect(result.groups.every((g) => g.items.length === 0)).toBe(true)
  })
})

describe('grouping happens before scoring (pillar P5)', () => {
  const index = buildComboIndex([
    combo('c1', ['three', 'A']),
    combo('c2', ['three', 'A', 'B']),
    combo('c3', ['three', 'B']),
    combo('c4', ['two', 'A']),
    combo('c5', ['two', 'B']),
    combo('c6', ['one', 'A']),
    combo('n1', ['near', 'A', 'X']),
    combo('n2', ['near', 'B', 'Y']),
  ])
  const accepted = new Set([oracleId('Krenko'), oracleId('A'), oracleId('B')])
  const result = recommend(
    baseInput({
      pool: ['three', 'two', 'one', 'near', 'plain'].map((n) => pooled(n)),
      comboIndex: index,
      accepted,
    }),
  )

  it('puts each card in exactly one group, in the fixed order', () => {
    expect(groupKeys(result).slice(0, 4)).toEqual([
      'combo-3plus',
      'combo-2',
      'combo-1',
      'near-combo',
    ])
    const all = result.groups.flatMap((g) => g.items.map((i) => i.oracleId))
    expect(new Set(all).size).toBe(all.length)
  })

  it('groups by degree', () => {
    expect(idsIn(result, 'combo-3plus')).toEqual([oracleId('three')])
    expect(idsIn(result, 'combo-2')).toEqual([oracleId('two')])
    expect(idsIn(result, 'combo-1')).toEqual([oracleId('one')])
  })

  it('groups a card that is one away from two combos as near-combo', () => {
    expect(idsIn(result, 'near-combo')).toEqual([oracleId('near')])
  })

  it('carries a label and a rationale on every group', () => {
    for (const group of result.groups) {
      expect(group.label.length).toBeGreaterThan(0)
      expect(group.rationale.length).toBeGreaterThan(0)
    }
  })
})

describe('deficit groups', () => {
  it('routes a card into fills-<role> when the deck is short of that role', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('rock', { roles: ['ramp'], card: card('rock', { primaryRole: 'ramp' }) })],
      }),
    )
    expect(groupKeys(result)).toContain('fills-ramp')
    expect(result.groups.find((g) => g.key === 'fills-ramp')!.label).toMatch(/ramp/)
  })
})

describe('every recommendation explains itself (pillar P4)', () => {
  it('never emits an empty reasons list', () => {
    const index = buildComboIndex([combo('c1', ['x', 'A'])])
    const result = recommend(
      baseInput({
        pool: [pooled('x'), pooled('plain'), pooled('ramp', { roles: ['ramp'] })],
        comboIndex: index,
        accepted: new Set([oracleId('Krenko'), oracleId('A')]),
        stats: new Map([[oracleId('plain'), { inclusion: 0.5, synergy: 0.2 } as CardStats]]),
      }),
    )
    const all = result.groups.flatMap((g) => g.items)
    expect(all.length).toBeGreaterThan(0)
    for (const rec of all) expect(rec.reasons.length).toBeGreaterThan(0)
  })

  it('cites the combos it completes', () => {
    const index = buildComboIndex([combo('c1', ['x', 'A']), combo('c2', ['x', 'A'])])
    const result = recommend(
      baseInput({
        pool: [pooled('x')],
        comboIndex: index,
        accepted: new Set([oracleId('Krenko'), oracleId('A')]),
      }),
    )
    const rec = result.groups.flatMap((g) => g.items)[0]!
    expect(rec.reasons[0]).toMatchObject({ kind: 'completes-combos' })
    expect(rec.completedCombos).toHaveLength(2)
  })

  it('warns about a bracket flag rather than hiding the card', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('gc', { bracketFlags: ['game-changer'] })],
      }),
    )
    const rec = result.groups.flatMap((g) => g.items)[0]!
    expect(rec.bracketFlags).toContain('game-changer')
    expect(rec.reasons.some((r) => r.kind === 'bracket-warning')).toBe(true)
  })
})

describe('determinism and ordering', () => {
  const input = baseInput({
    pool: [
      pooled('b', { card: card('b', { edhrecRank: 100 }) }),
      pooled('a', { card: card('a', { edhrecRank: 100 }) }),
      pooled('c', { card: card('c', { edhrecRank: 5 }) }),
    ],
  })

  it('produces identical output for identical input', () => {
    expect(recommend(input)).toEqual(recommend(input))
  })

  it('breaks ties by the Scryfall edhrecRank, then by name', () => {
    const ids = idsIn(recommend(input), 'staple')
    expect(ids).toEqual([oracleId('c'), oracleId('a'), oracleId('b')])
  })
})

describe('degradation when statistics are unavailable (doc 05 §5.3)', () => {
  it('reports the missing groups rather than silently omitting them', () => {
    const result = recommend(baseInput({ pool: [pooled('x')], stats: null }))
    expect(result.unavailable.map((u) => u.key)).toEqual(['top-<type>', 'high-synergy'])
    expect(result.unavailable.every((u) => u.reason.length > 0)).toBe(true)
  })

  it('still produces combo groups without statistics', () => {
    const index = buildComboIndex([combo('c1', ['x', 'A'])])
    const result = recommend(
      baseInput({
        pool: [pooled('x')],
        comboIndex: index,
        accepted: new Set([oracleId('Krenko'), oracleId('A')]),
        stats: null,
      }),
    )
    expect(idsIn(result, 'combo-1')).toEqual([oracleId('x')])
    expect(result.unavailable).toHaveLength(2)
  })

  it('produces the statistics groups when stats are present', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('syn'), pooled('other')],
        stats: new Map([
          [oracleId('syn'), { inclusion: 0.9, synergy: 0.6 }],
          [oracleId('other'), { inclusion: 0.8, synergy: 0.5 }],
        ]),
      }),
    )
    expect(result.unavailable).toHaveLength(0)
    expect(groupKeys(result).some((k) => k.startsWith('top-'))).toBe(true)
  })
})

describe('query filtering (doc 13 §13.1)', () => {
  const index = buildComboIndex([combo('c1', ['creature-combo', 'A'])])
  const input = baseInput({
    pool: [
      pooled('creature-combo'),
      pooled('enchantment-combo', {
        card: card('enchantment-combo', { typeLine: 'Enchantment', types: ['enchantment'] }),
      }),
    ],
    comboIndex: buildComboIndex([
      combo('c1', ['creature-combo', 'A']),
      combo('c2', ['enchantment-combo', 'A']),
    ]),
    accepted: new Set([oracleId('Krenko'), oracleId('A')]),
  })

  it('narrows the pool without flattening the groups', () => {
    const result = recommend({ ...input, query: ast('t:creature') })
    expect(idsIn(result, 'combo-1')).toEqual([oracleId('creature-combo')])
    expect(groupKeys(result)).toContain('combo-1')
  })

  it('reports what each group withheld rather than hiding it', () => {
    const result = recommend({ ...input, query: ast('t:creature') })
    const group = result.groups.find((g) => g.key === 'combo-1')!
    expect(group.withheldByFilter).toBe(1)
    expect(group.total).toBe(1)
  })

  it('reports matched against total', () => {
    const result = recommend({ ...input, query: ast('t:creature') })
    expect(result.query).toEqual({ matched: 1, total: 2 })
  })

  it('filters on combo degree, which only this app can compute', () => {
    const result = recommend({ ...input, query: ast('combo>=1') })
    expect(result.query.matched).toBe(2)
    expect(recommend({ ...input, query: ast('combo>=2') }).query.matched).toBe(0)
  })

  it('leaves everything in place with no query', () => {
    expect(recommend({ ...input, query: null }).query).toEqual({ matched: 2, total: 2 })
  })

  void index
})

describe('scoring weights', () => {
  it('lets archetype nudge the defaults', () => {
    expect(weightsFor('combo').combo).toBeGreaterThan(DEFAULT_WEIGHTS.combo)
    expect(weightsFor('aggro').curve).toBeGreaterThan(DEFAULT_WEIGHTS.curve)
  })

  it('lets a user override beat the archetype', () => {
    expect(weightsFor('combo', { combo: 0.1 }).combo).toBe(0.1)
  })

  it('penalises a bracket flag without filtering the card out', () => {
    const clean = recommend(
      baseInput({ pool: [pooled('clean'), pooled('flagged', { bracketFlags: ['game-changer'] })] }),
    )
    const ids = idsIn(clean, 'staple')
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(oracleId('clean')) // ranked lower, still present
  })
})

describe('limitPerGroup', () => {
  it('caps items while total still reports the true count', () => {
    const result = recommend(
      baseInput({
        pool: Array.from({ length: 20 }, (_, i) => pooled(`c${i}`)),
        limitPerGroup: 5,
      }),
    )
    const group = result.groups.find((g) => g.key === 'staple')!
    expect(group.items).toHaveLength(5)
    expect(group.total).toBe(20)
  })
})

describe('degenerate input', () => {
  it('handles an empty pool', () => {
    const result = recommend(baseInput())
    expect(result.groups).toEqual([])
    expect(result.query).toEqual({ matched: 0, total: 0 })
  })
})
