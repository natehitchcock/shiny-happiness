import { describe, expect, it } from 'vitest'
import {
  EFFICIENCY_BASELINE,
  cardEfficiency,
  vanillaStatline,
  type EfficiencyBaseline,
  type EfficiencyInput,
} from './efficiency.js'
import { cardImpact } from './impact.js'

/**
 * A FIXED baseline for the arithmetic tests (doc 18 §18.6).
 *
 * The shipped `EFFICIENCY_BASELINE` is regenerated from the corpus and is
 * expected to move as power creep continues; a test that pinned a number
 * computed from it would go red on the next regeneration for no reason anyone
 * could act on. The tests that must hold whatever the corpus says use this
 * fixture; the two that check the shipped file is sane say so in their names.
 */
const FIXTURE: EfficiencyBaseline = {
  vanillaStatlineByManaValue: {
    '1': { n: 29, statline: 3 },
    '2': { n: 75, statline: 4 },
    '4': { n: 64, statline: 7 },
    // Deliberately below MIN_SAMPLE, so this row must be IGNORED in favour of
    // the fit — 99 is a number the fit would never produce.
    '8': { n: 2, statline: 99 },
  },
  vanillaStatlineFit: { slope: 2, intercept: 1 },
  statPointsPerImpactPoint: 0.5,
}

const card = (over: Partial<EfficiencyInput>): EfficiencyInput => ({
  name: 'Test Card',
  manaCost: '{1}',
  oracleText: '',
  typeLine: 'Artifact',
  manaValue: 1,
  types: ['artifact'],
  power: null,
  toughness: null,
  ...over,
})

const creature = (over: Partial<EfficiencyInput>): EfficiencyInput =>
  card({ typeLine: 'Creature — Bear', types: ['creature'], ...over })

describe('vanillaStatline', () => {
  it('uses the measured mean where the sample supports it', () => {
    expect(vanillaStatline(2, FIXTURE)).toBe(4)
  })

  it('falls back to the fit where the sample is too thin to trust', () => {
    // Two vanilla creatures at eight mana would let one oddity move the row by
    // whole points of P+T.
    expect(vanillaStatline(8, FIXTURE)).toBe(17)
  })

  it('falls back to the fit for a mana value the table does not cover', () => {
    expect(vanillaStatline(10, FIXTURE)).toBe(21)
  })

  it('rounds a fractional mana value to the nearest bucket', () => {
    expect(vanillaStatline(1.5, FIXTURE)).toBe(4)
  })

  it('never returns a negative baseline', () => {
    const falling: EfficiencyBaseline = {
      ...FIXTURE,
      vanillaStatlineByManaValue: {},
      vanillaStatlineFit: { slope: 2, intercept: -10 },
    }
    expect(vanillaStatline(0, falling)).toBe(0)
  })
})

describe('cardEfficiency', () => {
  it('is zero for a creature that is exactly the going rate', () => {
    // A vanilla creature gives you what the mana buys and nothing else, so it
    // is the origin of the scale by construction.
    const bear = creature({ manaValue: 2, power: '2', toughness: '2' })
    expect(cardEfficiency(bear, FIXTURE).score).toBe(0)
  })

  it('does NOT charge a body smaller than the going rate', () => {
    // Llanowar Elves is a 1/1 for one against a vanilla rate near 3. Charging it
    // −1 would say the card would be better if it did nothing at all.
    const elves = creature({
      name: 'Llanowar Elves',
      manaValue: 1,
      power: '1',
      toughness: '1',
      oracleText: '{T}: Add {G}.',
    })
    const value = cardEfficiency(elves, FIXTURE)
    expect(value.statSurplus).toBe(0)
    expect(value.score).toBeGreaterThan(0)
  })

  it('credits a body above the going rate', () => {
    const big = creature({ manaValue: 2, power: '4', toughness: '4' })
    expect(cardEfficiency(big, FIXTURE).statSurplus).toBe(4)
    // (4 surplus + 0 text) / (2 mana + 1 card), rounded to three places on the
    // way out so the value is stable across platforms.
    expect(cardEfficiency(big, FIXTURE).score).toBe(1.333)
  })

  it('gives a noncreature no stat term rather than a penalty', () => {
    // A spell is not a creature that is MISSING a body.
    const bolt = card({
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      types: ['instant'],
      manaValue: 1,
      oracleText: 'Lightning Bolt deals 3 damage to any target.',
    })
    const value = cardEfficiency(bolt, FIXTURE)
    expect(value.statSurplus).toBe(0)
    expect(value.effectValue).toBeCloseTo(0.5 * cardImpact(bolt).score, 5)
  })

  it('gives no stat term to a creature whose power is not a number', () => {
    // Magic prints `*`. Reading it as 0 would claim Tarmogoyf has no body.
    const goyf = creature({ manaValue: 2, power: '*', toughness: '1+*' })
    expect(cardEfficiency(goyf, FIXTURE).statSurplus).toBe(0)
  })

  it('divides by the mana plus the card, so a free spell is finite', () => {
    const free = card({
      typeLine: 'Instant',
      types: ['instant'],
      manaValue: 0,
      oracleText: 'Destroy target creature.',
    })
    const value = cardEfficiency(free, FIXTURE)
    expect(value.cost).toBe(1)
    expect(Number.isFinite(value.score)).toBe(true)
    expect(value.score).toBeGreaterThan(0)
  })

  it('scales the text term by the baseline exchange rate', () => {
    const wrath = card({
      name: 'Wrath of God',
      typeLine: 'Sorcery',
      types: ['sorcery'],
      manaValue: 4,
      oracleText: "Destroy all creatures. They can't be regenerated.",
    })
    const doubled: EfficiencyBaseline = { ...FIXTURE, statPointsPerImpactPoint: 1 }
    expect(cardEfficiency(wrath, doubled).score).toBeCloseTo(
      cardEfficiency(wrath, FIXTURE).score * 2,
      5,
    )
  })

  it('rates a wrath above a vanilla bear — the check that rejected the scoped formula', () => {
    // `(P+T + r × impact) / MV` rates Grizzly Bears 2.00 and Wrath of God 0.69,
    // because it mixes an absolute body with a marginal text price (doc 18
    // §18.6). Measuring both as surpluses is what fixes it, and this is the
    // assertion that would fail if anyone put the absolute body back.
    const bear = creature({ name: 'Grizzly Bears', manaValue: 2, power: '2', toughness: '2' })
    const wrath = card({
      name: 'Wrath of God',
      typeLine: 'Sorcery',
      types: ['sorcery'],
      manaValue: 4,
      oracleText: "Destroy all creatures. They can't be regenerated.",
    })
    expect(cardEfficiency(wrath, FIXTURE).score).toBeGreaterThan(
      cardEfficiency(bear, FIXTURE).score,
    )
  })

  it('is never negative for any of the shapes a card can take', () => {
    const shapes = [
      creature({ manaValue: 6, power: '0', toughness: '1' }),
      card({ manaValue: 0, types: ['artifact'] }),
      card({ manaValue: 16, types: ['sorcery'], typeLine: 'Sorcery', oracleText: 'Draw a card.' }),
      creature({ manaValue: 1, power: '*', toughness: '*' }),
    ]
    for (const shape of shapes) {
      expect(cardEfficiency(shape, FIXTURE).score).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('the shipped baseline', () => {
  it('is a real measurement, not a placeholder', () => {
    // An empty corpus would produce a file in which every card is infinitely
    // efficient and nothing downstream would fail to say so.
    expect(EFFICIENCY_BASELINE.statPointsPerImpactPoint).toBeGreaterThan(0)
    expect(EFFICIENCY_BASELINE.vanillaStatlineFit.slope).toBeGreaterThan(0)
    expect(Object.keys(EFFICIENCY_BASELINE.vanillaStatlineByManaValue).length).toBeGreaterThan(4)
  })

  it('rises with mana value, because a bigger body costs more', () => {
    for (let mv = 1; mv < 6; mv++) {
      expect(vanillaStatline(mv + 1)).toBeGreaterThan(vanillaStatline(mv))
    }
  })

  it('contradicts the folk "2/2 for 2" rule at four mana', () => {
    // The rule predicts 8; the corpus says under 7. Pinned loosely so a
    // regeneration cannot break it, but tightly enough to catch a baseline that
    // has silently become the folk rule.
    expect(vanillaStatline(4)).toBeLessThan(7.5)
    expect(vanillaStatline(4)).toBeGreaterThan(6)
  })
})
