import type { Pool } from 'pg'
import { withTransaction } from '../client.js'

/**
 * The dataset snapshot a computation ran against (doc 09 §9.6).
 *
 * Every recommendation-bearing response carries it so a bug report reproduces:
 * "wrong suggestion" is unanswerable without knowing which corpus produced it.
 * Ingest is snapshot-and-swap (doc 04 §4.7), so exactly one row per source is
 * live at a time — enforced by `dataset_snapshots_live_idx`.
 */
export const liveSnapshotId = async (pool: Pool, source = 'scryfall'): Promise<string | null> => {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM dataset_snapshots WHERE source = $1 AND is_live LIMIT 1',
    [source],
  )
  return rows[0]?.id ?? null
}

/**
 * Record an ingest run, not yet live.
 *
 * Ingest is snapshot-and-swap (doc 04 §4.7): a run that dies half way must not
 * leave the app serving a half-written corpus, so the row is created first and
 * promoted only once the run finishes.
 */
export const createSnapshot = async (
  pool: Pool,
  id: string,
  source: string,
  counts: { readonly cards?: number; readonly combos?: number } = {},
): Promise<string> => {
  await pool.query(
    `INSERT INTO dataset_snapshots (id, source, card_count, combo_count, is_live)
     VALUES ($1, $2, $3, $4, false)`,
    [id, source, counts.cards ?? 0, counts.combos ?? 0],
  )
  return id
}

/**
 * Promote a snapshot, demoting the previous one atomically.
 *
 * One transaction, because `dataset_snapshots_live_idx` is a partial UNIQUE
 * index on `is_live` — demote and promote as two statements and a crash between
 * them leaves the source with no live snapshot at all.
 */
export const promoteSnapshot = async (pool: Pool, id: string, source: string): Promise<void> => {
  await withTransaction(pool, async (client) => {
    await client.query(
      'UPDATE dataset_snapshots SET is_live = false WHERE source = $1 AND is_live',
      [source],
    )
    await client.query(
      'UPDATE dataset_snapshots SET is_live = true, card_count = card_count WHERE id = $1',
      [id],
    )
  })
}

export const setSnapshotCounts = async (
  pool: Pool,
  id: string,
  counts: { readonly cards: number; readonly combos: number },
): Promise<void> => {
  await pool.query('UPDATE dataset_snapshots SET card_count = $2, combo_count = $3 WHERE id = $1', [
    id,
    counts.cards,
    counts.combos,
  ])
}
