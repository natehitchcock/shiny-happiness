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

    // Every subtype word that exists, minus the categorical refusals. The
    // planeswalker types go as a class: they are proper names rather than
    // tribes, and a "Chandra deck" is a superfriends deck the model has nothing
    // to say about.
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
          !CARD_TYPES.has(word) && !ALREADY_AN_EVENT.has(word) && !planeswalkerOnly.has(word),
      ),
      abilities: [...everyKeyword].filter((word) => !REFUSED_KEYWORDS.has(word)),
    }
    console.error(
      `candidates: ${candidate.subtypes.length} subtypes, ${candidate.abilities.length} keywords ` +
        `(refused ${CARD_TYPES.size} card types, ${planeswalkerOnly.size} planeswalker types)`,
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

    const live = (prefix: string, word: string): boolean => {
      const tag = `${prefix}${word.toLowerCase().replace(/\s+/g, '-')}`
      return (producers.get(tag) ?? 0) > 0 && (wanters.get(tag) ?? 0) > 0
    }
    const subtypes = candidate.subtypes.filter((word) => live('subtype:', word)).sort()
    const abilities = candidate.abilities.filter((word) => live('ability:', word)).sort()

    const data = {
      $comment:
        'GENERATED by apps/ingest/src/semantic-vocabulary.ts (ADR-0046). Do not edit by hand. ' +
        'A word is here because at least one commander-legal card produces the tag and at ' +
        'least one wants it; a tag with an empty side can appear in no match direction.',
      generatedAt: new Date().toISOString().slice(0, 10),
      corpusRows: rows.length,
      subtypes,
      abilities,
    }
    fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    console.error(
      `kept ${subtypes.length} subtypes and ${abilities.length} keywords ` +
        `(${subtypes.length + abilities.length} tags) -> ${out}`,
    )
    const refusedSubtypes = candidate.subtypes.filter((word) => !live('subtype:', word))
    console.error(`  refused ${refusedSubtypes.length} subtypes as inert`)
    console.error(
      `  refused ${candidate.abilities.length - abilities.length} keywords as having no payoff`,
    )
    console.error(`  kept keywords: ${abilities.join(', ')}`)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
