import type { Pool } from 'pg'

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
