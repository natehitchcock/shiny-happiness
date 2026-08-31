# ADR-0019 — `GET /api/v1/health` reports the applied schema version

- **Status:** accepted
- **Date:** 2026-08-30
- **Supersedes:** nothing
- **Relates to:** [doc 10 §10.1](../10-api-contract.md) (errors are RFC 9457),
  [ADR-0017](0017-combos-carry-only-what-scoring-reads.md) (why a DB read is
  expensive here), [DEPLOYING.md](../../DEPLOYING.md)

## Context

Production ran four migrations behind for weeks. It never returned an error.

`0006` adds `power` and `toughness`; `0005` adds the name-similarity index. With
neither applied, every creature rendered with no printed power or toughness and
fuzzy name search matched nothing. **A schema that is merely OLD serves nulls,
and a null reads as *absent* rather than as *broken*.** There was no `500` to
alert on, no log line, and nothing in any response that named the cause.

Diagnosing it required the production database credentials, a local checkout and
`pnpm --filter @roundtable/db migrate status`. That is a high bar for the
question "is this deployment current?", and it is a question anyone looking at a
site that renders slightly wrong needs to answer first.

Nothing the API already serves answers it. `GET /api/v1/decks` returning
`{"items":[]}` proves the function loaded, the pool opened and the schema exists
— DEPLOYING.md step 5 uses it for exactly that — but it says nothing about
*which* schema, and it is equally happy against one four versions old.

## Decision

**Add `GET /api/v1/health`**, unauthenticated, reporting the applied migration
head, the head this build ships, the shortfall between them, and whether a
corpus snapshot is live.

```ts
{
  status: 'ok' | 'degraded' | 'unavailable',
  schema:   { applied, expected, pending: string[], upToDate, detail? },
  corpus:   { loaded, snapshotId, cardCount, comboCount, ingestedAt },
  database: { reachable, code?, detail? }
}
```

A new endpoint is a contract addition, which is what this ADR records.

### It is cheap, because it will be polled

Three trivial queries and **no corpus read**: `to_regclass` plus a scan of
`schema_migrations` (a handful of rows), and one row from `dataset_snapshots`
found through its partial unique index. The card and combo counts come from that
row rather than from `count(*)` — not because a count would be wrong, but
because two sequential scans of 34k and 108k rows is load, not a check.

Nothing here touches `corpus-cache.ts`. That file exists because ~86 MB per
request exhausted a metered 5 GB monthly allowance in about sixty requests and
took the deployment down (ADR-0017); a health endpoint is the one route likely
to be hit on a timer, and it must not be the thing that recreates that.

### It never leaks a credential

The connection string is never read, never echoed, and never parsed for a host.
When the database is unreachable the response carries the driver's `code`
(`ENOTFOUND`, `28P01`, `3D000`) and the **names** of the Postgres-ish
environment variables that are set — the same technique, for the same reason, as
`serverless.ts`, where the usual cause of a misconfiguration is a near miss
(`POSTGRES_URL` set, `DATABASE_URL` not).

The driver's `message` is deliberately not passed through. It is more
informative and it is the single most likely place for a user name, a host or a
whole URL to escape into a public response. A short code plus a curated sentence
covers the causes that actually occur.

### The status code distinguishes "down" from "wrong"

- **`503`** when the database is unreachable. A monitor has to be able to alert
  on it, and a `200` that says `unavailable` in its body is a `200` to
  everything that watches status codes.
- **`200`** for `degraded` — schema behind, or no corpus loaded. The deployment
  *is* serving requests. Failing its health check would pull a working site out
  of a load balancer over a missing migration, which is worse than the missing
  migration. `upToDate: false` is the field to assert on.

### It is deliberately not RFC 9457

Doc 10 §10.1 says every error this API emits is a problem document, and every
other route obeys that. This one does not, because a problem document replaces
the body with `title`/`detail` — and here **the body is the diagnosis**. Losing
`schema` and `corpus` precisely when the deployment is broken would invert the
endpoint's purpose. The shape is identical in all three states, so an operator
who curls it always gets the same fields, some of them saying "unknown".

## Consequences

**DEPLOYING.md's troubleshooting section now points here first.** "Run
`migrate status` against production" stays, because it is still the fix — but it
needs credentials, and this endpoint does not.

**`schema.expected` can be `null`.** It is read from the `.sql` filenames on
disk, and on Vercel those files are only in the bundle if the tracer kept them.
An endpoint that threw because it could not find its own migrations would be a
worse outage than the one it diagnoses, so an unreadable directory degrades to
`expected: null` with a `detail` saying to compare `applied` against
`packages/db/migrations` in the deployed commit. `applied` — the number that
actually matters — comes from the database and is always available.

**A database with no schema at all reports `applied: null`, and the check does
not create one.** The runner's own `appliedVersions` does `CREATE TABLE IF NOT
EXISTS`; a health check must never perform DDL, because the missing schema is
the thing being diagnosed and a check that writes it changes its own answer.
`appliedMigrations` is the read-only variant.

**`MIGRATIONS_DIR` moved from `@roundtable/db/testing` to the package's main
entry.** Production code needed it, and importing the test harness to get a path
constant would have been the wrong seam. `testing.ts` re-exports it, so nothing
that already imported it there had to change.

## Alternatives considered

**Report the git SHA instead of the migration head.** It answers "which code" but
not "which schema", and the outage was a schema that lagged code that was
current. The two are independently wrong, and it is the schema half nothing else
could see.

**`count(*)` on `cards` and `combos` for the corpus figures.** More directly
true — it counts what is there rather than what ingest said it wrote. Rejected
on cost: see above. If the recorded counts and reality ever diverge, that is an
ingest bug worth its own check, not something to pay for on every poll.

**Cache the result for a few seconds.** The queries are trivial and the whole
value of the endpoint is that it reflects the database *now*. A cache would make
"I just ran the migration, is it live?" answer with the state from before it.

**Return `200` even when the database is unreachable, so the shape never varies.**
Tempting for consistency, and it makes the endpoint useless to every monitor
that reads status codes — which is most of them.

**Put it behind the device-id header.** There is no authentication in this app
(ADR-0014) and nothing here is a secret: the migration head is in the public
repository, and the corpus counts are published facts. Requiring a header would
add a step to a diagnosis without adding any protection.
