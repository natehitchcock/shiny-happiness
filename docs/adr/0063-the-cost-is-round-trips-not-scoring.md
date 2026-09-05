# ADR-0063 — The cost is round trips, not scoring, and the perf test measured a path production never takes

**Status:** accepted
**Date:** 2026-09-05
**Relates to:** [ADR-0011](0011-deck-shaping-controls.md) (API-02's 200 ms
budget), [ADR-0017](0017-combos-carry-only-what-scoring-reads.md) (trimming the
combo read), [ADR-0021](0021-card-art-from-scryfalls-cdn.md) (art on the facts
map, and the transfer blow-out that made `corpus-cache.ts` necessary).
**Changes:** one query in `packages/db/src/repositories/decks.ts`, and the
`beforeAll` of `apps/api/src/recommendations.perf.test.ts`. No schema change, no
wire change, no change to what the recommender scores or orders.

---

## 1. The defect

`POST /api/v1/decks/:id/recommendations` takes **381 ms median** against
API-02's 200 ms budget. Instrumenting the route and `loadDeckContext` per
request:

| stage | cost |
| --- | ---: |
| `getDeck` | 143–153 ms |
| `liveSnapshotId` | 36 ms |
| corpus wave (eligible + combos + printing facts + game changers) | 86–174 ms |
| `getCards` for the deck's own cards | 39–45 ms |
| `recommend()` — the actual scoring | **9–16 ms** |

One round trip to the database is ~36 ms from this machine, and every line above
except the last is a multiple of it. **The scoring engine is 9–16 ms of a 381 ms
request** — under 4% of it. Every previous performance ADR on this path
(ADR-0017's combo trimming, ADR-0046's untrimmed read) attacked bytes on the
wire, which was the right defect then and is not the defect now. This request is
slow because of how many times it speaks to the database, not because of
anything it computes or transfers.

Two things follow from that table, and they are one finding rather than two: the
largest line is a read that pays four round trips for two SELECTs, and the
second-largest is a cache that the test measuring all of this had silently
switched off.

## 2. `getDeck` spent four round trips on two SELECTs

The old body wrapped two reads in `withTransaction`:

```ts
export const getDeck = async (pool: Pool, id: DeckId): Promise<Deck | null> =>
  withTransaction(pool, async (client) => {
    const { rows } = await client.query<DeckRow>(
      'SELECT * FROM decks WHERE id = $1 AND deleted_at IS NULL', [id])
    const row = rows[0]
    if (row === undefined) return null
    const { rows: entryRows } = await client.query<EntryRow>(
      'SELECT * FROM deck_entries WHERE deck_id = $1 ORDER BY id', [id])
    return toDeck(row, entryRows.map(toEntry))
  })
```

The wire sees four messages — `BEGIN`, `SELECT`, `SELECT`, `COMMIT` — for two
reads. Three of the four are ~36 ms of latency buying nothing but the
transaction, and the transaction's own reason (below) does not need one.

### The measurement

Both shapes against the real database, ten runs each:

| shape | median |
| --- | ---: |
| `withTransaction` (BEGIN + 2 SELECT + COMMIT) | **152 ms** |
| single `LEFT JOIN` query | **38 ms** |

38 ms is one round trip. That is the floor, and the query now sits on it.

### Decision: one statement, every entry column aliased

```sql
SELECT d.*,
       e.id            AS entry_id,
       e.oracle_id     AS entry_oracle_id,
       e.zone          AS entry_zone,
       e.origin        AS entry_origin,
       e.locked        AS entry_locked,
       e.role_override AS entry_role_override,
       e.tags          AS entry_tags,
       e.added_at      AS entry_added_at
  FROM decks d
  LEFT JOIN deck_entries e ON e.deck_id = d.id
 WHERE d.id = $1 AND d.deleted_at IS NULL
 ORDER BY e.id
```

**The read consistency is not weakened, and that is why the transaction could
go.** Its docstring gave the real reason for it: read as two separate queries,
`version` can be fetched before a concurrent batch commits and `entries` after
it, producing a deck whose version does not describe its own contents — and
`version` is exactly what the client sends back for optimistic concurrency. A
single statement runs against a single snapshot, so it is *at least* as
consistent as the transaction was. The transaction was a correct fix for a real
hazard; it was simply the expensive one of the two available.

**Every entry column is aliased, and this is the whole difficulty of the
change.** `decks` and `deck_entries` both have an `id`. Written as
`SELECT d.*, e.*`, pg returns one `id` key for the pair and resolves the
duplicate to the **last** column of that name — the deck's own id would silently
become an entry's `bigserial`. Nothing downstream could catch it: `Deck.id` is a
branded string, the entry id arrives as a string, and the corrupted deck would
be handed to the route looking entirely well-formed, whereupon every subsequent
lookup 404s the deck that was just read successfully. `d.*` is kept on the left
of the join — it holds the deck half exactly as wide as the `SELECT *` it
replaced, so a column added to `decks` still flows through — and the prefix on
the right keeps `deck_entries` out of its namespace.

**A deck with no entries matches as ONE all-NULL row, not as zero rows.** So the
rows are *filtered* through a type guard rather than mapped:

```ts
const isEntry = (row: DeckWithEntryRow): row is DeckWithEntryRow & EntryColumns =>
  row.entry_id !== null
```

Mapped instead of filtered, an empty deck would come back holding a single entry
built entirely out of nulls — a deck the UI would render with one blank card in
it. The guard tests `entry_id` specifically, because it is the entries' primary
key and therefore NOT NULL in the table: a NULL there can only mean "no row on
the right". `entry_role_override` is genuinely nullable and `entry_tags`
genuinely defaults to `{}`, so neither of those could have carried the
distinction, and picking one of them is how this bug would have been written.

**`null` still means both things it meant.** No rows at all is a missing deck or
a soft-deleted one, and `deleted_at IS NULL` stays on the deck side of the join,
where it has to be — a soft-deleted deck still has its entry rows.

## 3. The perf test measured a path production never takes

This is the more embarrassing half, and the one most likely to recur.

`recommendations.perf.test.ts` seeds 20,000 cards with `upsertCards` and 2,000
combos with `insertCombos`, and then never creates a `dataset_snapshots` row.
So `liveSnapshotId` returned `null`, and `snapshot-cache.ts` opens with:

```ts
get: async (snapshotId, key, load) => {
  if (snapshotId === null) return load()
```

That bypass is deliberate and correct — caching against a null key would be
caching "we do not know when this changes" — but its consequence here is that
**the corpus cache was disabled for all 20 measured requests**. Every one of
them re-read the eligible pool, the combos and the whole printing-facts map:
the three reads `corpus-cache.ts` exists to stop, whose uncached versions moved
~86 MB per request and took a deployment down (ADR-0021). Production always has
a live snapshot and always takes the cached path.

The test was therefore defending the 200 ms budget against a request no user
issues, and the corpus-wave line in §1's table — 86–174 ms, second largest —
is largely an artefact of the test's own setup rather than a cost production
pays. A performance test whose premise is wrong is worse than no performance
test: it produces a number, the number gets quoted, and the quoting is what
makes it dangerous.

### Decision: write the snapshot the way the ingest writes it

```ts
const snapshotId = randomUUID()
await createSnapshot(db.pool, snapshotId, 'scryfall')
await setSnapshotCounts(db.pool, snapshotId, { cards: CORPUS, combos: COMBOS })
await promoteSnapshot(db.pool, snapshotId, 'scryfall')
```

That is the exact sequence `ingestScryfall` uses, and using it rather than a
hand-rolled `INSERT` is the point of the fix, not a stylistic preference. A row
the test wrote its own way could satisfy `liveSnapshotId` — it only needs
`source` and `is_live` — while differing from a real one in some way that
matters later. The test would then go green while production stayed uncached,
which is precisely the failure being repaired. `api-06.test.ts` already writes
its snapshot through these three calls; this makes two.

The single warm-up request now also fills the corpus cache, which is what a warm
production instance has. The cold read is the ingest's cost and is paid once.

## 4. What was refused

**Touching `BUDGET_MS`, `CORPUS`, `COMBOS`, `DECK_SIZE` or `RUNS`, or adding a
skip.** The test still exercises a 20,000-card corpus, 2,000 combos and a
100-card deck through a real `app.inject` request. Fixing a perf test by
loosening what it measures is the same defect as the one above wearing a
different hat.

**Aggregating the entries with `json_agg` instead of joining.** It avoids
repeating the deck's columns once per entry, which for a 100-card deck is 100
copies of `workspace`, `columns` and the two other `jsonb` columns. But it
returns `added_at` as a JSON string rather than a `Date`, moving a parse into
`toEntry` for a shape whose measured cost is already one round trip. The
duplication is bytes; bytes are not this request's problem (§1).

**Removing or changing `withTransaction`.** `getDeck` was its only read-only
caller. Every write path still needs it — `setEntryStandalone`, `applyBatch`,
`promoteSnapshot` and the migration runner — and `applyBatch`'s `FOR UPDATE`
version check is meaningless without one. The helper is untouched.

**Caching on a null snapshot id to make the old test fast.** The bypass is the
correct behaviour and the test was wrong about the world, not the cache. Fixing
the world the test builds is the fix; fixing the cache would have propagated the
test's mistake into production.

**Chasing `liveSnapshotId`'s own 36 ms in this change.** It is one round trip
for one small row, it is read first on purpose (it is the cache's freshness
key, so the other three reads cannot start until it is known), and it is a
single line rather than the three-round-trip surplus §2 removes.

## 5. Consequences

**The remaining round trips are visible and named.** After §2, `getDeck` is one
trip instead of four. `liveSnapshotId` is one. `getCards` for the deck's own
cards is one. The corpus wave, once §3's snapshot makes the cache engage, is one
trip on a cold instance and zero thereafter — **except `gameChangerOracleIds`,
which sits inside that same `Promise.all` and is not wrapped in a snapshot
cache at all.** It is corpus reference data with exactly the properties the
cache was built for, so it is a candidate for the same treatment. It is
deliberately not changed here: this ADR is two measured fixes, and a third
change with no measurement behind it would dilute both.

**The number in §1 is the pre-fix number.** No post-fix figure is recorded in
this ADR, because none was measured — see §6.

**`SELECT *` across a join is now a thing this repo has been bitten by.** The
aliasing in `decks.ts` carries a comment saying so at the point of use, because
the next person to write a join here will have the same instinct and the failure
is invisible to every test that checks a deck's name.

## 6. Testing, and what is NOT verified

**Not verified: no performance number in this change was measured.** The
worktree this was written in has no `.env.local`, so `DATABASE_URL` was unset
and the eight PostgreSQL suites — including `recommendations.perf.test.ts`
itself and `packages/db/src/db.test.ts`, which holds every test below — were
skipped under `LW_ALLOW_NO_DB=1`. `pnpm build`, `pnpm typecheck` (which covers
the test files through `tsconfig.tests.json`), `pnpm lint` and `pnpm test` all
pass, and 2,906 tests ran, but **none of the tests written for this ADR ran**,
and no claim is made here that the request now fits the 200 ms budget. The
152 ms and 38 ms figures in §2 and the stage table in §1 are the investigation's
measurements against the real database, taken before this change.

**Eight tests in `packages/db/src/db.test.ts`**, in a new
`reading the deck and its entries in one query` block. `getDeck` is on the path
of every deck route and this change rewrites its query, so the existing
`round-trips a deck` — which asserts a name, two commanders and a version — is
nowhere near enough:

| test | what it would catch |
| --- | --- |
| keeps the deck's own id, not an entry's | the `SELECT d.*, e.*` collision |
| round-trips every entry column through its alias | a mistyped or omitted alias |
| reads a NULL `role_override` as null, distinct from an empty list | narrowing on the wrong column |
| gives a deck with no entries an EMPTY list, not one row of nulls | the LEFT JOIN's all-NULL row |
| preserves entry order — insertion order, by entry id | a dropped or misplaced `ORDER BY e.id` |
| keeps duplicate copies as separate entries under the join | a join that collapses 34 Mountains |
| answers null for a deck that does not exist | — |
| answers null for a soft-deleted deck, entries or not | `deleted_at IS NULL` moved to the wrong side |

The soft-delete test asserts both directions: the deck has an entry, is
soft-deleted and reads `null`, and comes back whole with its entry on restore.
A soft-deleted deck still holds its entry rows, so a `deleted_at` filter on the
wrong side of the join would still return them.

The entry columns are written with a direct `INSERT` in one of these rather than
through `setEntry`, because `setEntry` never sets `role_override` — and
`role_override` is the column whose own legitimate NULL must not be confused
with the join's NULL.

No mutation table accompanies this ADR, for the same reason as the paragraph
above: a mutation check requires running the suite, and the suite cannot run in
this worktree. The tests are written to be run in the main checkout.
