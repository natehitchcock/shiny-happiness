import type { Card } from './card.js'

/**
 * How much a card does (doc 18 §18.2–§18.5).
 *
 * A PROPERTY OF THE CARD, never of the deck. Deck-relative impact was offered
 * and declined: combo degree, role deficit and mechanical synergy are already
 * three deck-relative numbers on the same row, and a fourth would mostly be a
 * second opinion about the first three. Card-intrinsic also means the number can
 * appear on `/cards/search`, which has no deck at all.
 *
 * The cost of that decision is stated rather than patched. This model is blind
 * to cards whose point is a resource or a tax rather than an effect on
 * something: Sol Ring scores 0.68, Rhystic Study 0.81. That was raised before
 * the model was built and accepted — "sol ring is a lower impact card by this
 * metric, that's fine" — and there is deliberately no fudge factor rescuing
 * named cards, because a correction that exists to fix three cards will be wrong
 * for the fourth.
 *
 * Everything here is derived from `oracleText`, `typeLine` and `manaCost`, all
 * of which the corpus already stores. NOTHING new is derived at ingest and no
 * re-ingest is needed (doc 18 §18.11).
 */

/**
 * Exactly the fields the classifier reads.
 *
 * Narrower than `Card` on purpose: it states in the type what the model looks
 * at, and it lets the baseline generator hand over a database row without
 * inventing the fourteen fields of a `Card` that no part of this touches.
 */
export type ImpactInput = Pick<Card, 'name' | 'manaCost' | 'oracleText' | 'typeLine'>

/** How many things the effect touches. A partition: every card is exactly one. */
export type BreadthTier = 'none' | 'one' | 'few' | 'several' | 'variable' | 'unbounded'

/** How many times the effect happens. */
export type PersistenceTier = 'one-shot' | 'activated' | 'triggered' | 'upkeep'

/** Who is on the wrong end of it. */
export type StakesTier = 'self' | 'own' | 'opposing' | 'player'

/**
 * Whether a mass effect spares the caster.
 *
 * `none` for anything that is not a mass effect, rather than a third symmetry
 * value: "this card is not board-wide" and "this card is board-wide and hits
 * everyone equally" are different claims and a reader must be able to tell them
 * apart.
 */
export type Symmetry = 'none' | 'symmetric' | 'one-sided'

/**
 * The breadth curve (doc 18 §18.3).
 *
 * Two shapes stacked. The counted rungs are `n^1.14` — 1.00, 2.20, 3.51 — so a
 * card hitting two things beats two cards hitting one apiece, because it is one
 * card and one payment. The exponent is the only free parameter and it is very
 * nearly inert: `few` + `several` + `variable` are 367 of 31,782 cards.
 *
 * The step to `unbounded` is the HEIGHT OF THE WHOLE COUNTED LADDER: the ladder
 * spans 3.5 − 1.0 = 2.5, so unbounded sits at 3.5 + 2.5 = 6.0. That is what
 * makes "all" a tier rather than a fourth rung. Rejected: a value nearer 4,
 * which makes unbounded read as "several, but more" and loses the distinction
 * the user asked for — "all x is very high impact, one or two x is lower".
 *
 * `variable` (`X target`) gets the top COUNTED rung, not the unbounded one, and
 * always carries `scales`. X reaches as far as your mana does; "all" reaches as
 * far as the board does and keeps growing. Giving X the unbounded value would
 * put every Fireball above every Wrath.
 */
const BREADTH_VALUE: Readonly<Record<BreadthTier, number>> = {
  none: 0.5,
  one: 1.0,
  few: 2.2,
  several: 3.5,
  variable: 3.5,
  unbounded: 6.0,
}

/**
 * The persistence curve (doc 18 §18.4).
 *
 * Ordered by HOW MUCH OF THE COST RECURS, not by how often the effect fires:
 * all of it (`activated`), none of it but conditional on an event
 * (`triggered`), none of it and nothing to wait for (`upkeep`). That is a
 * property of the text rather than a guess about the game, which is why it is
 * the axis.
 *
 * The ceiling is deliberately low. A permanent that repeats is worth roughly
 * twice a one-shot the way a two-for-one is worth roughly two cards; past that
 * what bounds the effect is the game ending, and this model has no opinion about
 * game length. At 4 or 5 a minor upkeep trigger would outrank a board wipe.
 */
const PERSISTENCE_VALUE: Readonly<Record<PersistenceTier, number>> = {
  'one-shot': 1.0,
  activated: 1.6,
  triggered: 1.9,
  upkeep: 2.2,
}

/**
 * The stakes ladder (doc 18 §18.5).
 *
 * An UNRESTRICTED `target creature` reads as `opposing`, not as a middle tier
 * of its own: the target is chosen by the caster and the caster chooses the
 * opponent's, so scoring Swords to Plowshares below a card that may only hit an
 * opponent's creatures would rank a strictly worse card higher.
 */
const STAKES_VALUE: Readonly<Record<StakesTier, number>> = {
  self: 0.85,
  own: 1.0,
  opposing: 1.2,
  player: 1.4,
}

/**
 * What a mass effect loses for also hitting your board.
 *
 * THE `self` STAKES TIER, REUSED. A symmetric wrath is a wrath that is also
 * pointed at you, and "pointed at you" is already a number in `STAKES_VALUE`.
 * Rejected: a second, independently chosen constant — it would have been one
 * more thing to justify and one more thing to drift out of step.
 *
 * This is how `all creatures` (831 cards, hits your board) and `each opponent`
 * (4,954, spares you) end up scoring differently without the model ever
 * consulting the deck, which the card-intrinsic decision forbids.
 */
const SYMMETRY_DISCOUNT = 0.85

/**
 * The highest score this model can produce: 6.0 × 2.2 × 1.4 = 18.48.
 *
 * DERIVED FROM THE THREE TABLES, never written down as a literal, because a
 * literal is a number that goes stale silently the first time a rung moves. Any
 * renderer that draws a proportion — "6.12 of what?" — needs a denominator, and
 * this is the only one that is a fact about the model rather than an
 * observation about whichever pool happened to be measured.
 *
 * It is REACHABLE, not a theoretical bound: `unbounded` breadth with an
 * `each opponent` clause takes `player` stakes and the `one-sided` symmetry
 * branch, so an upkeep trigger over every opponent scores exactly this. The
 * symmetry discount cannot apply at the maximum for the same reason — a
 * symmetric effect is by definition not the `each opponent` shape — so it is
 * correctly absent from the product.
 *
 * This replaces the "roughly 0–13" this docblock used to claim, which was
 * measured wrong: 93 of 1,448 rows in a real mono-red pool score above 13
 * (ADR-0025). The interface and the model now quote the same number because
 * only one of them owns it.
 */
export const IMPACT_MAX = BREADTH_VALUE.unbounded * PERSISTENCE_VALUE.upkeep * STAKES_VALUE.player

export interface CardImpact {
  /**
   * `breadth × persistence × stakes`, discounted for symmetry. 0 to `IMPACT_MAX`.
   *
   * Exactly 0, and only 0, for a card with no rules text at all. That is not a
   * rounding convenience: the vanilla creatures are what `efficiency.ts`
   * calibrates against, and a measuring stick with a nonzero reading at zero
   * cannot calibrate anything.
   */
  readonly score: number
  readonly breadth: BreadthTier
  readonly persistence: PersistenceTier
  readonly stakes: StakesTier
  readonly symmetry: Symmetry
  /**
   * The effect is a function of a resource, not a constant (2,136 cards).
   *
   * `for each`, `{X}` in the cost, `X target`. Torment of Hailfire's impact is
   * not 8.4, it is 8.4 times whatever X was, and X is not knowable when a column
   * is drawn. A MARKER IS MORE HONEST THAN A NUMBER PRETENDING TO BE ONE —
   * rejected alternatives were guessing an average X (a claim about a game state
   * the ranker cannot see) and excluding these cards (2,136 of them, several the
   * best in the format).
   */
  readonly scales: boolean
  /**
   * The card sacrifices itself somewhere in its text (1,347 cards).
   *
   * Forces `persistence` to `one-shot` whatever the type line says. Viridian
   * Zealot's `{1}{G}, Sacrifice this creature: Destroy target artifact or
   * enchantment` is not a repeating ability, it is a Naturalize with a body, and
   * pricing it as an engine is the largest class of error this model would
   * otherwise make.
   */
  readonly fragile: boolean
}

/** A card that does nothing. Shared, so `cardImpact` allocates nothing for a vanilla. */
const NO_IMPACT: CardImpact = Object.freeze({
  score: 0,
  breadth: 'none',
  persistence: 'one-shot',
  stakes: 'self',
  symmetry: 'none',
  scales: false,
  fragile: false,
})

/**
 * Reminder text, stripped before ANY pattern runs.
 *
 * Not optional and not a nicety. Cyclonic Rift's own reminder text reads
 * `change "target" in its text to "each."` — so an unstripped classifier reads
 * the word `each` off a parenthetical and calls hundreds of cards mass effects.
 * Reminder text is always parenthesised, which is what makes this safe.
 */
const REMINDER = /\([^)]*\)/g

/** Modern templating self-reference, normalised alongside the card's own name. */
const THIS_PERMANENT =
  /\bthis (creature|artifact|enchantment|permanent|land|spell|token|equipment|vehicle|card)\b/gi

/**
 * The card's text with reminder text removed and every self-reference as `~`.
 *
 * Both spellings are normalised because both are in the corpus: cards printed
 * before the 2024 templating change name themselves ("Masticore deals…") and
 * cards after it say "this creature". Fragility is undetectable without this —
 * `Sacrifice this creature` and `Sacrifice Viridian Zealot` are the same rule.
 *
 * The legendary short name is normalised too, because a legend's later lines
 * refer to it without the title: "Tergrid, God of Fright" then "Tergrid".
 */
const normalise = (card: ImpactInput): string => {
  const short = card.name.split(',')[0]?.split(' // ')[0] ?? card.name
  return card.oracleText
    .replace(REMINDER, ' ')
    .split(card.name)
    .join('~')
    .split(short)
    .join('~')
    .replace(THIS_PERMANENT, '~')
    .toLowerCase()
}

const MASS_QUANTIFIED =
  /\b(all|each|every) (other |target )?(creature|permanent|player|opponent|land|artifact|enchantment|nonland|spell|card)/
/**
 * A bare plural with no quantifier at all — "creatures you control gain trample".
 *
 * Craterhoof Behemoth, every anthem, every lord and every Overrun variant are
 * this shape, and the scoped "all / each" signal put all of them in `none`.
 */
const MASS_PLURAL =
  /\b(creatures|permanents|artifacts|enchantments|lands|tokens|opponents) (you control|you don't control|your opponents control|an opponent controls)\b/
const EACH_PLAYER = /\beach (opponent|player)\b|\bopponents\b/
/**
 * A mass creature effect that names no controller — the symmetric ones.
 *
 * The negative lookahead is load-bearing. "Destroy all creatures" hits your own
 * board; "destroy all creatures an opponent controls" does not, and the two must
 * not score the same. Without it every restricted wrath took the symmetry
 * discount it does not deserve — a 15% error on exactly the cards this axis
 * exists to separate.
 */
const ALL_CREATURES =
  /\b(all|each|every) (other )?creatures?\b(?! (you|an opponent|your opponents|target)\b)/
/** Cyclonic Rift's unbounded mode lives in a keyword, not in a sentence. */
const OVERLOAD = /\boverload\b/
const X_TARGET = /\bx target/
const UP_TO_SEVERAL = /up to (three|four|five) target/
const UP_TO_TWO = /up to two target/
const ANY_TARGET = /\bany target\b/
const TARGET = /\btarget\b/

const FOR_EACH = /\bfor each\b/
const COST_X = /\{x\}/i

const INSTANT_OR_SORCERY = /instant|sorcery/
const UPKEEP = /at the beginning of/
const WHENEVER = /\bwhenever\b/
/**
 * An activated ability: a cost, a colon, then an effect, at the start of a line.
 *
 * Bounded at 60 characters before the colon so a sentence containing a colon
 * mid-paragraph cannot masquerade as an ability cost. Costs are short; prose is
 * not.
 */
const ACTIVATED = /(^|\n)[^\n:]{0,60}:\s/
const SACRIFICE_SELF = /sacrifice ~/

const TARGET_PLAYER = /target (player|opponent)/
const OPPOSING =
  /you don't control|an opponent controls|target (creature|permanent|artifact|enchantment|land|planeswalker|spell)/
const YOU_CONTROL = /you control/

/**
 * How much this card does, from its text alone.
 *
 * Pure and total: every card returns a `CardImpact`. Roughly 3 µs per card
 * (31,782 cards in ~90 ms), so callers may compute it per row rather than
 * caching — a cache keyed by oracle id would be a second thing to invalidate
 * when the corpus is re-ingested, for no measurable gain.
 */
export const cardImpact = (card: ImpactInput): CardImpact => {
  if (card.oracleText.trim() === '') return NO_IMPACT

  const text = normalise(card)
  const types = card.typeLine.toLowerCase()

  const quantified = MASS_QUANTIFIED.test(text)
  const plural = MASS_PLURAL.test(text)
  const eachPlayer = EACH_PLAYER.test(text)
  // A mass effect over a plural you control and nothing else: an anthem hits
  // your board only, so it is `own` stakes rather than `opposing`, and it is
  // one-sided rather than symmetric even though it names no opponent.
  const yoursOnly = plural && !quantified && YOU_CONTROL.test(text)

  let breadth: BreadthTier
  if (quantified || plural || OVERLOAD.test(text)) breadth = 'unbounded'
  else if (X_TARGET.test(text)) breadth = 'variable'
  else if (UP_TO_SEVERAL.test(text)) breadth = 'several'
  else if (UP_TO_TWO.test(text)) breadth = 'few'
  else if (TARGET.test(text) || ANY_TARGET.test(text)) breadth = 'one'
  else breadth = 'none'

  const scales = breadth === 'variable' || FOR_EACH.test(text) || COST_X.test(card.manaCost ?? '')

  const fragile = SACRIFICE_SELF.test(text)
  let persistence: PersistenceTier
  if (INSTANT_OR_SORCERY.test(types)) persistence = 'one-shot'
  else if (UPKEEP.test(text)) persistence = 'upkeep'
  else if (WHENEVER.test(text)) persistence = 'triggered'
  else if (ACTIVATED.test(text)) persistence = 'activated'
  else persistence = 'one-shot'
  if (fragile) persistence = 'one-shot'

  let stakes: StakesTier
  if (yoursOnly) stakes = 'own'
  else if (TARGET_PLAYER.test(text) || ANY_TARGET.test(text) || eachPlayer) stakes = 'player'
  else if (breadth === 'unbounded') stakes = 'opposing'
  else if (OPPOSING.test(text)) stakes = 'opposing'
  else if (YOU_CONTROL.test(text)) stakes = 'own'
  else stakes = 'self'

  const symmetry: Symmetry =
    breadth !== 'unbounded'
      ? 'none'
      : ALL_CREATURES.test(text) && !eachPlayer && !yoursOnly
        ? 'symmetric'
        : 'one-sided'

  const raw =
    BREADTH_VALUE[breadth] *
    PERSISTENCE_VALUE[persistence] *
    STAKES_VALUE[stakes] *
    (symmetry === 'symmetric' ? SYMMETRY_DISCOUNT : 1)

  // Rounded to three places so the value is stable across platforms and can be
  // compared for equality in a test. Float multiplication of four constants is
  // otherwise 7.199999999999999 on the wire.
  return {
    score: Math.round(raw * 1000) / 1000,
    breadth,
    persistence,
    stakes,
    symmetry,
    scales,
    fragile,
  }
}
