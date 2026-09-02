import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STAPLES, STAPLE_DATA } from '@roundtable/domain'
import { databaseUrl } from './testing.js'

/**
 * Every curated staple still resolves to a real card, by exact name (ADR-0044).
 *
 * THIS TEST IS THE DIFFERENCE BETWEEN A CURATED LIST AND A LIST THAT QUIETLY
 * DOES NOTHING. `staples.ts` matches by exact string against `cards.name`,
 * deliberately, so a typo or a Scryfall rename does not degrade the feature —
 * it silently removes one card from it, and the smaller the list the larger
 * the share of it that vanishes. Nothing else in the product would go red:
 * `recommend` would simply put that card in a different group and every other
 * assertion would still hold. Only a query against the corpus can see it.
 *
 * AGAINST THE LIVE CORPUS, NOT A THROWAWAY DATABASE. Every other suite here
 * calls `createTestDatabase`, which gives an EMPTY migrated database — and an
 * empty database resolves nothing, so a name test against one would pass by
 * asserting nothing or fail by asserting the corpus exists. The question this
 * test asks is specifically "does the real card table still hold these names",
 * so it reads `DATABASE_URL` directly. It only ever SELECTs.
 *
 * WHY AN UNPOPULATED CORPUS SKIPS RATHER THAN FAILS. CI starts a bare
 * `postgres:16-alpine` and runs the migrations; no ingest runs there, so the
 * card table is empty on every CI run. A red tick there would be a report
 * about the CI service, not about this list, and a test that is red for a
 * reason nobody can fix is a test people learn to ignore. It says so loudly
 * instead — the same bargain `database-required.test.ts` strikes, and for the
 * same reason: the reduced coverage is visible in the log rather than hidden
 * in a count. Locally and against any ingested database it runs for real.
 */
const url = databaseUrl()
const describeDb = url === null ? describe.skip : describe

if (url === null) {
  console.warn('[db] DATABASE_URL not set — skipping the curated staples corpus check')
}

/**
 * Below this the card table is not a corpus and cannot answer the question.
 *
 * A thousand rather than one: "the ingest has not run" and "the ingest ran and
 * dropped 30,000 cards" must not read the same, and a handful of rows inserted
 * by another suite's fixture must not be mistaken for a corpus.
 */
const CORPUS_FLOOR = 1_000

describeDb('the curated staples list resolves against the corpus', () => {
  let pool: Pool
  let corpusSize = 0

  beforeAll(async () => {
    pool = new Pool({ connectionString: url ?? undefined })
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from cards where legality_commander = 'legal'`,
    )
    corpusSize = Number(rows[0]?.n ?? '0')
    if (corpusSize < CORPUS_FLOOR) {
      console.warn(
        `[db] the card table holds ${corpusSize} commander-legal cards, fewer than ` +
          `${CORPUS_FLOOR} — the curated staples were NOT checked against a corpus in ` +
          'this run. Run the ingest against this database to make these assertions real.',
      )
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  it('names only cards that exist and are commander-legal', async () => {
    if (corpusSize < CORPUS_FLOOR) return
    const names = [...STAPLES.names]
    const { rows } = await pool.query<{ name: string; legality_commander: string }>(
      `select name, legality_commander from cards where name = any($1::text[])`,
      [names],
    )
    const legal = new Set(rows.filter((r) => r.legality_commander === 'legal').map((r) => r.name))
    const unresolved = names.filter((n) => !legal.has(n))
    expect(
      unresolved,
      `these curated staples no longer resolve to a commander-legal card by exact ` +
        `name: ${unresolved.join(', ')}. Fix the spelling in ` +
        `packages/domain/src/staples/staples.data.json, or remove the entry — an ` +
        `unresolvable name silently shrinks the list and nothing else goes red.`,
    ).toEqual([])
  })

  it('reaches both leading groups — some entries are lands and some are not', async () => {
    if (corpusSize < CORPUS_FLOOR) return
    // The split is derived from the corpus's own `types` (`stapleGroupFor`), so
    // this is the only place it can be checked against real type lines. A list
    // that drifted to all-spells or all-lands would leave one of the two
    // opening phases permanently empty, which is a dead heading in the feed.
    const { rows } = await pool.query<{ is_land: boolean; n: string }>(
      `select 'land' = any(types) as is_land, count(*)::text as n
         from cards where name = any($1::text[]) group by 1`,
      [[...STAPLES.names]],
    )
    const counts = new Map(rows.map((r) => [r.is_land, Number(r.n)]))
    expect(counts.get(true) ?? 0).toBeGreaterThan(0)
    expect(counts.get(false) ?? 0).toBeGreaterThan(0)
  })

  it('was verified against a corpus no earlier than it was curated', () => {
    // Cheap, and it catches the one way the provenance can lie: somebody adds
    // names, bumps `curatedAt`, and leaves `verifiedAgainstCorpusAt` behind on
    // the date when a different list was checked.
    expect(STAPLE_DATA.verifiedAgainstCorpusAt >= STAPLE_DATA.curatedAt).toBe(true)
  })
})
