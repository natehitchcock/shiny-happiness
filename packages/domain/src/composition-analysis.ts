import type { Card, CardType } from './card.js'
import {
  dimensionKey,
  roleDimension,
  typeDimension,
  type CompositionDimension,
  type CompositionTarget,
} from './composition.js'
import { acceptedSet, type Deck } from './deck.js'
import type { OracleId } from './ids.js'
import type { Role } from './role.js'

/**
 * Counting a deck against its targets (doc 05 §5.4, DOM-06).
 *
 * Counting uses `primaryRole` so a card lands in exactly one role bucket — see
 * doc 02 §2.4. Type counts are independent of role counts and may overlap with
 * them freely: a creature that ramps counts once as `creature` and once as
 * `ramp`, and that is correct, because they answer different questions.
 */

export interface CompositionCounts {
  readonly total: number
  readonly byRole: ReadonlyMap<Role, number>
  readonly byType: ReadonlyMap<CardType, number>
  /** Index by `dimensionKey`, for comparing against targets. */
  readonly byDimension: ReadonlyMap<string, number>
  /** Cards at each mana value, index 0..7+, with 7 holding everything above. */
  readonly manaCurve: readonly number[]
  readonly averageManaValue: number
}

const CURVE_BUCKETS = 8

export const countComposition = (
  deck: Deck,
  cards: ReadonlyMap<OracleId, Card>,
  roleFor?: (card: Card) => Role,
): CompositionCounts => {
  const byRole = new Map<Role, number>()
  const byType = new Map<CardType, number>()
  const manaCurve = new Array<number>(CURVE_BUCKETS).fill(0)
  let total = 0
  let manaValueSum = 0
  let nonLandCount = 0

  for (const oracleId of acceptedSet(deck)) {
    const card = cards.get(oracleId)
    if (card === undefined) continue
    total += 1

    const role = roleFor?.(card) ?? card.primaryRole
    byRole.set(role, (byRole.get(role) ?? 0) + 1)
    for (const type of card.types) byType.set(type, (byType.get(type) ?? 0) + 1)

    if (!card.types.includes('land')) {
      const bucket = Math.min(CURVE_BUCKETS - 1, Math.max(0, Math.floor(card.manaValue)))
      manaCurve[bucket] = (manaCurve[bucket] ?? 0) + 1
      manaValueSum += card.manaValue
      nonLandCount += 1
    }
  }

  const byDimension = new Map<string, number>()
  for (const [role, count] of byRole) byDimension.set(dimensionKey(roleDimension(role)), count)
  for (const [type, count] of byType) byDimension.set(dimensionKey(typeDimension(type)), count)
  // `dimensionKeysOf` is the same rule stated once; asserting the agreement
  // here would be circular, so `composition.test.ts` holds the two together.

  return {
    total,
    byRole,
    byType,
    byDimension,
    manaCurve,
    // Averaged over non-lands: including 36 zero-cost lands would make every
    // deck's curve look flat and the land modifier would never fire.
    averageManaValue: nonLandCount === 0 ? 0 : manaValueSum / nonLandCount,
  }
}

export interface Deficit {
  readonly dimension: CompositionDimension
  /** Negative = short of the ideal, positive = over it. */
  readonly delta: number
  readonly actual: number
  readonly target: CompositionTarget
  /** Outside [min, max], not merely off the ideal. */
  readonly outsideRange: boolean
}

/**
 * Gaps between a deck and its targets, worst first.
 *
 * Reports surpluses as well as shortfalls: "you are four over on removal" is as
 * useful as being under, and only reporting shortfalls would make every deck look
 * like it needs more cards.
 */
export const findDeficits = (
  counts: CompositionCounts,
  targets: readonly CompositionTarget[],
): readonly Deficit[] =>
  targets
    .map((target) => {
      const actual = counts.byDimension.get(dimensionKey(target.dimension)) ?? 0
      return {
        dimension: target.dimension,
        delta: actual - target.ideal,
        actual,
        target,
        outsideRange: actual < target.min || actual > target.max,
      }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

/** Only the shortfalls, which are what the `fills-<dimension>` groups act on. */
export const shortfalls = (deficits: readonly Deficit[]): readonly Deficit[] =>
  deficits.filter((d) => d.delta < 0)
