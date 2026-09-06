import type { Card, OracleId, SemanticCensusEntry, SynergyTag } from '@roundtable/domain'
import { QUICKDRAW_FAMILIAR_RANK } from '@roundtable/domain'
import type { Pool } from 'pg'
import { cardsFromRows, ELIGIBLE_COLUMNS, type CardRow } from './cards.js'

/**
 * The three reads behind the start screen's two new doors (ADR-0067).
 *
 * All three are COMMANDER reads, not card reads, and that is why they are here
 * rather than in `cards.ts`: every one of them filters `can_be_commander` and
 * none of them is parameterised by a colour identity, because at the start
 * screen there is no deck to have one.
 *
 * `can_be_commander IS TRUE` and not `= true` throughout. The column is
 * nullable on purpose (migration 0010) — NULL means "ingested before the column
 * existed", which is not an answer — and `= true` on a NULL is NULL, which SQL
 * would drop from the result anyway. `IS TRUE` says out loud that only a
 * positive answer counts, so a re-ingest that has not run yet under-offers
 * rather than offering a card that cannot lead a deck.
 */

/**
 * How many cards stand behind every tag in the corpus.
 *
 * ONE full pass, not one query per tag. The vocabulary is 613 tags since
 * ADR-0046; asking 613 times would be 613 round trips at ~36 ms each (ADR-0063
 * priced this path per question asked, not per byte returned) to move about
 * fifteen kilobytes.
 *
 * `synergy_produces || synergy_wants` AND NEVER `synergy_has`. Two reasons and
 * the product one comes first (ADR-0067 §3): membership is not aboutness, so a
 * census including it would report `subtype:human` on 1,409 commanders because
 * they ARE Human. The second reason is that it is not possible from here —
 * there is no `synergy_has` column. It is derived per row by `toCard` from the
 * type line and the keywords (ADR-0048), so a census over it could use neither
 * GIN index and would have to scan all 31,782 rows deriving membership in
 * process, on the start screen, with no colour identity to narrow by.
 *
 * The inner `GROUP BY` is not decoration. `unnest(produces || wants)` emits a
 * tag TWICE for a card that both causes an event and pays off from it — a
 * sacrifice outlet that is also a death trigger — and without the collapse that
 * card would count as two supporting cards for one tag.
 *
 * The result is not filtered by the offer thresholds here. Deciding what is
 * worth offering is `qualifyingSemantics`'s job in the domain, and a repository
 * that pre-applied it would put half the rule in SQL where no test can see it.
 */
export const semanticCensus = async (pool: Pool): Promise<SemanticCensusEntry[]> => {
  const { rows } = await pool.query<{ tag: string; commanders: string; supporting: string }>(
    `SELECT tag,
            count(*)::text AS supporting,
            count(*) FILTER (WHERE can_be_commander IS TRUE)::text AS commanders
       FROM (
         SELECT c.oracle_id, c.can_be_commander, t.tag
           FROM cards c
           CROSS JOIN LATERAL unnest(c.synergy_produces || c.synergy_wants) AS t(tag)
          WHERE c.legality_commander = 'legal'
          GROUP BY c.oracle_id, c.can_be_commander, t.tag
       ) carried
      GROUP BY tag
      ORDER BY tag`,
  )
  return rows.map((row) => ({
    tag: row.tag as SynergyTag,
    // `count(*)` is `bigint`, which `pg` hands back as a string rather than
    // silently losing precision. Cast to text in SQL and parsed here, so the
    // conversion is one visible step instead of a `Number(unknown)`.
    commanders: Number(row.commanders),
    supporting: Number(row.supporting),
  }))
}

export interface CommandersBySemantics {
  readonly items: readonly Card[]
  /**
   * How many commanders carry at least one pick, before `limit`.
   *
   * Counted rather than inferred from `items.length`, because a page that is
   * exactly `limit` long cannot say whether it is the whole answer. The screen
   * needs to tell "these are the 12 there are" from "these are 12 of 340".
   */
  readonly total: number
}

/**
 * The commanders that carry any of `tags`.
 *
 * ARRAY OVERLAP (`&&`), which is what the two GIN indexes from migration 0003
 * were built for — the same index the census above cannot use for `has` and
 * this query would not be affordable without.
 *
 * The ORDER is decided in the domain (`rankBySemanticMatches`), not here, and
 * the SQL only narrows. That split is deliberate: the ranking rule is "how many
 * of the builder's picks did this one match", the ranking is what the builder
 * is being shown, and a rule that lived in a string in this file would be
 * testable only against a live database. What SQL must still do is CUT, because
 * a wide pick can match hundreds of commanders and shipping all of them to sort
 * three of them at the top is the read ADR-0064 argues about.
 *
 * So the cut is made on the same measure the domain sorts by — the size of the
 * intersection — computed here purely as an ORDER BY. `limit` rows come back
 * already carrying the best matches, and the domain re-derives the number it
 * ranks by from the cards themselves rather than trusting a count computed in
 * SQL. Two implementations of one rule would eventually be two answers
 * (migration 0010 makes the same argument), so only one of them is authoritative
 * and it is the one in `packages/domain`.
 */
export const commandersBySemantics = async (
  pool: Pool,
  tags: readonly SynergyTag[],
  options: { readonly limit?: number } = {},
): Promise<CommandersBySemantics> => {
  if (tags.length === 0) return { items: [], total: 0 }

  const overlap = `legality_commander = 'legal'
        AND can_be_commander IS TRUE
        AND (synergy_produces || synergy_wants) && $1::text[]`

  const [page, counted] = await Promise.all([
    pool.query<CardRow>(
      `SELECT ${ELIGIBLE_COLUMNS} FROM cards
        WHERE ${overlap}
        ORDER BY cardinality(
                   ARRAY(SELECT unnest(synergy_produces || synergy_wants)
                         INTERSECT
                         SELECT unnest($1::text[]))
                 ) DESC,
                 name
        LIMIT $2`,
      [tags, options.limit ?? 60],
    ),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM cards WHERE ${overlap}`, [
      tags,
    ]),
  ])

  return { items: cardsFromRows(page.rows), total: Number(counted.rows[0]?.total ?? '0') }
}

export interface CommanderDrawPools {
  readonly familiar: readonly OracleId[]
  readonly all: readonly OracleId[]
}

/**
 * The two pools a quickdraw hand is dealt from, as ids and nothing else.
 *
 * IDS, NOT CARDS. The full pool is 3,411 commanders; as `Card` rows that is
 * megabytes to choose three from, and the three chosen are fetched by
 * `getCards` afterwards. As uuids it is ~120 KB, held once per snapshot.
 *
 * ONE query for both pools, split in process. Two queries would be two round
 * trips for two overlapping scans of the same index, and — worse — two reads
 * that could disagree if an ingest landed between them, which is a hand that
 * deals a familiar card the wildcard pool has never heard of.
 *
 * `edhrec_rank` is Scryfall's, and every one of the 3,411 legal commanders has
 * one, so `NULL` here is a card the ingest has not seen rather than an unpopular
 * one. It is excluded from `familiar` for that reason and kept in `all`: the
 * wildcard pool is "every commander", and a card whose popularity is unknown is
 * still a commander.
 */
export const commanderDrawPools = async (
  pool: Pool,
  options: { readonly familiarRank?: number } = {},
): Promise<CommanderDrawPools> => {
  const { rows } = await pool.query<{ oracle_id: string; familiar: boolean }>(
    `SELECT oracle_id,
            (edhrec_rank IS NOT NULL AND edhrec_rank <= $1) AS familiar
       FROM cards
      WHERE legality_commander = 'legal'
        AND can_be_commander IS TRUE
      ORDER BY oracle_id`,
    [options.familiarRank ?? QUICKDRAW_FAMILIAR_RANK],
  )
  const all: OracleId[] = []
  const familiar: OracleId[] = []
  for (const row of rows) {
    const id = row.oracle_id as OracleId
    all.push(id)
    if (row.familiar) familiar.push(id)
  }
  return { familiar, all }
}
