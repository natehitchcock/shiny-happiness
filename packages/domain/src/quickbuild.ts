import { ARCHETYPES } from './archetype.js'
import { compositionTargets } from './archetype-targets.js'
import type { Bracket } from './bracket.js'
import { dimensionKey, type CompositionDimension } from './composition.js'
import { CURVE_BUCKETS } from './curve.js'

/**
 * What Quickbuild works on (doc 19).
 *
 * Quickbuild is a VIEW over the existing recommendations and never a second
 * scorer (doc 19 D2). Nothing in this file scores, ranks or selects a card. It
 * answers one question — *which hole should the builder fill next* — and hands
 * the answer to the ordinary recommendations request as a group key and a
 * filter string. Every card that comes back was chosen, grouped, scored and
 * explained by `recommend`, with P4, P5, P6, budget, bracket, colour identity,
 * semantic emphasis and the ADR-0026 guarantee already applied.
 */

/** A hole in the deck that ADDING a card can close. */
export interface QuickbuildGap {
  readonly kind: 'composition' | 'curve'
  /** `role:ramp`, `type:creature` or `mv:2`. Stable, and used as a React key. */
  readonly key: string
  /** For the panel's heading. Words, not a dimension object. */
  readonly label: string
  /** Cards needed to reach the band. Always ≥ 1 — see `quickbuildPlan`. */
  readonly short: number
  /** Present on a composition gap. */
  readonly dimension?: CompositionDimension
  /** Present on a curve gap. */
  readonly bucket?: number
}

/**
 * A bucket that is over its band (doc 19 Q5).
 *
 * Reported ALONGSIDE the gaps rather than mixed into them, because Quickbuild
 * adds and only adds: there is no card whose addition makes a deck less
 * over-full at two. It is in the result at all so the panel can SAY that —
 * "you are four two-drops over; Quickbuild only adds, see the cut indicator" —
 * rather than silently having nothing to offer. A wizard that appears to do
 * nothing is worse than one that names its limit.
 */
export interface OverFullBucket {
  readonly bucket: number
  /** Cards above the top of the band. Always ≥ 1. */
  readonly excess: number
}

/**
 * Which number a gap is measured against (ADR-0040).
 *
 * `band` is the default and is what doc 19 argued for: a deck inside its band
 * is not wrong, so asking it for more would have the panel work a gap the meter
 * beside it already shows as satisfied.
 *
 * `ideal` is the SAME question asked of the number the composition rail draws.
 * It is never the default and is never entered silently — the builder asks for
 * it, once the bands are met and the deck is still short of a hundred cards.
 * Both numbers are honest and they are different; the failure the user reported
 * was showing only one of them and calling it finished.
 */
export type QuickbuildReach = 'band' | 'ideal'

/**
 * A Commander deck is a hundred cards, commander included.
 *
 * Stated here because Quickbuild has to answer "and how many more?" — and
 * `quickbuild.test.ts` reads the same number back out of `validateDeck`'s
 * `wrong-card-count` problem rather than restating the literal, so the two
 * cannot drift.
 */
export const DECK_SIZE = 100

export interface QuickbuildPlan {
  /** Most pressing first. Empty means the deck is inside every band. */
  readonly gaps: readonly QuickbuildGap[]
  /** Which rule ordered them — the panel says which, so the order is legible. */
  readonly ordering: 'build-order' | 'largest-first'
  readonly overFull: readonly OverFullBucket[]
  /** Which number `gaps` was measured against. */
  readonly reach: QuickbuildReach
  /**
   * The gaps that would remain if the builder chose to keep going past `reach`.
   *
   * Empty when `reach` is already `ideal`, because there is nothing past the
   * ideal to reach for. It exists so the panel can tell "your allotments are
   * met and you can keep going" apart from "there is genuinely nothing left" —
   * two states that used to render as the same sentence and stop.
   */
  readonly beyond: readonly QuickbuildGap[]
  /**
   * Cards still needed for a legal deck — the user's "you just need to pick X
   * more cards", stated rather than left to be subtracted.
   */
  readonly unallocated: number
  /**
   * Slots the archetype names no target for at all.
   *
   * `DECK_SIZE` minus what the archetype spends on roles, which
   * `archetype-targets.ts` reads as "the deck's unroled threats and payoffs" —
   * 25 of them for midrange. This is where bombs and win conditions live, and
   * it is precisely the part of the deck Quickbuild has no opinion about:
   * `wincon` and `synergy` are roles, but no archetype gives either an ideal,
   * so neither can ever be a composition dimension or a gap. The panel says
   * that number out loud instead of implying an opinion it does not have.
   */
  readonly unroled: number
}

/**
 * One composition target and where the deck stands against it.
 *
 * STRUCTURAL, not `CompositionTarget`, and this is deliberate — the same choice
 * `dimensionKeysOf` makes and for the same reason. The web app holds these four
 * numbers already, on `Analysis.targets`, because they are what the composition
 * meters render. Taking the domain type instead would make the panel rebuild
 * domain objects from the wire before it could ask a question about them, and
 * the rebuilt copy would be free to disagree with the meter drawn beside it.
 * Reading the meter's own numbers is what stops the panel and the meter ever
 * telling the builder two different things.
 */
export interface QuickbuildTarget {
  readonly dimension: CompositionDimension
  readonly ideal: number
  /** Bottom of the band. Short of THIS is what counts as a gap, not the ideal. */
  readonly min: number
  readonly actual: number
}

/** One curve bucket's distance to its band, as `curveDeltas` reports it. */
export interface QuickbuildCurveDelta {
  readonly bucket: number
  /** Positive = short, negative = over-full, zero = inside the band. */
  readonly delta: number
  /**
   * The bucket's own count and its ideal, for `reach: 'ideal'`.
   *
   * Optional so a caller holding only the band distance keeps working (R2), and
   * a curve gap then measures to the band under either reach rather than
   * inventing a number it was not given. The web app has both — they are on
   * `analysis.curve.deltas` because they are what the curve chart draws.
   */
  readonly actual?: number
  readonly ideal?: number
}

export interface QuickbuildInput {
  /** Cards accepted. Decides which ordering rule applies — see `handoverSize`. */
  readonly total: number
  readonly targets: readonly QuickbuildTarget[]
  readonly curveDeltas: readonly QuickbuildCurveDelta[]
  /** Defaults to `band`. Only the builder moves it to `ideal` (ADR-0040). */
  readonly reach?: QuickbuildReach
  /**
   * The deck's bracket, used only to build the MIDRANGE reference row that
   * breaks ties in the build order. It has to be this deck's bracket rather
   * than a fixed one, because the bracket modifier moves draw and removal by up
   * to two cards each, and the reference must be the row this deck would have
   * had if it were midrange — not the row some other deck would have had.
   */
  readonly bracket: Bracket
}

/**
 * The least a row has to say for the build order to read it: which dimension,
 * and how many slots the archetype spends on it.
 *
 * Both `CompositionTarget` and `QuickbuildTarget` satisfy it, so the same
 * function orders the archetype's own table and the deck's live one without
 * either being converted into the other.
 */
interface Committed {
  readonly dimension: CompositionDimension
  readonly ideal: number
}

/**
 * The deck shapes the deferral probe asks `compositionTargets` about.
 *
 * Four points chosen to move every input the function actually reads: the
 * curve modifier's two branches (`< 2.8` and `> 3.5`) and `modalLandBacks`,
 * against a baseline with none of them. Nothing here names a dimension.
 */
const PROBE_SHAPES = [
  {},
  { averageManaValue: 2.0 },
  { averageManaValue: 4.0 },
  { averageManaValue: 4.0, modalLandBacks: 6 },
] as const

const deferredCache = new Map<Bracket, ReadonlySet<string>>()

/**
 * The dimensions whose target the DECK'S OWN CONTENTS move (ADR-0040).
 *
 * This is the derivation behind "lands last", and it is a probe rather than the
 * string `role:land` on purpose. Most ideals in `archetype-targets.ts` are
 * settled the moment the archetype and the bracket are known. The land ideal is
 * not: the curve modifier subtracts one under 2.8 average mana value and adds
 * one over 3.5, and `modalLandBacks` subtracts another for every two land-backed
 * modal cards. The land target is therefore a FUNCTION OF THE DECK YOU HAVE
 * ALREADY BUILT — you cannot know how many lands the deck wants until you know
 * what they are casting.
 *
 * A dimension whose target is not yet knowable cannot honestly be built first,
 * so the build order puts it last. That reaches the user's "lands are the last
 * things you should pick" through a mechanism rather than through a preference,
 * and it survives the role taxonomy moving underneath it: a new role is deferred
 * if and only if `compositionTargets` makes its ideal depend on the deck, and
 * land stops being deferred the day that stops being true of land. Neither
 * outcome needs an edit here.
 *
 * Asked of EVERY archetype, because `quickbuildPlan` sees a deck's targets
 * rather than its archetype, and a dimension only one archetype names — `stax`,
 * `token-maker` — still has to be classified. Pure and deterministic (R1);
 * memoised per bracket because the answer is a property of the model, not of a
 * deck.
 */
export const deferredDimensions = (bracket: Bracket): ReadonlySet<string> => {
  const cached = deferredCache.get(bracket)
  if (cached !== undefined) return cached

  const moved = new Set<string>()
  for (const archetype of ARCHETYPES) {
    const shapes = PROBE_SHAPES.map((shape) =>
      compositionTargets(archetype, null, { bracket, ...shape }),
    )
    const ideals = shapes.map(
      (shape) => new Map(shape.map((t) => [dimensionKey(t.dimension), t.ideal])),
    )
    for (const key of ideals[0]?.keys() ?? []) {
      if (new Set(ideals.map((row) => row.get(key))).size > 1) moved.add(key)
    }
  }
  deferredCache.set(bracket, moved)
  return moved
}

/**
 * The archetype's build order, DERIVED from its own targets (doc 19 Q2,
 * ADR-0040).
 *
 * TWO TERMS, and the first one is the change the user asked for.
 *
 * 1. A DEFERRED dimension sorts after every dimension that is not — see
 *    `deferredDimensions`. The user's report was that "lands are the last
 *    things you should pick", and land led every archetype because it holds the
 *    largest ideal in every row. Largest commitment and most-worth-choosing-
 *    deliberately turn out to be close to opposite, and the land count is where
 *    they separate hardest: its target is the one number in the table that the
 *    rest of the deck decides.
 *
 * 2. Past that, the order is what it was: the targets sorted by what the
 *    archetype spends on them, largest commitment first. The ideal IS the number
 *    of slots the archetype gives a dimension, and the reason to derive it
 *    rather than write a list per archetype is visible in the output — each
 *    archetype's identity dimension rises on its own, because the archetype
 *    already spent slots on the thing it is about. Tokens puts `token-maker`
 *    (14) second, stax puts `stax` (12) second, voltron puts `equipment` (7)
 *    above its protection, aristocrats puts `recursion` (7) above its removal.
 *    No table anywhere says "stax decks care about stax" — the number 12 in
 *    `archetype-targets.ts` already said it.
 *
 * With land deferred, `creature` leads all nine archetypes, which is as close as
 * the model can get to the rest of the user's phrase: `archetype-targets.ts`
 * reads the unroled remainder as "the threats", and `wincon` and `synergy` are
 * roles that NO archetype gives an ideal — so bombs and win conditions are not
 * composition dimensions and can never be gaps. That half of the report is
 * answered where the loop ends rather than in this ordering; see `unroled`.
 *
 * TIES break toward the dimension that departs furthest from the MIDRANGE row.
 * `archetype-targets.ts` calls midrange "the reference every other row is
 * stated relative to" and doc 14 §14.3 calls it the least-wrong default, so the
 * distance from it is a real measure of what makes this archetype itself. Stax
 * spends 12 on `ramp` and 12 on `stax`; midrange spends 11 on ramp and nothing
 * at all on stax, so `stax` is the half of that tie that says what the deck is.
 * Then by key, so the order is total and cannot depend on iteration luck (D3).
 *
 * REJECTED: sorting by ASCENDING ideal instead — the direct inversion, on the
 * reading that one card is `1 / ideal` of its dimension so the smallest
 * commitment is the most decisive pick. It does put land last in all nine
 * archetypes with no extra term, and it is honest about substitutability. It
 * was rejected because it sinks exactly what the doc built this derivation for:
 * measured, it puts `token-maker` eighth of ten for tokens and `stax` seventh of
 * nine for stax, and leads every archetype with its one or two board wipes. An
 * order that buries the archetype's identity to reach "lands last" has traded
 * the wrong half.
 *
 * REJECTED: ordering by departure from midrange as the PRIMARY key, on the
 * reading that the identity cards are the ones a builder chooses deliberately.
 * Measured, it fails twice: midrange against itself is all zeros, so the default
 * archetype gets no order at all, and combo's land sits at Δ2 in mid-pack while
 * its draw (Δ1) goes last — so it does not deliver "lands last" either.
 *
 * REJECTED: `ROLE_PRECEDENCE` from `role.ts`. It exists to pick a card's single
 * counted role and is ordered "most specific first" for that purpose; that it
 * also begins with `land` is a coincidence, and the first time either purpose
 * moved, the other would have been silently wrong. Two questions, one list, is
 * how the defect in ADR-0031 happened.
 *
 * REJECTED: a hand-written order beside the targets, or a hand-written list of
 * deferred dimensions. Both were the fallback if nothing could be derived, and
 * nothing needed either — a second table would have to be reviewed against the
 * first forever.
 */
export const buildOrder = (
  targets: readonly Committed[],
  reference: readonly Committed[],
  deferred: ReadonlySet<string> = new Set<string>(),
): readonly string[] => {
  const referenceIdeal = (key: string): number =>
    reference.find((t) => dimensionKey(t.dimension) === key)?.ideal ?? 0
  const defers = (key: string): number => (deferred.has(key) ? 1 : 0)
  return [...targets]
    .map((t) => ({ key: dimensionKey(t.dimension), ideal: t.ideal }))
    .sort(
      (a, b) =>
        defers(a.key) - defers(b.key) ||
        b.ideal - a.ideal ||
        Math.abs(b.ideal - referenceIdeal(b.key)) - Math.abs(a.ideal - referenceIdeal(a.key)) ||
        (a.key < b.key ? -1 : 1),
    )
    .map((t) => t.key)
}

/** The least a row has to say for the handover to read it: which band floor. */
interface Banded {
  readonly dimension: CompositionDimension
  readonly min: number
}

/**
 * Where "follow the build order" hands over to "largest gap first" (doc 19 Q2),
 * RE-DERIVED because deferring the land count broke the old derivation
 * (ADR-0040).
 *
 * It used to be the archetype's own largest single target — the land count,
 * 34–37 — and it was safe to put anywhere in that region because the two
 * orderings COINCIDED on an empty deck: with nothing accepted every deficit
 * equals its own ideal, so "largest gap" and "largest commitment" were the same
 * list. Deferring land reverses its position outright, so that coincidence is
 * gone and the threshold now genuinely adjudicates between two rival answers.
 * `quickbuild.test.ts` pins the DISAGREEMENT, where it used to pin the
 * agreement.
 *
 * DERIVED, again: the smallest deck that COULD be inside every band — the sum
 * of the role dimensions' minima. A real lower bound, because role counts do
 * not overlap: `archetype-targets.ts` constraint 1 says "`land + Σ roles` is
 * therefore a real budget against 99". Type dimensions are excluded from the
 * sum for the same reason read backwards — a creature that ramps is counted in
 * both `creature` and `ramp`, so adding the creature floor in would count those
 * cards twice and inflate the threshold past anything the deck has to hold.
 *
 * BELOW it a deck cannot be inside every band however its cards were spent, so
 * being short somewhere is arithmetic rather than evidence, worst-first is
 * restating the archetype, and the plan is the only thing that tells the
 * dimensions apart. AT OR ABOVE it a shortfall is a fact about this deck, and
 * the deck's own shape wins.
 *
 * The same number is where the loop runs out of opinion — a deck inside every
 * band holds at least this many cards by construction — which is what makes the
 * handover, the stopping condition and the "58 of 100" in the report one idea
 * rather than three. Measured: 56 for midrange at bracket 3, 49 for aggro, 67
 * for stax.
 */
export const handoverSize = (targets: readonly Banded[]): number =>
  targets.filter((t) => t.dimension.kind === 'role').reduce((sum, t) => sum + Math.max(0, t.min), 0)

const labelForDimension = (dimension: CompositionDimension): string =>
  dimension.kind === 'role' ? dimension.role.replace(/-/g, ' ') : dimension.type

/**
 * The filter that finds this gap's candidates, in the EXISTING query language
 * (doc 13).
 *
 * This is what makes Quickbuild a view rather than a new endpoint: the gap
 * becomes an ordinary `query` on the ordinary recommendations request, so the
 * answers come back through the same pipeline as everything else, with every
 * upstream guarantee intact. No contract change, no second ranking.
 *
 * BUCKET 7 IS A CATCH-ALL. `curveBucket` clamps at `CURVE_BUCKETS - 1`, so
 * bucket 7 holds every card of mana value seven or more, and `mv=7` would
 * silently drop the rest of it. Found by measurement rather than by reading:
 * `mv=7` missed Darksteel Forge (mana value 9) on a real deck and was the last
 * failing case in the gap probe.
 *
 * A curve gap does NOT add `-t:land`. It does not need to: `countComposition`
 * excludes lands from `manaCurve`, so a land is not in this bucket's count and
 * cannot be short at it — and the `fills-land` composition gap is where lands
 * are answered (Q6). Adding the clause would narrow the honest answer for the
 * sake of a case that cannot arise.
 */
export const gapQuery = (gap: QuickbuildGap): string => {
  if (gap.kind === 'curve') {
    const bucket = gap.bucket ?? 0
    return bucket >= CURVE_BUCKETS - 1 ? `mv>=${CURVE_BUCKETS - 1}` : `mv=${bucket}`
  }
  const dimension = gap.dimension
  if (dimension === undefined) return ''
  return dimension.kind === 'role' ? `role:${dimension.role}` : `t:${dimension.type}`
}

/**
 * The deck's gaps, most pressing first, plus what Quickbuild cannot help with.
 *
 * Composition and curve gaps are BOTH counts of cards and so compare directly
 * (doc 19 D3). No weighting between them is invented here, because inventing
 * one would be this file having an opinion the model does not.
 */
export const quickbuildPlan = (input: QuickbuildInput): QuickbuildPlan => {
  const { total, targets, curveDeltas: deltas } = input
  const reach: QuickbuildReach = input.reach ?? 'band'

  /**
   * The gaps at one reach.
   *
   * `band` is the default and is doc 19's argument unchanged: a deck inside its
   * band is not short of anything, and offering it a gap would have the panel
   * keep asking about a dimension the meter beside it already shows as
   * satisfied (doc 05 §5.4: "a deck at 34 lands is not broken and the UI must
   * not say it is"). `ideal` is the same question asked of the number the
   * composition rail draws, and the builder is the only one who asks it.
   */
  const gapsAt = (at: QuickbuildReach): QuickbuildGap[] => {
    const composition: QuickbuildGap[] = targets
      .map((t) => ({ target: t, want: at === 'band' ? t.min : t.ideal }))
      .filter(({ target, want }) => target.actual < want)
      .map(({ target, want }) => ({
        kind: 'composition' as const,
        key: dimensionKey(target.dimension),
        label: labelForDimension(target.dimension),
        short: want - target.actual,
        dimension: target.dimension,
      }))

    /*
     * A curve bucket measured to its ideal needs the bucket's own count, which
     * `delta` alone cannot supply — it is a distance to the nearest EDGE and is
     * zero anywhere inside the band. A caller that sends only `delta` therefore
     * keeps the band reading under either reach, which is the honest fallback:
     * better to under-report a gap than to invent the number it is short by.
     */
    const curveGaps: QuickbuildGap[] = deltas
      .map((d) => ({
        d,
        short:
          at === 'band' || d.ideal === undefined || d.actual === undefined
            ? d.delta
            : d.ideal - d.actual,
      }))
      .filter(({ short }) => short > 0)
      .map(({ d, short }) => ({
        kind: 'curve' as const,
        key: `mv:${d.bucket}`,
        label: d.bucket >= CURVE_BUCKETS - 1 ? `mana value ${d.bucket}+` : `mana value ${d.bucket}`,
        short,
        bucket: d.bucket,
      }))

    return [...composition, ...curveGaps]
  }

  // Negative `delta` means over the top of the band (`curveDeltas`). Adding a
  // card cannot reduce it, so it is never a gap — it is a stated limit (Q5).
  // Read off the band under either reach: a bucket over the top of its band is
  // over its ideal too, and there is no second way to be over-full.
  const overFull: OverFullBucket[] = deltas
    .filter((d) => d.delta < 0)
    .map((d) => ({ bucket: d.bucket, excess: -d.delta }))

  const ordering = total < handoverSize(targets) ? 'build-order' : 'largest-first'

  /*
   * One total order, both ways, so the panel cannot alternate between two gaps
   * on successive recomputes (D3). `short` descending is the primary key in the
   * largest-first regime and the tie-break in the build-order one; `key`
   * ascending is the final tie-break in both, so the result never depends on
   * the order `findDeficits` or `curveDeltas` happened to return.
   *
   * A curve gap has no place in the build order — the build order is over
   * composition dimensions — so it sorts after every composition gap that the
   * order names, by its own size. That is deliberate rather than incidental: on
   * a nearly-empty deck the archetype's plan is the thing being followed, and
   * the curve is a shape that emerges from filling it.
   */
  // Midrange is the reference row every other archetype is stated relative to
  // (`archetype-targets.ts`, doc 14 §14.3), which is what makes "departs
  // furthest from midrange" a derived tie-break rather than a preference.
  const order = buildOrder(
    targets,
    compositionTargets('midrange', null, { bracket: input.bracket }),
    deferredDimensions(input.bracket),
  )
  const rank = new Map(order.map((key, at) => [key, at]))
  const positionOf = (gap: QuickbuildGap): number => rank.get(gap.key) ?? Number.MAX_SAFE_INTEGER

  const sort = (gaps: readonly QuickbuildGap[]): readonly QuickbuildGap[] =>
    ordering === 'build-order'
      ? [...gaps].sort(
          (a, b) => positionOf(a) - positionOf(b) || b.short - a.short || (a.key < b.key ? -1 : 1),
        )
      : [...gaps].sort((a, b) => b.short - a.short || (a.key < b.key ? -1 : 1))

  /*
   * What the archetype spends on roles, and what it does not.
   *
   * Roles do not overlap, so the remainder is a real count of slots the
   * archetype names no target for — the threats, bombs and win conditions. The
   * panel prints it where the loop ends, because that is the one part of the
   * deck Quickbuild cannot lead anybody to.
   */
  const roleIdeals = targets
    .filter((t) => t.dimension.kind === 'role')
    .reduce((sum, t) => sum + t.ideal, 0)

  return {
    gaps: sort(gapsAt(reach)),
    ordering,
    overFull,
    reach,
    beyond: reach === 'ideal' ? [] : sort(gapsAt('ideal')),
    unallocated: Math.max(0, DECK_SIZE - total),
    unroled: Math.max(0, DECK_SIZE - roleIdeals),
  }
}
