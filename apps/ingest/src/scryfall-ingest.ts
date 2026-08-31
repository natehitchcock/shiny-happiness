import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  COMMANDER_QUERY,
  bulkDataEntry,
  fetchCommanderOracleIds,
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
 *
 * Pass 1 READS in order but WRITES last. `printings.oracle_id` references
 * `cards`, so a printing cannot be inserted before the card it belongs to
 * exists. Writing them as they streamed worked on every database that already
 * had a corpus and failed on every empty one — which is to say, it worked
 * everywhere except the case that matters, and was found by pointing this at a
 * fresh Neon database rather than by any test.
 *
 * The printings are therefore held in memory until the cards are in. That is
 * ~110k rows and tens of megabytes for a command that runs at deploy time, and
 * the alternative — streaming `default_cards` a second time — would mean
 * downloading a 200 MB file twice from a service whose terms ask us to use the
 * bulk export precisely so we do not hammer it (ADR-0009).
 */

/**
 * Which source decided commander eligibility, and what it said.
 *
 * Recorded rather than inferred. Both sources write the same boolean into the
 * same column, so nothing downstream can tell a fetched answer from a derived
 * one — and the difference is 36 cards, including every legendary
 * Vehicle. An operator reading the ingest output needs to know which run they
 * are looking at before they trust a Shorikai deck being refused.
 *
 * Reported per RUN and not per card on purpose: when the fetch succeeds it
 * decides every card in the corpus, and when it fails it decides none. There
 * is no mixed state to record, so a column repeating one value 34,492 times
 * would cost a migration to say what one line here already says.
 */
export interface CommanderEligibilityReport {
  readonly source: 'scryfall-search' | 'derived-from-oracle-text'
  /** How many cards Scryfall listed as commanders. Null when it was not asked. */
  readonly fetched: number | null
  /** Why the fetch was not used, when it was not. */
  readonly reason: string | null
}

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
  readonly commanderEligibility: CommanderEligibilityReport
}

export interface IngestOptions extends ScryfallOptions {
  readonly batchSize?: number
  /** Stop after N records per pass. For smoke-testing without the wait. */
  readonly limit?: number
  readonly onProgress?: (phase: 'printings' | 'cards', read: number) => void
}

/**
 * A tripwire, not a threshold anyone tunes.
 *
 * `is:commander legal:commander` returns 3,411 today. If a future Scryfall
 * changes what the predicate means, the search would still answer 200 with a
 * complete, small, and wrong set — and a complete set is exactly what the
 * pagination guard cannot catch, because nothing about it looks truncated.
 * Writing it would mark thousands of real commanders ineligible and break deck
 * creation for everyone.
 *
 * So a result this far below what the query has ever returned is treated as the
 * query having stopped meaning what we think, and the ingest falls back to the
 * derivation and says so. Deliberately an order of magnitude below 3,411 rather
 * than just under it: this must never fire on Scryfall printing a normal set.
 */
const IMPLAUSIBLY_FEW_COMMANDERS = 1_000

/**
 * Scryfall's commander list, or nothing and the reason why.
 *
 * Never throws. A corpus ingest that aborted because one auxiliary query failed
 * would leave the database with no cards at all, which is far worse than a
 * corpus whose eligibility came from the fallback: the fallback is right about
 * 3,380 of 3,411 cards, and the alternative is right about none of them.
 *
 * Exported for its own tests. Which source wins is the one decision in this
 * file that has three outcomes and no database, and reaching it through
 * `ingestScryfall` would mean downloading 200 MB of bulk data to check a
 * branch.
 */
export const loadCommanderSet = async (
  options: IngestOptions,
): Promise<{
  readonly ids: ReadonlySet<string> | null
  readonly report: CommanderEligibilityReport
}> => {
  try {
    const set = await fetchCommanderOracleIds(options)
    if (set.oracleIds.size < IMPLAUSIBLY_FEW_COMMANDERS) {
      return {
        ids: null,
        report: {
          source: 'derived-from-oracle-text',
          fetched: set.oracleIds.size,
          reason:
            `Scryfall returned only ${set.oracleIds.size} commanders across ${set.pages} ` +
            `page(s), far below what "${COMMANDER_QUERY}" has ever matched; ` +
            'treating the query as no longer meaning what we think',
        },
      }
    }
    return {
      ids: set.oracleIds,
      report: { source: 'scryfall-search', fetched: set.oracleIds.size, reason: null },
    }
  } catch (error) {
    return {
      ids: null,
      report: {
        source: 'derived-from-oracle-text',
        fetched: null,
        reason: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export const ingestScryfall = async (
  pool: Pool,
  options: IngestOptions = {},
): Promise<IngestReport> => {
  const batchSize = options.batchSize ?? 1000
  const snapshotId = randomUUID()
  await createSnapshot(pool, snapshotId, 'scryfall')

  /*
   * Asked for FIRST, before either bulk file is touched.
   *
   * Twenty paced requests take ten seconds, and doing them up front means a
   * search outage is known before ~200 MB has been downloaded rather than
   * after. It also keeps the decision in one place: by the time any card is
   * mapped, which source is answering has already been settled for all of them.
   */
  const commanders = await loadCommanderSet(options)

  // ---- pass 1: every printing ----
  const printingsEntry = await bulkDataEntry('default_cards', options)
  const provenance = new Map<string, ProvenanceTally>()
  let printingsRead = 0
  let printingCount = 0
  let printings: Printing[] = []

  /**
   * Every printing, held until the cards exist. See the note above the passes.
   *
   * `printings` stays the batch buffer so the shape below is unchanged; it
   * drains into this instead of into the database.
   */
  const pending: Printing[] = []
  const holdPrintings = (): void => {
    if (printings.length > 0) {
      pending.push(...printings)
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
      holdPrintings()
      options.onProgress?.('printings', printingsRead)
    }
  }
  holdPrintings()

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
      card = toCard(raw as ScryfallCard, {
        universesBeyond: ub,
        // Spread, not `canBeCommander: undefined`: under
        // `exactOptionalPropertyTypes` an absent key and an explicit undefined
        // are different types, and "the search did not answer" is absence —
        // which is what makes `toCard` fall back to the derivation.
        ...(commanders.ids === null
          ? {}
          : { canBeCommander: commanders.ids.has(raw.oracle_id ?? '') }),
      })
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

  // ---- pass 3: the printings, now that their cards exist ----
  for (let i = 0; i < pending.length; i += batchSize) {
    printingCount += await upsertPrintings(pool, pending.slice(i, i + batchSize))
    options.onProgress?.('printings', i)
  }

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
    commanderEligibility: commanders.report,
  }
}
