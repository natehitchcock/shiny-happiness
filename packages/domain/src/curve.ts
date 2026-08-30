import type { ArchetypeKey } from './archetype.js'

/**
 * Mana curve targets (ADR-0011).
 *
 * The curve a deck wants is a SHAPE, not a flat share. The previous heuristic
 * compared every bucket against a flat 25%, which with eight buckets means an
 * evenly spread deck scores positive everywhere, and clamped at zero so an
 * over-full bucket was never pushed down — a deck with thirty two-drops got no
 * signal to stop.
 *
 * These are share-of-nonland-spells distributions, not card counts, so they hold
 * whether the deck is 40 spells or 65. Established deckbuilding shapes, not
 * derived from a corpus: aggro front-loads, control pays for its power later,
 * combo clusters around its pieces. They are a starting point and the UI shows
 * them as a target to sit near, never a quota to hit.
 */

/** Buckets 0–7, where 7 holds everything at mana value 7 and above. */
export const CURVE_BUCKETS = 8

export type CurveTarget = readonly number[]

const NORMALISED = (weights: readonly number[]): CurveTarget => {
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => w / total)
}

const SHAPES: Record<ArchetypeKey, readonly number[]> = {
  //          mv0   1     2     3     4     5     6    7+
  aggro: [2, 14, 22, 20, 12, 6, 3, 1],
  midrange: [2, 9, 17, 19, 16, 11, 6, 3],
  control: [2, 8, 14, 16, 16, 13, 9, 6],
  combo: [3, 12, 20, 18, 13, 8, 4, 2],
  ramp: [2, 10, 18, 15, 12, 10, 8, 7],
  aristocrats: [2, 11, 20, 19, 13, 8, 4, 2],
  voltron: [3, 13, 21, 18, 12, 7, 4, 2],
  tokens: [2, 11, 19, 19, 14, 8, 5, 2],
  stax: [3, 12, 20, 17, 13, 9, 5, 2],
}

/**
 * The target curve for a deck.
 *
 * A secondary archetype blends 70/30, the same ratio the role targets use
 * (doc 14 §14.1) — a hybrid deck should not get a curve neither half wants.
 */
export const curveTarget = (
  archetype: ArchetypeKey,
  secondary: ArchetypeKey | null = null,
): CurveTarget => {
  const primary = SHAPES[archetype]
  if (secondary === null || secondary === archetype) return NORMALISED(primary)

  const other = SHAPES[secondary]
  return NORMALISED(primary.map((w, i) => w * 0.7 + (other[i] ?? 0) * 0.3))
}

/** The bucket a mana value falls in. 7 holds everything above it. */
export const curveBucket = (manaValue: number): number =>
  Math.min(CURVE_BUCKETS - 1, Math.max(0, Math.floor(manaValue)))

export interface CurveDelta {
  readonly bucket: number
  /** Cards the deck has here. */
  readonly actual: number
  /** Cards the target implies for a deck of this size. */
  readonly ideal: number
  /** `ideal - actual`. Positive means short, negative means over-full. */
  readonly delta: number
}

/**
 * Compare a deck's curve against its target.
 *
 * Lands are excluded by the caller: a 36-land deck is not "over-full at zero",
 * and including them would swamp the shape.
 */
export const curveDeltas = (
  manaCurve: readonly number[],
  target: CurveTarget,
): readonly CurveDelta[] => {
  const total = manaCurve.reduce((a, b) => a + b, 0)
  return target.map((share, bucket) => {
    const actual = manaCurve[bucket] ?? 0
    const ideal = Math.round(share * total)
    return { bucket, actual, ideal, delta: ideal - actual }
  })
}

/**
 * How much a card at this mana value helps, from -1 to 1.
 *
 * TWO-SIDED, which is the whole point: a card at an over-represented mana value
 * returns a negative number and is pushed down the list, where the old heuristic
 * merely declined to reward it. Scaled by how far off the bucket is relative to
 * its own target, so being three short at a bucket that wants four matters more
 * than being three short at a bucket that wants twenty.
 */
export const curveFit = (
  manaValue: number,
  manaCurve: readonly number[],
  target: CurveTarget,
): number => {
  const total = manaCurve.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  const bucket = curveBucket(manaValue)
  const share = (manaCurve[bucket] ?? 0) / total
  const wanted = target[bucket] ?? 0

  // Relative to the target share, so a bucket that wants 2% and has 6% reads as
  // badly over-full rather than as a rounding error.
  const scale = Math.max(wanted, 0.04)
  return Math.max(-1, Math.min(1, (wanted - share) / scale))
}

/** Words for a curve gap, for the reason the UI renders (pillar P4). */
export const curveDirection = (fit: number): 'short' | 'over' | 'balanced' =>
  fit > 0.15 ? 'short' : fit < -0.15 ? 'over' : 'balanced'
