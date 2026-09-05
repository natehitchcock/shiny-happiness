# ADR-0064 — A small read is not a cheap one, and a comment outlives the reason it was written for

**Status:** accepted
**Date:** 2026-09-05
**Relates to:** [ADR-0063](0063-the-cost-is-round-trips-not-scoring.md) (which
measured this path and named this read as the candidate — §5), and through it
[ADR-0017](0017-combos-carry-only-what-scoring-reads.md) and
[ADR-0021](0021-card-art-from-scryfalls-cdn.md), which are why `corpus-cache.ts`
exists at all.
**Changes:** one new cached read in `apps/api/src/corpus-cache.ts`, its call site
in `apps/api/src/deck-context.ts`, and the doc comment there that this makes
false. No schema change, no wire change, no change to the query being cached, and
no change to what the recommender scores or orders.

---

## 1. The defect

`gameChangerOracleIds` was the last uncached corpus read on the recommendation
hot path. It sat inside the same `Promise.all` as three reads that are cached:

```ts
const [eligible, combos, printingFacts, gameChangers] = await Promise.all([
  cachedEligibleCards(pool, deck.colorIdentity, deck.excludeUniversesBeyond, snapshotId),
  cachedCombosInIdentity(pool, deck.colorIdentity, snapshotId),
  cachedPrintingFacts(pool, snapshotId),
  gameChangerOracleIds(pool),   // ← one round trip, every request
])
```

So it cost a database round trip on every recommendation and every analysis
request — and the client issues a recommendation request on every filter change,
every accept and every auto-query tick.

**A `Promise.all` takes as long as its slowest member.** That is the whole shape
of this defect. On a warm instance the other three are served from memory in
microseconds, so the wave did not cost "three cached reads plus a small one"; it
cost exactly one uncached read. The three caches bought nothing for this wave
until the fourth joined them.

### The measurement, and where it comes from

**No new measurement was taken for this ADR.** The figures below are ADR-0063's,
taken against the real database before either change, and they are quoted rather
than re-derived. This worktree cannot reach a database at all (§6).

| stage | cost |
| --- | ---: |
| `getDeck` | 143–153 ms |
| `liveSnapshotId` | 36 ms |
| corpus wave (eligible + combos + printing facts + game changers) | 86–174 ms |
| `getCards` for the deck's own cards | 39–45 ms |
| `recommend()` — the actual scoring | **9–16 ms** |

One round trip is ~36 ms from that machine. Scoring — the thing this application
is for — is under 4% of a 381 ms request. That table is the entire argument here:
this path is priced per question asked, not per byte returned. ADR-0063 fixed the
first line and the test that had been measuring the third with the cache
switched off, and named this read in its §5 as a candidate it deliberately did
not touch, on the grounds that a third change with no measurement behind it
would dilute two that had one. This is that change, made separately, exactly as
that ADR intended.

**What this ADR does not claim:** that the request now fits API-02's 200 ms
budget. Removing one ~36 ms round trip from a 381 ms request does not, on its
own, and no post-change figure was measured (§6).

## 2. Decision: the same cache, keyed by nothing

```ts
/**
 * Not scoped by anything either — Wizards publish one list, so one entry.
 */
const gameChangers = createSnapshotCache<readonly OracleId[]>(1)
```

**One entry, following `cachedPrintingFacts`.** The other two caches hold four
identities each because what they return varies with the deck: colour identity
for combos, and colour identity plus the Universes Beyond flag for the eligible
pool. This one varies with nothing. The query is

```sql
SELECT oracle_id FROM cards WHERE game_changer
```

with no parameter to vary, so a second slot could only ever hold a duplicate of
the first. `MAX_IDENTITIES` would not have been wrong so much as meaningless, and
a bound that suggests a scoping which does not exist is a comment-shaped bug.

**Keyed on the snapshot id, so the bypass is inherited rather than reasoned
about again.** `snapshot-cache.ts` opens with `if (snapshotId === null) return
load()`, and that behaviour is load-bearing: a null snapshot means the corpus has
never been ingested, and caching against it would be caching "we do not know when
this changes". ADR-0063 §3 found a perf test that had accidentally been running
on that path for all 20 of its measured requests. Using the shared helper rather
than a module-level `let` is what makes the fourth read get that property for
free — the subtle parts of this cache are exactly the parts that rot when
duplicated, which is why it was written once and is now used four times.

**The list is a legitimate thing to invalidate on the snapshot, not just a
convenient key.** Wizards revise the Game Changers list, and when they do the
ingest is what brings the change in — the same event the snapshot id names. So
the key is not merely correct-by-inheritance; it describes when this data
actually changes.

**Returned `readonly OracleId[]`, where the repository returns `OracleId[]`.**
The array is now shared between requests by reference, and `snapshot-cache`'s
contract is that everything in it is treated as frozen. Every other cached value
is already a `readonly` array or a `ReadonlyMap` at the type level, which is what
makes that safe rather than merely intended. `DeckContext.gameChangers` was
already declared `readonly OracleId[]`, so nothing downstream changed.

**`clearCorpusCache` clears it too.** Trivial to write and easy to omit: a cache
missing from `clear` leaks one test's corpus into the next, and the suite is
where that helper's only callers are.

## 3. The comment that had gone false

`DeckContext.gameChangers` carried this:

> Not cached: it is a few dozen uuids behind a partial index, next to a combo
> read that can be 19.6 MB.

It was true when written and it is worth saying why it stopped being true,
because the mistake is a reusable one. The argument was *relative*: this read is
small compared to the thing next to it. What retired it was not this change but
ADR-0017's and ADR-0021's — once the 19.6 MB combo read is served from memory,
what is left of it on a warm instance is zero round trips, and this read was one.
The comparison did not become wrong; its subject was removed. **A justification
that names another line of code as its baseline expires when that line changes,
and nothing makes it announce that it has.**

It is rewritten to state what is true now and why the reasoning moved, rather
than deleted. A comment that contradicts the code beside it is worse than the
round trip was: the round trip cost 36 ms, and a false comment costs the next
reader their trust in every other comment in the file.

The header of `corpus-cache.ts` gets the same treatment in reverse. It opens
"The three corpus reads that dominate this API's data transfer", and that
sentence is still true — the fourth does not belong on that list and never
will. So it is not edited to say "four". A short section is appended saying that
the fourth is here for a different reason: size selected the first three, and
round trips selected this one.

## 4. What was refused

**Changing the query.** `gameChangerOracleIds` reads the whole list rather than
the deck's intersection with it, deliberately: `loadBracketRules` needs the set
in order to tell an un-ingested corpus (empty) from a deck that simply has no
Game Changers in it, and those two look identical if you fetch only the matches.
It is untouched, and the repository is unaware it is being cached.

**Scoping the cache by anything.** Considered and rejected above. Also refused:
using `MAX_IDENTITIES` for it "for consistency". The consistency worth having is
that each cache states its own bound and why, which is how `cachedPrintingFacts`
already reads.

**Caching it inside `packages/db`.** The repository is the wrong altitude for a
policy that depends on the snapshot id, and the snapshot id is an API-level
concern. `corpus-cache.ts` is where every other read of this shape lives, and one
cache in a second place is how two invalidation policies get born.

**Folding it into `cachedPrintingFacts` to save the round trip without a fourth
cache.** Both are corpus-wide, both hold one entry, and one combined query would
have removed the trip too. But `/cards/batch` and the card detail route read the
facts map without wanting the Game Changers list, and a joint read would make
every one of those pay for a column they do not use — trading this defect for a
smaller copy of it on a different path.

**Reporting a performance number.** None was measured; see §6. ADR-0063's §3 is
the standing lesson here: a performance number that gets quoted is dangerous in
proportion to how little was done to earn it.

## 5. Consequences

**The corpus wave is now zero round trips on a warm instance.** Every read in
`loadDeckContext`'s `Promise.all` is cached, so the wave costs nothing after the
first request on an instance, and ADR-0063's list of remaining round trips is
down to `liveSnapshotId` (one, read first on purpose, because it is the cache's
freshness key) and `getCards` for the deck's own cards (one).

**`getCards` is now the visible next candidate**, and it is not the same kind of
problem: it is scoped to one deck's oracle ids, so it is not corpus reference
data and this cache does not apply to it. Left alone here.

**A first-request cost that was already there is now slightly larger.** A cold
instance pays this read once per snapshot instead of once per request. That is
the trade the other three already made.

## 6. Testing, and what is NOT verified

**Not verified: no performance number in this change was measured, and the
PostgreSQL suites did not run.** The worktree has no `.env.local` — it is
gitignored and lives only in the main checkout — so `DATABASE_URL` was unset and
the eight Postgres suites were skipped under `LW_ALLOW_NO_DB=1`, including
`apps/api/src/recommendations.perf.test.ts`, which is the only test that would
show the effect of this change end to end. The stage table in §1 is inherited
from ADR-0063 and was taken before that ADR's own fixes landed. No claim is made
here about the request's current median.

The seven tests below are `apps/api/src/corpus-cache.test.ts`, which mocks
`@roundtable/db` and needs no database. **They ran and they pass.**

**Seven tests in a new `the Game Changers list` block**, following the shape the
other three reads already have in that file — the loader is a `vi.fn()` and the
assertion is on how many times it was called, because "how many times does this
read" is the behaviour under test rather than an implementation detail:

| test | what it would catch |
| --- | --- |
| reads once however many times it is asked | the cache not being wired up at all |
| returns the same ids on a hit as on the read | a hit that serves something other than what was loaded |
| re-reads once the ingest has written, and serves the new list | a key that ignores the snapshot, serving a stale list forever |
| never caches against an unknown snapshot | the null bypass being lost |
| does not serve a null-snapshot read to a later real snapshot | a null read poisoning the first real snapshot |
| is emptied by `clearCorpusCache` | the omission from `clear` — one test's corpus leaking into the next |
| does not hand out the printing facts cache's entry | these two sharing a Map: both are unscoped and both key on `'all'` |

The last one is asserted on the **data**, not on call counts, for the same reason
its sibling test for the combo and pool caches is: call counts pass either way
when two caches happen to use different key shapes. These two do not — they use
the identical key `'all'` — so a single shared Map would return a printing-facts
map where a list of oracle ids was expected, and only an assertion on what came
back can see it.

**Both were checked by mutation**, per the working agreement in AGENTS.md §9:

- Deleting `gameChangers.clear()` from `clearCorpusCache` fails three tests, not
  one — the two that follow it in the file inherit the leak through
  `beforeEach`, which is precisely the failure mode being pinned.
- Replacing `snapshotId` with a constant key fails the three tests that pin
  invalidation and the null bypass.

Before that, all seven were watched failing with `cachedGameChangerOracleIds is
not a function`, with the file's 19 existing tests still green.
