import type {
  ArchetypeKey,
  Bracket,
  Color,
  Deck,
  DeckEntry,
  DeckId,
  OracleId,
  Origin,
  Role,
  Zone,
} from '@roundtable/domain'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../client.js'

interface DeckRow {
  readonly id: string
  readonly name: string
  readonly commanders: string[]
  readonly target_bracket: number
  readonly archetype: string
  readonly archetype_secondary: string | null
  readonly color_identity: string[]
  readonly budget_max_total: string | null
  readonly budget_max_card: string | null
  readonly status: string
  readonly exclude_universes_beyond: boolean
  readonly version: number
  readonly created_at: Date
  readonly updated_at: Date
  readonly last_opened_at: Date
}

interface EntryRow {
  readonly oracle_id: string
  readonly zone: string
  readonly origin: string
  readonly locked: boolean
  readonly role_override: string[] | null
  readonly tags: string[]
  readonly added_at: Date
}

const toEntry = (row: EntryRow): DeckEntry => ({
  oracleId: row.oracle_id as OracleId,
  zone: row.zone as Zone,
  origin: row.origin as Origin,
  locked: row.locked,
  roleOverride: row.role_override === null ? null : (row.role_override as Role[]),
  tags: row.tags,
  addedAt: row.added_at.toISOString(),
})

const toDeck = (row: DeckRow, entries: readonly DeckEntry[]): Deck => ({
  id: row.id as DeckId,
  name: row.name,
  commanders: row.commanders as OracleId[],
  targetBracket: row.target_bracket as Bracket,
  archetype: row.archetype as ArchetypeKey,
  archetypeSecondary: row.archetype_secondary as ArchetypeKey | null,
  colorIdentity: row.color_identity as Color[],
  entries,
  budget:
    row.budget_max_total === null && row.budget_max_card === null
      ? null
      : {
          maxTotalUsd: row.budget_max_total === null ? null : Number(row.budget_max_total),
          maxCardUsd: row.budget_max_card === null ? null : Number(row.budget_max_card),
        },
  excludeUniversesBeyond: row.exclude_universes_beyond,
  status: row.status as Deck['status'],
  version: row.version,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastOpenedAt: row.last_opened_at.toISOString(),
})

/**
 * Read a deck.
 *
 * Both queries run in ONE transaction. Read separately, `version` can be fetched
 * before a concurrent batch commits and `entries` after it, producing a deck
 * whose version does not describe its own contents — and version is exactly what
 * the client sends back for optimistic concurrency.
 */
export const getDeck = async (pool: Pool, id: DeckId): Promise<Deck | null> =>
  withTransaction(pool, async (client) => {
    const { rows } = await client.query<DeckRow>(
      'SELECT * FROM decks WHERE id = $1 AND deleted_at IS NULL',
      [id],
    )
    const row = rows[0]
    if (row === undefined) return null
    const { rows: entryRows } = await client.query<EntryRow>(
      'SELECT * FROM deck_entries WHERE deck_id = $1 ORDER BY id',
      [id],
    )
    return toDeck(row, entryRows.map(toEntry))
  })

export interface CreateDeckInput {
  readonly id: DeckId
  readonly ownerId: string
  readonly name: string
  readonly commanders: readonly OracleId[]
  readonly targetBracket: Bracket
  readonly archetype: ArchetypeKey
  readonly archetypeSecondary?: ArchetypeKey | null
  readonly colorIdentity: readonly Color[]
  readonly excludeUniversesBeyond?: boolean
}

export const createDeck = async (pool: Pool, input: CreateDeckInput): Promise<Deck> => {
  const { rows } = await pool.query<DeckRow>(
    `INSERT INTO decks (id, owner_id, name, commanders, target_bracket, archetype,
                        archetype_secondary, color_identity, exclude_universes_beyond)
     VALUES ($1, $2, $3, $4::uuid[], $5, $6, $7, $8::char(1)[], $9) RETURNING *`,
    [
      input.id,
      input.ownerId,
      input.name,
      input.commanders,
      input.targetBracket,
      input.archetype,
      input.archetypeSecondary ?? null,
      input.colorIdentity,
      input.excludeUniversesBeyond ?? false,
    ],
  )
  return toDeck(rows[0]!, [])
}

/**
 * Write one entry, enforcing "a card is in exactly one state" (doc 02 §2.2).
 *
 * Both directions clear the card's conflicting rows first: excluding an accepted
 * card removes it from the deck, and accepting a previously excluded card clears
 * the exclusion. Without the second, a card sits in `acceptedSet` and
 * `excludedSet` at once and every consumer disagrees about which it is.
 *
 * Takes a transaction client, not a pool. The delete and the insert are one
 * state change; a failure between them would leave the card absent — and for an
 * exclusion, absent means suggestable again, which breaks pillar P6.
 */
export const setEntry = async (
  client: PoolClient,
  deckId: DeckId,
  entry: Pick<DeckEntry, 'oracleId' | 'zone' | 'origin' | 'locked' | 'tags'>,
): Promise<void> => {
  if (entry.zone === 'excluded') {
    await client.query('DELETE FROM deck_entries WHERE deck_id = $1 AND oracle_id = $2', [
      deckId,
      entry.oracleId,
    ])
  } else {
    // Clear only an exclusion. Accepted duplicates — 34 Mountains — are
    // legitimate and must survive.
    await client.query(
      "DELETE FROM deck_entries WHERE deck_id = $1 AND oracle_id = $2 AND zone = 'excluded'",
      [deckId, entry.oracleId],
    )
  }
  await client.query(
    `INSERT INTO deck_entries (deck_id, oracle_id, zone, origin, locked, tags)
     VALUES ($1, $2, $3, $4, $5, $6::text[])`,
    [deckId, entry.oracleId, entry.zone, entry.origin, entry.locked, entry.tags],
  )
}

/** Single-entry write outside an existing batch, wrapped in its own transaction. */
export const setEntryStandalone = async (
  pool: Pool,
  deckId: DeckId,
  entry: Pick<DeckEntry, 'oracleId' | 'zone' | 'origin' | 'locked' | 'tags'>,
): Promise<void> => {
  await withTransaction(pool, (client) => setEntry(client, deckId, entry))
}

/**
 * Remove ONE accepted copy, not every copy.
 *
 * A deck holds 34 Mountains as 34 rows, so removing "a Mountain" must remove one
 * of them. An unqualified DELETE would take all 34.
 */
export const removeEntry = async (
  client: Pool | PoolClient,
  deckId: DeckId,
  oracleId: OracleId,
): Promise<number> => {
  const { rowCount } = await client.query(
    `DELETE FROM deck_entries WHERE id = (
       SELECT id FROM deck_entries
        WHERE deck_id = $1 AND oracle_id = $2 AND zone = 'accepted'
        ORDER BY id LIMIT 1)`,
    [deckId, oracleId],
  )
  return rowCount ?? 0
}

/** Remove every accepted copy — for a bulk operation that means to. */
export const removeAllCopies = async (
  client: Pool | PoolClient,
  deckId: DeckId,
  oracleId: OracleId,
): Promise<number> => {
  const { rowCount } = await client.query(
    "DELETE FROM deck_entries WHERE deck_id = $1 AND oracle_id = $2 AND zone = 'accepted'",
    [deckId, oracleId],
  )
  return rowCount ?? 0
}

/**
 * Apply a batch under optimistic concurrency (doc 12 §12.7).
 *
 * The outcome is a discriminated union rather than a nullable: the API answers
 * 404 for a deck that does not exist and 409 for one whose version moved, and a
 * shared `null` would make those indistinguishable at the call site.
 *
 * The version check and the writes share one transaction with `FOR UPDATE`, or
 * two clients could both read version 4 and both write version 5.
 */
export type BatchOutcome<T> =
  | { readonly kind: 'applied'; readonly result: T; readonly version: number }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'stale'; readonly currentVersion: number }

export const applyBatch = async <T>(
  pool: Pool,
  deckId: DeckId,
  baseVersion: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<BatchOutcome<T>> =>
  withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ version: number }>(
      'SELECT version FROM decks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [deckId],
    )
    const current = rows[0]
    if (current === undefined) return { kind: 'not-found' as const }
    if (current.version !== baseVersion) {
      return { kind: 'stale' as const, currentVersion: current.version }
    }

    const result = await fn(client)
    const { rows: bumped } = await client.query<{ version: number }>(
      'UPDATE decks SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version',
      [deckId],
    )
    return { kind: 'applied' as const, result, version: bumped[0]!.version }
  })

export interface DeckSummaryRow {
  readonly id: DeckId
  readonly name: string
  readonly commanders: readonly OracleId[]
  readonly targetBracket: Bracket
  readonly archetype: ArchetypeKey
  readonly colorIdentity: readonly Color[]
  readonly cardCount: number
  readonly status: string
  readonly updatedAt: string
  readonly lastOpenedAt: string
}

/**
 * The list projection (doc 12 §12.2). Counts entries in SQL and NEVER loads
 * them — loading twelve full decks to draw a switcher menu is the mistake this
 * type exists to prevent.
 */
export const listDeckSummaries = async (
  pool: Pool,
  ownerId: string,
  options: { readonly status?: 'active' | 'archived' | 'all'; readonly limit?: number } = {},
): Promise<DeckSummaryRow[]> => {
  const status = options.status ?? 'active'
  const { rows } = await pool.query<{
    id: string
    name: string
    commanders: string[]
    target_bracket: number
    archetype: string
    color_identity: string[]
    card_count: string
    status: string
    updated_at: Date
    last_opened_at: Date
  }>(
    `SELECT d.id, d.name, d.commanders, d.target_bracket, d.archetype, d.color_identity,
            d.status, d.updated_at, d.last_opened_at,
            COALESCE(e.accepted, 0) + cardinality(d.commanders) AS card_count
       FROM decks d
       LEFT JOIN LATERAL (
         SELECT count(*) AS accepted FROM deck_entries
          WHERE deck_id = d.id AND zone = 'accepted'
       ) e ON true
      WHERE d.owner_id = $1 AND d.deleted_at IS NULL
        AND ($2 = 'all' OR d.status = $2)
      ORDER BY d.last_opened_at DESC
      LIMIT $3`,
    [ownerId, status, options.limit ?? 50],
  )
  return rows.map((row) => ({
    id: row.id as DeckId,
    name: row.name,
    commanders: row.commanders as OracleId[],
    targetBracket: row.target_bracket as Bracket,
    archetype: row.archetype as ArchetypeKey,
    colorIdentity: row.color_identity as Color[],
    cardCount: Number(row.card_count),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    lastOpenedAt: row.last_opened_at.toISOString(),
  }))
}

/** 30-day soft delete (doc 12 §12.2). The row stays; the deck stops being visible. */
export const softDeleteDeck = async (pool: Pool, id: DeckId): Promise<boolean> => {
  const { rowCount } = await pool.query(
    'UPDATE decks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  return (rowCount ?? 0) > 0
}

export const restoreDeck = async (pool: Pool, id: DeckId): Promise<boolean> => {
  const { rowCount } = await pool.query(
    'UPDATE decks SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
    [id],
  )
  return (rowCount ?? 0) > 0
}
