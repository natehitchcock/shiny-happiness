import { describe, expect, it } from 'vitest'
import { compositionTargets } from './archetype-targets.js'
import type { Card, CardType } from './card.js'
import { countComposition, findDeficits, shortfalls } from './composition-analysis.js'
import { dimensionFromKey, dimensionKey, roleDimension, typeDimension } from './composition.js'
import type { Deck, DeckEntry } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import type { OracleId } from './ids.js'
import { ROLE_PRECEDENCE } from './role.js'
import type { Role } from './role.js'

const card = (name: string, role: Role, types: CardType[], manaValue: number): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: `{${manaValue}}`,
  manaValue,
  colorIdentity: ['R'],
  colors: ['R'],
  typeLine: types.join(' '),
  types,
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: [role],
  primaryRole: role,
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
})

const entry = (name: string): DeckEntry => ({
  oracleId: oracleId(name),
  zone: 'accepted',
  origin: 'manual',
  locked: false,
  roleOverride: null,
  tags: [],
  addedAt: '2026-01-01T00:00:00Z',
})

const deckOf = (names: string[]): Deck => ({
  id: deckId('d'),
  name: 'd',
  description: '',
  commanders: [oracleId('cmdr')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries: names.map(entry),
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 1,
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: '',
})

const CARDS: ReadonlyMap<OracleId, Card> = new Map(
  [
    card('cmdr', 'wincon', ['creature'], 4),
    card('mountain-1', 'land', ['land'], 0),
    card('mountain-2', 'land', ['land'], 0),
    card('sol', 'ramp', ['artifact'], 1),
    card('signet', 'ramp', ['artifact'], 2),
    card('bolt', 'spot-removal', ['instant'], 1),
    card('goblin', 'synergy', ['creature'], 3),
    // The two cards a deck is allowed more than one of, and the only way this
    // file can see the copies bug at all: `mountain-1`/`mountain-2` are two
    // DIFFERENT oracle ids, so a fixture built from them counts the same
    // whether the implementation reads a Set or a list (ADR-0034).
    card('rat', 'synergy', ['creature'], 2),
  ].map((c) => [c.oracleId, c]),
)

describe('countComposition', () => {
  const counts = countComposition(
    deckOf(['mountain-1', 'mountain-2', 'sol', 'signet', 'bolt', 'goblin']),
    CARDS,
  )

  it('counts the commander as part of the deck', () => {
    expect(counts.total).toBe(7)
    expect(counts.byType.get('creature')).toBe(2) // commander + goblin
  })

  it('counts each card under exactly one role', () => {
    expect(counts.byRole.get('ramp')).toBe(2)
    expect(counts.byRole.get('land')).toBe(2)
    expect(counts.byRole.get('spot-removal')).toBe(1)
    const roleTotal = [...counts.byRole.values()].reduce((a, b) => a + b, 0)
    expect(roleTotal).toBe(counts.total)
  })

  it('lets role and type counts overlap, because they answer different questions', () => {
    // The commander is both a creature and a wincon; both counts are correct.
    expect(counts.byType.get('creature')).toBe(2)
    expect(counts.byRole.get('wincon')).toBe(1)
  })

  it('indexes both role and type counts by dimension key', () => {
    expect(counts.byDimension.get(dimensionKey(roleDimension('ramp')))).toBe(2)
    expect(counts.byDimension.get(dimensionKey(typeDimension('creature')))).toBe(2)
  })

  it('excludes lands from the curve and the average', () => {
    // Non-lands: cmdr(4), sol(1), signet(2), bolt(1), goblin(3) → avg 2.2
    expect(counts.averageManaValue).toBeCloseTo(2.2, 5)
    expect(counts.manaCurve[0]).toBe(0) // no 0-cost non-lands
    expect(counts.manaCurve[1]).toBe(2) // sol, bolt
  })

  it('buckets everything above 7 together', () => {
    const big = card('big', 'wincon', ['creature'], 12)
    const cards = new Map([...CARDS, [big.oracleId, big]])
    const counts = countComposition(deckOf(['big']), cards)
    expect(counts.manaCurve[7]).toBe(1)
    expect(counts.manaCurve).toHaveLength(8)
  })

  it('handles an empty deck without dividing by zero', () => {
    const counts = countComposition(deckOf([]), new Map())
    expect(counts.total).toBe(0)
    expect(counts.averageManaValue).toBe(0)
  })

  it('ignores excluded entries', () => {
    const deck = { ...deckOf(['sol']), entries: [{ ...entry('sol'), zone: 'excluded' as const }] }
    expect(countComposition(deck, CARDS).byRole.get('ramp')).toBeUndefined()
  })

  it('honours a role override function', () => {
    const counts = countComposition(deckOf(['sol']), CARDS, () => 'draw')
    expect(counts.byRole.get('draw')).toBe(2) // sol + commander, both forced
  })
})

/*
 * The reported defect, in the words it arrived in: "basic lands need to count
 * towards your land count" (ADR-0034).
 *
 * It reads as a land bug because Commander is singleton and basics are nearly
 * the only card a deck runs in multiples — but the defect is not about lands.
 * `countComposition` iterated `acceptedSet`, a `Set` of oracle ids, so EVERY
 * duplicate collapsed to one: twenty Mountains were one land, and a Relentless
 * Rats pile was one creature at one point on the curve. Every field on
 * `CompositionCounts` was affected, so every field is asserted here.
 *
 * Each case needs a REAL duplicate — the same oracle id twice. A fixture of
 * `mountain-1` and `mountain-2` is two distinct cards and counts identically
 * under both readings, which is exactly why the bug survived this file.
 */
describe('countComposition counts copies, not distinct cards', () => {
  const withBasics = deckOf(['mountain-1', 'mountain-1', 'mountain-1', 'sol'])

  it('counts twenty basics as twenty lands, not as one', () => {
    const twenty = deckOf(Array.from({ length: 20 }, () => 'mountain-1'))
    expect(countComposition(twenty, CARDS).byRole.get('land')).toBe(20)
  })

  it('counts every copy towards the deck total', () => {
    // 3 Mountains + sol + the commander.
    expect(countComposition(withBasics, CARDS).total).toBe(5)
  })

  it('counts every copy under its type', () => {
    expect(countComposition(withBasics, CARDS).byType.get('land')).toBe(3)
  })

  it('counts every copy in the dimension index the targets are read against', () => {
    const counts = countComposition(withBasics, CARDS)
    expect(counts.byDimension.get(dimensionKey(roleDimension('land')))).toBe(3)
    expect(counts.byDimension.get(dimensionKey(typeDimension('land')))).toBe(3)
  })

  it('keeps the role counts summing to the total once copies are counted', () => {
    // The invariant the single-copy fixture above also asserts. It has to hold
    // under duplicates too, or the meters add up to a different deck than the
    // header does.
    const counts = countComposition(withBasics, CARDS)
    const roleTotal = [...counts.byRole.values()].reduce((a, b) => a + b, 0)
    expect(roleTotal).toBe(counts.total)
  })

  it('counts duplicate NON-lands into the curve bucket and the average', () => {
    /*
     * The case that proves this is not a land fix. Lands are excluded from the
     * curve by design, so a basics-heavy deck's curve barely moves — but a deck
     * may run any number of Relentless Rats, and four of them are four cards at
     * mana value two, not one.
     */
    const rats = deckOf(['rat', 'rat', 'rat', 'rat'])
    const counts = countComposition(rats, CARDS)
    expect(counts.manaCurve[2]).toBe(4)
    // Weighted by copies: cmdr(4) + four rats at 2 → 12/5 = 2.4. Counting the
    // rats once gives 3.0, which is a curve the deck does not have.
    expect(counts.averageManaValue).toBeCloseTo(2.4, 5)
  })

  it('counts a commander that also has an accepted entry exactly once', () => {
    /*
     * Import a decklist with the commander in the hundred, then set it as the
     * commander, and the deck holds both rows. `acceptedCopies` applies the same
     * guard `validateDeck` does for the singleton rule, so the header must not
     * read one card higher than the deck is.
     */
    const doubled = { ...deckOf(['cmdr', 'sol']), entries: [entry('cmdr'), entry('sol')] }
    expect(countComposition(doubled, CARDS).total).toBe(2)
    expect(countComposition(doubled, CARDS).byType.get('creature')).toBe(1)
  })

  it('still ignores excluded copies, however many there are', () => {
    // Excluding is per-card, not per-copy: three excluded Mountains are zero
    // lands, not three.
    const deck = {
      ...deckOf([]),
      entries: Array.from({ length: 3 }, () => ({
        ...entry('mountain-1'),
        zone: 'excluded' as const,
      })),
    }
    expect(countComposition(deck, CARDS).byRole.get('land')).toBeUndefined()
  })
})

describe('findDeficits', () => {
  const targets = compositionTargets('midrange', null, { bracket: 3 })

  it('reports shortfalls and surpluses, worst first', () => {
    const counts = countComposition(deckOf(['sol', 'signet']), CARDS)
    const deficits = findDeficits(counts, targets)
    const magnitudes = deficits.map((d) => Math.abs(d.delta))
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a))
    // Nearly everything is missing, so most deltas are negative.
    expect(deficits.some((d) => d.delta < 0)).toBe(true)
  })

  it('flags a count outside the range, not merely off the ideal', () => {
    const landTarget = targets.find(
      (t) => dimensionKey(t.dimension) === dimensionKey(roleDimension('land')),
    )!
    const counts = {
      ...countComposition(deckOf([]), CARDS),
      byDimension: new Map([[dimensionKey(roleDimension('land')), landTarget.min]]),
    }
    const atMin = findDeficits(counts, [landTarget])[0]!
    expect(atMin.outsideRange).toBe(false)
    expect(atMin.delta).toBeLessThan(0) // below ideal, but inside the band
  })

  it('reports a surplus as well as a shortfall', () => {
    const counts = {
      ...countComposition(deckOf([]), CARDS),
      byDimension: new Map([[dimensionKey(roleDimension('ramp')), 30]]),
    }
    const rampTarget = targets.find(
      (t) => dimensionKey(t.dimension) === dimensionKey(roleDimension('ramp')),
    )!
    const deficit = findDeficits(counts, [rampTarget])[0]!
    expect(deficit.delta).toBeGreaterThan(0)
    expect(deficit.outsideRange).toBe(true)
  })

  it('treats a dimension the deck has none of as zero, not as absent', () => {
    const counts = countComposition(deckOf([]), CARDS)
    const deficits = findDeficits(counts, targets)
    expect(deficits.every((d) => typeof d.actual === 'number')).toBe(true)
  })
})

describe('dimensionFromKey', () => {
  it('round-trips every dimension the app can build a key for', () => {
    // The two live at opposite ends of the override path: `dimensionKey` writes
    // the key into the deck's stored overrides, `dimensionFromKey` reads it back
    // when the archetype does not name that dimension. If they drift, an
    // override survives a save and then silently stops applying.
    for (const role of ROLE_PRECEDENCE) {
      const dim = roleDimension(role)
      expect(dimensionFromKey(dimensionKey(dim))).toEqual(dim)
    }
    for (const type of ['creature', 'artifact', 'land'] as CardType[]) {
      const dim = typeDimension(type)
      expect(dimensionFromKey(dimensionKey(dim))).toEqual(dim)
    }
  })

  it('returns null for a key in neither namespace', () => {
    // Null, not a fabricated dimension: an unparseable key is one override to
    // drop, never a `role:undefined` row appearing in the meters.
    expect(dimensionFromKey('ramp')).toBeNull()
    expect(dimensionFromKey('')).toBeNull()
    expect(dimensionFromKey('spell:ramp')).toBeNull()
  })
})

describe('shortfalls', () => {
  it('keeps only what the fills-<dimension> groups act on', () => {
    const targets = compositionTargets('midrange', null, { bracket: 3 })
    const counts = {
      ...countComposition(deckOf([]), CARDS),
      byDimension: new Map([[dimensionKey(roleDimension('ramp')), 99]]),
    }
    const result = shortfalls(findDeficits(counts, targets))
    expect(result.every((d) => d.delta < 0)).toBe(true)
    expect(
      result.some((d) => dimensionKey(d.dimension) === dimensionKey(roleDimension('ramp'))),
    ).toBe(false)
  })
})
