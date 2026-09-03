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
  /**
   * Pieces that are a CARD CLASS rather than a named card.
   *
   * Spellbook calls them templates and describes each with a Scryfall query —
   * "Mana Dork or Mana Dork Creator", "Creature with Persist". They are pieces
   * in every sense that matters: the combo does not work without one, and the
   * variant id counts them (`2105-3337--140` is two cards and template 140).
   *
   * There is no oracle id to map, so they cannot go in `pieces`. See
   * `variantSkipReason`.
   */
  readonly requires?: readonly { readonly template?: { readonly name?: string } }[]
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

export type VariantSkipReason = 'not-ok-status' | 'no-pieces' | 'template-piece'

/**
 * A template piece, as Spellbook writes one into a VARIANT ID.
 *
 * The id is `<card ids>--<template ids>`: `2105-3337--140` is two cards and
 * template 140, and the doubled hyphen is an EMPTY card segment — the source's
 * own statement that one piece of this combo is a card class rather than a
 * card. A card segment is a non-empty run of digits, so `--` cannot arise any
 * other way, and no variant id means anything else by it.
 *
 * Read as well as `requires[]` because the two are the same fact stated twice
 * and this repository has to be exact about the population even when the feed
 * is not (ADR-0049). See the id-shape case in `variantSkipReason` below.
 *
 * ONE `-` would match every ordinary variant id in the feed. The doubling is
 * the whole rule.
 */
export const TEMPLATE_SEGMENT = /--/

/** The card CLASSES a variant needs, by Spellbook's name for each. */
export const templatesOf = (variant: SpellbookVariant): readonly string[] =>
  (variant.requires ?? []).map((r) => r.template?.name ?? 'unnamed template')

/**
 * Why a variant is not a combo worth storing, or null if it is one.
 *
 * Only `OK` variants are ingested. Spellbook also publishes drafts and variants
 * flagged for review; treating those as facts would put combos in front of users
 * that their own editors have not accepted.
 *
 * `template-piece` is the third reason, and it is a reported bug (ADR-0038).
 * A user asked why Ashnod's Altar claimed to combo with Moritte of the Frost.
 * Spellbook variant `2034-3388--5` is Moritte + Ashnod's Altar + TEMPLATE 5, "a
 * creature with persist" — Moritte has to copy one before the loop exists. This
 * adapter read `uses[]` and never `requires[]`, so the combo was stored two
 * pieces long, and a deck holding both was told it had assembled it.
 *
 * 4,813 of the 108,046 stored combos (4.5%) lost at least one piece this way,
 * and 1,192 of those became TWO-CARD INFINITES — the exact shape brackets 1–3
 * restrict (doc 03 §3.2), so the damage is not cosmetic.
 *
 * Skipped rather than stored short, for the reason the ingest already gives
 * about a combo naming a card the corpus does not have (doc 04 §4.2, AGENTS.md
 * §8): "storing a combo whose pieces are half-missing produces a combo that can
 * never be completed and silently wrong combo degrees". A template piece is the
 * same wound one layer up — the piece is missing from the SOURCE, not from our
 * corpus — and the skip is counted and printed, never quiet.
 *
 * The richer fix was considered and is NOT this change: carry the template
 * COUNT on `Combo` so these become "one piece away, and the piece is a card
 * class" instead of vanishing. That is strictly better product behaviour and it
 * needs a new column, a migration and an ingest write, which is a task of its
 * own. Skipping is the correct answer until then, because it is the only one of
 * the two that can be wrong in the safe direction.
 */
export const variantSkipReason = (variant: SpellbookVariant): VariantSkipReason | null => {
  if ((variant.status ?? 'OK') !== 'OK') return 'not-ok-status'
  const pieces = (variant.uses ?? []).filter((u) => u.card?.oracleId !== undefined)
  if (pieces.length === 0) return 'no-pieces'
  // After `no-pieces`, so a variant with neither cards nor a mappable template
  // still reports the stronger fact about itself.
  if ((variant.requires ?? []).length > 0) return 'template-piece'
  /*
   * The id says there is a template even if `requires[]` does not (ADR-0049).
   *
   * Same reason, second reading, and it is what makes the `--` prune exact
   * rather than lucky. The prune deletes every stored row whose id holds a
   * `--`, on the strength of this function never letting one be written — and
   * with only the `requires[]` check above, "never" rested on the FEED always
   * populating `requires[]` for a `--` id. That is a promise nothing here can
   * hold Spellbook to, and the cost of it breaking is a real combo silently
   * deleted on every run. Reading the id closes it: the population this refuses
   * and the population the prune removes are now the same set by construction.
   *
   * It is also the better answer on its own. An id that names a template and a
   * body that does not is a variant we cannot represent either way, and the
   * ruling above already covers it — skip and report, rather than store short,
   * because that is the one of the two that is wrong in the safe direction.
   *
   * WHAT THIS DOES NOT PROMISE, said plainly so nobody reads more into it. It
   * makes the refusal and the prune agree with each other; it does not make
   * either of them right about Spellbook. If the source ever gave `--` a second
   * meaning, both halves would be self-consistently wrong together and no test
   * here could tell — an id format is an external fact and the only way to
   * check it is to look at the feed. That is a re-measurement job, not
   * something a guard can hold, and it is recorded in ADR-0049 as such.
   */
  if (TEMPLATE_SEGMENT.test(variant.id)) return 'template-piece'
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
