import type { Combo, ComboResult, Color, OracleId } from '@roundtable/domain'
import { comboId, oracleId } from '@roundtable/domain'
import { streamJsonArray } from './json-array-stream.js'
import { textStreamOf } from './http.js'

/**
 * Commander Spellbook adapter (doc 04 §4.2, ADR-0010).
 *
 * Bulk file rather than the paginated API: one request per ingest instead of
 * hundreds, and no published rate limit to guess at.
 */

const BULK_URL = 'https://json.commanderspellbook.com/variants.json.gz'

export interface SpellbookOptions {
  readonly userAgent?: string
  readonly fetchImpl?: typeof fetch
  readonly bulkUrl?: string
}

export interface SpellbookVariant {
  readonly id: string
  readonly status?: string
  readonly identity?: string
  readonly uses?: { readonly card?: { readonly oracleId?: string; readonly name?: string } }[]
  readonly produces?: { readonly feature?: { readonly name?: string } }[]
  readonly easyPrerequisites?: string
  readonly notablePrerequisites?: string
  readonly description?: string
}

/**
 * Feature name to the domain's `ComboResult`.
 *
 * Spellbook's feature vocabulary is open-ended and grows; the domain's is a
 * closed union because bracket assessment depends on knowing whether a combo is
 * infinite (doc 03 §3.2). Matching is on substrings of the lowercased name so a
 * new "Infinite red mana" maps without a code change.
 */
const RESULT_PATTERNS: readonly (readonly [RegExp, ComboResult])[] = [
  // "Each opponent loses the game" is a win condition stated from the other
  // side; it must not fall through to `value`.
  [/\bwins? the game\b|\bloses? the game\b|\blose the game\b/i, 'win-the-game'],
  [/infinite.*\bturns?\b/i, 'infinite-turns'],
  // Brackets restrict extra-turn chaining (doc 03 §3.2) and infinite combats is
  // the same kind of thing; `value` would understate it. Closest the union has.
  [/infinite.*\bcombats?\b|infinite.*\bcombat phases\b/i, 'infinite-turns'],
  [/infinite.*\bmana\b/i, 'infinite-mana'],
  [/infinite.*\bdamage\b/i, 'infinite-damage'],
  [/infinite.*\btokens?\b/i, 'infinite-tokens'],
  [/infinite.*\bcreatures?\b/i, 'infinite-creatures'],
  [/infinite.*\bdraw\b|infinite.*\bcards?\b/i, 'infinite-draw'],
  [/infinite.*\bmill\b/i, 'infinite-mill'],
  [/infinite.*\blifeloss\b|infinite.*\blife loss\b/i, 'infinite-lifeloss'],
  [/infinite.*\blife\b/i, 'infinite-life'],
  [/\block\b|\bcannot\b|\bcan't\b/i, 'lock'],
]

export const toComboResult = (featureName: string): ComboResult => {
  for (const [pattern, result] of RESULT_PATTERNS) {
    if (pattern.test(featureName)) return result
  }
  // The catch-all in the domain's union. Not a silent drop: the combo is still
  // stored and still counted, it just is not treated as infinite.
  return 'value'
}

const COLORS = new Set(['W', 'U', 'B', 'R', 'G'])

/** Spellbook writes colourless identity as "C"; the domain writes it as empty. */
export const parseIdentity = (identity: string | undefined): readonly Color[] =>
  (identity ?? '')
    .toUpperCase()
    .split('')
    .filter((c): c is Color => COLORS.has(c))

export type VariantSkipReason = 'not-ok-status' | 'no-pieces'

/**
 * Why a variant is not a combo worth storing, or null if it is one.
 *
 * Only `OK` variants are ingested. Spellbook also publishes drafts and variants
 * flagged for review; treating those as facts would put combos in front of users
 * that their own editors have not accepted.
 */
export const variantSkipReason = (variant: SpellbookVariant): VariantSkipReason | null => {
  if ((variant.status ?? 'OK') !== 'OK') return 'not-ok-status'
  const pieces = (variant.uses ?? []).filter((u) => u.card?.oracleId !== undefined)
  if (pieces.length === 0) return 'no-pieces'
  return null
}

/**
 * Map a variant to the domain's `Combo`.
 *
 * Pieces come from `uses[].card.oracleId`, which is Scryfall's oracle id — the
 * same key the card corpus uses. No name matching is involved, which is the risk
 * ADR-0006 raised and ADR-0010 retired.
 */
export const toCombo = (variant: SpellbookVariant): Combo | null => {
  if (variantSkipReason(variant) !== null) return null

  const pieces: OracleId[] = []
  for (const use of variant.uses ?? []) {
    const id = use.card?.oracleId
    if (id !== undefined && !pieces.includes(oracleId(id))) pieces.push(oracleId(id))
  }
  if (pieces.length === 0) return null

  const prerequisites = [variant.easyPrerequisites ?? '', variant.notablePrerequisites ?? '']
    .filter((p) => p.trim() !== '')
    .join('\n')

  const produces = [
    ...new Set(
      (variant.produces ?? [])
        .map((p) => p.feature?.name)
        .filter((n): n is string => n !== undefined)
        .map(toComboResult),
    ),
  ]

  return {
    id: comboId(variant.id),
    pieces,
    prerequisites,
    steps: (variant.description ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    produces,
    colorIdentity: parseIdentity(variant.identity),
  }
}

/** The oracle ids a variant needs, for the unmapped-card check (doc 04 §4.2). */
export const piecesOf = (variant: SpellbookVariant): readonly string[] =>
  (variant.uses ?? []).map((u) => u.card?.oracleId).filter((id): id is string => id !== undefined)

/** Stream every variant from the compressed bulk file. */
export async function* streamVariants(
  options: SpellbookOptions = {},
): AsyncGenerator<SpellbookVariant> {
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(options.bulkUrl ?? BULK_URL, {
    headers: {
      'User-Agent': options.userAgent ?? 'Roundtable/0.1',
      Accept: 'application/json',
    },
  })
  if (!response.ok || response.body === null) {
    throw new Error(`Spellbook bulk download responded ${response.status}`)
  }

  yield* streamJsonArray<SpellbookVariant>(textStreamOf(response), 'variants')
}
