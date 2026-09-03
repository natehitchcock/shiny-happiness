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
    → { items: Card[], images: ImageMap, nextCursor }
    q uses Scryfall-like syntax; parsing lives in packages/domain.

GET /api/v1/cards/:oracleId
    → Card & { printings: Printing[], combos: Combo[], stats?: CardStats,
               impact: CardImpact, efficiency: CardEfficiency }
    impact and efficiency are card-intrinsic (doc 18) and computed from the
    card the response already carries, so they add no query and no cache.

POST /api/v1/cards/batch   { oracleIds: OracleId[] }
    → { items: Card[], prices: PriceMap, images: ImageMap }
      ≤ 500 per call; the client hydrates grids with this.
```

**Printing-level facts ride BESIDE the cards, never on them.** A `Card` is
oracle identity (doc 02 §2.1); a price and an image belong to a printing of it,
so each is its own map keyed by oracle id:

```
PriceMap = Record<OracleId, number | null>          cheapest printing, an estimate (ADR-0009 Q7)
ImageMap = Record<OracleId, { artCrop: string | null; normal: string | null
                              back?: { artCrop: string | null
                                       normal: string | null } }>
                                                    default printing (ADR-0021, ADR-0027)
```

`artCrop` and `normal` are the **front** face, which is the card: the side that
enters the battlefield, the side Scryfall names and sorts by, and the side a
tile, the detail panel and the deck-web crop draw. That has not changed and does
not change.

`back` is the other physical face, added by
[ADR-0027](adr/0027-the-back-face-rides-beside-the-front.md) so a flip control
has something to show. It is **optional, and its absence is information**:

| `back` | Meaning |
| --- | --- |
| absent | The card has one physical face. Most cards. Draw no flip affordance. |
| present, URLs set | Two faces, art resolved. Draw the affordance and the picture. |
| present, both null | Two faces, art unresolved. Draw the affordance over the no-art panel. |

The last two rows are why this is optional rather than always-present-and-
nullable: "no second side" and "second side, no picture" are different answers,
and collapsing them leaves a client unable to decide whether to offer the flip.
It is also what keeps the payload flat for the 98.5% of cards with nothing to
say, on a route the client calls at least twice per user action.

Card detail carries the same fact one level down, as an optional
`backImageUris` on each `Printing` it already sends, on the same terms — absent
for a single-faced printing, `''` inside a present pair for unresolved art
(printings spell absent art `''`, the maps spell it `null`).

Both are new **optional** fields: a client built before them ignores them, and a
server built before them sends nothing where they would be.

Both maps carry an entry for **every id the caller asked about**, including ids
the corpus does not know and cards whose default printing has no art URL. A
missing key and a null value would otherwise be the same thing on the wire, and
"not loaded yet" is a different answer from "there is none".

The art-less case was 501 cards until the double-faced art fix, which was a
mapping defect rather than a gap in Scryfall's pictures (doc 17 §17.2); after
the next ingest it is none. The null stays in the contract regardless — a
printing whose art has not been resolved is a real state, and collapsing it into
an absent key is what put a broken image on screen before.

The image URLs are Scryfall's own CDN, sent through unaltered
([ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md)). `search` returns art for
the page it returns, not for everything the scan touched.

## 10.3 Decks

```
POST   /api/v1/decks     { name, commanders, targetBracket, archetype,
                           archetypeSecondary?, semanticEmphasis?,
                           columns? }                                   → Deck
       semanticEmphasis is accepted at CREATION because that is when the
       builder is asked: the start screen offers the chosen commander's own
       semantics before the deck exists. It is not validated against the
       commander's tags — a deck may legitimately be built toward something
       its commander does not do — and coverage is reported instead.
GET    /api/v1/decks/:id                                                → Deck
PATCH  /api/v1/decks/:id { name?, targetBracket?, archetype?,
                           archetypeSecondary?, budget?, status?,
                           targetOverrides?, semanticEmphasis?,
                           columns? }                                   → Deck
       Changing archetype moves targets only — it never adds or removes a
       card (doc 14 §14.4), and it does NOT clear targetOverrides
       (doc 16 §16.9).
       targetOverrides is REPLACED WHOLESALE, never merged: the object is
       small and the client always holds all of it, and a merge could not
       express a deletion — "reset ramp" and "leave ramp alone" are both
       an absent key. `null` and `{}` both clear it, which is the way back
       to the archetype.
       semanticEmphasis is replaced wholesale for the same reason, and that
       IS the de-emphasise control: removing a tag is sending the same array
       one shorter, and `null` or `[]` clears the focus. There is no add or
       remove verb, so an emphasis that cannot be taken off is not
       representable. Members must be SynergyTags; an unknown one is a 400.
       Stored and returned in canonical `SYNERGY_TAGS` order, not click
       order, so the same set always serialises identically (doc 05).
       columns is `DeckColumn[] | null` and is THE ONE FIELD ON THIS BODY
       WHERE NULL AND [] DIFFER (doc 18 §18.7). A column is either
       { kind: 'query', query } or { kind: 'metric', metric } — the tag is
       what stops a builder who searches for the word `impact` getting the
       impact metric instead. null (or absent, on a new deck) means "never
       set: draw DEFAULT_COLUMNS", which is what `null` means on the two
       fields above too — clear my customisation. [] means "I removed them
       all", and it must survive: columns that come back after being cleared
       have not been cleared. Replaced wholesale, like the two above.
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
  → 409 { deck: Deck,
          since: DeckCommand[],              // what was accepted after baseVersion
          sinceBatches?: DeckCommandBatch[], // the same, grouped by version
          sinceComplete?: boolean            // false ⇒ refetch, do not replay
        }
        baseVersion is stale; the client rebases its queue onto `since` and
        re-sends (doc 12 §12.7)

type DeckCommandBatch = { version: number, appliedAt: string, commands: DeckCommand[] }
```

`since` is flat and ordered oldest-first — the applied commands only, never the
rejected ones. `sinceBatches` is that same data grouped as the server applied
it, one entry per version, each carrying the wall clock doc 12 §12.7's conflict
rule compares against; a bare `DeckCommand` has no timestamp, which is the gap
it closes.

**`sinceComplete` must not be ignored.** `false` means the log does not cover
the whole gap between `baseVersion` and `deck.version`, so `since` is a partial
account of it and the client must refetch rather than rebase — dropping a queued
command on the strength of history the server could not supply would drop work
the user did. Absent reads the same as `false`. Both new fields are optional so
a client written against the earlier contract still typechecks; the server
always sends them (ADR-0018).

```
type DeckCommand =
  | { type: 'accept';   oracleId; origin: Origin; lock?: boolean }
  | { type: 'remove';   oracleId }          // one copy; still suggestible
  | { type: 'exclude';  oracleId }          // all copies; never suggested (P6)
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
    columns?: string[],             // query columns only, doc 18 §18.7
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
                                    // up to limitPerGroup + 3, see below
    }>,
    unavailable: Array<{ key: CandidateGroupKey, reason: string }>,
    // The deck's emphasis and how far it reaches. `[]` when there is none.
    emphasis: Array<{ tag: SynergyTag, supporting: number }>,
    // The same count for EVERY tag, in SYNERGY_TAGS order. One entry per tag.
    tagSupport: Array<{ tag: SynergyTag, supporting: number }>,
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

**Every `Recommendation` carries `impact` and `efficiency`** (doc 18 §18.8).
They are card-intrinsic, so they are the same in every deck, and they sit
BESIDE `reasons` rather than inside it: a `Reason` answers "why was this
suggested to *me*", and a claim that is true of the card in every deck that has
ever existed answers nothing about the suggestion. `reasons` stays a non-empty
tuple of deck-relative claims, which is what pillar P4's guarantee actually is.

**`columns` on the request carries QUERY columns only.** A deck's saved columns
are a mixed list of query and metric columns (doc 18 §18.7), but a metric column
needs no server evaluation — its number is already on the row — so the client
sends `queryColumns(deck.columns)` and reads the metrics off the items. The
response's `columns: [{ query, matched }]` is unchanged.

`emphasis` is the same discipline one level down. Emphasis reorders and **never
filters**, so a deck that emphasises a tag nothing in its colours supports gets
back a completely normal list — indistinguishable, on its own, from an emphasis
that worked. `supporting` is the count of eligible candidates carrying that tag,
before the query filter, so `0` lets the client say *"nothing in your colours
produces or wants landfall"* rather than leaving the builder to wonder why their
click did nothing.

`tagSupport` is that same count for the whole vocabulary rather than the
emphasised few, and it exists because the client offers the semantics **related
to** a chosen focus and has to rank them. Those are by definition tags the deck
does *not* emphasise, so `emphasis` is structurally unable to reach them; with
no ranking the offer leads with whichever tag sorts first, including one nothing
in the deck's colours supports. Every tag appears, **including at zero** —
omitting the zeroes would make *"counted, and it was nothing"* indistinguishable
on the wire from *"not counted"*, and the client orders those two differently.
It is emphasis-independent by construction (the counts run over eligible
candidates, and emphasis never changes eligibility), which is what lets the
client hold it across a focus save instead of blanking it.

**`items` may be up to three longer than `limitPerGroup`** when the deck has a
focus ([ADR-0026](adr/0026-a-focus-guarantees-its-top-three-in-every-category.md)).
Scoring only orders *within* a group, so a card supporting the builder's focus
could sort below the cut and never appear in that category at all. Each group
therefore carries the top three supporters of the focus that the cut would have
dropped, appended after the cut — which is also their score position, since
being below the cut is why they are here. The list **extends**; it never
displaces, because emphasis removing a suggestion is the one thing it promises
not to do. `total` is unchanged: those cards were always members, they were
merely not shown.

Those rows carry `guaranteed: true` on their `keyword-synergy` reason, which is
a different claim from `emphasised: true` — the latter is true of every
supporter in the list, the former says this row scores below the cut and is
shown anyway. A client that truncates group rows again on its own must not
truncate these away, or the guarantee stops at the server.

The guarantee reaches past the **cut**, never past the **filter**: an excluded
card is not a candidate at all (P6), and a card withheld by `query` stays
withheld.

**A `keyword-synergy` reason may also carry `qualifier`**, a rendered phrase
naming what the deck's want is RESTRICTED to — `"noncreature, costing 3 or
more"` ([ADR-0057](adr/0057-a-want-says-which-event-a-qualifier-says-which-cards.md)).
Pillar P4 bounds the sentence by the check behind it: "enables your casting
spells" was a claim about every instant in the deck, and a deck led by Y'shtola
only pays off a noncreature spell costing three or more. Optional, and absent is
the commoner case — the deck wants the tag unconditionally and the existing
sentence already describes it. Sent **only on `direction: "enables"`**, the one
direction the matcher evaluates a qualifier in, and only when every wanter of
that tag is qualified and they agree; where they do not, the wider-but-true
sentence stands. Words rather than the structure, because it is a modifier on a
phrase the client's own tag table owns.

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
      // COUNTED OVER ACCEPTED COPIES (ADR-0034) — twenty Mountains are twenty
      // lands, and `total` is the deck's card count, not its distinct-card
      // count. This block iterated `acceptedSet`, a Set of oracle ids, until
      // ADR-0034; every field below was a distinct-card count on any deck
      // holding a repeat. `byManaValue` still excludes lands, so it moves only
      // for a deck running several copies of one SPELL.
      counts: {
        total: number,
        byRole: Record<Role, number>,
        byType: Record<CardType, number>,
        byManaValue: number[]
      },
      // Each target additionally carries `locked`, `actual`, and — since
      // doc 16 — `source: 'archetype' | 'custom'` and `preset: number | null`.
      // `preset` is what the archetype wanted, whether or not it was
      // overridden; `null` where the archetype names no such dimension at all,
      // which is not the same claim as 0.
      targets: CompositionTarget[],
      // The deck's own sparse overrides, echoed back for the customiser sheet.
      targetOverrides: TargetOverrides,
      // The semantics the builder said the deck is about, echoed the same way.
      // A SEPARATE key, because it is a separate axis: targets say how many
      // ramp cards the deck should hold, emphasis says which of two ramp cards
      // to offer first, and a deck may have opinions about both.
      semanticEmphasis: SynergyTag[],
      deficits: Array<{ dimension: CompositionDimension, delta: number }>,
      archetype: {
        declared: ArchetypeKey,
        secondary: ArchetypeKey | null,
        assessed: ArchetypeKey,       // what the deck actually looks like
        confidence: number,           // 0..1
        drivers: CompositionDimension[]  // which dimensions drove the assessment
      },
      // `target` bands carry `source` per bucket; `preset` is the archetype's
      // own shape, equal to `target` for a deck that overrode nothing (doc 16).
      curve: { averageManaValue: number, histogram: number[],
               target: CurveBand[], preset: CurveBand[],
               deltas: CurveDelta[], locked: number[] },
      // What the deck IS and what the deck MAKES (ADR-0024). Two records, both
      // counted over accepted COPIES — twelve Mountains are twelve — and both
      // carrying colourless, which the single chart these replaced had no key
      // for at all.
      //
      // `identity` is one bucket per card, keyed `W U B R G M C` (`M` = two or
      // more colours, `C` = none). Mutually exclusive, so it sums to `cards`.
      // `generation` reads `producedMana`, NOT `colorIdentity`, and counts a
      // card once per kind of mana it makes — so a Command Tower is in five of
      // its slices and it sums to more than `producers`.
      colorBalance: { identity: Record<IdentityBucket, number>,
                      generation: Record<ManaLetter, number>,
                      cards: number, producers: number },
      bracket: {
        target: Bracket,
        assessed: Bracket | null,   // what the deck actually looks like; null
                                    // until every barometer has a rule (ADR-0018)
        violations: BracketViolation[],
        gameChangers: OracleId[],   // the deck's cards on Wizards' list
        // OUR count of the three barometers Wizards names and never quantifies
        // (ADR-0018), over this deck's own cards and assembled combos. A
        // separate key from `violations` and never merged with it: a violation
        // is Wizards' published rule broken, a finding is what this deck holds
        // and no bracket permits or forbids it.
        //
        // `basis` is the sentence that says exactly that, and it travels with
        // the findings rather than living in a client constant — a client that
        // forgot it would turn our count into Wizards' ruling. Sent whether or
        // not there are findings, so a deck with none can still say what was
        // looked for. `severity` is `'warn' | 'error'` and is our reading, not
        // the format's. Reported identically at every target bracket: gating
        // them would re-create the per-bracket table the 2025-10-21 update
        // retired.
        barometers: {
          basis: string,
          findings: Array<{ barometer: 'two-card-infinites' | 'extra-turns'
                                     | 'mass-land-denial',
                            severity: 'warn' | 'error',
                            count: number,
                            cards: OracleId[],   // the deck's cards behind it
                            combos: ComboId[],   // two-card infinites only
                            message: string }>
        },
        rules: { sourceUrl: string, retrievedAt: string,
                 // The TARGET bracket's published entry, whole. `violations`
                 // names the allowance only when the deck breaks it, and the
                 // four nulls are what lets a client say "the format publishes
                 // no rule here" instead of naming the barometers itself.
                 targetBracket: BracketRules | null } | null
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

## 10.7a Health

```
GET /api/v1/health
  → 200 { status: 'ok' | 'degraded',
          schema:   { applied: string | null, expected: string | null,
                      pending: string[], upToDate: boolean, detail?: string },
          corpus:   { loaded: boolean, snapshotId: string | null,
                      cardCount: number | null, comboCount: number | null,
                      ingestedAt: string | null },
          database: { reachable: true } }
  → 503 the same document, with status: 'unavailable' and
        database: { reachable: false, code?: string, detail?: string }
```

What a deployment is actually running (ADR-0019). It exists because a schema
four migrations behind serves **nulls, not errors** — creatures with no power or
toughness, fuzzy search matching nothing — and nothing else the API serves names
that cause.

- `503` only when the database is unreachable, so a monitor can alert on it.
  `degraded` — behind on migrations, or no corpus loaded — is a `200`, because
  the deployment is serving and pulling it out of a load balancer would be worse
  than the missing migration. Assert on `upToDate`, not on the status code.
- **Deliberately not RFC 9457**, unlike every other error here (§10.1): a
  problem document would replace the body, and on this endpoint the body *is*
  the diagnosis. The shape is identical in all three states.
- Cheap enough to poll: three trivial queries, no corpus read, no cache.
- Never carries a connection string, a host, a user name or a driver message —
  only a short driver `code` and the *names* of the Postgres-ish environment
  variables that are set.

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

1. ~~**`409` returns an empty `since`.**~~ **Closed by `API-06`.** Migration
   `0012` adds `deck_command_log`, the ordered per-deck log keyed by version
   this needed, and the `409` now carries the real `since` plus `sinceBatches`
   and `sinceComplete` (§10.3, ADR-0018). One thing to know: a deck that was
   edited before `0012` has version bumps with no log rows, and reports
   `sinceComplete: false` until its history catches up — which degrades to the
   old refetch-and-rebuild behaviour rather than to a wrong one.

2. **`applyCorePackage` and `removeCorePackage` are always rejected**, with
   `reason.kind = 'unsupported'` naming the blocking task. Core packages need
   `ING-05` to generate them; the bracket rules they also need now exist
   ([ADR-0018](adr/0018-bracket-rules-and-game-changers.md)).
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
3. **Commander PARTNERSHIP is unvalidated.** `POST /decks` now refuses a card
   that cannot be a commander — `cards.can_be_commander` is stored at ingest —
   but nothing stores `partnerRule`, so whether two commanders may be paired is
   not checked. `partner with` names another card by NAME and the mapper cannot
   resolve that to an oracle id, so each commander of a pair is validated on its
   own and the gap is named in `unavailable`. A Background is accepted as a
   commander in its own right for the same reason.
4. **`/cards/search` scans the card table** for a selective query, since the
   domain predicate decides after SQL narrows. Fine at fixture scale, not at
   ~30k cards; `API-08` owns the precomputed histograms that fix it.

### `API-02` divergences

1. **`datasetSnapshotId` may be `null`.** §10.4 types it as a string. No ingest
   has run, so no row in `dataset_snapshots` is live. `null` is the honest value;
   inventing an id would defeat the reproducibility the field exists for
   (doc 09 §9.6).
2. **`unavailable` carries data-source keys as well as group keys.** §10.4 types
   it as `Array<{ key: CandidateGroupKey, reason }>`. A missing *source* is not a
   group, but it is exactly what the client needs to explain an empty result, so
   `combos`, `statistics` and `dataset-snapshot` appear alongside group keys.
   `statistics` is present on **every** response — there is no corpus yet and no
   third-party one is coming (ADR-0008).
3. **`GET /decks/:id/analysis` returns `bracket.assessed: null`** where §10.5
   types it as `Bracket`, and adds its own `unavailable` array. `violations` and
   `gameChangers` ARE answered as of `DATA-05` — the Game Changers allowance is
   fetched, quoted and checked. What stays null is the *assessment*: Wizards
   publishes a per-bracket value for one barometer of five, and one dimension is
   not a verdict ([ADR-0018](adr/0018-bracket-rules-and-game-changers.md)). The
   `unavailable` entry names which part is missing. If the corpus carries no Game
   Changers at all — a re-ingest has not run since migration `0011` — the whole
   check reports unavailable rather than passing every deck vacuously.
4. **Commander legality checks are live**, and only the pairing rule is not.
   `validateDeck` is fed real eligibility from `cards.can_be_commander`, so a
   deck already led by an ineligible card reports `invalid-commander`. Two
   entries remain in `unavailable`, both conditional rather than blanket:
   `commander-eligibility` when a commander's row predates migration 0010 and
   has no answer yet, and `commander-partnership` on a two-commander deck. A
   single-commander deck on an ingested corpus gets neither.

   The stored flag comes from Scryfall's own `is:commander` search, fetched once
   per ingest; `deriveCanBeCommander` in `packages/domain` is the fallback when
   that search cannot be reached. The two agree on 3,380 of 3,411 and differ on
   36 cards: the fallback refuses 31 legendary Vehicles and Spacecraft, and
   accepts 5 meld backs that may not lead a deck. Which source answered is on
   `IngestReport.commanderEligibility` and printed by the ingest CLI.
5. **Printing-level fields are null in the candidate pool.** `priceUsd`,
   `rarity`, `setCode` and `reserved` on `PoolCard` are not hydrated for
   candidates, so budget filtering and `is:reserved` do not apply to
   recommendations. Hydrating printings for the whole eligible pool to price the
   handful that get shown is the wrong shape; it belongs with the histograms in
   `API-08`.

