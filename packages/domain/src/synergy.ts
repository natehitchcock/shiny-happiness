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
  // Damage to a player IS that player losing life, and "whenever a player loses
  // life" triggers on it. Deliberately not "any target", which as often points
  // at a creature and takes nobody's life total with it.
  {
    tag: 'lifeloss',
    test: /\bdeals \d+ damage to (target player|target opponent|each opponent|each player)\b|\bdeals damage to (target player|each opponent)\b/i,
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
  {
    tag: 'discard',
    test: /\bdiscard (a|an|two|three|four|X|\d+|that many|your hand)\b|\byou discard\b|\beach player discards\b/i,
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
  { tag: 'lifeloss', test: /\bwhenever .{0,30}loses life\b/i },
  { tag: 'card-draw', test: /\bwhenever you draw\b|\bif you.{0,20}drawn.{0,20}card\b/i },
  { tag: 'discard', test: /\bmadness\b|\bwhenever you discard\b/i },

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
  { tag: 'plus1-counter', test: /\bproliferate\b|\bwhenever .{0,40}\+1\/\+1 counter/i },
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

const apply = (rules: readonly Rule[], text: string): SynergyTag[] => {
  const found = new Set<SynergyTag>()
  for (const rule of rules) {
    if (rule.test.test(text)) found.add(rule.tag)
  }
  return [...found]
}

/**
 * Derive a card's synergy profile from its oracle text.
 *
 * A card may both produce and want the same tag — a sacrifice outlet that also
 * triggers on death is a whole engine by itself — and that is kept rather than
 * collapsed, because it is true.
 */
export const deriveSynergy = (
  card: Pick<Card, 'oracleId' | 'oracleText' | 'typeLine'>,
  options: { readonly curated?: SynergyOverrides } = {},
): SynergyProfile => {
  const curated = (options.curated ?? CURATED_SYNERGY).get(card.oracleId)
  if (curated !== undefined) return curated

  const text = `${card.typeLine}\n${card.oracleText}`
  return { produces: apply(PRODUCES, text), wants: apply(WANTS, text) }
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
