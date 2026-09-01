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

export interface QuickbuildPlan {
  /** Most pressing first. Empty means the deck is inside every band. */
  readonly gaps: readonly QuickbuildGap[]
  /** Which rule ordered them — the panel says which, so the order is legible. */
  readonly ordering: 'build-order' | 'largest-first'
  readonly overFull: readonly OverFullBucket[]
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
}

export interface QuickbuildInput {
  /** Cards accepted. Decides which ordering rule applies — see `handoverSize`. */
  readonly total: number
  readonly targets: readonly QuickbuildTarget[]
  readonly curveDeltas: readonly QuickbuildCurveDelta[]
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
 * The archetype's build order, DERIVED from its own targets (doc 19 Q2).
 *
 * The order is the targets sorted by what the archetype spends on them, largest
 * commitment first. That is a derivation, not a preference: the ideal IS the
 * number of slots the archetype gives a dimension, so the largest is both the
 * one that most determines whether the deck is buildable and the one that
 * cannot be left until the end — thirty-six lands do not fit into whatever is
 * left over.
 *
 * The reason to derive it rather than write a list per archetype is visible in
 * the output: each archetype's identity dimension rises on its own, because the
 * archetype already spent slots on the thing it is about. Tokens puts
 * `token-maker` (14) third, stax puts `stax` (12) near the top, combo puts
 * `tutor` (8) above its own removal, voltron puts `equipment` (7) above its
 * board wipes. No table anywhere says "stax decks care about stax" — the number
 * 12 in `archetype-targets.ts` already said it, and a hand-written order would
 * be a second place to say the same thing, free to drift from the first.
 *
 * TIES break toward the dimension that departs furthest from the MIDRANGE row.
 * `archetype-targets.ts` calls midrange "the reference every other row is
 * stated relative to" and doc 14 §14.3 calls it the least-wrong default, so the
 * distance from it is a real measure of what makes this archetype itself. Stax
 * spends 12 on `ramp` and 12 on `stax`; midrange spends 11 on ramp and nothing
 * at all on stax, so `stax` is the half of that tie that says what the deck is.
 * Then by key, so the order is total and cannot depend on iteration luck (D3).
 *
 * REJECTED: `ROLE_PRECEDENCE` from `role.ts`. It exists to pick a card's single
 * counted role and is ordered "most specific first" for that purpose; that it
 * also begins with `land` is a coincidence, and the first time either purpose
 * moved, the other would have been silently wrong. Two questions, one list, is
 * how the defect in ADR-0031 happened.
 *
 * REJECTED: a hand-written order beside the targets. It was the fallback if
 * nothing could be derived, and nothing needed it — a second table would have
 * to be reviewed against the first forever.
 */
export const buildOrder = (
  targets: readonly Committed[],
  reference: readonly Committed[],
): readonly string[] => {
  const referenceIdeal = (key: string): number =>
    reference.find((t) => dimensionKey(t.dimension) === key)?.ideal ?? 0
  return [...targets]
    .map((t) => ({ key: dimensionKey(t.dimension), ideal: t.ideal }))
    .sort(
      (a, b) =>
        b.ideal - a.ideal ||
        Math.abs(b.ideal - referenceIdeal(b.key)) - Math.abs(a.ideal - referenceIdeal(a.key)) ||
        (a.key < b.key ? -1 : 1),
    )
    .map((t) => t.key)
}

/**
 * Where "follow the build order" hands over to "largest gap first" (doc 19 Q2).
 *
 * DERIVED: the archetype's own largest single target, which is always the land
 * count (34–37). The argument is that below it, worst-first carries almost no
 * information. A twelve-card midrange deck is twenty-four lands short and
 * twenty creatures short and nine ramp short; the land gap dominates every
 * other gap and will keep dominating until the mana base is nearly done, so
 * worst-first says "lands" over and over while the rest of the deck has no
 * shape at all. The archetype's plan is the only thing that distinguishes those
 * other dimensions from each other at that size.
 *
 * Above it, the deck's own counts are real evidence — enough cards are in that
 * a dimension being short is a fact about this deck rather than a restatement
 * of its archetype — and the deck's own shape should win.
 *
 * The handover is safe to make at any point in that region because the two
 * orderings COINCIDE on an empty deck: with nothing accepted every deficit
 * equals its own ideal, so "largest gap" and "largest commitment" are the same
 * list, and they separate only as the builder fills things in. `quickbuild.test.ts`
 * pins that agreement, so this threshold chooses when to stop trusting the plan
 * — it does not adjudicate between two rival answers.
 */
export const handoverSize = (targets: readonly Committed[]): number =>
  targets.reduce((most, t) => Math.max(most, t.ideal), 0)

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

  const composition: QuickbuildGap[] = targets
    // Short of the BAND, not of the ideal. A deck inside its band is not short
    // of anything, and offering it a gap would have the panel keep asking about
    // a dimension the meter beside it already shows as satisfied (doc 05 §5.4:
    // "a deck at 34 lands is not broken and the UI must not say it is").
    .filter((t) => t.actual < t.min)
    .map((t) => ({
      kind: 'composition' as const,
      key: dimensionKey(t.dimension),
      label: labelForDimension(t.dimension),
      short: t.min - t.actual,
      dimension: t.dimension,
    }))

  const curveGaps: QuickbuildGap[] = deltas
    .filter((d) => d.delta > 0)
    .map((d) => ({
      kind: 'curve' as const,
      key: `mv:${d.bucket}`,
      label: d.bucket >= CURVE_BUCKETS - 1 ? `mana value ${d.bucket}+` : `mana value ${d.bucket}`,
      short: d.delta,
      bucket: d.bucket,
    }))

  // Negative `delta` means over the top of the band (`curveDeltas`). Adding a
  // card cannot reduce it, so it is never a gap — it is a stated limit (Q5).
  const overFull: OverFullBucket[] = deltas
    .filter((d) => d.delta < 0)
    .map((d) => ({ bucket: d.bucket, excess: -d.delta }))

  const all = [...composition, ...curveGaps]
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
  )
  const rank = new Map(order.map((key, at) => [key, at]))
  const positionOf = (gap: QuickbuildGap): number => rank.get(gap.key) ?? Number.MAX_SAFE_INTEGER

  const sorted =
    ordering === 'build-order'
      ? [...all].sort(
          (a, b) => positionOf(a) - positionOf(b) || b.short - a.short || (a.key < b.key ? -1 : 1),
        )
      : [...all].sort((a, b) => b.short - a.short || (a.key < b.key ? -1 : 1))

  return { gaps: sorted, ordering, overFull }
}
