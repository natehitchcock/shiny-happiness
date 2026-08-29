import type { Combo, ComboId, OracleId } from '@roundtable/domain'
import type { Pool } from 'pg'

/**
 * Combo storage and the oracle-id lookup that combo degree depends on.
 *
 * `combosContaining` is the hot path (doc 05 §5.8) and is served by the GIN
 * index on `combos.pieces`, not by a join table — the query is "which combos
 * contain any of these cards", which array containment answers directly.
 */

interface ComboRow {
  readonly combo_id: string
  readonly pieces: string[]
  readonly prerequisites: string
  readonly steps: string[]
  readonly produces: string[]
  readonly color_identity: string[]
}

const toCombo = (row: ComboRow): Combo => ({
  id: row.combo_id as ComboId,
  pieces: row.pieces as OracleId[],
  prerequisites: row.prerequisites,
  steps: row.steps,
  produces: row.produces as Combo['produces'],
  colorIdentity: row.color_identity as Combo['colorIdentity'],
})

/** See `upsertCards` for why this is jsonb rather than unnest. */
export const insertCombos = async (pool: Pool, combos: readonly Combo[]): Promise<number> => {
  if (combos.length === 0) return 0
  const payload = combos.map((c) => ({
    combo_id: c.id,
    pieces: c.pieces,
    prerequisites: c.prerequisites,
    steps: c.steps,
    produces: c.produces,
    color_identity: c.colorIdentity,
  }))

  const { rowCount } = await pool.query(
    `INSERT INTO combos (combo_id, pieces, prerequisites, steps, produces, color_identity)
     SELECT combo_id, pieces, prerequisites, steps, produces, color_identity
       FROM jsonb_to_recordset($1::jsonb) AS x(
         combo_id text, pieces uuid[], prerequisites text, steps text[],
         produces text[], color_identity char(1)[])
     ON CONFLICT (combo_id) DO UPDATE SET
       pieces = EXCLUDED.pieces,
       prerequisites = EXCLUDED.prerequisites,
       steps = EXCLUDED.steps,
       produces = EXCLUDED.produces,
       color_identity = EXCLUDED.color_identity`,
    [JSON.stringify(payload)],
  )
  return rowCount ?? 0
}

/** Every combo containing any of `cards`. Backed by `combos_pieces_idx`. */
export const combosContaining = async (
  pool: Pool,
  cards: readonly OracleId[],
): Promise<Combo[]> => {
  if (cards.length === 0) return []
  const { rows } = await pool.query<ComboRow>(
    'SELECT * FROM combos WHERE pieces && $1::uuid[] ORDER BY combo_id',
    [cards],
  )
  return rows.map(toCombo)
}

/** Combos entirely contained in `accepted` — the deck's assembled combos. */
export const combosWithin = async (pool: Pool, accepted: readonly OracleId[]): Promise<Combo[]> => {
  if (accepted.length === 0) return []
  const { rows } = await pool.query<ComboRow>(
    'SELECT * FROM combos WHERE pieces <@ $1::uuid[] ORDER BY combo_id',
    [accepted],
  )
  return rows.map(toCombo)
}

export const allCombos = async (pool: Pool): Promise<Combo[]> => {
  const { rows } = await pool.query<ComboRow>('SELECT * FROM combos ORDER BY combo_id')
  return rows.map(toCombo)
}
