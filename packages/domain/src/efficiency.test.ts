import { describe, expect, it } from 'vitest'
import {
  EFFECT_PRICES,
  assertUsablePrices,
  cardEfficiency,
  type EffectPrices,
  type EfficiencyInput,
} from './efficiency.js'
import { ROLE_PRECEDENCE } from './role.js'

/**
 * A FIXED price table for the arithmetic tests (ADR-0070).
 *
 * The shipped `EFFECT_PRICES` is refitted from the corpus and is expected to
 * move as power creep continues; a test that pinned a number computed from it
 * would go red on the next regeneration for no reason anyone could act on. The
 * tests that must hold whatever the corpus says use this fixture; the ones that
 * check the shipped file say so in their names.
 *
 * Round numbers, chosen so every expectation below can be verified by hand.
 */
const FIXTURE: EffectPrices = {
  source: 'corpus-database',
  generatedAt: '2026-09-06',
  corpus: { commanderLegal: 31782 },
  fit: {
    ridgeLambda: 1,
    minProduceSupport: 50,
    features: 81,
    meanManaValue: 3.2911,
    meanPredictedManaValue: 3.2907,
    meanAbsoluteError: 0.95,
    crossValidatedMeanAbsoluteError: 0.95,
    rootMeanSquaredError: 1.28,
    r2: 0.46,
  },
  roles: Object.fromEntries(ROLE_PRECEDENCE.map((role) => [role, 0])),
  produces: { treasure: 0.5, landfall: 0.25 },
  rate: { 'one-shot': 2, activated: 2, triggered: 2, upkeep: 3 },
  body: { hasBody: -2, power: 0.5, toughness: 0.25 },
}

const withRole = (role: string, price: number): EffectPrices => ({
  ...FIXTURE,
  roles: { ...FIXTURE.roles, [role]: price },
})

const card = (over: Partial<EfficiencyInput>): EfficiencyInput => ({
  name: 'Test Card',
  manaCost: '{1}',
  oracleText: '',
  typeLine: 'Artifact',
  manaValue: 1,
  types: ['artifact'],
  power: null,
  toughness: null,
  roles: ['synergy'],
  synergyProduces: [],
  ...over,
})

const creature = (over: Partial<EfficiencyInput>): EfficiencyInput =>
  card({ typeLine: 'Creature — Bear', types: ['creature'], ...over })

describe('cardEfficiency', () => {
  it('is what the corpus charges for the card, minus what the card asks', () => {
    // Rate 2 (one-shot) + role 1.5 = 3.5 of worth against 2 mana of cost.
    const spell = card({
      typeLine: 'Sorcery',
      types: ['sorcery'],
      manaValue: 2,
      roles: ['board-wipe'],
      oracleText: 'Destroy all creatures.',
    })
    const value = cardEfficiency(spell, withRole('board-wipe', 1.5))
    expect(value.worth).toBe(3.5)
    expect(value.cost).toBe(2)
    expect(value.score).toBe(1.5)
  })

  it('IS NEGATIVE when a card costs more than the format charges for it', () => {
    // The whole point of the change: the metric this replaces floored at zero
    // and could not say that a card is a bad rate. Rate 2, no other price, six
    // mana of cost.
    const overpriced = card({
      typeLine: 'Sorcery',
      types: ['sorcery'],
      manaValue: 6,
      roles: ['synergy'],
    })
    expect(cardEfficiency(overpriced, FIXTURE).score).toBe(-4)
  })

  it('divides by nothing, so a nought-cost card is finite and not special', () => {
    // There is no `MV + 1` any more, because the score is a DIFFERENCE in mana
    // rather than a rate — nothing is ever divided, so nothing can divide by 0.
    const free = card({ typeLine: 'Instant', types: ['instant'], manaValue: 0 })
    const value = cardEfficiency(free, FIXTURE)
    expect(value.cost).toBe(0)
    expect(value.score).toBe(2)
  })

  it('sums every role a card holds, not just its primary', () => {
    const both = card({
      manaValue: 3,
      roles: ['spot-removal', 'token-maker'],
      typeLine: 'Sorcery',
      types: ['sorcery'],
    })
    const prices: EffectPrices = {
      ...FIXTURE,
      roles: { ...FIXTURE.roles, 'spot-removal': 1, 'token-maker': 0.5 },
    }
    // 2 (one-shot) + 1 + 0.5 = 3.5.
    expect(cardEfficiency(both, prices).worth).toBe(3.5)
  })

  it('counts a repeated role or tag once', () => {
    // `roles` is a list, and a card that somehow carried a duplicate must not
    // be charged for it twice.
    const dup = card({
      manaValue: 1,
      roles: ['ramp', 'ramp'],
      synergyProduces: ['treasure', 'treasure'],
    })
    expect(cardEfficiency(dup, withRole('ramp', 1)).worth).toBe(3.5)
  })

  it('prices what the card PRODUCES, and ignores a tag the fit could not price', () => {
    const treasure = card({ manaValue: 2, synergyProduces: ['treasure'] })
    expect(cardEfficiency(treasure, FIXTURE).worth).toBe(2.5)
    // `lifegain` is not in the fixture's table at all. Absence means "the
    // corpus has not shown us what this costs", so it adds nothing rather than
    // throwing or contributing a mean.
    const unpriced = card({ manaValue: 2, synergyProduces: ['lifegain'] })
    expect(cardEfficiency(unpriced, FIXTURE).worth).toBe(2)
  })

  it('takes Rate from the impact classifier, and nothing else from it', () => {
    // An upkeep trigger is priced at the `upkeep` tier — 3 rather than 2 — and
    // that is the ONLY thing efficiency reads out of `impact.ts`. The composite
    // impact score appears nowhere in the arithmetic.
    const upkeep = card({
      typeLine: 'Enchantment',
      types: ['enchantment'],
      manaValue: 2,
      oracleText: 'At the beginning of your upkeep, draw a card.',
    })
    expect(cardEfficiency(upkeep, FIXTURE).effectValue).toBe(3)
  })

  describe('the body', () => {
    it('is priced, so a good rate reads as a good rate', () => {
      // A 6/6 for four: −2 + 3 + 1.5 = 2.5 of body on top of 2 of Rate, against
      // four mana. The metric this replaces could not say this — a vanilla
      // creature was zero by construction, whatever its statline.
      const big = creature({ manaValue: 4, power: '6', toughness: '6' })
      const value = cardEfficiency(big, FIXTURE)
      expect(value.bodyValue).toBe(2.5)
      expect(value.score).toBe(0.5)
    })

    it('is negative for a body that is not worth having', () => {
      const tiny = creature({ manaValue: 4, power: '1', toughness: '1' })
      expect(cardEfficiency(tiny, FIXTURE).bodyValue).toBe(-1.25)
    })

    it('CONTRIBUTES EXACTLY ZERO for a noncreature — offset included', () => {
      // The one silent error this file can make. A noncreature is not a
      // creature that is missing a body; it has none. If the `hasBody` offset
      // leaked through with a zero statline attached, every instant and sorcery
      // in the format would be repriced by −2 at once and nothing would fail.
      const bolt = card({
        name: 'Lightning Bolt',
        typeLine: 'Instant',
        types: ['instant'],
        manaValue: 1,
        oracleText: 'Lightning Bolt deals 3 damage to any target.',
      })
      expect(cardEfficiency(bolt, FIXTURE).bodyValue).toBe(0)
      expect(cardEfficiency(bolt, FIXTURE).worth).toBe(cardEfficiency(bolt, FIXTURE).effectValue)
    })

    it('contributes exactly zero for a creature whose power is not a number', () => {
      // Magic prints `*`. Reading it as 0 would claim Tarmogoyf has no body,
      // and it would then collect the `hasBody` offset for a statline nobody
      // can name.
      const goyf = creature({ manaValue: 2, power: '*', toughness: '1+*' })
      expect(cardEfficiency(goyf, FIXTURE).bodyValue).toBe(0)
    })

    it('contributes exactly zero for a creature with no printed statline', () => {
      const bodiless = creature({ manaValue: 2, power: null, toughness: null })
      expect(cardEfficiency(bodiless, FIXTURE).bodyValue).toBe(0)
    })

    it('prices power and toughness separately', () => {
      // They are two features and not one, because the corpus prices them
      // differently — a point of power is worth more than a point of toughness.
      const wide = creature({ manaValue: 2, power: '4', toughness: '1' })
      const tall = creature({ manaValue: 2, power: '1', toughness: '4' })
      expect(cardEfficiency(wide, FIXTURE).bodyValue).toBeGreaterThan(
        cardEfficiency(tall, FIXTURE).bodyValue,
      )
    })
  })

  it('splits worth into the two halves the pane prints, and they add up', () => {
    const bear = creature({
      manaValue: 2,
      power: '2',
      toughness: '2',
      synergyProduces: ['landfall'],
    })
    const value = cardEfficiency(bear, FIXTURE)
    expect(value.effectValue + value.bodyValue).toBeCloseTo(value.worth, 5)
    expect(value.worth - value.cost).toBeCloseTo(value.score, 5)
  })

  it('is total over every shape a card can take', () => {
    const shapes = [
      creature({ manaValue: 6, power: '0', toughness: '1' }),
      card({ manaValue: 0, types: ['artifact'] }),
      card({ manaValue: 16, types: ['sorcery'], typeLine: 'Sorcery', oracleText: 'Draw a card.' }),
      creature({ manaValue: 1, power: '*', toughness: '*' }),
      card({
        manaValue: 0,
        types: ['land'],
        typeLine: 'Land',
        roles: ['land'],
        oracleText: '{T}: Add {G}.',
      }),
    ]
    for (const shape of shapes) {
      expect(Number.isFinite(cardEfficiency(shape, FIXTURE).score)).toBe(true)
    }
  })
})

describe('the shipped prices', () => {
  /**
   * THIS TEST IS RED ON PURPOSE UNTIL THE GENERATOR HAS BEEN RUN.
   *
   * `pnpm --filter @roundtable/ingest effect-prices` writes `corpus-database`.
   * Anything else is a stand-in fitted somewhere the generator does not run —
   * the file currently shipped was fit over Scryfall's oracle bulk export in a
   * worktree with no `DATABASE_URL`, over the same 31,782 commander-legal cards
   * but not the same rows.
   *
   * A stand-in is not a wrong number, it is an UNVERIFIED one, and the failure
   * this file is designed around is a price table that is quietly not the one
   * anybody measured. So the check is a red test rather than a comment: it
   * cannot be skimmed past, and it goes green the moment the generator is run
   * against a corpus database and its output committed.
   */
  it('are measured from the corpus database', () => {
    expect(EFFECT_PRICES.source).toBe('corpus-database')
  })

  it('is a real fit, not a placeholder', () => {
    // A file of zeroes makes every card worth nothing, so efficiency becomes
    // exactly `−manaValue` and every column silently sorts by cheapness.
    expect(Object.keys(EFFECT_PRICES.roles)).toHaveLength(ROLE_PRECEDENCE.length)
    expect(Object.keys(EFFECT_PRICES.produces).length).toBeGreaterThan(20)
    expect(EFFECT_PRICES.fit.features).toBeGreaterThan(50)
    expect(EFFECT_PRICES.corpus.commanderLegal).toBeGreaterThan(30000)
  })

  it('is unbiased: the mean price it predicts is the corpus mean', () => {
    // The naive sum of per-effect means predicts 3.99 against an actual 3.29 —
    // a 1.21x inflation. Removing that is what the least-squares fit is FOR, so
    // a regeneration that reintroduces it must fail here.
    expect(EFFECT_PRICES.fit.meanPredictedManaValue).toBeCloseTo(EFFECT_PRICES.fit.meanManaValue, 1)
  })

  it('beats the roles-only fit it was measured against', () => {
    // Roles alone reach 1.41 mana of mean absolute error. Every feature added
    // since had to earn its place against that number.
    expect(EFFECT_PRICES.fit.meanAbsoluteError).toBeLessThan(1.41)
    // And it must not be overfitting: held-out error within a tenth of a mana
    // of in-sample error.
    expect(
      EFFECT_PRICES.fit.crossValidatedMeanAbsoluteError - EFFECT_PRICES.fit.meanAbsoluteError,
    ).toBeLessThan(0.1)
  })

  it('prices a body, and prices power above toughness', () => {
    expect(EFFECT_PRICES.body.power).toBeGreaterThan(0)
    expect(EFFECT_PRICES.body.toughness).toBeGreaterThan(0)
    expect(EFFECT_PRICES.body.power).toBeGreaterThan(EFFECT_PRICES.body.toughness)
    // Having a body at all is an offset against those two, not a bonus on top:
    // a 0/0 creature is not worth more than a spell that does the same thing.
    expect(EFFECT_PRICES.body.hasBody).toBeLessThan(0)
  })

  it('passes its own guard', () => {
    expect(() => assertUsablePrices(EFFECT_PRICES)).not.toThrow()
  })
})

describe('assertUsablePrices', () => {
  it('refuses a table of zeroes rather than scoring every card wrong', () => {
    // The failure that matters, because nothing downstream would report it: a
    // dead table makes every card worth nothing, so efficiency is exactly
    // `−manaValue`, every column sorts by cheapness, and every number on the
    // screen is confidently wrong.
    expect(() =>
      assertUsablePrices({
        ...FIXTURE,
        roles: Object.fromEntries(ROLE_PRECEDENCE.map((r) => [r, 0])),
        produces: {},
        rate: { 'one-shot': 0, activated: 0, triggered: 0, upkeep: 0 },
        body: { hasBody: 0, power: 0, toughness: 0 },
      }),
    ).toThrow(/all zeroes/)
  })

  it('refuses a table missing a role', () => {
    const rest = Object.fromEntries(
      Object.entries(FIXTURE.roles).filter(([role]) => role !== 'land'),
    )
    expect(() => assertUsablePrices({ ...FIXTURE, roles: rest })).toThrow(/role "land"/)
  })

  it('refuses a table missing a Rate tier', () => {
    expect(() =>
      assertUsablePrices({ ...FIXTURE, rate: { 'one-shot': 2, activated: 2, triggered: 2 } }),
    ).toThrow(/Rate tier "upkeep"/)
  })

  it('refuses a BIASED fit, which is the naive model coming back', () => {
    // The 1.21x inflation is the single defect the least-squares fit exists to
    // remove, and unlike a bad coefficient it is visible from the file alone.
    // A refit that reintroduced it would otherwise ship: every price is
    // present, finite and non-zero, so no other guard here fires.
    expect(() =>
      assertUsablePrices({
        ...FIXTURE,
        fit: { ...FIXTURE.fit, meanManaValue: 3.2911, meanPredictedManaValue: 3.994 },
      }),
    ).toThrow(/the fit is biased/)
  })

  it('accepts the small drift a real refit has', () => {
    // Half a mana of slack: the shipped fit lands within 0.0004, so the guard
    // must not fire on an honest regeneration.
    expect(() =>
      assertUsablePrices({
        ...FIXTURE,
        fit: { ...FIXTURE.fit, meanManaValue: 3.2911, meanPredictedManaValue: 3.35 },
      }),
    ).not.toThrow()
  })

  it('refuses a non-finite price, which JSON can carry as a null', () => {
    expect(() =>
      assertUsablePrices({ ...FIXTURE, body: { ...FIXTURE.body, power: Number.NaN } }),
    ).toThrow(/non-finite/)
  })
})
