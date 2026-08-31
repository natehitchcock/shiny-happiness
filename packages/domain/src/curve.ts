import type { ArchetypeKey } from './archetype.js'
import type { TargetSource } from './composition.js'
import { CURVE_REFERENCE_SPELLS, type TargetOverrides } from './target-overrides.js'

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
 * whether the deck is 40 spells or 65. There is no deck corpus to derive them
 * from (ADR-0008) and there will not be one, so they are the source of truth
 * indefinitely and every row below has to say why it is that shape. The UI shows
 * them as a target to sit near, never a quota to hit.
 *
 * WHY A SEPARATE TABLE AT ALL. The obvious alternative is to compute the curve
 * from the archetype's role mix in `archetype-targets.ts` — take each role's
 * ideal count and each role's typical cost, and add them up. That was tried
 * against the ingested Scryfall corpus (34k commander-legal cards, `edhrec_rank`
 * as the popularity order, which ADR-0008 keeps) and it does not work: composing
 * all nine rows that way produces nine curves with means between 3.18 and 3.40,
 * i.e. the same curve nine times. Role *counts* barely move a deck's curve,
 * because every role's own cost distribution peaks at two and three.
 *
 * What separates an aggro curve from a control curve is which HALF of each role
 * the deck buys — Swords to Plowshares and Path against Cyclonic Rift and a
 * wrath, both `spot-removal`/`board-wipe`, four mana apart. That skew is not
 * recoverable from a count, so it is stated here, per archetype, on purpose.
 *
 * HOW TO READ A ROW. `midrange` is the anchor: it is deliberately set to the
 * curve the composed role mix predicts (~3.3 mean), because midrange is the
 * archetype defined by not skewing. Every other row is a stated skew off it.
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
  /**
   * `custom` when the builder pinned this bucket's count (doc 16).
   *
   * Optional for the same reason `CompositionTarget.source` is: additive, so
   * every existing reader and every existing literal is untouched (AGENTS.md
   * R2). The curve panel needs it to mark the buckets it must not present as
   * the archetype's opinion.
   */
  readonly source?: TargetSource
}

export type CurveTarget = readonly CurveBand[]

/**
 * How much wiggle room each archetype gets, as a fraction of its own share.
 *
 * The ordering axis is: HOW MUCH OF THE PLAN IS A SCHEDULE. A deck that has to
 * do a specific thing by a specific turn is held tightly, because a card that
 * slips a bucket costs a turn it cannot get back. A deck whose plan is a
 * resource curve rather than a schedule is held loosely, because its cards are
 * substitutable across costs and a band that flagged the difference would be
 * flagging a preference, not a fault.
 *
 * Note this is a fraction of the archetype's OWN share, so a tight archetype
 * with a fat bucket can still get a wider band there in absolute terms than a
 * loose archetype with a thin one. "Aggro is held tighter than control" is true
 * of the whole curve, not guaranteed bucket by bucket — the test asserts it over
 * the whole curve for that reason.
 *
 * One scalar per archetype, not one per bucket. Ramp is the case that argues for
 * per-bucket (its early rocks are on a schedule; its payoffs are the opposite),
 * and it is knowingly not served well here. Doc 16 shipped tolerance as a single
 * per-deck setting that REPLACES this one, so a ramp player who disagrees has a
 * dial; splitting the table per bucket would still be designing against that.
 */
const TOLERANCE: Record<ArchetypeKey, number> = {
  /** Pure schedule. Damage per turn is arithmetic and an unspent turn is gone. */
  aggro: 0.25,
  /** The gear must land while the creature is still alive to carry it. */
  voltron: 0.3,
  /** The pieces cost what they cost; either you deploy the pair this turn or not. */
  combo: 0.3,
  /** Outlet plus fodder plus payoff has to be online before the table stabilises. */
  aristocrats: 0.3,
  /**
   * A tax has to precede the mana it taxes. Sphere of Resistance on turn six is
   * not a late Sphere, it is no Sphere. Moved in from 0.4, which had stax nearly
   * as curve-agnostic as control and implied a lock deck can afford to be slow.
   */
  stax: 0.3,
  /** Two real builds — cheap makers plus anthems, or fewer bigger floods. */
  tokens: 0.35,
  /** The archetype defined by not committing to a point on the curve. */
  midrange: 0.35,
  /**
   * Answers are fungible across cost — a counterspell at two and a wrath at five
   * are both "interaction" — and counter-control and wrath-control are both real
   * decks, so the band has to cover a genuinely bimodal design space. Not as
   * loose as ramp, though: control still has to survive to the late game, so its
   * early buckets are a real requirement rather than a preference. Was 0.45,
   * which made it indistinguishable from ramp and left almost no curve signal.
   */
  control: 0.4,
  /** Loosest: the entire plan is decoupling cost from turn, so where the payoffs sit is open. */
  ramp: 0.45,
}

/** Never narrower than this share, or a 2%-target bucket has a band of nothing. */
const MIN_HALF_WIDTH = 0.015

const banded = (
  weights: readonly number[],
  tolerance: number,
  custom: ReadonlySet<number> = new Set(),
): CurveTarget => {
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w, bucket) => {
    const ideal = w / total
    const halfWidth = Math.max(ideal * tolerance, MIN_HALF_WIDTH)
    return {
      ideal,
      min: Math.max(0, ideal - halfWidth),
      max: ideal + halfWidth,
      source: custom.has(bucket) ? ('custom' as const) : ('archetype' as const),
    }
  })
}

/**
 * Weights, not shares — `banded` normalises them, so a row can be edited one
 * bucket at a time without rebalancing the other seven.
 *
 * ABOUT BUCKET 0. It is the smallest real choice in the table: the corpus holds
 * 99 commander-legal nonland cards at mana value zero, and most of them are fast
 * mana (Lotus Petal, the Moxen, Lion's Eye Diamond) that brackets 1–3 do not
 * want. Scryfall's `cmc` also puts only pure-X costs here — `{X}{X}` Walking
 * Ballista is 0 but `{X}{B}{B}` Torment of Hailfire is 2 — so this bucket is
 * NOT "the X spells". Every row is therefore ~1%, and the two exceptions
 * (combo, stax) are the archetypes that actually have a use for those 99 cards.
 */
const SHAPES: Record<ArchetypeKey, readonly number[]> = {
  //             mv0  1   2   3   4   5   6  7+

  /**
   * The anchor row, and the only one not skewed: this is close to what the
   * composed role mix predicts, which is the right definition of "midrange" —
   * efficient at every point and committed to none. Also the fallback curve for
   * every deck with no archetype (`recommend.ts`), so it is left alone unless
   * there is a reason beyond taste. Mean ~3.3.
   */
  midrange: [1, 10, 18, 19, 16, 11, 6, 3],

  /**
   * Skews down hardest. Aggro buys the cheap half of every role it plays —
   * one-mana removal, dorks and Signets rather than five-mana rocks — and its
   * threats are the ones that can attack on the turn they are cast. The top four
   * buckets are about a third of what the role mix would predict: a six-drop in
   * an aggro deck is a turn spent not attacking. Mean ~2.7, the lowest here.
   */
  aggro: [1, 15, 23, 20, 11, 5, 2, 1],

  /**
   * The mirror image of aggro, and the shape that most justifies this table
   * existing: control's role counts are unremarkable, but it buys the expensive
   * end of each — Cyclonic Rift over a bounce spell, a wrath over a shock, a
   * five-mana draw engine over a cantrip. Two and three are roughly halved
   * against the composed prediction and five and six roughly doubled. Its few
   * threats are large because it has to win with a small number of them.
   * Mean ~3.8, the highest here.
   */
  control: [1, 8, 14, 17, 17, 14, 10, 6],

  /**
   * Cheap like aggro, but with the table's only real bucket-0 presence and a
   * longer tail. Combo is the one archetype whose plan converts turn-one mana
   * straight into a win, so Lotus Petal and the Moxen are the point rather than
   * filler; and the eight tutors it runs are not cheap — the `tutor` role's own
   * cost distribution is the highest of any role in the corpus after board
   * wipes, because the popular tutors past Demonic and Vampiric are five- and
   * six-mana creature tutors.
   */
  combo: [3, 14, 21, 18, 11, 7, 4, 2],

  /**
   * The only deliberately BIMODAL row. Ramp is fat at one to three (its own
   * accelerants, whose corpus cost distribution peaks hard at two and three),
   * then dips at four and five, then rises again at six and up. The dip is the
   * whole point and the previous monotone-decreasing row could not express it: a
   * four-drop costs a ramp deck exactly what a ramp spell costs and does not
   * advance the plan, so the deck skips that rung on purpose.
   *
   * Mean ~3.4, which is inside the neutral band of the land modifier in
   * `archetype-targets.ts` rather than over its 3.5 line — deliberate, so a ramp
   * deck that leans further into its payoffs earns the extra land by doing so
   * rather than being given it twice.
   */
  ramp: [2, 11, 20, 17, 9, 8, 9, 8],

  /**
   * Cheap and repeatable, with almost NO top end — 7+ is the thinnest in the
   * table after aggro. That is the sharp contrast with tokens: both build a
   * board, but aristocrats converts it with a two-mana Blood Artist, so it never
   * has to buy a seven-mana card to cash the board in. Its recursion package
   * pulls it a little above combo.
   */
  aristocrats: [1, 11, 21, 20, 13, 8, 4, 1],

  /**
   * Higher than midrange, which is the opposite of the "go-wide is cheap"
   * intuition and is what the corpus says: `token-maker` and `anthem` are two of
   * the more expensive roles by their own cost distributions, and tokens runs
   * nineteen of them between the two.
   *
   * Read as midrange with two trades. The one-drop bucket is thinner, because a
   * one-mana card in a go-wide deck makes one body and there is nothing to pump
   * it with yet. And a chunk of the five bucket moves to 7+, because the board
   * this deck builds does not kill anyone by itself — Craterhoof, a mass pump,
   * an overrun — and that finisher is a slot the deck must actually leave open.
   * Aristocrats is the deliberate contrast: same board, no finisher needed.
   */
  tokens: [1, 9, 18, 21, 18, 10, 6, 5],

  /**
   * Nearly as low as aggro despite being a slower deck, because voltron is the
   * only archetype that pays for its cards TWICE: cast cost, then equip cost,
   * then the commander tax when the creature is answered. Its printed curve has
   * to be low for its effective curve to be playable. Peaks at two harder than
   * aggro and has a thinner one-drop bucket, matching `equipment` in the corpus
   * (a third of the popular equipment costs two; almost none costs one).
   */
  voltron: [1, 12, 23, 19, 12, 6, 3, 1],

  /**
   * Front-loaded, and more so than the role mix alone would give it. A tax has
   * to be deployed before the mana it taxes exists, so stax buys the cheap half
   * of its own role even though the `stax` role's corpus distribution peaks at
   * three. The small 7+ weight is the lock finisher — a deck that stops the
   * table has to be able to end the game or it has only made it longer.
   */
  stax: [2, 12, 22, 20, 12, 7, 4, 2],
}

/**
 * How strict this archetype pair is on its own, before any per-deck override.
 *
 * Exported for the customiser (doc 16), which has to show the preset behind the
 * value being typed — a tolerance slider that shows only the number you set
 * cannot tell you the archetype wanted 0.35. The blend rule is the one
 * `curveTarget` uses, stated once here so the two cannot drift.
 */
export const archetypeTolerance = (
  archetype: ArchetypeKey,
  secondary: ArchetypeKey | null = null,
): number =>
  secondary === null || secondary === archetype
    ? TOLERANCE[archetype]
    : Math.max(TOLERANCE[archetype], TOLERANCE[secondary])

/**
 * Fold the deck's own bucket counts into the archetype's shape (doc 16).
 *
 * SPARSE. A bucket the builder pinned becomes its count as a share of
 * `CURVE_REFERENCE_SPELLS`; every bucket they did not keeps the archetype's
 * shape, rescaled to fill whatever share is left over. So pinning "twelve
 * two-drops" moves the two-drop bucket and leaves the relative shape of the
 * other seven exactly as the archetype drew it — which is the whole point of a
 * sparse override, and is why this is not a snapshot of eight numbers.
 *
 * Two degenerate inputs, both real:
 *
 *   * Counts summing past the reference. `rest` goes to zero and `banded`
 *     renormalises what is left, so the RATIOS the builder typed survive and
 *     the untouched buckets are squeezed out. That is the honest reading of
 *     "40 two-drops in a 63-spell deck", and doc 03 §3.2's principle says the
 *     user may knowingly cross their own line — the warning belongs in the UI,
 *     not in a clamp here.
 *   * Every bucket pinned to zero. There is no shape left to normalise, so the
 *     archetype's is returned untouched rather than eight NaNs.
 */
const withCurveOverrides = (
  weights: readonly number[],
  overrides: Readonly<Record<number, number>>,
): { readonly weights: readonly number[]; readonly custom: ReadonlySet<number> } => {
  const custom = new Set<number>()
  for (const [key, count] of Object.entries(overrides)) {
    const bucket = Number(key)
    if (Number.isInteger(bucket) && bucket >= 0 && bucket < CURVE_BUCKETS && count >= 0) {
      custom.add(bucket)
    }
  }
  if (custom.size === 0) return { weights, custom }

  const total = weights.reduce((a, b) => a + b, 0)
  const shares = weights.map((w) => (total === 0 ? 0 : w / total))
  const pinnedShare = [...custom].reduce(
    (sum, bucket) => sum + (overrides[bucket] ?? 0) / CURVE_REFERENCE_SPELLS,
    0,
  )
  const restShare = Math.max(0, 1 - pinnedShare)
  const restPreset = shares.reduce((sum, s, i) => (custom.has(i) ? sum : sum + s), 0)

  const next = shares.map((share, bucket) =>
    custom.has(bucket)
      ? (overrides[bucket] ?? 0) / CURVE_REFERENCE_SPELLS
      : restPreset === 0
        ? 0
        : (share * restShare) / restPreset,
  )
  if (next.reduce((a, b) => a + b, 0) === 0) return { weights, custom: new Set<number>() }
  return { weights: next, custom }
}

/**
 * The target curve for a deck.
 *
 * A secondary archetype blends 70/30, the same ratio the role targets use
 * (doc 14 §14.1) — a hybrid deck should not get a curve neither half wants.
 *
 * `overrides` is the per-deck sheet (doc 16). Sparse: absent buckets keep the
 * archetype's shape, and a deck that overrides nothing gets byte-identical
 * output to the call that omits the argument entirely.
 */
export const curveTarget = (
  archetype: ArchetypeKey,
  secondary: ArchetypeKey | null = null,
  overrides?: TargetOverrides,
): CurveTarget => {
  const blended =
    secondary === null || secondary === archetype
      ? SHAPES[archetype]
      : SHAPES[archetype].map((w, i) => w * 0.7 + (SHAPES[secondary][i] ?? 0) * 0.3)

  // The deck's own setting, where it has one, replaces the archetype's — it is
  // the user saying how strict THIS deck is, which outranks a table.
  const tolerance = overrides?.tolerance ?? archetypeTolerance(archetype, secondary)

  const { weights, custom } = withCurveOverrides(blended, overrides?.curve ?? {})
  return banded(weights, tolerance, custom)
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
/**
 * Whole cards per bucket that sum to exactly `total`.
 *
 * Rounding each bucket on its own does not: eight shares that sum to 1, each
 * rounded independently, land anywhere from 62 to 64 against a 63-spell
 * reference. Six of the nine archetypes come out at 64, so the targets sheet
 * greeted a builder who had changed nothing with "Curve total 64 of 63 spells —
 * over", an amber warning against a deck they had not touched and could not
 * clear without hand-editing a bucket.
 *
 * Largest remainder (Hamilton): floor everything, then hand the leftover cards
 * to the buckets with the largest fractional parts. It is the standard fix for
 * apportioning whole seats to fractional shares, and it keeps the property that
 * matters here — the parts equal the whole, always.
 *
 * Ties break on bucket order so the answer is deterministic; two archetypes
 * with the same shape must produce the same table every time (doc 05's
 * determinism rule).
 */
export const apportion = (shares: readonly number[], total: number): readonly number[] => {
  const exact = shares.map((share) => share * total)
  const floors = exact.map((value) => Math.floor(value))
  const counts = [...floors]

  // Clamped at zero: floating-point shares can sum a hair over 1, and handing
  // out a negative number of cards is not a thing.
  let remaining = Math.max(0, total - floors.reduce((a, b) => a + b, 0))
  const byRemainder = exact
    .map((value, bucket) => ({ bucket, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.bucket - b.bucket)

  for (const { bucket } of byRemainder) {
    if (remaining <= 0) break
    counts[bucket] = (counts[bucket] ?? 0) + 1
    remaining -= 1
  }
  return counts
}

export const curveDeltas = (
  manaCurve: readonly number[],
  target: CurveTarget,
): readonly CurveDelta[] => {
  const total = manaCurve.reduce((a, b) => a + b, 0)
  // Apportioned together, not rounded one at a time — the ideals have to add up
  // to the deck's own spell count or the panel contradicts itself.
  const ideals = apportion(
    target.map((band) => band.ideal),
    total,
  )
  return target.map((band, bucket) => {
    const actual = manaCurve[bucket] ?? 0
    const ideal = ideals[bucket] ?? 0
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
