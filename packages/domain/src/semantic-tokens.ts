import type { Card } from './card.js'
import rawVocabulary from './semantic-vocabulary.data.json' with { type: 'json' }

/**
 * Subtypes and keywords as synergy tags (ADR-0046).
 *
 * `synergy.ts` models twenty-one hand-curated EVENTS. This file models the two
 * families that cannot be hand-curated because they are open vocabularies the
 * game keeps adding to: what a card IS (its subtypes) and what it CAN DO (its
 * keywords). The user's ask was for both, plus card types, plus their
 * relationships, and the shape below is what survived measuring it.
 *
 * The measurement, over the 31,782 commander-legal cards in the corpus:
 *
 *   raw candidate vocabulary          1,426  (880 keywords, 546 subtype words)
 *   after the refusals below              260  (241 subtypes, 19 keywords)
 *   synergy tags per card             1.82 → 3.36
 *
 * So the VOCABULARY grows about twelvefold and the tag LOAD less than doubles.
 * That gap is the whole reason this is affordable.
 *
 * ---------------------------------------------------------------- the model
 *
 * No new relation. A subtype tag is pure base relation — same tag, opposite
 * direction — and tribal synergy falls out of it with no table entry at all:
 *
 *   Elvish Archdruid, "Other Elf creatures you control get +1/+1"  → WANTS Elf
 *   every Elf on its type line                                     → PRODUCES Elf
 *
 * `INTERACTION_PAIRS` is therefore untouched. It was checked rather than
 * assumed: the obvious candidates are all already carried by an existing rule —
 * an Equipment's type line already produces `artifact-etb`, an Aura's already
 * produces `enchantment-etb` — so a pair would be a second name for a claim the
 * file already makes.
 *
 * ------------------------------------------------------------- the refusals
 *
 * 1. CARD TYPES AND SUPERTYPES, all thirteen. `Creature` alone is 17,751 cards,
 *    55.9% of the corpus; a tag that broad pairs with everything and
 *    distinguishes nothing, which is the ground ADR-0029 §6 refused a mill tag
 *    on. `t:` already filters types and composition already counts them, and
 *    where a type genuinely names an event the curated table already owns it:
 *    `artifact-etb`, `enchantment-etb` and `spell-cast` are literally "this
 *    card IS an artifact / an enchantment / an instant or sorcery".
 *
 * 2. KEYWORDS AS A FAMILY, and this was the surprise. Written out as payoff
 *    templates — "creatures with X get", "whenever … with X", "for each … with
 *    X", "as long as … with X" — only 25 of 813 keywords have ANY payoff card
 *    in the corpus, 137 payoff cards in total. Every other apparent mention of
 *    a keyword turns out to be one of three things that are not a payoff:
 *
 *      reminder text — Reach prints "(This creature can block creatures with
 *        flying.)", which made all 417 Spiders look like flying payoffs;
 *      a GRANT, which is a produce — "target creature gains flying";
 *      a TOKEN — "create a 1/1 Thopter with flying".
 *
 *    A naive word match gave `flying` 695 wanters; the honest count is 73.
 *    `trample` goes 605 → 4 and `lifelink` 308 → 0. A tag whose payoff class is
 *    empty is inert by construction — it can appear in none of the three
 *    directions `synergyMatches` scores — so the vocabulary keeps only the
 *    keywords that measured a payoff.
 *
 *    Also refused inside that shortlist: the landwalks. Swampwalk, Islandwalk,
 *    Plainswalk and Forestwalk each measure two "payoffs" and every one is the
 *    HATE template — "Creatures with swampwalk can be blocked as though they
 *    didn't have swampwalk." That is the opposite of what the tag would claim.
 *
 * 3. SUBTYPES NAMED BY NO CARD — 109 of the 350 that survive rules 1, 4 and 5.
 *    Same inertness argument, and it is a fact about the corpus rather than a
 *    threshold someone picked. It also sweeps up the four type-line parse
 *    artefacts — `of` (Miss Demeanor, "Lady of Proper Etiquette"), `You`, `The`
 *    (B.F.M.) and `and/or` (Shellephant).
 *
 * 4. PLANESWALKER SUBTYPES, all 80. They are proper names, not tribes: a
 *    "Chandra deck" is a superfriends deck, and the model has nothing to say
 *    about it that `Legendary` would not. Refusing them also removes the whole
 *    class of words that must never be pluralised for display.
 *
 * 5. `subtype:treasure`, which would be a second name for the existing
 *    `treasure` event tag. Food, Clue and Blood are not duplicates and stay.
 *
 * ------------------------------------------------------------- the spelling
 *
 * Namespaced, and lowercase-kebab. Both halves are forced:
 *
 *   - bare names COLLIDE. `Treasure` is an artifact subtype and an existing
 *     tag; `Landfall`, `Mill`, `Food` and `Flashback` are Scryfall keywords and
 *     existing tags. `normaliseTag` lowercases every value the search box
 *     takes, so case cannot be the discriminator.
 *   - the prefix is `subtype:`/`ability:` and NOT `type:`/`kw:`, because those
 *     two are already query FIELD aliases. `kw:flying` means "has the Flying
 *     keyword" in the search box, and a tag VALUE spelled the same way one
 *     colon over would be two meanings for one string.
 *   - lowercase-kebab because that is what `normaliseTag` produces. A tag
 *     stored in any other spelling is a tag `produces:` cannot reach.
 *
 * The query tokenizer takes the EARLIEST operator, so `produces:subtype:elf`
 * splits at the first colon and the value keeps its own. No quoting needed.
 */

export const SUBTYPE_PREFIX = 'subtype:'
export const ABILITY_PREFIX = 'ability:'

export type SubtypeTag = `subtype:${string}`
export type AbilityTag = `ability:${string}`
export type SemanticTag = SubtypeTag | AbilityTag

/**
 * The words the rules match on, in Scryfall's own casing.
 *
 * Casing is load-bearing on the subtype side and is the whole of that rule's
 * precision: Magic capitalises a subtype whenever it names one, so "target
 * Human" is a reference and "the human cost" — were a card ever to print it —
 * is not.
 */
export interface SemanticVocabulary {
  readonly subtypes: readonly string[]
  readonly abilities: readonly string[]
}

export const SEMANTIC_VOCABULARY: SemanticVocabulary = {
  subtypes: rawVocabulary.subtypes,
  abilities: rawVocabulary.abilities,
}

const slug = (word: string): string => word.toLowerCase().replace(/\s+/g, '-')

export const subtypeTag = (word: string): SubtypeTag => `${SUBTYPE_PREFIX}${slug(word)}`
export const abilityTag = (word: string): AbilityTag => `${ABILITY_PREFIX}${slug(word)}`

export const SEMANTIC_TAGS: readonly SemanticTag[] = [
  ...SEMANTIC_VOCABULARY.subtypes.map(subtypeTag),
  ...SEMANTIC_VOCABULARY.abilities.map(abilityTag),
]

/**
 * The subtype words on a type line — everything right of the em dash.
 *
 * Scryfall gives ONE joined type line per card and no per-face decomposition
 * ("Creature — Bat // Creature — Vampire"), so both halves have to be read out
 * of the one string. A face with no dash contributes nothing rather than
 * contributing its card types, which is the refusal at the top of this file
 * made structural: the words left of the dash are never reachable from here.
 */
export const subtypesOfTypeLine = (typeLine: string): readonly string[] => {
  const out: string[] = []
  for (const face of typeLine.split(' // ')) {
    const parts = face.split(/\s+[—–]\s+/)
    const tail = parts[1]
    if (tail === undefined) continue
    for (const word of tail.trim().split(/\s+/)) if (word !== '') out.push(word)
  }
  return out
}

/**
 * English pluralisation, with the exceptions the vocabulary actually contains.
 *
 * Two jobs, and only one of them is cosmetic. MATCHING needs the plural because
 * "Elves you control get +1/+1" is the single commonest tribal sentence in the
 * format and `Elf` does not appear in it. DISPLAY needs it because the tag's
 * words are derived from the tag rather than written out — see
 * `semanticTagWords`.
 *
 * The INVARIANT list is the part that had to be written rather than derived,
 * and it is fifteen words rather than 292 because the algorithm is right about
 * the rest. Deriving it from the corpus was tried and abandoned: "does the
 * plural ever appear in a card's text" separates Equipment from Elephant not at
 * all, because the corpus simply never has cause to write "Elephants" either.
 * So the rule is the English one and the exceptions are named.
 *
 * A wrong plural costs nothing on the matching side — the pattern accepts the
 * singular too — and is only ever visible as a label.
 */
const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
  // -f / -fe, the class the Elf lord lives in.
  ['Elf', 'Elves'],
  ['Dwarf', 'Dwarves'],
  ['Wolf', 'Wolves'],
  ['Werewolf', 'Werewolves'],
  ['Thief', 'Thieves'],
  // Latinate.
  ['Fungus', 'Fungi'],
  ['Homunculus', 'Homunculi'],
  ['Locus', 'Loci'],
  ['Cyclops', 'Cyclopes'],
  // Mass nouns and invariant plurals. `Plains` is already plural; the -folk and
  // -kin words never take one; Equipment is what a card actually says.
  ['Equipment', 'Equipment'],
  ['Plains', 'Plains'],
  ['Arcane', 'Arcane'],
  ['Merfolk', 'Merfolk'],
  ['Kithkin', 'Kithkin'],
  ['Treefolk', 'Treefolk'],
  ['Moonfolk', 'Moonfolk'],
  ['Eldrazi', 'Eldrazi'],
  ['Samurai', 'Samurai'],
  ['Spacecraft', 'Spacecraft'],
  ['Fish', 'Fish'],
  ['Elk', 'Elk'],
  ['Myr', 'Myr'],
  ['Kavu', 'Kavu'],
  ['Zubera', 'Zubera'],
  ['Aurochs', 'Aurochs'],
  ['Ox', 'Oxen'],
])

export const pluralOfSubtype = (word: string): string => {
  const irregular = IRREGULAR_PLURALS.get(word)
  if (irregular !== undefined) return irregular
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/[^aeiou]o$/.test(word)) return `${word}es`
  return `${word}s`
}

/**
 * The tag in words, DERIVED rather than written.
 *
 * `apps/web/src/tags.ts` holds one hand-written phrase per curated event tag
 * and a test that asserts none is missing. That table cannot grow to 292 and
 * does not have to: a subtype's words are the subtype, and a keyword's are the
 * keyword. Both slot into the sentences both surfaces already use — "this card
 * benefits from Elves", "causes Equipment".
 *
 * `null` for anything outside the vocabulary, so `readable()` can fall through
 * to its own table rather than this one inventing a phrase for a tag it has
 * never seen.
 */
const WORDS: ReadonlyMap<string, string> = new Map([
  ...SEMANTIC_VOCABULARY.subtypes.map((word) => [subtypeTag(word), pluralOfSubtype(word)] as const),
  ...SEMANTIC_VOCABULARY.abilities.map((word) => [abilityTag(word), word.toLowerCase()] as const),
])

export const semanticTagWords = (tag: string): string | null => WORDS.get(tag) ?? null

export const isSemanticTag = (tag: string): tag is SemanticTag =>
  tag.startsWith(SUBTYPE_PREFIX) || tag.startsWith(ABILITY_PREFIX)

export interface SemanticTokens {
  readonly produces: readonly SemanticTag[]
  readonly wants: readonly SemanticTag[]
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Reminder text is about the RULES, not about this deck.
 *
 * The single largest false positive in the whole change, measured: 417 cards
 * carry Reach, whose reminder reads "(This creature can block creatures with
 * flying.)", and every one of them wanted `ability:flying` before this line
 * existed.
 */
const stripReminder = (text: string): string => text.replace(/\([^)]*\)/g, ' ')

/**
 * A card naming ITSELF is not a card naming a tribe.
 *
 * Pre-2024 templating spells the card's own name in its rules text, and a
 * card's name is also ordinary English — so "When Kogla, the Titan Ape enters"
 * asked to be paired with Apes. The short form is taken as well because
 * Scryfall's older text uses it ("Whenever Kogla attacks"), and it is length-
 * gated so that a one-word legend does not blank a common noun out of its own
 * rules text.
 */
const stripOwnName = (name: string, text: string): string => {
  let out = text
  for (const part of [name, ...name.split(' // ')]) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    out = out.split(trimmed).join(' ')
    const short = trimmed.split(/,| the /)[0]?.trim() ?? ''
    if (short.length >= 4) out = out.split(short).join(' ')
  }
  return out
}

/**
 * Making a thing is not wanting it, and the direction is the point.
 *
 * "Create two 1/1 white Soldier creature tokens" is the ENABLER of a Soldier
 * deck. Reading it as the payoff would report the reason backwards, and a
 * direction inversion is the worst error this model can make — pillar P4 has
 * the reason carry the why. So the clause is read as a producer and then
 * removed before the want side sees the text.
 *
 * The clause runs PAST the word "token", to take the abilities the token is
 * made with. Stopping at "token" left " with lifelink" and " with prowess"
 * lying in the sentence, and "For each creature you control, create a 1/2 white
 * Moogle creature token with lifelink" then matched the `for each … with X`
 * payoff template — two keywords entered the vocabulary on nothing but that.
 * It stops at a comma as well as a full stop, because past the comma the
 * sentence has moved on: "create a 2/1 Villain token with menace, THEN
 * creatures you control get +1/+0" is a token clause followed by an anthem.
 */
const TOKEN_CLAUSE =
  /\bcreates?\b[^.\n]{0,120}?\btokens?\b(?:\s+(?:with|that has|that have)\b[^.,\n]{0,80})?/gi

/**
 * "This Vehicle", "that Saga" — a card naming its own type line.
 *
 * 263 cards mentioned `Vehicle` and 85 of them said nothing but "this Vehicle";
 * the same shape covers every Saga chapter and every Aura. Refusing it does not
 * cost the real payoff, because a card that cares about OTHER Vehicles says so
 * with a different determiner.
 */
const SELF_REFERENCE = /\b(?:[Tt]his|[Tt]hat) [A-Z][a-z]+\b/g

/**
 * Capitalised words, which is how the subtype rules read the text at all.
 *
 * Extracting the words and looking each one up beats testing 241 patterns
 * against every face: it is one pass over the text instead of one pass per
 * vocabulary entry, and the vocabulary can grow without the ingest slowing
 * down. Apostrophes and hyphens are inside the word so that `Urza's` and
 * `Assembly-Worker` survive.
 *
 * The capital at the START is not the precision — the lookup table is keyed on
 * Scryfall's own casing, so "trap counter" could not resolve to Trap either way.
 * What it buys is the opposite: it stops a LOWERCASE PREFIX from swallowing the
 * word after a hyphen. "sacrifices a non-Elf creature" is an Elf deck's card,
 * and a pattern that may begin lowercase consumes `non-Elf` whole and finds
 * nothing. Measured rather than argued: 165 commander-legal cards change answer
 * between the two, all of them in that shape.
 */
const CAPITALISED = /\b[A-Z][A-Za-z'’-]*/g

const capitalisedWords = (text: string): Set<string> => {
  const found = new Set<string>()
  for (const match of text.matchAll(CAPITALISED)) found.add(match[0])
  return found
}

/**
 * The four shapes a keyword payoff is actually written in.
 *
 * Built per vocabulary rather than per card, because the ability list is short
 * and closed. Each asks for the keyword in a position where the card is keying
 * OFF it rather than handing it out.
 */
const abilityPayoffPatterns = (keyword: string): readonly RegExp[] => {
  const key = escape(keyword)
  return [
    // The anthem: "Creatures you control with flying get +1/+1."
    new RegExp(
      `\\b(?:creatures?|permanents?|spells?)\\b[^.\\n]{0,40}\\bwith ${key}\\b[^.\\n]{0,40}\\b(?:gets?|have|has|gains?)\\b`,
      'i',
    ),
    // The trigger: "whenever a creature you control with trample attacks".
    new RegExp(`\\bwhenever\\b[^.,\\n]{0,60}\\bwith ${key}\\b`, 'i'),
    // The count: "for each creature you control with vigilance".
    new RegExp(`\\bfor each\\b[^.\\n]{0,40}\\bwith ${key}\\b`, 'i'),
    // The condition: "as long as you control a creature with flying".
    new RegExp(`\\bas long as\\b[^.\\n]{0,50}\\bwith ${key}\\b`, 'i'),
  ]
}

interface Compiled {
  /** Every spelling that names a subtype, singular and plural, to the word. */
  readonly subtypeByWord: ReadonlyMap<string, string>
  readonly abilities: ReadonlyMap<string, readonly RegExp[]>
}

const compile = (vocabulary: SemanticVocabulary): Compiled => {
  const subtypeByWord = new Map<string, string>()
  for (const word of vocabulary.subtypes) {
    subtypeByWord.set(word, word)
    subtypeByWord.set(pluralOfSubtype(word), word)
  }
  const abilities = new Map<string, readonly RegExp[]>()
  for (const keyword of vocabulary.abilities) abilities.set(keyword, abilityPayoffPatterns(keyword))
  return { subtypeByWord, abilities }
}

const CACHE = new WeakMap<SemanticVocabulary, Compiled>()
const compiled = (vocabulary: SemanticVocabulary): Compiled => {
  const hit = CACHE.get(vocabulary)
  if (hit !== undefined) return hit
  const made = compile(vocabulary)
  CACHE.set(vocabulary, made)
  return made
}

/**
 * A card's subtype and keyword tags.
 *
 * Read one FACE at a time, for the reason `deriveSynergy` gives: a gap that
 * crosses the newline `oracleText` joins faces with reads a subject on the
 * front face against a verb on the back, and those two abilities never share a
 * game state. The type line is a property of the CARD and is read once — the
 * same ruling `deriveSynergy` makes, and for the same reason: Scryfall hands
 * over one joined type line and no per-face split, so decomposing it would be
 * a guess.
 */
export const deriveSemanticTokens = (
  card: Pick<Card, 'name' | 'oracleText' | 'typeLine'> &
    Partial<Pick<Card, 'oracleTextFaces' | 'keywords'>>,
  vocabulary: SemanticVocabulary = SEMANTIC_VOCABULARY,
): SemanticTokens => {
  const { subtypeByWord, abilities } = compiled(vocabulary)
  const produces = new Set<SemanticTag>()
  const wants = new Set<SemanticTag>()

  const own = new Set<string>()
  for (const word of subtypesOfTypeLine(card.typeLine)) {
    const subtype = subtypeByWord.get(word)
    if (subtype === undefined) continue
    own.add(subtype)
    produces.add(subtypeTag(subtype))
  }

  for (const keyword of card.keywords ?? []) {
    if (abilities.has(keyword)) produces.add(abilityTag(keyword))
  }

  const faces = card.oracleTextFaces ?? [card.oracleText]
  for (const face of faces) {
    if (face === '') continue
    const plain = stripOwnName(card.name, stripReminder(face))

    // Producers first, because the clause they read is then taken out of the
    // text the want side sees.
    for (const clause of plain.match(TOKEN_CLAUSE) ?? []) {
      for (const word of capitalisedWords(clause)) {
        const subtype = subtypeByWord.get(word)
        if (subtype !== undefined) produces.add(subtypeTag(subtype))
      }
    }

    const remaining = plain.replace(TOKEN_CLAUSE, ' ').replace(SELF_REFERENCE, ' ')
    for (const word of capitalisedWords(remaining)) {
      const subtype = subtypeByWord.get(word)
      if (subtype !== undefined) wants.add(subtypeTag(subtype))
    }

    // Read against the SAME stripped text the subtype wants use, so that
    // "create a 1/1 Thopter token with flying" cannot reach a payoff pattern
    // through the clause that already produced it.
    for (const [keyword, patterns] of abilities) {
      if (patterns.some((pattern) => pattern.test(remaining))) wants.add(abilityTag(keyword))
    }
  }

  return { produces: [...produces], wants: [...wants] }
}
