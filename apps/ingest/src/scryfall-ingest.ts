import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  bulkDataEntry,
  isUniversesBeyondCard,
  skipReason,
  streamBulkCards,
  tallyPrinting,
  toCard,
  toPrinting,
  type ProvenanceTally,
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
 * ING-01 — Scryfall bulk ingest (doc 04 §4.1, ADR-0009, ADR-0011).
 *
 * Bulk, not crawl: "If you need to rapidly look up card names, prices, or
 * resolve a large number of card images, you must use the bulk data files."
 *
 * TWO passes over two exports, because they answer different questions:
 *
 *   1. `default_cards` — every printing. Gives real prices, rarity, set codes
 *      and the reserved-list flag, none of which exist at oracle level, and is
 *      the only way to decide Universes Beyond provenance (ADR-0011): the flag
 *      is per printing, and a card qualifies only if EVERY printing carries it.
 *   2. `oracle_cards` — one row per card. The oracle-level truth the domain
 *      models, written with the provenance pass 1 computed.
 */

export interface IngestReport {
  readonly snapshotId: string
  readonly read: number
  readonly cards: number
  readonly printings: number
  readonly printingsRead: number
  /** Cards where every printing is a Universes Beyond printing. */
  readonly universesBeyond: number
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
  /** Stop after N records per pass. For smoke-testing without the wait. */
  readonly limit?: number
  readonly onProgress?: (phase: 'printings' | 'cards', read: number) => void
}

export const ingestScryfall = async (
  pool: Pool,
  options: IngestOptions = {},
): Promise<IngestReport> => {
  const batchSize = options.batchSize ?? 1000
  const snapshotId = randomUUID()
  await createSnapshot(pool, snapshotId, 'scryfall')

  // ---- pass 1: every printing ----
  const printingsEntry = await bulkDataEntry('default_cards', options)
  const provenance = new Map<string, ProvenanceTally>()
  let printingsRead = 0
  let printingCount = 0
  let printings: Printing[] = []

  const flushPrintings = async (): Promise<void> => {
    if (printings.length > 0) {
      printingCount += await upsertPrintings(pool, printings)
      printings = []
    }
  }

  for await (const raw of streamBulkCards(printingsEntry, options)) {
    printingsRead += 1
    if (options.limit !== undefined && printingsRead > options.limit) break

    // Provenance is tallied over EVERY printing, including the non-playable
    // layouts — an art-series-only card is still Universes Beyond, and the
    // tally must not be skewed by what the card pass happens to reject.
    tallyPrinting(provenance, raw)

    if (skipReason(raw) !== null) continue
    const printing = toPrinting(raw)
    if (printing !== null) printings.push(printing)

    if (printings.length >= batchSize) {
      await flushPrintings()
      options.onProgress?.('printings', printingsRead)
    }
  }
  await flushPrintings()

  // ---- pass 2: one row per card ----
  const cardsEntry = await bulkDataEntry('oracle_cards', options)
  let read = 0
  let cardCount = 0
  let universesBeyond = 0
  let skippedNoOracleId = 0
  let skippedNonPlayable = 0
  const failed: { id: string; reason: string }[] = []
  let cards: Card[] = []

  const flushCards = async (): Promise<void> => {
    if (cards.length > 0) {
      cardCount += await upsertCards(pool, cards)
      cards = []
    }
  }

  for await (const raw of streamBulkCards(cardsEntry, options)) {
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

    const ub = isUniversesBeyondCard(provenance.get(raw.oracle_id ?? ''))

    let card: Card | null = null
    try {
      card = toCard(raw as ScryfallCard, { universesBeyond: ub })
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
    if (ub) universesBeyond += 1

    cards.push(card)
    if (cards.length >= batchSize) {
      await flushCards()
      options.onProgress?.('cards', read)
    }
  }
  await flushCards()

  await setSnapshotCounts(pool, snapshotId, { cards: cardCount, combos: 0 })
  // Promoted last. Until this line runs, readers still see the old corpus.
  await promoteSnapshot(pool, snapshotId, 'scryfall')

  return {
    snapshotId,
    read,
    cards: cardCount,
    printings: printingCount,
    printingsRead,
    universesBeyond,
    skippedNoOracleId,
    skippedNonPlayable,
    failed,
    sourceUpdatedAt: cardsEntry.updatedAt,
  }
}
