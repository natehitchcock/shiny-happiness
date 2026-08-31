import { describe, expect, it } from 'vitest'
import {
  EFFICIENCY_CAVEAT,
  IMPACT_MAX,
  efficiencyWorking,
  impactFraction,
  impactNotes,
  impactRows,
  metricValue,
  type EfficiencyView,
  type ImpactView,
} from './metrics.js'

/**
 * The readings, not the model.
 *
 * Every fixture below is a REAL `cardImpact` / `cardEfficiency` output, copied
 * from `packages/domain/src/impact.test.ts`'s pinned values and from the
 * formula in `efficiency.ts` — not invented. A hand-made `{ breadth: 'few' }`
 * would happily test a tier combination the classifier cannot produce, and pass
 * while the real one drew nonsense.
 *
 * The fixtures are deliberately NOT uniform. Three of them differ in every
 * tier, so an assertion cannot match the right words by accident from the wrong
 * card.
 */

/** `cardImpact(WRATH_OF_GOD)` — unbounded, one-shot, opposing, symmetric. */
const WRATH: ImpactView = {
  score: 6.12,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'symmetric',
  scales: false,
  fragile: false,
}

/** `cardImpact(TORMENT_OF_HAILFIRE)` — unbounded, one-shot, player, one-sided, scales. */
const TORMENT: ImpactView = {
  score: 8.4,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'player',
  symmetry: 'one-sided',
  scales: true,
  fragile: false,
}

/** `cardImpact(GRIZZLY_BEARS)` — the vanilla, and the only shape that scores 0. */
const VANILLA: ImpactView = {
  score: 0,
  breadth: 'none',
  persistence: 'one-shot',
  stakes: 'self',
  symmetry: 'none',
  scales: false,
  fragile: false,
}

/** `cardImpact(VIRIDIAN_ZEALOT)` — an activated ability that eats the permanent. */
const FRAGILE: ImpactView = {
  score: 1.2,
  breadth: 'one',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'none',
  scales: false,
  fragile: true,
}

/**
 * `cardImpact(CRATERHOOF_BEHEMOTH)` — `own` stakes AND `one-sided` symmetry.
 *
 * The combination that broke the first draft of this copy. `one-sided` means
 * "does not hit everyone equally", not "not yours"; the side Craterhoof spares
 * is the opponents'. Kept as a named fixture because reasoning about the tiers
 * says this pairing cannot happen and running the model over a real card says
 * it does.
 */
const CRATERHOOF: ImpactView = {
  score: 6,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'own',
  symmetry: 'one-sided',
  scales: false,
  fragile: false,
}

describe('metricValue', () => {
  it('draws the stored number and rounds nothing', () => {
    // ADR-0025 §2: the filter compares the raw score, so a renderer that rounds
    // makes `impact>=6.13` drop a row whose own cell says 6.13. Three decimals
    // are real values — 2.2 × 1.9 × 0.85 is 3.553 — and they are printed.
    expect(metricValue(6.12)).toBe('6.12')
    expect(metricValue(3.553)).toBe('3.553')
    expect(metricValue(13.464)).toBe('13.464')
    expect(metricValue(0)).toBe('0')
  })
})

describe('impactFraction', () => {
  it('places a score as a percentage of the model ceiling', () => {
    expect(impactFraction(IMPACT_MAX)).toBe(100)
    expect(impactFraction(0)).toBe(0)
    // Wrath of God is a third of the way up, which is the shape of the claim the
    // meter makes: a board wipe is a high card and is nowhere near the top.
    expect(impactFraction(6.12)).toBeCloseTo(33.1, 1)
  })

  it('never runs past either end of the track', () => {
    // Defensive rather than reachable: `IMPACT_MAX` bounds every score by
    // construction. A fill wider than its track would overflow the panel, which
    // is a layout failure and not a rounding one.
    expect(impactFraction(999)).toBe(100)
    expect(impactFraction(-4)).toBe(0)
  })
})

describe('impactRows', () => {
  it('says what a wrath reaches, how often, and whose board — including yours', () => {
    expect(impactRows(WRATH)).toEqual([
      { label: 'Reach', value: 'everything at once' },
      { label: 'Repeats', value: 'once, then it is done' },
      { label: 'Falls on', value: "an opponent's side, your board included" },
    ])
  })

  it('distinguishes a one-sided mass effect from a symmetric one', () => {
    // The 0.85 discount is charged for exactly this difference, so the reading
    // has to show it. `Torment` and `Wrath` are both `unbounded` and both
    // `one-shot`; the only thing separating their lines is the half the
    // discount pays for. `you`, not `your board`, because `player` stakes take
    // life and cards rather than permanents.
    const falls = impactRows(TORMENT).find((row) => row.label === 'Falls on')
    expect(falls?.value).toBe('a player, not the board, never you')
    expect(falls?.value).not.toBe(impactRows(WRATH)[2]?.value)
  })

  it('does not tell a card that only hits your own board that it never hits yours', () => {
    // The regression. Craterhoof is `own` + `one-sided` and the flat qualifier
    // rendered "your own side — never yours" under the card's own text.
    const falls = impactRows(CRATERHOOF).find((row) => row.label === 'Falls on')
    expect(falls?.value).toBe('your own side')
    expect(falls?.value).not.toContain('never')
  })

  it('draws no tier rows for a card with no rules text', () => {
    // Every tier of `NO_IMPACT` is a default rather than a finding — `stakes:
    // 'self'` on a Forest is not the model saying the land targets itself.
    // Printing them would be three confident sentences about nothing.
    expect(impactRows(VANILLA)).toEqual([])
  })
})

describe('impactNotes', () => {
  it('always names the blind spot, because a low score otherwise reads as a verdict', () => {
    // `impact.ts`: Sol Ring scores 0.68 and that was accepted, not patched. A
    // reader not told the model is blind to mana concludes the app rates Sol
    // Ring badly.
    for (const impact of [WRATH, TORMENT, VANILLA, FRAGILE, CRATERHOOF]) {
      expect(impactNotes(impact)).toContain(
        'Effects only: a card whose job is mana or a tax reads low here.',
      )
    }
  })

  it('marks a scaling card, and only a scaling card', () => {
    const scaling = impactNotes(TORMENT).join(' ')
    expect(scaling).toContain('Scales with X')
    expect(impactNotes(WRATH).join(' ')).not.toContain('Scales with X')
  })

  it('explains a permanent that reads as one-shot because it sacrifices itself', () => {
    expect(impactNotes(FRAGILE).join(' ')).toContain('sacrifices itself')
    expect(impactNotes(WRATH).join(' ')).not.toContain('sacrifices itself')
  })

  it('says a textless card has nothing to measure rather than leaving a bare 0', () => {
    expect(impactNotes(VANILLA).join(' ')).toContain('nothing here for this model to measure')
    expect(impactNotes(WRATH).join(' ')).not.toContain('nothing here for this model to measure')
  })
})

describe('efficiencyWorking', () => {
  /** `cardEfficiency(WRATH_OF_GOD)` — a noncreature, so no stat term at all. */
  const wrath: EfficiencyView = {
    score: 0.549,
    statSurplus: 0,
    effectValue: 2.744,
    baseline: 6.781,
    cost: 5,
  }

  /** `cardEfficiency(RAGAVAN)` — a creature over the going rate, so both terms count. */
  const overRate: EfficiencyView = {
    score: 0.198,
    statSurplus: 0.034,
    effectValue: 0.362,
    baseline: 2.966,
    cost: 2,
  }

  it('shows both terms and the denominator, so the rate can be checked', () => {
    // The number alone invites "higher is better, therefore better card". The
    // arithmetic is what shows a reader that the divisor is cost.
    expect(efficiencyWorking(overRate)).toBe(
      '0.034 of body above the 2.966 this mana usually buys, plus 0.362 for its text, over 2 — its mana plus the card itself.',
    )
  })

  it('does not claim a noncreature has a body it fell short of', () => {
    // `statSurplus` is 0 both for a noncreature and for a creature under the
    // rate, and the payload cannot tell them apart — so the phrase must be true
    // of both, and the baseline is not quoted at a card it does not apply to.
    expect(efficiencyWorking(wrath)).toContain('No surplus body')
    expect(efficiencyWorking(wrath)).not.toContain('6.781')
    expect(efficiencyWorking(wrath)).toContain('2.744 for its text')
  })

  it('carries the caveat that a ratio needs', () => {
    // The first efficiency formula rated Grizzly Bears 2.00 against Wrath of
    // God 0.69 (`efficiency.ts`). The shipped one measures surpluses and no
    // longer does that, but it still divides by cost.
    expect(EFFICIENCY_CAVEAT).toContain('not a ranking')
    expect(EFFICIENCY_CAVEAT).toContain('out-rate a bomb')
  })
})
