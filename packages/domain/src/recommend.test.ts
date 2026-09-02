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
import { primaryRole, type Role } from './role.js'
import { DEFAULT_WEIGHTS, weightsFor } from './scoring.js'
import { parseSemanticEmphasis } from './semantic-emphasis.js'
import { COMMANDER_WEIGHT, SYNERGY_TAGS, type DeckSynergy } from './synergy.js'

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
  gameChanger: false,
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
    expect(idsIn(result, 'other')).toEqual([oracleId('red')])
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
    expect(idsIn(result, 'other')).toEqual([oracleId('ok')])
  })

  it('excludes cards already accepted', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('have'), pooled('want')],
        accepted: new Set([oracleId('Krenko'), oracleId('have')]),
      }),
    )
    expect(idsIn(result, 'other')).toEqual([oracleId('want')])
  })

  it('never re-suggests an excluded card (pillar P6)', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('rejected'), pooled('fine')],
        excluded: new Set([oracleId('rejected')]),
      }),
    )
    expect(idsIn(result, 'other')).toEqual([oracleId('fine')])
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

  /*
   * Whose gap is being filled (doc 16, pillar P4).
   *
   * "Fills a ramp gap" and "fills the ramp target you set" are different claims.
   * A card suggested against a number the builder typed is suggested on their
   * authority, not the archetype's, and a reason that hides that is a reason
   * they cannot audit when the suggestions start looking wrong.
   */
  it('says the gap is the archetype’s when nothing was overridden', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('rock', { roles: ['ramp'], card: card('rock', { primaryRole: 'ramp' }) })],
      }),
    )
    const rec = result.groups.flatMap((g) => g.items)[0]!
    expect(rec.reasons).toContainEqual(
      expect.objectContaining({ kind: 'fills-deficit', source: 'archetype' }),
    )
  })

  it('says the gap is the builder’s when the target was overridden', () => {
    const result = recommend(
      baseInput({
        pool: [pooled('rock', { roles: ['ramp'], card: card('rock', { primaryRole: 'ramp' }) })],
        targets: compositionTargets(
          'midrange',
          null,
          { bracket: 3 },
          { roles: { 'role:ramp': 20 } },
        ),
      }),
    )
    const rec = result.groups.flatMap((g) => g.items)[0]!
    expect(rec.reasons).toContainEqual(
      expect.objectContaining({ kind: 'fills-deficit', source: 'custom' }),
    )
  })

  /*
   * The group a card is offered under is the dimension it will be COUNTED
   * under (ADR-0031, pillar P4).
   *
   * Grouping used `roles[0]` — raw database array order — while
   * `countComposition` counts by `primaryRole(roles)`, which is precedence
   * order. They are different functions of the same data and they disagreed on
   * 8.4% of a real candidate pool, which put 20.4% of the rows under a "Fills
   * gap · X" heading on cards that do not count toward X at all. Accepting one
   * moved a different meter than the heading named.
   *
   * `spot-removal` outranks `draw` in `ROLE_PRECEDENCE`, so this card is
   * counted as removal however its role array happens to be ordered. Written
   * with `draw` FIRST in the array on purpose: that is the ordering the old
   * code read, so a regression here shows up as `fills-draw` rather than as a
   * passing test.
   */
  it('offers a card under the role it will be counted as, not its first role', () => {
    const versatile = card('versatile', {
      roles: ['draw', 'spot-removal'],
      primaryRole: 'spot-removal',
    })
    const result = recommend(
      baseInput({
        pool: [pooled('versatile', { roles: ['draw', 'spot-removal'], card: versatile })],
      }),
    )
    expect(groupKeys(result)).toContain('fills-spot-removal')
    expect(groupKeys(result)).not.toContain('fills-draw')
  })

  /*
   * The same rule, stated against the COUNTER rather than against a literal.
   *
   * The test above pins one card; this one pins the agreement itself, so a
   * change to `ROLE_PRECEDENCE` cannot quietly make the two drift apart again
   * while both tests still read as though they check something.
   */
  it('names, in its reason, the dimension the deck counter will move', () => {
    const versatile = card('versatile', {
      roles: ['draw', 'spot-removal'],
      primaryRole: 'spot-removal',
    })
    const result = recommend(
      baseInput({
        pool: [pooled('versatile', { roles: ['draw', 'spot-removal'], card: versatile })],
      }),
    )
    const rec = result.groups.flatMap((g) => g.items)[0]!
    const counted = countComposition(
      {
        ...emptyDeck,
        entries: [
          {
            oracleId: versatile.oracleId,
            zone: 'accepted',
            origin: 'manual',
            locked: false,
            roleOverride: null,
            tags: [],
            addedAt: '',
          },
        ],
      },
      new Map([[versatile.oracleId, versatile]]),
      (c) => primaryRole(c.roles),
    )
    const moved = [...counted.byRole.entries()].filter(([, n]) => n > 0).map(([role]) => role)
    expect(moved).toEqual(['spot-removal'])
    expect(rec.fillsRoleDeficit).toBe('spot-removal')
    expect(rec.reasons).toContainEqual(
      expect.objectContaining({
        kind: 'fills-deficit',
        dimension: { kind: 'role', role: 'spot-removal' },
      }),
    )
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
    const ids = idsIn(recommend(input), 'other')
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

describe('filtering by impact and efficiency (doc 18 §18.8)', () => {
  /*
   * The two metrics were readable and unaskable: a row could show 6.12 and no
   * query could say "the ones like that".
   *
   * What these pin is not the arithmetic — `impact.test.ts` owns that — but the
   * AGREEMENT. The predicate compares the same number the item carries to the
   * client, so a surviving row can never contradict its own cell. Asserted
   * against the values read off an unfiltered run rather than against
   * hardcoded constants, so a recalibrated baseline moves both sides together
   * or fails here.
   */
  const wrath = pooled('wrath', {
    card: card('wrath', {
      typeLine: 'Sorcery',
      types: ['sorcery'],
      oracleText: "Destroy all creatures. They can't be regenerated.",
    }),
  })
  const bear = pooled('bear', {
    card: card('bear', { typeLine: 'Creature — Bear', types: ['creature'], oracleText: '' }),
  })
  const input = baseInput({ pool: [wrath, bear] })

  const itemsOf = (r: ReturnType<typeof recommend>) => r.groups.flatMap((g) => g.items)
  const unfiltered = itemsOf(recommend({ ...input, query: null }))

  it('keeps exactly the rows whose own impact cell clears the threshold', () => {
    const expected = unfiltered.filter((i) => (i.impact?.score ?? -1) >= 6).map((i) => i.oracleId)
    expect(expected).toEqual([oracleId('wrath')])
    expect(
      itemsOf(recommend({ ...input, query: ast('impact>=6') })).map((i) => i.oracleId),
    ).toEqual(expected)
  })

  it('keeps exactly the rows whose own efficiency cell clears the threshold', () => {
    const cutoff = 0.5
    const expected = unfiltered
      .filter((i) => (i.efficiency?.score ?? -1) >= cutoff)
      .map((i) => i.oracleId)
    expect(expected).toEqual([oracleId('wrath')])
    expect(itemsOf(recommend({ ...input, query: ast('eff>=0.5') })).map((i) => i.oracleId)).toEqual(
      expected,
    )
  })

  it('matches the exact score a row reports, to the last decimal it has', () => {
    // The boundary is where a filter that re-rounded for display would part
    // company with the column, so it is the case worth pinning.
    const score = unfiltered.find((i) => i.oracleId === oracleId('wrath'))?.impact?.score
    expect(score).toBeDefined()
    const at = String(score)
    expect(recommend({ ...input, query: ast(`impact>=${at}`) }).query.matched).toBe(1)
    expect(recommend({ ...input, query: ast(`impact>${at}`) }).query.matched).toBe(0)
  })

  it('composes with the rest of the language', () => {
    expect(recommend({ ...input, query: ast('impact>=6 -t:land') }).query.matched).toBe(1)
    expect(recommend({ ...input, query: ast('impact>=6 -t:sorcery') }).query.matched).toBe(0)
    expect(recommend({ ...input, query: ast('-impact>=6') }).query.matched).toBe(1)
  })

  it('reports the withheld rows rather than hiding them', () => {
    // Same promise every other filter makes (doc 13 §13.1): a card kept out by
    // the query is counted, never silently absent.
    const result = recommend({ ...input, query: ast('impact>=6') })
    expect(result.query).toEqual({ matched: 1, total: 2 })
  })
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
    const ids = idsIn(clean, 'other')
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
    const group = result.groups.find((g) => g.key === 'other')!
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

/**
 * Semantic emphasis — the tags the builder said the deck is ABOUT.
 *
 * Tergrid's own shape throughout: she causes `opponent-discard` and benefits
 * from it, so a deck led by her has weight on both sides of the tag and both
 * directions of match are reachable.
 */
describe('semantic emphasis', () => {
  const tergrid: DeckSynergy = {
    produces: new Map([
      ['opponent-discard', COMMANDER_WEIGHT],
      ['opponent-sacrifice', COMMANDER_WEIGHT],
    ]),
    wants: new Map([
      ['opponent-discard', COMMANDER_WEIGHT],
      ['untap', COMMANDER_WEIGHT],
    ]),
    has: new Map(),
  }

  /** Two cards that are identical apart from which of Tergrid's tags they carry. */
  const twoCandidates = (over: Partial<RecommendInput> = {}) =>
    recommend(
      baseInput({
        deckSynergy: tergrid,
        pool: [
          pooled('discard', {
            card: card('discard', { synergyProduces: ['opponent-discard'] }),
          }),
          pooled('untapper', {
            card: card('untapper', { synergyProduces: ['untap'] }),
          }),
        ],
        ...over,
      }),
    )

  const ordering = (r: ReturnType<typeof recommend>) =>
    r.groups.flatMap((g) => g.items.map((i) => i.oracleId))

  it('leaves the ordering untouched when nothing is emphasised', () => {
    // Two cards with the same commander-weight synergy tie, broken by
    // edhrecRank then name — `discard` before `untapper`.
    expect(ordering(twoCandidates())).toEqual([oracleId('discard'), oracleId('untapper')])
  })

  it('ranks a card supporting the emphasised tag above one that does not', () => {
    // The requirement, stated plainly. Emphasise `untap` and the untapper has
    // to win, against a name tie-break that was pushing it second.
    expect(ordering(twoCandidates({ emphasis: ['untap'] }))).toEqual([
      oracleId('untapper'),
      oracleId('discard'),
    ])
  })

  it('is fully reversible — clearing the emphasis restores the original order', () => {
    // De-emphasising is the half of the request most easily left unbuilt. `[]`
    // must be indistinguishable from never having emphasised anything.
    expect(ordering(twoCandidates({ emphasis: [] }))).toEqual(ordering(twoCandidates()))
  })

  it('lifts a card even when the deck does not do the tag yet', () => {
    // `EMPHASIS_FLOOR`. Nothing in a Tergrid deck touches `landfall`, so a
    // multiplier would multiply zero and the click would do nothing at all.
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        emphasis: ['landfall'],
        pool: [
          pooled('alpha', { card: card('alpha') }),
          // Named last alphabetically on purpose: the tie-break would put it
          // second, so only the emphasis term can bring it first.
          pooled('zeta', { card: card('zeta', { synergyWants: ['landfall'] }) }),
        ],
      }),
    )
    expect(ordering(result)).toEqual([oracleId('zeta'), oracleId('alpha')])
  })

  it('never changes which group a card lands in (pillar P5)', () => {
    /*
     * The reason emphasis is an additive term and not a multiplier inside
     * `synergyMatches`: `synergyScore` feeds MECHANICAL_SYNERGY_THRESHOLD, and
     * a user preference must not be able to relabel a card as "high synergy".
     */
    const pool = [
      pooled('discard', { card: card('discard', { synergyProduces: ['opponent-discard'] }) }),
      pooled('untapper', { card: card('untapper', { synergyProduces: ['untap'] }) }),
    ]
    const groupOf = (r: ReturnType<typeof recommend>) =>
      Object.fromEntries(r.groups.flatMap((g) => g.items.map((i) => [i.oracleId, g.key])))
    expect(
      groupOf(recommend(baseInput({ deckSynergy: tergrid, pool, emphasis: ['untap'] }))),
    ).toEqual(groupOf(recommend(baseInput({ deckSynergy: tergrid, pool }))))
  })

  it('does not touch the archetype composition targets', () => {
    // Doc 16's axis, not this one. The `fills-` groups and their deficits are
    // computed upstream of every scoring term and must be identical.
    const pool = [pooled('lands', { card: card('lands', { synergyWants: ['landfall'] }) })]
    const withEmphasis = recommend(baseInput({ pool, emphasis: ['landfall'] }))
    const without = recommend(baseInput({ pool }))
    expect(withEmphasis.groups.map((g) => g.label)).toEqual(without.groups.map((g) => g.label))
  })

  it('says the reason is an emphasis, not an ordinary synergy (pillar P4)', () => {
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        emphasis: ['opponent-discard'],
        pool: [
          pooled('discard', { card: card('discard', { synergyProduces: ['opponent-discard'] }) }),
        ],
      }),
    )
    const reason = result.groups
      .flatMap((g) => g.items)
      .flatMap((i) => i.reasons)
      .find((r) => r.kind === 'keyword-synergy')
    expect(reason).toEqual({
      kind: 'keyword-synergy',
      tag: 'opponent-discard',
      direction: 'enables',
      withOracleIds: [],
      emphasised: true,
    })
  })

  it('does not claim an emphasis on a card that only has ordinary synergy', () => {
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        emphasis: ['landfall'],
        pool: [
          pooled('discard', { card: card('discard', { synergyProduces: ['opponent-discard'] }) }),
        ],
      }),
    )
    const reason = result.groups
      .flatMap((g) => g.items)
      .flatMap((i) => i.reasons)
      .find((r) => r.kind === 'keyword-synergy')
    expect(reason).not.toHaveProperty('emphasised')
  })

  it('names the emphasised tag even when a different tag scores higher', () => {
    // The card is in this list because of the emphasis, so the emphasised tag
    // is what the reason must name — reporting the stronger incidental synergy
    // would be a true sentence about the wrong card.
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        emphasis: ['untap'],
        pool: [
          pooled('both', {
            card: card('both', { synergyProduces: ['opponent-discard'], synergyWants: ['untap'] }),
          }),
        ],
      }),
    )
    const reason = result.groups
      .flatMap((g) => g.items)
      .flatMap((i) => i.reasons)
      .find((r) => r.kind === 'keyword-synergy')
    expect(reason).toMatchObject({ tag: 'untap', emphasised: true })
  })

  it('reports how much of the pool each emphasised tag reaches', () => {
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        // In `SYNERGY_TAGS` order, which is what `parseSemanticEmphasis` hands
        // every real caller; the report comes back in the order it was given.
        emphasis: parseSemanticEmphasis(['opponent-discard', 'landfall']),
        pool: [
          pooled('discard', { card: card('discard', { synergyProduces: ['opponent-discard'] }) }),
          pooled('payoff', { card: card('payoff', { synergyWants: ['opponent-discard'] }) }),
        ],
      }),
    )
    // `landfall: 0` is the honest answer to "why did nothing change" — and note
    // the suggestions are still there, because emphasis never filters.
    expect(result.emphasis).toEqual([
      { tag: 'landfall', supporting: 0 },
      { tag: 'opponent-discard', supporting: 2 },
    ])
    expect(result.groups.flatMap((g) => g.items)).toHaveLength(2)
  })

  it('counts a card once for a tag it both produces and wants', () => {
    const result = recommend(
      baseInput({
        deckSynergy: tergrid,
        emphasis: ['opponent-discard'],
        pool: [
          pooled('engine', {
            card: card('engine', {
              synergyProduces: ['opponent-discard'],
              synergyWants: ['opponent-discard'],
            }),
          }),
        ],
      }),
    )
    expect(result.emphasis).toEqual([{ tag: 'opponent-discard', supporting: 1 }])
  })

  it('reports no emphasis when none is set', () => {
    expect(recommend(baseInput({ pool: [pooled('a')] })).emphasis).toEqual([])
  })

  /**
   * `tagSupport` — the same count, for EVERY tag rather than the emphasised few.
   *
   * What it is for: the interface offers the semantics related to a chosen
   * focus, and it has to put them in an order that means something. "How much
   * of your colours supports this" is the only real signal available, and it is
   * a fact about a tag nobody has emphasised yet — so `emphasis`, which is
   * indexed by the emphasis, cannot carry it.
   */
  describe('tagSupport', () => {
    const oneCard = (over: Partial<RecommendInput> = {}) =>
      recommend(
        baseInput({
          pool: [
            pooled('a', {
              card: card('a', { synergyProduces: ['token'], synergyWants: ['landfall'] }),
            }),
          ],
          ...over,
        }),
      )

    it('counts every tag in the vocabulary, not only the emphasised ones', () => {
      // The offer includes tags the deck does not emphasise — that is what an
      // offer IS — so a report indexed by the emphasis would be blind to all of
      // them and the ordering would fall back to the alphabet.
      const support = oneCard().tagSupport
      expect(support.map((e) => e.tag)).toEqual(SYNERGY_TAGS)
    })

    it('counts a candidate on both sides of the model', () => {
      const support = new Map(oneCard().tagSupport.map((e) => [e.tag, e.supporting]))
      expect(support.get('token')).toBe(1) // produced
      expect(support.get('landfall')).toBe(1) // wanted
    })

    it('says zero for a tag nothing in the pool touches, rather than omitting it', () => {
      // Omission and zero would be the same on the wire and are not the same
      // claim. `bySupport` sinks a counted zero and sinks an uncounted tag even
      // further, so the difference decides where the chip lands.
      const support = new Map(oneCard().tagSupport.map((e) => [e.tag, e.supporting]))
      expect(support.get('treasure')).toBe(0)
    })

    it('counts a card once for a tag it both produces and wants', () => {
      const support = new Map(
        oneCard({
          pool: [
            pooled('engine', {
              card: card('engine', { synergyProduces: ['token'], synergyWants: ['token'] }),
            }),
          ],
        }).tagSupport.map((e) => [e.tag, e.supporting]),
      )
      expect(support.get('token')).toBe(1)
    })

    it('does not depend on the emphasis, so the offer does not reshuffle as you pick', () => {
      // The counts are taken over ELIGIBLE candidates and emphasis never
      // filters, so they are the same numbers before and after a focus is
      // added. The client holds them across a save on the strength of this.
      expect(oneCard({ emphasis: ['token'] }).tagSupport).toEqual(oneCard().tagSupport)
    })

    it('counts before the query filter, like the emphasis report it generalises', () => {
      // The claim is about the deck's colours and the corpus, not about
      // whatever the search box currently holds.
      expect(oneCard({ query: ast('t:enchantment') }).tagSupport).toEqual(oneCard().tagSupport)
    })

    it('agrees with the emphasis report wherever the two overlap', () => {
      const result = oneCard({ emphasis: ['token', 'treasure'] })
      const support = new Map(result.tagSupport.map((e) => [e.tag, e.supporting]))
      for (const entry of result.emphasis) {
        expect(support.get(entry.tag)).toBe(entry.supporting)
      }
      expect(result.emphasis).toHaveLength(2)
    })
  })
})

/**
 * The focus guarantee (ADR-0026).
 *
 * Emphasis moved the SCORE and nothing else, so a card supporting the builder's
 * focus could still sort below `limitPerGroup` and never appear in that
 * category at all. The builder said what the deck is about and the category
 * showed them nothing about it.
 *
 * THE FIXTURE HAS TO OVERFLOW, or none of this is being tested. A pool smaller
 * than the limit never reaches the slice, and a pool where every card supports
 * the focus cannot tell a guarantee from an ordinary sort — both are ways this
 * feature can be shipped with tests that cannot fail. So: 21 cards into a limit
 * of 5, of which four support the focus and seventeen do not, and the four are
 * held BELOW the cut by a bracket penalty larger than the emphasis term (−0.5
 * against +0.2) so the guarantee is the only thing that can put them on screen.
 */
describe('the focus guarantee', () => {
  const CUT = 5

  /** Seventeen cards that have nothing to do with the focus. */
  const plain = () =>
    Array.from({ length: 17 }, (_, i) => {
      const name = `plain-${String(i).padStart(2, '0')}`
      return pooled(name, { card: card(name, { edhrecRank: 100 + i }) })
    })

  /**
   * A card supporting the focus, penalised so it cannot climb into the top five
   * on score alone. A Game Changer in a bracket-3 deck is exactly this card in
   * the real corpus: it supports the thing the deck is about, and the bracket
   * penalty buries it below cards that do not.
   */
  const supporter = (name: string, rank: number, over: Partial<Card> = {}) =>
    pooled(name, {
      card: card(name, { edhrecRank: rank, synergyProduces: ['untap'], ...over }),
      bracketFlags: ['game-changer'],
    })

  const overflowing = (over: Partial<RecommendInput> = {}) =>
    recommend(
      baseInput({
        limitPerGroup: CUT,
        pool: [
          ...plain(),
          supporter('sup-a', 900),
          supporter('sup-b', 901),
          supporter('sup-c', 902),
          supporter('sup-d', 903),
        ],
        ...over,
      }),
    )

  const rest = (r: ReturnType<typeof recommend>) => r.groups.find((g) => g.key === 'other')!
  const ids = (r: ReturnType<typeof recommend>) => rest(r).items.map((i) => i.oracleId)

  it('cuts the supporters off the list when nothing is emphasised', () => {
    // The defect, pinned. Without this the rest of the block proves nothing: if
    // the supporters made the cut on their own there is no guarantee to test.
    const unfocused = ids(overflowing())
    expect(unfocused).toHaveLength(CUT)
    expect(unfocused).not.toContain(oracleId('sup-a'))
  })

  it('includes the top three supporters of the focus in the category', () => {
    const focused = ids(overflowing({ emphasis: ['untap'] }))
    expect(focused).toContain(oracleId('sup-a'))
    expect(focused).toContain(oracleId('sup-b'))
    expect(focused).toContain(oracleId('sup-c'))
  })

  it('stops at three — the fourth supporter is not carried in', () => {
    expect(ids(overflowing({ emphasis: ['untap'] }))).not.toContain(oracleId('sup-d'))
  })

  it('EXTENDS the list rather than displacing anything (emphasis never removes)', () => {
    // Holding the list at exactly `limit` would make emphasis REMOVE cards,
    // which is stated to the user in three places and pinned by the API's own
    // "never removes a suggestion" test.
    const unfocused = ids(overflowing())
    const focused = ids(overflowing({ emphasis: ['untap'] }))
    expect(focused).toHaveLength(CUT + 3)
    for (const id of unfocused) expect(focused).toContain(id)
    // And the rows that were already there keep their places: the guaranteed
    // three sit at the end, at the score position they already had, rather than
    // pinned above cards that outscore them.
    expect(focused.slice(0, CUT)).toEqual(unfocused)
  })

  it('leaves the reported total alone — the guarantee shows more, it counts nothing new', () => {
    expect(rest(overflowing({ emphasis: ['untap'] })).total).toBe(21)
    expect(rest(overflowing()).total).toBe(21)
  })

  it('changes nothing at all when no focus is set', () => {
    expect(ids(overflowing({ emphasis: [] }))).toEqual(ids(overflowing()))
  })

  it('adds nothing when the top three already made the cut', () => {
    // The common case for a well-supported focus: the guarantee is already
    // satisfied by the ordering, and must be a no-op rather than a second copy.
    const result = recommend(
      baseInput({
        limitPerGroup: CUT,
        emphasis: ['untap'],
        pool: [
          ...plain(),
          // No bracket flag, so the emphasis term alone carries them to the top.
          pooled('top-a', { card: card('top-a', { synergyProduces: ['untap'] }) }),
          pooled('top-b', { card: card('top-b', { synergyProduces: ['untap'] }) }),
          pooled('top-c', { card: card('top-c', { synergyProduces: ['untap'] }) }),
        ],
      }),
    )
    expect(ids(result)).toHaveLength(CUT)
    expect(new Set(ids(result)).size).toBe(CUT)
  })

  it('counts a supporter that made the cut towards the three', () => {
    // One supporter above the line means two more are owed, not three.
    const result = recommend(
      baseInput({
        limitPerGroup: CUT,
        emphasis: ['untap'],
        pool: [
          ...plain(),
          pooled('top-a', { card: card('top-a', { synergyProduces: ['untap'] }) }),
          supporter('sup-a', 900),
          supporter('sup-b', 901),
          supporter('sup-c', 902),
        ],
      }),
    )
    expect(ids(result)).toHaveLength(CUT + 2)
    expect(ids(result)).toContain(oracleId('sup-a'))
    expect(ids(result)).toContain(oracleId('sup-b'))
    expect(ids(result)).not.toContain(oracleId('sup-c'))
  })

  it('includes what exists when a group holds fewer than three supporters', () => {
    // Never padded to three with cards that do not support the focus.
    const result = recommend(
      baseInput({
        limitPerGroup: CUT,
        emphasis: ['untap'],
        pool: [...plain(), supporter('sup-a', 900)],
      }),
    )
    expect(ids(result)).toHaveLength(CUT + 1)
    expect(ids(result)).toContain(oracleId('sup-a'))
  })

  it('never resurrects an excluded card (pillar P6)', () => {
    // The easiest thing here to get wrong: the guarantee reaches past the cut,
    // and a builder's rejection lives on the other side of it.
    const result = overflowing({
      emphasis: ['untap'],
      excluded: new Set([oracleId('sup-a')]),
    })
    expect(ids(result)).not.toContain(oracleId('sup-a'))
    // And the three are still filled, from what is left.
    expect(ids(result)).toContain(oracleId('sup-d'))
  })

  it('never resurrects a card the query withheld', () => {
    // Emphasis never filters; the QUERY does, and that is its whole job. A
    // guarantee reaching past the filter would make the search box a lie.
    const result = overflowing({
      emphasis: ['untap'],
      query: ast('t:creature'),
      pool: [
        ...plain(),
        supporter('sup-a', 900, { typeLine: 'Artifact', types: ['artifact'] }),
        supporter('sup-b', 901, { typeLine: 'Artifact', types: ['artifact'] }),
        supporter('sup-c', 902, { typeLine: 'Artifact', types: ['artifact'] }),
      ],
    })
    expect(ids(result)).toHaveLength(CUT)
    expect(ids(result)).not.toContain(oracleId('sup-a'))
    expect(rest(result).withheldByFilter).toBe(3)
  })

  it('never puts a card in a group it does not already belong to (pillar P5)', () => {
    // Grouping is the product's opinion. The guarantee inserts into the group
    // the card was already assigned to; it never moves one to a group that has
    // room.
    const groupsOf = (r: ReturnType<typeof recommend>) =>
      Object.fromEntries(r.groups.flatMap((g) => g.items.map((i) => [i.oracleId, g.key])))
    expect(groupsOf(overflowing({ emphasis: ['untap'], limitPerGroup: 60 }))).toEqual(
      groupsOf(overflowing({ limitPerGroup: 60 })),
    )
  })

  it('says the card is on the page because of the focus (pillar P4)', () => {
    const item = rest(overflowing({ emphasis: ['untap'] })).items.find(
      (i) => i.oracleId === oracleId('sup-a'),
    )!
    expect(item.reasons).toContainEqual({
      kind: 'keyword-synergy',
      tag: 'untap',
      direction: 'theme',
      withOracleIds: [],
      emphasised: true,
      guaranteed: true,
    })
  })

  it('makes no such claim about a supporter that made the cut on its own', () => {
    const result = recommend(
      baseInput({
        limitPerGroup: CUT,
        emphasis: ['untap'],
        pool: [
          ...plain(),
          pooled('top-a', { card: card('top-a', { synergyProduces: ['untap'] }) }),
        ],
      }),
    )
    const item = rest(result).items.find((i) => i.oracleId === oracleId('top-a'))!
    expect(item.reasons.find((r) => r.kind === 'keyword-synergy')).not.toHaveProperty('guaranteed')
  })

  it('emits no duplicate rows', () => {
    const focused = ids(overflowing({ emphasis: ['untap'] }))
    expect(new Set(focused).size).toBe(focused.length)
  })
})

/**
 * The curated staples groups (ADR-0044).
 *
 * The user asked for `staples → staple lands → combos → everything else`.
 * These pin the four parts of that sentence and the four ways it can go wrong:
 * the phase leading, the split being real, the combo groups keeping their rows,
 * and the catch-all no longer wearing the name "Staples".
 */
describe('staples lead, then staple lands, then combos, then the rest', () => {
  // Real names out of the curated file, so a rename in the data breaks this too.
  const solRing = () =>
    pooled('Sol Ring', {
      card: card('Sol Ring', { colorIdentity: [], types: ['artifact'], typeLine: 'Artifact' }),
      roles: ['ramp'],
    })
  const commandTower = () =>
    pooled('Command Tower', {
      card: card('Command Tower', { colorIdentity: [], types: ['land'], typeLine: 'Land' }),
      roles: ['land'],
    })

  it('puts a curated staple in `staple` and a curated staple land in `staple-land`', () => {
    const result = recommend(baseInput({ pool: [solRing(), commandTower(), pooled('plain')] }))
    expect(idsIn(result, 'staple')).toEqual([oracleId('Sol Ring')])
    expect(idsIn(result, 'staple-land')).toEqual([oracleId('Command Tower')])
  })

  it('emits them in the order the user asked for', () => {
    const result = recommend(baseInput({ pool: [solRing(), commandTower(), pooled('plain')] }))
    expect(groupKeys(result)).toEqual(['staple', 'staple-land', 'other'])
  })

  it('puts the staples groups above the combo groups', () => {
    const result = recommend(
      baseInput({
        pool: [solRing(), commandTower(), pooled('piece')],
        comboIndex: buildComboIndex([combo('c1', ['Krenko', 'piece'])]),
      }),
    )
    expect(groupKeys(result).slice(0, 3)).toEqual(['staple', 'staple-land', 'combo-1'])
  })

  it('leaves a staple that finishes a combo in the combo group, not the staples one', () => {
    /*
     * Membership is decided BELOW the combo groups even though the staples
     * groups are emitted ABOVE them. "Adding this finishes a combo you already
     * hold" is a claim about THIS deck; "every deck wants this" is true of the
     * card everywhere. P4 asks the more specific true claim to be the one the
     * card is filed under, and doc 05 calls the combo groups the headline
     * feature — taking their best rows away to fill a new heading would be
     * paying for the staples phase with the feature the product leads on.
     */
    const result = recommend(
      baseInput({
        pool: [solRing()],
        comboIndex: buildComboIndex([combo('c1', ['Krenko', 'Sol Ring'])]),
      }),
    )
    expect(idsIn(result, 'combo-1')).toEqual([oracleId('Sol Ring')])
    expect(idsIn(result, 'staple')).toEqual([])
  })

  it('files a staple above its `fills-<role>` group, or the phase is empty on an empty deck', () => {
    // An empty deck is short in every role, so every staple would land in a
    // `fills-` group and the opening phase would never hold a single card. That
    // is exactly the case the phase exists for.
    const result = recommend(baseInput({ pool: [solRing()] }))
    expect(idsIn(result, 'staple')).toEqual([oracleId('Sol Ring')])
    expect(idsIn(result, 'fills-ramp')).toEqual([])
  })

  it('calls the catch-all what it is rather than calling it "Staples"', () => {
    /*
     * `stats` is null in production (ADR-0008), so the old `staple` group held
     * every eligible card that had nothing else to say — the whole colour
     * identity — under the heading "Staples" and the rationale "Widely played
     * and legal in your colours". Neither half was true of it, and P4 says a
     * reason has to be.
     */
    const result = recommend(baseInput({ pool: [pooled('plain')] }))
    const rest = result.groups.find((g) => g.key === 'other')!
    expect(rest.label).toBe('Everything else')
    expect(rest.rationale).not.toContain('Widely played')
    expect(idsIn(result, 'staple')).toEqual([])
  })

  it('never offers a staple outside the deck colour identity', () => {
    const offColour = pooled('Counterspell', {
      card: card('Counterspell', { colorIdentity: ['U'], types: ['instant'] }),
    })
    const result = recommend(baseInput({ pool: [offColour, solRing()] }))
    expect(idsIn(result, 'staple')).toEqual([oracleId('Sol Ring')])
    expect(result.groups.flatMap((g) => g.items.map((i) => i.oracleId))).not.toContain(
      oracleId('Counterspell'),
    )
  })

  it('never re-offers a rejected staple (pillar P6)', () => {
    const result = recommend(
      baseInput({ pool: [solRing(), commandTower()], excluded: new Set([oracleId('Sol Ring')]) }),
    )
    expect(idsIn(result, 'staple')).toEqual([])
    expect(idsIn(result, 'staple-land')).toEqual([oracleId('Command Tower')])
  })

  it('drops a staple the deck already holds, so the phase can run out', () => {
    const result = recommend(
      baseInput({
        pool: [solRing(), commandTower()],
        accepted: new Set([oracleId('Krenko'), oracleId('Sol Ring')]),
      }),
    )
    expect(idsIn(result, 'staple')).toEqual([])
  })
})

describe('the staples phase honours the budget cap and the bracket', () => {
  const dear = () =>
    pooled('Sol Ring', {
      card: card('Sol Ring', { colorIdentity: [], types: ['artifact'] }),
      roles: ['ramp'],
      priceUsd: 40,
    })
  const changer = () =>
    pooled('Rhystic Study', {
      card: card('Rhystic Study', { colorIdentity: [], types: ['enchantment'] }),
      roles: ['draw'],
      bracketFlags: ['game-changer'],
    })

  it('keeps a staple over the per-card budget out of the opening phase', () => {
    /*
     * Elsewhere the budget is a SCORE penalty, and that is right for a feed the
     * builder is browsing. It is wrong for a phase whose whole proposition is
     * "these are the picks you do not have to think about": a $40 card is a
     * decision, and leading a $50 deck with one is the bug.
     *
     * It falls through rather than disappearing — still offered, still carrying
     * its price and its penalty, just not presented as an obvious pick.
     */
    const result = recommend(baseInput({ pool: [dear()], maxBudgetUsd: 5 }))
    expect(idsIn(result, 'staple')).toEqual([])
    expect(idsIn(result, 'fills-ramp')).toEqual([oracleId('Sol Ring')])
  })

  it('keeps it in when the deck has no budget, and when the price is under the cap', () => {
    expect(idsIn(recommend(baseInput({ pool: [dear()] })), 'staple')).toEqual([
      oracleId('Sol Ring'),
    ])
    expect(idsIn(recommend(baseInput({ pool: [dear()], maxBudgetUsd: 50 })), 'staple')).toEqual([
      oracleId('Sol Ring'),
    ])
  })

  it('will not lead with a Game Changer when the bracket has no room left for one', () => {
    const result = recommend(baseInput({ pool: [changer()], gameChangerBudget: 0 }))
    expect(idsIn(result, 'staple')).toEqual([])
    expect(idsIn(result, 'fills-draw')).toEqual([oracleId('Rhystic Study')])
  })

  it('leads with it when the bracket still allows one', () => {
    const result = recommend(baseInput({ pool: [changer()], gameChangerBudget: 1 }))
    expect(idsIn(result, 'staple')).toEqual([oracleId('Rhystic Study')])
  })

  it('leads with it at a bracket that allows unlimited Game Changers', () => {
    const result = recommend(baseInput({ pool: [changer()], gameChangerBudget: 'unlimited' }))
    expect(idsIn(result, 'staple')).toEqual([oracleId('Rhystic Study')])
  })

  it('spends no allowance a caller did not hand it', () => {
    /*
     * Absent means ZERO, not unlimited. Every other optional input here defaults
     * to "no effect" (AGENTS.md R2), but the no-effect default for a bracket
     * allowance would be to spend one the caller never said the deck had, and a
     * staples phase that pushes a deck past its own bracket is the bug this
     * check exists to prevent. Default-deny is the only safe direction.
     */
    expect(idsIn(recommend(baseInput({ pool: [changer()] })), 'staple')).toEqual([])
  })
})
