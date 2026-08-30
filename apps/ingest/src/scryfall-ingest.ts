import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  bulkDataEntry,
  streamBulkCards,
  toCard,
  toPrinting,
  skipReason,
  type ScryfallCard,
  type ScryfallOptions,
} from '@roundtable/clients'
import {
  createSnapshot,
  promoteSnapshot,
  setSnapshotCounts,
  upsertCards,
  upsertPrintings,
} from '@roundtable/db'
import type { Card, Printing } from '@roundtable/domain'

/**
 * ING-01 — Scryfall bulk ingest (doc 04 §4.1, ADR-0009).
 *
 * Bulk, not crawl: "If you need to rapidly look up card names, prices, or
 * resolve a large number of card images, you must use the bulk data files."
 */

export interface IngestReport {
  readonly snapshotId: string
  readonly read: number
  readonly cards: number
  readonly printings: number
  /** Records with no `oracle_id` at all. */
  readonly skippedNoOracleId: number
  /** Art series, tokens, emblems, stickers, conspiracies — not deck cards. */
  readonly skippedNonPlayable: number
  /** Records that threw while mapping. Reported, never silently dropped. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[]
  readonly sourceUpdatedAt: string
}

export interface IngestOptions extends ScryfallOptions {
  readonly batchSize?: number
  readonly bulkType?: string
  /** Stop after N records. For smoke-testing a real ingest without the wait. */
  readonly limit?: number
  readonly onProgress?: (read: number) => void
}

/**
 * Run an ingest.
 *
 * Writes into the corpus and only then promotes the snapshot (doc 04 §4.7). A
 * run that dies half way therefore leaves the previous snapshot live rather than
 * the app serving a partially-written table.
 *
 * Idempotent: every write is an upsert keyed by `oracle_id` / `printing_id`, so
 * re-running produces the same rows.
 */
export const ingestScryfall = async (
  pool: Pool,
  options: IngestOptions = {},
): Promise<IngestReport> => {
  const batchSize = options.batchSize ?? 1000
  const entry = await bulkDataEntry(options.bulkType ?? 'oracle_cards', options)

  const snapshotId = randomUUID()
  await createSnapshot(pool, snapshotId, 'scryfall')

  let read = 0
  let cardCount = 0
  let printingCount = 0
  let skippedNoOracleId = 0
  let skippedNonPlayable = 0
  const failed: { id: string; reason: string }[] = []

  let cards: Card[] = []
  let printings: Printing[] = []

  const flush = async (): Promise<void> => {
    if (cards.length > 0) {
      cardCount += await upsertCards(pool, cards)
      printingCount += await upsertPrintings(pool, printings)
      cards = []
      printings = []
    }
  }

  for await (const raw of streamBulkCards(entry, options)) {
    read += 1
    if (options.limit !== undefined && read > options.limit) break

    const skip = skipReason(raw)
    if (skip === 'no-oracle-id') {
      skippedNoOracleId += 1
      continue
    }
    if (skip === 'non-playable-layout' || skip === 'no-card-type') {
      skippedNonPlayable += 1
      continue
    }

    let card: Card | null = null
    try {
      card = toCard(raw as ScryfallCard)
    } catch (error) {
      // A record that will not map is reported with its id. Silently dropping
      // ingest data is a rejected PR (AGENTS.md §8).
      failed.push({ id: raw.id, reason: error instanceof Error ? error.message : String(error) })
      continue
    }

    if (card === null) {
      failed.push({ id: raw.id, reason: 'mapped to null unexpectedly' })
      continue
    }

    cards.push(card)
    const printing = toPrinting(raw)
    if (printing !== null) printings.push(printing)

    if (cards.length >= batchSize) {
      await flush()
      options.onProgress?.(read)
    }
  }
  await flush()

  await setSnapshotCounts(pool, snapshotId, { cards: cardCount, combos: 0 })
  // Promoted last. Until this line runs, readers still see the old corpus.
  await promoteSnapshot(pool, snapshotId, 'scryfall')

  return {
    snapshotId,
    read,
    cards: cardCount,
    printings: printingCount,
    skippedNoOracleId,
    skippedNonPlayable,
    failed,
    sourceUpdatedAt: entry.updatedAt,
  }
}
