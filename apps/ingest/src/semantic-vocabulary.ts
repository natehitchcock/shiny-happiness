import fs from 'node:fs'
import path from 'node:path'
import { configFromEnv, createPool } from '@roundtable/db'
import { deriveSemanticTokens, type SemanticVocabulary } from '@roundtable/domain'

/**
 * Regenerate `packages/domain/src/semantic-vocabulary.data.json` (ADR-0046).
 *
 * `node dist/semantic-vocabulary.js [--out <path>]`
 *
 * The vocabulary is a fact about the corpus, not a list somebody typed, and it
 * changes every time Wizards prints a set. So it is generated here — where the
 * database is — and committed, because `packages/domain` is pure (R1) and
 * cannot read a table.
 *
 * The refusal rule is the one this file exists to apply, and it is provable
 * rather than a threshold: a tag with no PRODUCER or no WANTER anywhere in the
 * corpus can appear in none of the three directions `synergyMatches` scores, so
 * storing it is storage spent on a claim nothing can ever read. Everything else
 * — card types, planeswalker types, the landwalk hate templates, the duplicate
 * of an existing event tag — is named explicitly below with its reason.
 *
 * It is NOT bulk card data (AGENTS.md §5). It is a few hundred words.
 */

interface Row {
  readonly type_line: string
  readonly name: string
  readonly oracle_text: string
  readonly oracle_text_faces: readonly string[] | null
  readonly keywords: readonly string[]
}

/**
 * Card types and supertypes. Refused wholesale: `Creature` alone is 55.9% of
 * the corpus, `t:` already filters them, and `artifact-etb`, `enchantment-etb`
 * and `spell-cast` already carry the three that name an event.
 *
 * Listed rather than derived from the left of the dash, because a type line
 * that omits its dash would otherwise leak its types into the vocabulary.
 */
const CARD_TYPES = new Set([
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Instant',
  'Kindred',
  'Land',
  'Planeswalker',
  'Sorcery',
  'Tribal',
  'Basic',
  'Legendary',
  'Snow',
  'World',
])

/** A second name for an event tag `synergy.ts` already owns. */
const ALREADY_AN_EVENT = new Set(['Treasure'])

/**
 * The splitter leaking, not subtypes.
 *
 * Everything right of the em dash is read as subtypes, and four un-cards put
 * ordinary English there: Miss Demeanor is a "Lady OF Proper Etiquette", B.F.M.
 * is "THE Biggest, Baddest, Nastiest,", Shellephant is a "Turtle AND/OR
 * Elephant", and Liliana's Other Contract's back face is a "Legendary
 * Planeswalker — YOU".
 *
 * They cannot be caught by the inertness rule, and that is the point of naming
 * them: `You` and `The` appear in the rules text of thousands of cards, so both
 * would sail through with one producer and four thousand wanters and become the
 * two broadest tags in the vocabulary.
 */
const PARSER_ARTEFACTS = new Set(['of', 'You', 'The', 'and/or'])

/**
 * Landwalk. Each measures two payoffs and both are the HATE template —
 * "Creatures with swampwalk can be blocked as though they didn't have
 * swampwalk" — which is the opposite of what the tag would claim.
 */
const REFUSED_KEYWORDS = new Set([
  'Landwalk',
  'Plainswalk',
  'Islandwalk',
  'Swampwalk',
  'Mountainwalk',
  'Forestwalk',
  'Nonbasic landwalk',
])

const main = async (): Promise<void> => {
  const outIndex = process.argv.indexOf('--out')
  const out =
    outIndex !== -1 && process.argv[outIndex + 1] !== undefined
      ? (process.argv[outIndex + 1] as string)
      : path.resolve(process.cwd(), '../../packages/domain/src/semantic-vocabulary.data.json')

  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    process.exit(1)
  }
  const pool = createPool(config)
  try {
    const { rows } = await pool.query<Row>(
      `SELECT type_line, name, oracle_text, oracle_text_faces, keywords
         FROM cards
        WHERE legality_commander IN ('legal', 'restricted')`,
    )
    console.error(`read ${rows.length} commander-legal cards`)

    /*
     * Every subtype word that exists, minus the categorical refusals.
     *
     * The planeswalker types are NOT one of those refusals, and an earlier
     * draft of this file had them as one. They are proper names — Chandra, Jace
     * — which is a fact about how to RENDER them, not about whether they belong.
     * Mixing a rendering rule into a membership rule is how the two drift apart,
     * so membership is left to the inertness rule like everything else and the
     * names are recorded below for the display side to read.
     */
    const everySubtype = new Set<string>()
    const planeswalkerOnly = new Set<string>()
    const elsewhere = new Set<string>()
    for (const row of rows) {
      for (const face of row.type_line.split(' // ')) {
        const parts = face.split(/\s+[—–]\s+/)
        const tail = parts[1]
        if (tail === undefined) continue
        const isPlaneswalker = /\bPlaneswalker\b/.test(parts[0] ?? '')
        for (const word of tail.trim().split(/\s+/)) {
          if (word === '') continue
          everySubtype.add(word)
          ;(isPlaneswalker ? planeswalkerOnly : elsewhere).add(word)
        }
      }
    }
    for (const word of elsewhere) planeswalkerOnly.delete(word)

    const everyKeyword = new Set<string>()
    for (const row of rows) for (const keyword of row.keywords) everyKeyword.add(keyword)

    const candidate: SemanticVocabulary = {
      subtypes: [...everySubtype].filter(
        (word) =>
          !CARD_TYPES.has(word) &&
          !ALREADY_AN_EVENT.has(word) &&
          !PARSER_ARTEFACTS.has(word) &&
          // Magic capitalises every subtype it prints. A lowercase word right of
          // the dash is the splitter reading a sentence, not a type.
          /^[A-Z]/.test(word),
      ),
      abilities: [...everyKeyword].filter((word) => !REFUSED_KEYWORDS.has(word)),
    }
    console.error(
      `candidates: ${candidate.subtypes.length} subtypes, ${candidate.abilities.length} keywords ` +
        `(refused ${CARD_TYPES.size} card types; ${planeswalkerOnly.size} planeswalker types ` +
        'are proper names, kept or refused on the same rule as everything else)',
    )

    // Run the real derivation over the whole corpus with the raw vocabulary,
    // and count both sides. Anything with an empty side is inert.
    const producers = new Map<string, number>()
    const wanters = new Map<string, number>()
    const bump = (into: Map<string, number>, key: string): void => {
      into.set(key, (into.get(key) ?? 0) + 1)
    }
    for (const row of rows) {
      const tokens = deriveSemanticTokens(
        {
          name: row.name,
          typeLine: row.type_line,
          oracleText: row.oracle_text,
          ...(row.oracle_text_faces !== null ? { oracleTextFaces: row.oracle_text_faces } : {}),
          keywords: row.keywords,
        },
        candidate,
      )
      for (const tag of tokens.produces) bump(producers, tag)
      for (const tag of tokens.wants) bump(wanters, tag)
    }

    const tagOf = (prefix: string, word: string): string =>
      `${prefix}${word.toLowerCase().replace(/\s+/g, '-')}`

    /**
     * SUBTYPES: two rules, and both have to hold.
     *
     * The ONE-OFF FLOOR is the same rule the keywords get, and it is the
     * owner's: a token that appears on a single card groups nothing with
     * anything, whichever family it is in. It is what removes the long tail of
     * planeswalker types printed once — which is the outcome an earlier draft
     * reached by refusing planeswalker subtypes as a class, and this reaches it
     * by a property of the corpus instead of a special case.
     *
     * INERTNESS is the older rule and is not replaced by it: a subtype nothing
     * in the corpus NAMES can appear in none of the three directions
     * `synergyMatches` scores, however many cards carry it. `t:` already
     * answers "is this an Elf" better than a tag would, so there is nothing to
     * keep it for. The run prints what each rule removes on its own, because a
     * rule that never fires is worth deleting rather than shipping.
     */
    const subtypeFloor = (word: string): boolean =>
      (producers.get(tagOf('subtype:', word)) ?? 0) >= 2
    const subtypeLive = (word: string): boolean => (wanters.get(tagOf('subtype:', word)) ?? 0) > 0
    const subtypes = candidate.subtypes.filter((w) => subtypeFloor(w) && subtypeLive(w)).sort()

    /**
     * KEYWORDS: everything except the one-offs, which is a WIDER rule than the
     * subtypes get and is a deliberate decision by the owner rather than a
     * measurement.
     *
     * Measured, only 25 of 813 keywords have any payoff card at all, so most of
     * these tags will never score: a tag with no wanter cannot appear in any
     * match direction, and that is worth saying out loud rather than implying
     * the whole list is live. They are here as VOCABULARY — `produces:ability:
     * cascade` is a question a builder asks whether or not a card pays it off,
     * and the tag is the only place the answer lives once a card is on screen.
     *
     * The one-offs go because they are not vocabulary either. Scryfall files
     * bespoke ability words under `keywords`, so 490 of the 813 are things like
     * "Allons-y!", "Bad Wolf" and "I. AM. TALKING!" — each on exactly one card,
     * each unable to group anything with anything.
     */
    const abilities = candidate.abilities
      .filter((word) => (producers.get(tagOf('ability:', word)) ?? 0) >= 2)
      .sort()

    /*
     * The subtypes that are PROPER NAMES, for the display side alone.
     *
     * A subtype that only ever appears on a Planeswalker type line is somebody's
     * name, and "Chandras" is not a word. This list exists so that the
     * pluralisation rule can say "not this one" without a hand-written table and
     * without a membership rule pretending to be a rendering rule.
     */
    const properNouns = subtypes.filter((word) => planeswalkerOnly.has(word))

    const data = {
      $comment:
        'GENERATED by apps/ingest/src/semantic-vocabulary.ts (ADR-0046). Do not edit by hand. ' +
        'A word is here because at least one commander-legal card produces the tag and at ' +
        'least one wants it; a tag with an empty side can appear in no match direction. ' +
        'Keywords are the wider rule: everything except the one-offs, because a keyword is ' +
        'vocabulary worth filtering on whether or not any card pays it off. ' +
        '`properNouns` is a DISPLAY fact, not a membership one: those words are names and ' +
        'are never pluralised.',
      generatedAt: new Date().toISOString().slice(0, 10),
      corpusRows: rows.length,
      subtypes,
      abilities,
      properNouns,
    }
    fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    console.error(
      `kept ${subtypes.length} subtypes and ${abilities.length} keywords ` +
        `(${subtypes.length + abilities.length} tags) -> ${out}`,
    )
    const floorOnly = candidate.subtypes.filter((w) => !subtypeFloor(w) && subtypeLive(w))
    const inertOnly = candidate.subtypes.filter((w) => subtypeFloor(w) && !subtypeLive(w))
    const both = candidate.subtypes.filter((w) => !subtypeFloor(w) && !subtypeLive(w))
    console.error(
      `  refused ${candidate.subtypes.length - subtypes.length} subtypes: ` +
        `${floorOnly.length} on the one-off floor alone, ${inertOnly.length} as inert alone, ` +
        `${both.length} on both`,
    )
    console.error(
      `  refused ${candidate.abilities.length - abilities.length} keywords as one-offs ` +
        '(on exactly one card, so they group nothing with anything)',
    )
    const withPayoff = abilities.filter((word) => (wanters.get(tagOf('ability:', word)) ?? 0) > 0)
    console.error(
      `  of the kept keywords, ${withPayoff.length} have a payoff card and can score; ` +
        `the other ${abilities.length - withPayoff.length} are vocabulary only`,
    )
    console.error(
      `  ${properNouns.length} kept subtypes are proper names and are never pluralised: ` +
        `${properNouns.join(', ')}`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
