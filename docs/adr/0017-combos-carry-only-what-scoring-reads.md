# ADR-0017 — A combo read for scoring carries only what scoring reads

- **Status:** accepted
- **Date:** 2026-08-31
- **Supersedes:** nothing
- **Relates to:** [ADR-0010](0010-spellbook-terms.md) (Commander Spellbook terms),
  [doc 05 §5.8](../05-scoring-and-recommendations.md) (combo degree)

## Context

`Combo` was modelled on the Commander Spellbook record it comes from, so it
carries the human-readable explanation of how to execute the combo alongside the
machine-readable parts:

```ts
interface Combo {
  readonly id: ComboId
  readonly pieces: readonly OracleId[]
  readonly prerequisites: string
  readonly steps: readonly string[]
  readonly produces: readonly string[]
  readonly colorIdentity: readonly Color[]
}
```

Every recommendation and every analysis request builds a combo index over the
whole set. Measured against the real corpus — 108,046 combos — that read is
79.7 MB, and it breaks down like this:

| column | bytes | read by |
| --- | --- | --- |
| `steps` | 52.4 MB | **nothing** |
| `pieces` | 8.4 MB | combo degree, near-combos |
| `produces` | 7.7 MB | the API response |
| `prerequisites` | 4.9 MB | **nothing** |
| `color_identity` | 4.4 MB | **nothing** (see below) |
| `combo_id` | 1.9 MB | the API response |

`steps` and `prerequisites` are written by the ingest, mapped by the repository,
carried through the domain, and read by no scoring code, no route and no
component. They are two thirds of every combo read, and they have never been
displayed.

`colorIdentity` is read by nothing in the domain either, but it is the right
column to FILTER on — see below — so it stays in the table and simply stops
travelling.

This mattered enough to take the deployment down. On a metered managed Postgres
the per-request cost exhausted a 5 GB monthly transfer allowance in roughly sixty
requests, and the client issues a request on every filter change, every accept
and every auto-query tick.

## Decision

**`steps`, `prerequisites` and `colorIdentity` become optional on `Combo`, and
the scoring read stops selecting them.**

```ts
interface Combo {
  readonly id: ComboId
  readonly pieces: readonly OracleId[]
  readonly produces: readonly string[]
  /** Present only on a full read. Never used for scoring — see ADR-0017. */
  readonly prerequisites?: string
  readonly steps?: readonly string[]
  readonly colorIdentity?: readonly Color[]
}
```

Optional rather than deleted. The ingest still writes all three and the columns
stay in the table, because the data is genuinely useful — "here is how this
combo actually wins" is a feature worth having — and re-ingesting to recover a
dropped column is an hour of network for something we chose to throw away. What
changes is that they are no longer carried on a path that never looks at them.

**The colour filter reads `combos.color_identity` rather than joining `cards`.**
The first version of `combosInIdentity` derived the identity by joining every
piece to its card, because that is the rule the deck is built under (doc 03
§3.1) and it does not depend on trusting an upstream field. Checked against the
whole corpus at five identities — `{}`, `{R}`, `{U,B}`, `{R,W,B}` and `{WUBRG}` —
the stored column and the join agree on all 108,046 rows at every one of them,
with zero disagreements. Given that, the join is cost with no evidence behind
it, and the stored column can be indexed.

## Consequences

Per-request combo transfer, measured:

| | before | after |
| --- | --- | --- |
| all combos (5-colour deck) | 71.9 MB | 19.6 MB |
| mono-red | 71.9 MB | 0.5 MB |
| Mardu (`{R,W,B}`) | 71.9 MB | 4.6 MB |

With the warm-instance cache on top, a five-colour deck pays 19.6 MB once rather
than 71.9 MB per request.

**A future feature that wants to display steps must read the combo by id.** That
is the intended shape: showing the execution of one combo is a detail view of
one row, not something the scoring pass over a hundred thousand rows should
carry. `getCombo` is where that belongs.

**Optional fields mean a reader must handle `undefined`.** Nothing reads them
today, so nothing changes now; the type is the reminder that a combo from the
scoring path is a partial record. A reader that needs the full one should say so
by fetching it.

**A migration adds a GIN index on `combos.color_identity`.** Without it the
filter is a sequential scan over the table it is trying to avoid reading.

## Alternatives considered

**A separate `ScoringCombo` type.** Cleaner in the abstract — the scoring shape
and the full record are genuinely different things — but `ComboIndex` is built
from and hands back `Combo`, so a second type means changing `ComboIndex` too,
and every caller with it. Optional fields express the same fact ("this may be a
partial record") with one edit instead of a cascade.

**Leave the type alone and just narrow the SQL.** This is what the repository
did first, casting the trimmed rows back to `Combo` with empty strings for the
missing fields. It type-checks and it lies: a reader that trusted `steps` would
get `[]` and conclude the combo has no steps, which is a different and wrong
claim from "these were not fetched". `undefined` says the true thing.

**Drop the columns entirely.** Rejected: see above. The data is useful and
expensive to recover, and the cost being paid was transfer, not storage.
