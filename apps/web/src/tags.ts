/**
 * The synergy tags in words.
 *
 * Lifted out of `App.tsx` unchanged when the deck web (doc 17) became a second
 * surface that has to name the same events. The alternative — a second table in
 * the web module — was rejected on sight: two vocabularies for one model is how
 * "a creature dying" in the workspace becomes "creature death" in the graph and
 * a reader has to work out that they are the same claim.
 *
 * The phrases are written to slot into a sentence after "causes" or "benefits
 * from", which is how both surfaces use them.
 */
import { semanticTagWords } from '@roundtable/domain'

const TAG_WORDS: Readonly<Record<string, string>> = {
  'creature-death': 'a creature dying',
  token: 'making tokens',
  lifegain: 'gaining life',
  lifeloss: 'opponents losing life',
  'card-draw': 'drawing cards',
  // "discarding" on its own stopped being unambiguous the moment
  // `opponent-discard` existed (ADR-0022): "causes discarding" would read as
  // Mind Rot when it means Faithless Looting. The subject is now said out loud
  // on both, because a reader cannot infer it from a word both cards use.
  discard: 'discarding your own cards',
  'graveyard-creature': 'creatures in the graveyard',
  'artifact-etb': 'artifacts entering',
  'enchantment-etb': 'enchantments entering',
  landfall: 'lands entering',
  'plus1-counter': '+1/+1 counters',
  'attack-trigger': 'attacking',
  untap: 'untapping',
  treasure: 'treasure',
  'sacrifice-fodder': 'expendable bodies',
  'creature-etb': 'creatures entering',
  'spell-cast': 'casting spells',
  'opponent-discard': 'opponents discarding',
  'opponent-sacrifice': 'opponents sacrificing',
  // Two damage tags, and the words have to say which is which (ADR-0029).
  // `player-damage` is damage aimed at a face; `damage` is the wider event that
  // contains it and does not care where the damage landed. "Dealing damage" is
  // deliberately not "burn" — an archetype does not slot after "causes", and the
  // word `burn` lives in the search box instead, as a value alias in
  // `normaliseTag`.
  'player-damage': 'damage to opponents',
  damage: 'dealing damage',
  // ADR-0047. Written to sit beside `landfall`'s "lands entering" rather than
  // as "manland", which is what a player calls the DECK — and an archetype does
  // not slot after "causes", the same ruling `burn` got just above.
  'land-creature': 'lands becoming creatures',
  // ADR-0048. The subject is said out loud for the reason `discard` says it:
  // self-mill is `graveyard-creature` and this is the other half, and a reader
  // cannot infer which one from a word both cards use.
  'opponent-mill': 'opponents milling',
  // Not "extra turns" alone — the phrase slots after "causes", and "causes
  // extra turns" is right while "benefits from extra turns" is a sentence no
  // card in the corpus can say. See the pair table: nothing pays this off.
  'extra-turns': 'taking extra turns',
}

/**
 * `enchantment-etb`, `creature-etb` and `spell-cast` were missing from the
 * table above and fell through to the hyphen-stripping fallback, so the
 * workspace's tag hint read "enchantment etb" — the wire spelling, in a
 * sentence written for a person. Added here because the deck web names the same
 * three in its edge descriptions and would have inherited the same jargon.
 *
 * The table above stays the size it is. ADR-0046 added 558 more tags, and they
 * are DERIVED rather than written: a subtype's words are the subtype and a
 * keyword's are the keyword, so `semanticTagWords` answers for all of them
 * without anybody typing a phrase. The order matters — the curated table wins,
 * because a hand-written phrase exists precisely where the derived one would be
 * wrong, and `semanticTagWords` returns `null` for anything outside its own
 * vocabulary so the hyphen-stripping fallback still catches a tag neither knows.
 */
export const readable = (tag: string): string =>
  TAG_WORDS[tag] ?? semanticTagWords(tag) ?? tag.replace(/-/g, ' ')

/**
 * Which sentence the membership direction takes (ADR-0048).
 *
 * `has` is one direction in the model and TWO frames on screen, because "is an
 * Elf" and "has flying" are not the same sentence and a single heading over
 * both would have to pick one and be wrong about the other. The split is free:
 * it is the tag's own prefix, so nothing has to be stored or written down.
 *
 * `is` for a subtype, which is what a card IS. `has` for a keyword, which is
 * what it can DO. Anything else — no curated event carries this direction, but
 * the function is total — falls to `has`, which is the weaker claim.
 */
export const membershipFrame = (tag: string): 'is' | 'has' =>
  tag.startsWith('subtype:') ? 'is' : 'has'

/** The row heading over a group of membership chips. */
export const MEMBERSHIP_LABEL: Readonly<Record<'is' | 'has', string>> = {
  is: 'Is',
  has: 'Has',
}
