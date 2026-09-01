import { describe, expect, it } from 'vitest'
import { compositionTargets } from './archetype-targets.js'
import type { Card, CardType } from './card.js'
import { countComposition } from './composition-analysis.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import { curveDeltas, curveTarget } from './curve.js'
import type { Deck } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import {
  buildOrder,
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

describe('build order (Q2, derived from the archetype targets)', () => {
  /*
   * The derivation, stated as a test rather than only as a comment: the order
   * IS the targets sorted by what the archetype spends on them. Nothing here is
   * a list someone typed.
   */
  it('is the archetype’s own ideals, largest commitment first', () => {
    const order = buildOrder(targetsFor('midrange'), REFERENCE)
    expect(order[0]).toBe(dimensionKey(roleDimension('land'))) // 36
    expect(order[1]).toBe(dimensionKey(typeDimension('creature'))) // 26
    expect(order[2]).toBe(dimensionKey(roleDimension('ramp'))) // 11
  })

  /*
   * The point of deriving it rather than hardcoding one list: each archetype's
   * identity dimension rises on its own, because the archetype spends slots on
   * the thing it is about. No per-archetype table says "stax decks care about
   * stax" — the number 12 already said it.
   */
  it('floats each archetype’s identity dimension up without being told to', () => {
    expect(buildOrder(targetsFor('tokens'), REFERENCE).slice(0, 3)).toContain(
      dimensionKey(roleDimension('token-maker')),
    )
    expect(buildOrder(targetsFor('stax'), REFERENCE).slice(0, 4)).toContain(
      dimensionKey(roleDimension('stax')),
    )
    expect(buildOrder(targetsFor('voltron'), REFERENCE).slice(0, 6)).toContain(
      dimensionKey(roleDimension('equipment')),
    )
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
    const order = buildOrder(targetsFor('stax'), REFERENCE)
    expect(order.indexOf(dimensionKey(roleDimension('stax')))).toBeLessThan(
      order.indexOf(dimensionKey(roleDimension('ramp'))),
    )
  })

  it('is total and deterministic — same input, same order, every time', () => {
    const once = buildOrder(targetsFor('aristocrats'), REFERENCE)
    const twice = buildOrder(targetsFor('aristocrats'), REFERENCE)
    expect(once).toEqual(twice)
    expect(new Set(once).size).toBe(once.length)
    expect(once.length).toBe(targetsFor('aristocrats').length)
  })
})

describe('handover from build order to largest-gap-first (Q2)', () => {
  /*
   * Derived, not chosen: the threshold is the archetype's own largest single
   * target. Below it, every "largest gap" answer is dominated by that one
   * target — a 12-card deck is 24 lands short and 20 creatures short, so
   * worst-first says "lands" until the land count is nearly done. The
   * archetype's plan is the only thing that distinguishes the rest.
   */
  it('is the archetype’s largest single target', () => {
    expect(handoverSize(targetsFor('midrange'))).toBe(36) // land
    expect(handoverSize(targetsFor('ramp'))).toBe(37)
    expect(handoverSize(targetsFor('combo'))).toBe(34)
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
  it('puts the build order ahead of the bigger gap, below the handover', () => {
    const plan = quickbuildPlan(inputFor(lands(30), 'midrange'))
    const land = plan.gaps.find((g) => g.key === dimensionKey(roleDimension('land')))!
    const creature = plan.gaps.find((g) => g.key === dimensionKey(typeDimension('creature')))!
    expect(creature.short).toBeGreaterThan(land.short)
    expect(keys(plan.gaps)[0]).toBe(dimensionKey(roleDimension('land')))
  })

  it('switches to worst-first once the deck reaches it', () => {
    const plan = quickbuildPlan(inputFor(filler(40), 'midrange'))
    expect(plan.ordering).toBe('largest-first')
  })

  /*
   * The two orderings AGREE on an empty deck, which is what makes the handover
   * safe to make at all: with nothing accepted, every deficit equals its own
   * ideal, so "largest gap first" and "largest commitment first" are the same
   * list. The threshold decides when the deck's own shape has become better
   * evidence than the archetype's plan, not which of two rivals is right.
   */
  it('agrees with worst-first on a completely empty deck', () => {
    const plan = quickbuildPlan(inputFor([], 'midrange'))
    const composition = plan.gaps.filter((g) => g.kind === 'composition')
    const worstFirst = [...composition].sort((a, b) => b.short - a.short)
    expect(keys(composition)).toEqual(keys(worstFirst))
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
