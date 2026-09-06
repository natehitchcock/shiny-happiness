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

/**
 * EVERY commander that carries any of `tags`. No page, no order, no limit.
 *
 * ARRAY OVERLAP (`&&`), which is what the two GIN indexes from migration 0003
 * were built for — the same index the census above cannot use for `has` and
 * this query would not be affordable without.
 *
 * ## Why this no longer cuts, and why that is the fix (ADR-0069)
 *
 * It used to return `limit` rows ordered by `cardinality(ARRAY(… INTERSECT …))`
 * and then by name, so SQL narrowed AND cut on the match count. The trouble is
 * that a single common pick makes every carrier a one-of-one match: 645
 * commanders carry `creature-etb`, all 645 tie, and the NAME did all of the
 * work. The first five were Aang, Aang, Aang, Aang, Aatchik.
 *
 * The order is now match count, then how much the commander DOES, then name —
 * and impact is computed from the card's own text by `cardImpact`, which no
 * amount of SQL can express. So the ranking has to happen in the domain over
 * the whole matching set, and anything cut here would be cut on the wrong
 * measure. Ranking a page ordered by name returns the impact-best of the
 * alphabetically first sixty, which is the same defect with a smaller symptom.
 *
 * ## What that costs, measured
 *
 * The result is bounded by the corpus rather than by a parameter, and the bound
 * is small: 3,411 commander-legal commanders in total, of which 3,104 carry any
 * semantic at all. The widest single tag is `token` at 786 carriers (430 KiB of
 * rows), and `creature-etb`'s 645 are 348 KiB — against the 12.1 MB
 * `findEligibleCards` moves for a five-colour deck. Selecting only the columns
 * impact reads would have saved 21% of those bytes and cost a second round trip
 * to hydrate the survivors, and a round trip here is ~36 ms (ADR-0063).
 *
 * The count query that used to run beside this one is gone: the caller ranks
 * the whole set, so `total` is the length of what it ranked. One round trip
 * where there were two.
 */
export const commandersBySemantics = async (
  pool: Pool,
  tags: readonly SynergyTag[],
): Promise<readonly Card[]> => {
  if (tags.length === 0) return []

  const { rows } = await pool.query<CardRow>(
    `SELECT ${ELIGIBLE_COLUMNS} FROM cards
      WHERE legality_commander = 'legal'
        AND can_be_commander IS TRUE
        AND (synergy_produces || synergy_wants) && $1::text[]`,
    [tags],
  )
  return cardsFromRows(rows)
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
