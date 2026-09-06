import type { Card } from './card.js'
import { cardImpact, type ImpactInput, type PersistenceTier } from './impact.js'
import { ROLE_PRECEDENCE, type Role } from './role.js'
import type { SynergyTag } from './synergy.js'
import prices from './efficiency/effect-prices.data.json' with { type: 'json' }

/**
 * What a card is worth against what it costs (ADR-0070).
 *
 * EVERY EFFECT CARRIES A MANA PRICE LEARNED FROM THE CORPUS. A card is worth
 * the sum of its effects' prices; efficiency is that sum minus what the card
 * actually costs. The unit is MANA, and the number is a DIFFERENCE rather than
 * a rate — `+2.19` means "the format normally charges two more mana than this
 * card asks", and a negative score means the opposite and is not clamped.
 *
 * THE PRICES ARE FITTED, NOT PLAIN MEANS, and that is the whole of what this
 * gets right. Summing the mean mana value of every "draw" card and every "ramp"
 * card double-counts, because the mean of the draw bucket already includes the
 * cards that also ramp: over the 31,782 commander-legal cards that sum predicts
 * a mean mana value of 3.99 against an actual 3.29 — a 1.21x systematic
 * inflation — and misses by 1.69 mana on average. A least-squares fit asks the
 * different and correct question: what does this effect add to the price of a
 * card that already has the others? Wincon falls from a naive 3.85 to 1.90,
 * equipment from 2.38 to 0.81, board wipe from 4.56 to 3.39.
 *
 * IMPACT IS NOT AN INPUT. The composite `cardImpact().score` appears nowhere
 * here; the previous model made it a term and refitted an exchange rate against
 * it, so every pass over the impact classifier moved every efficiency number
 * twice (doc 18 §18.6, superseded). The one thing taken from that module is the
 * `persistence` axis — Rate — which is a priced feature like any other.
 */

/** The three provenances a price file can have. Only one of them is measured. */
export type EffectPriceSource = 'corpus-database' | 'scryfall-oracle-bulk'

/**
 * The fitted price of every feature, generated from the corpus.
 *
 * GENERATED, never written by hand:
 * `pnpm --filter @roundtable/ingest effect-prices`. Power creep is real and
 * continuing, and the corpus reprices itself every set; a coefficient frozen in
 * TypeScript today is a lie in eighteen months with nothing to make it fail.
 * That is the argument `brackets/rules.data.json` already establishes for data
 * that is not ours to invent, and the argument the baseline this replaces made
 * for itself.
 */
export interface EffectPrices {
  /** Where the fit was run. Only `corpus-database` is the shipped generator. */
  readonly source: EffectPriceSource
  /** ISO date, so a reader can see how old the prices are. */
  readonly generatedAt: string
  readonly corpus: { readonly commanderLegal: number }
  readonly fit: {
    readonly ridgeLambda: number
    readonly minProduceSupport: number
    readonly features: number
    readonly meanManaValue: number
    readonly meanPredictedManaValue: number
    readonly meanAbsoluteError: number
    readonly crossValidatedMeanAbsoluteError: number
    readonly rootMeanSquaredError: number
    readonly r2: number
  }
  /** Marginal mana price of holding each of the twenty roles. */
  readonly roles: Readonly<Record<string, number>>
  /**
   * Marginal mana price of each event the card PRODUCES.
   *
   * Only tags the fit had enough cards to price — see `fit.minProduceSupport`.
   * A tag absent from this table contributes nothing, which is the honest
   * reading of "the corpus has not shown us what this costs".
   */
  readonly produces: Readonly<Record<string, number>>
  /** Marginal mana price of each Rate tier. Every card has exactly one. */
  readonly rate: Readonly<Record<string, number>>
  /**
   * The body, priced as a little model of its own.
   *
   * `hasBody` is the offset for having a body at all and is strongly negative;
   * `power` and `toughness` are the price of one point of each. A card with no
   * printed power and toughness contributes exactly ZERO from all three, never
   * an offset with a zero body attached — an instant that quietly inherited the
   * `hasBody` offset would shift every noncreature in the format at once.
   */
  readonly body: {
    readonly hasBody: number
    readonly power: number
    readonly toughness: number
  }
}

/** The four Rate tiers, which partition the corpus: every card has exactly one. */
const RATE_TIERS: readonly PersistenceTier[] = ['one-shot', 'activated', 'triggered', 'upkeep']

/**
 * Refuse a price file that would score every card wrong in silence.
 *
 * A file of zeroes is the failure that matters: it makes every card worth
 * nothing, so efficiency becomes exactly `−manaValue`, every column sorts by
 * cheapness, and NOTHING downstream fails to say so. The same argument
 * `loadBracketRules` makes about an empty Game Changers set, and the same one
 * the generator makes when the corpus query comes back empty.
 *
 * Thrown at module load rather than returned as a `Result`, because this is
 * programmer error in the AGENTS.md §7 sense: the file is checked in beside the
 * code and a broken one is a broken build, not a runtime condition a caller can
 * handle.
 *
 * Exported so the guard can be tested against a broken table without anyone
 * having to break the shipped file to see it work.
 */
export const assertUsablePrices = (from: EffectPrices): EffectPrices => {
  const missingRole = ROLE_PRECEDENCE.find((role) => from.roles[role] === undefined)
  if (missingRole !== undefined) {
    throw new Error(`effect-prices.data.json has no price for role "${missingRole}"`)
  }
  for (const tier of RATE_TIERS) {
    if (from.rate[tier] === undefined) {
      throw new Error(`effect-prices.data.json has no price for Rate tier "${tier}"`)
    }
  }
  const everything = [
    ...Object.values(from.roles),
    ...Object.values(from.produces),
    ...Object.values(from.rate),
    from.body.hasBody,
    from.body.power,
    from.body.toughness,
  ]
  if (everything.every((n) => n === 0)) {
    throw new Error('effect-prices.data.json is all zeroes — regenerate it before shipping')
  }
  if (!everything.every((n) => Number.isFinite(n))) {
    throw new Error('effect-prices.data.json holds a non-finite price')
  }
  return from
}

/**
 * The prices this build ships with.
 *
 * READ `source` BEFORE TRUSTING THE NUMBERS. `corpus-database` means the
 * generator was run against a real corpus, which is the only supported state.
 * Anything else is a stand-in fitted somewhere the generator does not run, and
 * `efficiency.test.ts` fails on it deliberately rather than letting a
 * provisional number ship quietly.
 */
export const EFFECT_PRICES: EffectPrices = assertUsablePrices(prices as EffectPrices)

/**
 * Exactly the fields the metric reads.
 *
 * Wider than the type it replaces, and that is the contract change ADR-0070
 * records: the model's vocabulary is now the card's own derivations — `roles`
 * and `synergyProduces` — rather than a body and an impact score. Both are
 * STORED on the card (doc 02 §2.4, ADR-0011), so no caller has to derive
 * anything to ask this question; `ImpactInput` is still in the intersection
 * because Rate is read from the impact classifier.
 */
export type EfficiencyInput = ImpactInput &
  Pick<Card, 'manaValue' | 'types' | 'power' | 'toughness' | 'roles' | 'synergyProduces'>

export interface CardEfficiency {
  /**
   * `worth − cost`, IN MANA. The number a column draws.
   *
   * NEGATIVE IS MEANINGFUL AND IS NOT CLAMPED. A card that costs more than the
   * format charges for what it does is genuinely a bad rate, and saying so is
   * the point; the metric this replaces floored at zero and could not.
   *
   * Zero means "priced exactly at the going rate", which is a real reading
   * rather than a floor.
   */
  readonly score: number
  /** What the corpus charges for everything this card does and is, in mana. */
  readonly worth: number
  /** The part of `worth` that is priced effects — roles, produced events, Rate. */
  readonly effectValue: number
  /** The part of `worth` that is the body. Exactly 0 for a card with no statline. */
  readonly bodyValue: number
  /** `manaValue`. What you actually pay — no `+ 1`, because this is a difference. */
  readonly cost: number
}

/**
 * Read a creature's printed power and toughness as numbers.
 *
 * Null unless BOTH parse AND the card is a creature. Magic prints `*`, `1+*`
 * and `?`, and a card whose power is `*` has a real power this function cannot
 * state — treating it as 0 would claim Tarmogoyf has no body. Such a card gets
 * no body term at all and stands on its effects, which is the honest reading of
 * a body nobody can name.
 */
const statlineOf = (card: EfficiencyInput): { power: number; toughness: number } | null => {
  if (!card.types.includes('creature')) return null
  if (card.power === null || card.toughness === null) return null
  const power = Number(card.power)
  const toughness = Number(card.toughness)
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null
  return { power, toughness }
}

/**
 * What the corpus charges for a card like this, minus what it asks for.
 *
 * ```
 * worth      = Σ role prices + Σ produced-event prices + Rate + body
 * efficiency = worth − manaValue                                    mana
 * ```
 *
 * THE VOCABULARY IS ROLES, PRODUCED SEMANTICS, RATE AND THE BODY, and each of
 * the four earned its place with a measurement (ADR-0070 §4):
 *
 *   - **Roles** alone leave 11,231 cards in the `synergy` catch-all, whose
 *     fitted price came out at exactly the corpus mean and therefore predicts
 *     nothing. Mean absolute error 1.41 mana.
 *   - **`synergyProduces`**, and only produces. `wants` is a payoff rather than
 *     an effect and `has` is membership, so neither is something the card DOES.
 *     Three produce tags are excluded for the same reason — `spell-cast`,
 *     `enchantment-etb` and `artifact-etb` are derived from the TYPE LINE by
 *     `synergy.ts`, so they are membership wearing a `produces` label. Error
 *     falls to 1.39.
 *   - **Rate** — the axis `impact.ts` calls `persistence`, and the only thing
 *     taken from that module. Its four tiers span every card, so they are also
 *     what makes the fit unbiased: mean predicted mana value lands on the
 *     corpus mean of 3.291 exactly.
 *   - **The body**, priced rather than assumed. It is worth 0.44 mana per point
 *     of power and 0.37 per point of toughness against a −1.85 offset for
 *     having one, and it takes the error from 1.21 to 0.95 — the single largest
 *     improvement any feature makes. A vanilla creature is therefore NO LONGER
 *     the floor by construction: a 6/6 for four scores positive, because the
 *     body is worth more than four mana, and a model that could not say so was
 *     missing something real.
 *
 * A NONCREATURE CONTRIBUTES EXACTLY ZERO FROM THE BODY, offset included. It is
 * not a creature that is missing a body; it has none. Getting this wrong is the
 * one silent error in the file — every instant and sorcery in the format would
 * inherit the −1.85 offset and the whole table would shift by that amount —
 * which is why it is asserted rather than left to reading.
 *
 * Pure and total. Rounded to three decimals on the way out, because the query
 * predicate compares the same number the column prints (ADR-0025 §2) and float
 * addition of eighty coefficients is otherwise `2.1900000000000004` on the wire.
 */
export const cardEfficiency = (
  card: EfficiencyInput,
  from: EffectPrices = EFFECT_PRICES,
): CardEfficiency => {
  let effectValue = from.rate[cardImpact(card).persistence] ?? 0
  for (const role of new Set<Role>(card.roles)) {
    effectValue += from.roles[role] ?? 0
  }
  for (const tag of new Set<SynergyTag>(card.synergyProduces)) {
    // A tag the fit had too few cards to price contributes nothing. Absence is
    // "the corpus has not shown us what this costs", not "it is free".
    effectValue += from.produces[tag] ?? 0
  }

  const statline = statlineOf(card)
  const bodyValue =
    statline === null
      ? 0
      : from.body.hasBody + from.body.power * statline.power + from.body.toughness * statline.toughness

  const round = (n: number): number => Math.round(n * 1000) / 1000
  const worth = effectValue + bodyValue
  return {
    score: round(worth - card.manaValue),
    worth: round(worth),
    effectValue: round(effectValue),
    bodyValue: round(bodyValue),
    cost: card.manaValue,
  }
}
