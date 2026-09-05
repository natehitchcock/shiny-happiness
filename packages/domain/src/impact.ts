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
 * MANA AND TAXES ARE NO LONGER BLIND SPOTS (ADR-0066). This model used to be
 * blind to cards whose point is a resource or a tax rather than an effect on
 * something — Sol Ring scored 0.68 and Rhystic Study 0.808, and that was
 * accepted rather than patched. Both are now rules rather than exceptions: a
 * clause that produces mana scores 1.0 per mana it produces, and a clause that
 * taxes what other people pay reads as the standing, board-wide effect it is.
 * There is still deliberately no fudge factor rescuing named cards, because a
 * correction that exists to fix three cards will be wrong for the fourth —
 * `manaProduced` and the tax patterns name no card and were measured over the
 * whole corpus.
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

/**
 * Who is on the wrong end of it (ADR-0066).
 *
 * FIVE TIERS CHOSEN BY MAXIMUM, not a first-match cascade. The question the
 * axis asks is "what is the best thing this clause could land on", so a clause
 * that may hit either side takes the better of the two rather than whichever
 * pattern happened to be tested first. `any target` reaches a player, so it is
 * `opposing-player`, and it no longer matters that the unbounded rule sits
 * above the targeting rule in the source.
 *
 * `nothing` is a DISTINCT FLOOR rather than a merge into `owning-player`, and
 * that is the decision the bottom of the ladder turns on: a clause that drains
 * you for 3 lands on a person and a clause that taps for mana lands on nobody,
 * and pricing them identically was the defect. It keeps the old `self` value of
 * 0.85 exactly, so the corpus floor does not move by this change alone.
 */
export type StakesTier =
  | 'nothing'
  | 'owning-player'
  | 'owned-permanent'
  | 'opposing-permanent'
  | 'opposing-player'

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
 * How hard the clause hits what it touches (doc 18 §18.17, ADR-0055).
 *
 * `none` IS NOT A RUNG. It is the absence of the ladder — the clause removes
 * nothing — and it is worth exactly 1.0, so every card that does not remove
 * anything is multiplied by one and left alone. That is what stops the axis
 * turning a bounce spell into a worse card than a cantrip.
 *
 * The rungs group by WHAT HAPPENS TO THE OBJECT, never by how good the object
 * was or who chose it:
 *
 * | rung | also | why |
 * | --- | --- | --- |
 * | `tap` | freeze | it is a delay; the permanent never leaves |
 * | `flicker` | blink | it leaves and comes straight back |
 * | `bounce` | to hand | it leaves and must be paid for again |
 * | `damage` | −X/−X | it dies only sometimes (ADR-0029's slope) |
 * | `destroy` | counter, edict | it ends in the graveyard |
 * | `exile` | tuck, steal | it does not come back |
 */
export type SeverityTier = 'none' | 'tap' | 'flicker' | 'bounce' | 'damage' | 'destroy' | 'exile'

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
 * The stakes ladder (doc 18 §18.5, ADR-0066).
 *
 * An UNRESTRICTED `target creature` reads as `opposing-permanent`, not as a
 * middle tier of its own: the target is chosen by the caster and the caster
 * chooses the opponent's, so scoring Swords to Plowshares below a card that may
 * only hit an opponent's creatures would rank a strictly worse card higher.
 *
 * A PERSON OUTRANKS THEIR BOARD on both sides of the ladder, because a board is
 * replaceable and a life total is the game. The two middle rungs are the same
 * distance apart as the two outer ones are from them, so the ladder reads as
 * "whose, then which of theirs" rather than as four unrelated constants.
 */
const STAKES_VALUE: Readonly<Record<StakesTier, number>> = {
  nothing: 0.85,
  'owning-player': 0.9,
  'owned-permanent': 1.0,
  'opposing-permanent': 1.2,
  'opposing-player': 1.4,
}

/**
 * What a mass effect loses for also hitting your board.
 *
 * THE `nothing` STAKES TIER, REUSED. A symmetric wrath is a wrath that is also
 * pointed at you, and the bottom of `STAKES_VALUE` is already that number.
 * Rejected: a second, independently chosen constant — it would have been one
 * more thing to justify and one more thing to drift out of step.
 *
 * This is how `all creatures` (831 cards, hits your board) and `each opponent`
 * (4,954, spares you) end up scoring differently without the model ever
 * consulting the deck, which the card-intrinsic decision forbids.
 */
const SYMMETRY_DISCOUNT = 0.85

/**
 * The severity ladder (doc 18 §18.17).
 *
 * NEUTRAL SITS AT `destroy`, and that is the decision the whole axis turns on.
 * Rejected: neutral at the top, `exile` = 1.0 with everything else a penalty,
 * which prices every removal spell below every cantrip. Rejected: neutral at
 * the bottom, `flicker` = 1.0 with everything else a bonus, which is a thumb on
 * the scale for removal and inflates the largest class in the corpus. Destroy
 * is chosen for two measured reasons: it is the biggest unambiguous removal
 * class (1,523 commander-legal cards, against exile's 636 and bounce's 522), so
 * anchoring there moves the fewest cards; and Wrath of God, an anchor quoted in
 * doc 18 and three ADRs, is a destroy and therefore holds at 6.12 for free.
 *
 * THE FLOOR IS ABOVE 0.5, AND THAT BOUND IS LOAD-BEARING. A removal clause
 * always has at least `one` breadth (1.0) because it points at something, while
 * a clause that affects nothing takes `none` (0.5). So as long as the weakest
 * rung exceeds 0.5, tapping a creature can never score below gaining three
 * life, and the multiplier cannot invert the two populations. `tap` is 0.6.
 *
 * DAMAGE IS PLACED FROM ADR-0029'S MEASUREMENT, not from feel, and that ADR's
 * ruling is respected rather than reopened: it rejected a toughness threshold
 * because the kill rate is a SLOPE — 1 damage kills 21.6% of the 17,514
 * creatures with printed toughness, 2 kills 46.7%, 3 kills 69.6%, 4 kills
 * 85.7%, 10 kills 99.8%. A slope forbids a boundary, which is exactly why
 * damage gets ONE rung rather than a family of them. Where that rung sits is
 * then a corpus question: printed damage amounts have a median of 2 and a mean
 * of 2.71 across 2,188 clauses, which lands between the 46.7% and 69.6% rows.
 * 0.8 is that band rounded up, because damage that fails to kill still shrinks
 * a blocker or goes to a face, and 754 cards deal an amount that is not a
 * constant at all.
 */
const SEVERITY_VALUE: Readonly<Record<SeverityTier, number>> = {
  none: 1.0,
  tap: 0.6,
  flicker: 0.7,
  bounce: 0.75,
  damage: 0.8,
  destroy: 1.0,
  exile: 1.2,
}

/**
 * The highest score this model can produce: 6.0 × 2.2 × 1.4 × 1.2 = 22.176.
 *
 * DERIVED FROM THE THREE TABLES, never written down as a literal, because a
 * literal is a number that goes stale silently the first time a rung moves. Any
 * renderer that draws a proportion — "6.12 of what?" — needs a denominator, and
 * this is the only one that is a fact about the model rather than an
 * observation about whichever pool happened to be measured.
 *
 * It is REACHABLE, not a theoretical bound: `unbounded` breadth with an
 * `each opponent` clause takes `opposing-player` stakes and the `one-sided`
 * symmetry branch, so an upkeep trigger over every opponent scores this. The
 * symmetry discount cannot apply at the maximum for the same reason — a
 * symmetric effect is by definition not the `each opponent` shape — so it is
 * correctly absent from the product.
 *
 * This replaces the "roughly 0–13" this docblock used to claim, which was
 * measured wrong: 93 of 1,448 rows in a real mono-red pool score above 13
 * (ADR-0025). The interface and the model now quote the same number because
 * only one of them owns it.
 */
export const IMPACT_MAX =
  BREADTH_VALUE.unbounded *
  PERSISTENCE_VALUE.upkeep *
  STAKES_VALUE['opposing-player'] *
  SEVERITY_VALUE.exile

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
   * How hard the winning clause hits what it touches (doc 18 §18.17).
   *
   * `none` for a clause that removes nothing, which is most of the corpus, and
   * it is worth 1.0 rather than 0 — the absence of the ladder, not a rung on
   * it. Per-clause like every other tier, so a card whose removal clause loses
   * to a drawback clause does not report the removal's severity.
   */
  readonly severity: SeverityTier
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
  stakes: 'nothing',
  symmetry: 'none',
  severity: 'none',
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

/**
 * A `for each <thing>` RIDER on a spell grant — scaling, not a second effect.
 *
 * Applied only inside a clause `SPELL_GRANT` already matched, and that
 * restriction is the whole point. Locket of Yesterdays reads "spells you cast
 * cost {1} less to cast FOR EACH CARD with the same name as that spell in your
 * graveyard": the subject of the clause is a serial class of spells, and the
 * trailing `for each` says how big the discount is, not that the clause reaches
 * a board. `MASS_QUANTIFIED` saw the bare `each card` and called it unbounded,
 * so the card scored 7.2 — and once the grant correctly read as `triggered`,
 * that false reach was multiplied to 13.68 rather than replaced. Six cards
 * carry both shapes: Locket of Yesterdays, The Kenriths' Royal Funeral, Temur
 * Battlecrier, Hamza, Guardian of Arashin, Heliod and Saheeli, Filigree Master.
 *
 * NOT APPLIED CORPUS-WIDE, though the same gap exists there. `MEASURING_HEAD`
 * admits `for each card type` but not plain `for each creature you control`, so
 * roughly two thousand cards take an unbounded reach from a clause that only
 * counts — Storm Entity, a one-mana 1/1 whose whole text is "enters with a
 * +1/+1 counter on it for each other spell cast this turn", scores 7.2, above
 * Wrath of God. Widening the head list was measured and MOVED 2,377 CARDS with
 * genuine false negatives among them: `for each opponent` is not a measurement
 * but a distributive effect landing on people, and Smuggler's Share fell from
 * 18.48 to 0.935 — the Hallar regression recorded above, on a different noun.
 * That is its own pass with its own counter-example hunt, and it is not this
 * one.
 *
 * PEOPLE ARE EXCLUDED BY THE NOUN LIST, not by a second guard. `COUNTED_OBJECT_NOUN`
 * is `COUNTED_NOUN` without `players?` and `opponents?`, so "for each opponent"
 * cannot match at all — a count over OBJECTS is a measurement, a run over
 * PEOPLE is reach. An earlier draft also excluded the two words from the
 * intervening-word lookahead; a mutation survived it, the corpus was checked,
 * and no clause carries both a spell grant and a `for each opponent` rider, so
 * the second guard was redundant and is gone rather than untestable.
 */
const COUNTED_OBJECT_NOUN =
  '(?:creatures?|permanents?|artifacts?|enchantments?|lands?|planeswalkers?|tokens?|cards?|counters?|spells?|colors?)'

const SPELL_GRANT_RIDER = new RegExp(
  String.raw`\bfor each (?:other |all |the )?` +
    `(?:(?!to |and |or |each |all |every )[a-z0-9+/'-]+ ){0,3}?${COUNTED_OBJECT_NOUN}\\b` +
    String.raw`(?: (?:you|they) controls?| (?:your opponents|an opponent) controls?| you own)?`,
  'g',
)

/**
 * A class of spells YOU CAST — serial, not simultaneous. Removed before breadth.
 *
 * `MASS_QUANTIFIED` lists `spell` among the nouns a mass quantifier may take,
 * and for `counter all other spells` that is right: those spells are on the
 * stack together, one effect touches all of them, and the reach is real. It is
 * wrong for `each spell you cast`, where the spells arrive ONE AT A TIME across
 * the whole game and no effect ever touches two of them.
 *
 * A serial class is the persistence axis, never the breadth axis — see
 * `SPELL_GRANT`. This is the same removal `MEASURED` performs for a clause that
 * counts rather than affects, for the same reason: the sentence mentions a
 * group the effect does not reach all of.
 *
 * The cost of not having it, measured: Threefold Signal — "each spell you cast
 * that's exactly three colors has replicate {3}" — took `unbounded` breadth,
 * fell through the stakes ladder to `opposing` and scored 7.2, which is
 * Cyclonic Rift's number, on a card that cannot touch an opponent at all.
 * Goblin Anarchomancer, a two-mana 2/2 that makes your red and green spells
 * cost {1} less, scored the same 7.2. Five commander-legal cards say this.
 *
 * IT REQUIRES `you cast`, and that bound is the whole safety of it. Damping
 * Sphere's "each spell a player casts costs {1} more" and Trinisphere's "each
 * spell that would cost less than three mana" really do apply to everybody and
 * keep their unbounded reach, as does "counter all other spells".
 *
 * The intervening words are for the TYPE-QUALIFIED spelling. Herigast,
 * Erupting Nullkite says "each CREATURE spell you cast has emerge" and Henzie
 * "Toolbox" Torre says "each creature spell you cast with mana value 4 or
 * greater has blitz"; without the gap both kept an unbounded reach off a class
 * that arrives one spell at a time, and the new `triggered` reading multiplied
 * it rather than replacing it.
 */
const SERIAL_SPELL_CLASS =
  /\b(?:all|each|every) (?:other )?(?:[a-z]+ ){0,3}?spells? you(?:'ve| have)? cast\b/g

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
/**
 * Overload — a COST on the card's own effect, not an ability of its own.
 *
 * It is card-level for the same reason `fragile` is: the keyword changes how
 * the card's existing sentence targets, so it belongs to the card rather than
 * to a line. Read as a clause it was a phantom — `overload {6}{u}` carries no
 * effect at all, yet it took `unbounded` breadth, won its card under ADR-0043's
 * winning-clause rule, and reported a tuple describing nothing.
 *
 * Measured: 27 of the 28 overload cards scored an IDENTICAL 7.2 with severity
 * `none`, because the phantom beat every real clause. Cyclonic Rift, Vandalblast,
 * Mizzium Mortars and Counterflux do four completely different things and the
 * model could not tell them apart. Promoting the card's real clauses to
 * `unbounded` and dropping the bare keyword line reads the effect instead.
 */
const OVERLOAD = /\boverload\b/
/** The bare keyword line, which is a cost and not an effect. */
const OVERLOAD_LINE = /^overload\b/
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
 * `when` IS A TRIGGER WORD, and its absence was the model's largest blind spot
 * (ADR-0066).
 *
 * *"When ~ enters, draw a card"* says `when`, not `whenever`, and it is exactly
 * as much a triggered ability. It matched neither `WHENEVER` nor `UPKEEP`, fell
 * past the activated test and landed on `one-shot`: 5,289 commander-legal
 * permanents — 16.6% of the corpus — were priced as though their ability
 * happened once. Accursed Marauder went 8.4 → 15.96 and Priest of Gix 0.425 →
 * 0.808 on this rule alone.
 *
 * `\bwhen\b` DOES NOT MATCH `whenever` — there is no word boundary after the
 * fourth letter — so the two tests stay independent and `WHENEVER` keeps its
 * own place in the ladder above the activated rung.
 *
 * BARE RATHER THAN ANCHORED, and that was measured rather than assumed. Magic
 * templates a triggered ability at the START of its ability, so `^(when|
 * whenever|at)\b` is the obvious candidate and it is wrong: it promotes 5,022
 * cards against the bare rule's 5,289, and every one of the 292 clauses in the
 * difference is a genuine trigger the anchor cannot see. They were read, all of
 * them, and they are 197 ability-word prefixes (*"corrupted — when ~ enters"*,
 * *"revolt — when ~ enters"*, *"metalcraft — when ~ enters"*), 33 triggers
 * granted inside quotation marks (*"all slivers have \"when ~ enters …\""*), 30
 * reflexive *"when you do"* triggers hung off an exert or a sacrifice, 20 Saga
 * chapters, and 12 delayed triggers following a replacement effect. Not one is
 * prose. The anchor's own unique catch is 15 clauses reading *"at end of
 * combat"*, which this pass deliberately leaves unclaimed — see ADR-0066.
 *
 * ITS PLACE IN THE LADDER IS BELOW `activated`, AND THAT IS THE WHOLE SAFETY OF
 * IT. 86 clauses are an activated ability whose EFFECT contains a delayed or
 * granted trigger — Havengul Lich's *"{1}: you may cast target creature card in
 * a graveyard this turn. when you cast it this turn, …"*. The cost recurs on
 * every one of them, so `activated` is the correct reading by this axis's own
 * ordering, and testing `when` above the colon rule would have promoted all 86
 * to a rung that says no cost recurs. Ordering it below removes the entire
 * false-positive population; there is no other one.
 */
const WHEN = /\bwhen\b/

/**
 * A TAX: a standing modification to what other people's spells or abilities
 * cost (ADR-0066).
 *
 * *"Taxes are Phase-triggered, every target, so they should be rated pretty
 * high."* A static tax names no trigger word at all, so it fell to `one-shot`,
 * and it names no group the breadth rules count, so it fell to `none` — 0.425,
 * the model floor, for Sphere of Resistance and for Thalia. The rule gives a
 * tax clause `upkeep` persistence and `unbounded` breadth; stakes falls out of
 * the ladder normally.
 *
 * THE BOUNDARY IS WHOSE SPELLS, and getting it wrong in the permissive
 * direction turns every cost-reducer into a Sphere of Resistance. *"Spells you
 * cast cost {1} less"* is a cost modification too, and it is already the
 * Quandrix `SPELL_GRANT` case at `triggered`. `TAX_IS_YOURS` excludes it. What
 * is left is what OTHER people, or everybody, pay.
 *
 * Three shapes, all read off the corpus rather than imagined: an increase
 * (*"spells cost {1} more to cast"*), Trinisphere's floor (*"each spell that
 * would cost less than three mana to cast costs three mana to cast"*), and the
 * Rhystic clause, where the tax is optional and the payment is the whole point
 * (*"unless that player pays {1}"*).
 *
 * TRINISPHERE'S `instead` IS REMINDER TEXT and this rule never sees it. The
 * printed sentence ends at "costs three mana to cast"; the *"costs {2}{B} to
 * cast instead"* a reader remembers is inside the parentheses `REMINDER` strips
 * before any pattern runs. Requiring the word matched nothing at all.
 *
 * `TAX_UNLESS` IS ANCHORED ON THE STANDING TRIGGER, AND THAT IS THE WHOLE
 * SAFETY OF IT. A bare *"unless its controller pays"* is not a tax rule at all
 * — it is the templating of a SOFT COUNTERSPELL, and it caught 143 cards of
 * which the great majority were Daze, Censor, Syncopate, Mystical Dispute, Rune
 * Snag and every other *"counter target spell unless its controller pays {2}"*
 * in the format. A soft counterspell answers ONE spell that is already on the
 * stack. Priced as a tax it would have taken `unbounded` breadth and scored 7.2
 * against hard Counterspell's 1.2, which is the single worst reading this pass
 * could have produced. Requiring `whenever a player/an opponent casts` keeps
 * only the standing ones — Rhystic Study, Esper Sentinel, Nether Void, Aether
 * Barrier, Spelltithe Enforcer, Isolation Cell, Soul Barrier, In the Eye of
 * Chaos — which are taxes in exactly the sense the increase branch is.
 *
 * Two more exclusions, both bought with a card that was in the population and
 * should not have been:
 *
 *   - A TAX IS A STATIC ABILITY, NEVER AN ACTIVATED ONE. Mavinda, Students'
 *     Advocate charges {8} more for a spell YOU recast, and Loreseeker's Stone
 *     charges {1} more to activate its OWN ability. Both are a cost the card
 *     puts on itself, and both sit behind a colon, so `ACTIVATED` separates
 *     them from every genuine tax at no cost — not one is an activated ability.
 *   - A TEMPORARY TAX IS NOT A STANDING ONE, which is the exclusion
 *     `SPELL_GRANT` already makes for the same reason. Elspeth Conquers Death's
 *     chapter ii, Tax Collector and Academy Loremaster all tax for a turn, and
 *     `upkeep` means there is nothing to wait for and no cost that recurs.
 *   - `this way` NAMES ONE CARD, NOT A CLASS. Elite Spellbinder, Lightstall
 *     Inquisitor, Invasion of Gobakhan and Soul Partition exile a single card
 *     and charge {2} more for THAT card — *"a spell cast by an opponent this
 *     way costs {2} more to cast"*. The phrase points back at the one card the
 *     clause just exiled, so the effect reaches one card and not a board, and
 *     admitting it would have given a three-mana 3/1 an unbounded reach.
 *
 * Propaganda taxes an ATTACK and Smothering Tithe taxes a DRAW. Both are real
 * cards doing a real thing and neither modifies what a spell or an ability
 * costs, so neither is admitted. Excluding them is the conservative direction on
 * purpose: every card wrongly admitted here becomes a Sphere of Resistance.
 */
const TAX_INCREASE =
  /\b(?:spells?|abilit(?:y|ies))\b[^.\n]{0,60}?\bcosts? (?:\{[^}\n]{1,6}\}|one|two|three|four|[0-9]+)[^.\n]{0,24}?\bmore\b/
const TAX_FLOOR =
  /\bwould cost less than [^.\n]{0,40}?\bto (?:cast|activate)\b[^.\n]{0,30}?\bcosts?\b/
const TAX_UNLESS =
  /\bwhenever (?:a|an|each) (?:player|opponent)\b[^.\n]{0,60}?\bcasts?\b[^.\n]{0,140}?\bunless\b[^.\n]{0,50}?\bpays?\b/
/** Your own spells are a grant, not a tax — the Quandrix case, already handled. */
const TAX_IS_YOURS = /\bspells? you cast\b|\byour spells?\b/
/** A tax that lasts a turn is not standing. The `SPELL_GRANT` exclusion, reused. */
const TAX_IS_TEMPORARY = /\bthis turn\b|\buntil (?:your|end of|the end of)\b/
/** A cost charged to one exiled card, not to a class of spells. See above. */
const TAX_IS_ONE_CARD = /\bthis way\b/

/**
 * How much mana this clause puts in your pool, or 0 if it produces none
 * (ADR-0066).
 *
 * The model was blind to cards whose point is mana: Sol Ring scored 0.68
 * against a corpus median of 0.95 and the docblock accepted it openly. A clause
 * that produces mana scores 1.0 PER MANA PRODUCED — Sol Ring 2.0, Arcane Signet
 * 1.0, Dark Ritual 3.0 — and that number is the CLAUSE's score, competing under
 * ADR-0043's winning-clause rule like any other line rather than being added to
 * the product. A card whose removal clause scores higher still reports the
 * removal clause and its own tuple.
 *
 * GROSS, NOT NET, and the alternative was considered rather than overlooked.
 * *"{1}, {T}: Add {G}{G}"* nets one mana and produces two, and this scores the
 * two. Net is the better measure of a mana base — it is what `fixing.ts` uses,
 * deliberately, for exactly that job — but impact is a property of the card and
 * not of a turn, and the netting question has no answer for the large class of
 * rituals and triggers whose cost is not a mana cost at all: Dark Ritual's
 * {B} is the card's own casting cost, not an activation cost, and subtracting
 * it would price a ritual by the arbitrage rather than by what it does.
 * `fixing.ts` nets because it is ranking mana bases against each other; this
 * does not, because it is describing one card.
 *
 * `fixing.ts`'s private `addedMana` reads the same three phrasings and was NOT
 * reused. Its word form is a bare `add (one|two|…)`, which is safe there
 * because it only ever runs on a land's mana ability, and unsafe here because
 * corpus-wide it would read *"add two +1/+1 counters"* as two mana. This asks
 * for the word `mana` or a mana symbol before it will count anything.
 */
const WORD_MANA: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
}
const MANA_SYMBOL = String.raw`\{[wubrgcxs0-9/]{1,5}\}`
/** `add` reaching a mana symbol or the word `mana` — never `add two counters`. */
const ADDS_MANA = new RegExp(String.raw`\badds?\b(?=[^.;:\n]{0,40}?(?:${MANA_SYMBOL}|\bmana\b))`)
const ADD_WORD = /\badds?\s+(?:up to\s+)?(one|two|three|four|five|six|seven)\b/
const ADD_X = /\badds?\s+x\b/
const MANA_RUN = new RegExp(`(?:${MANA_SYMBOL})+`, 'g')
/**
 * Ramp that finds a land rather than adding mana — Rampant Growth's shape.
 *
 * A land put onto the battlefield is a mana source, and the user's own worked
 * example prices it at one: Rampant Growth 1.0. Counted as ONE, always, even
 * where the clause lands two (Skyshroud Claim, Explosive Vegetation) — how many
 * lands a multi-land tutor actually lands is a second measurement this pass did
 * not make, and undercounting by one is the honest way to be wrong about it.
 */
const RAMP_TO_BATTLEFIELD =
  /\bsearch(?:es)? (?:your|their) library for [^.\n]{0,80}?\blands?\b[^.\n]{0,80}?\bonto the battlefield\b/

const manaProduced = (clause: string): number => {
  if (RAMP_TO_BATTLEFIELD.test(clause)) return 1
  if (!ADDS_MANA.test(clause)) return 0
  const tail = clause.slice(clause.search(/\badds?\b/))
  const word = ADD_WORD.exec(tail)
  if (word !== null) return WORD_MANA[word[1] ?? ''] ?? 1
  if (ADD_X.test(tail)) return 1
  const runs = tail.match(MANA_RUN)
  // A choice between runs — "Add {W}{W}, {W}{U}, or {U}{U}" — gives you one run,
  // so the run length is the amount and counting every symbol would read a
  // filter land as producing six. `fixing.ts` reaches the same conclusion.
  if (runs === null) return 1
  return Math.max(...runs.map((run) => (run.match(/\{/g) ?? []).length))
}
/**
 * An activated ability: a cost, a colon, then an effect, at the start of a line.
 *
 * Bounded at 60 characters before the colon so a sentence containing a colon
 * mid-paragraph cannot masquerade as an ability cost. Costs are short; prose is
 * not.
 */
const ACTIVATED = /(^|\n)[^\n:]{0,60}:\s/
const SACRIFICE_SELF = /sacrifice ~/

/**
 * A STANDING modification to a class of your future spells — the Quandrix rule.
 *
 * The report: *"Quandrix the Proof gives spells cascade, shouldn't that mean
 * that his reach is every spell cast? Or he repeats every spell cast?"* It is
 * the second one, and the measurement that decided it is Teval, Arbiter of
 * Virtue, which carries BOTH spellings — the static "Spells you cast have
 * delve" and the triggered "Whenever you cast a spell, you lose life equal to
 * its mana value". Teval already scored `none/triggered/self`, off the second
 * clause alone. Breadth and stakes agreed between the two forms; PERSISTENCE
 * was the only axis that differed, and only because the static spelling never
 * says `whenever` so the ladder fell through to `one-shot`.
 *
 * The ordering that proved it broken: Yidris, Maelstrom Wielder grants cascade
 * only after connecting in combat and only for that turn, and scored 0.808.
 * Quandrix grants it unconditionally, forever, and scored 0.425 — the floor,
 * the same number as a creature whose only text is a keyword. 251
 * commander-legal permanents carry a grant of this shape.
 *
 * `triggered` and not `upkeep`, because there IS something to wait for: you
 * must cast a spell. That also lands the static spelling on exactly the tier
 * the triggered spelling already had, which is the point.
 *
 * THE `this turn` LOOKAHEAD IS LOAD-BEARING. 28 cards say "spells you cast this
 * turn cost {1} less" — a one-turn effect hung off an attack trigger or a Saga
 * chapter, not a standing modification. Without the exclusion a Saga chapter is
 * priced as a permanent engine. The window is bounded and refuses `.`, `;` and
 * `:` so it reads the qualifier on THIS spell class and cannot reach into the
 * next sentence; every match longer than 45 characters was inspected and each
 * is a genuine qualifier ("from your hand with mana value X or less",
 * "that share a card type with the exiled card").
 */
const SPELL_GRANT =
  /\bspells? you cast\b(?![^.;:\n]{0,60}?this turn)[^.;:\n]{0,60}?\b(?:have|has|gain|gains|cost|costs)\b/

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
 *
 * A QUALIFIER MAY SIT BETWEEN `target` AND ITS NOUN, and requiring them
 * adjacent was a defect worth 1,472 commander-legal cards: "destroy target
 * non-Demon creature", "target attacking creature", "target nonland permanent",
 * "target legendary creature", "counter target noncreature spell". All of them
 * fell through to `self` and were priced at 0.85 instead of 1.2.
 *
 * It surfaced as a BREADTH bug, which is why the run is worth describing. The
 * control assertion in `impact-roles.test.ts` — `spot-removal` must never
 * report a card with nothing to count — caught Shadowborn Demon. Its removal
 * clause was read correctly at `breadth: 'one'`; it just scored 0.85 and lost
 * the card to its own upkeep drawback at 0.935, which brought `none` with it
 * under the winning-clause rule. Repairing the stakes reading let the removal
 * clause win its own card again. `TARGET` never had this problem: it is a bare
 * `\btarget\b` and sees past any qualifier.
 *
 * THE EXCLUDED WORDS ARE THE WHOLE SAFETY OF THE RUN. `of` keeps "becomes the
 * target of a spell" — a trigger condition, 69 cards — from reading as a thing
 * being targeted. `you`, `an` and `your` stop the run before a controller
 * phrase so it cannot swallow one and reach a later noun. `each` and `all`
 * begin a mass quantifier, which is a different tier entirely. The trailing
 * `you control` lookahead is unchanged and still does the real work: 162 cards
 * in the widened population say "target <qualifier> <noun> you control".
 */
const OPPOSING =
  /you don't control|an opponent controls|target (?:(?!of |you |an |your |each |all )[a-z0-9'-]+ ){0,3}?(?:creature|permanent|artifact|enchantment|land|planeswalker|spell)s?\b(?![^.,;:\n]{0,24} you control)/
const YOU_CONTROL = /you control/
/**
 * The clause lands on YOU, the person — the `owning-player` rung.
 *
 * The tier the old `self` floor was hiding. "Drains you for 3" and "taps for
 * mana" both scored 0.85 because both failed every test above, and they are not
 * the same card: one lands on a life total and the other lands on nobody. The
 * verbs are the ones that name a person as what the effect happens TO — life,
 * cards and turns — never the ones that name a person as the actor, so `you
 * put`, `you exile` and `you choose` are deliberately absent: those are you
 * doing something to an object, and the object is what the other rungs measure.
 */
const OWNING_PLAYER =
  /\byou (?:gain|lose|draw|discard|mill|skip)\b|\bdamage to you\b|\byou (?:can't|don't) (?:win|lose|draw)\b/

/**
 * A permanent ON THE BATTLEFIELD, which is not the same noun as a card in a zone.
 *
 * `(?! cards?\b)` is the entire guard between removal and graveyard hate, and it
 * was worth 50 false positives when it was missing. "Exile target creature" takes
 * a permanent off the battlefield; "exile target creature CARD from your
 * graveyard" is recursion denial, and Magic's own templating distinguishes them
 * with that one word. 907 clauses in the corpus exile something out of a library,
 * graveyard or hand rather than off the battlefield.
 */
const PERMANENT_NOUN = String.raw`(?:creature|permanent|artifact|enchantment|land|planeswalker|token)s?\b(?! cards?\b)`

/** A verb that must reach a quantified permanent to count as removal. */
const reaches = (verb: string, gap = 40): RegExp =>
  new RegExp(
    `\\b${verb}\\b[^.;:\\n]{0,${gap}}?\\b(?:target|all|each|every|another|that|those)\\b` +
      `[^.;:\\n]{0,30}?${PERMANENT_NOUN}`,
  )

/**
 * FLICKER IS CHECKED BEFORE EXILE AND SUPPRESSES IT, because flicker IS "exile
 * … then return it to the battlefield". Read in the other order, the gentlest
 * rung on the ladder would score as the harshest — Ephemerate would price as
 * Swords to Plowshares.
 */
const SEV_FLICKER =
  /\bexiles?\b[^;:\n]{0,120}?\breturns? (?:it|them|that card|those cards)\b[^;:\n]{0,60}?\bto the battlefield\b/
const SEV_TAP = reaches('taps?', 30)
const SEV_BOUNCE = /\breturns?\b[^.;:\n]{0,60}?to (?:its|their) owner'?s?'? hand/
/** −X/−X is damage's twin: the same probabilistic kill, so it takes the same rung. */
const SEV_MINUS = /\bgets? -[0-9x]+\/-[0-9x]+|\bcreatures? get -[0-9x]+\/-[0-9x]+/
const SEV_DAMAGE = /\bdeals?\b[^.;:\n]{0,40}?\bdamage\b/
/** An edict destroys the chosen permanent; who chose it is not a severity question. */
const SEV_EDICT =
  /\b(?:target player|target opponent|each player|each opponent)\b[^.;:\n]{0,40}?\bsacrifices?\b/
/** A countered spell ends in the graveyard, exactly where a destroyed permanent ends. */
const SEV_COUNTER = /\bcounters? (?:target|all|each|every)\b[^.;:\n]{0,30}?\bspell/
const SEV_DESTROY = reaches('destroys?')
/** Tuck: shuffled into a library is as unrecoverable as exile for that permanent. */
const SEV_TUCK =
  /\b(?:shuffles?|puts?)\b[^.;:\n]{0,60}?\binto (?:its|their|his or her) owner'?s?'? library/
/**
 * Steal: THEY lose it and YOU gain it, a bigger swing than destroy.
 *
 * `gain`, never `gains`, and that one letter is the whole rule. Third person is
 * always somebody else doing the gaining, which is either a control RESET —
 * "each player gains control of all permanents they own", which hands
 * everything back — or a donate. Nine commander-legal cards are resets and all
 * nine read as exile-grade removal before the distinction was drawn; Brooding
 * Saurian, whose entire text returns every permanent to its owner, reached the
 * ceiling at 22.176.
 *
 * `STEAL_NOT_YOURS` then removes the cases where a player noun is doing the
 * gaining anyway — "have target opponent gain control of target permanent" is a
 * gift, and giving something away is not removal.
 */
const SEV_STEAL = /\bgain control of\b[^.;:\n]{0,40}?\b(?:target|all|each|every)\b/
const STEAL_NOT_YOURS =
  /\b(?:opponent|player)s?\b[^.;:\n]{0,20}?\bgain control of\b|\bgain control of\b[^.;:\n]{0,40}?\byou own\b/
const SEV_EXILE = reaches('exiles?')

/**
 * The rungs, in the order they are tested. `none` is deliberately absent — it is
 * the fallback when nothing matches, not something that can be matched.
 */
const SEVERITY_RULES: ReadonlyArray<readonly [Exclude<SeverityTier, 'none'>, RegExp]> = [
  ['tap', SEV_TAP],
  ['flicker', SEV_FLICKER],
  ['bounce', SEV_BOUNCE],
  ['damage', SEV_DAMAGE],
  ['damage', SEV_MINUS],
  ['destroy', SEV_DESTROY],
  ['destroy', SEV_COUNTER],
  ['destroy', SEV_EDICT],
  ['exile', SEV_EXILE],
  ['exile', SEV_TUCK],
  ['exile', SEV_STEAL],
]

/**
 * How hard this clause hits, or `none` if it hits nothing.
 *
 * GATED ON BREADTH, and the gate is what keeps the axis honest. Severity
 * describes what happens to an object the clause AFFECTS, so a clause that
 * affects nothing — `breadth: 'none'`, which is most of the corpus — cannot
 * have one. It is also the cheapest guard against "exile the top card of your
 * library", which is card advantage wearing a removal verb.
 *
 * THE HARSHEST RUNG WINS within a clause, because "destroy target creature; if
 * you do, exile it" does both and the worse outcome is the one that happened.
 * The single exception is flicker, which suppresses exile rather than losing to
 * it — see `SEV_FLICKER`.
 */
const severityOf = (clause: string, breadth: BreadthTier): SeverityTier => {
  if (breadth === 'none') return 'none'
  const flickers = SEV_FLICKER.test(clause)
  let best: SeverityTier = 'none'
  for (const [tier, pattern] of SEVERITY_RULES) {
    if (tier === 'exile' && flickers && pattern === SEV_EXILE) continue
    if (pattern === SEV_STEAL && STEAL_NOT_YOURS.test(clause)) continue
    if (!pattern.test(clause)) continue
    if (best === 'none' || SEVERITY_VALUE[tier] > SEVERITY_VALUE[best]) best = tier
  }
  return best
}

/** One ability line's complete reading. The four tiers travel together. */
interface ClauseImpact {
  readonly score: number
  readonly breadth: BreadthTier
  readonly persistence: PersistenceTier
  readonly stakes: StakesTier
  readonly symmetry: Symmetry
  readonly severity: SeverityTier
}

/**
 * Score ONE ability line as a complete tuple (ADR-0043).
 *
 * `oneShot` carries the two facts that belong to the card rather than to any
 * line: its type (an instant has already resolved, whatever its text promises)
 * and its fragility (when the card sacrifices itself, every one of its lines
 * stops, so the pin is genuinely card-wide and not a property of the clause
 * that happens to spell the sacrifice).
 */
const clauseImpact = (clause: string, oneShot: boolean, overloaded: boolean): ClauseImpact => {
  /*
   * The line with every COUNTING clause and every SERIAL spell class removed —
   * what the effect touches, rather than every plural the sentence mentions.
   * See `MEASURED` and `SERIAL_SPELL_CLASS`. Only the scope questions read
   * this; persistence still reads the line as written.
   */
  const grantsToSpells = SPELL_GRANT.test(clause)
  const effect = (grantsToSpells ? clause.replace(SPELL_GRANT_RIDER, ' ') : clause)
    .replace(MEASURED, ' ')
    .replace(SERIAL_SPELL_CLASS, ' ')

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

  /*
   * A tax is read off the LINE AS WRITTEN, like persistence and unlike the
   * scope questions: `MEASURED` and `SERIAL_SPELL_CLASS` both strip the very
   * phrase a tax is made of. "Each spell a player casts costs {1} more" keeps
   * its reach precisely because `SERIAL_SPELL_CLASS` requires `you cast`, and
   * the tax test requires the opposite, so the two can never both fire.
   */
  const taxes =
    (TAX_INCREASE.test(clause) || TAX_FLOOR.test(clause) || TAX_UNLESS.test(clause)) &&
    !TAX_IS_YOURS.test(clause) &&
    !TAX_IS_TEMPORARY.test(clause) &&
    !TAX_IS_ONE_CARD.test(clause) &&
    !ACTIVATED.test(clause)

  let breadth: BreadthTier
  if (quantified || plural || overloaded || taxes) breadth = 'unbounded'
  else if (X_TARGET.test(effect)) breadth = 'variable'
  else if (UP_TO_SEVERAL.test(effect)) breadth = 'several'
  else if (UP_TO_TWO.test(effect)) breadth = 'few'
  else if (TARGET.test(effect) || ANY_TARGET.test(effect)) breadth = 'one'
  else breadth = 'none'

  let persistence: PersistenceTier
  if (oneShot) persistence = 'one-shot'
  // A tax is a standing modification with no trigger word and nothing to wait
  // for, which is what `upkeep` means. It is asked ABOVE `whenever` because
  // Rhystic Study spells its tax as a trigger and is a tax either way.
  else if (UPKEEP.test(clause) || taxes) persistence = 'upkeep'
  // A static grant to a class of your future spells is a repeat that never
  // says `whenever`. See `SPELL_GRANT` — this is the Quandrix ruling.
  else if (WHENEVER.test(clause) || grantsToSpells) persistence = 'triggered'
  else if (ACTIVATED.test(clause)) persistence = 'activated'
  // `when` is a trigger word, asked BELOW the colon rule so an activated
  // ability carrying a delayed trigger keeps its recurring cost. See `WHEN`.
  else if (WHEN.test(clause)) persistence = 'triggered'
  else persistence = 'one-shot'

  /*
   * THE HIGHEST-SCORING TARGET THE CLAUSE COULD LAND ON (ADR-0066).
   *
   * A maximum over candidates rather than a cascade, so a clause that may hit
   * either side takes the better of the two and the answer stops depending on
   * which pattern is written first. The old ordering already encoded part of
   * this — `any target` was tested above the unbounded rule so that it reached
   * a player — and writing it as a maximum makes that an intention rather than
   * an accident of line order.
   *
   * `yoursOnly` REMOVES the opposing candidates rather than outranking them,
   * and that distinction is what keeps the two defects the old cascade fixed
   * from coming back. A mass effect scoped entirely to the caster's own side
   * has no opponent's permanent among its possible targets, so an anthem is not
   * eligible for `opposing-permanent` at all — under a naive maximum every
   * anthem and every lord would have taken 1.2 off the unbounded rule and
   * Craterhoof and Diregraf Captain would both have moved.
   *
   * The other two guards are inside the patterns and are unchanged: `opponents`
   * followed by `control` is a possessive naming a board and never reaches
   * `EACH_PLAYER` (1,472 cards), and `OPPOSING`'s trailing lookahead keeps
   * `target <qualifier> <noun> you control` off the opposing rungs (1,070).
   */
  let stakes: StakesTier = 'nothing'
  const offer = (tier: StakesTier): void => {
    if (STAKES_VALUE[tier] > STAKES_VALUE[stakes]) stakes = tier
  }
  if (!yoursOnly) {
    if (TARGET_PLAYER.test(effect) || ANY_TARGET.test(effect) || eachPlayer) {
      offer('opposing-player')
    }
    if (breadth === 'unbounded' || OPPOSING.test(effect)) offer('opposing-permanent')
  }
  if (yoursOnly || YOU_CONTROL.test(effect)) offer('owned-permanent')
  if (OWNING_PLAYER.test(effect)) offer('owning-player')

  const symmetry: Symmetry =
    breadth !== 'unbounded'
      ? 'none'
      : unrestrictedMass && !eachPlayer && !yoursOnly
        ? 'symmetric'
        : 'one-sided'

  const severity = severityOf(clause, breadth)

  const product =
    BREADTH_VALUE[breadth] *
    PERSISTENCE_VALUE[persistence] *
    STAKES_VALUE[stakes] *
    SEVERITY_VALUE[severity] *
    (symmetry === 'symmetric' ? SYMMETRY_DISCOUNT : 1)

  /*
   * A MANA CLAUSE SCORES BY A DIFFERENT RULE — 1.0 per mana produced — and it
   * is a clause that happens to score differently, never a special case for a
   * named card. The larger of the two readings is taken rather than the mana
   * amount outright, so a line that both makes mana and does something bigger
   * keeps the bigger reading; on every card the rule exists for, the mana
   * amount is the larger one anyway. See `manaProduced`.
   */
  const raw = Math.max(product, manaProduced(clause))

  // Rounded to three places so the value is stable across platforms and can be
  // compared for equality in a test. Float multiplication of four constants is
  // otherwise 7.199999999999999 on the wire.
  return { score: Math.round(raw * 1000) / 1000, breadth, persistence, stakes, symmetry, severity }
}

/**
 * How much this card does, from its text alone.
 *
 * ONE CLAUSE WINS AND BRINGS ITS WHOLE TUPLE (ADR-0043). Every ability line is
 * scored as a complete `breadth × persistence × stakes × symmetry`, and the
 * card reports the highest-scoring line's tiers TOGETHER. Never the maximum of
 * each axis taken independently — that is what let Diregraf Captain take
 * `unbounded` off its anthem line and `player` off its drain line and report
 * 15.96 for a three-mana lord, a combination corresponding to nothing the card
 * does. It now reports 6.0, which is what every other lord scores.
 *
 * THE UNIT IS THE ABILITY LINE, and that is ADR-0038's reasoning reused rather
 * than freshly invented: every pattern above is written `.` or `[^…\n]`, and
 * JavaScript's `.` does not match a newline, so each rule is already confined to
 * one line by construction. A line scored in isolation therefore gives exactly
 * the answer it gave in card context. A sentence split could promise no such
 * thing — Wrath of God's two sentences share a line, and "They can't be
 * regenerated" alone is not a board wipe.
 *
 * Splitting happens AFTER `normalise`, so reminder text can never become a
 * clause of its own and a card's self-reference is already `~` on every line.
 *
 * Pure and total: every card returns a `CardImpact`.
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
   * Both card-level facts, and both genuinely card-level rather than clause-
   * level. `fragile` because when the card sacrifices itself EVERY line stops,
   * so pinning only the line that spells the sacrifice would price the rest of
   * the card as an engine it no longer has — Viridian Zealot is a Naturalize
   * with a body however you split it. `scales` because it is a marker on the
   * whole reading, not a term in the product.
   */
  const fragile = SACRIFICE_SELF.test(text)
  const oneShot = INSTANT_OR_SORCERY.test(types) || fragile
  const overloaded = OVERLOAD.test(text)

  /*
   * DEFENSIVE, and said so rather than dressed up as tested. An empty clause
   * scores `none` breadth x `one-shot` x `self` = 0.425, which is exactly the
   * floor a real clause can reach, so it ties and never wins — a mutation
   * removing this filter survives, and 525 cards have a blank line for it to
   * survive on. It is kept because "the clauses of a card" should not include
   * blanks whatever the arithmetic happens to say, and the emptiness guard
   * below is what keeps `reduce` total.
   */
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  /*
   * The bare `overload {cost}` line is dropped — it is a cost, not an effect,
   * and its breadth now rides on the card's real clauses instead. Guarded so a
   * card that is somehow nothing but the keyword still has something to score.
   */
  const withoutPhantom = lines.filter((line) => !OVERLOAD_LINE.test(line))
  const clauses = withoutPhantom.length > 0 ? withoutPhantom : lines
  if (clauses.length === 0) return NO_IMPACT

  const scored = clauses.map((clause) => clauseImpact(clause, oneShot, overloaded))

  /*
   * The winning clause, taken WHOLE.
   *
   * `reduce` rather than a sort so the FIRST clause wins a tie: on a card whose
   * lines score equally the earlier one is the one a reader sees first, and a
   * stable answer matters more than which of two identical numbers is picked.
   */
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a))

  return {
    score: best.score,
    breadth: best.breadth,
    persistence: best.persistence,
    stakes: best.stakes,
    symmetry: best.symmetry,
    severity: best.severity,
    scales:
      scored.some((c) => c.breadth === 'variable') ||
      FOR_EACH.test(text) ||
      COST_X.test(card.manaCost ?? ''),
    fragile,
  }
}
