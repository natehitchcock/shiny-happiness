import type { Pool } from 'pg'
import {
  piecesOf,
  streamVariants,
  templatesOf,
  toCombo,
  variantSkipReason,
  type SpellbookOptions,
} from '@roundtable/clients'
import { insertCombos } from '@roundtable/db'
import type { Combo } from '@roundtable/domain'

/**
 * ING-02 — Commander Spellbook combo ingest (doc 04 §4.2, ADR-0010).
 *
 * Pieces map on Scryfall's `oracleId`, which both sides carry, so there is no
 * name matching anywhere in this path.
 */

export interface ComboIngestReport {
  readonly read: number
  readonly combos: number
  readonly skippedNotOk: number
  readonly skippedNoPieces: number
  /**
   * Combos naming a card this corpus does not have.
   *
   * Reported and NOT stored. Doc 04 §4.2 and AGENTS.md §8 both single this out:
   * storing a combo whose pieces are half-missing produces a combo that can
   * never be completed and silently wrong combo degrees. Usually it means the
   * Scryfall ingest is older than the Spellbook one.
   */
  readonly unmapped: readonly { readonly comboId: string; readonly missing: readonly string[] }[]
  /**
   * Combos one of whose pieces Spellbook describes as a card CLASS.
   *
   * Reported and NOT stored, for the same reason as `unmapped` directly above —
   * see `variantSkipReason` in the client for the measurement and ADR-0038 for
   * the report that found it. Kept separate from `skippedNotOk` and
   * `skippedNoPieces` because this one is a loss the operator should see the
   * size of: it is 4.5% of the source.
   */
  readonly templateRequired: readonly {
    readonly comboId: string
    readonly templates: readonly string[]
  }[]
}

export interface ComboIngestOptions extends SpellbookOptions {
  readonly batchSize?: number
  readonly limit?: number
  readonly onProgress?: (read: number) => void
}

/** Oracle ids currently in the corpus, for the unmapped check. */
const knownOracleIds = async (pool: Pool): Promise<Set<string>> => {
  const { rows } = await pool.query<{ oracle_id: string }>('SELECT oracle_id FROM cards')
  return new Set(rows.map((r) => r.oracle_id))
}

export const ingestSpellbook = async (
  pool: Pool,
  options: ComboIngestOptions = {},
): Promise<ComboIngestReport> => {
  const batchSize = options.batchSize ?? 500
  const known = await knownOracleIds(pool)
  if (known.size === 0) {
    throw new Error('No cards in the corpus — run the Scryfall ingest (ING-01) first')
  }

  let read = 0
  let combos = 0
  let skippedNotOk = 0
  let skippedNoPieces = 0
  const unmapped: { comboId: string; missing: string[] }[] = []
  const templateRequired: { comboId: string; templates: readonly string[] }[] = []

  let batch: Combo[] = []
  const flush = async (): Promise<void> => {
    if (batch.length > 0) {
      combos += await insertCombos(pool, batch)
      batch = []
    }
  }

  for await (const variant of streamVariants(options)) {
    read += 1
    if (options.limit !== undefined && read > options.limit) break

    const skip = variantSkipReason(variant)
    if (skip === 'not-ok-status') {
      skippedNotOk += 1
      continue
    }
    if (skip === 'no-pieces') {
      skippedNoPieces += 1
      continue
    }
    if (skip === 'template-piece') {
      templateRequired.push({ comboId: variant.id, templates: templatesOf(variant) })
      continue
    }

    const missing = [...new Set(piecesOf(variant))].filter((id) => !known.has(id))
    if (missing.length > 0) {
      unmapped.push({ comboId: variant.id, missing })
      continue
    }

    const combo = toCombo(variant)
    if (combo === null) {
      skippedNoPieces += 1
      continue
    }

    batch.push(combo)
    if (batch.length >= batchSize) {
      await flush()
      options.onProgress?.(read)
    }
  }
  await flush()

  return { read, combos, skippedNotOk, skippedNoPieces, unmapped, templateRequired }
}
