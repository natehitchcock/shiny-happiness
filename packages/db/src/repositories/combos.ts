import type { Color, Combo, ComboId, OracleId } from '@roundtable/domain'
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

/**
 * Combos every piece of which is castable in a colour identity.
 *
 * `allCombos` pulls the whole table — 108,046 rows, 72 MB on the wire — and the
 * deck context did that on EVERY recommendation and analysis request. Against a
 * database on the same machine that is merely wasteful; against a metered
 * managed Postgres it exhausted a 5 GB monthly transfer quota in about sixty
 * requests and took the deployment down.
 *
 * Colour identity is the right filter because it is the same rule the deck is
 * built under (doc 03 §3.1): a combo with a single blue piece can never be
 * assembled in a mono-red deck, so scoring it is work whose answer is fixed.
 * Measured: mono-red 72 MB -> 2.1 MB, Mardu 72 MB -> 16.8 MB.
 *
 * A piece with NO card row is kept, not dropped: the `NOT EXISTS` can only
 * reject a piece it can find, so an unknown piece has no identity to be outside
 * of. That is deliberate — it is exactly what `allCombos` did — and this change
 * is meant to move less data, not to quietly change which combos exist.
 */
export const combosInIdentity = async (
  pool: Pool,
  identity: readonly Color[],
): Promise<Combo[]> => {
  const { rows } = await pool.query<ComboRow>(
    `SELECT * FROM combos co
      WHERE NOT EXISTS (
        SELECT 1
          FROM unnest(co.pieces) AS piece
          JOIN cards ca ON ca.oracle_id = piece
         WHERE NOT (ca.color_identity <@ $1::char(1)[])
      )
      ORDER BY combo_id`,
    [identity],
  )
  return rows.map(toCombo)
}
