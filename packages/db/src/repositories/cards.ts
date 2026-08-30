import type { Card, Color, OracleId, PrintingId, Role } from '@roundtable/domain'
import type { Pool } from 'pg'

interface CardRow {
  readonly oracle_id: string
  readonly name: string
  readonly mana_cost: string | null
  readonly mana_value: number
  readonly color_identity: string[]
  readonly colors: string[]
  readonly type_line: string
  readonly types: string[]
  readonly oracle_text: string
  readonly keywords: string[]
  readonly legality_commander: string
  readonly edhrec_rank: number | null
  readonly default_printing: string | null
  readonly roles: string[]
  readonly primary_role: string
  readonly universes_beyond: boolean
  readonly synergy_produces: string[]
  readonly synergy_wants: string[]
}

const toCard = (row: CardRow): Card => ({
  oracleId: row.oracle_id as OracleId,
  name: row.name,
  manaCost: row.mana_cost,
  manaValue: row.mana_value,
  colorIdentity: row.color_identity as Color[],
  colors: row.colors as Color[],
  typeLine: row.type_line,
  types: row.types as Card['types'],
  oracleText: row.oracle_text,
  keywords: row.keywords,
  legalities: { commander: row.legality_commander as Card['legalities']['commander'] },
  edhrecRank: row.edhrec_rank,
  defaultPrinting: row.default_printing as PrintingId | null,
  roles: row.roles as Role[],
  primaryRole: row.primary_role as Role,
  universesBeyond: row.universes_beyond,
  synergyProduces: row.synergy_produces as Card['synergyProduces'],
  synergyWants: row.synergy_wants as Card['synergyWants'],
})

/**
 * Bulk upsert.
 *
 * Uses `jsonb_to_recordset` rather than `unnest`: unnest FLATTENS
 * multidimensional arrays, so a bulk insert of rows that themselves contain
 * array columns (colour identity, types, keywords, roles) silently degrades into
 * a shape Postgres rejects. jsonb keeps each row's arrays intact.
 */
export const upsertCards = async (pool: Pool, cards: readonly Card[]): Promise<number> => {
  if (cards.length === 0) return 0

  // `ON CONFLICT DO UPDATE` cannot touch the same row twice in one statement, so
  // a batch containing an oracle id twice aborts entirely. Bulk Scryfall data
  // can contain repeats; last one wins, which matches the upsert semantics.
  const deduped = [...new Map(cards.map((c) => [c.oracleId, c])).values()]

  const payload = deduped.map((c) => ({
    oracle_id: c.oracleId,
    name: c.name,
    mana_cost: c.manaCost,
    mana_value: c.manaValue,
    color_identity: c.colorIdentity,
    colors: c.colors,
    type_line: c.typeLine,
    types: c.types,
    oracle_text: c.oracleText,
    keywords: c.keywords,
    legality_commander: c.legalities.commander,
    edhrec_rank: c.edhrecRank,
    default_printing: c.defaultPrinting,
    roles: c.roles,
    primary_role: c.primaryRole,
    universes_beyond: c.universesBeyond,
    synergy_produces: c.synergyProduces,
    synergy_wants: c.synergyWants,
  }))

  const { rowCount } = await pool.query(
    `INSERT INTO cards (
       oracle_id, name, mana_cost, mana_value, color_identity, colors, type_line,
       types, oracle_text, keywords, legality_commander, edhrec_rank,
       default_printing, roles, primary_role, universes_beyond,
       synergy_produces, synergy_wants)
     SELECT oracle_id, name, mana_cost, mana_value, color_identity, colors, type_line,
            types, oracle_text, keywords, legality_commander, edhrec_rank,
            default_printing, roles, primary_role, universes_beyond,
            synergy_produces, synergy_wants
       FROM jsonb_to_recordset($1::jsonb) AS x(
         oracle_id uuid, name text, mana_cost text, mana_value real,
         color_identity char(1)[], colors char(1)[], type_line text, types text[],
         oracle_text text, keywords text[], legality_commander text,
         edhrec_rank integer, default_printing uuid, roles text[], primary_role text,
         universes_beyond boolean, synergy_produces text[], synergy_wants text[])
     ON CONFLICT (oracle_id) DO UPDATE SET
       name = EXCLUDED.name, mana_cost = EXCLUDED.mana_cost,
       mana_value = EXCLUDED.mana_value, color_identity = EXCLUDED.color_identity,
       colors = EXCLUDED.colors, type_line = EXCLUDED.type_line,
       types = EXCLUDED.types, oracle_text = EXCLUDED.oracle_text,
       keywords = EXCLUDED.keywords, legality_commander = EXCLUDED.legality_commander,
       edhrec_rank = EXCLUDED.edhrec_rank, default_printing = EXCLUDED.default_printing,
       roles = EXCLUDED.roles, primary_role = EXCLUDED.primary_role,
       universes_beyond = EXCLUDED.universes_beyond,
       synergy_produces = EXCLUDED.synergy_produces,
       synergy_wants = EXCLUDED.synergy_wants`,
    [JSON.stringify(payload)],
  )
  return rowCount ?? 0
}

export const getCard = async (pool: Pool, oracleId: OracleId): Promise<Card | null> => {
  const { rows } = await pool.query<CardRow>('SELECT * FROM cards WHERE oracle_id = $1', [oracleId])
  const row = rows[0]
  return row === undefined ? null : toCard(row)
}

export const getCards = async (pool: Pool, ids: readonly OracleId[]): Promise<Card[]> => {
  if (ids.length === 0) return []
  const { rows } = await pool.query<CardRow>(
    'SELECT * FROM cards WHERE oracle_id = ANY($1::uuid[]) ORDER BY name',
    [ids],
  )
  return rows.map(toCard)
}

/**
 * The eligible candidate pool for a deck's colours (doc 05 §5.2).
 *
 * Colour identity and legality are filtered in SQL rather than in the
 * application: pulling 30k cards over the wire to discard 28k of them is the
 * kind of thing that only shows up under real data volume.
 */
export const findEligibleCards = async (
  pool: Pool,
  colorIdentity: readonly Color[],
  options: {
    readonly excludeBasicLands?: boolean
    readonly limit?: number
    /** Per-deck taste filter, not a legality rule (ADR-0011). */
    readonly excludeUniversesBeyond?: boolean
  } = {},
): Promise<Card[]> => {
  const { rows } = await pool.query<CardRow>(
    `SELECT * FROM cards
      WHERE legality_commander = 'legal'
        AND color_identity <@ $1::char(1)[]
        AND ($2::boolean = false OR type_line NOT ILIKE '%basic%land%')
        AND ($4::boolean = false OR universes_beyond = false)
      ORDER BY edhrec_rank NULLS LAST, name
      LIMIT $3`,
    [
      colorIdentity,
      options.excludeBasicLands ?? true,
      options.limit ?? 5000,
      options.excludeUniversesBeyond ?? false,
    ],
  )
  return rows.map(toCard)
}

/**
 * One keyset page of the card table, ordered by `(name, oracle_id)`.
 *
 * Keyset, not OFFSET (doc 10 §10.1): an offset re-scans everything it skips and
 * shifts under concurrent ingest, so page 40 can repeat or drop a card. The
 * caller pages until it has enough matches — `/cards/search` evaluates the query
 * with the domain's own predicate rather than translating it to SQL, so SQL
 * narrows and the domain decides.
 */
export const listCardsAfter = async (
  pool: Pool,
  options: {
    readonly afterName?: string
    readonly afterOracleId?: OracleId
    readonly colorIdentity?: readonly Color[]
    readonly limit?: number
    readonly excludeUniversesBeyond?: boolean
  } = {},
): Promise<Card[]> => {
  const { rows } = await pool.query<CardRow>(
    `SELECT * FROM cards
      WHERE ($1::text IS NULL OR (name, oracle_id) > ($1::text, $2::uuid))
        AND ($3::char(1)[] IS NULL OR color_identity <@ $3::char(1)[])
        AND ($5::boolean = false OR universes_beyond = false)
      ORDER BY name, oracle_id
      LIMIT $4`,
    [
      options.afterName ?? null,
      options.afterOracleId ?? null,
      options.colorIdentity ?? null,
      options.limit ?? 500,
      options.excludeUniversesBeyond ?? false,
    ],
  )
  return rows.map(toCard)
}

export const searchCardsByName = async (pool: Pool, term: string, limit = 50): Promise<Card[]> => {
  // `%` and `_` are LIKE wildcards. Unescaped, a user typing "_" matches every
  // card in the table — a search box that quietly returns everything.
  const escaped = term.replace(/([\\%_])/g, '\\$1')
  const { rows } = await pool.query<CardRow>(
    `SELECT * FROM cards
      WHERE lower(name) LIKE '%' || lower($1) || '%' ESCAPE '\\'
      ORDER BY length(name), name LIMIT $2`,
    [escaped, limit],
  )
  return rows.map(toCard)
}
