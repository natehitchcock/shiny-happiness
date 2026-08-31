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
const TAG_WORDS: Readonly<Record<string, string>> = {
  'creature-death': 'a creature dying',
  token: 'making tokens',
  lifegain: 'gaining life',
  lifeloss: 'opponents losing life',
  'card-draw': 'drawing cards',
  discard: 'discarding',
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
}

/**
 * `enchantment-etb`, `creature-etb` and `spell-cast` were missing from the
 * table above and fell through to the hyphen-stripping fallback, so the
 * workspace's tag hint read "enchantment etb" — the wire spelling, in a
 * sentence written for a person. Added here because the deck web names the same
 * three in its edge descriptions and would have inherited the same jargon.
 */
export const readable = (tag: string): string => TAG_WORDS[tag] ?? tag.replace(/-/g, ' ')
