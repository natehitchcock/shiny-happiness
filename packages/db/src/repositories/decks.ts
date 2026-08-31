import type {
  ArchetypeKey,
  Bracket,
  Color,
  Deck,
  DeckColumn,
  DeckCommand,
  DeckCommandBatch,
  DeckEntry,
  DeckId,
  OracleId,
  Origin,
  Role,
  SemanticEmphasis,
  Zone,
} from '@roundtable/domain'
import type { Pool, PoolClient } from 'pg'
import { parseDeckColumns, parseSemanticEmphasis, parseTargetOverrides } from '@roundtable/domain'
import { withTransaction } from '../client.js'

interface DeckRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly commanders: string[]
  readonly target_bracket: number
  readonly archetype: string
  readonly archetype_secondary: string | null
  readonly color_identity: string[]
  readonly budget_max_total: string | null
  readonly budget_max_card: string | null
  readonly status: string
  readonly exclude_universes_beyond: boolean
  /** `jsonb`, so whatever was written. Parsed, never cast — see `toDeck`. */
  readonly target_overrides: unknown
  /** `jsonb` array of `SynergyTag`. Parsed, never cast — see `toDeck`. */
  readonly semantic_emphasis: unknown
  /**
   * `jsonb` array of `DeckColumn`, or NULL for a deck that never set any.
   *
   * The only nullable jsonb column on this table, and deliberately so — NULL and
   * `[]` are different decks here (doc 18 §18.7, migration 0015).
   */
  readonly columns: unknown
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
  // Defaulted for rows written before the column existed; the column is NOT
  // NULL so this only covers a hand-built row in a test.
  description: row.description ?? '',
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
  /*
   * Parsed rather than cast. `target_overrides` is jsonb and the driver hands
   * back whatever is in it, including rows written by a build that knew a
   * different shape. `parseTargetOverrides` drops what it cannot read, so a bad
   * key costs that key and the deck still opens on its archetype's presets —
   * casting instead would push `{"role:ramp": "twelve"}` all the way into
   * `compositionTargets` and produce a NaN target nothing downstream can render.
   *
   * Also covers a hand-built row in a test that predates the column.
   */
  targetOverrides: parseTargetOverrides(row.target_overrides),
  /*
   * Parsed rather than cast, same discipline as `target_overrides` above and
   * the same failure it avoids: a tag written by a build that knew a different
   * vocabulary would otherwise reach `emphasisMatches` and quietly weight a tag
   * no card can ever carry. Dropping it costs that tag and leaves the rest of
   * the emphasis working, which is what a builder can recover from.
   *
   * Also covers a hand-built row in a test that predates the column.
   */
  semanticEmphasis: parseSemanticEmphasis(row.semantic_emphasis),
  /*
   * Parsed rather than cast, same discipline again — but note what the parser
   * returns and why it matters here more than on the two columns above.
   * `parseDeckColumns` gives back `null` for anything it cannot read, and null
   * means "never set", so a corrupt value returns the deck to its DEFAULT
   * columns rather than to none at all. Returning `[]` on a bad parse would
   * silently tell every reader the builder had deliberately removed everything,
   * which is a claim about their intent that the database has no basis for.
   *
   * Also covers a hand-built row in a test that predates the column.
   */
  columns: parseDeckColumns(row.columns),
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
  /** A device id from localStorage, not a user account (ADR-0014). */
  readonly ownerId: string
  readonly name: string
  readonly description?: string
  readonly commanders: readonly OracleId[]
  readonly targetBracket: Bracket
  readonly archetype: ArchetypeKey
  readonly archetypeSecondary?: ArchetypeKey | null
  readonly colorIdentity: readonly Color[]
  readonly excludeUniversesBeyond?: boolean
  /**
   * The commander semantics the builder picked at the start screen.
   *
   * Set at creation rather than by a follow-up PATCH because that is when the
   * user is asked — "before I start making the deck" — and a two-request
   * create would leave a window in which the deck exists with the wrong focus
   * and any recommendation fetched in it is scored against nothing.
   */
  readonly semanticEmphasis?: SemanticEmphasis
  /**
   * The columns to start this deck with (doc 18 §18.7).
   *
   * Absent leaves the row NULL, which is "never set" and draws
   * `DEFAULT_COLUMNS` — NOT the same as passing `[]`, which is a deck created
   * with no columns at all. Settable at creation for the same reason
   * `semanticEmphasis` is: a deck cloned or imported from one that had columns
   * should open with them, and a two-request create would leave a window in
   * which the deck exists showing the wrong ones.
   */
  readonly columns?: readonly DeckColumn[] | null
}

export const createDeck = async (pool: Pool, input: CreateDeckInput): Promise<Deck> => {
  const { rows } = await pool.query<DeckRow>(
    `INSERT INTO decks (id, owner_id, name, description, commanders, target_bracket, archetype,
                        archetype_secondary, color_identity, exclude_universes_beyond,
                        semantic_emphasis, columns)
     VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8, $9::char(1)[], $10, $11::jsonb, $12::jsonb)
     RETURNING *`,
    [
      input.id,
      input.ownerId,
      input.name,
      input.description ?? '',
      input.commanders,
      input.targetBracket,
      input.archetype,
      input.archetypeSecondary ?? null,
      input.colorIdentity,
      input.excludeUniversesBeyond ?? false,
      // Normalised through the parser on the way IN as well as out, so the row
      // holds the canonical order and a duplicate tag can never be stored.
      JSON.stringify(parseSemanticEmphasis(input.semanticEmphasis ?? [])),
      // Normalised through the parser on the way IN as well as out, so the row
      // holds a canonical, deduplicated list. `null` is written as SQL NULL
      // rather than as `'null'::jsonb` — the distinction between "never set" and
      // "deliberately empty" is the whole point of the column, and a JSON null
      // sitting in it would be a third state nobody has a meaning for.
      input.columns === null || input.columns === undefined
        ? null
        : JSON.stringify(parseDeckColumns(input.columns) ?? []),
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

/**
 * Record what a batch did, so a client that was behind can be told (API-06).
 *
 * Takes a `PoolClient`, not a pool, and is meant to be called from INSIDE
 * `applyBatch`'s callback: the log entry and the entry rewrite it describes must
 * commit together. Written after the commit instead, a crash in the window
 * leaves a version bump the log cannot explain — and an unexplained version is
 * exactly the gap `since` exists to close, so the failure would be invisible
 * until a client hit it.
 *
 * `version` is the version the deck REACHES, i.e. `baseVersion + 1`. It is
 * passed in rather than read back from `decks`, because `applyBatch` bumps the
 * version AFTER the callback runs; reading it here would return the old one.
 *
 * Only applied commands belong here. A rejected command changed nothing and
 * replaying the server's refusals is worse than replaying nothing.
 */
export const appendCommandLog = async (
  client: PoolClient,
  deckId: DeckId,
  version: number,
  commands: readonly DeckCommand[],
  appliedAt: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO deck_command_log (deck_id, version, commands, applied_at)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [deckId, version, JSON.stringify(commands), appliedAt],
  )
}

export interface CommandsSince {
  readonly batches: readonly DeckCommandBatch[]
  /**
   * `true` only when `batches` covers the WHOLE gap between the client's
   * version and the deck's.
   *
   * An empty `batches` is ambiguous on its own — "nothing happened" and "the
   * log does not go back that far" look identical, and a client that assumes
   * the first replays blindly over an edit it never saw. This is the flag that
   * makes the difference visible, and a client must refetch rather than replay
   * when it is false.
   */
  readonly complete: boolean
}

/**
 * The default cap on how much history one `409` will carry.
 *
 * A client 500 versions behind is not incrementally reconcilable in any useful
 * sense, and shipping 500 batches to say so costs more than the deck it is
 * describing — on a metered database (see `apps/api/src/corpus-cache.ts`) that
 * matters. Past the cap, `complete` is false and the client refetches, which is
 * exactly what it did before this existed.
 */
export const SINCE_LIMIT = 200

/**
 * The commands accepted after `baseVersion`, oldest first.
 *
 * `currentVersion` is passed in rather than re-read: the caller has just read
 * the deck under the same conditions, and reading it again here could observe a
 * newer version than the deck it is about to return — making `complete` a claim
 * about a deck the client will never see.
 */
export const commandsSince = async (
  pool: Pool,
  deckId: DeckId,
  baseVersion: number,
  currentVersion: number,
  options: { readonly limit?: number } = {},
): Promise<CommandsSince> => {
  const expected = currentVersion - baseVersion
  // A client at or ahead of the server has no gap to fill. Ahead is nonsense
  // rather than merely empty, so it is reported as incomplete, not as "nothing
  // happened" — the honest answer to a question that does not parse.
  if (expected <= 0) return { batches: [], complete: expected === 0 }

  const limit = options.limit ?? SINCE_LIMIT
  const { rows } = await pool.query<{ version: number; commands: unknown; applied_at: Date }>(
    `SELECT version, commands, applied_at FROM deck_command_log
      WHERE deck_id = $1 AND version > $2
      ORDER BY version
      LIMIT $3`,
    [deckId, baseVersion, limit],
  )

  const batches = rows.map((row) => ({
    version: row.version,
    appliedAt: row.applied_at.toISOString(),
    commands: row.commands as readonly DeckCommand[],
  }))

  // Complete means every version in (baseVersion, currentVersion] is accounted
  // for. Counting is not enough on its own — a deck that predates this table,
  // or one whose log has been pruned, yields rows that are contiguous with each
  // other but not with `baseVersion` — so the first version is checked too.
  const complete =
    batches.length === expected &&
    batches[0]?.version === baseVersion + 1 &&
    batches[batches.length - 1]?.version === currentVersion

  return { batches, complete }
}

export interface DeckSummaryRow {
  readonly id: DeckId
  readonly name: string
  readonly description: string
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
    description: string
    commanders: string[]
    target_bracket: number
    archetype: string
    color_identity: string[]
    card_count: string
    status: string
    updated_at: Date
    last_opened_at: Date
  }>(
    `SELECT d.id, d.name, d.description, d.commanders, d.target_bracket, d.archetype,
            d.color_identity,
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
    description: row.description,
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
