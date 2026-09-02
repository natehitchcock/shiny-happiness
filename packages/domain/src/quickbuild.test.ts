import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from './archetype.js'
import { compositionTargets } from './archetype-targets.js'
import type { Card, CardType } from './card.js'
import { countComposition } from './composition-analysis.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import { curveDeltas, curveTarget } from './curve.js'
import type { Deck } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import { validateDeck } from './legality.js'
import {
  buildOrder,
  deferredDimensions,
  DECK_SIZE,
  gapQuery,
  handoverSize,
  quickbuildPlan,
  type QuickbuildGap,
} from './quickbuild.js'
import type { Role } from './role.js'

const targetsFor = (archetype: Parameters<typeof compositionTargets>[0]) =>
  compositionTargets(archetype, null, { bracket: 3 })

/** The row every other archetype is stated relative to (doc 14 §14.3). */
const REFERENCE = targetsFor('midrange')

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

const deckOf = (cards: readonly Card[]): Deck => ({
  id: deckId('d'),
  name: 'd',
  description: '',
  commanders: [oracleId('cmd')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries: cards.map((c) => ({
    oracleId: c.oracleId,
    zone: 'accepted' as const,
    origin: 'manual' as const,
    locked: false,
    roleOverride: null,
    tags: [],
    addedAt: '',
  })),
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 1,
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: '',
})

const countsOf = (cards: readonly Card[]) =>
  countComposition(deckOf(cards), new Map(cards.map((c) => [c.oracleId, c])))

/** A deck of `n` vanilla two-drop creatures, to move the curve without roles. */
const filler = (n: number, manaValue = 2): readonly Card[] =>
  Array.from({ length: n }, (_, i) => card(`filler-${manaValue}-${i}`, { manaValue }))

/** Lands, which move the composition target but never the curve (Q6). */
const lands = (n: number): readonly Card[] =>
  Array.from({ length: n }, (_, i) =>
    card(`land-${i}`, {
      types: ['land'] as readonly CardType[],
      typeLine: 'Land',
      roles: ['land'] as readonly Role[],
      primaryRole: 'land',
      manaValue: 0,
    }),
  )

/*
 * The structural input, built from the REAL domain values.
 *
 * `quickbuildPlan` takes four numbers per target rather than a
 * `CompositionTarget`, so that the web app can hand it the same numbers its
 * meters render. The tests still go through `countComposition`,
 * `compositionTargets` and `curveDeltas` to get there — otherwise they would be
 * asserting against numbers typed into this file rather than against the
 * model.
 */
const inputFor = (
  cards: readonly Card[],
  archetype: Parameters<typeof compositionTargets>[0] = 'midrange',
) => {
  const counts = countsOf(cards)
  const targets = targetsFor(archetype)
  return {
    total: counts.total,
    targets: targets.map((t) => ({
      dimension: t.dimension,
      ideal: t.ideal,
      min: t.min,
      actual: counts.byDimension.get(dimensionKey(t.dimension)) ?? 0,
    })),
    curveDeltas: curveDeltas(counts.manaCurve, curveTarget(archetype, null, {})),
    bracket: 3 as const,
  }
}

const keys = (gaps: readonly QuickbuildGap[]) => gaps.map((g) => g.key)

const DEFERRED = deferredDimensions(3)

describe('deferred dimensions — a target the deck’s own contents move (ADR-0040)', () => {
  /*
   * The derivation behind "lands last", and the reason it is a probe rather
   * than the string `role:land`.
   *
   * `compositionTargets` computes most ideals from the archetype and the
   * bracket alone, so they are known the moment the deck is named. The land
   * ideal is not: the curve modifier moves it by one in each direction against
   * the deck's own `averageManaValue`, and `modalLandBacks` moves it again. So
   * the land target is a FUNCTION OF THE DECK YOU HAVE ALREADY BUILT, and a
   * dimension whose target is not yet known cannot honestly be built first.
   *
   * This test asserts the probe finds land WITHOUT naming it as an input — it
   * runs `compositionTargets` under four deck shapes and asks which ideals
   * moved. That is the same answer the implementation reaches, reached
   * independently here.
   */
  it('finds the dimensions whose ideal moves with the deck, by asking the model', () => {
    const moved = new Set<string>()
    for (const archetype of ARCHETYPES) {
      const shapes = [
        compositionTargets(archetype, null, { bracket: 3 }),
        compositionTargets(archetype, null, { bracket: 3, averageManaValue: 2.0 }),
        compositionTargets(archetype, null, { bracket: 3, averageManaValue: 4.0 }),
        compositionTargets(archetype, null, {
          bracket: 3,
          averageManaValue: 4.0,
          modalLandBacks: 6,
        }),
      ]
      for (const target of shapes[0]!) {
        const key = dimensionKey(target.dimension)
        const ideals = shapes.map(
          (shape) => shape.find((t) => dimensionKey(t.dimension) === key)?.ideal,
        )
        if (new Set(ideals).size > 1) moved.add(key)
      }
    }
    expect([...moved].sort()).toEqual([...DEFERRED].sort())
  })

  /*
   * Today that set is exactly `role:land` — recorded so a change in
   * `archetype-targets.ts` that gives another dimension a deck-dependent
   * modifier shows up here as a failing expectation rather than as a silent
   * reordering of the build order.
   */
  it('is exactly the land count today', () => {
    expect([...DEFERRED]).toEqual([dimensionKey(roleDimension('land'))])
  })
})

describe('build order (Q2, derived from the archetype targets)', () => {
  /*
   * The user's report: "for quickbuilding, lands are the last things you should
   * pick. You want to start with the big things."
   *
   * Land leads every archetype's targets — 34 to 37, the largest ideal in every
   * row — so sorting by descending ideal alone put it first everywhere, which
   * is exactly backwards. It goes last now, in all nine archetypes, and it gets
   * there through `deferredDimensions` rather than through its name.
   */
  it('puts the deck-dependent target LAST in every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const order = buildOrder(targetsFor(archetype), REFERENCE, DEFERRED)
      expect(order[order.length - 1]).toBe(dimensionKey(roleDimension('land')))
    }
  })

  /*
   * The deferral is doing the work, and this is the mutation guard for it:
   * with nothing deferred the same comparator puts land back at the front,
   * because its ideal is still the largest number in the row. Delete the
   * deferral term and this test and the one above cannot both pass.
   */
  it('would still lead with land if nothing were deferred — the deferral is what moves it', () => {
    const order = buildOrder(targetsFor('midrange'), REFERENCE, new Set())
    expect(order[0]).toBe(dimensionKey(roleDimension('land')))
  })

  /*
   * The derivation, stated as a test rather than only as a comment: past the
   * deferred dimensions the order IS the targets sorted by what the archetype
   * spends on them. Nothing here is a list someone typed.
   */
  it('is the archetype’s own ideals, largest commitment first, past the deferred ones', () => {
    const order = buildOrder(targetsFor('midrange'), REFERENCE, DEFERRED)
    expect(order[0]).toBe(dimensionKey(typeDimension('creature'))) // 26
    expect(order[1]).toBe(dimensionKey(roleDimension('ramp'))) // 11
    expect(order[2]).toBe(dimensionKey(roleDimension('draw'))) // 9
  })

  /*
   * The point of deriving it rather than hardcoding one list: each archetype's
   * identity dimension rises on its own, because the archetype spends slots on
   * the thing it is about. No per-archetype table says "stax decks care about
   * stax" — the number 12 already said it.
   */
  it('floats each archetype’s identity dimension up without being told to', () => {
    expect(buildOrder(targetsFor('tokens'), REFERENCE, DEFERRED).slice(0, 2)).toContain(
      dimensionKey(roleDimension('token-maker')),
    )
    expect(buildOrder(targetsFor('stax'), REFERENCE, DEFERRED).slice(0, 3)).toContain(
      dimensionKey(roleDimension('stax')),
    )
    expect(buildOrder(targetsFor('voltron'), REFERENCE, DEFERRED).slice(0, 5)).toContain(
      dimensionKey(roleDimension('equipment')),
    )
    expect(buildOrder(targetsFor('aristocrats'), REFERENCE, DEFERRED).slice(0, 5)).toContain(
      dimensionKey(roleDimension('recursion')),
    )
  })

  /*
   * The other half of the user's principle — "start with the big things like
   * bombs, win conditions, high synergy combos".
   *
   * `wincon` and `synergy` are roles but NO archetype gives either an ideal, so
   * neither is a composition dimension and neither can ever be a gap. What the
   * table does name is `creature`, and `archetype-targets.ts` reads the unroled
   * remainder as "the threats" — so the creature count is the closest thing the
   * model has to a bomb count, and it leads every archetype now that land is
   * deferred. The rest of the user's phrase is answered by the panel's ending
   * rather than by an ordering; see `unroled` below.
   */
  it('leads with the threat count in every archetype', () => {
    for (const archetype of ARCHETYPES) {
      expect(buildOrder(targetsFor(archetype), REFERENCE, DEFERRED)[0]).toBe(
        dimensionKey(typeDimension('creature')),
      )
    }
  })

  /*
   * Ties are broken by distance from the midrange row, which doc 14 and
   * `archetype-targets.ts` both name as the reference every other row is stated
   * relative to. Stax spends 12 on `ramp` and 12 on `stax`; midrange spends 11
   * on ramp and nothing at all on stax, so `stax` is the one that says what
   * this deck is, and it goes first. Alphabetical would have put ramp first for
   * no reason anyone could defend.
   */
  it('breaks a tie toward the dimension that departs furthest from midrange', () => {
    const order = buildOrder(targetsFor('stax'), REFERENCE, DEFERRED)
    expect(order.indexOf(dimensionKey(roleDimension('stax')))).toBeLessThan(
      order.indexOf(dimensionKey(roleDimension('ramp'))),
    )
  })

  it('is total and deterministic — same input, same order, every time', () => {
    const once = buildOrder(targetsFor('aristocrats'), REFERENCE, DEFERRED)
    const twice = buildOrder(targetsFor('aristocrats'), REFERENCE, DEFERRED)
    expect(once).toEqual(twice)
    expect(new Set(once).size).toBe(once.length)
    expect(once.length).toBe(targetsFor('aristocrats').length)
  })
})

describe('handover from build order to largest-gap-first (Q2, re-derived)', () => {
  /*
   * RE-DERIVED, because the old derivation stopped being true.
   *
   * It used to be the archetype's largest single target — the land count, 34 to
   * 37 — and it was safe to put anywhere in that region because "the two
   * orderings coincide on an empty deck": with nothing accepted every deficit
   * equals its own ideal, so largest-gap and largest-commitment were the same
   * list. Deferring the land count broke that coincidence outright (the test
   * below now pins the DISAGREEMENT), so the threshold really does adjudicate
   * between two rival answers and has to be derived again from what separates
   * them.
   *
   * The new derivation: the smallest deck that COULD be inside every band —
   * the sum of the role dimensions' minima. It is a genuine lower bound
   * because role counts do not overlap (`archetype-targets.ts` constraint 1:
   * "`land + Σ roles` is therefore a real budget against 99"), and type
   * dimensions are excluded from the sum precisely because they do overlap
   * roles and would be counted twice.
   *
   * Below it, being short somewhere is arithmetic rather than evidence: the
   * deck does not hold enough cards to be inside every band no matter how they
   * were spent, so worst-first is restating the archetype and the plan is the
   * only thing that can distinguish the dimensions. At or above it, a shortfall
   * is a fact about THIS deck and the deck's own shape wins.
   *
   * The same number ends the loop, which is what makes the three behaviours one
   * idea rather than three: a deck that reaches every band has reached at least
   * `handoverSize` cards by construction, which is why "all allotments met" and
   * "58 of 100" arrive together.
   */
  it('is the smallest deck that could be inside every band', () => {
    const sumOfMinima = (archetype: Parameters<typeof compositionTargets>[0]) =>
      targetsFor(archetype)
        .filter((t) => t.dimension.kind === 'role')
        .reduce((sum, t) => sum + t.min, 0)
    for (const archetype of ARCHETYPES) {
      expect(handoverSize(targetsFor(archetype))).toBe(sumOfMinima(archetype))
    }
    /*
     * The numbers themselves, so a change in `archetype-targets.ts` is visible
     * rather than silent. They have already moved once: ADR-0037 split
     * `counterspell` and `bounce` out of `spot-removal`, which took midrange
     * from 56 to 55 and stax from 67 to 65. The derivation above is what did
     * not move, and it is why updating these three lines was the whole cost.
     */
    expect(handoverSize(targetsFor('midrange'))).toBe(55)
    expect(handoverSize(targetsFor('aggro'))).toBe(49)
    expect(handoverSize(targetsFor('stax'))).toBe(65)
  })

  /*
   * It is no longer the largest single target, and that is the whole change.
   * Written as an assertion so the old derivation cannot creep back.
   */
  it('is no longer the archetype’s largest single target', () => {
    const largest = targetsFor('midrange').reduce((most, t) => Math.max(most, t.ideal), 0)
    expect(largest).toBe(36)
    expect(handoverSize(targetsFor('midrange'))).toBeGreaterThan(largest)
  })

  it('follows the build order while the deck is below it', () => {
    const plan = quickbuildPlan(inputFor(filler(10), 'midrange'))
    expect(plan.ordering).toBe('build-order')
  })

  /*
   * The build order is FOLLOWED, not merely reported.
   *
   * Thirty lands is the case that separates the two rules. The deck is three
   * lands short and twenty creatures short, so worst-first would say
   * "creatures"; the build order says "lands", because finishing the mana base
   * is what the archetype spends most on and what the rest of the deck is built
   * against. Both answers are defensible and they are different, which is the
   * point — a test on an empty deck cannot tell them apart, because there the
   * two orders coincide.
   *
   * This test exists because the mutation check found the first version of this
   * suite asserting only `plan.ordering === 'build-order'`, which is a label.
   * Deleting the build order from the comparator left all 22 tests passing.
   */
  /*
   * The build order is FOLLOWED, not merely reported.
   *
   * Three lands short and twenty creatures short: worst-first says "creatures"
   * on size, and so does the build order now, so that pair no longer separates
   * the rules. What separates them is where LAND lands — worst-first would put
   * a land gap wherever its size puts it, and the build order puts it last
   * whatever its size.
   */
  it('puts the deferred gap last below the handover, whatever its size', () => {
    const plan = quickbuildPlan(inputFor([...lands(10), ...filler(5)], 'midrange'))
    const composition = plan.gaps.filter((g) => g.kind === 'composition')
    const land = composition.find((g) => g.key === dimensionKey(roleDimension('land')))!
    expect(land.short).toBe(23)
    // Bigger than several gaps it now sits behind — so this is the build order
    // talking and not the size.
    const behind = composition.filter((g) => g.short < land.short)
    expect(behind.length).toBeGreaterThan(0)
    expect(keys(composition)[composition.length - 1]).toBe(dimensionKey(roleDimension('land')))
    expect(keys(composition)[0]).toBe(dimensionKey(typeDimension('creature')))
  })

  it('switches to worst-first once the deck reaches it', () => {
    const plan = quickbuildPlan(inputFor([...lands(33), ...filler(25)], 'midrange'))
    expect(plan.ordering).toBe('largest-first')
  })

  /*
   * The two orderings NO LONGER agree on an empty deck, and this test records
   * that rather than hiding it.
   *
   * The old handover argument was that they coincide there — every deficit
   * equals its own ideal with nothing accepted, so largest-gap and
   * largest-commitment are the same list — which made the threshold's exact
   * value not matter. Deferring the land count reverses land's position
   * outright: worst-first leads with it because 33 is the biggest number on the
   * board, and the build order ends with it because its target is not known
   * until the rest of the deck is. So the threshold now chooses between two
   * genuinely different answers, which is why it was re-derived above.
   */
  it('DISAGREES with worst-first on a completely empty deck — the coincidence is gone', () => {
    const plan = quickbuildPlan(inputFor([], 'midrange'))
    const composition = plan.gaps.filter((g) => g.kind === 'composition')
    const worstFirst = [...composition].sort(
      (a, b) => b.short - a.short || (a.key < b.key ? -1 : 1),
    )
    expect(plan.ordering).toBe('build-order')
    expect(keys(worstFirst)[0]).toBe(dimensionKey(roleDimension('land')))
    expect(keys(composition)[composition.length - 1]).toBe(dimensionKey(roleDimension('land')))
    expect(keys(composition)).not.toEqual(keys(worstFirst))
  })
})

describe('gaps', () => {
  it('reports a land shortfall as a composition gap, never a curve one (Q6)', () => {
    const plan = quickbuildPlan(inputFor(filler(10), 'midrange'))
    expect(keys(plan.gaps)).toContain(dimensionKey(roleDimension('land')))
    expect(plan.gaps.filter((g) => g.kind === 'curve').map((g) => g.key)).not.toContain('mv:0')
  })

  const RAMP = dimensionKey(roleDimension('ramp'))
  const rocks = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      card(`rock-${i}`, { roles: ['ramp'] as readonly Role[], primaryRole: 'ramp' }),
    )
  const planWith = (cards: readonly Card[]) => quickbuildPlan(inputFor(cards, 'midrange'))

  /*
   * Midrange wants 11 ramp with a half-width of 3, so the band is 8–14. A deck
   * at 9 is BELOW the ideal and INSIDE the band, and that is the whole point of
   * the band existing (doc 05 §5.4 — "a deck at 34 lands is not broken and the
   * UI must not say it is").
   *
   * Nine rather than eleven on purpose. At the ideal, `shortfalls` already
   * drops the dimension because its delta is zero, so a test written there
   * passes whether or not the band is honoured and proves nothing — which is
   * exactly what the first version of this test did, and a mutation that
   * deleted the band check survived it.
   */
  it('never reports a gap for a dimension inside its band but under the ideal', () => {
    expect(keys(planWith(rocks(9)).gaps)).not.toContain(RAMP)
  })

  /*
   * And the size is the distance to the BAND EDGE, not to the ideal. At 5 ramp
   * the deck needs 3 more to stop being wrong, not 6 to be perfect — asking for
   * 6 would have Quickbuild keep working a gap the meter beside it already
   * shows as satisfied.
   */
  it('sizes a gap by the distance to the band, not to the ideal', () => {
    const gap = planWith(rocks(5)).gaps.find((g) => g.key === RAMP)!
    expect(gap.short).toBe(3) // min 8 − actual 5, NOT ideal 11 − 5
  })

  it('gives every gap a positive card count — a gap is always something to add', () => {
    const plan = quickbuildPlan(inputFor(filler(30), 'midrange'))
    expect(plan.gaps.length).toBeGreaterThan(0)
    for (const gap of plan.gaps) expect(gap.short).toBeGreaterThan(0)
  })
})

describe('over-full buckets (Q5) — stated, never silently skipped', () => {
  /*
   * 30 two-drops in a midrange deck is far over the band at bucket 2. Quickbuild
   * adds only, so it cannot help; the requirement is that it SAYS so. Reporting
   * an empty gap list and no explanation is the failure this guards: a wizard
   * that appears to do nothing is worse than one that names its limit.
   */
  it('reports an over-full bucket separately from the gaps', () => {
    const plan = quickbuildPlan(inputFor(filler(30, 2), 'midrange'))
    expect(plan.overFull.map((o) => o.bucket)).toContain(2)
  })

  it('never puts an over-full bucket in the gaps — adding cannot fix it', () => {
    const plan = quickbuildPlan(inputFor(filler(30, 2), 'midrange'))
    expect(keys(plan.gaps)).not.toContain('mv:2')
  })

  it('says how many cards over it is, so the panel can point at the cut', () => {
    const plan = quickbuildPlan(inputFor(filler(30, 2), 'midrange'))
    const over = plan.overFull.find((o) => o.bucket === 2)!
    expect(over.excess).toBeGreaterThan(0)
  })
})

describe('gapQuery — the filter that finds candidates for a gap', () => {
  it('asks for the role a composition gap names', () => {
    const gap = { kind: 'composition', key: 'role:ramp', dimension: roleDimension('ramp') }
    expect(gapQuery(gap as QuickbuildGap)).toBe('role:ramp')
  })

  it('asks for the type a type gap names', () => {
    const gap = { kind: 'composition', key: 'type:creature', dimension: typeDimension('creature') }
    expect(gapQuery(gap as QuickbuildGap)).toBe('t:creature')
  })

  it('asks for an exact mana value for an ordinary curve bucket', () => {
    expect(gapQuery({ kind: 'curve', key: 'mv:2', bucket: 2 } as QuickbuildGap)).toBe('mv=2')
  })

  /*
   * Bucket 7 holds "seven or more" (`curveBucket` clamps), so `mv=7` is the
   * wrong question for it and silently drops every card above seven. Caught by
   * measurement, not by reading: asking `mv=7` for the top bucket missed
   * Darksteel Forge (mana value 9) on a real deck, which was the last failing
   * case in the Quickbuild gap probe.
   */
  it('asks for “or more” at the top bucket, which is a catch-all', () => {
    expect(gapQuery({ kind: 'curve', key: 'mv:7', bucket: 7 } as QuickbuildGap)).toBe('mv>=7')
  })

  /*
   * A curve gap asks about the mana value and NOTHING else.
   *
   * It is tempting to add `-t:land`, since `countComposition` leaves lands out
   * of `manaCurve`. It would be dead weight: a land is not counted in the
   * bucket, so the bucket cannot be short because of one, and lands are
   * answered by the `fills-land` composition gap instead (Q6). A clause that
   * narrows the honest answer to guard a case that cannot arise is a clause
   * that will one day exclude something it should not.
   */
  it('asks a curve gap about the mana value alone', () => {
    expect(gapQuery({ kind: 'curve', key: 'mv:2', bucket: 2 } as QuickbuildGap)).toBe('mv=2')
  })
})

describe('stability (D3) — the panel must not change its mind on every accept', () => {
  /*
   * D3: "a deck that is short one two-drop and one wipe should not alternate
   * between them on every recompute". Two gaps of equal size must therefore
   * have a total order that does not depend on map or array iteration luck.
   */
  /*
   * Equal-sized gaps come out in KEY order, which is what makes the sequence
   * total.
   *
   * Written as a property over every adjacent pair, and asserted to have found
   * some pairs at all, because the first version of this test ran the same
   * input eight times and compared the results — which `Array.prototype.sort`
   * makes trivially true whether or not a tie-break exists. Deleting the
   * tie-break left it passing; the mutation check is what caught that.
   *
   * A midrange deck of 40 vanilla two-drops has three gaps of size 1 (`mv:6`,
   * `role:board-wipe`, `role:tutor`) and two of size 5 (`mv:3`,
   * `role:spot-removal`), so there is genuinely something here to order.
   */
  it('breaks a tie between equal gaps by key, giving a total order', () => {
    const gaps = quickbuildPlan(inputFor(filler(40), 'midrange')).gaps
    let ties = 0
    for (let i = 1; i < gaps.length; i += 1) {
      const previous = gaps[i - 1]!
      const current = gaps[i]!
      if (previous.short !== current.short) continue
      ties += 1
      expect(previous.key < current.key).toBe(true)
    }
    expect(ties).toBeGreaterThan(0)
  })

  /*
   * A curve gap is measured to the EDGE of its band, exactly as `curveDeltas`
   * reports it — Quickbuild does not re-measure the curve, it carries the
   * number the panel beside it already shows.
   */
  it('carries the curve delta through as the gap size', () => {
    const gaps = quickbuildPlan(inputFor(filler(40), 'midrange')).gaps
    const atThree = gaps.find((g) => g.key === 'mv:3')!
    expect(atThree.short).toBe(5)
    expect(atThree.kind).toBe('curve')
  })

  it('produces the same order on repeated runs', () => {
    const runs = Array.from({ length: 8 }, () =>
      keys(quickbuildPlan(inputFor(filler(20), 'control')).gaps),
    )
    for (const run of runs) expect(run).toEqual(runs[0])
  })

  /*
   * The claim D3 actually makes: accepting a card for one gap must not
   * reshuffle the OTHER composition gaps. Adding a ramp card should move the
   * ramp gap and nothing else.
   *
   * Restricted to composition gaps deliberately, and this is a real limit
   * rather than a convenience. `curveDeltas` computes each bucket's band as a
   * fraction of the deck's own spell count, so adding ANY card moves every
   * bucket's edges a little and can legitimately change which buckets are
   * short. An assertion that the curve gaps hold still would be asserting
   * something false about the model, and the first honest version of this test
   * failed for exactly that reason. What must not happen is two gaps trading
   * places for no reason, which the test above pins.
   */
  it('keeps the other composition gaps stable when one card is added', () => {
    const before = quickbuildPlan(inputFor(filler(40), 'midrange'))
    const after = quickbuildPlan(
      inputFor(
        [
          ...filler(40),
          card('one-rock', { roles: ['ramp'] as readonly Role[], primaryRole: 'ramp' }),
        ],
        'midrange',
      ),
    )
    const untouched = (gaps: readonly QuickbuildGap[]) =>
      keys(gaps.filter((g) => g.kind === 'composition')).filter(
        (k) => k !== dimensionKey(roleDimension('ramp')),
      )
    expect(untouched(after.gaps)).toEqual(untouched(before.gaps))
  })
})

/*
 * The user's report: "quickbuild ended while I was below curve on ramp and
 * spot removal, and also only at 58 of 100 cards. Once all your curves are
 * satisfied, it should ask you if you'd like to continue quickbuilding, or go
 * back to the suggestion list now that your deck allotments are met and you
 * just need to pick X more cards."
 *
 * The arithmetic behind that 58, which is why it is not a coincidence: the role
 * minima sum to 56 for midrange at bracket 3, so a deck can be inside every
 * band at 56 cards and still be 44 short of a legal deck — and every one of
 * those 44 sits in a dimension the archetype gives no target to at all.
 * "Below curve on ramp" and "inside the ramp band" were both true at once,
 * because the band's floor is three cards under the ideal.
 */
describe('reach — the band is where Quickbuild stops having an opinion, not where the deck ends', () => {
  /** A card counted under one role, so a deck can be built to a target. */
  const roled = (role: Role, n: number, manaValue = 2): readonly Card[] =>
    Array.from({ length: n }, (_, i) =>
      card(`${role}-${i}`, { roles: [role] as readonly Role[], primaryRole: role, manaValue }),
    )

  /**
   * Inside every composition band, and no further.
   *
   * BUILT FROM THE TABLE rather than listed, so it tracks
   * `archetype-targets.ts` instead of having to be re-counted every time a role
   * is added. ADR-0037 split `counterspell` and `bounce` out of `spot-removal`
   * while this was being written, and a hand-listed fixture would have gone
   * quietly wrong at exactly the numbers these tests are about.
   *
   * Non-land role cards are creatures, which is what also carries the
   * `type:creature` floor of 20 — there are 22 of them.
   */
  const atEveryBand = (archetype: Parameters<typeof compositionTargets>[0] = 'midrange') =>
    targetsFor(archetype)
      .filter((t) => t.dimension.kind === 'role')
      .flatMap((t) =>
        t.dimension.kind === 'role' && t.dimension.role === 'land'
          ? lands(t.min)
          : roled((t.dimension as { role: Role }).role, t.min),
      )

  it('is exactly the handover size — the number behind the report', () => {
    // 55 for midrange at bracket 3. It was 56 before ADR-0037 split
    // `counterspell` and `bounce` out of `spot-removal`; the user's deck was at
    // 58, which is the same neighbourhood either way.
    expect(atEveryBand().length).toBe(handoverSize(targetsFor('midrange')))
    expect(atEveryBand().length).toBe(55)
  })

  /*
   * The defect the report names, stated as the model sees it: at the bottom of
   * its band a dimension is three cards under its ideal, so the composition
   * meter reads "8 / 11" — visibly below — while Quickbuild has nothing to say
   * about it. Both readings are honest; showing only one of them is not.
   */
  it('reports no BAND gap for a dimension sitting at the floor of its band', () => {
    const plan = quickbuildPlan(inputFor(atEveryBand(), 'midrange'))
    expect(keys(plan.gaps.filter((g) => g.kind === 'composition'))).toEqual([])
  })

  it('reports the SAME dimensions as gaps that are still short of the ideal', () => {
    const plan = quickbuildPlan(inputFor(atEveryBand(), 'midrange'))
    const beyond = plan.beyond.filter((g) => g.kind === 'composition')
    /*
     * The two the report names. Each is at the FLOOR of its band and therefore
     * short of its ideal by the band's own half-width, which is the whole of
     * "below curve on ramp and spot removal" while Quickbuild had nothing to
     * say: ramp sits at 8 against an ideal of 11, and its meter reads 8 / 11.
     *
     * The expected distance is read off the target rather than typed, because
     * the band widths are `archetype-targets.ts`'s to change — and it did
     * change spot removal's under ADR-0037, from 3 to 2.
     */
    const shortOf = (role: Role) => {
      const target = targetsFor('midrange').find(
        (t) => dimensionKey(t.dimension) === dimensionKey(roleDimension(role)),
      )!
      return target.ideal - target.min
    }
    for (const role of ['ramp', 'spot-removal'] as const) {
      const gap = beyond.find((g) => g.key === dimensionKey(roleDimension(role)))
      expect(gap).toBeDefined()
      expect(gap?.short).toBe(shortOf(role))
      expect(gap?.short).toBeGreaterThan(0)
    }
  })

  it('measures to the ideal, not the band, once the builder asks it to', () => {
    const plan = quickbuildPlan({ ...inputFor(atEveryBand(), 'midrange'), reach: 'ideal' })
    expect(plan.reach).toBe('ideal')
    const ramp = plan.gaps.find((g) => g.key === dimensionKey(roleDimension('ramp')))
    expect(ramp?.short).toBe(3)
  })

  /*
   * There is nothing past the ideal, so a plan already reaching for it has no
   * further offer to make. That is what lets the panel tell the difference
   * between "you can keep going" and "there is genuinely nothing left".
   */
  it('has nothing beyond the ideal', () => {
    const plan = quickbuildPlan({ ...inputFor(atEveryBand(), 'midrange'), reach: 'ideal' })
    expect(plan.beyond).toEqual([])
  })

  it('defaults to the band, because a deck inside its band is not wrong', () => {
    expect(quickbuildPlan(inputFor(atEveryBand(), 'midrange')).reach).toBe('band')
  })

  /*
   * "You just need to pick X more cards." X is deck size minus what the deck
   * holds, and it is stated rather than left for the builder to subtract.
   */
  it('counts the cards still needed for a legal deck', () => {
    expect(quickbuildPlan(inputFor(atEveryBand(), 'midrange')).unallocated).toBe(
      DECK_SIZE - atEveryBand().length,
    )
    expect(quickbuildPlan(inputFor([], 'midrange')).unallocated).toBe(DECK_SIZE)
  })

  /*
   * DECK_SIZE is the same 100 `validateDeck` judges against, and this reads it
   * out of the legality report rather than restating the literal — two places
   * saying 100 is two places that can drift.
   */
  it('agrees with the legality rule about how big a deck is', () => {
    const report = validateDeck(deckOf(filler(3)), new Map(), new Map())
    const wrongCount = report.problems.find((p) => p.kind === 'wrong-card-count')
    expect(wrongCount).toBeDefined()
    expect(wrongCount && 'expected' in wrongCount ? wrongCount.expected : null).toBe(DECK_SIZE)
  })

  /*
   * The slots the archetype names no target for at all — the "big things" the
   * user wants to pick first and the one thing Quickbuild genuinely cannot
   * lead them to, because `wincon` and `synergy` are roles that no archetype
   * gives an ideal. `archetype-targets.ts` reads this remainder as "the deck's
   * unroled threats and payoffs", and midrange spends 74 of 99 on roles, so 26
   * are left. The panel says this number out loud instead of implying it has an
   * opinion it does not have.
   */
  it('counts the slots the archetype leaves for threats and win conditions', () => {
    const roleIdeals = targetsFor('midrange')
      .filter((t) => t.dimension.kind === 'role')
      .reduce((sum, t) => sum + t.ideal, 0)
    // 75 for midrange at bracket 3, leaving 25 slots the archetype names no
    // target for. Both moved by one under ADR-0037 and the remainder did not.
    expect(roleIdeals).toBe(75)
    expect(quickbuildPlan(inputFor([], 'midrange')).unroled).toBe(DECK_SIZE - roleIdeals)
    expect(quickbuildPlan(inputFor([], 'midrange')).unroled).toBe(25)
  })

  /*
   * `unallocated` floors at zero, so an over-full deck cannot be recovered from
   * it — `DECK_SIZE - 0` reads back as exactly a hundred. `held` is carried for
   * that reason alone: a panel telling someone with 121 cards that they hold
   * all 100 is a worse failure than the silence the ending replaced.
   */
  it('never asks for a negative number of cards on an over-full deck', () => {
    const plan = quickbuildPlan(inputFor([...lands(60), ...filler(60)], 'midrange'))
    expect(plan.unallocated).toBe(0)
    // The commander is in `acceptedCopies` but not in this fixture's card map,
    // so `countComposition` cannot count it. The real app always holds the
    // commander's card and reads one higher; nothing here depends on which.
    expect(plan.held).toBe(120)
    expect(DECK_SIZE - plan.unallocated).not.toBe(plan.held)
  })

  it('carries the deck’s own count, so the panel never has to reconstruct it', () => {
    expect(quickbuildPlan(inputFor(atEveryBand(), 'midrange')).held).toBe(atEveryBand().length)
    expect(quickbuildPlan(inputFor([], 'midrange')).held).toBe(0)
  })
})
