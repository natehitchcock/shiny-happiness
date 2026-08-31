/**
 * Per-deck target overrides (doc 16).
 *
 * A builder who disagrees with the archetype preset currently disagrees with
 * ALL of it at once — the composition meters, the `fills-<dimension>` groups,
 * the two-sided curve score and the cut hints all read the same two functions —
 * and the only recourse is picking a different archetype that is wrong in a
 * different way. This is the correction.
 *
 * SPARSE, NEVER A SNAPSHOT. The deck stores only the dimensions the user
 * actually typed. A full copy of the preset would freeze the deck against
 * whichever revision of `archetype-targets.ts` it was created under, silently
 * and forever, and doc 14 expects those presets to be revised. Sparse also
 * makes "reset this one row" a key deletion rather than a diff against a preset
 * the deck no longer remembers.
 *
 * COUNTS, NOT SHARES. Builders think in "36 lands", not "34.2% of nonland
 * spells". The curve is stored as counts too and normalised to shares on read,
 * so the share-based `curveFit` is untouched.
 */

/** How strict a deck with no `tolerance` of its own is on its role bands. */
export const DEFAULT_ROLE_TOLERANCE = 0.35

/**
 * The nonland-spell count a curve override is a count OF.
 *
 * 99 cards minus a 36-land deck. It has to be a constant, and the reason is
 * worth stating: the alternative is deriving the denominator from the deck's
 * own nonland count, which would make `curveTarget` depend on the deck's
 * contents and change its answer every time a card is accepted — the target a
 * builder typed would then drift under them while they built toward it.
 *
 * Nothing downstream is measured in this unit. `curveFit` and `curveDeltas`
 * both work in shares, so this constant only fixes the RATIO between a bucket
 * the user pinned and the preset shape that fills the rest; a deck of 58 or 66
 * nonland spells is judged on that same ratio, which is what a share-based
 * curve means. The visible cost is that a deck well away from 63 spells sees
 * the number it typed rendered a card or two off in the curve panel.
 */
export const CURVE_REFERENCE_SPELLS = 63

/** Buckets 0–7, matching `CURVE_BUCKETS`. Restated to avoid an import cycle. */
const BUCKETS = 8

/** The largest count an override may hold. A deck is 99 cards. */
const MAX_COUNT = 99

export interface TargetOverrides {
  /**
   * Dimension key → ideal card count. Absent means "use the archetype's".
   *
   * Keyed by `dimensionKey` (`role:ramp`, `type:creature`), not by `Role`.
   * Doc 16 sketched this as a role map; a role map cannot express "18
   * creatures", which is a row the composition panel already draws and one of
   * the numbers people most want to move. The key space here is exactly the one
   * the meters, the targets and the `fills-` groups already use, so an override
   * needs no translation anywhere.
   *
   * A key the archetype does not name is not an error — it ADDS that target.
   * A midrange deck that wants five stax pieces can say so without becoming a
   * stax deck, which is the same complaint doc 16 opens with, one level down.
   */
  readonly roles?: Readonly<Record<string, number>>
  /** Bucket 0–7 → card count. Sparse; absent buckets keep the archetype's shape. */
  readonly curve?: Readonly<Record<number, number>>
  /** 0..1, replacing the archetype's own. Absent means the archetype's. */
  readonly tolerance?: number
}

/** Nothing overridden. The state every deck starts in and can return to. */
export const NO_TARGET_OVERRIDES: TargetOverrides = Object.freeze({})

/**
 * Whether anything is actually overridden.
 *
 * `{ roles: {} }` and `{}` are the same deck, and a UI that marked the first as
 * "customised" would offer a reset that does nothing.
 */
export const hasTargetOverrides = (overrides: TargetOverrides | undefined): boolean =>
  overrides !== undefined &&
  (Object.keys(overrides.roles ?? {}).length > 0 ||
    Object.keys(overrides.curve ?? {}).length > 0 ||
    overrides.tolerance !== undefined)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT

/**
 * Read overrides out of untrusted JSON, dropping anything that is not a target.
 *
 * The column is `jsonb`, so the database will hold whatever was written to it —
 * including rows written by an older or newer build. Parsing here rather than
 * trusting the cast means a malformed entry costs that one entry, not the whole
 * deck's targets: dropping `{"role:ramp": "twelve"}` leaves the ramp preset in
 * place, which is the behaviour of a deck that never overrode it. Throwing
 * instead would make one bad key un-openable, and an override the user cannot
 * clear is exactly the trap this feature must not set.
 *
 * Pure and total: every input returns a `TargetOverrides`, possibly empty.
 */
export const parseTargetOverrides = (value: unknown): TargetOverrides => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return NO_TARGET_OVERRIDES
  }
  const raw = value as Record<string, unknown>
  const out: {
    roles?: Record<string, number>
    curve?: Record<number, number>
    tolerance?: number
  } = {}

  const roles = raw['roles']
  if (typeof roles === 'object' && roles !== null && !Array.isArray(roles)) {
    const kept: Record<string, number> = {}
    for (const [key, count] of Object.entries(roles)) {
      // Only keys in the dimension key space. A stray `ramp` (no prefix) would
      // silently never match a target and read as an override that does nothing.
      if (!key.startsWith('role:') && !key.startsWith('type:')) continue
      if (isCount(count)) kept[key] = count
    }
    if (Object.keys(kept).length > 0) out.roles = kept
  }

  const curve = raw['curve']
  if (typeof curve === 'object' && curve !== null && !Array.isArray(curve)) {
    const kept: Record<number, number> = {}
    for (const [key, count] of Object.entries(curve)) {
      const bucket = Number(key)
      if (!Number.isInteger(bucket) || bucket < 0 || bucket >= BUCKETS) continue
      if (isCount(count)) kept[bucket] = count
    }
    if (Object.keys(kept).length > 0) out.curve = kept
  }

  const tolerance = raw['tolerance']
  if (typeof tolerance === 'number' && Number.isFinite(tolerance)) {
    // Clamped rather than dropped: 1.4 is a legible intent ("as loose as it
    // goes") where a dropped value silently restores the archetype's strictness.
    out.tolerance = Math.min(1, Math.max(0, tolerance))
  }

  return out
}
