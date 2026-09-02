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

/**
 * A clause that COUNTS or COMPARES a group rather than affecting it.
 *
 * Removed before breadth is measured, and the reason is Regal Bunnicorn: its
 * whole text is *"power and toughness are each equal to the number of nonland
 * permanents you control"*, which affects nothing at all and scored 6.0 — the
 * same reach as Craterhoof Behemoth, off a two-mana creature. Zanam Djinn's
 * *"as long as blue is the most common color among all permanents"* is a
 * condition on its own stats and scored 7.2, above Wrath of God. Measured, 160
 * commander-legal cards took an unbounded reach out of a clause that only
 * counted.
 *
 * MEASURING HEADS, NOT THE PREPOSITION. The rule is a short explicit list of
 * phrases that introduce a measurement — `the number of`, `most common … among`,
 * `mana value among`, `for each kind/type/different` — and never `among` on its
 * own. "Deals X damage divided as you choose among X targets" is a targeting
 * clause wearing the same preposition, and a bare `among` rule silently turned
 * every such spell into a card that reaches nothing.
 *
 * A MATCH STOPS AT THE MEASURED NOUN, NOT AT THE END OF THE CLAUSE, and that
 * bound was bought with a regression. Running to the clause end also swallowed
 * whatever came AFTER the count, which on a damage card is the whole effect:
 * Hallar's *"deals damage equal to the number of +1/+1 counters on it **to each
 * opponent**"* lost its "each opponent" and fell from 15.96 to 0.808, as did
 * Armageddon Clock and Dáin of the Ancient Halls. So the head is followed by at
 * most three intervening words, then the group noun it counts, then an optional
 * controller phrase — and the run refuses to cross `to`, `and`, `or`, `each`,
 * `all` or `every`, because each of those begins something the count is not.
 *
 * That bound is also what makes it safe on a card carrying BOTH shapes:
 * Craterhoof says "creatures you control gain trample … where X is the number of
 * creatures you control", and only the second half is a count.
 */
const MEASURING_HEAD = [
  String.raw`(?:the |a )?(?:number|amount|greatest|highest|lowest|total) (?:of|among)`,
  String.raw`most common [a-z]+ among`,
  String.raw`(?:colors?|card types?|mana values?|kinds?) among`,
  String.raw`for each (?:card type|kind|type|different)(?: of| among)?`,
].join('|')

/** The group nouns a count can be taken over. */
const COUNTED_NOUN =
  '(?:creatures?|permanents?|artifacts?|enchantments?|lands?|planeswalkers?|tokens?|cards?|counters?|players?|opponents?|spells?|colors?)'

const MEASURED = new RegExp(
  `\\b(?:${MEASURING_HEAD}) (?:all |each |every |the )?` +
    `(?:(?!to |and |or |each |all |every )[a-z0-9+/'-]+ ){0,3}?${COUNTED_NOUN}\\b` +
    String.raw`(?: (?:you|they) controls?| (?:your opponents|an opponent) controls?| you own)?`,
  'g',
)

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
/**
 * The effect reaches PEOPLE, not their board.
 *
 * `(?! control)` separates the two things the bare word `opponents` does. "Each
 * opponent loses 3 life" is aimed at a person; "creatures your opponents
 * control get -1/-1" is aimed at a board, and the possessive is doing nothing
 * but naming whose. Without the exclusion Doomwake Giant, Bolg and 46 other
 * one-sided anthems were priced at `player` stakes — Bolg reached 18.48, the
 * exact ceiling of the model, for shrinking the opposing team by one.
 *
 * The defect predates this pass and was invisible: `yoursOnly` used to claim
 * these cards first and hand them `own`, which was also wrong but in the other
 * direction. Fixing the scope test is what exposed it.
 */
const EACH_PLAYER = /\beach (opponent|player)\b|\bopponents\b(?! control)/
/**
 * A mass effect on the battlefield that names no controller — the symmetric ones.
 *
 * The first negative lookahead is load-bearing. "Destroy all creatures" hits
 * your own board; "destroy all creatures an opponent controls" does not, and the
 * two must not score the same. Without it every restricted wrath took the
 * symmetry discount it does not deserve — a 15% error on exactly the cards this
 * axis exists to separate.
 *
 * IT IS NOT ONLY CREATURES, and that was the defect. This looked for
 * `all creatures` alone, so `Destroy all artifacts, creatures, and enchantments`
 * — where `all` is followed by `artifacts` — never matched, and Nevinyrral's
 * Disk, Jokulhaups, Akroma's Vengeance and 117 other wipes were reported as
 * one-sided: the pane told a builder the Disk spares their board. A wipe that
 * names a coordinated LIST of types is the same card as a wipe that names one.
 *
 * `card`/`cards` is excluded for the opposite reason: "all land cards from your
 * graveyard" is a ZONE, not a board. Splendid Reclamation returns your own
 * lands and takes nothing from anybody, and without that exclusion every
 * graveyard recursion spell joined the wrath population and lost 15% for
 * hitting a board it never touches.
 *
 * `(?=(…))\1` IS AN ATOMIC GROUP, and it is the whole reason this works. The
 * restriction on a coordinated list sits after the LAST noun — "destroy all
 * artifacts, creatures, and enchantments you don't control" — so an ordinary
 * greedy list would simply backtrack to "artifacts, creatures", find a comma
 * instead of a controller, and match anyway. Capturing the list inside a
 * lookahead and replaying it with a backreference consumes it in one bite that
 * cannot be given back, so the negative lookahead is always asked about the end
 * of the whole list. JavaScript has no `(?>…)`; this is the standard stand-in.
 */
const MASS_UNRESTRICTED =
  /\b(?:all|each|every) (?:other )?(?:nonland |non-land |noncreature |non-creature )?(?=((?:creature|permanent|artifact|enchantment|land|planeswalker)s?(?:,? (?:and |or )?(?:creature|permanent|artifact|enchantment|land|planeswalker)s?)*))\1\b(?! (?:you|an opponent|your opponents|target|card|cards)\b)/
/**
 * The text puts somebody else's side of the board in scope.
 *
 * What stops a mass effect scoped entirely to the caster — Craterhoof, an
 * anthem, Agatha's Soul Cauldron — being read as an attack on an opponent.
 */
const NAMES_OPPOSING_SIDE =
  /you don't control|an opponent controls|your opponents control|\bopponents?\b|\ball players\b|\beach player\b/
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
/**
 * The effect lands on somebody else's side.
 *
 * THE LOOKAHEAD IS THE FIX. An unrestricted `target creature` reads as
 * `opposing` on purpose (doc 18 §18.5) — the caster picks the target and picks
 * the opponent's. But this pattern matched the bare `target creature` INSIDE
 * `target creature you control` and returned before the `you control` branch
 * was ever reached, so 1,070 commander-legal cards were reported as hitting an
 * opponent's board while exiling, untapping or pumping the caster's own
 * creature. Emiel the Blessed blinks your own Unicorn; Embercleave attaches to
 * your own attacker.
 *
 * The window is bounded and stops at clause punctuation, so it reads the
 * restriction on THIS target and cannot borrow one from the next sentence.
 * "Exile target creature. You control the game" would still be `opposing`, and
 * a card that hits one of each — "target creature you control fights target
 * creature an opponent controls" — still matches on the unrestricted half.
 */
const OPPOSING =
  /you don't control|an opponent controls|target (?:creature|permanent|artifact|enchantment|land|planeswalker|spell)s?\b(?![^.,;:\n]{0,24} you control)/
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
  /*
   * A card whose text was ENTIRELY reminder text has no rules text either.
   *
   * The check above runs on the raw string, so a basic Forest — whose whole
   * printed text is the parenthetical `({T}: Add {G}.)` — walked past it and
   * took the `none` floor, 0.425. doc 18 §18.10 item 6 already established that
   * reminder text is stripped before anything is matched; the emptiness test
   * was simply asked before the strip rather than after. 22 commander-legal
   * cards are affected: every basic, every original dual, Icehide Golem and
   * Dryad Arbor. Both checks are kept because the first is the cheap one and
   * covers the 339 genuinely textless creatures without normalising at all.
   */
  if (text.trim() === '') return NO_IMPACT

  const types = card.typeLine.toLowerCase()
  /*
   * The text with every COUNTING clause removed — what the effect touches,
   * rather than every plural the sentence mentions. See `MEASURED`. Only the
   * scope questions read this; persistence, fragility and `scales` are facts
   * about the whole card and still read the full text.
   */
  const effect = text.replace(MEASURED, ' ')

  const quantified = MASS_QUANTIFIED.test(effect)
  const plural = MASS_PLURAL.test(effect)
  const eachPlayer = EACH_PLAYER.test(effect)
  const unrestrictedMass = MASS_UNRESTRICTED.test(effect)
  /*
   * A mass effect whose whole scope is the caster's own side.
   *
   * An anthem hits your board only, so it is `own` stakes rather than
   * `opposing`, and it is one-sided rather than symmetric even though it names
   * no opponent.
   *
   * IT NO LONGER REQUIRES THE PLURAL TO BE UNQUANTIFIED. That restriction is
   * what sent Agatha's Soul Cauldron to an opponent: it says "creatures you
   * control" three times and names an opponent nowhere, but one of those
   * clauses carries `all`, so `quantified` was true, `yoursOnly` was false, and
   * the `breadth === 'unbounded'` branch below claimed it before `you control`
   * was ever consulted. 935 cards were reported as attacking a board they
   * cannot touch.
   *
   * `unrestrictedMass` is what bounds it, and it has to: a wrath may mention
   * "you control" in a rider and still destroy everything, so an unrestricted
   * mass effect overrides the scope test rather than losing to it.
   */
  const yoursOnly =
    (plural || quantified) &&
    !unrestrictedMass &&
    !eachPlayer &&
    YOU_CONTROL.test(effect) &&
    !NAMES_OPPOSING_SIDE.test(effect)

  let breadth: BreadthTier
  if (quantified || plural || OVERLOAD.test(effect)) breadth = 'unbounded'
  else if (X_TARGET.test(effect)) breadth = 'variable'
  else if (UP_TO_SEVERAL.test(effect)) breadth = 'several'
  else if (UP_TO_TWO.test(effect)) breadth = 'few'
  else if (TARGET.test(effect) || ANY_TARGET.test(effect)) breadth = 'one'
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
  else if (TARGET_PLAYER.test(effect) || ANY_TARGET.test(effect) || eachPlayer) stakes = 'player'
  else if (breadth === 'unbounded') stakes = 'opposing'
  else if (OPPOSING.test(effect)) stakes = 'opposing'
  else if (YOU_CONTROL.test(effect)) stakes = 'own'
  else stakes = 'self'

  const symmetry: Symmetry =
    breadth !== 'unbounded'
      ? 'none'
      : unrestrictedMass && !eachPlayer && !yoursOnly
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
