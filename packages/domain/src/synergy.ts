import type { Card } from './card.js'
import type { OracleId } from './ids.js'

/**
 * Mechanical synergy (ADR-0011).
 *
 * ADR-0008 removed EDHREC, which left candidate group 7 `high-synergy`
 * permanently empty — it was defined as "EDHREC synergy above threshold". This
 * refills it with something the project can compute for itself, and arguably
 * better: a statistic says *that* two cards get played together, a mechanism
 * says *why*, and pillar P4 requires the reason to carry the why.
 *
 * The model is events. A card either PRODUCES an event or WANTS one:
 *
 *   commander: "Whenever a creature you control dies…"  → wants creature-death
 *   sac outlet: "Sacrifice a creature:"                 → produces creature-death
 *
 * Matching runs both directions. Adding a payoff for something the deck already
 * does is worth as much as adding an enabler for a payoff it already has.
 *
 * An event also has a SUBJECT — who it happens to (ADR-0022). "You discard a
 * card" and "each opponent discards a card" are two different events with two
 * different payoff sets, and one tag cannot name both without lying about one
 * of them. Where the subject changes what the card is for, the tag says so:
 * `discard`/`opponent-discard`, `sacrifice-fodder`/`opponent-sacrifice`.
 *
 * Two events can also stand in a ONE-WAY relation (ADR-0023). Damage dealt to a
 * player is that player losing life (CR 120.3c, and four cards in the corpus
 * print "(Damage causes loss of life.)" as reminder text), but a drain spell
 * deals no damage. So `player-damage` and `lifeloss` are separate events, and
 * the entailment lives on the PAYOFF side only: a rule that reads "whenever an
 * opponent loses life" emits both tags, and no producer rule ever does. That
 * asymmetry is why the relation is not in `INTERACTION_PAIRS`, which is
 * unordered by construction — see the note there.
 *
 * Like role derivation (doc 02 §2.4), these heuristics are wrong often enough to
 * matter, and that is expected rather than a defect to engineer away — "does
 * this card enable sacrifice" is a judgement about how a card plays. The curated
 * override table is a first-class, growing artifact.
 */

export type SynergyTag =
  | 'creature-death'
  | 'token'
  | 'lifegain'
  | 'lifeloss'
  | 'card-draw'
  | 'discard'
  | 'graveyard-creature'
  | 'artifact-etb'
  | 'enchantment-etb'
  | 'landfall'
  | 'plus1-counter'
  | 'attack-trigger'
  | 'untap'
  | 'treasure'
  | 'sacrifice-fodder'
  | 'creature-etb'
  | 'spell-cast'
  | 'opponent-discard'
  | 'opponent-sacrifice'
  | 'player-damage'
  | 'damage'

export const SYNERGY_TAGS: readonly SynergyTag[] = [
  'creature-death',
  'token',
  'lifegain',
  'lifeloss',
  'card-draw',
  'discard',
  'graveyard-creature',
  'artifact-etb',
  'enchantment-etb',
  'landfall',
  'plus1-counter',
  'attack-trigger',
  'untap',
  'treasure',
  'sacrifice-fodder',
  'creature-etb',
  'spell-cast',
  'opponent-discard',
  'opponent-sacrifice',
  'player-damage',
  'damage',
]

/**
 * Which events feed which other events.
 *
 * The mechanical relation is same-tag and opposite-direction: a card that
 * PRODUCES `creature-death` is for a card that WANTS it. That one needs no
 * table — it falls out of the model.
 *
 * This is the other relation, and it is a judgement call in the same way the
 * regexes above are: tokens are the classic sacrifice fodder, deaths fill a
 * graveyard, discard fills it faster, treasures are artifacts entering the
 * battlefield and fodder once spent. Knowing that a card is keyed to `token`
 * tells you little on its own; knowing that `token` feeds `sacrifice-fodder`
 * and `attack-trigger` tells you what to go looking for.
 *
 * Written as unordered PAIRS rather than an adjacency map, so symmetry is
 * structural. "A interacts with B but B does not interact with A" is not a
 * thing that can be expressed here, and therefore not a thing that can drift.
 */
const INTERACTION_PAIRS: readonly (readonly [SynergyTag, SynergyTag])[] = [
  // Aristocrats: bodies you do not mind losing, a way to lose them, and the
  // drain that pays for it.
  ['token', 'sacrifice-fodder'],
  ['token', 'creature-death'],
  ['creature-death', 'sacrifice-fodder'],
  ['creature-death', 'lifeloss'],
  ['lifegain', 'lifeloss'],

  // The graveyard as a resource, and the two things that fill it.
  ['creature-death', 'graveyard-creature'],
  ['discard', 'graveyard-creature'],
  // Loot and rummage are one effect wearing two tags.
  ['card-draw', 'discard'],

  // Artifacts. A treasure is an artifact entering, and fodder once spent.
  ['treasure', 'artifact-etb'],
  ['treasure', 'sacrifice-fodder'],
  ['artifact-etb', 'token'],

  // Enchantments. A constellation deck plays Auras and a token deck plays
  // enchantments that make them; both put an enchantment onto the battlefield.
  ['enchantment-etb', 'token'],
  ['enchantment-etb', 'artifact-etb'],

  // Going wide, and the things that reward it.
  ['token', 'attack-trigger'],
  ['token', 'plus1-counter'],
  ['attack-trigger', 'plus1-counter'],
  ['attack-trigger', 'untap'],

  // Lands. Untap effects are how a landfall deck gets more than one trigger.
  ['landfall', 'untap'],
  ['landfall', 'token'],

  // Blink. A token entering is a creature entering, and reanimation is the
  // other way to make one enter — both are how a deck full of enters-the-
  // battlefield triggers gets to fire them more than once.
  ['creature-etb', 'token'],
  ['creature-etb', 'graveyard-creature'],

  // Spellslinger. Cantrips are how the deck finds the next spell, and its
  // graveyard is where the spells it already cast are waiting to be recast.
  ['spell-cast', 'card-draw'],
  ['spell-cast', 'graveyard-creature'],

  /*
   * Stax and punisher (ADR-0022). One deck, two halves of one question: what
   * can I make an opponent give up, and what do I get when they do.
   *
   * The two opponent tags feed each other because the cards say so in one
   * breath — Torment of Hailfire, Nicol Bolas, Forbidden Ritual and Tergrid's
   * own Lantern all read "unless that player sacrifices a permanent OR
   * discards a card". A deck that can force one is already built to force the
   * other.
   *
   * Both pair with `lifeloss` because that is what the punisher shell converts
   * them into in both directions: "loses 3 life unless they discard" is the
   * producer, and Megrim, Liliana's Caress, Raiders' Wake and Fell Specter are
   * the payoff — every one of them turns an opponent's discard into life lost.
   *
   * `opponent-sacrifice` pairs with `creature-death` because Grave Pact spells
   * out the edge: "whenever a creature you control dies, each other player
   * sacrifices a creature". Your deaths are literally what makes them sacrifice.
   *
   * Three pairings were considered and REJECTED, because they would rebuild the
   * conflation this ADR exists to remove:
   *
   *   - `discard` ↔ `opponent-discard`. Looting yourself does not feed Megrim
   *     and Megrim does not feed madness. Same verb, different event.
   *   - `sacrifice-fodder` ↔ `opponent-sacrifice`. Your tokens are not what an
   *     edict eats.
   *   - `graveyard-creature` ↔ `opponent-discard`. ADR-0016 already ruled that
   *     an opponent's graveyard is not the resource, and nothing here changes
   *     that. Tergrid steals from it, which is a property of Tergrid.
   */
  ['opponent-discard', 'opponent-sacrifice'],
  ['opponent-discard', 'lifeloss'],
  ['opponent-sacrifice', 'lifeloss'],
  ['opponent-sacrifice', 'creature-death'],

  /*
   * Burn (ADR-0023). A burn deck is a spellslinger deck: 489 of the 1,576 cards
   * that deal damage to a player are instants or sorceries, and 58 cards spell
   * the causation out in one line — "whenever you cast an instant or sorcery
   * spell, this deals 2 damage to each opponent" is Guttersnipe, Firebrand
   * Archer, Urabrask and Electrostatic Field. Casting is what fires the
   * damage, and the damage is what the deck casts spells for, so the pair is
   * true read in either direction, which is the bar this table sets.
   *
   * `player-damage` ↔ `lifeloss` is REFUSED, and it is the whole reason
   * ADR-0023 exists. Damage to a player IS life loss; life loss is NOT damage.
   * This table cannot say that: it is unordered on purpose (see the note above
   * it), and its one consumer renders a pair as "Benefits, and benefits from:
   * …", a sentence that is symmetric in English too. Adding the pair would put
   * the conflation back with a drain spell claiming to feed Torbran. The
   * entailment is carried on the payoff side instead — one regex, two tags,
   * in `WANTS` below — because that is the only side where it holds.
   *
   * `player-damage` ↔ `attack-trigger` is refused for the same reason in the
   * other direction: combat damage is the thing this tag is defined to exclude,
   * and `attack-trigger` already owns "whenever this deals combat damage".
   *
   * `player-damage` ↔ `creature-etb` was considered on the strength of Impact
   * Tremors and Purphoros and refused: what those cards pair is a trigger
   * CONDITION with an effect. Admit that and every trigger condition pairs with
   * every effect, which is not a relation between events at all.
   */
  ['player-damage', 'spell-cast'],

  /*
   * Dealing damage, wherever it lands (ADR-0029).
   *
   * `damage` ↔ `creature-death` is the pair this ADR exists to place, and
   * placing it HERE rather than in the rules is the whole decision. Lethal
   * damage destroys a creature (CR 704.5g), but "lethal" depends on a toughness
   * the card cannot see — 3 damage kills 69.6% of the commander-legal creature
   * corpus, 4 kills 85.7%, and there is no point on that slope where a producer
   * rule could honestly promise a death. A pair claims something weaker and
   * true: these two events feed each other. Burn is how a death-trigger deck
   * gets deaths without a sacrifice outlet, and a Blood Artist is what makes the
   * burn spell worth more than its damage.
   *
   * The unordered table can carry this because it already carries the same
   * shape: `creature-death` ↔ `graveyard-creature` is one-way in the mechanics
   * (deaths fill a yard; a yard causes no deaths) and reads true in both
   * directions in English, which is the bar this table sets.
   *
   * `damage` ↔ `spell-cast` follows `player-damage`'s pairing on stronger
   * evidence: 1,162 of the 2,740 producers are instants or sorceries, against
   * the 489 of 1,576 that ADR-0023 counted.
   *
   * Four pairings were considered and REFUSED:
   *
   *   - `damage` ↔ `player-damage`. One is a strict subset of the other — all
   *     1,576 `player-damage` producers produce `damage` too — and a tag does
   *     not feed itself. This is ADR-0022's `discard` ↔ `opponent-discard`
   *     refusal, one event over.
   *   - `damage` ↔ `lifeloss`. ADR-0023 exists to refuse this and nothing here
   *     changes it. A drain spell still deals no damage.
   *   - `damage` ↔ `attack-trigger`. Combat damage is the thing the producer
   *     rules are built to exclude.
   *   - `damage` ↔ `plus1-counter`, considered on the strength of the enrage
   *     dinosaurs, which almost all grow when damaged. That pairs a trigger
   *     CONDITION with an effect, which ADR-0023 already ruled is not a relation
   *     between events — admit it and every condition pairs with every effect.
   */
  ['damage', 'creature-death'],
  ['damage', 'spell-cast'],
]

const INTERACTIONS = ((): ReadonlyMap<SynergyTag, readonly SynergyTag[]> => {
  const map = new Map<SynergyTag, SynergyTag[]>(SYNERGY_TAGS.map((t) => [t, []]))
  for (const [a, b] of INTERACTION_PAIRS) {
    map.get(a)?.push(b)
    map.get(b)?.push(a)
  }
  for (const [, list] of map) list.sort()
  return map
})()

/**
 * Other events this one feeds, or is fed by. Never includes the tag itself.
 *
 * Empty for a tag nothing has been paired with yet, which is a gap in the table
 * rather than a claim that the event is inert.
 */
export const interactsWith = (tag: SynergyTag): readonly SynergyTag[] => INTERACTIONS.get(tag) ?? []

interface Rule {
  readonly tag: SynergyTag
  readonly test: RegExp
}

/**
 * Written against Scryfall oracle conventions: the card's own name is spelled
 * out rather than `~`, reminder text is present, ability words are capitalised.
 *
 * The text a rule sees is `typeLine`, a newline, then `oracleText`. So an
 * unanchored pattern reads the rules text, and `^[^\n]*` reads the type line —
 * which is how "this card IS an artifact" is asked.
 */
const PRODUCES: readonly Rule[] = [
  // A sacrifice outlet is the classic enabler: it turns creatures into deaths on
  // demand, which is what a death trigger is waiting for.
  { tag: 'creature-death', test: /\bsacrifice (a|another|an|one|two|X|\d+) creature/i },
  { tag: 'creature-death', test: /\bsacrifices? (a|another|an|one|two|X|\d+) creatures?\b/i },
  { tag: 'creature-death', test: /\beach player sacrifices\b/i },
  /*
   * A creature that eats ITSELF (ADR-0038).
   *
   * The three rules above all ask for an indefinite article, because they were
   * written to find sacrifice OUTLETS. "Sacrifice this creature:" is the other
   * half of the same event and was reachable by nothing: 510 commander-legal
   * cards, from Sakura-Tribe Elder and Viscera Seer's food to every Nantuko
   * Husk victim with a death-triggered ability of its own.
   *
   * `creature-death` and NOT `sacrifice-fodder`, and the split is the point. An
   * outlet wants fodder because you feed it your board; a creature that can only
   * eat itself asks for nothing, so it produces the death and wants nothing —
   * which is why the `wants` rule below still asks for "a" or "another".
   *
   * Deliberately includes the drawback shape: "At the beginning of the end step,
   * sacrifice this creature" (Arc Runner, Ball Lightning) is not a plan, but a
   * deck built on "whenever a creature dies" genuinely gets a trigger out of it.
   * That is the argument `destroy all creatures` already makes two rules down.
   *
   * The pre-2024 templating spells the card's own NAME here instead ("Sacrifice
   * Ashnod's Altar"), which a regex table cannot see. Left, and counted: the
   * name-substitution experiment that would reach it is refused below, on the
   * `creature-etb` rule, for a measured reason.
   */
  { tag: 'creature-death', test: /\bsacrifices? this creature\b/i },

  /*
   * An edict is not a sacrifice outlet (ADR-0022).
   *
   * `sacrifice-fodder` is the aristocrats tag: its producers are your token
   * makers and its payoff is "sacrifice a creature:", an outlet you feed with
   * your own board. "Each opponent sacrifices a creature of their choice" is
   * the opposite card — it costs an opponent a permanent and it is what
   * Tergrid, It That Betrays, Mazirek and Mayhem Devil are waiting for.
   *
   * Same subject test as `opponent-discard`: the third-person "sacrifices",
   * never the imperative "Sacrifice a creature:", which is addressed to you.
   * That is what keeps a card sacrificing its OWN tokens out of this tag.
   * "each player sacrifices" matches this and `creature-death` both, which is
   * correct — a symmetric edict genuinely does both.
   */
  {
    tag: 'opponent-sacrifice',
    test: /\b(each|target|that|each other) (player|opponent)s? (may )?sacrifices\b|\bdefending player sacrifices\b|\b(players|opponents) each sacrifice\b/i,
  },
  {
    tag: 'opponent-sacrifice',
    test: /\bunless (they|that player) sacrifices?\b|\b(any|each) (player|opponent) may sacrifice\b/i,
  },
  { tag: 'creature-death', test: /\bdestroy target creature\b/i },
  // A board wipe makes creatures die too. It is not a sacrifice outlet — it
  // happens once, and it hits your own board — but a deck built on "whenever a
  // creature dies" genuinely wants one.
  //
  // "Destroy target nonland permanent" and "fights target creature" were tried
  // here and dropped at about 70% precision: the first as often points at an
  // enchantment, and a fight as often fails to deal lethal damage.
  { tag: 'creature-death', test: /\bdestroy all creatures\b/i },

  /*
   * Dealing damage is its own event (ADR-0029).
   *
   * `player-damage` (ADR-0023) reads damage aimed at a FACE, and it was the only
   * damage this file could see. So every Flame Slash, Blasphemous Act, Anger of
   * the Gods and Bolas loyalty ability — 1,269 commander-legal cards — dealt
   * damage and said nothing about it.
   *
   * Folding damage into `creature-death` was written, measured and REJECTED.
   * "Destroy target creature" always kills; "deals 3 damage to target creature"
   * kills only if toughness is 3 or less, and the card cannot know. The corpus
   * says how often, over the 17,514 commander-legal creatures that print a
   * numeric toughness: 1 damage kills 21.6%, 2 kills 46.7%, 3 kills 69.6%, 4
   * kills 85.7%, 10 kills 99.8%. There is no honest threshold in that table —
   * it is a slope, and picking a point on it makes the tag claim a death the
   * card does not promise. The user's ruling is the right one: damage is not
   * creature death any more than it is life loss. It is its own event, and the
   * relation to death is carried in `INTERACTION_PAIRS`, where a one-way causal
   * link already lives (`creature-death` ↔ `graveyard-creature`).
   *
   * SUBJECT-AGNOSTIC, unlike `player-damage`, and that is the boundary: every
   * one of the 1,576 `player-damage` producers also produces `damage` — checked
   * card by card, zero exceptions — so `player-damage` is the strictly narrower
   * event, kept because it alone carries ADR-0023's life-loss bridge. `damage`
   * is what a doubler doubles and what an enrage trigger notices, neither of
   * which cares where the damage landed.
   *
   * NOT restricted to spells, though the user's word for it was "spells that do
   * damage". Measured: only 1,162 of the 2,740 producers (42%) are instants or
   * sorceries, only 7 of the 48 amplifier payoffs restrict the source to one,
   * and the card that prompted all of this is a planeswalker loyalty ability.
   * A `spell-damage` tag would have missed the report it came from. The name
   * matches the boundary that was drawn, not the one that read nicest.
   *
   * Requiring an AMOUNT is what excludes combat damage without a word about it,
   * exactly as in ADR-0023: "deals combat damage to a player" states no number,
   * so the word "combat" sits where this rule wants one. The clause is the unit
   * and not the card — Balefire Dragon, Questing Beast and Sword of Fire and Ice
   * are triggered by combat damage and their EFFECT is noncombat damage.
   *
   * "to you" is refused, for ADR-0023 §6's reason one subject over: 105 cards
   * match on nothing else, and they are Ancient Tomb, Mana Vault, the painlands
   * and the Talismans. Their damage is a cost, not a plan, and no damage deck
   * plays them for it. The cost of the refusal is measured and is one card —
   * Sorrow's Path, "deals 2 damage to you and each creature you control" —
   * which is cheaper than a nested lookahead no test could pin.
   *
   * A matching `itself` exclusion was written and dropped: it moved exactly one
   * card in the corpus, and a branch a test cannot fail on is machinery.
   */
  { tag: 'damage', test: /\bdeals (?:\d+|X|that much) damage to (?!you\b)/i },
  // The amount trailing the target, which is how a variable is templated:
  // "deals damage to each player equal to twice the number of nonbasic lands"
  // (Price of Progress) and "deals damage equal to its power to target creature"
  // — the fight half. Fight is refused as a `creature-death` producer two rules
  // up, and is admitted here, because the two rules make different claims: that
  // one says a creature dies and this one says damage was dealt.
  {
    tag: 'damage',
    test: /\bdeals damage to [^.\n]{0,60}\bequal to\b|\bdeals damage equal to\b/i,
  },
  // The divided form names no amount per target at all — "5 damage divided as
  // you choose among any number of target creatures" — which is why it could
  // not be read as death and can be read as damage.
  { tag: 'damage', test: /\bdamage divided\b/i },

  { tag: 'token', test: /\bcreate(s)? .{0,40}\btoken/i },
  { tag: 'sacrifice-fodder', test: /\bcreate(s)? .{0,40}\bcreature token/i },

  { tag: 'treasure', test: /\bTreasure token/i },
  // Any artifact card entering IS an artifact entering the battlefield, which is
  // the whole of what an artifact payoff asks for. Naming the token types as
  // well catches the cards that make artifacts without being one.
  { tag: 'artifact-etb', test: /^[^\n]*\bArtifact\b/ },
  // The same argument, one card type over. An enchantment entering IS what a
  // constellation or enchantress trigger asks for. The corpus holds 3,847
  // enchantments against ~200 payoffs — the same lopsided shape as the artifact
  // pair above, which is the precedent this follows rather than a fresh claim.
  { tag: 'enchantment-etb', test: /^[^\n]*\bEnchantment\b/ },
  {
    tag: 'artifact-etb',
    test: /\bcreate(s)? .{0,40}\b(artifact|Clue|Food|Blood|Treasure|Powerstone|Junk|Map|Gold|Incubator|Equipment) token/i,
  },

  // The numbers were a closed list of one, so "gain 4 life" read as nothing.
  {
    tag: 'lifegain',
    test: /\bgains? (\d+|X) life\b|\bgains? life equal to\b|\bgains? that much life\b|\blifelink\b/i,
  },
  {
    tag: 'lifeloss',
    test: /\bloses? (\d+|X) life\b|\bloses? life equal to\b|\bloses? that much life\b/i,
  },
  /*
   * Damage to a player is its own event (ADR-0023).
   *
   * This rule used to be a second `lifeloss` producer, on the true premise that
   * damage to a player makes that player lose life. The premise does not
   * survive being turned into a tag: 384 of the 1,446 cards that produced
   * `lifeloss` never mentioned life at all, so Impact Tremors, Purphoros and
   * Manabarbs were reported as drain, and the app told a burn deck it was a
   * Vito deck. The user put it in five words: "damage is not life loss, they
   * are separate effects."
   *
   * The entailment is real and is kept — on the payoff side, where it is the
   * only side that holds. See `WANTS` below.
   *
   * Three rules, because Scryfall templates the amount three ways. Requiring
   * the amount is also what excludes combat damage without a word about it:
   * "deals combat damage to a player" is 751 cards, and none of them states a
   * number, so the word "combat" sits exactly where this rule wants the amount.
   * A card-level exclusion of "combat damage" was rejected on Kediss, Emberclaw
   * Familiar and Amarant Coral — combat-triggered cards whose EFFECT is
   * noncombat damage to every other opponent. The clause is the unit, not the
   * card.
   *
   * "any target" is deliberately IN, reversing the note this rule used to
   * carry. Excluding it was right for `lifeloss` — a Bolt pointed at a creature
   * takes nobody's life total with it — and wrong for this tag, which asks
   * whether the card deals damage at a face, not whether it always does. 548
   * cards, sampled 25, all burn: Tarfire, Staggershock, Skewer the Critics,
   * Prodigal Sorcerer. Lightning Bolt itself was reachable by no rule at all
   * before this.
   *
   * The window is bounded and looks past the first target, because "deals 2
   * damage to target creature and 2 damage to that creature's controller" is a
   * player-damage card whose first noun is a creature. The lookahead is what
   * keeps "each creature your opponents CONTROL" and "target creature an
   * opponent CONTROLS" out — those are the same word doing the opposite job.
   */
  {
    tag: 'player-damage',
    test: /\bdeals (?:(?:\d+|X|that much) damage|damage equal to [^.\n]{0,60}?) to (?:any target|[^.\n]{0,40}\b(?:player|opponent|controller)s?\b(?!\s+(?:controls?|own)))/i,
  },
  // The amount trailing the target: "deals damage to each player equal to twice
  // the number of nonbasic lands that player controls" (Price of Progress).
  // Narrow on purpose — a bare "deals damage to an opponent" is nearly always
  // the trigger clause of a payoff, and reading it here would invert direction.
  {
    tag: 'player-damage',
    test: /\bdeals damage to (?:target player|target opponent|each player|each opponent|that player)\b/i,
  },
  // The X-spell finisher, which names no target at all. 26 cards, read by hand,
  // all burn: Fireball, Rolling Thunder, Conflagrate, Bogardan Hellkite,
  // Inferno Titan. "Among any number of target creatures" is a different
  // sentence and is not matched.
  {
    tag: 'player-damage',
    test: /\bdamage divided [^.\n]{0,40}among (?:any number of targets|one, two, or three targets)\b/i,
  },

  {
    tag: 'card-draw',
    test: /\bdraws? (a|two|three|four|five|six|seven|X|that many|\d+) cards?\b|\bdraws? cards equal to\b/i,
  },
  // Whose discard. "Target opponent discards two cards" is a hand attack, not a
  // loot engine, and this tag's payoffs are madness and "whenever you discard" —
  // so matching `discards` with any subject was calling 296 hand-attack cards
  // discard enablers. Scryfall templating makes the subject readable: a bare
  // "discard a card" is addressed to you.
  //
  // ADR-0016 narrowed it to here and stopped, which deleted the opponent side
  // rather than modelling it. `opponent-discard` below is that side.
  //
  // One narrowing, and it is the reported bug. The punisher template —
  // "…loses 3 life unless they sacrifice a nonland permanent of their choice
  // OR DISCARD A CARD" — puts the bare infinitive "discard" in the sentence
  // because its subject is "they", and the rule read that as being addressed
  // to you. Tergrid's Lantern is one of the cards it happened to, which is how
  // the front half's payoff came to be reported as the deck's own looting.
  //
  // The lookbehind is the narrow instrument on purpose. A card-level exclusion
  // would strip a card that has a punisher clause AND a real loot ability; this
  // only refuses the one clause. Checked rather than assumed: exactly 14 cards
  // in the commander-legal corpus lose `discard` this way, all 14 were read by
  // hand, and all 14 are opponent-discard cards (Painful Quandary, Wrench Mind,
  // Court of Ambition, Torment of Scarabs, Tergrid…). None was a loot card.
  {
    tag: 'discard',
    test: /\byou discard\b|\beach player discards\b|(?<!\bunless (?:they|that player|its controller)[^.\n]{0,60})\bdiscard (a|an|two|three|four|X|\d+|that many|your hand)\b/i,
  },

  /*
   * The other side of the same verb (ADR-0022).
   *
   * Scryfall names the subject before the verb and inflects it, which is the
   * whole reason the split is readable at all: "discard a card" is addressed to
   * you, "<somebody> discards a card" is addressed to them. So the rule asks
   * for a third-person subject rather than for the word "discard".
   *
   * "each player discards" deliberately matches BOTH this and `discard` above.
   * A wheel hits your hand and theirs; claiming one and not the other would be
   * false either way round.
   *
   * The trap this was expected to have — "target player draws a card, then
   * discards a card", the looter you point at yourself — turns out not to
   * exist. That templating never puts "discards" next to its subject, so of the
   * 435 cards this rule reads exactly one (Lumengrid Augur) is loot-shaped, and
   * it earns the tag on a separate clause anyway. No exclusion was needed;
   * checking was.
   */
  {
    tag: 'opponent-discard',
    test: /\b(each|target|that|each other) (player|opponent)s? discards?\b|\bdefending player discards\b|\b(players|opponents) each discards?\b/i,
  },
  // The forms that put something between the subject and the verb. The punisher
  // template — "loses 3 life unless they sacrifice a permanent OR discard a
  // card" — is Tergrid's own Lantern, and an adjacent-words rule reads right
  // past it. `[^.\n]` keeps the gap inside one sentence and inside one face.
  {
    tag: 'opponent-discard',
    test: /\bunless (they|that player|its controller)[^.\n]{0,60}\bdiscards?\b|\bhave target (player|opponent) discards?\b|\breveals? their hand and discards\b/i,
  },

  // Self-mill and reanimation fodder: something has to fill the graveyard.
  // Self-mill only, for the same reason as `discard`: milling an opponent fills
  // THEIR graveyard, and every payoff this tag pairs with reads your own.
  {
    tag: 'graveyard-creature',
    test: /\bmill (a|two|three|four|five|six|seven|ten|X|that many|\d+) cards?\b|\byou mill\b|\beach player mills\b|\bsurveil \d+\b|\bput(s)? the top .{0,40}into your graveyard\b/i,
  },
  { tag: 'graveyard-creature', test: /\bdies\b.{0,60}\bgraveyard\b/i },

  { tag: 'plus1-counter', test: /\bput(s)? .{0,30}\+1\/\+1 counter/i },
  /*
   * A permanent that arrives with counters on it is a +1/+1 deck's payload, and
   * that templating never says "put".
   *
   * The amount used to be a CLOSED LIST — `(a|an|one|two|three|four|X|\d+)` —
   * and the corpus writes it four other ways the list has no room for: "two
   * ADDITIONAL +1/+1 counters" (Moritte of the Frost, the reported card, and
   * every riot creature), "a NUMBER OF +1/+1 counters … equal to" (Undergrowth
   * Scavenger, Rhizome Lurcher), "THAT MANY" (devour), and "X additional"
   * (Altered Ego). 117 commander-legal cards, read in a sample of 13, all real.
   * The gap is `[^.\n]`, so it cannot leave the sentence it started in.
   *
   * The second rule is the same claim about a card coming BACK: "return target
   * creature card from your graveyard to the battlefield with two additional
   * +1/+1 counters on it" is Evil Reawakened, Prison Break, Graceful Restoration
   * and Cauldron's Gift. 11 cards. Folding them into the rule above was tried
   * and dropped: they never say "enters", so reaching them would mean deleting
   * that word, and "enters with" is exactly what keeps this claim off the payoff
   * side — see the `wants` rule below, where the same words invert.
   */
  { tag: 'plus1-counter', test: /\benters with [^.\n]{0,40}\+1\/\+1 counter/i },
  { tag: 'plus1-counter', test: /\bto the battlefield with [^.\n]{0,30}\+1\/\+1 counter/i },
  {
    tag: 'plus1-counter',
    test: /\bdistribute (a|two|three|four|five|X|\d+) \+1\/\+1 counters?\b|\bdouble the number of \+1\/\+1 counters\b/i,
  },

  { tag: 'untap', test: /\buntap target\b|\buntap all\b|\buntaps? another\b/i },
  { tag: 'untap', test: /\buntaps? (up to )?(one|two|three|X|\d+) target\b|\byou may untap\b/i },

  // Ramp is what a landfall deck runs, and the old pattern wanted the word
  // "land" AFTER "put" — so every fetch ("search your library for a basic land
  // card, then put it onto the battlefield") read as nothing at all.
  {
    tag: 'landfall',
    test: /\bplay an additional land\b|\bput(s)? .{0,30}land .{0,20}battlefield/i,
  },
  { tag: 'landfall', test: /\bland cards?\b[^.]{0,60}\bonto the battlefield\b/i },
  /*
   * The fetch that never says "land" (ADR-0038).
   *
   * Both rules above ask for the word, and the format's most-played landfall
   * enabler does not print it: a fetchland reads "search your library for a
   * Plains or Island card, put it onto the battlefield". So Flooded Strand,
   * Misty Rainforest, every Panorama and Landscape, Farseek, Nature's Lore,
   * Krosan Verge, Ranger's Path and Wood Elves derived nothing. 75 cards.
   *
   * The basic land TYPES are named rather than allowing any noun, and that is
   * what keeps the tutors out: "{T}, Sacrifice a land: Search your library for
   * a Mercenary permanent card, put it onto the battlefield" (Bog Glider) has
   * the word "land" in its COST, and a rule that read the whole clause would
   * call every sacrifice-a-land tutor a landfall enabler. Requiring the type to
   * appear AFTER "search your library for" is the whole of the precision.
   *
   * `\b` on the types matters: without it "landwalk" and "Islandwalk" match.
   */
  {
    tag: 'landfall',
    test: /\bsearch(?:es)? (?:your|their) library for [^.\n]{0,80}\b(?:Plains|Island|Swamp|Mountain|Forest)\b[^.\n]{0,60}\bonto the battlefield\b/i,
  },

  // Nothing produced `attack-trigger` at all, so 1,848 cards wanted an event no
  // card in the corpus could supply. These are the cards that cause attacks:
  // another combat step, or a compulsion to attack.
  //
  // Goad, "target creature attacks this turn if able" and "untap all creatures
  // you control" were all tried here and dropped. The first two point at an
  // OPPONENT's creatures, which no "whenever a creature you control attacks"
  // trigger ever sees, and the third is a vigilance trick more often than it is
  // a second attack — and it already reads as `untap`.
  {
    tag: 'attack-trigger',
    test: /\b(additional|extra) combat phase\b|\bcreatures you control attack (this turn|each combat) if able\b/i,
  },

  // Blink, and the other ways a creature enters again. A flicker effect is the
  // enabler for every "when this creature enters" already on the board.
  {
    tag: 'creature-etb',
    test: /\bexiles? .{0,70}return (it|them|that card|those cards) to the battlefield\b/i,
  },
  {
    tag: 'creature-etb',
    test: /\breturn (it|them) to the battlefield under (its owner's|your) control\b/i,
  },
  {
    tag: 'creature-etb',
    test: /\breturn target creature card from (your|a) graveyard to the battlefield\b/i,
  },
  /*
   * The other verb reanimation is written in (ADR-0029).
   *
   * Every reanimation rule in this file was built around "return … to the
   * battlefield", and Scryfall templates half of them the other way: "PUT target
   * creature card from a graveyard ONTO the battlefield". Reanimate, Rise from
   * the Grave, Beacon of Unrest, Necromancy, Portal to Phyrexia, Debtors' Knell
   * and Nicol Bolas's −4 all read that way and matched nothing at all.
   *
   * The graveyard is deliberately ANY graveyard here, unlike the `wants` rule
   * below. Whose yard the card came out of does not change the fact that a
   * creature entered the battlefield, which is the whole of what a blink or
   * enters-trigger deck is asking for. 37 commander-legal cards; Gruesome
   * Encore, Puppeteer Clique and Sepulchral Primordial are the ones this reaches
   * and the `wants` side refuses.
   */
  {
    tag: 'creature-etb',
    test: /\bput target [^.\n]{0,40}?\bcreature\b[^.\n]{0,40}?\bcard from (?:a|your|an opponent's|target player's) graveyard onto the battlefield\b/i,
  },

  // Casting an instant or sorcery IS the event a prowess or magecraft trigger
  // waits for, and the type line says so without any reading of the rules text.
  { tag: 'spell-cast', test: /^[^\n]*\b(Instant|Sorcery)\b/ },
]

const WANTS: readonly Rule[] = [
  // The user's example: a death trigger on the commander wants creatures to die.
  { tag: 'creature-death', test: /\bwhenever (a|another) .{0,40}creature .{0,20}dies\b/i },
  { tag: 'creature-death', test: /\bwhenever .{0,40}\bdies\b/i },
  { tag: 'creature-death', test: /\bwhenever you sacrifice\b/i },
  // "When this creature dies…" — the one-shot form.
  //
  // Magic writes "Whenever" for a repeatable trigger and "When" for a one-shot,
  // so the rules above matched every death engine and missed every creature
  // that pays off its OWN death. That is precisely the card an aristocrats deck
  // is built from: a sac outlet produces the death, and this is what cashes it.
  // 190 untagged cards, sampled 14 by hand — 13 were real payoffs, the
  // exception being Alabaster Dragon, whose death trigger is a drawback.
  { tag: 'creature-death', test: /\bwhen\b[^.]{0,40}\bdies\b/i },

  // A sacrifice outlet wants fodder as much as fodder wants an outlet.
  { tag: 'sacrifice-fodder', test: /\bsacrifice (a|another|an) creature\b/i },
  { tag: 'token', test: /\bfor each creature you control\b|\bcreatures you control get\b/i },
  { tag: 'token', test: /\bwhenever .{0,30}token .{0,20}enters\b/i },

  { tag: 'lifegain', test: /\bwhenever you gain life\b/i },
  /*
   * A life-loss payoff, and the one place `lifeloss` and `player-damage` meet
   * (ADR-0023).
   *
   * The gap stops at a comma for the reason ADR-0022 gives: the comma is where
   * a trigger CONDITION ends, and past it the sentence is the effect. All seven
   * cards the old `.{0,30}` shape misread are producers, and every one of them
   * has that comma — "Whenever you attack, each opponent loses life" (Within
   * Range), "Whenever this creature deals combat damage to a player, that
   * player loses life" (Graveblade Marauder). A direction inversion is the
   * worst error this file can make, and the boundary costs nothing.
   *
   * `los[et]s?` rather than `loses`, because the third person is not the only
   * subject: "whenever YOU LOSE life" is Vilis and Transcendence, and the old
   * rule reached 7 of the 19 real payoffs.
   */
  { tag: 'lifeloss', test: /\bwhenever [^.,\n]{0,40}\blos[et]s? life\b/i },
  /*
   * The same payoff, claimed for damage as well — this is the ADR-0023 bridge.
   *
   * Damage dealt to a player causes that player to lose that much life, so
   * "whenever an opponent loses life" fires off a Lightning Bolt. Exquisite
   * Blood, Mindcrank, Bloodthirsty Conqueror and The Master of Lake-town all
   * carry "(Damage causes loss of life.)" in their own reminder text; the model
   * would be denying something the cards print.
   *
   * The reverse is false, which is the whole shape of the change: NO producer
   * rule emits `lifeloss` for damage, so a drain spell never satisfies a damage
   * payoff. One-way, and expressible only here — `INTERACTION_PAIRS` is
   * unordered.
   *
   * Narrower than the rule above on purpose: only the payoffs about somebody
   * ELSE's life. The producer rules tag damage aimed at players and opponents,
   * never "deals 2 damage to you", so extending the bridge to "whenever you
   * lose life" would offer Vilis a burn spell that never touches your total.
   * That leaves 12 self-life payoffs on `lifeloss` alone, which is correct.
   */
  {
    tag: 'player-damage',
    test: /\bwhenever [^.,\n]{0,40}\b(?:an opponent|a player|that player|one or more (?:opponents|players)|opponents) los[et]s? life\b/i,
  },
  /*
   * The damage payoffs proper: the doublers and the "any source you control"
   * triggers. 59 cards, read one by one.
   *
   * The amplifier rule asks for the CONSEQUENCE, not the subject, because the
   * subject is spelled twenty ways ("a source you control", "a red source", "a
   * Giant source you control", "an instant or sorcery source you control") and
   * because the consequence is what sorts a burn payoff from its opposite:
   * Ghosts of the Innocent halves that damage and Battletide Alchemist prevents
   * it. Both match "would deal damage to a player"; neither is anything a burn
   * deck wants, and requiring "it deals double / triple / that much plus"
   * refuses them.
   *
   * The trigger rule refuses "whenever THIS CREATURE deals damage to an
   * opponent" — Curiosity, Abyssal Specter, Looter il-Kor. Those are evasive
   * creatures hitting in combat, and no burn spell has ever triggered one; the
   * source has to be something other than the card itself for the deck to be
   * able to supply it. Malcolm and Breeches are refused for the same reason one
   * step out: their source is restricted to Pirates you control.
   */
  {
    tag: 'player-damage',
    test: /\bwould deal (?:noncombat )?damage to (?:a permanent or player|an opponent|a player|that player)[^.\n]{0,60}\bit deals (?:double|triple|twice|that much damage plus)\b/i,
  },
  {
    tag: 'player-damage',
    test: /\bwhenever a[a-z ]{0,20}source you control deals (?:noncombat |excess )?damage to (?:an opponent|a player|another player|one or more of your opponents)\b|\bwhenever (?:an opponent|a player) is dealt (?:noncombat )?damage\b/i,
  },
  // Bloodthirst, whose reminder text is a payoff sentence: "if an opponent was
  // dealt damage this turn, this creature enters with N +1/+1 counters on it".
  // It belongs here and not on `damage` (ADR-0029) because it names the subject:
  // a Flame Slash aimed at a creature does not turn it on.
  { tag: 'player-damage', test: /\bbloodthirst\b/i },
  /*
   * The payoffs for damage itself (ADR-0029), and the reason the tag is not
   * inert. ADR-0023 predicted the opposite —
   *
   *   > A `permanent-damage` event would be the honest fix and nothing would
   *   > pay it off.
   *
   * — and the prediction was made about a tag scoped to permanents. Read
   * subject-agnostically the payoff class is 240 commander-legal cards, in four
   * shapes, and each shape gets its own rule because each is a different card.
   *
   * ENRAGE and its cousins: "whenever this creature is dealt damage". 63 cards
   * — Ripjaw Raptor, Boros Reckoner, Stuffy Doll, Brash Taunter, Spitemare — and
   * the keyword is matched by name because Scryfall prints it with reminder
   * text. These want damage pointed at their own side, which no other tag in
   * this file can express.
   */
  { tag: 'damage', test: /\benrage\b|\bwhenever this creature is dealt damage\b/i },
  // The same trigger moved onto somebody else's creature: Repercussion, Blazing
  // Sunsteel, Fiendlash, Rite of Passage. 15 cards.
  {
    tag: 'damage',
    test: /\bwhenever (?:a|an|another|one or more|equipped|enchanted)[a-z' ]{0,28}creatures? (?:you control )?(?:is|are) dealt damage\b/i,
  },
  /*
   * The amplifiers, subject-agnostic. ADR-0023 wrote this rule requiring the
   * damage to land on a player, because `player-damage` was the only damage tag
   * there was; the cards themselves mostly do not say so. Fiery Emancipation
   * reads "if a source you control would deal damage to a PERMANENT OR PLAYER,
   * it deals triple that damage", and Furnace of Rath, Gratuitous Violence and
   * City on Fire are the same sentence. 48 cards.
   *
   * They keep `player-damage` as well, and that is deliberate: one sentence,
   * two events, which is the ruling ADR-0022 made about "each player discards".
   *
   * Asking for the CONSEQUENCE rather than the subject is ADR-0023's device and
   * is kept for its reason: Ghosts of the Innocent halves the damage and
   * Battletide Alchemist prevents it, and both match "would deal damage".
   * Requiring "it deals double / triple / that much plus" refuses them.
   */
  {
    tag: 'damage',
    test: /\bwould deal (?:noncombat )?damage[^.\n]{0,70}\bit deals (?:double|triple|twice|that much damage plus)\b/i,
  },
  /*
   * Toralf's event, which ADR-0023 named as found-and-not-done: "whenever a
   * source you control deals EXCESS damage to a permanent". 30 cards carry
   * "excess damage" and 16 more read "whenever a source you control deals
   * damage" without naming a subject — Tamanoa, Chandra's Pyreling, Chandra's
   * Incinerator, Quest for Pure Flame.
   *
   * The source has to be something other than the card itself, which is the
   * refusal ADR-0023 made on Curiosity: an evasive creature hitting in combat is
   * not something a burn spell can supply.
   *
   * `noncombat` is spelled out rather than allowed as any adjective, and the
   * reason is a measured 176-card false positive: TRAMPLE's reminder text reads
   * "(This creature can deal excess COMBAT damage to the player or planeswalker
   * it's attacking.)" A permissive gap made Colossal Dreadmaw a burn payoff.
   */
  {
    tag: 'damage',
    test: /\bexcess (?:noncombat )?damage\b|\bwhenever a[a-z' ]{0,28}source you control deals (?:noncombat |excess )?damage\b/i,
  },
  // Removal that only works on something your deck already damaged, and the
  // creatures that grow from it: "destroy target creature that was dealt damage
  // this turn" is Witch's Mist, Avenging Arrow, Fathom Fleet Cutthroat and
  // Ogre Siegebreaker. The word `creature` is what keeps bloodthirst out — that
  // reminder text reads "if an OPPONENT was dealt damage this turn", which is
  // the narrower event and belongs to `player-damage` below.
  { tag: 'damage', test: /\bcreature[^.\n]{0,50}\bdealt damage this turn\b/i },

  { tag: 'card-draw', test: /\bwhenever you draw\b|\bif you.{0,20}drawn.{0,20}card\b/i },
  { tag: 'discard', test: /\bmadness\b|\bwhenever you discard\b/i },

  /*
   * The payoffs the old single `discard` tag could not reach (ADR-0022).
   *
   * Megrim, Liliana's Caress, Waste Not, Geth's Grimoire, Raiders' Wake and
   * Tergrid's front face all read "whenever an opponent discards". Under one
   * tag they were paired with madness, which they have nothing to do with.
   */
  //
  // The gap stops at a comma as well as at a full stop, because the comma is
  // where a trigger condition ends. Tergrid reads "whenever an opponent
  // sacrifices a nontoken permanent or discards a permanent card," — one
  // condition, two events, no comma — while Painful Quandary reads "whenever an
  // opponent casts a spell, that player loses 5 life unless they discard a
  // card". Without the comma boundary the second reads as a payoff, and it is
  // the opposite: it is a producer.
  {
    tag: 'opponent-discard',
    test: /\bwhenever (an opponent|a player|one or more (players|opponents))[^.,\n]{0,60}\bdiscards?\b|\ban opponent discarded a card\b/i,
  },
  /*
   * An empty enemy hand is the state a hand-attack deck is playing toward, and
   * the cards that check for it — Tinybones, Guul Draz Specter, Hollowborn
   * Barghest, Rekindled Flame — are unplayable without one. That is a payoff.
   *
   * Deliberately NOT hellbent, which is the same sentence about YOU ("as long
   * as you have no cards in hand"). Hellbent is a self-discard payoff and
   * belongs to `discard`; it is listed in ADR-0022 as found and not done rather
   * than quietly folded in here, because widening `discard` is not this change.
   *
   * The verb is what keeps the two apart, and it is load-bearing rather than
   * incidental: "HAS no cards in hand" is third person and "you HAVE no cards
   * in hand" is not, which is the same inflection test the producer rules use.
   * Matching `ha(s|ve)` here would pull all 34 hellbent cards in.
   */
  {
    tag: 'opponent-discard',
    test: /\b(an opponent|each opponent|that player|target opponent|a player)( [a-z]{1,12}){0,3} has no cards in hand\b|\bopponents? with no cards in hand\b/i,
  },

  // A sacrifice outlet is fed by your board; this is fed by theirs. Tergrid,
  // It That Betrays, Mazirek, Mortician Beetle and Mayhem Devil all trigger on
  // a sacrifice they do not control and could never say so before.
  {
    tag: 'opponent-sacrifice',
    test: /\bwhenever (an opponent|a player|another player)[^.,\n]{0,60}\bsacrifices\b/i,
  },

  { tag: 'graveyard-creature', test: /\breturn target creature card from your graveyard\b/i },
  { tag: 'graveyard-creature', test: /\bdelve\b|\bescape\b|\bthreshold\b|\bdelirium\b/i },
  // The graveyard as a resource — which is what `delve` and `threshold` above
  // already meant, so the tag was never only about creatures. A card that recurs
  // from it, counts it, or pays with it is built for a deck that fills it.
  {
    tag: 'graveyard-creature',
    test: /\bflashback\b|\bunearth\b|\bdisturb\b|\bembalm\b|\beternalize\b|\bdredge\b|\bjump-start\b|\bretrace\b|\baftermath\b|\bencore\b|\bdescend\b/i,
  },
  {
    tag: 'graveyard-creature',
    test: /\breturn (target |up to one target |another target )?(creature|permanent) cards? from (your|a) graveyard\b/i,
  },
  /*
   * The same missing verb, on the side that asks for a full graveyard
   * (ADR-0029). The rules above already accept "a graveyard" as well as "your
   * graveyard" — the diagnosis that they did not was wrong, and checking is
   * what corrected it. What none of them accepts is "put … onto the
   * battlefield", so 41 reanimation cards wanted nothing.
   *
   * Narrower than the `creature-etb` producer by one clause, and on purpose:
   * only "a" or "your" graveyard, never "an opponent's". ADR-0016 ruled that an
   * opponent's graveyard is not the resource this tag names and ADR-0022 kept
   * that ruling, so a card that can only rob theirs — Gruesome Encore, Ink-Eyes,
   * Sepulchral Primordial, 15 in all — is not evidence that a deck wants its own
   * yard filled. "A graveyard" stays in because it includes yours.
   *
   * Not restricted to creature cards, for the reason the rules above give: this
   * tag has meant the graveyard as a resource since `delve` and `threshold` were
   * added to it. Restore, Nomad Mythmaker and Soul of Windgrace recur a land or
   * an Aura and are built for the same deck.
   */
  {
    tag: 'graveyard-creature',
    test: /\bput [^.\n]{0,60}?\bcards? from (?:a|your) graveyard onto the battlefield\b/i,
  },
  { tag: 'graveyard-creature', test: /\bcast .{0,40}from your graveyard\b/i },
  { tag: 'graveyard-creature', test: /\bcards? in your graveyard\b/i },

  {
    tag: 'artifact-etb',
    test: /\bwhenever an artifact (you control )?enters\b|\bwhenever another artifact\b|\bmetalcraft\b|\baffinity for artifacts\b|\bimprovise\b|\bfor each artifact you control\b|\bartifacts you control (get|have)\b/i,
  },
  {
    tag: 'enchantment-etb',
    test: /\bconstellation\b|\bwhenever you cast an enchantment\b|\bwhenever an enchantment (you control )?enters\b|\bwhenever another enchantment\b|\bfor each enchantment you control\b|\benchantments you control (get|have)\b/i,
  },
  { tag: 'treasure', test: /\bwhenever .{0,30}Treasure .{0,20}sacrificed\b/i },
  { tag: 'landfall', test: /\bLandfall\b|\bwhenever a land .{0,20}enters\b/i },
  /*
   * Wanting counters is caring about ones that already exist.
   *
   * This rule used to include `whenever .{0,40}\+1\/\+1 counter`, which is the
   * PRODUCER's phrasing — "Whenever this attacks, put a +1/+1 counter on it".
   * It matched 460 cards, 429 of which also produced counters, so the app
   * paired two counter-makers and announced one as the other's payoff. A
   * direction inversion is worse than a missing tag: it is a confident
   * recommendation pointing the wrong way.
   *
   * What survives is the vocabulary of USING counters rather than making them:
   * proliferate adds to what is there, removing one spends it, and "with a
   * +1/+1 counter on it" is a condition. "enters with" is deliberately not
   * matched — a card making its own is the produce side.
   */
  {
    tag: 'plus1-counter',
    test: /\bproliferate\b|\bremove (a|one|two|three|X|\d+) \+1\/\+1 counter|\+1\/\+1 counter is put on|\btarget [a-z ]{0,25}with (a |one or more )?\+1\/\+1 counters? on|\bcreatures? [a-z ]{0,25}with \+1\/\+1 counters? on (them|it)/i,
  },
  /*
   * The same payoff with an article in it (ADR-0038).
   *
   * The last branch above reads "creatures … with +1/+1 counters on them" and
   * the corpus far more often writes the singular: "each creature you control
   * with A +1/+1 counter on it has trample" is Abzan Battle Priest, Bramblewood
   * Paragon, Tuskguard Captain, Sapphire Drake, Gnarlid Colony — 42 cards.
   *
   * The leading DETERMINER is what stops this being a direction inversion, and
   * it is there because of a measurement rather than a hunch. Adding the article
   * to the existing branch and nothing else reached 182 cards instead of 42, and
   * the extra 140 were PRODUCERS: "THIS creature ENTERS WITH a +1/+1 counter on
   * it for each Zombie card in your graveyard" is Diregraf Colossus, and every
   * bloodthirst reminder text reads the same way. A payoff talks about "each",
   * "another", "all", "target" or "attacking" creatures; a card making its own
   * counters says "this".
   *
   * An explicit `(?!enters)` on the gap was written to say that out loud, and
   * dropped: it moves exactly ZERO cards in the corpus, because the determiner
   * already refuses every one of them, and it survived every mutation the tests
   * could make. That is the same ruling the `itself` exclusion got above — a
   * branch a test cannot fail on is machinery.
   */
  {
    tag: 'plus1-counter',
    test: /\b(?:each|another|other|all|target|attacking) creatures?[a-z' ]{0,25} with (?:a |one or more )?\+1\/\+1 counters? on (?:them|it)\b/i,
  },
  { tag: 'attack-trigger', test: /\bwhenever .{0,30}attacks\b/i },
  /*
   * The attack trigger Magic stopped writing as "attacks" (ADR-0038).
   *
   * The rule above asks for the inflected verb, and the modern template does not
   * use it: "Whenever you attack" is one trigger for the whole team rather than
   * one per creature. Adeline, Ellivere, Bast, Doors of Durin, Thorough
   * Investigation — 149 commander-legal cards, and every one of them wants the
   * same extra combats and the same evasion the rule above already looks for.
   *
   * The qualified forms come along, and should: "whenever you attack WITH ONE OR
   * MORE ELVES" and "…with eight or more creatures" are harder conditions on the
   * same event, exactly as "deals combat damage to a player" is two rules down.
   */
  { tag: 'attack-trigger', test: /\bwhenever you attack\b/i },
  // A combat damage trigger is an attack trigger with a harder condition: it
  // only ever fires because the creature attacked. It wants the same evasion,
  // the same pump and the same extra combats.
  { tag: 'attack-trigger', test: /\bwhenever .{0,45}deals combat damage to a player\b/i },
  { tag: 'untap', test: /\{T\}:/ },

  // An enters-the-battlefield trigger is a card asking to be blinked, and a
  // "whenever another creature enters" trigger is the same deck's payoff. Both
  // want creatures to enter; only the blink effect produces it.
  { tag: 'creature-etb', test: /\bwhen(ever)? this creature enters\b/i },
  {
    tag: 'creature-etb',
    test: /\bwhenever (a|another) (nontoken )?creature (you control )?enters\b|\bwhenever one or more creatures enter\b/i,
  },
  /*
   * The same trigger, written with the card's own NAME (ADR-0038).
   *
   * "When this creature enters" is the 2024 template. 527 commander-legal
   * creatures still print "When Tolsimir enters", "Whenever Ellivere enters or
   * attacks", "When Aang enters" — and every one of them matched nothing, which
   * made this the single largest rule gap in the file.
   *
   * NO `i` FLAG, and that is the whole of the precision. The capital letter is
   * what says "this is a name". Read case-insensitively the subject pattern also
   * fits "whenever AN ARTIFACT you control enters" and "when A LAND enters", and
   * Reckless Fireweaver would ask to be blinked because somebody else's
   * permanent entered. Audited rather than assumed: over all 527 matches the
   * capitalised subject traces back to the card's own name in 527 cases and
   * fails to in none.
   *
   * The type line is asked first, because a name in an enters trigger says
   * nothing about whether a CREATURE entered — Embercleave, Esika's Chariot and
   * Eye of Vecna all read this way and are not creatures. `[\s\S]*` crosses the
   * newline the type line is joined on, which is safe for the reason the module
   * comment gives: the type line is prefixed to every face by construction, so
   * this gap can only ever run from the type line into one face's own text.
   *
   * SUBSTITUTING the name out of the text was written, measured and REJECTED.
   * It reaches 12 more cards than this rule — the ones whose name carries a full
   * stop, "J. Jonah Jameson", "Ms. Marvel", "U.S.Agent" — and it costs 30 cards
   * their existing tags, because a card's name is also ordinary English: all 20
   * cards named "… Storm" lose `spell-cast`, since the keyword STORM is what
   * that rule reads and substitution eats the word. Cheaper to miss twelve
   * cards than to break thirty.
   */
  { tag: 'creature-etb', test: /^[^\n]*\bCreature\b[\s\S]*\b[Ww]hen(?:ever)? [A-Z][^,.\n]{0,28} enters\b/ },

  {
    tag: 'spell-cast',
    test: /\bprowess\b|\bmagecraft\b|\bstorm\b|\bwhenever you cast (an instant|a sorcery|your first|an? noncreature)|\binstant and sorcery spells you (cast|control)\b|\bwhenever you copy an instant\b/i,
  },
  /*
   * The trigger that names no card type at all (ADR-0038).
   *
   * The rule above lists the types a spellslinger deck casts, and 246 cards ask
   * for none of them: "Whenever you cast a spell" is Aetherflux Conduit, Song of
   * Creation, Arjun, every extort creature and every heroic creature. An instant
   * or sorcery — which is the whole of what `spell-cast` produces — satisfies it
   * by definition, so the pairing is true in the direction that matters.
   *
   * The qualified forms are IN and are the imprecision this rule accepts:
   * "whenever you cast a spell with mana value 5 or greater" is not turned on by
   * a Ponder. Six cards, against 246, and pinning them out would need a lookahead
   * no test could fail on — the same trade the file makes on `itself` above.
   */
  { tag: 'spell-cast', test: /\bwhenever you cast a spell\b/i },
  /*
   * A payoff for the tokens themselves (ADR-0038).
   *
   * `token`'s payoffs were "for each creature you control" and "creatures you
   * control get" — both of which are anthems for a whole board. The anthem that
   * only reaches TOKENS is a stronger claim about the same deck and read as
   * nothing: Intangible Virtue, Phantom General, Teysa Karlov, Combine Chrysalis.
   * 37 cards, read one by one, all token decks.
   */
  { tag: 'token', test: /\btokens you control (?:get|gain|have)\b/i },
]

export interface SynergyProfile {
  readonly produces: readonly SynergyTag[]
  readonly wants: readonly SynergyTag[]
}

export const EMPTY_PROFILE: SynergyProfile = { produces: [], wants: [] }

export type SynergyOverrides = ReadonlyMap<OracleId, SynergyProfile>

export const CURATED_SYNERGY: SynergyOverrides = new Map()

const apply = (rules: readonly Rule[], texts: readonly string[]): SynergyTag[] => {
  const found = new Set<SynergyTag>()
  for (const rule of rules) {
    if (texts.some((text) => rule.test.test(text))) found.add(rule.tag)
  }
  return [...found]
}

/**
 * Derive a card's synergy profile from its oracle text.
 *
 * A card may both produce and want the same tag — a sacrifice outlet that also
 * triggers on death is a whole engine by itself — and that is kept rather than
 * collapsed, because it is true. Tergrid is the clearest case: her front face
 * WANTS `opponent-discard` and her Lantern PRODUCES it, so she is her own
 * engine, and reporting only one of those would describe a different card.
 *
 * Read one FACE at a time, not the joined text.
 *
 * `oracleText` joins a double-faced card's faces with a newline, and some rules
 * span a gap that a newline can sit inside (`[^.]{0,40}` in the `dies` rule,
 * `[^.]{0,60}` in the landfall one). On the joined string a subject on the
 * front face can therefore find its verb on the back — two abilities that never
 * share a game state, read as one sentence. Per face that cannot happen at all,
 * rather than happening not to.
 *
 * **Measured, and it changes nothing today: 0 of the 825 multi-faced
 * commander-legal cards derive differently split than joined.** The reason is
 * that a `[^.]` gap can only cross the join when the front face's last line
 * carries no full stop, and real oracle text ends its sentences — so the join
 * is safe by accident of templating, not by construction.
 *
 * The number is worth stating because it also answers the question this change
 * was expected to turn on. Tergrid is right either way round: her faces
 * disagree about DIRECTION, not about subject, and `produces` and `wants` are
 * separate rule sets, so the union over faces and the match over the join are
 * the same set. Reading faces separately is not what fixed Tergrid.
 *
 * It is kept because it makes the boundary structural instead of incidental —
 * the two rules above are safe only because nothing has yet been written on
 * both sides of a `//` — and because the union across faces is the right model
 * of the question: a card is a producer if either half produces.
 *
 * The type line is prefixed to every face rather than split with it. Scryfall
 * gives one joined type line per card ("Legendary Creature — God // Legendary
 * Artifact") and no per-face decomposition, and the `^[^\n]*` rules ask "is
 * this card an artifact / an instant", which is a question about the card.
 * Splitting a string we were never handed would be a guess.
 */
export const deriveSynergy = (
  card: Pick<Card, 'oracleId' | 'oracleText' | 'typeLine'> & Partial<Pick<Card, 'oracleTextFaces'>>,
  options: { readonly curated?: SynergyOverrides } = {},
): SynergyProfile => {
  const curated = (options.curated ?? CURATED_SYNERGY).get(card.oracleId)
  if (curated !== undefined) return curated

  // Absent means "single-faced, or ingested before the column existed"; the
  // whole text is the only answer available and is the right one for the first.
  const faces = card.oracleTextFaces ?? [card.oracleText]
  const texts = faces.map((face) => `${card.typeLine}\n${face}`)
  return { produces: apply(PRODUCES, texts), wants: apply(WANTS, texts) }
}

/**
 * What the deck already does and already wants.
 *
 * The commander counts for more than an accepted card, and heavily: a Commander
 * deck is built around its commander, and a 99-card deck would otherwise drown
 * the one card that defines it.
 */
export interface DeckSynergy {
  /** Tag → weight. */
  readonly produces: ReadonlyMap<SynergyTag, number>
  readonly wants: ReadonlyMap<SynergyTag, number>
}

export const COMMANDER_WEIGHT = 4

export const deckSynergy = (
  commanders: readonly OracleId[],
  accepted: readonly OracleId[],
  profileOf: (id: OracleId) => SynergyProfile | undefined,
): DeckSynergy => {
  const produces = new Map<SynergyTag, number>()
  const wants = new Map<SynergyTag, number>()

  const add = (
    into: Map<SynergyTag, number>,
    tags: readonly SynergyTag[],
    weight: number,
  ): void => {
    for (const tag of tags) into.set(tag, (into.get(tag) ?? 0) + weight)
  }

  for (const id of commanders) {
    const profile = profileOf(id)
    if (profile === undefined) continue
    add(produces, profile.produces, COMMANDER_WEIGHT)
    add(wants, profile.wants, COMMANDER_WEIGHT)
  }
  for (const id of accepted) {
    if (commanders.includes(id)) continue
    const profile = profileOf(id)
    if (profile === undefined) continue
    add(produces, profile.produces, 1)
    add(wants, profile.wants, 1)
  }

  return { produces, wants }
}

export interface SynergyMatch {
  readonly tag: SynergyTag
  /**
   * `enables` = the card provides what the deck wants.
   * `payoff`  = the reverse; the card pays off what the deck already provides.
   * `theme`   = neither, but the card wants the same thing other cards want.
   */
  readonly direction: 'enables' | 'payoff' | 'theme'
  readonly weight: number
}

/**
 * A shared want counts, at a fraction.
 *
 * Two cards that both pay off +1/+1 counters are in the deck for the same
 * reason — that is a real relationship, and calling it "no synergy" because
 * neither happens to PRODUCE the counters is a narrower question than the one
 * the user is asking. It is genuinely weaker than an enable, though: a theme
 * without an engine wins no games, so it is worth a fifth.
 *
 * A shared PRODUCE is deliberately not counted. Two sacrifice outlets are
 * redundancy, not synergy, and counting it would make every token deck claim
 * that every token maker synergises with every other one.
 */
export const THEME_WEIGHT = 0.2

/**
 * How well a candidate fits what the deck is already doing.
 *
 * Both directions, and the strongest match leads — a card that enables the
 * commander's death trigger should say so, not report a weak land synergy it
 * also happens to have.
 */
export interface SynergyMatchOptions {
  /**
   * Whether the candidate is itself one of the cards `deck` was built from.
   *
   * True when scoring a card already in the deck (a cut hint), false when
   * scoring one that is not (a recommendation). It only affects `theme`: every
   * accepted card contributes its own wants to `deck.wants`, so without this a
   * card in the deck would always share a theme with itself.
   */
  readonly selfCounted?: boolean
}

export const synergyMatches = (
  candidate: SynergyProfile,
  deck: DeckSynergy,
  options: SynergyMatchOptions = {},
): readonly SynergyMatch[] => {
  const matches: SynergyMatch[] = []

  for (const tag of candidate.produces) {
    const weight = deck.wants.get(tag) ?? 0
    if (weight > 0) matches.push({ tag, direction: 'enables', weight })
  }
  for (const tag of candidate.wants) {
    const weight = deck.produces.get(tag) ?? 0
    if (weight > 0) matches.push({ tag, direction: 'payoff', weight })
  }

  // Only where there was no stronger reading of the same tag: a card that
  // already pays off the deck's engine should not also be credited for wanting
  // what its neighbours want.
  const strong = new Set(matches.map((m) => m.tag))
  for (const tag of candidate.wants) {
    if (strong.has(tag)) continue
    const shared = (deck.wants.get(tag) ?? 0) - (options.selfCounted === true ? 1 : 0)
    if (shared > 0) matches.push({ tag, direction: 'theme', weight: shared * THEME_WEIGHT })
  }

  return matches.sort((a, b) => b.weight - a.weight)
}

/**
 * A 0..1 score from the matches.
 *
 * Saturating rather than linear: the fifth tag a card shares with the deck
 * matters far less than the first, and without this a card that trips six weak
 * heuristics would outrank one that perfectly enables the commander.
 */
export const synergyScore = (matches: readonly SynergyMatch[]): number => {
  if (matches.length === 0) return 0
  const total = matches.reduce((sum, m) => sum + m.weight, 0)
  return total / (total + COMMANDER_WEIGHT)
}
