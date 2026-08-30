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

/**
 * A target share per bucket, with the tolerance around it.
 *
 * A range rather than a point, mirroring `CompositionTarget` (doc 05 §5.4),
 * which has carried `min`/`ideal`/`max` from the start. A curve is a shape a
 * deck sits near, not a quota it hits — being one card off at three drops is
 * not a defect worth scoring against, and treating it as one made the
 * suggestions twitchy after every accept.
 */
export interface CurveBand {
  readonly ideal: number
  readonly min: number
  readonly max: number
}

export type CurveTarget = readonly CurveBand[]

/**
 * How much wiggle room each archetype gets, as a fraction of its own share.
 *
 * Not uniform, because the archetypes differ in how much the curve IS the deck.
 * Aggro lives or dies on its early drops, so it is held tightly; ramp and
 * control deliberately spread across the top end and a wide band there is
 * correct rather than sloppy.
 */
const TOLERANCE: Record<ArchetypeKey, number> = {
  aggro: 0.25,
  combo: 0.3,
  aristocrats: 0.3,
  voltron: 0.3,
  tokens: 0.35,
  midrange: 0.35,
  stax: 0.4,
  control: 0.45,
  ramp: 0.45,
}

/** Never narrower than this share, or a 2%-target bucket has a band of nothing. */
const MIN_HALF_WIDTH = 0.015

const banded = (weights: readonly number[], tolerance: number): CurveTarget => {
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => {
    const ideal = w / total
    const halfWidth = Math.max(ideal * tolerance, MIN_HALF_WIDTH)
    return { ideal, min: Math.max(0, ideal - halfWidth), max: ideal + halfWidth }
  })
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
  if (secondary === null || secondary === archetype) {
    return banded(primary, TOLERANCE[archetype])
  }

  const other = SHAPES[secondary]
  // A hybrid gets the looser of the two tolerances: it is being asked to satisfy
  // two shapes at once, so holding it to the stricter one punishes the blend.
  const tolerance = Math.max(TOLERANCE[archetype], TOLERANCE[secondary])
  return banded(
    primary.map((w, i) => w * 0.7 + (other[i] ?? 0) * 0.3),
    tolerance,
  )
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
  readonly min: number
  readonly max: number
  /**
   * Distance to the nearest EDGE of the band, not to the ideal. Zero when the
   * bucket is already inside its range — which is the point of the range.
   * Positive means short, negative means over-full.
   */
  readonly delta: number
  readonly withinRange: boolean
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
  return target.map((band, bucket) => {
    const actual = manaCurve[bucket] ?? 0
    const ideal = Math.round(band.ideal * total)
    const min = Math.floor(band.min * total)
    const max = Math.ceil(band.max * total)

    const withinRange = actual >= min && actual <= max
    const delta = withinRange ? 0 : actual < min ? min - actual : max - actual
    return { bucket, actual, ideal, min, max, delta, withinRange }
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
  const band = target[bucket]
  if (band === undefined) return 0

  // Inside the band the deck is fine here, so the curve says nothing either way
  // and other signals decide. This is the wiggle room: without it every bucket
  // is permanently a little bit wrong and the ordering churns after each accept.
  if (share >= band.min && share <= band.max) return 0

  const distance = share < band.min ? band.min - share : band.max - share
  // Relative to the target share, so a bucket that wants 2% and has 6% reads as
  // badly over-full rather than as a rounding error.
  const scale = Math.max(band.ideal, 0.04)
  return Math.max(-1, Math.min(1, distance / scale))
}

/** Words for a curve gap, for the reason the UI renders (pillar P4). */
export const curveDirection = (fit: number): 'short' | 'over' | 'balanced' =>
  fit > 0.15 ? 'short' : fit < -0.15 ? 'over' : 'balanced'
