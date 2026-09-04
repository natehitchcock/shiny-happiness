import type { Card } from './card.js'
import { CREATES_ANYONE, CREATES_FOR_YOU } from './token-subject.js'
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
  /**
   * The subtypes that are somebody's NAME rather than a tribe — every subtype
   * that appears only on a Planeswalker type line.
   *
   * A display fact and nothing else. Membership is decided by the same
   * inertness rule as everything else; this list exists so the pluralisation
   * rule can say "not this one" without a hand-written table. "Chandras" is not
   * a word, and a rendering problem is not a reason to refuse a tag.
   *
   * Optional so a hand-written vocabulary in a test does not have to carry one.
   */
  readonly properNouns?: readonly string[]
}

export const SEMANTIC_VOCABULARY: SemanticVocabulary = {
  subtypes: rawVocabulary.subtypes,
  abilities: rawVocabulary.abilities,
  properNouns: rawVocabulary.properNouns,
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
 * How a subtype is written when it is named to a person.
 *
 * The English rule, EXCEPT for a proper name. "Elves you control" is what a
 * card says; "Chandras you control" is not a sentence anybody would write. The
 * exception is read from the vocabulary rather than typed here, because which
 * subtypes are names is a fact about the corpus — they are the ones that appear
 * only on a Planeswalker type line — and the generator already knows it.
 */
export const displaySubtype = (
  word: string,
  vocabulary: SemanticVocabulary = SEMANTIC_VOCABULARY,
): string => (vocabulary.properNouns?.includes(word) === true ? word : pluralOfSubtype(word))

/**
 * The tag in words, DERIVED rather than written.
 *
 * `apps/web/src/tags.ts` holds one hand-written phrase per curated event tag
 * and a test that asserts none is missing. That table cannot grow to 558 and
 * does not have to: a subtype's words are the subtype, and a keyword's are the
 * keyword. Both slot into the sentences both surfaces already use — "this card
 * benefits from Elves", "causes Equipment".
 *
 * `null` for anything outside the vocabulary, so `readable()` can fall through
 * to its own table rather than this one inventing a phrase for a tag it has
 * never seen.
 */
const WORDS: ReadonlyMap<string, string> = new Map([
  ...SEMANTIC_VOCABULARY.subtypes.map((word) => [subtypeTag(word), displaySubtype(word)] as const),
  ...SEMANTIC_VOCABULARY.abilities.map((word) => [abilityTag(word), word.toLowerCase()] as const),
])

export const semanticTagWords = (tag: string): string | null => WORDS.get(tag) ?? null

export const isSemanticTag = (tag: string): tag is SemanticTag =>
  tag.startsWith(SUBTYPE_PREFIX) || tag.startsWith(ABILITY_PREFIX)

/**
 * Three directions, not two (ADR-0048).
 *
 * `has` is the MEMBERSHIP relation and it is what these two families are mostly
 * about: a card does not *cause* flying, it *has* it; Ambush Commander does not
 * *produce* Elf, it *is* one. Forcing membership into `produces` was a
 * modelling error with a measurable symptom — 298 of the 317 keywords looked
 * inert, because a tag can only appear in a match through a verb it does not
 * have.
 *
 * `produces` survives here and means what it means everywhere else in the
 * model — the card CAUSES the thing to exist:
 *
 *   type line says Elf                       → has `subtype:elf`
 *   "create a 1/1 white Soldier token"       → produces `subtype:soldier`
 *   the card has flying                      → has `ability:flying`
 *   "target creature gains flying"           → produces `ability:flying`
 *
 * The token-maker and the grant are genuine causes: neither card is the thing,
 * both make one. That line was invisible while there were only two verbs, and
 * the grant side could not be expressed at all — it was stripped out of the
 * `wants` read to stop a direction inversion and then dropped on the floor.
 */
export interface SemanticTokens {
  readonly has: readonly SemanticTag[]
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
 *
 * TWO of them, and the pair is ADR-0054 (`token-subject.ts`). `TOKEN_CLAUSE`
 * is every creation clause and is what gets STRIPPED; `YOUR_TOKEN_CLAUSE` is
 * the subset whose tokens are yours and is what gets PRODUCED from. Hunted
 * Troll — "target opponent creates four 1/1 blue Faerie creature tokens with
 * flying" — must claim neither `subtype:faerie` nor `ability:flying`, and must
 * still have the clause taken out of the text before the payoff rules read it,
 * or refusing to claim the Faeries would turn it into a card that WANTS them.
 */
const CLAUSE_TAIL = String.raw`[^.\n]{0,120}?\btokens?\b(?:\s+(?:with|that has|that have)\b[^.,\n]{0,80})?`
const TOKEN_CLAUSE = new RegExp(`${CREATES_ANYONE}${CLAUSE_TAIL}`, 'gi')
const YOUR_TOKEN_CLAUSE = new RegExp(`${CREATES_FOR_YOU}${CLAUSE_TAIL}`, 'gi')

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
 * A subtype the card says it is NOT about (ADR-0059).
 *
 * `Karn Liberated` wanted `subtype:aura` out of "leaving in exile all NON-AURA
 * permanent cards", and `Mikaeus, the Unhallowed` benefited from Humans on the
 * strength of "Other NON-HUMAN creatures you control get +1/+1" — which is the
 * opposite of what he is played for. He is a Zombie.
 *
 * `non-⟨Subtype⟩` DOES NOT ALWAYS MEAN THE CARD IS NOT ABOUT THAT SUBTYPE, and
 * this file already had a test saying so. Ruthless Winnower — "each player
 * sacrifices a NON-ELF creature of their choice" — is an Elf deck's card: the
 * edict spares your board and eats everybody else's, and the negation is the
 * whole reason to play it. That test is right and it is the one that found the
 * discriminator, because the two cards differ by one readable fact:
 *
 *   Ruthless Winnower       Creature — ELF Warrior      "non-Elf"   → wants Elf
 *   Mikaeus, the Unhallowed Creature — ZOMBIE           "non-Human" → does not
 *   Karn Liberated          Planeswalker — Karn         "non-Aura"  → does not
 *
 * A NEGATION IS A WANT ONLY WHEN THE CARD IS THAT SUBTYPE ITSELF. "Not one of
 * mine" is a tribal card's way of naming its tribe; "not one of those" is
 * everybody else's way of naming a category, and the second is what Karn and
 * Mikaeus are doing. The type line is the fact that tells them apart, and it is
 * the same instrument `land-creature` and `ritual` already use in `synergy.ts`.
 *
 * The whole token is blanked, hyphen and all, because `CAPITALISED` above
 * deliberately starts at a capital and so reads `Human` straight out of
 * `non-Human`. That property is load-bearing for its own reason — the note on
 * `CAPITALISED` measures it at 165 cards — and this is the other half of it.
 *
 * THE CLAUSE IS THE UNIT and only the negated mention is blanked, which keeps
 * the cards that mean both even when the type line does not save them: Winota,
 * Joiner of Forces triggers on "a NON-HUMAN creature you control attacks" and
 * then puts "a HUMAN creature card" onto the battlefield, and the second
 * mention is untouched.
 */
const NEGATED_SUBTYPE = /\bnon-[A-Z][A-Za-z'’-]*/g

/**
 * An Aura that MAKES its host a subtype rather than caring about one
 * (ADR-0059).
 *
 * `Frogify` wanted `subtype:frog`. It does not benefit from Frogs; it turns an
 * opponent's creature into one, which is the direction inversion ADR-0016 calls
 * the worst error this model can make. 11 commander-legal cards —
 * Ichthyomorphosis, Witness Protection, Kenrith's Transformation, Lignify,
 * Reprobation, Oni Possession.
 *
 * REFUSED, not re-pointed at `produces`, and that is the deliberate call. The
 * symmetry with ADR-0048's "granting a keyword is CAUSING it" is tempting and
 * it breaks on the subject: the creature being transformed is the one the card
 * just answered, so the Frog is the opponent's. ADR-0054 made that ruling about
 * a donated token and it is the same ruling one clause over.
 *
 * The gap between the noun and the verb is what reads Frogify at all: it says
 * "enchanted creature LOSES ALL ABILITIES AND IS a blue Frog", so the two are
 * not adjacent. `[^.\n]` keeps the reach inside the sentence the Aura's own
 * clause occupies.
 *
 * "AS LONG AS" AND "IF" TURN THE SAME WORDS INTO THEIR OPPOSITE, and the guard
 * for it was found by diffing the corpus rather than by reading. "Enchanted
 * creature IS a Knight" is Dub making one; "AS LONG AS equipped creature IS a
 * Human, it has lifelink" is Butcher's Cleaver asking for one. The second is a
 * CONDITION — the card is worth more in a deck full of that subtype, which is
 * the definition of a want — and an unguarded rule read it as a transformation
 * and took the tag off the whole Human-Equipment cycle. 12 cards: Butcher's
 * Cleaver, Sharpened Pitchfork, True-Faith Censer, Silver-Inlaid Dagger, Heavy
 * Mattock, Bladed Bracers, Harvest Hand, Hope Against Hope, Equestrian Skill,
 * Blade of the Bloodchief, Lavamancer's Skill and Howl of the Hunt. 61 clauses
 * become 49, and all 12 handed back are payoffs.
 */
const TRANSFORMED_HOST =
  /(?<!\bas long as )(?<!\bif )\b(?:enchanted|equipped) creature\b[^.\n]{0,40}?\b(?:is|becomes) an?\b[^.\n]*/gi

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
/**
 * The keyword, refusing the longer keywords it is a PREFIX of (ADR-0059).
 *
 * `Double` and `Double strike` are both in the vocabulary and `\bDouble\b`
 * matches inside the second, so 177 of the 304 commander-legal cards carrying
 * `ability:double` are cards whose text says "double strike" and nothing else.
 * The focus prompt offered the builder "double" and "double strike" as adjacent
 * chips meaning the same thing.
 *
 * BUILT FROM THE VOCABULARY rather than written as a list of pairs, because the
 * vocabulary is generated and the pairs are not stable: today there are four —
 * Double/Double strike, Hexproof/Hexproof from, Manifest/Manifest dread,
 * Partner/Partner with — and a fifth arrives already handled. That is the
 * ruling ADR-0060 made one file over: a list is the defect.
 *
 * The guard is a lookahead over the REMAINDER, not over the whole longer
 * keyword, so it composes after `\b${key}\b` wherever that appears.
 */
const keywordPattern = (keyword: string, vocabulary: readonly string[]): string => {
  const longer = vocabulary
    .filter((other) => other.toLowerCase().startsWith(`${keyword.toLowerCase()} `))
    .map((other) => escape(other.slice(keyword.length + 1)))
  const guard = longer.length === 0 ? '' : `(?! (?:${longer.join('|')})\\b)`
  return `\\b${escape(keyword)}\\b${guard}`
}

const abilityPayoffPatterns = (
  keyword: string,
  vocabulary: readonly string[],
): readonly RegExp[] => {
  const key = keywordPattern(keyword, vocabulary)
  return [
    // The anthem: "Creatures you control with flying get +1/+1."
    new RegExp(
      `\\b(?:creatures?|permanents?|spells?)\\b[^.\\n]{0,40}\\bwith ${key}[^.\\n]{0,40}\\b(?:gets?|have|has|gains?)\\b`,
      'i',
    ),
    // The trigger: "whenever a creature you control with trample attacks".
    new RegExp(`\\bwhenever\\b[^.,\\n]{0,60}\\bwith ${key}`, 'i'),
    // The count: "for each creature you control with vigilance".
    new RegExp(`\\bfor each\\b[^.\\n]{0,40}\\bwith ${key}`, 'i'),
    // The condition: "as long as you control a creature with flying".
    new RegExp(`\\bas long as\\b[^.\\n]{0,50}\\bwith ${key}`, 'i'),
  ]
}

interface Compiled {
  /** Every spelling that names a subtype, singular and plural, to the word. */
  readonly subtypeByWord: ReadonlyMap<string, string>
  readonly abilities: ReadonlyMap<string, readonly RegExp[]>
  /** Multi-word keyword names, blanked before subtypes are read. See below. */
  readonly phrases: readonly RegExp[]
}

const compile = (vocabulary: SemanticVocabulary): Compiled => {
  const subtypeByWord = new Map<string, string>()
  for (const word of vocabulary.subtypes) {
    subtypeByWord.set(word, word)
    subtypeByWord.set(pluralOfSubtype(word), word)
  }
  const abilities = new Map<string, readonly RegExp[]>()
  for (const keyword of vocabulary.abilities)
    abilities.set(keyword, abilityPayoffPatterns(keyword, vocabulary.abilities))
  /*
   * A keyword's NAME is not a subtype reference (ADR-0046).
   *
   * `Will` is a planeswalker type and "Will of the council" is an ability word,
   * and the second is far commoner: of the 19 cards that appeared to want
   * `subtype:will`, most say "Will of the council" or "Will of the
   * Planeswalkers" and have nothing to do with Will Kenrith. Blanking the
   * keyword's own name before the subtype words are extracted fixes it without
   * a special case for that one word.
   *
   * MULTI-WORD names only, and that restriction is the point. A one-word
   * keyword that is also a subtype is genuinely ambiguous — blanking it would
   * cost the real references — while "Will of the council" is four words and
   * can be nothing else.
   */
  const phrases = vocabulary.abilities
    .filter((keyword) => keyword.includes(' '))
    .map((keyword) => new RegExp(`\\b${escape(keyword)}\\b`, 'gi'))
  return { subtypeByWord, abilities, phrases }
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
/**
 * What a card IS or HAS, from its type line and its keywords alone.
 *
 * SEPARATE from `deriveSemanticTokens` and exported, because this half is not
 * stored (ADR-0048) and the other two are. The rule the two ADRs together
 * settle is worth stating: **store a derivation whose inputs the read does not
 * need; derive one whose inputs it already carries.**
 *
 * `produces` and `wants` are regexes over `oracle_text`, which is the column a
 * trimmed read most wants to be rid of, so ADR-0011 stores them and buys
 * something real. This is two set intersections over `type_line` and
 * `keywords`, both of which every read already carries — so storing it would
 * mean shipping a pure function of data already on the wire. Measured: 13.0 ms
 * for the whole 31,782-card eligible pool, against 1.98 MiB of column.
 *
 * The consequence is a real coupling and is named here rather than left to be
 * discovered: `type_line` and `keywords` MUST stay in every read that expects a
 * card to know its own tribe. `packages/db` has a test that fails if either
 * leaves the eligible column list, because a derivation whose inputs can be
 * silently trimmed away is a landmine rather than a saving.
 */
export const semanticMembership = (
  card: Pick<Card, 'typeLine'> & Partial<Pick<Card, 'keywords'>>,
  vocabulary: SemanticVocabulary = SEMANTIC_VOCABULARY,
): readonly SemanticTag[] => {
  const { subtypeByWord, abilities } = compiled(vocabulary)
  const has = new Set<SemanticTag>()
  for (const word of subtypesOfTypeLine(card.typeLine)) {
    const subtype = subtypeByWord.get(word)
    if (subtype === undefined) continue
    has.add(subtypeTag(subtype))
  }
  for (const keyword of card.keywords ?? []) {
    if (abilities.has(keyword)) has.add(abilityTag(keyword))
  }
  return [...has]
}

export const deriveSemanticTokens = (
  card: Pick<Card, 'name' | 'oracleText' | 'typeLine'> &
    Partial<Pick<Card, 'oracleTextFaces' | 'keywords'>>,
  vocabulary: SemanticVocabulary = SEMANTIC_VOCABULARY,
): SemanticTokens => {
  const { subtypeByWord, abilities, phrases } = compiled(vocabulary)
  const has = new Set<SemanticTag>(semanticMembership(card, vocabulary))
  const produces = new Set<SemanticTag>()
  const wants = new Set<SemanticTag>()
  // What the card IS, which is what decides whether a `non-⟨Subtype⟩` clause
  // names its own tribe or somebody else's category (ADR-0059).
  const ownSubtypes = new Set<string>()
  for (const word of subtypesOfTypeLine(card.typeLine)) {
    const subtype = subtypeByWord.get(word)
    if (subtype !== undefined) ownSubtypes.add(subtype)
  }

  const faces = card.oracleTextFaces ?? [card.oracleText]
  for (const face of faces) {
    if (face === '') continue
    const plain = stripOwnName(card.name, stripReminder(face))

    // Producers first, because the clause they read is then taken out of the
    // text the want side sees. `YOUR_TOKEN_CLAUSE` rather than `TOKEN_CLAUSE`:
    // a subtype you handed to an opponent is not one this deck causes to exist
    // for itself (ADR-0054).
    for (const clause of plain.match(YOUR_TOKEN_CLAUSE) ?? []) {
      for (const word of capitalisedWords(clause)) {
        const subtype = subtypeByWord.get(word)
        if (subtype !== undefined) produces.add(subtypeTag(subtype))
      }
    }

    const remaining = plain.replace(TOKEN_CLAUSE, ' ').replace(SELF_REFERENCE, ' ')
    // A keyword's own name is not a subtype reference: "Will of the council" is
    // an ability word and Will is a planeswalker type. Blanked only for the
    // SUBTYPE read — the keyword payoff patterns below need the name intact.
    // A subtype the card says it is NOT about, and a subtype the card MAKES
    // rather than wants (ADR-0059). Both are blanked for the SUBTYPE read only,
    // the way the keyword names above are: the keyword rules read `remaining`.
    //
    // A negation survives when the card IS that subtype, because "not one of
    // mine" is how a tribal card names its tribe — see `NEGATED_SUBTYPE`.
    let forSubtypes = remaining
      .replace(NEGATED_SUBTYPE, (negated) => {
        const subtype = subtypeByWord.get(negated.slice('non-'.length))
        return subtype !== undefined && ownSubtypes.has(subtype) ? negated : ' '
      })
      .replace(TRANSFORMED_HOST, ' ')
    for (const phrase of phrases) forSubtypes = forSubtypes.replace(phrase, ' ')
    for (const word of capitalisedWords(forSubtypes)) {
      const subtype = subtypeByWord.get(word)
      if (subtype !== undefined) wants.add(subtypeTag(subtype))
    }

    // Read against the SAME stripped text the subtype wants use, so that
    // "create a 1/1 Thopter token with flying" cannot reach a payoff pattern
    // through the clause that already produced it.
    for (const [keyword, patterns] of abilities) {
      if (patterns.some((pattern) => pattern.test(remaining))) wants.add(abilityTag(keyword))
    }

    /*
     * Granting a keyword is CAUSING it (ADR-0048), and until there was a third
     * direction this claim had nowhere to live. The grant clause was stripped
     * out of the payoff read to stop a direction inversion — "target creature
     * gains flying" is not a flying payoff — and then thrown away, so 495 cards
     * that hand out flying said nothing about flying at all.
     *
     * Read on `plain` rather than `remaining`, because a token made WITH a
     * keyword is also a way of causing it: "create a 1/1 Thopter with flying"
     * puts a flier on the battlefield exactly as "target creature gains flying"
     * does. The token clause is removed for the WANT read and kept for this one.
     */
    for (const keyword of abilities.keys()) {
      // The same prefix guard the payoff patterns take (ADR-0059): "target
      // creature gains DOUBLE STRIKE" grants one keyword, not two.
      const key = keywordPattern(keyword, vocabulary.abilities)
      const grant = new RegExp(
        `\\b(?:gains?|have|has)\\b[^.\\n]{0,45}${key}` +
          `|${CREATES_FOR_YOU}[^.\\n]{0,120}?\\btokens?\\b[^.\\n]{0,60}?\\bwith\\b[^.\\n]{0,60}?${key}`,
        'i',
      )
      if (grant.test(plain)) produces.add(abilityTag(keyword))
    }
  }

  return { has: [...has], produces: [...produces], wants: [...wants] }
}
