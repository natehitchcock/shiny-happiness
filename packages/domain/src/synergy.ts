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
  | 'landfall'
  | 'plus1-counter'
  | 'attack-trigger'
  | 'untap'
  | 'treasure'
  | 'sacrifice-fodder'

export const SYNERGY_TAGS: readonly SynergyTag[] = [
  'creature-death',
  'token',
  'lifegain',
  'lifeloss',
  'card-draw',
  'discard',
  'graveyard-creature',
  'artifact-etb',
  'landfall',
  'plus1-counter',
  'attack-trigger',
  'untap',
  'treasure',
  'sacrifice-fodder',
]

interface Rule {
  readonly tag: SynergyTag
  readonly test: RegExp
}

/**
 * Written against Scryfall oracle conventions: the card's own name is spelled
 * out rather than `~`, reminder text is present, ability words are capitalised.
 */
const PRODUCES: readonly Rule[] = [
  // A sacrifice outlet is the classic enabler: it turns creatures into deaths on
  // demand, which is what a death trigger is waiting for.
  { tag: 'creature-death', test: /\bsacrifice (a|another|an|one|two|X|\d+) creature/i },
  { tag: 'creature-death', test: /\bsacrifice(s)? (a|another) creature\b/i },
  { tag: 'creature-death', test: /\beach player sacrifices\b/i },
  { tag: 'creature-death', test: /\bdestroy target creature\b/i },

  { tag: 'token', test: /\bcreate(s)? .{0,40}\btoken/i },
  { tag: 'sacrifice-fodder', test: /\bcreate(s)? .{0,40}\bcreature token/i },

  { tag: 'treasure', test: /\bTreasure token/i },
  { tag: 'artifact-etb', test: /\bcreate(s)? .{0,30}\bartifact token/i },

  { tag: 'lifegain', test: /\byou gain \d+ life\b|\bgain(s)? \d+ life\b|\blifelink\b/i },
  { tag: 'lifeloss', test: /\beach opponent loses \d+ life\b|\bloses? \d+ life\b/i },

  { tag: 'card-draw', test: /\bdraw(s)? (a|two|three|X|that many) cards?\b/i },
  { tag: 'discard', test: /\bdiscard(s)? (a|two|X|your hand)\b/i },

  // Self-mill and reanimation fodder: something has to fill the graveyard.
  {
    tag: 'graveyard-creature',
    test: /\bmill(s)? \d+|\bput(s)? the top .{0,30}into your graveyard/i,
  },
  { tag: 'graveyard-creature', test: /\bdies\b.{0,60}\bgraveyard\b/i },

  { tag: 'plus1-counter', test: /\bput(s)? .{0,30}\+1\/\+1 counter/i },
  { tag: 'untap', test: /\buntap target\b|\buntap all\b|\buntap(s)? another\b/i },
  {
    tag: 'landfall',
    test: /\bplay an additional land\b|\bput(s)? .{0,30}land .{0,20}battlefield/i,
  },
]

const WANTS: readonly Rule[] = [
  // The user's example: a death trigger on the commander wants creatures to die.
  { tag: 'creature-death', test: /\bwhenever (a|another) .{0,40}creature .{0,20}dies\b/i },
  { tag: 'creature-death', test: /\bwhenever .{0,40}\bdies\b/i },
  { tag: 'creature-death', test: /\bwhenever you sacrifice\b/i },

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

  { tag: 'artifact-etb', test: /\bwhenever an artifact enters\b/i },
  { tag: 'treasure', test: /\bwhenever .{0,30}Treasure .{0,20}sacrificed\b/i },
  { tag: 'landfall', test: /\bLandfall\b|\bwhenever a land .{0,20}enters\b/i },
  { tag: 'plus1-counter', test: /\bproliferate\b|\bwhenever .{0,40}\+1\/\+1 counter/i },
  { tag: 'attack-trigger', test: /\bwhenever .{0,30}attacks\b/i },
  { tag: 'untap', test: /\{T\}:/ },
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
  /** `enables` = the card provides what the deck wants; `payoff` = the reverse. */
  readonly direction: 'enables' | 'payoff'
  readonly weight: number
}

/**
 * How well a candidate fits what the deck is already doing.
 *
 * Both directions, and the strongest match leads — a card that enables the
 * commander's death trigger should say so, not report a weak land synergy it
 * also happens to have.
 */
export const synergyMatches = (
  candidate: SynergyProfile,
  deck: DeckSynergy,
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
