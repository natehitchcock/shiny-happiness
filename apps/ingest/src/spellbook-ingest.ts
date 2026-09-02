import type { Pool } from 'pg'
import {
  piecesOf,
  streamVariants,
  templatesOf,
  toCombo,
  variantSkipReason,
  type SpellbookOptions,
} from '@roundtable/clients'
import { deleteCombos, insertCombos } from '@roundtable/db'
import { comboId } from '@roundtable/domain'
import type { Combo, ComboId } from '@roundtable/domain'

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
  /**
   * Rows an EARLIER run wrote that this one has decided against (ADR-0038).
   *
   * `insertCombos` is an upsert and was the only write this table had, so
   * deciding not to store a variant did nothing to the row a previous ingest
   * had already written for it. Refusing `2034-3388--5` therefore changed
   * nothing a user could see: the reported Moritte + Ashnod's Altar combo was
   * still sitting in the table, and the two-piece population brackets 1-3 read
   * was byte-for-byte identical across the run — 5,184 before, 5,184 after.
   *
   * Only ids this run actually READ and positively rejected are removed, never
   * "everything the run did not write". See `deleteCombos`.
   */
  readonly removed: number
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
  /*
   * Variants this run read and positively rejected, for the delete below.
   *
   * `not-ok-status` and `template-piece` only. Both are facts about the SOURCE
   * — Spellbook's own editors withdrew the variant, or it names a piece as a
   * card class we cannot store — so a row written for one is wrong to keep no
   * matter what our corpus looks like.
   *
   * `unmapped` is deliberately NOT here, and that is the line worth holding: it
   * is a fact about OUR corpus being behind Spellbook's, not about the variant.
   * Pruning on it would delete real combos every time the card ingest is older
   * than the combo ingest, and put them back on the next run — churning the
   * table on our own staleness. `no-pieces` is left out for the same reason it
   * is not `template-piece`: a variant with no cards at all never produced a
   * row to remove.
   */
  const rejectedIds: ComboId[] = []

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
      rejectedIds.push(comboId(variant.id))
      continue
    }
    if (skip === 'no-pieces') {
      skippedNoPieces += 1
      continue
    }
    if (skip === 'template-piece') {
      templateRequired.push({ comboId: variant.id, templates: templatesOf(variant) })
      rejectedIds.push(comboId(variant.id))
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

  // After the writes, so a run that dies partway leaves the table larger than it
  // should be rather than smaller. An extra combo is a wrong answer; a missing
  // one is a wrong answer AND a lost fact.
  const removed = await deleteCombos(pool, rejectedIds)

  return { read, combos, skippedNotOk, skippedNoPieces, unmapped, templateRequired, removed }
}
