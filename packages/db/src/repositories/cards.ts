import type { Card, Color, OracleId, PrintingId, Role } from '@roundtable/domain'
import type { Pool } from 'pg'

interface CardRow {
  readonly oracle_id: string
  readonly name: string
  readonly mana_cost: string | null
  readonly mana_value: number
  readonly color_identity: string[]
  readonly colors: string[]
  readonly produced_mana: string[]
  readonly type_line: string
  readonly types: string[]
  readonly oracle_text: string
  readonly oracle_text_faces: string[] | null
  readonly power: string | null
  readonly toughness: string | null
  readonly loyalty: string | null
  readonly keywords: string[]
  readonly legality_commander: string
  readonly can_be_commander: boolean | null
  readonly edhrec_rank: number | null
  readonly default_printing: string | null
  readonly roles: string[]
  readonly primary_role: string
  readonly universes_beyond: boolean
  readonly synergy_produces: string[]
  readonly synergy_wants: string[]
  readonly game_changer: boolean
}

/** A printed value as an integer, or null if it is not one. */
const wholeNumber = (value: string | null): number | null => {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

const toCard = (row: CardRow): Card => ({
  oracleId: row.oracle_id as OracleId,
  name: row.name,
  manaCost: row.mana_cost,
  manaValue: row.mana_value,
  colorIdentity: row.color_identity as Color[],
  colors: row.colors as Color[],
  producedMana: (row.produced_mana ?? []) as NonNullable<Card['producedMana']>,
  typeLine: row.type_line,
  types: row.types as Card['types'],
  oracleText: row.oracle_text,
  // Null is not `[]`. A single-faced card has no faces to list; an empty array
  // would claim it has zero, and the renderer keys the face rule off that.
  ...(row.oracle_text_faces === null || row.oracle_text_faces === undefined
    ? {}
    : { oracleTextFaces: row.oracle_text_faces }),
  power: row.power,
  toughness: row.toughness,
  loyalty: row.loyalty,
  keywords: row.keywords,
  legalities: { commander: row.legality_commander as Card['legalities']['commander'] },
  // NULL is not `false`. A row written before migration 0010 has no answer, and
  // `false` would say the card may not lead a deck — which for the 3,384
  // eligible cards in the corpus is a lie, and one that would reject every deck
  // created between the migration and the re-ingest that fills the column.
  ...(row.can_be_commander === null || row.can_be_commander === undefined
    ? {}
    : { canBeCommander: row.can_be_commander }),
  edhrecRank: row.edhrec_rank,
  defaultPrinting: row.default_printing as PrintingId | null,
  roles: row.roles as Role[],
  primaryRole: row.primary_role as Role,
  universesBeyond: row.universes_beyond,
  synergyProduces: row.synergy_produces as Card['synergyProduces'],
  synergyWants: row.synergy_wants as Card['synergyWants'],
  gameChanger: row.game_changer,
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
    // `[]` rather than null: the column is NOT NULL, and a card read before
    // migration 0008 genuinely has no answer, which is the same as none known.
    produced_mana: c.producedMana ?? [],
    type_line: c.typeLine,
    types: c.types,
    oracle_text: c.oracleText,
    oracle_text_faces: c.oracleTextFaces ?? null,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    // The parsed value, or null when the printed one is not a fixed WHOLE
    // number. `*` and `1+*` are the obvious cases; the one that actually broke
    // the ingest was `1.5`, from the Un-sets, which is finite and still not
    // something an integer column will take. Null is what a range query should
    // exclude either way.
    power_num: wholeNumber(c.power),
    toughness_num: wholeNumber(c.toughness),
    keywords: c.keywords,
    legality_commander: c.legalities.commander,
    // Null, not `false`, when the card was read before the flag existed: the
    // column's whole point is that "cannot lead a deck" and "nobody has decided
    // yet" must not arrive in the database as the same value.
    can_be_commander: c.canBeCommander ?? null,
    edhrec_rank: c.edhrecRank,
    default_printing: c.defaultPrinting,
    roles: c.roles,
    primary_role: c.primaryRole,
    universes_beyond: c.universesBeyond,
    synergy_produces: c.synergyProduces,
    synergy_wants: c.synergyWants,
    game_changer: c.gameChanger,
  }))

  const { rowCount } = await pool.query(
    `INSERT INTO cards (
       oracle_id, name, mana_cost, mana_value, color_identity, colors, produced_mana, type_line,
       types, oracle_text, oracle_text_faces, power, toughness, loyalty, power_num, toughness_num,
       keywords, legality_commander, can_be_commander, edhrec_rank,
       default_printing, roles, primary_role, universes_beyond,
       synergy_produces, synergy_wants, game_changer)
     SELECT oracle_id, name, mana_cost, mana_value, color_identity, colors, produced_mana, type_line,
            types, oracle_text, oracle_text_faces, power, toughness, loyalty, power_num, toughness_num,
            keywords, legality_commander, can_be_commander, edhrec_rank,
            default_printing, roles, primary_role, universes_beyond,
            synergy_produces, synergy_wants, game_changer
       FROM jsonb_to_recordset($1::jsonb) AS x(
         oracle_id uuid, name text, mana_cost text, mana_value real,
         color_identity char(1)[], colors char(1)[], produced_mana char(1)[],
         type_line text, types text[],
         oracle_text text, oracle_text_faces text[], power text, toughness text, loyalty text,
         power_num integer, toughness_num integer,
         keywords text[], legality_commander text, can_be_commander boolean,
         edhrec_rank integer, default_printing uuid, roles text[], primary_role text,
         universes_beyond boolean, synergy_produces text[], synergy_wants text[],
         game_changer boolean)
     ON CONFLICT (oracle_id) DO UPDATE SET
       name = EXCLUDED.name, mana_cost = EXCLUDED.mana_cost,
       mana_value = EXCLUDED.mana_value, color_identity = EXCLUDED.color_identity,
       colors = EXCLUDED.colors, produced_mana = EXCLUDED.produced_mana,
       type_line = EXCLUDED.type_line,
       types = EXCLUDED.types, oracle_text = EXCLUDED.oracle_text,
       oracle_text_faces = EXCLUDED.oracle_text_faces,
       power = EXCLUDED.power, toughness = EXCLUDED.toughness,
       loyalty = EXCLUDED.loyalty, power_num = EXCLUDED.power_num,
       toughness_num = EXCLUDED.toughness_num,
       keywords = EXCLUDED.keywords, legality_commander = EXCLUDED.legality_commander,
       -- In the UPDATE clause as well as the INSERT, and this is the half that
       -- matters: the re-ingest that fills this column meets 34,492 rows that
       -- already exist, so every value arrives through ON CONFLICT. Left out
       -- here the column would stay NULL forever while an insert-only test
       -- passed.
       can_be_commander = EXCLUDED.can_be_commander,
       edhrec_rank = EXCLUDED.edhrec_rank, default_printing = EXCLUDED.default_printing,
       roles = EXCLUDED.roles, primary_role = EXCLUDED.primary_role,
       universes_beyond = EXCLUDED.universes_beyond,
       synergy_produces = EXCLUDED.synergy_produces,
       synergy_wants = EXCLUDED.synergy_wants,
       game_changer = EXCLUDED.game_changer`,
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
  if (rows.length > 0) return rows.map(toCard)

  /*
   * Nothing matched literally, so try for a near miss.
   *
   * A substring search cannot find "Ashnod's Altar" from "Ashnods" — the wrong
   * character is in the middle, and no LIKE pattern reaches past it. Trigrams
   * degrade gracefully instead: they compare three-character shingles, so one
   * bad character costs a little score rather than the whole match.
   *
   * `word_similarity` and not `similarity`: the latter normalises over the
   * whole string, and Magic names are long enough that "Sekii" scores lower
   * against "Sekki, Seasons' Guide" than against a dozen unrelated four-letter
   * cards. This compares the term against the closest run of words in the name.
   *
   * 0.5 is deliberately strict. It catches a dropped apostrophe, a doubled
   * letter, a truncated word — and refuses to invent a suggestion for text that
   * is not a card name at all, which is a real answer the caller needs.
   */
  const { rows: near } = await pool.query<CardRow>(
    `SELECT * FROM cards
      WHERE word_similarity(lower($1), lower(name)) >= 0.5
      ORDER BY word_similarity(lower($1), lower(name)) DESC, length(name), name
      LIMIT $2`,
    [term, limit],
  )
  return near.map(toCard)
}

/**
 * The basic lands a deck may legally run.
 *
 * A separate query because `findEligibleCards` deliberately EXCLUDES basics —
 * "the mana base is its own tool" (doc 05 §5.2) — so they never appear as
 * candidates and the deck builder otherwise has no way to add one at all.
 *
 * Colourless basics (Wastes) are legal in every deck, so the identity test is
 * containment rather than intersection.
 */
export const findBasicLands = async (
  pool: Pool,
  colorIdentity: readonly Color[],
): Promise<Card[]> => {
  const { rows } = await pool.query<CardRow>(
    `SELECT * FROM cards
      WHERE type_line ILIKE 'Basic%Land%'
        AND legality_commander = 'legal'
        AND color_identity <@ $1::char(1)[]
      ORDER BY cardinality(color_identity), name`,
    [colorIdentity],
  )
  return rows.map(toCard)
}

/**
 * Every card on Wizards' Game Changers list, by oracle id (DATA-05).
 *
 * The whole list, not the deck's intersection with it: it is dozens of rows
 * behind a partial index, and `loadBracketRules` wants the set so it can tell an
 * un-ingested corpus (empty) from a deck that simply has none. Fetching only the
 * deck's matches would make those two look identical, which is the failure this
 * exists to avoid.
 *
 * Legality is deliberately not filtered. A banned card is still on the list, and
 * a deck that somehow contains one should be told about both problems.
 */
export const gameChangerOracleIds = async (pool: Pool): Promise<OracleId[]> => {
  const { rows } = await pool.query<{ oracle_id: string }>(
    'SELECT oracle_id FROM cards WHERE game_changer',
  )
  return rows.map((r) => r.oracle_id as OracleId)
}

/**
 * Every legal card's name and oracle id, for decklist resolution (doc 15 §15.3).
 *
 * The whole table, because fuzzy matching needs somewhere to fuzz to: a typo
 * only resolves if the near-miss candidates are present. Two columns of 32k
 * rows, and an import is a rare operation.
 */
export const allCardNames = async (pool: Pool): Promise<{ oracleId: OracleId; name: string }[]> => {
  const { rows } = await pool.query<{ oracle_id: string; name: string }>(
    "SELECT oracle_id, name FROM cards WHERE legality_commander <> 'not_legal'",
  )
  return rows.map((r) => ({ oracleId: r.oracle_id as OracleId, name: r.name }))
}
