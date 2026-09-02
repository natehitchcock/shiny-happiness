import type { Card } from './card.js'
import { cardImpact, type ImpactInput } from './impact.js'
import baseline from './efficiency/baseline.data.json' with { type: 'json' }

/**
 * How much you get for the mana (doc 18 §18.6).
 *
 * The fair rate is DERIVED, not asserted. Vanilla creatures — commander-legal,
 * a creature, and literally no rules text — are the only cards in Magic whose
 * whole contribution is their body, so they are the only honest measure of what
 * mana buys before text. The corpus says a four-drop's body is 6.78 power plus
 * toughness; the folk "2/2 for 2" rule predicts 8, and overprices big creatures
 * by about 18%.
 *
 * The gap between the vanilla row and the all-creatures row is the format's own
 * price of text, and that is the exchange rate between stats and abilities. Both
 * live in `efficiency/baseline.data.json`, REGENERATED from the corpus rather
 * than frozen here: power creep is real and continuing, and a constant written
 * today is a lie in eighteen months with nothing to make it fail.
 */

export interface EfficiencyBaseline {
  /** Mean P+T of textless creatures at each mana value, with sample counts. */
  readonly vanillaStatlineByManaValue: Readonly<
    Record<string, { readonly n: number; readonly statline: number }>
  >
  /** Least-squares fit over MV 1–6, for extrapolation past the sampled range. */
  readonly vanillaStatlineFit: { readonly slope: number; readonly intercept: number }
  /** `r`: what one point of `cardImpact().score` is worth in stat points. */
  readonly statPointsPerImpactPoint: number
}

/**
 * The measured baseline this build ships with.
 *
 * IMPACT IS AN INPUT TO ONE HALF OF THIS, and the coupling is easy to miss:
 * `statPointsPerImpactPoint` is fitted against the MEAN IMPACT of all creatures
 * at each mana value, so every change to `cardImpact` moves it. The other half
 * — `vanillaStatlineByManaValue` and `vanillaStatlineFit` — reads only power,
 * toughness and oracle text, and cannot move for that reason.
 *
 * `r` is therefore STALE AS SHIPPED by about 3.6% (doc 18 §18.6, §18.13): the
 * reach-and-stakes audit removed false positives that were inflating mean
 * impact, and the same measured gap over a smaller mean gives 0.4644 rather
 * than 0.4484. Regenerate with `pnpm --filter @roundtable/ingest baseline`
 * against a corpus database. It is stale in a benign direction — every score is
 * uniformly a little low, so the ordering between cards is essentially
 * untouched — but a reader comparing this file to the model should know why.
 */
export const EFFICIENCY_BASELINE: EfficiencyBaseline = baseline

/**
 * Below this many samples a mana value's measured mean is not worth trusting.
 *
 * Eight and above have single-digit samples (two vanilla creatures at MV 8), and
 * one unusual card would move the row by whole points of P+T. Those fall through
 * to the fitted line, which is informed by all 319.
 */
const MIN_SAMPLE = 10

/**
 * What a body of this mana value is worth, before any text.
 *
 * The measured table, not the fitted line, wherever the sample supports it. The
 * line reads 10.74 at six mana against a measured 11.80, and a baseline that is
 * a whole point of P+T wrong at the top of the curve is wrong exactly where the
 * expensive cards are. The line is kept for what the table cannot cover.
 *
 * Floored at zero: the fit extrapolates below zero for negative mana values,
 * which do not exist, and a negative baseline would hand a free creature a
 * surplus for having a body at all.
 */
export const vanillaStatline = (
  manaValue: number,
  from: EfficiencyBaseline = EFFICIENCY_BASELINE,
): number => {
  const bucket = from.vanillaStatlineByManaValue[String(Math.round(manaValue))]
  if (bucket !== undefined && bucket.n >= MIN_SAMPLE) return bucket.statline
  const { slope, intercept } = from.vanillaStatlineFit
  return Math.max(0, slope * manaValue + intercept)
}

/**
 * Exactly the fields the metric reads — the impact model's inputs plus the body.
 *
 * Narrower than `Card` for the same reason `ImpactInput` is: it says what is
 * actually consumed, and it lets the baseline generator pass a database row.
 */
export type EfficiencyInput = ImpactInput &
  Pick<Card, 'manaValue' | 'types' | 'power' | 'toughness'>

export interface CardEfficiency {
  /**
   * Stat points of surplus per mana of cost. The number a column draws.
   *
   * Zero for a card that is exactly what its mana buys and nothing more, which
   * is what a vanilla creature is by construction. Never negative.
   */
  readonly score: number
  /** `max(0, P+T − vanillaStatline(MV))`. Always 0 for a noncreature. */
  readonly statSurplus: number
  /** `statPointsPerImpactPoint × impact.score`, in stat points. */
  readonly effectValue: number
  /** What that mana buys as a plain body — the number `statSurplus` is measured against. */
  readonly baseline: number
  /** `manaValue + 1`: the mana, plus the card itself. See below. */
  readonly cost: number
}

/**
 * Read a creature's printed power and toughness as numbers.
 *
 * Null unless BOTH parse. Magic prints `*`, `1+*` and `?`, and a card whose
 * power is `*` has a real power that this function cannot state — treating it as
 * 0 would claim the creature has no body, which for Tarmogoyf is a lie. Such a
 * card gets no stat term at all and stands on its text, which is the honest
 * reading of a body nobody can name.
 */
const statlineOf = (card: EfficiencyInput): number | null => {
  if (!card.types.includes('creature')) return null
  const power = Number(card.power)
  const toughness = Number(card.toughness)
  if (card.power === null || card.toughness === null) return null
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null
  return power + toughness
}

/**
 * How much of a card you get per mana.
 *
 * ```
 * statSurplus = max(0, P+T − vanillaStatline(MV))     creatures only
 * value       = statSurplus + r × impact              stat points
 * efficiency  = value / (MV + 1)
 * ```
 *
 * BOTH TERMS ARE SURPLUSES, and that is the whole of what this gets right. The
 * formula this was scoped as — `(P+T + r × impact) / MV` — was built, measured
 * and rejected: `r` is derived from what a creature GIVES UP to have text, so
 * adding it to a body's full value asks a number about the margin to price the
 * whole. The literal formula rates Grizzly Bears at 2.00 and Wrath of God at
 * 0.69, and a metric that says a vanilla bear is three times the card a Wrath is
 * is not one to ship.
 *
 * `max(0, …)` on the body because a body below the going rate is not a DEBT.
 * Llanowar Elves is a 1/1 for one against a vanilla rate of 2.97, and charging
 * it −0.97 says the card would be better if it did nothing at all.
 *
 * The denominator is `MV + 1`, and the `+ 1` is the card: a spell costs a card
 * as well as its mana. It also has to be there — 21 commander-legal creatures
 * and a good many noncreature spells have mana value 0, and `x / 0` has to go
 * somewhere. Under `/MV` the metric would also be close to a rename of "cheap",
 * with the one-mana column winning every sort by construction.
 *
 * Pure and total. Non-creatures have no stat term: a noncreature spell is not a
 * creature that is missing a body, so it gets neither the surplus nor a penalty.
 */
export const cardEfficiency = (
  card: EfficiencyInput,
  from: EfficiencyBaseline = EFFICIENCY_BASELINE,
): CardEfficiency => {
  const impact = cardImpact(card)
  const baselineStats = vanillaStatline(card.manaValue, from)
  const statline = statlineOf(card)
  const statSurplus = statline === null ? 0 : Math.max(0, statline - baselineStats)
  const effectValue = from.statPointsPerImpactPoint * impact.score
  const cost = card.manaValue + 1
  const round = (n: number): number => Math.round(n * 1000) / 1000
  return {
    score: round((statSurplus + effectValue) / cost),
    statSurplus: round(statSurplus),
    effectValue: round(effectValue),
    baseline: round(baselineStats),
    cost,
  }
}
