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
  // A creature that arrives with counters on it is a +1/+1 deck's payload, and
  // that templating never says "put".
  { tag: 'plus1-counter', test: /\benters with (a|an|one|two|three|four|X|\d+) \+1\/\+1 counter/i },
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
  { tag: 'attack-trigger', test: /\bwhenever .{0,30}attacks\b/i },
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

  {
    tag: 'spell-cast',
    test: /\bprowess\b|\bmagecraft\b|\bstorm\b|\bwhenever you cast (an instant|a sorcery|your first|an? noncreature)|\binstant and sorcery spells you (cast|control)\b|\bwhenever you copy an instant\b/i,
  },
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
