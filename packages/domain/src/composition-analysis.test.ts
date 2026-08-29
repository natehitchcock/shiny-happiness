import { describe, expect, it } from 'vitest'
import { compositionTargets } from './archetype-targets.js'
import type { Card, CardType } from './card.js'
import { countComposition, findDeficits, shortfalls } from './composition-analysis.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import type { Deck, DeckEntry } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import type { OracleId } from './ids.js'
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
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: [role],
  primaryRole: role,
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
  commanders: [oracleId('cmdr')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries: names.map(entry),
  budget: null,
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
    const landTarget = targets.find((t) => dimensionKey(t.dimension) === dimensionKey(roleDimension('land')))!
    const counts = { ...countComposition(deckOf([]), CARDS), byDimension: new Map([[dimensionKey(roleDimension('land')), landTarget.min]]) }
    const atMin = findDeficits(counts, [landTarget])[0]!
    expect(atMin.outsideRange).toBe(false)
    expect(atMin.delta).toBeLessThan(0) // below ideal, but inside the band
  })

  it('reports a surplus as well as a shortfall', () => {
    const counts = { ...countComposition(deckOf([]), CARDS), byDimension: new Map([[dimensionKey(roleDimension('ramp')), 30]]) }
    const rampTarget = targets.find((t) => dimensionKey(t.dimension) === dimensionKey(roleDimension('ramp')))!
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

describe('shortfalls', () => {
  it('keeps only what the fills-<dimension> groups act on', () => {
    const targets = compositionTargets('midrange', null, { bracket: 3 })
    const counts = { ...countComposition(deckOf([]), CARDS), byDimension: new Map([[dimensionKey(roleDimension('ramp')), 99]]) }
    const result = shortfalls(findDeficits(counts, targets))
    expect(result.every((d) => d.delta < 0)).toBe(true)
    expect(result.some((d) => dimensionKey(d.dimension) === dimensionKey(roleDimension('ramp')))).toBe(false)
  })
})
