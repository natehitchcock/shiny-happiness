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
  readonly produces: string[]
  /** Absent on the scoring read, which does not select them (ADR-0017). */
  readonly prerequisites?: string
  readonly steps?: string[]
  readonly color_identity?: string[]
}

/**
 * A row becomes a combo, carrying only the fields the row actually had.
 *
 * The optional three are spread in conditionally rather than defaulted to `''`
 * and `[]`. Under `exactOptionalPropertyTypes` a present-but-undefined property
 * is not the same as an absent one, and the distinction is the point: a reader
 * must be able to tell "this combo has no steps" from "steps were not
 * fetched", and an invented empty array says the first while meaning the
 * second.
 */
const toCombo = (row: ComboRow): Combo => ({
  id: row.combo_id as ComboId,
  pieces: row.pieces as OracleId[],
  produces: row.produces as Combo['produces'],
  ...(row.prerequisites === undefined ? {} : { prerequisites: row.prerequisites }),
  ...(row.steps === undefined ? {} : { steps: row.steps }),
  ...(row.color_identity === undefined
    ? {}
    : { colorIdentity: row.color_identity as NonNullable<Combo['colorIdentity']> }),
})

/** See `upsertCards` for why this is jsonb rather than unnest. */
export const insertCombos = async (pool: Pool, combos: readonly Combo[]): Promise<number> => {
  if (combos.length === 0) return 0
  // The ingest always has all six; the defaults are for a caller that built a
  // combo from a scoring read, which would otherwise write SQL nulls into
  // NOT NULL columns and fail at the database rather than here.
  const payload = combos.map((c) => ({
    combo_id: c.id,
    pieces: c.pieces,
    prerequisites: c.prerequisites ?? '',
    steps: c.steps ?? [],
    produces: c.produces,
    color_identity: c.colorIdentity ?? [],
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

/**
 * Remove combos by id, and say how many rows went (ADR-0038).
 *
 * `insertCombos` is an UPSERT and was the only write this table had, so nothing
 * a run decided against ever left it. A variant that Spellbook withdrew, or that
 * this project decided it cannot represent, kept the row an earlier ingest wrote
 * — for as long as the database lived.
 *
 * That is how the reported bug survived its own fix. The adapter correctly
 * refused to map `2034-3388--5` (Moritte + Ashnod's Altar + the "Persist
 * Creature" template) and the run reported 5,266 such refusals, while all 4,813
 * pre-existing short rows stayed exactly where they were: the combo total ROSE
 * to 109,388 on new variants, and the two-piece population — the one brackets
 * 1-3 read — did not move by a single row, 5,184 before and after.
 *
 * Deliberately id-by-id rather than "delete everything this run did not write".
 * A truncated download or a `--limit` run would make that sweep empty the table,
 * and this one cannot: every id passed here is a variant the run actually read
 * and positively rejected.
 *
 * The empty-list return is a round trip saved and matches `insertCombos`; it is
 * NOT the safety here, and saying so is the point. Removing it on its own moves
 * nothing, because `ANY('{}')` matches nothing. It only becomes load-bearing
 * beside the `<> ALL` predicate that the sweep above would need — which is
 * exactly why the sweep is not what this does.
 */
export const deleteCombos = async (pool: Pool, ids: readonly ComboId[]): Promise<number> => {
  if (ids.length === 0) return 0
  const { rowCount } = await pool.query('DELETE FROM combos WHERE combo_id = ANY($1::text[])', [
    ids,
  ])
  return rowCount ?? 0
}

/**
 * Remove every row whose id carries a template segment, and say how many went
 * (ADR-0049).
 *
 * The rows `deleteCombos` above cannot reach. It removes ids the run READ AND
 * POSITIVELY REJECTED, which by definition excludes a variant Spellbook has
 * withdrawn from the feed altogether — nobody reads it, so nobody rejects it,
 * so its row survives every run forever. 41 such rows were left after ADR-0038,
 * all of them three or four pieces, 30 of them one Veinwitch Coven + Phyrexian
 * Altar family, and 5 of the 12 combos a real Kess deck claimed to have
 * assembled were among them.
 *
 * ADR-0038 recorded this as unreachable without "delete everything this run did
 * not write", and refused that sweep because a truncated download or a
 * `--limit` run makes it empty the table. This is a third way and is neither.
 *
 * WHY IT IS EXACT, rather than a guess that happens to be right today:
 *
 *   - `--` in a Spellbook variant id is an EMPTY CARD SEGMENT, which is how the
 *     source writes a piece that is a card CLASS rather than a card
 *     (`2105-3337--140` is two cards and template 140). A card segment is a
 *     non-empty run of digits, so `--` cannot arise any other way. Checked
 *     against the live corpus: all 104,616 stored ids match
 *     `^[0-9]+(-[0-9]+)*(--[0-9]+)*$`, and the 41 with a `--` all carry it as a
 *     trailing `--<digits>` whose card-segment count equals their stored piece
 *     count.
 *   - `insertCombos` is the only write this table has, its only non-test caller
 *     is the combo ingest, and `variantSkipReason` refuses a template variant
 *     before a `Combo` is ever built — on `requires[]` AND on the id. So a `--`
 *     id in this table could only have been written by a build that predates
 *     that refusal. That invariant is pinned in
 *     `packages/clients/src/spellbook.test.ts`; if it fails, this function is
 *     unsafe and must change with it.
 *
 * And it cannot truncate. It reads no feed and counts no variants, so a run
 * that downloaded one variant, or none, removes exactly the rows a complete run
 * would — which is precisely what the refused sweep could not promise.
 *
 * ONE hyphen would match every id in the table. `LIKE '%--%'` is the rule and
 * the doubling is all of it; `-` is not a LIKE wildcard, so nothing here needs
 * escaping.
 */
export const pruneTemplateVariantCombos = async (pool: Pool): Promise<number> => {
  const { rowCount } = await pool.query("DELETE FROM combos WHERE combo_id LIKE '%--%'")
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

/**
 * How many combos are actually stored.
 *
 * For the health endpoint, which must not read the snapshot's `combo_count` for
 * this: a CARDS ingest writes a fresh snapshot recording the cards it wrote and
 * zero combos, because that run ingests no combos. The combos are still there —
 * the snapshot is a record of one run, not an inventory — so health reported
 * `comboCount: 0` beside `loaded: true` on a corpus holding 108,135 of them.
 * A diagnostic that says the wrong thing is worse than one that says nothing.
 *
 * `count(*)` and not `reltuples`: measured at 60 ms against the real table on a
 * managed Postgres versus 38 ms for the planner's estimate, and health is asked
 * rarely and by someone who needs a true answer. Twenty-two milliseconds is not
 * worth an approximation in the one endpoint whose job is to be believed.
 */
export const countCombos = async (pool: Pool): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM combos')
  return Number(rows[0]?.n ?? 0)
}

export const allCombos = async (pool: Pool): Promise<Combo[]> => {
  const { rows } = await pool.query<ComboRow>('SELECT * FROM combos ORDER BY combo_id')
  return rows.map(toCombo)
}

/**
 * Combos castable in a colour identity, carrying only what scoring reads.
 *
 * `allCombos` pulls the whole table — 108,046 rows, 79.7 MB on the wire — and
 * the deck context did that on EVERY recommendation and analysis request.
 * Against a database on the same machine that is merely wasteful; against a
 * metered managed Postgres it exhausted a 5 GB monthly transfer allowance in
 * about sixty requests and took the deployment down.
 *
 * Two cuts, and both are needed:
 *
 *   - The COLUMNS. `steps` and `prerequisites` are two thirds of the table's
 *     bytes and are read by nothing (ADR-0017); `color_identity` is what this
 *     query filters on and so never has to travel. 79.7 MB -> 19.6 MB.
 *   - The ROWS. Colour identity is the rule the deck is built under (doc 03
 *     §3.1), so a combo with a blue piece is not merely surplus in a mono-red
 *     deck, it can never be assembled. 19.6 MB -> 0.5 MB for mono-red, 4.6 MB
 *     for Mardu. It does nothing for a five-colour commander, who is legal for
 *     every combo there is — that case is what the warm-instance cache in
 *     `apps/api/src/combo-cache.ts` is for.
 *
 * The filter reads the STORED `combos.color_identity` rather than joining every
 * piece to its card. The first version did the join, on the grounds that it did
 * not depend on trusting an upstream field; checked against the whole corpus at
 * five identities the two agree on all 108,046 rows with zero disagreements, so
 * the join was cost with no evidence behind it.
 */
export const combosInIdentity = async (
  pool: Pool,
  identity: readonly Color[],
): Promise<Combo[]> => {
  const { rows } = await pool.query<ComboRow>(
    `SELECT combo_id, pieces, produces
       FROM combos
      WHERE color_identity <@ $1::char(1)[]
      ORDER BY combo_id`,
    [identity],
  )
  return rows.map(toCombo)
}
