import { TAKES_EXTRA_TURN } from './bracket-barometers.js'
import type { Card } from './card.js'
import type { OracleId } from './ids.js'
import {
  deriveWantQualifiers,
  satisfiesQualifiers,
  type QualifiedWant,
  type WantQualifier,
} from './qualifiers.js'
import { SEMANTIC_TAGS, deriveSemanticTokens, type SemanticTag } from './semantic-tokens.js'
import { CREATES_FOR_YOU, addressedToYou, forYou } from './token-subject.js'

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

/**
 * The curated events. Twenty-one, hand-written, each with an ADR behind it.
 *
 * `SynergyTag` is wider than this: ADR-0046 adds the two OPEN vocabularies —
 * subtypes and keywords — which cannot be hand-curated because the game keeps
 * printing new ones. They live in `semantic-tokens.ts` and are generated from
 * the corpus. Everything in THIS file is about the closed list: the regex
 * tables below and `INTERACTION_PAIRS` are all event-only, and the pairs table
 * stays small precisely because the new families need no pairs at all — their
 * relation is same-tag-opposite-direction, which the model already has.
 */
export type EventTag =
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
  | 'land-creature'
  | 'opponent-mill'
  | 'extra-turns'
  /**
   * Mana you get ONCE, in a lump (ADR-0054). Dark Ritual, Seething Song,
   * Krark-Clan Ironworks, Basal Thrull.
   *
   * `ramp` already exists as a ROLE and this is not a second copy of it. A role
   * is a partition for COUNTING — exactly one per card — so it holds Sol Ring,
   * Cultivate, Llanowar Elves and Dark Ritual in one bucket of 1,385, and it
   * cannot be emphasised at all: `emphasis` reads tags, never roles. What
   * neither the role nor any other tag can say is the distinction that makes a
   * ritual a ritual, which is that the mana does not come back next turn.
   */
  | 'ritual'
  /**
   * A payoff for CASTING A CREATURE (ADR-0054). Beast Whisperer, Vanquisher's
   * Banner, Oketra's Monument.
   *
   * Payoff-only, and deliberately: see the `WANTS` rule for the measurement
   * that refused the producer side.
   */
  | 'creature-cast'
  /**
   * YOUR OWN life, going down (ADR-0059, amending ADR-0023).
   *
   * Dark Confidant, Necropotence, Grim Tutor, Bellowing Saddlebrute and Feed
   * the Swarm on the producer side; Vilis, Transcendence and the two Liches on
   * the payoff side.
   *
   * `lifeloss` had no subject test, and 257 of its 1,062 commander-legal
   * producers lose the life THEMSELVES while the panel renders the tag as
   * "opponents losing life". ADR-0023 saw the payoff half of this and left it —
   * "that leaves 12 self-life payoffs on `lifeloss` alone, which is correct" —
   * and never measured the producers. With both sides subject-agnostic the tag
   * matched in BOTH wrong directions at once: 257 self-producers against 7
   * opponent payoffs, and 805 opponent-producers against 10 self ones.
   *
   * A SUBJECT TEST ALONE COULD NOT FIX IT, which is why this is a tag and not a
   * regex, and it is the one place in ADR-0059 where the answer was a new name
   * rather than a narrower rule. Narrowing only the producer leaves Vilis
   * wanting an event nothing emits. Narrowing both sides deletes the Vilis deck
   * — which is the mistake ADR-0016 records against itself, "narrowed it to
   * here and stopped, which deleted the opponent side rather than modelling
   * it". An event with two subjects needs two names, which is ADR-0022's whole
   * finding.
   *
   * 317 producers and 12 payoffs, the same order as `land-creature`'s 185 and
   * 12 — the count ADR-0047 admitted a tag on.
   *
   * NAMED FOR THE SELF SIDE, against the convention that the bare tag is yours
   * (`discard` / `opponent-discard`). `lifeloss` is a stored value whose label
   * has said "opponents" since it was written, so renaming it would break every
   * deck that emphasises it in order to fix a word. The asymmetry is the
   * cheaper of the two and it is written down here so the next reader does not
   * quietly "correct" it.
   */
  | 'self-lifeloss'

export type SynergyTag = EventTag | SemanticTag

export const EVENT_TAGS: readonly EventTag[] = [
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
  'land-creature',
  'opponent-mill',
  'extra-turns',
  // APPENDED, which the docblock below requires: a tag inserted in the middle
  // shifts every generated family's index and silently reorders the emphasis
  // stored against decks that already exist.
  'ritual',
  'creature-cast',
  // ADR-0059, appended for the reason the two above were: the ORDER is the
  // persisted contract, so a new event goes on the end and never in the middle.
  'self-lifeloss',
]

/**
 * Every tag, curated and derived.
 *
 * APPEND-ONLY, and that is a persisted contract rather than a style note:
 * `semantic-emphasis.ts` sorts a deck's stored emphasis into this array's ORDER
 * and migration 0014 documents the guarantee, so inserting a tag in the middle
 * silently reorders scoring ties for decks that already exist. The events come
 * first and keep their existing indices; the generated families are appended.
 */
export const SYNERGY_TAGS: readonly SynergyTag[] = [...EVENT_TAGS, ...SEMANTIC_TAGS]

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
 *
 * ADR-0023 and ADR-0029 both left a note here that an ORDERED table was becoming
 * overdue. ADR-0045 settles it: the answer is no, and the reason is the
 * admission criterion two paragraphs up. Every row in this table was let in only
 * because it reads true in both directions — the one-way relations were refused
 * entry and carried on the payoff side instead — so a row's direction is not
 * information this shape discarded, it is information the criterion excludes.
 * Directing the table would mean inventing it once per row. Read ADR-0045 before
 * reopening this; the case that would justify it is a feature that must tell
 * "what causes X" from "what X causes" ACROSS tags, and none has arrived yet.
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

  /*
   * A land that is also a creature (ADR-0047).
   *
   * `landfall` because the two are the same deck read from either end: the
   * lands are the bodies, so a card that puts more lands onto the battlefield
   * is a card that puts more attackers there, and a deck built to animate its
   * mana base is a deck that wants a lot of mana base. True in both directions,
   * which is the bar this table sets.
   *
   * `attack-trigger` because it is what the payoffs are FOR. Every one of the
   * twelve — Sylvan Advocate, Embodiment of Fury, Halimar Tidecaller, Tatyova,
   * Toph — grants vigilance, trample, flying or double strike, and nobody
   * prints those on a permanent that stays home. An extra combat is worth more
   * when the mana base swings.
   *
   * `plus1-counter` because the animation and the counters arrive in the same
   * sentence and neither works without the other: earthbend N and awaken N BOTH
   * turn the land into a 0/0 AND put N +1/+1 counters on it, so the counters
   * are the only reason the land survives the transformation. That is two
   * effects needing each other, not the trigger-condition-and-effect confusion
   * ADR-0023 refused — the counters do not merely accompany the animation, they
   * are what makes it a creature worth having.
   *
   * `token` and `sacrifice-fodder` are REFUSED, and the refusal is the reason
   * this tag exists rather than reusing them. An animated land is a body, so the
   * resemblance is real and it is exactly what makes the mistake tempting. But
   * the bodies are the player's MANA BASE: pairing them with `sacrifice-fodder`
   * would offer Ashnod's Altar to a Sylvan Advocate deck and call its lands
   * expendable, which is the opposite of how that deck is played. `token` is
   * refused one step behind it, for the same reason — a token is made to be
   * spent and a land is not.
   */
  ['land-creature', 'landfall'],
  ['land-creature', 'attack-trigger'],
  ['land-creature', 'plus1-counter'],

  /*
   * Milling an OPPONENT (ADR-0048), and the one pair the evidence supports.
   *
   * `opponent-mill` ↔ `opponent-discard` because the cards say both in one
   * breath, which is the bar ADR-0022 set for exactly this shape: Lo and Li,
   * Royal Advisors reads "whenever an opponent DISCARDS a card OR MILLS one or
   * more cards", and a deck built to strip an opponent's hand is the deck built
   * to strip their library.
   *
   * `opponent-mill` ↔ `graveyard-creature` is REFUSED, and refusing it is the
   * whole reason this tag is not just "mill". ADR-0016 ruled that an opponent's
   * graveyard is not the resource, ADR-0022 kept that ruling, and pairing them
   * would offer a self-mill reanimator deck a Glimpse the Unthinkable on the
   * grounds that both put cards in a graveyard. Different graveyard.
   *
   * `opponent-mill` ↔ `card-draw` was considered on the strength of the
   * deck-out kill — an empty library is a loss on the next draw — and refused:
   * the card that mills is not the card that makes them draw, and every deck
   * draws on its own turn anyway, so the pair would be true of the format
   * rather than of a deck.
   */
  ['opponent-mill', 'opponent-discard'],

  /*
   * An extra turn (ADR-0048), and one pair.
   *
   * `extra-turns` ↔ `attack-trigger` because `attack-trigger`'s own producer
   * rule is already "additional combat phase", and an extra turn is that claim
   * writ larger — the same untap, the same attack, plus everything else. It
   * reads true in both directions, which is the bar this table sets: a deck
   * full of attack triggers wants more turns, and a deck taking extra turns
   * wants something to do with them.
   *
   * SAY IT PLAINLY: this tag CANNOT SCORE today. Measured over the corpus, 53
   * cards take an extra turn and NOTHING pays one off — the payoff templates
   * that looked promising all matched the Force cycle's "if it's not your
   * turn", which is about instant-speed interaction and not about extra turns
   * at all. `synergyMatches` needs a `wants` on the other side, and there is
   * none, so `extra-turns` is vocabulary and a label rather than a score. That
   * is the same standing the derived keyword families have (ADR-0046) and it is
   * stated here rather than left for someone to discover — a pair in this table
   * does not make a tag score, because `interactsWith` feeds the card panel and
   * not the matcher.
   */
  ['extra-turns', 'attack-trigger'],

  /*
   * Life as a resource you spend (ADR-0059).
   *
   * `self-lifeloss` ↔ `card-draw` because that is what the deck is: Necropotence,
   * Bolas's Citadel, Vilis, Griselbrand and Ad Nauseam all turn life into
   * cards, and it reads true in both directions — a deck that pays life wants
   * something to buy, and a card that draws off life loss wants a way to lose
   * it on purpose.
   *
   * `self-lifeloss` ↔ `lifegain` because gaining it back is how the deck
   * survives doing that, which is the mirror of the `lifegain` ↔ `lifeloss`
   * pair already above and true for the same reason.
   *
   * `self-lifeloss` ↔ `lifeloss` is REFUSED, and refusing it is the whole point
   * of the split. They are one verb with two subjects, and a tag does not feed
   * itself — ADR-0022's `discard` ↔ `opponent-discard` refusal, one event over.
   * `self-lifeloss` ↔ `player-damage` is refused for ADR-0023's reason: damage
   * aimed at YOU is a cost no producer rule emits, so the bridge would claim a
   * burn spell fires Vilis when nothing in the model says it touches your total.
   */
  ['self-lifeloss', 'card-draw'],
  ['self-lifeloss', 'lifegain'],

  /*
   * A ritual and the deck that spends it (ADR-0054).
   *
   * `ritual` ↔ `spell-cast` because it reads true in both directions, which is
   * the bar this table sets: a lump of mana is how a storm deck casts its next
   * spell, and a deck full of cheap spells is what makes a lump of mana worth a
   * card. It is also the pairing the payoff side was measured on — 37 storm
   * cards and 60 that trigger on your second spell each turn.
   *
   * `ritual` ↔ `treasure` is REFUSED, and the refusal is close enough to hurt.
   * A Treasure is a stored lump of mana and the resemblance is exact for one
   * turn. But `treasure`'s existing pairs are `artifact-etb` and
   * `sacrifice-fodder` — it is in this model as an ARTIFACT that happens to
   * make mana, which is why Treasure decks are artifact decks — and pairing it
   * here would offer Dark Ritual to a Marionette Master deck on the strength of
   * a word neither card says.
   *
   * `creature-cast` gets NO pair, for the reason `extra-turns` gets almost
   * none: it has one side only, so a pair would be a claim about a relation
   * this model cannot currently see either half of.
   */
  ['ritual', 'spell-cast'],
]

// Over the EVENTS only. The table above is event-only by construction, and the
// derived families need no entry in it: their relation is same-tag-opposite-
// direction, which the model already has. `interactsWith` answers `[]` for them
// through its own `?? []`, which is the same "gap, not a claim" the docblock
// below already describes.
const INTERACTIONS = ((): ReadonlyMap<SynergyTag, readonly SynergyTag[]> => {
  const map = new Map<SynergyTag, SynergyTag[]>(EVENT_TAGS.map((t) => [t, []]))
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
 * Two or more mana in one go, in the three ways Scryfall templates an amount
 * (ADR-0054). Shared by the two `ritual` producer rules below so the threshold
 * is stated once.
 *
 * `\{[WUBRGCX0-9/]+\}` twice over reads "Add {B}{B}" and "Add {R}{R}{R}{R}{R}";
 * the word forms read "Add two mana of any one color" and "Add X mana".
 */
const ADDS_TWO_OR_MORE = String.raw`\bAdd (?:\{[WUBRGCX0-9/]+\}\s*){2,}|\bAdd (?:two|three|four|five|six|seven|X) mana\b`

/**
 * How far a token's description may run, MEASURED TO THE WORD `token`
 * (ADR-0059).
 *
 * Three rules read one clause — "create a 1/1 colorless Thopter artifact
 * creature token with flying" — and each wants a different thing out of it:
 * that a token was made, that it was a creature, that it was an artifact. They
 * used to spell the window out three times, each in front of a different noun
 * phrase, and that is the defect:
 *
 *   token            `.{0,40}\btoken`
 *   sacrifice-fodder `.{0,40}\bcreature token`
 *
 * `creature token` STARTS nine characters earlier than the bare word `token`
 * does, so at the same window size the NARROWER rule is the EASIER one to
 * match. Every token described in 32 to 40 characters was fodder that was not a
 * token: 277 commander-legal cards, reported on Aviation Pioneer, whose row
 * said `primary_role: token-maker` beside tags claiming it makes no tokens.
 *
 * So all three windows now END AT THE SAME WORD and the difference between the
 * rules is a zero-width lookbehind. `sacrifice-fodder ⊆ token` is then true by
 * construction rather than by arithmetic, which is what the property test in
 * the suite pins — a number chosen by measurement can be un-chosen, and an
 * invariant cannot.
 *
 * 49 IS THE VALUE THAT CHANGES NOTHING ELSE, and that is why it is 49 rather
 * than a round number: it is the old 40 plus the nine characters of
 * "creature ", so `sacrifice-fodder` reads exactly the 2,536 cards it read
 * before and `token` gains the 277 it should always have had. Widening further
 * keeps paying a little (50 adds 22, 60 adds 59) and every extra card is one
 * `sacrifice-fodder` was already claiming, which is a second change and not
 * this one.
 *
 * The gap stays `.` rather than becoming `[^.\n]`: measured over the corpus, a
 * sentence-crossing gap matches ZERO cards that the sentence-bounded one
 * refuses, and this file's own ruling is that a branch a test cannot fail on is
 * machinery.
 */
const TOKEN_DESCRIPTION = String.raw`.{0,49}`

/**
 * Refuses a verb whose subject is YOU (ADR-0059).
 *
 * The mirror of `token-subject.ts`'s `forYou`, and it lives here rather than
 * there because it is the answer to a different question. That file refuses the
 * clauses that are somebody ELSE's, for tags whose events are yours; this
 * refuses the clauses that are YOURS, for the one tag whose event is theirs.
 * One subject test cannot be both, and pretending otherwise is how the
 * fifty-character window got shared in the first place.
 *
 * Zero-width and adjacent, for the reason the general refusal is: "whenever an
 * opponent loses life, YOU gain that much" is one sentence with two subjects.
 */
const NOT_YOUR_OWN =
  String.raw`(?<!\byou )(?<!\byou may )(?<!\byou'd )(?<!\byou would )(?<!\byou’d )`

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
   * The outlet that names a creature TYPE instead of the word "creature"
   * (ADR-0038).
   *
   * Reported as "ambush commander has no semantic tags. why is that?" — because
   * every rule above asks for the literal word, and Ambush Commander says
   * "Sacrifice an Elf". So did Skirk Prospector, Cabal Archon, Blood-Chin
   * Fanatic, Marrow-Gnawer and every other tribal outlet: 105 cards.
   *
   * A DENY LIST, not an allow list, and the choice was measured rather than
   * guessed. Both directions were tried:
   *
   *   - ALLOW (match against the creature subtypes the corpus's own type lines
   *     carry) FAILS TWICE. It admits what it should refuse — "Food" is a
   *     creature subtype because Gingerbrute is an Artifact Creature — Food, and
   *     so are Clue, Treasure, Equipment and Forest (Dryad Arbor) — which is 82
   *     card-mentions of false positives. And it refuses what it should admit:
   *     Servo, Pentavite, Prism, Balloon, Caribou and Goat are creature types no
   *     CARD carries, only tokens, so they are invisible to a list built from
   *     card type lines.
   *   - CORROBORATION (require the type to appear on this card's own type line
   *     or in a token it makes) reads Ambush Commander and Skirk Prospector, and
   *     misses Airdrop Condor — a Bird that sacrifices Goblins and makes none.
   *
   * So the rule admits any capitalised noun except the ones measured to be
   * something other than a creature. Every deny entry earns its place: Food 45,
   * Forest 20, Clue 20, Mountain 19, Island 13, Swamp 13, Treasure 13, Desert 8,
   * Blood 7, Aura 3, Plains 2, Powerstone 1, Junk 1, Equipment 1, Room 1.
   * `Map|Gold|Incubator` block nothing today and are kept for one reason: they
   * are already this file's vocabulary for an artifact token, in the
   * `artifact-etb` rule above, and two lists of the same nouns that disagree is
   * how the next one goes wrong. Fourteen further speculative types (Vehicle,
   * Saga, Shrine, Cave, Gate, Locus…) were written and DROPPED — they blocked
   * nothing, and a deny entry no card exercises is machinery.
   *
   * NO `i` FLAG, and it carries the whole distinction: the capital is what marks
   * a type. Read case-insensitively this matches "sacrifice a creature" and
   * "sacrifice an artifact", which the rules above already own and mean something
   * different. `[Ss]` covers the two ways Scryfall starts the clause.
   *
   * `creature-death` only, never `sacrifice-fodder`. An outlet WANTS fodder
   * because you feed it your board, and a generic token maker does not make
   * Clerics — the fodder here has to be of a named type, and no tag in this file
   * can say which. Same ruling the self-sacrifice rule above gets.
   */
  {
    tag: 'creature-death',
    test: /\b[Ss]acrifices? (?:a|an|another|two|three|X|\d+) (?!(?:Clue|Food|Blood|Treasure|Powerstone|Junk|Map|Gold|Incubator|Equipment|Plains|Island|Swamp|Mountain|Forest|Desert|Aura|Room)s?\b)[A-Z][A-Za-z'-]*/,
  },

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

  /*
   * WHOSE tokens (ADR-0054). `create(s)?` read the verb and not the subject, so
   * "target opponent creates a 1/1 Spirit" was a token you could sacrifice —
   * Forbidden Orchard, the six Hunted creatures, Clackbridge Troll, Akroan
   * Horse. 31 commander-legal cards, every one read by hand.
   *
   * The subject test is `token-subject.ts`, shared with `semantic-tokens.ts`
   * and `role-derivation.ts` because all three made this mistake separately.
   *
   * The WINDOW is `TOKEN_DESCRIPTION` and the anchor is the word `token`, which
   * is ADR-0059 and is the reason these three rules now read the way they do.
   */
  { tag: 'token', test: new RegExp(`${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}\\btoken`, 'i') },
  /*
   * The doublers, which never say "create" in the active voice (ADR-0048, found
   * by the commander sweep).
   *
   * Doubling Season, Anointed Procession, Primal Vigor, Parallel Lives, Mondrak,
   * Adrix and Nev, Chatterfang and Divine Visitation all read "if one or more
   * tokens WOULD BE CREATED under your control…". They are the most-played token
   * cards in the format and the rule above could reach none of them: it wants
   * "create" followed by "token" within forty characters, and a replacement
   * effect puts the verb after its object and in the passive.
   *
   * 15 cards that were carrying no token tag. PRODUCES rather than WANTS,
   * because a doubler makes tokens — it makes them out of other tokens, which is
   * still making them, and treating it as a payoff would invert the direction on
   * the single most-played enchantment in the archetype.
   *
   * `sacrifice-fodder` is deliberately NOT added alongside, unlike the rule
   * above: a doubler doubles whatever the deck already makes, and the card that
   * makes the creature tokens is the one that should claim the bodies.
   */
  { tag: 'token', test: /\btokens? would be created\b|\bwould create one or more tokens\b/i },
  // Same subject test, and this is the tag the report was written about: an
  // aristocrats deck reads `sacrifice-fodder` as bodies it may eat, and these
  // bodies are the opponent's.
  //
  // The `creature` is a ZERO-WIDTH lookbehind rather than part of the noun
  // phrase, which is what makes this rule's matches a subset of `token`'s by
  // construction rather than by arithmetic (ADR-0059).
  {
    tag: 'sacrifice-fodder',
    test: new RegExp(`${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}(?<=\\bcreature )\\btoken`, 'i'),
  },

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
  /*
   * The same subject test as the two rules above (ADR-0054). An artifact token
   * handed to an opponent does not put an artifact onto YOUR battlefield, which
   * is the whole of what the payoff asks for.
   *
   * Same anchor as the two rules above, and one adjective wider (ADR-0059). The
   * rule wanted `artifact token` adjacent and the game writes the whole type
   * line out: "create a 1/1 colorless Thopter ARTIFACT CREATURE token with
   * flying". 133 commander-legal cards — Foundry of the Consuls, Sram's
   * Expertise, Tezzeret, every Servo and Thopter and Mite maker that is not
   * itself an artifact — and a Thopter is an artifact entering the battlefield
   * whatever else it also is.
   */
  {
    tag: 'artifact-etb',
    test: new RegExp(
      `${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}(?<=\\b(?:artifact|Clue|Food|Blood|Treasure|Powerstone|Junk|Map|Gold|Incubator|Equipment) (?:creature )?)\\btoken`,
      'i',
    ),
  },

  /*
   * The numbers were a closed list of one, so "gain 4 life" read as nothing.
   *
   * WHOSE LIFE (ADR-0059). Swords to Plowshares — "Exile target creature. ITS
   * CONTROLLER gains life equal to its power" — ranked #1 in Staples for a
   * Heliod deck on the reason "enables your emphasised gaining life", and
   * Heliod triggers on YOU gaining life. 24 commander-legal cards, every one
   * read by hand, every one a card that hands the life across the table:
   * Illumination, Nature's Claim, Condemn, Oust, Last Breath, both
   * Phelddagrifs, Grove of the Burnwillows, the free-spell cycle that pays an
   * opponent life for its own cost.
   *
   * `lifelink` keeps no subject test, and does not need one: it is a keyword on
   * a permanent, and the permanent is on the battlefield of whoever controls
   * it, which in a deck of yours is you.
   */
  {
    tag: 'lifegain',
    test: new RegExp(
      `${forYou()}\\bgains? (\\d+|X) life\\b|${forYou()}\\bgains? life equal to\\b|${forYou()}\\bgains? that much life\\b|\\blifelink\\b`,
      'i',
    ),
  },
  /*
   * WHOSE LIFE (ADR-0059). "You lose life equal to its mana value" is Dark
   * Confidant, and this tag's label is "opponents losing life" — so a Vito deck
   * was offered a card that takes life off its own total as an enabler for
   * taking it off theirs. 257 of the 1,062 producers, and their life loss is a
   * COST rather than a plan, which is the refusal ADR-0023 §6 already made one
   * tag over on "deals 2 damage to you".
   *
   * The self side is not deleted, it is MOVED — see `self-lifeloss` below and
   * the tag's own docblock for why a subject test alone could not do this.
   *
   * `you'd` and `you would` are in the refusal because the replacement-effect
   * templating writes them: "if you would lose life, you lose that much life
   * plus 1 instead".
   */
  {
    tag: 'lifeloss',
    test: new RegExp(
      `${NOT_YOUR_OWN}\\bloses? (\\d+|X) life\\b|${NOT_YOUR_OWN}\\bloses? life equal to\\b|${NOT_YOUR_OWN}\\bloses? that much life\\b`,
      'i',
    ),
  },
  /*
   * The same verb, the other subject (ADR-0059). 317 commander-legal cards.
   *
   * "Each player loses" deliberately matches this AND `lifeloss`, which is
   * ADR-0022's ruling about "each player discards": a symmetric drain takes
   * life off your total and theirs, and claiming one side and not the other
   * would be false whichever side you picked.
   */
  {
    tag: 'self-lifeloss',
    test: /\byou (?:may |would |'d )?lose (?:\d+|X) life\b|\byou (?:may |would )?lose life equal to\b|\byou (?:may |would )?lose that much life\b|\beach player loses\b/i,
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

  /*
   * WHOSE CARD (ADR-0059). "Target opponent draws a card" is Bargain, and every
   * rule here read the verb and not the subject — so a card whose whole text is
   * a gift to an opponent came back as a draw engine, with `draw` as its
   * primary role. 37 commander-legal cards, all read by hand: Bargain, Lord of
   * Tresserhorn, Master of the Feast, Forced Fruition, Thought-Knot Seer, Call
   * to Heel, Introduction to Annihilation, both Phelddagrifs.
   *
   * Half of them are not gifts at all but TRIGGER CONDITIONS — "whenever an
   * opponent draws a card, this deals 1 damage to that player" is Underworld
   * Dreams, Fate Unraveler, Razorkin Needlehead, Orcish Bowmasters and
   * Smothering Tithe. Those cards draw nobody anything; the words are the
   * clause the card is waiting for. An adjacency test is what tells them from
   * a gift, and it is why the general refusal in `token-subject.ts` asks for
   * the subject to sit against the verb rather than within a window: the same
   * fifty-character reach that `creates` can afford took `card-draw` off 118
   * cards here, and most of those were the payoffs — Consecrated Sphinx draws
   * two BECAUSE an opponent drew one.
   */
  {
    tag: 'card-draw',
    test: new RegExp(
      `${forYou()}\\bdraws? (a|two|three|four|five|six|seven|X|that many|\\d+) cards?\\b|${forYou()}\\bdraws? cards equal to\\b`,
      'i',
    ),
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

  /*
   * The other side of the same verb (ADR-0048), and an OVERRIDE of a standing
   * decision rather than a gap being filled.
   *
   * ADR-0029 §6 refused a mill tag, and its reasoning is still on disk and is
   * still worth reading: nothing paid it off, and a tag with no payoff is inert
   * by construction. The user has overruled that, and what changed is worth
   * writing down rather than quietly contradicting:
   *
   *   1. THE SCOPE IS NARROWER THAN THE TAG THAT WAS REFUSED. Self-mill was
   *      never the gap — the `graveyard-creature` rule directly above already
   *      reads "you mill", "mill N cards" and "surveil N", and has since
   *      ADR-0016. What no rule could see is milling an OPPONENT, which
   *      ADR-0016 and ADR-0022 both ruled is a different resource. 244
   *      commander-legal cards, and the tag is named for the subject for
   *      exactly the reason `discard` and `opponent-discard` are.
   *   2. THE PAYOFF CLASS IS NOT EMPTY, though it is small. Re-measured: Glowing
   *      One, Infesting Radroach, Zellix and Lo and Li trigger on a player
   *      milling; Spoils of War, Spoils of Evil, Jailbreak and Dawnbreak
   *      Reclaimer count or take from an opponent's graveyard. Roughly ten
   *      cards, which is thin and is more than the zero ADR-0029 measured for
   *      the tag it refused.
   *
   * Same subject test as `opponent-discard` and `opponent-sacrifice`: the
   * third-person inflected verb, never the bare imperative addressed to you.
   * "Each player mills" deliberately matches this AND `graveyard-creature`,
   * because a symmetric mill genuinely does both — the ruling ADR-0022 made
   * about "each player discards".
   */
  {
    tag: 'opponent-mill',
    test: /\b(each|target|that|each other|any number of target) (player|opponent)s? (?:each )?mills?\b|\b(players|opponents) each mills?\b|\bdefending player mills\b/i,
  },

  /*
   * An extra turn (ADR-0048).
   *
   * The regex is IMPORTED from `bracket-barometers.ts` rather than written
   * again, and that is the whole point of this rule's existence being cheap:
   * that file already answers "does this card give someone an extra turn" for
   * the bracket check, already knows the three cards that DENY extra turns
   * ("would BEGIN an extra turn" is the denial verb, "takes" is the grant), and
   * already knows Emrakul does not say "after this one". A second regex here
   * would be a second answer to one question, and the two would drift.
   *
   * 53 cards. Nothing pays it off — see the pair table above, where that is
   * stated rather than implied.
   */
  { tag: 'extra-turns', test: TAKES_EXTRA_TURN },

  /*
   * A RITUAL: mana you get once, in a lump, and then it is gone (ADR-0054).
   *
   * Reported as "add mana needs to be a semantic. if I want more cards like
   * dark ritual, I need a semantic to focus". Dark Ritual carried `spell-cast`
   * and nothing else — the tag every instant in the format carries — so there
   * was no way to focus on it.
   *
   * A BROAD `mana` TAG WAS MEASURED AND REFUSED, and the measurement is the
   * whole of the argument. 2,402 commander-legal cards add mana; 1,141 of them
   * are lands, 576 are creatures and 451 are artifacts. A tag half of whose
   * members are the mana base is not a focus, it is a card type — and the user
   * said so first: a land tapping for mana is not what they want tagged.
   *
   * So the line is drawn at PERSISTENCE, which is the one thing `ramp` cannot
   * say. A Signet and a Dark Ritual are the same role and opposite cards: one
   * is mana every turn, the other is mana this turn at the cost of the card.
   * 75 producers, in three shapes and no more:
   *
   *   1. A one-shot SPELL that adds two or more. Dark Ritual, Seething Song,
   *      Pyretic Ritual, Rite of Flame, Manamorphose, Culling the Weak.
   *   2. A permanent that EATS ITSELF for two or more. Lion's Eye Diamond,
   *      Krark-Clan Ironworks, Ashnod's Altar, Basal Thrull, Lotus Bloom.
   *   3. Nothing else. "Exile this card from your hand: Add {R}" — the Spirit
   *      Guides — was written for shape 3 and matched ZERO commander-legal
   *      cards, because Scryfall templates those as "Exile this card from your
   *      hand: Add {R}" on a card the corpus spells differently. A rule no card
   *      exercises is machinery, so it is not here.
   *
   * TWO OR MORE IS THE LINE, and one mana is deliberately out. Lotus Petal
   * gives one mana for one card, which is a filter and not a burst; admitting
   * it would pull in the whole Egg cycle and every "sacrifice this: add one
   * mana of any color" mana-fixer, which are cards a storm deck does not play.
   * Twelve cards inside the 75 are still marginal in the other direction — the
   * Eggs and Attendants that add two but cost more than two to use — and they
   * are left, named here, because excluding them needs the card's own mana
   * value and these rules read text.
   */
  {
    tag: 'ritual',
    test: new RegExp(`^[^\\n]*\\b(?:Instant|Sorcery)\\b[\\s\\S]*(?:${ADDS_TWO_OR_MORE})`),
  },
  /*
   * NOT A LAND, and the guard is the user's own line: "a land tapping for mana
   * is almost certainly not what they want tagged". The sacrifice lands read
   * exactly like rituals — Ebon Stronghold, Dwarven Ruins, Lake of the Dead and
   * Phyrexian Tower all eat themselves for two mana — and they are still the
   * mana base, which is the thing being asked about. 14 cards, found by diffing
   * the corpus rather than by inspection.
   *
   * `^(?![^\n]*\bLand\b)` reads the TYPE LINE, which the rules see prefixed to
   * every face; the same instrument `role-derivation.ts` uses to keep a land a
   * land, and the same ruling `land-creature` makes about the mana base being
   * its own thing.
   */
  {
    tag: 'ritual',
    test: new RegExp(
      `^(?![^\\n]*\\bLand\\b)[\\s\\S]*\\bSacrifice (?:this|[A-Z][A-Za-z'’, -]{0,28})\\b[^.\\n]{0,30}:[^.\\n]{0,20}(?:${ADDS_TWO_OR_MORE})`,
      'i',
    ),
  },

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
  /*
   * The determiner was a closed list of one (ADR-0048, found by the commander
   * sweep). `an additional land` missed "you may play TWO additional lands on
   * each of your turns" — which is Azusa, Lost but Seeking, a top-flight
   * landfall commander that derived no landfall tag at all — and "you may play
   * X additional lands this turn" (Nahiri's Lithoforming). Two cards, and one of
   * them is the card the archetype is named after.
   */
  {
    tag: 'landfall',
    test: /\bplay (?:an|one|two|three|X|another|any number of) additional lands?\b|\bput(s)? .{0,30}land .{0,20}battlefield/i,
  },
  /*
   * WHOSE LAND (ADR-0059). Path to Exile — "Its controller may search their
   * library for a basic land card, put that card onto the battlefield" — is the
   * opponent's landfall, and a landfall deck was being offered it as an
   * enabler. 14 commander-legal cards, all read by hand: Path, Ghost Quarter,
   * Assassin's Trophy, Cleansing Wildfire, Erode, Sandworm, Old-Growth Dryads.
   *
   * This is the only caller that passes a `between` to the refusal, and the
   * reason is that this rule is anchored on a NOUN. The subject of the clause
   * is the subject of "search", four words to the left of "land card", so the
   * search phrase is spelled out rather than covered by a window — a window
   * wide enough to reach the subject would also reach into the previous
   * sentence, which is where "you gain 3 life" and "you draw a card" live.
   */
  {
    tag: 'landfall',
    test: new RegExp(
      `${forYou(String.raw`search(?:es)? (?:your|their) library for [^.\n]{0,40}`)}\\bland cards?\\b[^.]{0,60}\\bonto the battlefield\\b`,
      'i',
    ),
  },
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
    test: new RegExp(
      `${forYou()}\\bsearch(?:es)? (?:your|their) library for [^.\\n]{0,80}\\b(?:Plains|Island|Swamp|Mountain|Forest)\\b[^.\\n]{0,60}\\bonto the battlefield\\b`,
      'i',
    ),
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

  /*
   * A land becoming a creature (ADR-0047).
   *
   * Reported as the other half of "ambush commander has no semantic tags":
   * "Forests you control are 1/1 green Elf creatures that are still lands"
   * makes bodies, and no tag in this file could say so.
   *
   * NOT `token` and NOT `sacrifice-fodder`, which is the whole reason this is a
   * new event rather than a widening of an old one. Those bodies are the
   * player's mana base — see the pairs table above.
   *
   * 185 producers against 12 payoffs, which is the count that decided it.
   * ADR-0029 §6 refused a `mill` tag because nothing paid it off, and the same
   * test was run here expecting the same answer: "land creatures you control
   * get +1/+1" is Blossoming Tortoise, Sylvan Advocate, Embodiment of Fury and
   * Insight, Halimar Tidecaller, Jolrael, Tatyova, Jyoti and Toph, spread over a
   * decade rather than one set. Twelve is small and it is the same order as
   * `lifeloss` (19) and `opponent-sacrifice` (15), both of which already exist.
   *
   * Five rules, because each reaches cards no other one does. The counts are
   * cards reached ONLY by that rule, measured over the commander-legal corpus.
   */
  // 43 cards. "It's still a land" is the sentence Magic templates an animation
  // with, and it is the highest-precision signal there is: Awakener Druid, every
  // Zendikon, Crawling Barrens, Awakening of Vitu-Ghazi.
  //
  // "still a CAVE land" is deliberately not reachable here — an optional
  // adjective was measured and moved exactly one card, Cavernous Maw, which the
  // fourth rule below already reads.
  {
    tag: 'land-creature',
    test: /\b(?:it's|that's|is) still an? land\b|\bare still lands\b/i,
  },
  // 5 cards, and the reported one. The whole mana base at once: "Forests you
  // control are 1/1 green Elf creatures", "lands you control become 1/1
  // Elemental creatures" (Kamahl's Will, Sylvan Awakening, Natural Emergence).
  {
    tag: 'land-creature',
    test: /\b(?:lands?|Forests?|Islands?|Swamps?|Mountains?|Plains)\b[^.\n]{0,25}\byou control (?:are|become)\b[^.\n]{0,50}\bcreatures?\b/i,
  },
  /*
   * 3 cards, and the shape needs the POWER AND TOUGHNESS to be safe.
   *
   * A bare "land … becomes a … creature" was written first and measured at
   * three false positives in ten: Graceful Antelope reads "have target land
   * become a Plains UNTIL THIS CREATURE leaves the battlefield", where a land
   * changing its TYPE sits within reach of the word "creature", and Hidden Herd
   * reads "when an opponent plays a nonbasic land, … IT becomes a 3/3 Beast
   * creature", where the thing animated is the enchantment. Naming the subject
   * (`this|target|that|each`) and requiring a P/T refuses both.
   *
   * The subject accepts a basic land TYPE as well as the word "land", because
   * `target land` alone lost four real cards to their own precision: "Target
   * Island you control becomes a 4/4" (Avalanche Caller, Vengeant Earth) and
   * "Target snow land becomes a 2/2" (Balduvian Conjurer, Balduvian Frostwaker).
   * All four survive today only because the "still a land" rule happens to catch
   * them, which is not a thing to rely on.
   *
   * Which part refuses which was established by mutation rather than by
   * reading, and the answer was not the obvious one. The P/T alone refuses
   * Graceful Antelope, and it dies on its own. Hidden Herd is refused by the
   * NAMED SUBJECT and the 25-character gap TOGETHER — "plays a nonbasic land, if
   * this permanent is an enchantment, it becomes a 3/3" fails the subject on "a"
   * and fails the gap on 41 characters, so loosening either one alone changes
   * nothing and neither is separately killable. The battery mutates the pair.
   */
  {
    tag: 'land-creature',
    test: /\b(?:this|target|that|each) [^.\n]{0,15}?(?:land|Island|Forest|Swamp|Mountain|Plains)\b[^.\n]{0,25}\bbecomes? an? [\dX]+\/[\dX]+\b/i,
  },
  // 3 cards. Making one outright rather than transforming a land you have:
  // Awaken the Woods, Jyoti and Staff of Titania all print "land creature
  // token", which no other rule here reads.
  { tag: 'land-creature', test: /\bcreate\b[^.\n]{0,60}\bland creature token/i },
  // 3 cards. Both keywords print reminder text that the rules above catch, and
  // three cards carry the keyword with none — Bumi, Unleashed, Earthbender
  // Ascension and Earthshape.
  { tag: 'land-creature', test: /\bearthbend \d+\b|\bawaken \d+\b/i },
]

const WANTS: readonly Rule[] = [
  // The user's example: a death trigger on the commander wants creatures to die.
  { tag: 'creature-death', test: /\bwhenever (a|another) .{0,40}creature .{0,20}dies\b/i },
  /*
   * The window is the trigger's SUBJECT, and forty characters is not a subject
   * (ADR-0059).
   *
   * 430 commander-legal cards carry a "whenever … dies" trigger and this rule
   * reached 308 of them. Blood Artist's subject — "Blood Artist or another
   * creature " — is 33 characters and matched; Zulaport Cutthroat prints the
   * same sentence plus "you control", which runs to 46, and matched nothing at
   * all. So the two cards an aristocrats deck is built out of disagreed about
   * whether a death was worth anything, and the one at EDHREC 234 was the one
   * that said no. Cruel Celebrant, Butcher of Malakir, Kalastria Highborn,
   * Xathrid Necromancer and Headless Rider are the same sentence again.
   *
   * EIGHTY is where the measurement stops paying, and the ceiling was found by
   * reading the cards each widening admits rather than by picking a round
   * number. 60 reaches 413, 80 reaches 423 and every one of the 91 cards it
   * adds is a real death trigger. The FIRST match at 90 is Rivaz of the Claw,
   * where the words inside the window have stopped being a subject — which is
   * the signal that the window has left the grammar it was measuring.
   *
   * The gap is `[^.\n]` rather than `.`, which is this file's own instrument
   * for staying inside one sentence and one face. Measured to cost NOTHING at
   * eighty characters — the two produce identical sets — and taken anyway,
   * because widening a gap that can leave its own sentence is how a trigger
   * condition finds its verb in the next ability. A `[^.,\n]` gap was measured
   * too and refused: the comma costs three real cards whose subject contains
   * one ("Whenever a nontoken, non-Angel creature you control dies" is
   * Valkyrie's Call), and the comma boundary that ADR-0022 relies on elsewhere
   * is about where an EFFECT begins, which is past the verb this rule ends at.
   */
  { tag: 'creature-death', test: /\bwhenever [^.\n]{0,80}\bdies\b/i },
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

  /*
   * A sacrifice outlet wants fodder as much as fodder wants an outlet.
   *
   * WHOSE SACRIFICE (ADR-0059). The producer side has told an outlet from an
   * edict since ADR-0022 and this side never did, so "any opponent may
   * sacrifice a creature of their choice" read as a payoff for your own tokens.
   * Clackbridge Troll was offered to an aristocrats deck as "benefits from your
   * expendable bodies", and the Goats it eats are the ones it gave away. Nine
   * commander-legal cards, all read by hand, all edicts or punishers:
   * Clackbridge Troll, Desecration Demon, Predatory Nightstalker, Pillar Tombs
   * of Aku, Brain Gorgers, Innocent Traveler, Mogis, Tomb Blade, Unnatural
   * Hunger.
   *
   * `addressedToYou` rather than `forYou`, because the verb is a bare
   * infinitive and having NO named subject is what makes the clause yours —
   * ADR-0022's device, one verb over.
   */
  {
    tag: 'sacrifice-fodder',
    test: new RegExp(`${addressedToYou()}\\bsacrifice (a|another|an) creature\\b`, 'i'),
  },
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
  /*
   * WHOSE LIFE, on the payoff side (ADR-0059).
   *
   * This rule used to read `los[et]s?` with no subject at all, and its own
   * comment said why: "'whenever YOU LOSE life' is Vilis and Transcendence, and
   * the old rule reached 7 of the 19 real payoffs". That was the right fix for
   * the gap it found and the wrong tag to put the answer on — Vilis pays off
   * YOUR life going down, and every producer this tag has is a card that takes
   * life off somebody else's total. Under one tag Vilis was offered a Vito.
   *
   * So the subject list is spelled out, and it is the same one the
   * `player-damage` bridge two rules down already uses — which is the point:
   * the bridge holds for exactly the subjects that are not you, and now the two
   * rules say so in the same words instead of one saying it and one not.
   *
   * `its controller` is in, and is the one subject `forYou` refuses for the
   * other tags: after "destroy target creature" its controller is somebody
   * else, and somebody else losing life is exactly what this tag means.
   */
  {
    tag: 'lifeloss',
    test: /\bwhenever [^.,\n]{0,40}\b(?:an opponent|a player|that player|its controller|one or more (?:opponents|players)|opponents|players) los[et]s? life\b/i,
  },
  /*
   * The payoff for your own life going down (ADR-0059). 12 cards: Vilis,
   * Transcendence, Lich's Mastery, Lich's Tomb, Oath of Lim-Dûl, Vengeful
   * Warchief, Gonti's Machinations, Vampire Scrivener.
   *
   * "Gain or lose" is in because two of the twelve are written that way — Wax-
   * Wane Witness and Moonstone Harbinger read "whenever you gain OR LOSE life
   * during your turn" — and an adjacency test reads straight past them.
   */
  { tag: 'self-lifeloss', test: /\bwhenever you (?:would |gain or )?los[et]s? life\b/i },
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

  /*
   * The payoffs for milling an opponent (ADR-0048), and the reason the tag is
   * not the inert one ADR-0029 §6 refused.
   *
   * Two shapes, read one by one. The trigger — "whenever a player mills a
   * nonland card" is Glowing One, Infesting Radroach, Zellix and Lo and Li —
   * and the count, which is a card that reaches into an opponent's graveyard
   * and is worth more the fuller it is: Spoils of War, Spoils of Evil,
   * Jailbreak, Dawnbreak Reclaimer.
   *
   * The count rule names the opponent's graveyard explicitly rather than
   * accepting any graveyard, because "for each card in YOUR graveyard" is a
   * self-mill payoff and belongs to `graveyard-creature` — ADR-0016's ruling,
   * which this tag exists beside rather than instead of.
   */
  {
    tag: 'opponent-mill',
    test: /\bwhenever (an opponent|a player|one or more (?:players|opponents))[^.,\n]{0,60}\bmills?\b/i,
  },
  {
    tag: 'opponent-mill',
    test: /\bcards? in (?:an|each|target|that) opponent's graveyard\b|\bfor each [a-z /]{0,30}card in target opponent's graveyard\b/i,
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

  /*
   * `whenever you cast an artifact spell` is the alternative this rule was
   * missing (ADR-0054), and the tell is that its ENCHANTMENT twin below has
   * carried `whenever you cast an enchantment` since it was written.
   *
   * The asymmetry cost 29 of 31 cards: Patchwork Automaton, Ravenous Robots,
   * Citanul Druid, Sarinth Steelseeker and every "artifact spells you cast cost
   * {1} less" monument reached no artifact tag at all, while their enchantment
   * counterparts reached theirs 21 times out of 22.
   *
   * NOT a `artifact-cast` tag of its own. Casting an artifact and an artifact
   * entering are the same deck asking the same question — the spell resolves
   * and the permanent arrives — and this tag already means that deck, with
   * 3,568 producers behind it. A second tag would split the deck in half and
   * make each half look thinner than it is.
   */
  {
    tag: 'artifact-etb',
    test: /\bwhenever an artifact (you control )?enters\b|\bwhenever (?:you|a player|an opponent) casts? (?:your |their )?(?:first |second )?an? artifact spell\b|\bartifact spells you cast\b|\bwhenever another artifact\b|\bmetalcraft\b|\baffinity for artifacts\b|\bimprovise\b|\bfor each artifact you control\b|\bartifacts you control (get|have)\b/i,
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
  /*
   * The same window, one trigger over (ADR-0059).
   *
   * Thirty characters holds a NAME — "Whenever Adeline attacks" — and not a
   * described subject. 1,764 commander-legal cards carry a "whenever … attacks"
   * trigger and this reached 1,694; the 69 it could not see are Winota, Joiner
   * of Forces ("whenever a non-Human creature you control attacks"), Kindred
   * Discovery, Nahiri, Forged in Fury, Hooded Blightfang and every Samurai that
   * cares about attacking alone. Sixty reaches 1,763 and the one beyond it is
   * not an attack trigger.
   *
   * The gap stays `.` here where the `dies` rule above took `[^.\n]`, and the
   * difference is measured rather than an oversight. `.` is already bounded by
   * the face — it cannot cross a newline — and the extra sentence boundary buys
   * nothing at sixty characters and costs exactly one card: Mr. Foxglove, whose
   * own NAME carries a full stop. That is the honorific trap `creature-etb`
   * documents below on "J. Jonah Jameson" and "Ms. Marvel", and it is worth a
   * card here and nothing there.
   */
  { tag: 'attack-trigger', test: /\bwhenever .{0,60}attacks\b/i },
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
  /*
   * A tap ability worth using twice (ADR-0059).
   *
   * This rule used to be `/\{T\}:/` — does this permanent have a tap ability at
   * all — and 1,129 of the 1,247 commander-legal lands have one. 94.5%. Since
   * every deck runs about thirty-six lands, `untap` was the single largest want
   * in every deck in the product, and it was the mana base saying it: with nine
   * Forests in a green deck every top-eight row in two different groups was
   * chipped "shares your untapping theme", and removing the Forests made the
   * chips vanish.
   *
   * WHAT THE RULE IS FOR was measured before it was narrowed. The 324 producers
   * are Seedborn Muse, Wilderness Reclamation, Voltaic Key, Kiora and Thornbite
   * Staff, and what they are worth is a SECOND ACTIVATION of an ability that
   * does something. Two guards follow from that, and no more than two:
   *
   *   1. The effect is not "Add". A land tapping for mana is the mana base —
   *      the user's own line, already load-bearing for `ritual` two rules up.
   *      1,129 lands become 442.
   *   2. The cost does not eat the permanent. "{T}, Sacrifice this land:
   *      Destroy target nonbasic land" is Wasteland, and untapping Wasteland is
   *      worth nothing because it is not there. 442 become 294.
   *
   * 3,538 wanters become 2,518 and the share of lands carrying it falls from
   * 94.5% to 24.6% — the utility lands, which is the part of a mana base an
   * untap deck is actually built to abuse. Krenko, Arcanis, Staff of
   * Domination, Voltaic Key, Mikokoro, Deserted Temple and Arcane Lighthouse
   * all keep it.
   *
   * THE COST IS STATED RATHER THAN HIDDEN: Sol Ring, Gilded Lotus, Gaea's
   * Cradle and every mana dork lose the want, and untapping those is a real
   * thing decks do. It is a thing they do to make MANA, which `ramp` and
   * `ritual` already name, and saying it here as well is not worth 94.5% of the
   * mana base.
   *
   * `\s+` and not `\s*`, which is the whole rule in one character: a star lets
   * the engine match zero whitespace and hand the space itself to the
   * lookahead, so `(?!Add\b)` succeeds against " Add" and every basic land
   * comes straight back. Found by measuring, not by reading.
   */
  { tag: 'untap', test: /\{T\}(?![^:\n]{0,40}\bSacrifice this\b)[^:\n]{0,40}:\s+(?!Add\b)/ },

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
  {
    tag: 'creature-etb',
    test: /^[^\n]*\bCreature\b[\s\S]*\b[Ww]hen(?:ever)? [A-Z][^,.\n]{0,28} enters\b/,
  },

  /*
   * STORM, READ BY ITS REMINDER TEXT rather than by the word (ADR-0038).
   *
   * `\bstorm\b` was reading a card's OWN NAME. Pre-2024 templating spells the
   * name out in the rules text, so "Cinder Storm deals 7 damage to any target"
   * asked to be paired with a spellslinger deck, and so did Command the Storm,
   * Hail Storm, Storm's Wrath, Tropical Storm and Storm of Souls. 22
   * commander-legal cards matched on the bare word and NOT ONE of them carries
   * the keyword; two of the 22 are stranger still, naming a TOKEN after another
   * card — Murmuration and Attempted Murder both make a Bird "named Storm
   * Crow".
   *
   * This is the correction to the rule three above, which refused to substitute
   * the name out of the text and priced that refusal partly at "all twenty
   * cards named '… Storm' lose `spell-cast`". Those twenty never wanted it. The
   * loss was the bug and not the cost, and the fix is narrower than the
   * substitution ADR-0038 rejected: it costs the other 30 cards nothing,
   * because it changes one alternative rather than the text every rule reads.
   *
   * `ritual` already does exactly this, two hundred lines down, and says why in
   * the same words. All 33 STORM-keyword cards in the corpus still match — the
   * reminder is printed on every one of them.
   *
   * The one true payoff this no longer reaches is Murmuration, whose OTHER
   * clause ("for each spell you've cast this turn") is a count at end of step
   * rather than a trigger and is read by no rule in this table. One card, named
   * so the next person does not have to find it twice.
   */
  {
    tag: 'spell-cast',
    /*
     * STORM IS READ BY ITS REMINDER TEXT, not by the word (ADR-0059), which is
     * the instrument the `ritual` payoff rule below already uses — and using it
     * in both places is the whole point, because both rules are asking the same
     * question about the same keyword.
     *
     * The bare word claimed 24 commander-legal cards on the strength of their
     * own NAMES, which Scryfall spells out in oracle text: "Storm's Wrath deals
     * 4 damage to each creature" is a board wipe, and Cinder Storm, Lightning
     * Storm, Comet Storm, Arrow Storm, Storm Seeker and Storm of Souls are
     * burn. 20 of the 24 are weather. The other 4 carry the real keyword and
     * keep the tag through the reminder text.
     *
     * Measured to cost nothing: all 33 commander-legal cards with the storm
     * keyword print the reminder, zero exceptions.
     */
    test: /\bprowess\b|\bmagecraft\b|\bcopy it for each spell cast before it this turn\b|\bwhenever you cast (an instant|a sorcery|your first|an? noncreature)|\binstant and sorcery spells you (cast|control)\b|\bwhenever you copy an instant\b/i,
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
   * The payoff that COUNTS spells rather than triggering on one (ADR-0059).
   *
   * Found by diffing the corpus after the storm narrowing above, which is the
   * reason the diff is done at all: two of the 22 cards that lost the tag were
   * matching on the word inside a TOKEN'S name — "create a 1/2 blue Bird
   * creature token with flying named STORM CROW" — and Murmuration, which makes
   * one Bird for every spell you cast that turn, is a real spellslinger payoff
   * that no correct rule in this file could reach.
   *
   * 12 commander-legal cards, read one by one. Gnostro, Narset Jeskai
   * Waymaster, Surge of Brilliance and Outlaw Stitcher count; Highspire
   * Bell-Ringer, Monk Class, Uthros Psionicist and Raging Battle Mouse discount
   * the second one, which is the same deck asking the same question from the
   * cost side rather than the trigger side.
   */
  {
    tag: 'spell-cast',
    test: /\bfor each spell you(?:'|’)ve cast this turn\b|\bnumber of spells you(?:'|’)ve cast this turn\b|\bsecond spell you cast each turn\b/i,
  },
  /*
   * The trigger that counts spells instead of naming one (ADR-0054).
   *
   * "Whenever you cast your SECOND spell each turn" is 59 commander-legal
   * cards — Kraum, Lotho, Sunstar Lightsmith, Wanda's Vision — and 3 of them
   * carried `spell-cast`. The rule above asks for "your FIRST", which was the
   * whole vocabulary, so the ordinal that actually marks a spellslinger deck
   * was the one it could not read.
   *
   * Same tag rather than a new one: this is the event `spell-cast` already
   * means. It is not about a card type; it is about how many spells a turn the
   * deck casts, which is the thing an instant or sorcery in the deck answers.
   *
   * `a player` and `their` are in because the format prints both — Lotho reads
   * "whenever a player casts their second spell each turn" and taxes everyone,
   * and it is still a card you play in the deck that casts three.
   */
  {
    tag: 'spell-cast',
    test: /\bwhenever (?:you|a player|an opponent) casts? (?:your|their) (?:second|third) spell\b/i,
  },
  /*
   * Casting a CREATURE is a different event from casting a spell (ADR-0054).
   *
   * Reported as "beast whisperer needs to have a semantic about benefiting from
   * casting creature spells". It had none: `spell-cast`'s producer is an
   * instant or a sorcery by type line, so a rule about creature spells could
   * not honestly live under it, and Beast Whisperer's only tag was `card-draw`.
   * 74 commander-legal cards, 3 of which carried any cast tag.
   *
   * PAYOFF-ONLY, and the producer side is refused on a measurement rather than
   * on taste. The producer would have to be "this card is a creature", which is
   * 17,751 of the 31,782 commander-legal cards — 55.9%. The widest tag any real
   * pool carries today is `artifact-etb` at 33.6%, and a tag on more than half
   * the format would attach "enables your creature-cast" to every creature in
   * the deck's colours: true of all of them, and therefore informative about
   * none. The sentence it would have said — "your thirty creatures turn this
   * on" — is already said, better and with a number, by the `type:creature`
   * composition target and the `fills-creature` group it now produces.
   *
   * So it stands exactly where `extra-turns` stands (ADR-0048): vocabulary and
   * a label rather than a score. It gives the builder the focus they asked for
   * — emphasise `creature-cast` and the other 73 payoffs come back — and it
   * gives the card panel something true to print on Beast Whisperer.
   *
   * NOT folded into `creature-etb`, which was the tempting shortcut. A token
   * entering is a creature entering and does not trigger Beast Whisperer, so
   * offering Young Pyromancer as its enabler would be a false claim — the same
   * error `land-creature` exists to avoid one tag over.
   */
  {
    tag: 'creature-cast',
    test: /\bwhenever (?:you|a player|an opponent) casts? (?:your |their )?(?:first |second )?an? creature spell\b|\bcreature spells you cast\b/i,
  },
  /*
   * The payoff side of a ritual (ADR-0054), and what keeps the tag from being
   * inert.
   *
   * Two templates, 97 cards between them. STORM is read by its reminder text
   * rather than by the word, because "storm" is also a noun 20 cards have in
   * their names — the trap `creature-etb` documents two rules up. The second
   * ordinal is the other half: a deck that cares about casting three spells in
   * a turn is a deck that pays for the third with a lump of mana.
   */
  {
    tag: 'ritual',
    test: /\bcopy it for each spell cast before it this turn\b|\bwhenever (?:you|a player|an opponent) casts? (?:your|their) (?:second|third) spell\b/i,
  },
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
  /*
   * The payoffs for a land being a creature (ADR-0047), and the reason the tag
   * is not inert. 12 cards, read one by one.
   *
   * "YOU CONTROL" is load-bearing rather than decorative: Consuming Sinkhole
   * reads "exile target land creature", which is the opposite card, and the
   * possessive is what refuses it. The second form is the same claim written as
   * a condition — Earth Rumble Wrestlers checks "as long as you control a land
   * creature".
   */
  { tag: 'land-creature', test: /\bland creatures? you control\b/i },
  {
    tag: 'land-creature',
    test: /\byou control an? land creature\b|\bcontrols? an? land creature\b/i,
  },
]

export interface SynergyProfile {
  readonly produces: readonly SynergyTag[]
  readonly wants: readonly SynergyTag[]
  /**
   * What the card IS or HAS, as opposed to what it causes (ADR-0048).
   *
   * A third direction, and the reason is that two verbs could not say what the
   * derived families mean: a card does not *cause* flying, it *has* it, and
   * Ambush Commander does not *produce* Elf, it *is* one. Membership crammed
   * into `produces` made 298 of the 317 keyword tags look inert.
   *
   * Optional, with the same reading `oracleTextFaces` and `canBeCommander`
   * already have in this codebase: absent means "derived before the column
   * existed", not "this card has nothing". `[]` would be a claim; absence is a
   * gap, and every such card gets its answer at the next re-ingest.
   */
  readonly has?: readonly SynergyTag[]
  /**
   * Which cards can cause the wanted event, where the card says (ADR-0057).
   *
   * `wants: ['spell-cast']` says Y'shtola pays off a spell being cast. It does
   * not say she pays off only a noncreature one costing three or more, which is
   * what her text says and what makes Counterspell no use to her.
   *
   * DERIVED, NEVER STORED, and the read carries the input already —
   * `oracle_text` is in the eligible column list. So `synergy_wants` is
   * untouched, there is no migration, and `wants:spell-cast` still matches a
   * qualified want because the stored array never changed.
   *
   * Optional with the same reading `has` has: absent means the caller did not
   * ask, not that the card's want is unconstrained. Only ever names a tag that
   * is also in `wants`, and only ever a tag in `QUALIFIABLE_TAGS`.
   */
  readonly wantQualifiers?: readonly QualifiedWant[]
}

export const EMPTY_PROFILE: SynergyProfile = { produces: [], wants: [], has: [] }

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
  card: Pick<Card, 'oracleId' | 'name' | 'oracleText' | 'typeLine' | 'keywords'> &
    Partial<Pick<Card, 'oracleTextFaces'>>,
  options: { readonly curated?: SynergyOverrides } = {},
): SynergyProfile => {
  const curated = (options.curated ?? CURATED_SYNERGY).get(card.oracleId)
  if (curated !== undefined) return curated

  // Absent means "single-faced, or ingested before the column existed"; the
  // whole text is the only answer available and is the right one for the first.
  const faces = card.oracleTextFaces ?? [card.oracleText]
  const texts = faces.map((face) => `${card.typeLine}\n${face}`)
  /*
   * The derived families (ADR-0046), unioned in rather than folded into the
   * rule tables above.
   *
   * `name` and `keywords` are REQUIRED rather than optional, and the reason is
   * that both silently weaken the answer when absent: without the name a card
   * that spells itself out in its own text asks to be paired with its own
   * tribe, and without keywords a flier produces nothing. An optional field
   * that quietly changes what a card means is worse than a call site to update.
   */
  const semantic = deriveSemanticTokens(card)
  return {
    produces: [...apply(PRODUCES, texts), ...semantic.produces],
    wants: [...apply(WANTS, texts), ...semantic.wants],
    /*
     * `has` is derived-only, and that is the boundary ADR-0048 draws rather
     * than an omission. The curated twenty-two are EVENTS — a card causes a
     * creature to die or pays off when one does — and there is no third thing
     * to say about an event. Membership is a question you can only ask of what
     * a card IS, which is exactly the two families in `semantic-tokens.ts`.
     */
    has: semantic.has,
    /*
     * ADR-0057. Derived from the same `oracleText` the rule tables above read,
     * in the same call, so a card's want and the constraint on that want can
     * never come from two different readings of the text.
     */
    wantQualifiers: deriveWantQualifiers(card),
  }
}

/**
 * What the deck already does and already wants.
 *
 * The commander counts for more than an accepted card, and heavily: a Commander
 * deck is built around its commander, and a 99-card deck would otherwise drown
 * the one card that defines it.
 */
/**
 * One deck card's constrained want, kept apart from the total (ADR-0057).
 *
 * `weight` is that ONE wanter's contribution, not the tag's total — which is
 * the whole point. A deck can hold Y'shtola and Guttersnipe, and a one-mana
 * instant fails her and satisfies him, so the answer for that candidate is
 * neither "the tag" nor "not the tag" but the part of the tag it earns.
 */
export interface QualifiedDeckWant {
  readonly weight: number
  readonly qualifiers: readonly WantQualifier[]
}

export interface DeckSynergy {
  /** Tag → weight. */
  readonly produces: ReadonlyMap<SynergyTag, number>
  readonly wants: ReadonlyMap<SynergyTag, number>
  /** What the deck's cards ARE or HAVE (ADR-0048). Its tribe, and its evasion. */
  readonly has: ReadonlyMap<SynergyTag, number>
  /**
   * The QUALIFIED portion of `wants`, kept beside it rather than replacing it
   * (ADR-0057).
   *
   * `wants` stays the honest total — the deck really does want `spell-cast`,
   * and `wants:spell-cast` in the search box is right to say so. This is the
   * subset of that total a candidate can FAIL to reach, and `synergyMatches`
   * subtracts only what the candidate fails.
   *
   * Additive rather than a change to `wants`, so every existing reader of a
   * `DeckSynergy` keeps its answer. Optional so a hand-built deck in a test
   * does not have to carry an empty map.
   */
  readonly qualifiedWants?: ReadonlyMap<SynergyTag, readonly QualifiedDeckWant[]>
}

export const COMMANDER_WEIGHT = 4

export const deckSynergy = (
  commanders: readonly OracleId[],
  accepted: readonly OracleId[],
  profileOf: (id: OracleId) => SynergyProfile | undefined,
): DeckSynergy => {
  const produces = new Map<SynergyTag, number>()
  const wants = new Map<SynergyTag, number>()
  const has = new Map<SynergyTag, number>()
  const qualifiedWants = new Map<SynergyTag, QualifiedDeckWant[]>()

  const add = (
    into: Map<SynergyTag, number>,
    tags: readonly SynergyTag[] | undefined,
    weight: number,
  ): void => {
    for (const tag of tags ?? []) into.set(tag, (into.get(tag) ?? 0) + weight)
  }

  /*
   * The qualifier is recorded PER WANTER, never merged into the tag (ADR-0057).
   *
   * Two cards can want one tag on different terms and there is no single
   * constraint that is true of both: Y'shtola needs three mana and Guttersnipe
   * needs an instant or a sorcery, and merging them would either exclude a
   * cheap instant she cannot use but he can, or include a creature spell
   * neither can. The weight is what splits, so the weight is what is stored.
   */
  const addQualified = (profile: SynergyProfile, weight: number): void => {
    for (const qualified of profile.wantQualifiers ?? []) {
      const list = qualifiedWants.get(qualified.tag) ?? []
      list.push({ weight, qualifiers: qualified.qualifiers })
      qualifiedWants.set(qualified.tag, list)
    }
  }

  for (const id of commanders) {
    const profile = profileOf(id)
    if (profile === undefined) continue
    add(produces, profile.produces, COMMANDER_WEIGHT)
    add(wants, profile.wants, COMMANDER_WEIGHT)
    add(has, profile.has, COMMANDER_WEIGHT)
    addQualified(profile, COMMANDER_WEIGHT)
  }
  for (const id of accepted) {
    if (commanders.includes(id)) continue
    const profile = profileOf(id)
    if (profile === undefined) continue
    add(produces, profile.produces, 1)
    add(wants, profile.wants, 1)
    add(has, profile.has, 1)
    addQualified(profile, 1)
  }

  return { produces, wants, has, qualifiedWants }
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
  /**
   * The candidate's own columns, for evaluating the deck's qualified wants
   * (ADR-0057).
   *
   * THE ASYMMETRY IS THE DESIGN. A producer never has to advertise anything —
   * the matcher reads the candidate's `manaValue`, `types` and `colors`, all
   * three of which the eligible read already ships. So honouring a qualifier
   * costs one predicate and no new data anywhere.
   *
   * ABSENT MEANS "THE CALLER DID NOT ASK", never "this candidate satisfies the
   * qualifier". Without it the answer is the unqualified one, which is
   * OVER-inclusive — the direction that can waste a slot in the feed but can
   * never report a real payoff as no use. Both production callers pass it;
   * `synergy.test.ts` has a case pinning the fallback so it cannot go quiet.
   */
  readonly candidate?: Pick<Card, 'manaValue' | 'types' | 'colors'>
}

/**
 * Which reading leads when two matches weigh the same (ADR-0054).
 *
 * The weight already answers the question that matters — it is how much of the
 * tag the deck wants against how much it holds, so a deck short of an engine
 * hears "enables" and a deck full of one hears "payoff", and this never
 * overrides that. What it settles is the EXACT TIE, which is not a rare edge:
 * a commander who both IS an Elf and WANTS Elves puts `COMMANDER_WEIGHT` into
 * `has` and the same into `wants`, so every lord in the deck ties with itself.
 *
 * Before this, the tie was settled by the order the two loops below happen to
 * push in and by `Array.prototype.sort` being stable — which is to say, by
 * nothing. `enables` was pushed first, so on a real Elf deck all 42 Elf-typed
 * candidates read "enables your emphasised subtype:elf" and all 12 payoff
 * reasons went to non-Elf cards. `recommend` emits exactly one reason per
 * card, so Joraga Warcaller was described as another body rather than as the
 * lord it is.
 *
 * PAYOFF LEADS, and the argument is about how much the sentence tells you. In
 * a tribal deck every creature of the type supplies the tag and only the lords
 * consume it — 122 bodies against 45 lords on the deck this was measured on —
 * so "pays off your Elves" distinguishes the card from its neighbours and "is
 * another Elf" does not. `theme` is last for the reason `THEME_WEIGHT` already
 * gives: it is the weakest reading in the model, a shared want with no engine
 * behind it.
 *
 * WITHIN ONE TAG ONLY, and the restriction is measured rather than cautious.
 * The first version of this made direction a global tie-break, and across four
 * real decks it moved 87 rows instead of 48: the extra 39 were CROSS-TAG ties,
 * where a card's `subtype:human` payoff displaced its `creature-death` enable
 * on a sac outlet in a Meren deck. Those two are not two readings of one fact —
 * they are different claims — and nothing here says a payoff on one tag beats
 * an enable on another. The tag ordering at equal weight is therefore left
 * exactly as it was, by sorting on the tag's FIRST appearance before the
 * direction is consulted.
 *
 * Rejected: swapping the two loops. It settles the same-tag case today, through
 * the stability of `sort`, and it leaves the decision invisible at the line
 * that makes it — which is exactly how this ordering came to be unargued in the
 * first place.
 */
const DIRECTION_RANK: Readonly<Record<SynergyMatch['direction'], number>> = {
  payoff: 0,
  enables: 1,
  theme: 2,
}

export const synergyMatches = (
  candidate: SynergyProfile,
  deck: DeckSynergy,
  options: SynergyMatchOptions = {},
): readonly SynergyMatch[] => {
  const matches: SynergyMatch[] = []

  /*
   * Which directions pair (ADR-0048).
   *
   * `has` is a second way of SUPPLYING a tag, so it pairs with `wants` exactly
   * as `produces` does and in both directions: a flier supplies what Favorable
   * Winds wants, and Favorable Winds pays off a deck full of fliers.
   *
   * `has` ↔ `has` is NOT scored, for the same reason `produces` ↔ `produces` is
   * not: two Elves are redundancy, not synergy. What makes a tribe a deck is
   * the card that WANTS the tribe, and that card is already the other half of
   * both pairings above. `has` ↔ `produces` is refused on the same ground — a
   * card that is an Elf and a card that makes Elf tokens are two copies of the
   * same effect.
   *
   * "Has can still imply certain benefits from and causes" was the ask, and the
   * answer is that the implication is already carried, by the pairing being
   * symmetric rather than by a rule. A flier gets credit in a deck with a flying
   * payoff (`has` → `wants`) and the payoff gets credit in a deck of fliers
   * (`wants` → `has`); there is nothing left for an implication to add. What it
   * would add if written — a shared `has` counting as a theme — is the
   * redundancy the paragraph above refuses. No second relation is hardcoded in
   * the scorer, and if one is ever wanted it belongs in the rules that emit the
   * tags, not here.
   */
  /*
   * How much of a wanted tag THIS candidate actually earns (ADR-0057).
   *
   * The deck's want is the sum of its wanters. A qualified wanter is one the
   * candidate can FAIL — Counterspell costs two and Y'shtola needs three — so
   * its weight comes off the total, and only its weight. Nothing else in the
   * model changes: `deck.wants` is still the honest total of what the deck
   * wants, and `wants:spell-cast` in the search box is still right to match.
   *
   * EXCLUDE, NOT REDUCE, when the whole want is qualified. A trigger has no
   * partial state — Counterspell does not half-fire her — and the owner's words
   * were "should not be considered". ADR-0058 makes the OPPOSITE ruling one
   * level over, for roles, and the difference is what the two things are: a tag
   * qualifier is a fact about the rules, a role qualifier is a judgement about
   * coverage, and Disenchant really is removal.
   */
  const earned = (tag: SynergyTag): number => {
    const total = deck.wants.get(tag) ?? 0
    const facts = options.candidate
    if (total === 0 || facts === undefined) return total
    let failed = 0
    for (const want of deck.qualifiedWants?.get(tag) ?? []) {
      if (!satisfiesQualifiers(facts, want.qualifiers)) failed += want.weight
    }
    return total - failed
  }

  const supplied = new Set<SynergyTag>([...candidate.produces, ...(candidate.has ?? [])])
  for (const tag of supplied) {
    const weight = earned(tag)
    if (weight > 0) matches.push({ tag, direction: 'enables', weight })
  }
  /*
   * THE PAYOFF DIRECTION IS NOT QUALIFIED, and the gap is named here rather
   * than left to be found (ADR-0057).
   *
   * `enables` reads the DECK's qualifiers against ONE candidate, which this
   * function has. `payoff` would read the CANDIDATE's qualifiers against every
   * card in the deck that supplies the tag — and `deck.produces` is a weight,
   * not a list of cards, so the columns to evaluate against are not here. They
   * could be carried: a deck is a hundred cards and three scalars each. It is
   * deferred because the error is far smaller and far less visible. `enables`
   * is what puts Counterspell in the feed under Y'shtola, which is the report
   * this ADR came from; `payoff` only inflates a weight on the one card the
   * user is already reading a reason for, and the reason it prints is true.
   */
  for (const tag of candidate.wants) {
    const weight = (deck.produces.get(tag) ?? 0) + (deck.has.get(tag) ?? 0)
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

  /*
   * The order each TAG first appeared in, which is what the sort used to fall
   * back on through `sort` being stable. Keeping it as an explicit key is what
   * confines the direction tie-break to one tag: two matches on different tags
   * are separated here and never reach the direction comparison at all.
   */
  const tagOrder = new Map<SynergyTag, number>()
  for (const match of matches) if (!tagOrder.has(match.tag)) tagOrder.set(match.tag, tagOrder.size)

  return matches.sort(
    (a, b) =>
      b.weight - a.weight ||
      (tagOrder.get(a.tag) ?? 0) - (tagOrder.get(b.tag) ?? 0) ||
      DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction],
  )
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
