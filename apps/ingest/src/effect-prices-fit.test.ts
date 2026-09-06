import { describe, expect, it } from 'vitest'
import type { CardType, EfficiencyInput, Role, SynergyTag } from '@roundtable/domain'
import { cardEfficiency } from '@roundtable/domain'
import { asCard, fitEffectPrices } from './effect-prices-fit.js'

/**
 * The fit, on corpora whose answer is known by construction (ADR-0070).
 *
 * THE GENERATOR CANNOT BE RUN WITHOUT A DATABASE, so the arithmetic is the part
 * that has to be verifiable without one. `effect-prices-fit.ts` is pure for
 * exactly this reason; these build a tiny corpus in which every card's mana
 * value is a known linear function of its features, and check that the fit
 * recovers the function that generated it.
 *
 * A synthetic corpus rather than a fixture of real cards, and deliberately —
 * this is the one place in the project where a hand-made input is BETTER than a
 * real one, because the property under test is "does least squares recover the
 * coefficients", and only a made-up corpus has coefficients anybody knows.
 * `efficiency.test.ts` is where the real cards are.
 */

const card = (over: Partial<EfficiencyInput> & { manaValue: number }): EfficiencyInput => ({
  name: 'Test Card',
  manaCost: '{1}',
  oracleText: '',
  typeLine: 'Sorcery',
  types: ['sorcery'] as readonly CardType[],
  power: null,
  toughness: null,
  roles: ['synergy'] as readonly Role[],
  synergyProduces: [] as readonly SynergyTag[],
  ...over,
})

/**
 * Enough copies for a produced tag to clear `MIN_PRODUCE_SUPPORT`.
 *
 * The threshold is 50 and is not exported — it is a decision of the generator's,
 * not a knob — so the corpora below simply oversupply it rather than reaching in.
 */
const many = (n: number, make: (i: number) => EfficiencyInput): EfficiencyInput[] =>
  Array.from({ length: n }, (_, i) => make(i))

describe('fitEffectPrices', () => {
  it('recovers the coefficients of a corpus it was generated from', () => {
    // Every card is `rate:one-shot` (a sorcery), so that tier carries the
    // constant. Cost = 2 for being a card + 1.5 more if it is a board wipe.
    const corpus = [
      ...many(60, () => card({ manaValue: 2, roles: ['synergy'] })),
      ...many(60, () => card({ manaValue: 3.5, roles: ['synergy', 'board-wipe'] })),
    ]
    const fitted = fitEffectPrices(corpus)
    expect(fitted.rate['one-shot']! + fitted.roles['synergy']!).toBeCloseTo(2, 1)
    expect(fitted.roles['board-wipe']).toBeCloseTo(1.5, 1)
    expect(fitted.fit.meanAbsoluteError).toBeLessThan(0.05)
  })

  it('gives a marginal price, not an average — the whole reason it is a fit', () => {
    // The naive model sums per-role MEANS. Here `draw` cards average 4 mana and
    // `ramp` cards average 4 mana, because the cards holding both cost 5 — so
    // summing the means prices a draw-and-ramp card at 8 against a real 5. The
    // fit has to say 1 + 2 + 2, not 4 + 4.
    const corpus = [
      ...many(60, () => card({ manaValue: 3, roles: ['draw'] })),
      ...many(60, () => card({ manaValue: 3, roles: ['ramp'] })),
      ...many(60, () => card({ manaValue: 5, roles: ['draw', 'ramp'] })),
    ]
    const fitted = fitEffectPrices(corpus)
    const base = fitted.rate['one-shot']!
    expect(base + fitted.roles['draw']!).toBeCloseTo(3, 1)
    expect(base + fitted.roles['draw']! + fitted.roles['ramp']!).toBeCloseTo(5, 1)
    // And the naive sum of means would have said 8.
    expect(base + fitted.roles['draw']! + fitted.roles['ramp']!).toBeLessThan(6)
  })

  it('is unbiased: the mean price it predicts is the corpus mean', () => {
    const corpus = [
      ...many(50, () => card({ manaValue: 1, roles: ['ramp'] })),
      ...many(50, () => card({ manaValue: 6, roles: ['board-wipe'] })),
      ...many(50, () => card({ manaValue: 3, roles: ['synergy'] })),
    ]
    const fitted = fitEffectPrices(corpus)
    // To a hundredth of a mana rather than a thousandth, because λ = 1 is
    // VISIBLE on 150 rows and is not on 31,782 — it shrinks this corpus's mean
    // prediction by 0.017 and the real corpus's by 0.0004. That is the whole
    // argument for the value: conditioning at corpus scale, and the price of a
    // synthetic test being small.
    expect(fitted.fit.meanPredictedManaValue).toBeCloseTo(fitted.fit.meanManaValue, 1)
  })

  it('prices a body, and gives a card with no statline nothing from it', () => {
    // Creatures cost 1 per point of power here and nothing else varies.
    const corpus = [
      ...many(40, (i) => card({
        manaValue: (i % 4) + 1,
        typeLine: 'Creature — Bear',
        types: ['creature'],
        power: String((i % 4) + 1),
        toughness: '1',
      })),
      ...many(40, () => card({ manaValue: 2 })),
    ]
    const fitted = fitEffectPrices(corpus)
    expect(fitted.body.power).toBeGreaterThan(0.5)

    // The property that matters: a noncreature's price must not contain the
    // `hasBody` offset. If it leaked, every noncreature in the format would
    // shift by it at once and nothing downstream would report it.
    const spell = card({ manaValue: 2 })
    const priced = cardEfficiency(spell, {
      source: 'corpus-database',
      generatedAt: '2026-09-06',
      corpus: { commanderLegal: corpus.length },
      fit: fitted.fit,
      roles: fitted.roles,
      produces: fitted.produces,
      rate: fitted.rate,
      body: fitted.body,
    })
    expect(priced.bodyValue).toBe(0)
    expect(priced.worth).toBe(priced.effectValue)
  })

  it('refuses to price a produced tag the corpus barely shows it', () => {
    // Below the support threshold the tag is left out of the table entirely,
    // rather than given a coefficient fitted from a handful of cards.
    const corpus = [
      ...many(100, () => card({ manaValue: 2 })),
      ...many(3, () => card({ manaValue: 9, synergyProduces: ['extra-turns'] })),
      ...many(80, () => card({ manaValue: 4, synergyProduces: ['treasure'] })),
    ]
    const fitted = fitEffectPrices(corpus)
    expect(fitted.produces['extra-turns']).toBeUndefined()
    expect(fitted.produces['treasure']).toBeDefined()
  })

  it('leaves out the three produced tags that are type-line membership', () => {
    // `spell-cast` is set for every instant and sorcery by `synergy.ts` and says
    // nothing about what the card DOES. Priced, it becomes an instant-and-sorcery
    // premium and the model turns into a type-line model in disguise.
    const corpus = many(120, () => card({ manaValue: 2, synergyProduces: ['spell-cast'] }))
    const fitted = fitEffectPrices(corpus)
    expect(fitted.produces['spell-cast']).toBeUndefined()
  })

  it('reads Rate off the impact classifier, so the tiers separate', () => {
    // An upkeep trigger and a sorcery, priced by the tier and nothing else.
    const corpus = [
      ...many(60, () => card({ manaValue: 2 })),
      ...many(60, () =>
        card({
          manaValue: 5,
          typeLine: 'Enchantment',
          types: ['enchantment'],
          oracleText: 'At the beginning of your upkeep, draw a card.',
        }),
      ),
    ]
    const fitted = fitEffectPrices(corpus)
    expect(fitted.rate['upkeep']!).toBeGreaterThan(fitted.rate['one-shot']!)
  })

  it('publishes every figure `efficiency.ts` guards on', () => {
    const fitted = fitEffectPrices(many(60, () => card({ manaValue: 2 })))
    expect(Object.keys(fitted.roles)).toHaveLength(20)
    expect(Object.keys(fitted.rate)).toHaveLength(4)
    expect(fitted.fit.ridgeLambda).toBe(1)
    expect(fitted.fit.features).toBeGreaterThan(20)
    expect(Number.isFinite(fitted.fit.crossValidatedMeanAbsoluteError)).toBe(true)
  })
})

describe('asCard', () => {
  it('maps a row without inventing a statline for a noncreature', () => {
    const mapped = asCard({
      name: 'Wrath of God',
      mana_cost: '{2}{W}{W}',
      mana_value: 4,
      type_line: 'Sorcery',
      oracle_text: 'Destroy all creatures.',
      types: ['sorcery'],
      power_num: null,
      toughness_num: null,
      roles: ['board-wipe'],
      synergy_produces: ['creature-death'],
    })
    expect(mapped.power).toBeNull()
    expect(mapped.toughness).toBeNull()
    expect(mapped.roles).toEqual(['board-wipe'])
    expect(mapped.synergyProduces).toEqual(['creature-death'])
  })

  it('reads a null oracle text as empty rather than as the string "null"', () => {
    // The column is nullable and a vanilla creature has no text. `String(null)`
    // would put four characters of rules text on every one of them, which the
    // Rate classifier would then read.
    const mapped = asCard({
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      mana_value: 2,
      type_line: 'Creature — Bear',
      oracle_text: null,
      types: ['creature'],
      power_num: 2,
      toughness_num: 2,
      roles: ['synergy'],
      synergy_produces: [],
    })
    expect(mapped.oracleText).toBe('')
    expect(mapped.power).toBe('2')
  })
})
