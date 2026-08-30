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
    → Card & { printings: Printing[], combos: Combo[], stats?: CardStats }

POST /api/v1/cards/batch   { oracleIds: OracleId[] }
    → { items: Card[] }     ≤ 500 per call; the client hydrates grids with this.
```

## 10.3 Decks

```
POST   /api/v1/decks     { name, commanders, targetBracket, archetype,
                           archetypeSecondary? }                        → Deck
GET    /api/v1/decks/:id                                                → Deck
PATCH  /api/v1/decks/:id { name?, targetBracket?, archetype?,
                           archetypeSecondary?, budget?, status? }      → Deck
       Changing archetype moves targets only — it never adds or removes a
       card (doc 14 §14.4).
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
      counts: {
        total: number,
        byRole: Record<Role, number>,
        byType: Record<CardType, number>,
        byManaValue: number[]
      },
      targets: CompositionTarget[],
      deficits: Array<{ dimension: CompositionDimension, delta: number }>,
      archetype: {
        declared: ArchetypeKey,
        secondary: ArchetypeKey | null,
        assessed: ArchetypeKey,       // what the deck actually looks like
        confidence: number,           // 0..1
        drivers: CompositionDimension[]  // which dimensions drove the assessment
      },
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

## 10.6 Archetypes, brackets and core packages

```
GET /api/v1/archetypes                        → ArchetypeDefinition[]
GET /api/v1/archetypes/suggest?commander=<oracleId>
    → { items: Array<{ archetype, share: number, deckCount: number }>,
        suggested: ArchetypeKey, source: 'corpus' | 'default' }
```

`source: 'default'` means no statistics were available and `suggested` is
`midrange` — the UI must say so rather than implying a data-backed recommendation
(doc 14 §14.3).


```
GET /api/v1/brackets                          → BracketRules[]
GET /api/v1/brackets/:n/core?colors=WUBRG&commander=<oracleId>
    → { bracket, colors, cards: Array<{ oracleId, tier, inclusionRate }>,
        generatedAt, corpusSize }
```

## 10.7 Import / export

Full UI and format detail in [15-import-export.md](15-import-export.md).

```
POST /api/v1/import/preview   { text | file, targetDeckId? }
     → {
         detectedCommander: { oracleId, source: 'marker'|'section'|'inferred' }
                          | { candidates: OracleId[] }   // ask, never guess
         resolved: Array<{ line, oracleId, quantity, tags: string[] }>,
         unresolved: Array<{ line, text, reason, suggestions: OracleId[] }>,
         illegal: Array<{ line, oracleId, reason: 'color-identity'|'banned' }>,
         previouslyExcluded: OracleId[],   // in the list, but you removed them before
         canMerge: boolean                 // false when commanders differ
       }

POST /api/v1/import/commit    { previewToken, mode: 'new'|'merge',
                                skipLines: number[], includeIllegal: boolean }
     → { deck: Deck, applied: DeckCommand[] }

GET  /api/v1/decks/:id/export?format=text|moxfield|mtgo|csv|json
     → the formatted list; `json` alone round-trips losslessly
```

Preview and commit are separate calls: **nothing is applied until the user has
seen what will happen** (doc 15 §15.3). `unresolved` and `illegal` never block —
they are reported for in-place fixing, and `previouslyExcluded` exists so a merge
cannot silently resurrect a card the user removed (P6).

## 10.8 Rate limiting and errors

- Per-user limits on recommendation generation (it is the expensive endpoint);
  `429` with `Retry-After`.
- Upstream failure ⇒ **degrade, do not 500**. With no corpus statistics, return the groups
  that could be computed plus an `unavailable` entry. A `500` here would take the
  whole workspace down over an optional statistic.

## 10.9 Implementation status

This document is the target. Where the shipped API differs, it says so here —
silent divergence is forbidden (AGENTS.md §10) and the next agent reads this doc
as if it described running code.

**`API-01` (done)** implements §10.2, and from §10.3 the create / read / patch
endpoints and the batched command endpoint. It diverges in five places, each a
dependency that has not shipped rather than a disagreement with the contract:

1. **`409` returns an empty `since`.** The response carries the current `deck`,
   which is enough for a client to refetch and rebuild, but not the incremental
   command list §10.3 specifies. `since` needs an ordered per-deck command log
   keyed by version, and no table provides one. **`API-06` owns this** — it is
   listed there as "optimistic concurrency: `baseVersion`, `409` with `since`".

2. **`applyCorePackage` and `removeCorePackage` are always rejected**, with
   `reason.kind = 'unsupported'` naming the blocking task. Core packages need
   `ING-05` to generate them and `DATA-05` for the official bracket rules.
   Rejecting is deliberate: accepting the command and changing nothing would be
   the silent no-op AGENTS.md §1.4 forbids.

3. **`GET /cards/search` rejects query fields it cannot answer**, with `400` and
   the field name, rather than evaluating them against absent data. `combo`,
   `near`, `flag` and `group` are computed against a deck's accepted set and
   belong to the candidates endpoint in `API-02`; `price`, `rarity` and `set` are
   printing-level; `power` and `toughness` are not on the oracle row. Evaluating
   these against zeroed data would return an empty page that reads as "no cards
   match" rather than "this endpoint cannot answer that".

4. **Every deck belongs to one fixed development owner.** `API-03` owns auth and
   deck ownership. The owner is resolved in exactly one place (`DEV_OWNER_ID` in
   `routes/decks.ts`) so that adding auth is a change to a resolver, not a hunt
   for `owner_id` through the queries.

5. **`DELETE /decks/:id` and `POST /decks/:id/duplicate` are not implemented.**
   They appear in §10.3 for completeness, but soft delete, duplicate and archive
   are `API-05`'s definition of done, and one task per PR is the rule (AGENTS.md
   §6). The repository functions they need (`softDeleteDeck`, `restoreDeck`)
   already exist from `DB-01`.

### A clarification, not a divergence

§10.3 does not say what `accept` means for a card that is currently **excluded**.
The implementation splits it by origin, which is what pillar P6 actually
constrains:

- `origin: 'recommended'` on an excluded card is **rejected**
  (`reason.kind = 'previously-excluded'`). The recommender may not put back what
  the user threw out.
- any other origin **applies**, clearing the exclusion. P6 binds the recommender,
  not the user; a user who re-adds a card they excluded is not being
  re-suggested anything.

Without this split the rule is either toothless (the recommender re-adds excluded
cards) or wrong (the user cannot undo their own exclusion except via `restore`).

### Command semantics settled by review

These are not divergences; they are cases §10.3 left open, decided during the
`API-01` review and pinned by regression tests.

- **A commander cannot be excluded, locked or re-roled** (`reason.kind =
  'is-commander'`). Commanders are accepted by definition (doc 02 §2.3) and are
  not entries, so the entry-based guards cannot see them. Excluding one used to
  succeed and put the deck's most important card in `acceptedSet` and
  `excludedSet` simultaneously, breaking doc 02 §2.2 for every consumer
  downstream.
- **`restore` of an exclusion created earlier in the SAME batch is rejected**
  (`reason.kind = 'restore-of-batch-exclusion'`). Each command is valid alone,
  but the pair deletes every accepted copy and leaves nothing — an offline client
  coalescing an exclude-then-undo would silently lose 34 Mountains. `restore`
  means "excluded → absent", not "undo".
- **A batch that applies nothing does not bump `version`.** `Deck.version` is
  defined as "bumped server-side per accepted command batch"; bumping on an
  all-rejected batch invalidated every other client's `baseVersion`, moved
  `updatedAt` so the deck jumped up a `sort=updated` library, and rewrote every
  entry row for a no-op. Since `applyCorePackage` is rejected unconditionally
  today, that was the common path, not a corner case.
- **Only `accept` requires the card to be in the corpus.** `restore`, `lock` and
  `setRole` act on entries the deck already holds. Requiring corpus data stranded
  an exclusion permanently whenever an ingest swap dropped a card, and P6 would
  then suppress it forever if it returned under the same oracle id.
- **The idempotency receipt is written inside the batch transaction.** Written
  after the commit, a crash in the window left a deck that had moved with no key
  recording it — and the client's retry applied the whole batch a second time.
- **`GET /cards/search` also rejects `is:` predicates it cannot decide** —
  `is:reserved`, `is:gamechanger`, `is:reprint`, `is:firstprint`. These are
  values rather than fields, so the field guard did not catch them, and they were
  being answered from zeroed data. The negated form was the dangerous one:
  `-is:gamechanger` returned every Game Changer as though it were clean.
- **`?colors=` must be WUBRG letters.** An empty colour list is a *valid* filter
  meaning "colourless only", so quietly discarding unrecognised characters turned
  `?colors=Z` into a plausible page of colourless cards instead of an error.

### Known gaps, not yet addressed

1. **Idempotency keys are accepted only on `/commands`.** §10.1 says "idempotency
   keys on all mutations"; `POST /decks` and `PATCH /decks/:id` reject the field,
   so a retried deck creation makes two decks. Needs a decision on where the key
   belongs (body vs `Idempotency-Key` header) before it is worth implementing.
2. **`CommandContext.exceptions` is never populated**, so no deck can run
   Relentless Rats, Shadowborn Apostles, Persistent Petitioners or Nazgûl — every
   copy past the first is rejected `not-singleton`. The domain supports it; no
   table or config holds the list. Needs a data source.
3. **Commander eligibility is unvalidated.** `POST /decks` checks that the
   commanders exist and are not the same card twice, but nothing stores
   `canBeCommander` or `partnerRule`, so `validateDeck`'s commander checks cannot
   be fed and a non-legendary card can be a commander. Blocked on ingest.
4. **`/cards/search` scans the card table** for a selective query, since the
   domain predicate decides after SQL narrows. Fine at fixture scale, not at
   ~30k cards; `API-08` owns the precomputed histograms that fix it.

