import { describe, expect, it } from 'vitest'
import {
  EFFICIENCY_CAVEAT,
  IMPACT_MAX,
  efficiencyAlgorithm,
  efficiencyWorking,
  impactAlgorithm,
  impactFraction,
  impactNotes,
  impactRoleLine,
  impactRows,
  metricValue,
  type EfficiencyView,
  type ImpactRoleView,
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

/** `cardImpact(WRATH_OF_GOD)` — unbounded, one-shot, opposing, symmetric, destroy. */
const WRATH: ImpactView = {
  score: 6.12,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'symmetric',
  severity: 'destroy',
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
  severity: 'none',
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
  severity: 'none',
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
  severity: 'none',
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
  severity: 'none',
  scales: false,
  fragile: false,
}

/**
 * `cardImpact(AGATHAS_SOUL_CAULDRON)` — the specimen behind the reach copy.
 *
 * Unbounded, and every bit of that reach is the caster's own side: "creatures
 * you control" three times, and the graveyards. It read "everything at once".
 */
const AGATHA: ImpactView = {
  score: 9.6,
  breadth: 'unbounded',
  persistence: 'activated',
  stakes: 'own',
  symmetry: 'one-sided',
  severity: 'none',
  scales: false,
  fragile: false,
}

/** `cardImpact(CYCLONIC_RIFT)` — unbounded and pointed the other way. */
const CYCLONIC_RIFT: ImpactView = {
  score: 7.2,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'one-sided',
  severity: 'none',
  scales: false,
  fragile: false,
}

/** `cardImpact(NEVINYRRALS_DISK)` — a symmetric wipe, so its reach really is everything. */
const DISK: ImpactView = {
  score: 9.792,
  breadth: 'unbounded',
  persistence: 'activated',
  stakes: 'opposing',
  symmetry: 'symmetric',
  severity: 'none',
  scales: false,
  fragile: false,
}

/**
 * The role bands, copied verbatim from `packages/domain/src/impact/by-role.data.json`.
 *
 * REAL MEASUREMENTS, and deliberately four different shapes. A fixture set in
 * which every role had the same band could not tell "placed against its own
 * role" from "placed against a constant" — which is the only thing this copy
 * claims — and every assertion below would pass on a renderer that ignored the
 * role entirely.
 *
 *   board-wipe   the model reads almost all of them; the band sits high
 *   ramp         the model is blind to two thirds; the band sits at the floor
 *   land         blind to three quarters; the band is 0.31 wide on an 18.48 scale
 *   spot-removal blind to NONE of them, the control that keeps the blindness
 *                copy from being unconditional by accident
 */
const BOARD_WIPE: ImpactRoleView = {
  role: 'board-wipe',
  n: 502,
  q1: 6.12,
  q3: 8.4,
  placement: 'middle-half',
  mostlyUnreadable: false,
  noCountableEffect: 70,
}
const RAMP: ImpactRoleView = {
  role: 'ramp',
  n: 1401,
  q1: 0.68,
  q3: 1.4,
  placement: 'middle-half',
  mostlyUnreadable: true,
  noCountableEffect: 961,
}
const LAND: ImpactRoleView = {
  role: 'land',
  n: 1194,
  q1: 0.68,
  q3: 0.99,
  placement: 'bottom-quarter',
  mostlyUnreadable: true,
  noCountableEffect: 896,
}
const SPOT_REMOVAL: ImpactRoleView = {
  role: 'spot-removal',
  n: 3273,
  q1: 1.2,
  q3: 1.92,
  placement: 'middle-half',
  mostlyUnreadable: false,
  noCountableEffect: 0,
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
    // Wrath of God is a bit over a quarter of the way up, which is the shape of
    // the claim the meter makes: a board wipe is a high card and is nowhere near
    // the top. It was a third until ADR-0055 added severity and the ceiling rose
    // from 18.48 to 22.176 — the meter moved because the scale did, not because
    // the card did.
    expect(impactFraction(6.12)).toBeCloseTo(27.6, 1)
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
  it('says what a wrath reaches, how often, whose board, and what is left', () => {
    expect(impactRows(WRATH)).toEqual([
      { label: 'Reach', value: 'everything at once' },
      { label: 'Repeats', value: 'once, then it is done' },
      { label: 'Falls on', value: "an opponent's side, your board included" },
      { label: 'Ends up', value: 'in the graveyard' },
    ])
  })

  it('draws no "Ends up" row for a card that removes nothing', () => {
    // 79.5% of the corpus has `severity: 'none'`. A row that never varies on
    // four cards in five is a row that stops being read, so it is not drawn.
    const rows = impactRows(CRATERHOOF)
    expect(rows.map((row) => row.label)).not.toContain('Ends up')
    expect(rows).toHaveLength(3)
  })

  it('names each rung in the pane\u2019s own register', () => {
    const endsUp = (severity: ImpactView['severity']): string | undefined =>
      impactRows({ ...WRATH, severity }).find((row) => row.label === 'Ends up')?.value
    expect(endsUp('tap')).toBe('tapped, and still there')
    expect(endsUp('flicker')).toBe('right back where it was')
    expect(endsUp('bounce')).toBe("in its owner's hand")
    expect(endsUp('damage')).toBe('damaged, and dead only sometimes')
    expect(endsUp('destroy')).toBe('in the graveyard')
    expect(endsUp('exile')).toBe('gone for good')
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
    // Torment removes nothing — it takes life and cards, not permanents.
    expect(impactRows(TORMENT).map((row) => row.label)).not.toContain('Ends up')
  })

  it('does not tell a card that only hits your own board that it never hits yours', () => {
    // The regression. Craterhoof is `own` + `one-sided` and the flat qualifier
    // rendered "your own side — never yours" under the card's own text.
    const falls = impactRows(CRATERHOOF).find((row) => row.label === 'Falls on')
    expect(falls?.value).toBe('your own side')
    expect(falls?.value).not.toContain('never')
  })

  /*
   * REACH SAYS WHOSE, when the model knows whose.
   *
   * "Everything at once" is true of a wrath and an over-claim on everything
   * else that is `unbounded`. Agatha's Soul Cauldron reaches the creatures you
   * control and the graveyards, and reporting that as "everything at once" is
   * what the product owner read and disbelieved. Craterhoof had carried the
   * same over-claim since it was written.
   *
   * The refinement takes no new field: `symmetry` and `stakes` are already on
   * the wire and already decide the "Falls on" row. A symmetric mass effect
   * really does hit everything, so it keeps the unqualified words.
   */
  it('says whose side an unbounded ONE-SIDED effect reaches', () => {
    const reach = (rows: readonly { label: string; value: string }[]): string | undefined =>
      rows.find((row) => row.label === 'Reach')?.value
    expect(reach(impactRows(CRATERHOOF))).toBe('your whole side at once')
    expect(reach(impactRows(AGATHA))).toBe('your whole side at once')
    expect(reach(impactRows(CYCLONIC_RIFT))).toBe("an opponent's whole side at once")
  })

  it('leaves a symmetric mass effect saying everything, because it is everything', () => {
    const reach = impactRows(WRATH).find((row) => row.label === 'Reach')
    expect(reach?.value).toBe('everything at once')
    expect(impactRows(DISK).find((row) => row.label === 'Reach')?.value).toBe('everything at once')
  })

  it('leaves the counted tiers alone', () => {
    // The refinement is only ever about `unbounded`; a card that names one
    // thing says so whoever it belongs to.
    expect(impactRows(FRAGILE).find((row) => row.label === 'Reach')?.value).toBe('one thing')
  })
})

/**
 * HOW THE NUMBER WAS ARRIVED AT (report 5).
 *
 * Not the formula. A reader looking at Sol Ring's 0.68 wants to know why it is
 * low, and `0.5 × 1.6 × 0.85` does not tell them — it restates the number in a
 * second notation. What tells them is that only effects are read, that Sol Ring
 * names nothing to affect, and that this is a known limit rather than a verdict.
 *
 * The register is the pane's own: "Reach: everything at once", "Effects only".
 * Short sentences, the game's words, no algebra, and no constant that could
 * drift out of step with the data file it came from.
 */
describe('impactAlgorithm', () => {
  it("names the three readings the pane already shows, in the pane's own words", () => {
    const said = impactAlgorithm().join(' ')
    expect(said).toContain('Reach')
    expect(said).toContain('Repeats')
    expect(said).toContain('Falls on')
    // Multiplied, not added — the shape of the model in one word.
    expect(said).toContain('multiplied')
  })

  it('says the deck is never consulted, which is the decision behind the whole metric', () => {
    expect(impactAlgorithm().join(' ')).toContain('same in every deck')
  })

  it('names the blind spot rather than leaving a low score unexplained', () => {
    // doc 18 §18.2 accepts the blindness rather than patching it, and this is
    // where a reader is told, at the moment they are looking at the number.
    expect(impactAlgorithm().join(' ').toLowerCase()).toContain('mana')
  })

  it('quotes no constant that lives in a data file', () => {
    // The tier values are in `impact.ts` and `r` is in `baseline.data.json`.
    // Copy that repeats either goes stale the first time one moves, with
    // nothing to catch it — a UI string is not covered by the model's tests.
    const said = impactAlgorithm().join(' ')
    for (const drifts of ['0.4484', '0.85', '2.2', '1.4', '6.0']) {
      expect(said).not.toContain(drifts)
    }
  })
})

describe('efficiencyAlgorithm', () => {
  it('explains both halves of the numerator and the plus one', () => {
    const said = efficiencyAlgorithm().join(' ')
    expect(said.toLowerCase()).toContain('body')
    expect(said.toLowerCase()).toContain('text')
    // The `+ 1` is the card itself, and it is the part a reader cannot guess.
    expect(said).toContain('the card itself')
  })

  it('says the going rate is measured rather than assumed', () => {
    // The whole point of §18.6: the folk "2/2 for 2" rule is wrong and the
    // baseline is regenerated from the corpus.
    expect(efficiencyAlgorithm().join(' ')).toContain('measured')
  })

  it('says surpluses, because that is what rejected the first formula', () => {
    expect(efficiencyAlgorithm().join(' ').toLowerCase()).toContain('above')
  })

  it('quotes no constant that lives in a data file', () => {
    const said = efficiencyAlgorithm().join(' ')
    for (const drifts of ['0.4484', '6.78', '1.6993']) {
      expect(said).not.toContain(drifts)
    }
  })

  it('draws no tier rows for a card with no rules text', () => {
    // Every tier of `NO_IMPACT` is a default rather than a finding — `stakes:
    // 'self'` on a Forest is not the model saying the land targets itself.
    // Printing them would be three confident sentences about nothing.
    expect(impactRows(VANILLA)).toEqual([])
  })
})

describe('impactRoleLine', () => {
  /**
   * THE REGRESSION THIS WHOLE FEATURE IS. Sol Ring scores 0.68 of 18.48; a
   * reader with no comparison concludes the app rates it near-worthless. It is
   * the MEDIAN ramp card, and saying so is the entire fix.
   */
  it('reads one score as ordinary in one role and exceptional in another', () => {
    const solRing = impactRoleLine({ ...WRATH, score: 0.68 }, RAMP)
    const craterhoof = impactRoleLine(CRATERHOOF, { ...RAMP, placement: 'top-quarter' })
    expect(solRing).toContain('Middle half')
    expect(craterhoof).toContain('Top quarter')
    expect(solRing).not.toBe(craterhoof)
  })

  it('prints the corpus quartiles beside the verdict, so the cutoff is visible', () => {
    // doc 18 §18.9 declined to give the model bands and `impactRows` rejected
    // letter grades because "every cutoff would be the renderer's opinion".
    // These cutoffs are the corpus's own and they are on the screen — a reader
    // can disagree with the placement by reading the two numbers it used.
    expect(impactRoleLine(WRATH, BOARD_WIPE)).toBe(
      'Middle half of the 502 board-wipe cards in the corpus; half of them score 6.12 to 8.4.',
    )
  })

  it('groups the thousands, because 11820 in a sentence reads as a score', () => {
    expect(impactRoleLine(WRATH, LAND)).toContain('the 1,194 land cards')
  })

  it('names the role with the same word the pane already prints on its badge', () => {
    // `RoleDot` draws the raw role name two lines above this. A prettified
    // synonym here would leave a reader wondering whether "removal" and
    // "spot-removal" are the same thing the app is talking about.
    expect(impactRoleLine(WRATH, SPOT_REMOVAL)).toContain('spot-removal cards')
  })

  it('says nothing at all when the card has no rules text', () => {
    // Same rule `impactRows` follows. The pane already says there is nothing
    // here to measure, and ranking a card the model has declared unreadable
    // against its peers would contradict the line above it.
    expect(impactRoleLine(VANILLA, LAND)).toBeNull()
  })

  it('says nothing at all when the role is unknown', () => {
    // A card whose role never reached the pane, or a role the corpus measured
    // no cards for. Silence, not a band of zeroes.
    expect(impactRoleLine(WRATH, undefined)).toBeNull()
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

  it('quantifies the blind spot for a role the model mostly cannot read', () => {
    // "Effects only" is true of every card and is therefore easy to skim past.
    // For a land it is not a caveat, it is the headline: three quarters of them
    // name nothing this model can count, so the band above is largely a
    // measurement of its own blind spot.
    const note = impactNotes(WRATH, LAND).join(' ')
    expect(note).toContain('896 of those 1,194')
    expect(note).toContain('blind spot')
    // REPLACES the generic caveat rather than stacking a second one on it —
    // they are the same claim, and the quantified one is strictly better.
    expect(note).not.toContain('a card whose job is mana or a tax reads low here')
  })

  it('leaves the generic caveat alone for a role the model reads well', () => {
    // The control. Spot removal has 0 of 3,273 unreadable, and a "blind spot"
    // sentence there would be a false statement dressed up as sourcing.
    for (const role of [BOARD_WIPE, SPOT_REMOVAL]) {
      const note = impactNotes(WRATH, role).join(' ')
      expect(note).toContain('Effects only: a card whose job is mana or a tax reads low here.')
      expect(note).not.toContain('blind spot')
    }
  })

  it('quantifies the blind spot for ramp, which is where a low score misleads most', () => {
    // Not just lands. 961 of 1,401 ramp cards have nothing this model can
    // count, which is exactly why Sol Ring reads low, and the pane says so with
    // the number rather than leaving the reader to guess.
    expect(impactNotes(WRATH, RAMP).join(' ')).toContain('961 of those 1,401')
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
