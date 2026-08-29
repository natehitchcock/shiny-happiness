# 10. API contract

The seam between `apps/web` and `apps/api`. Request and response types are
**generated from `packages/domain`** — they are not hand-maintained parallel
definitions. Fastify validates with JSON Schema derived from the same source.

This document is the interface agents build against. Changing a shape here is a
breaking change and needs an ADR plus a note in the work-breakdown task.

## 10.1 Conventions

- Base path `/api/v1`. Version in the path; never break v1 in place.
- All responses `application/json`. Errors follow RFC 9457 `application/problem+json`.
- Every recommendation-bearing response carries `datasetSnapshotId` for
  reproducibility (doc 09 §9.6).
- Cursor pagination: `?cursor=&limit=` → `{ items, nextCursor }`. No offsets.
- Idempotency keys on all mutations, so the optimistic-offline client (doc 08 §8.5)
  can safely retry.

## 10.2 Cards

```
GET /api/v1/cards/search?q=&colors=&limit=&cursor=
    → { items: Card[], nextCursor }
    q uses Scryfall-like syntax; parsing lives in packages/domain.

GET /api/v1/cards/:oracleId
    → Card & { printings: Printing[], combos: Combo[], edhrec?: CardStats }

POST /api/v1/cards/batch   { oracleIds: OracleId[] }
    → { items: Card[] }     ≤ 500 per call; the client hydrates grids with this.
```

## 10.3 Decks

```
POST   /api/v1/decks     { name, commanders, targetBracket }            → Deck
GET    /api/v1/decks/:id                                                → Deck
PATCH  /api/v1/decks/:id { name?, targetBracket?, budget?, status? }    → Deck
DELETE /api/v1/decks/:id                       soft delete, 30-day recovery
POST   /api/v1/decks/:id/duplicate  { name? }  → Deck   full copy: entries,
                                                        origins, exclusions, locks
```

### Library (doc 12 §12.3, §12.4)

```
GET /api/v1/decks
    ?status=active|archived|all      default active
    &sort=lastOpened|updated|name|completion
    &colors=&bracket=&q=&cursor=&limit=
    → { items: DeckSummary[], nextCursor }
```

`DeckSummary` never loads entries — it is the list projection (doc 12 §12.2), and
the switcher and library both render from it alone. Loading 12 full decks to draw
a menu is the mistake this type exists to prevent.

```
GET /api/v1/decks/recent?limit=5   → { items: DeckSummary[] }
```

Backs the deck switcher. Ordered by `lastOpenedAt`, active only. Prefetched on
app load; the switcher must never wait on a request to open.

### Workspace state (doc 12 §12.6)

```
PUT /api/v1/decks/:id/workspace   { ...WorkspaceState }   → 204
```

Debounced client-side (~2 s), fire-and-forget. A failure here is never surfaced
and never blocks a deck mutation.

### Snapshots (doc 12 §12.8)

```
GET  /api/v1/decks/:id/snapshots                  → { items: SnapshotSummary[] }
POST /api/v1/decks/:id/snapshots  { label }       → SnapshotSummary
POST /api/v1/decks/:id/snapshots/:sid/restore     → Deck
     Snapshots the current state first, so restore is itself undoable.
```

### Entry mutations

One endpoint, a batch of typed commands. Batching matters: applying a core package
is ~24 changes and must be a single undoable, atomic unit (doc 06 §6.6).

```
POST /api/v1/decks/:id/commands
  { commands: DeckCommand[], idempotencyKey: string, baseVersion: number }
  → 200 { deck: Deck, applied: DeckCommand[], rejected: RejectedCommand[] }
  → 409 { deck: Deck, since: DeckCommand[] }   baseVersion is stale; the client
        replays its queue against `deck` and re-sends (doc 12 §12.7)

type DeckCommand =
  | { type: 'accept';   oracleId; origin: Origin; lock?: boolean }
  | { type: 'exclude';  oracleId }
  | { type: 'restore';  oracleId }          // excluded → absent (candidate again)
  | { type: 'lock';     oracleId; locked: boolean }
  | { type: 'setRole';  oracleId; roles: Role[] }
  | { type: 'applyCorePackage';  bracket: Bracket }
  | { type: 'removeCorePackage'; bracket: Bracket }
```

Partial success is explicit: `rejected` names each failed command and why (colour
identity, singleton, already excluded). The client does not have to guess.

## 10.4 Recommendations

The main event.

```
POST /api/v1/decks/:id/recommendations
  {
    groups?: CandidateGroupKey[],   // omit for all
    limitPerGroup?: number,         // default 60
    query?: string,                 // candidate query, doc 13
    weights?: Partial<ScoringWeights>
  }
  →
  {
    datasetSnapshotId: string,
    generatedAt: string,
    groups: Array<{
      key: CandidateGroupKey,
      label: string,
      rationale: string,
      total: number,                // before limitPerGroup
      items: Recommendation[]       // ordered; see doc 05 §5.6
    }>,
    unavailable: Array<{ key: CandidateGroupKey, reason: string }>,
    query?: {
      matched: number,              // pool size after the filter
      total: number,                // pool size before it
      withheldByGroup: Record<CandidateGroupKey, number>,
      errors: QueryParseError[]     // non-empty ⇒ query NOT applied, see below
    }
  }
```

`withheldByGroup` is what lets a group say *"+3 more complete 3+ combos but don't
match your filter"* (doc 13 §13.1). A group that withheld cards and does not report
it is a bug.

**A query that fails to parse is never partially applied.** `errors` is returned
with the *unfiltered* result and the UI underlines the bad token. Applying the
half of a query that happened to parse would produce a wrong answer that looks
right.

`unavailable` is how degradation is communicated (doc 05 §5.3) — a group that
could not be computed is reported, never silently omitted.

```
GET /api/v1/decks/:id/combo-index
    → { comboDegreeByOracleId: Record<OracleId, number>, snapshotId }
```

Lets the client run local incremental patches (doc 09 §9.4) without shipping the
whole combo database to the phone.

### Query support

```
POST /api/v1/query/validate   { query }
     → { ok: true, canonical: string, describe: string, estimatedMatches: number }
     → { ok: false, errors: QueryParseError[] }   { position, length, message, suggestion }

GET  /api/v1/query/suggest?prefix=&field=&deckId=
     → { items: Array<{ insert: string, label: string, hint: string, count: number }> }
```

`suggest` backs autocomplete: field names when no `field` is given, values from
the corpus otherwise, each with a match count so a useless term is visible before
it is committed to. Counts come from precomputed histograms, not live queries.

## 10.5 Analysis

```
GET /api/v1/decks/:id/analysis
  → {
      counts: { total, byRole: Record<Role, number>, byManaValue: number[] },
      targets: CompositionTarget[],
      deficits: Array<{ role: Role, delta: number }>,
      curve: { averageManaValue: number, histogram: number[] },
      colorBalance: { pips: Record<Color, number>, sources: Record<Color, number> },
      bracket: {
        target: Bracket,
        assessed: Bracket,          // what the deck actually looks like
        violations: BracketViolation[]
      },
      deckCombos: Array<{ comboId, pieces: OracleId[], produces: ComboResult[] }>,
      legality: { legal: boolean, problems: LegalityProblem[] }
    }
```

`assessed` vs `target` is worth having: telling someone "you said Bracket 2 but
this reads as a 3" is more useful than a pass/fail, and it is the honest framing
for a social power-level system.

## 10.6 Brackets and core packages

```
GET /api/v1/brackets                          → BracketRules[]
GET /api/v1/brackets/:n/core?colors=WUBRG&commander=<oracleId>
    → { bracket, colors, cards: Array<{ oracleId, tier, inclusionRate }>,
        generatedAt, corpusSize }
```

## 10.7 Import / export

```
POST /api/v1/import/text   { text: string }
     → { deck: ImportedDeck, unresolved: Array<{ line, reason }> }

POST /api/v1/import/url    { url: string }
     → 501 NotImplemented for Moxfield, with an explanatory problem document
       pointing at text import (doc 04 §4.4).

GET  /api/v1/decks/:id/export?format=text|json|csv
```

`unresolved` never blocks an import: bring in what parsed, list what did not, let
the user fix it in place.

## 10.8 Rate limiting and errors

- Per-user limits on recommendation generation (it is the expensive endpoint);
  `429` with `Retry-After`.
- Upstream failure ⇒ **degrade, do not 500**. If EDHREC is down, return the groups
  that could be computed plus an `unavailable` entry. A `500` here would take the
  whole workspace down over an optional statistic.
