# 11. Work breakdown

Tasks sized for one agent to complete in one focused pass. Each has an owner
scope (files it may touch), explicit dependencies, and a definition of done.

**Read [AGENTS.md](../AGENTS.md) before picking up any task.**

## 11.0 Current state — read this first

Last updated: 2026-08-30, end of the fourth build session.

**It runs.** `pnpm --filter @roundtable/web dev` with the API up gives a working
deck workspace against 34,492 real cards, 110,577 printings and 108,046 real
combos: pick a commander, take suggestions with their reasons, accept or exclude,
watch the pool re-sort. That is the state to protect.

The app is called **Lotus Wizard** in the interface. The name is tentative and
**not cleared** — `LEGAL-01` owns that, and there is a real question to answer
first: see doc 04 §4.6. Package scopes stay `@roundtable/*` until it is settled.

**Done (21 tasks).** `FOUND-01`, `DOM-01`–`DOM-09`, `DB-01`, `API-01`, `API-02`,
`DATA-01`, `DATA-02`, `ING-01`, `ING-02`, `FOUND-02`, `UI-01`, and a vertical slice of `WEB-01`.
`DATA-03` is closed by decision and `ING-03` cut ([ADR-0008](adr/0008-drop-edhrec.md)).

**Run it locally:**

```bash
pnpm install
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
node packages/db/dist/cli.js up          # migrations
node apps/ingest/dist/main.js            # ~35k cards, ~108k combos, under a minute
node apps/api/dist/main.js &             # API on :3000
pnpm --filter @roundtable/web dev        # workspace on :5173
```

No Docker? Any PostgreSQL 16 works. The third session used the EDB portable
binaries (`initdb` into a user directory, `pg_ctl -o "-p 5433"`) — no
administrator rights, no service.

**Verify:**

```bash
pnpm check          # lint + typecheck + 434 tests
```

The integration tests need a real Postgres and SKIP (loudly) without one. The
API-02 performance test seeds a 20,000-card corpus and takes ~40 s.

**Next, in order of value:**

| Pick up | Why now |
| --- | --- |
| `LEGAL-01` (name clearance only) | The name **Lotus Wizard** needs checking before it goes anywhere public — see doc 04 §4.6. Cheap to resolve, awkward to undo after it is on a domain. |
| `FOUND-02` | ✅ **Done.** Design tokens as asserted data + `packages/ui` scaffold; the app imports them rather than keeping a copy | root | ✅ 13 contrast pairs asserted, each naming what it is for. Caught a live defect on the first run: rust was 2.80:1 on `ink-2`, the surface cut hints are drawn on. `tokens.css` is generated from the data and a test holds the two in step |
| `WEB-01` proper | The slice is one deck in localStorage with no offline queue, no optimistic mutation and no reconcile. Everything in WEB-02..24 assumes those exist. |
| `LEGAL-01` (name clearance) | **Lotus Wizard** needs checking before it goes on a domain. Now urgent rather than cheap-and-later: the Vercel config is written. |
| `DATA-05` | The last unanswered terms question. Until the bracket rules are populated, `analysis.bracket.assessed` is honestly null and core packages cannot be built. Scryfall now exposes a `game_changer` boolean on card records, which may answer half of it. |
| `API-06` | `409` returns the current deck with an empty `since`; the client can refetch but not replay. |

**`DATA-05` is the only third-party question left.** `DATA-01` and `DATA-02` are
answered ([ADR-0009](adr/0009-scryfall-terms.md), [ADR-0010](adr/0010-spellbook-terms.md)):
Scryfall grants use explicitly, Spellbook publishes no prohibition. `DATA-03` is
closed — EDHREC's terms forbid automated queries, and Archidekt carries the
identical clause, so the project queries neither ([ADR-0008](adr/0008-drop-edhrec.md)).

**Nothing else is blocked.** Every remaining task needs a browser toolchain
(installed) or just time.

## 11.1 Dependency graph

```
 FOUND-01 ─┬─→ DOM-01 ─┬─→ DOM-02 ─→ DOM-03 ─→ DOM-05 ─┐
   (done)  │  (done)   │  (done)   ├─→ DOM-09 ─→ DOM-06 ┤
           │           ├─→ DOM-04 ─┘                    │
           │           ├─→ DOM-07  └─→ DOM-08           │
           │           │                                ├─→ API-02 ─┬─→ API-05..09
           ├─→ DATA-01 ─→ ING-01 ─┐                     │           │
           ├─→ DATA-02 ─→ ING-02 ─┼─→ DB-01 ─→ API-01 ──┘           │
           │                        └─→ ING-05                        │
           ├─→ DATA-05 ─→ DOM-06                                    │
           │                                                        │
           └─→ UI-01 ─┬─→ WEB-01 ─┬─→ WEB-02 ─┬─→ WEB-03 ─→ WEB-04 ─┤
                      │           │           ├─→ WEB-05            │
                      │           │           ├─→ WEB-07 ─→ WEB-08  │
                      │           │           ├─→ WEB-10            │
                      │           │           └─→ WEB-17 ─┬─→ WEB-19│
                      │           │                       └─→ WEB-18│
                      │           ├─→ WEB-09  WEB-11  WEB-15  WEB-16│
                      │           └─→ WEB-12 ─→ WEB-13 ─┬─→ WEB-14 ─→ WEB-20 ─→ WEB-21
                      │                                 ├─→ WEB-22 ─→ WEB-24 │
                      │                                 └─→ WEB-23           │
                      └─→ WEB-06 ──────────────────────────────────────────┴─→ E2E-01
                                                                               PERF-01
                                                                               A11Y-01
                                                                               LEGAL-01
```

**`packages/domain` is complete.** Every pure task — `DOM-01` through `DOM-09` —
is merged, along with `FOUND-01`. That is the shared contract doc 09 §9.2
describes: entity types, combo degree and its incremental patch, role derivation,
archetype targets, legality, composition analysis, the candidate query language,
the grouping and scoring engine, and decklist import/export. 254 tests, no IO,
buildable and testable with zero infrastructure.

What remains needs something the domain layer deliberately does not: a database,
a browser, or an answer from a third party.

Everything under `DOM-*` and `UI-*` can start immediately and runs fully parallel
with the data work. That is the point of the pure-domain rule: no domain task
waits on a database, an API key, or an answer from a third party.

The `DATA-*` tasks are **blocking for deployment, not for development** — see
[ADR-0006](adr/0006-data-source-terms-verification.md). Adapters can be written
against their interfaces; nothing depending on an unanswered question ships.

## 11.2 Foundation

| ID         | Task                                                                                                                                                                                                 | Scope                       | DoD                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FOUND-01` | ✅ **Done.** Monorepo skeleton: pnpm workspaces, Turborepo, TS strict, ESLint/Prettier, Vitest, CI. Lint rules enforce R1 (domain purity) and R3 (no third-party `fetch` outside `packages/clients`) | root, all package manifests | ✅ `pnpm install && pnpm check` green from a clean clone; purity rules verified to actually reject violations |
| `FOUND-02` | ✅ **Done.** Design tokens as asserted data + `packages/ui` scaffold; the app imports them rather than keeping a copy | root | ✅ 13 contrast pairs asserted, each naming what it is for. Caught a live defect on the first run: rust was 2.80:1 on `ink-2`, the surface cut hints are drawn on. `tokens.css` is generated from the data and a test holds the two in step |

## 11.3 Domain — pure, no IO, parallelisable

| ID       | Task                                                                                                                                 | Depends                 | DoD                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOM-01` | ✅ **Done.** Entity types per doc 02, branded ids, exhaustive discriminated unions, `assertNever`, role precedence | FOUND-01 | ✅ Types exported; no `any`; typecheck green |
| `DOM-02` | ✅ **Done.** Combo index, `comboDegree`, `nearCombos`, `annotateCombos`, `deckCombos`, `candidatesAffectedBy` — exactly per doc 02 §2.3 | DOM-01 | ✅ 29 tests covering the shared-pieces case, the two-separate-combos case, and degenerate inputs (empty combo, empty pool, empty accepted set, duplicate ids, duplicate pieces, already-accepted candidate). Mutation-tested: four deliberate breaks to the definition are each caught |
| `DOM-03` | ✅ **Done.** Incremental degree patching (doc 05 §5.8) | DOM-02                  | Property test: incremental result ≡ full recompute, over randomised accept/exclude sequences                                                                                                                                              |
| `DOM-04` | ✅ **Done.** Role derivation: override → curated table → oracle-text heuristics | DOM-01                  | ≥ 95% agreement with a 300-card hand-labelled fixture set                                                                                                                                                                                 |
| `DOM-05` | ✅ **Done.** Grouping + scoring engine (doc 05 §5.3, §5.6) | DOM-02, DOM-04          | Deterministic; golden-file tests over 5 fixture decks; every output carries non-empty `reasons`                                                                                                                                           |
| `DOM-06` | ✅ **Done.** Commander legality, composition analysis, bracket-rules loader | DOM-01, DATA-05, DOM-09 | Legality tests incl. colour identity, partners, singleton exceptions                                                                                                                                                                      |
| `DOM-09` | ✅ **Done.** Archetype vectors, 70/30 blending, assessArchetype | DOM-01, DOM-04          | Blend rounds to whole cards; assessment deterministic and reports its drivers; every archetype row covered by a fixture deck                                                                                                              |
| `DOM-08` | ✅ **Done.** Candidate query: lexer, parser, evaluator, formatQuery, describeQuery, toChips | DOM-01, DOM-04          | Property test: `formatQuery(parse(s))` idempotent; partial parses usable; unknown field errors with position and suggestion; **no regex support**                                                                                         |
| `DOM-07` | ✅ **Done.** Decklist parse + format, all supported formats, confidence-floored name resolution | DOM-01                  | Fixtures from every supported source plus split cards, MDFCs, adventures, accented names, CRLF, trailing sideboard, no commander marker; unresolved lines reported, never thrown; below the confidence floor it asks rather than guessing |

## 11.4 Data and ingestion

| ID        | Task                                                                                                                                                       | Depends                | DoD                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA-01` | ✅ **Done.** All seven Scryfall questions answered with quoted wording and retrieval dates ([ADR-0009](adr/0009-scryfall-terms.md)) | — | ✅ Rate limits are **per endpoint** (search is 2/s, not 10/s — doc 04 §4.1 was wrong); bulk data is mandatory, not optional; prices are estimates and must be labelled so. Q4 narrowed: `ING-04` still needs the image-serving question confirmed |
| `DATA-02` | ✅ **Done.** Spellbook questions answered ([ADR-0010](adr/0010-spellbook-terms.md)) | — | ✅ `robots.txt` quoted with date; no terms page exists, so no prohibition — a weaker position than Scryfall's explicit grant, recorded as such. Q5 resolved: `uses[].card.oracleId` is Scryfall's oracle id, so no name matching |
| `DATA-03` | ✅ **Closed by decision, not completed.** EDHREC's terms were read on 2026-08-29 and prohibit automated queries; the project does not query EDHREC ([ADR-0008](adr/0008-drop-edhrec.md)) | — | ✅ Terms and `robots.txt` quoted with retrieval dates in ADR-0008. No permission request sent — permission was not the blocker. `ING-03` cut |
| `DATA-05` | Fetch the **current official** bracket rules + Game Changers list into `brackets/rules.data.json` ([ADR-0006](adr/0006-data-source-terms-verification.md)) | —                      | Checked in with source URL and retrieval date; list fetched, never recalled; no bracket constant hardcoded elsewhere                                             |
| `ING-01` | ✅ **Done.** Scryfall bulk ingest: download, stream-parse, map to `Card`, snapshot-and-swap | DATA-01, DB-01 | ✅ 34,492 cards + printings from 38,627 records in <5 s against the real bulk file; re-run is idempotent. 4,135 non-playable records (art series, tokens, stickers, conspiracies) rejected — `CardType` is the definition of a deck card |
| `ING-02` | ✅ **Done.** Spellbook combo ingest + oracle-id mapping, **failing loudly on unmapped cards** | DATA-02, DB-01 | ✅ 108,046 combos in 12.8 s with **zero unmapped**; pieces map on `oracleId` with no name matching. Only `OK` variants ingested; a combo naming an unknown card is reported, never stored |
| ~~`ING-03`~~ | ❌ **Cut.** EDHREC stats fetcher. No aggregated-decklist source has usable terms — Archidekt carries the identical prohibition, Moxfield is out of scope, Deckstats is unreachable ([ADR-0008](adr/0008-drop-edhrec.md)). Inclusion and synergy statistics come from the project's own imported-deck corpus or not at all | — | — |
| `ING-04`  | Image caching pipeline to object store, three sizes (doc 07 §7.3)                                                                                          | ING-01                 | No client request ever hits a third-party image host                                                                                                             |
| `ING-05` | Core package generation (doc 05 §5.5), per bracket and — where the corpus supports it — per archetype. Corpus is **MTGJSON** (MIT licensed, 192 official Commander decklists) plus curation, never a scraped aggregate ([ADR-0008](adr/0008-drop-edhrec.md)) | DOM-04, DOM-09 | Reproducible from a fixed corpus; output diff is human-reviewable; falls back to the bracket's general package rather than emitting one built from too few decks |

## 11.5 Backend

| ID       | Task                                                                                                                | Depends                | DoD                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB-01`  | ✅ **Done.** Postgres schema + migrations + repositories; GIN index on the combo index; migration CLI | DOM-01 | ✅ Migrations up/down clean and idempotent; 40 integration tests against a **real** PostgreSQL 16; `EXPLAIN` asserts the planner actually uses `combos_pieces_idx` |
| `API-01` | ✅ **Done.** Cards + decks endpoints, incl. the batched command endpoint with idempotency and partial-success reporting | DB-01, DOM-01 | ✅ 48 contract tests against doc 10 on a real Postgres; `rejected` carries a typed reason per failed command. Command decisions live in `packages/domain` (`applyCommands`), so `web` and `api` cannot disagree — 22 unit tests, mutation-checked. See the divergences below |
| `API-02` | ✅ **Done.** Recommendations + analysis endpoints, incl. `unavailable` degradation, plus `GET /decks/:id/combo-index` | API-01, DOM-05, DOM-06 | ✅ Measured, not assumed: **p95 46.6 ms** against a 20,000-card corpus, 2,000 combos and a 100-card deck — budget is 200 ms. Degradation reported per missing source rather than as absent groups; a query that half-parses is never partially applied. 14 contract tests, mutation-checked. Divergences in doc 10 §10.9 |
| `API-03` | Auth, per-user rate limiting, deck ownership                                                                        | API-01                 | No deck readable cross-user; 429 with `Retry-After`                                                                                                                                     |
| `API-04` | Import preview/commit and export endpoints (doc 10 §10.7)                                                           | DOM-07                 | Preview applies nothing; `illegal` and `previouslyExcluded` populated; round-trip export JSON → import → identical deck incl. origins, exclusions, locks, tags, archetype and snapshots |
| `API-05` | Deck library: list/filter/sort, `recent`, duplicate, archive, soft delete (doc 12 §12.2–12.4)                       | API-01                 | `DeckSummary` projection never loads entries; duplicate copies exclusions and locks                                                                                                     |
| `API-06` | Optimistic concurrency: `baseVersion`, `409` with `since`, workspace-state endpoint (doc 12 §12.6–12.7)             | API-01                 | Concurrent-edit test from two clients converges without data loss                                                                                                                       |
| `API-07` | Snapshots: auto before bulk ops, manual, restore (doc 12 §12.8)                                                     | API-01                 | Restore is itself undoable; retention enforced                                                                                                                                          |
| `API-08` | Query validate/suggest endpoints, corpus histograms for autocomplete counts (doc 10 §10.4)                          | API-02, DOM-08         | Suggest p95 < 40 ms; counts served from precomputed histograms                                                                                                                          |
| `API-09` | Archetype endpoints incl. per-commander suggestion with `source`, and archetype on deck create/patch (doc 10 §10.6) | API-01, DOM-09 | `source: 'default'` returned honestly when no statistics exist — which is **every** case until the project's own corpus is large enough ([ADR-0008](adr/0008-drop-edhrec.md)) |

## 11.6 Frontend

| ID       | Task                                                                                                                                             | Depends                | DoD                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `UI-01`  | ✅ **Done.** Card primitives at all four zoom representations (pip/tile/card/detail)                                                              | FOUND-02               | ✅ A gallery at `#gallery` rather than Storybook — see §11.10. Sizes and a11y asserted in `packages/ui/src/card/*.test.*`             |
| `WEB-01` | App shell, routing, deck state store, optimistic mutation + reconcile                                                                            | UI-01, API-01          | Offline mutation queues and replays                                                                                                |
| `WEB-02` | Two-region workspace + draggable divider + grouping (doc 06)                                                                                     | WEB-01                 | Divider snaps and persists; group collapse persists                                                                                |
| `WEB-03` | Zoom system: 4 levels, shared across regions, anchoring, persistence (doc 07)                                                                    | WEB-02                 | All four control paths work; anchor preserved across a full L2→L0→L2 cycle                                                         |
| `WEB-04` | L0 canvas renderer + its parallel accessibility path                                                                                             | WEB-03                 | 5,000 pips < 300 ms; screen-reader summary present and tested                                                                      |
| `WEB-05` | Virtualised L1/L2 grids with per-level image sizing                                                                                              | WEB-03                 | 60 fps scroll on throttled mobile                                                                                                  |
| `WEB-06` | dnd-kit setup: pointer/touch/keyboard sensors, activation constraints, live-region announcements                                                 | UI-01                  | **Every drag has a working tap and keyboard equivalent** (doc 08 §8.2)                                                             |
| `WEB-07` | Mobile layout: bottom sheet with three detents, swipe accept/reject, gesture disambiguation (doc 08)                                             | WEB-06                 | Verified at 360 px; axis-lock prevents accidental accepts while scrolling                                                          |
| `WEB-08` | Re-grouping animation + reduced-motion equivalent (doc 06 §6.4)                                                                                  | WEB-05, DOM-03         | Accept → settled < 400 ms; reduced-motion path conveys the same information                                                        |
| `WEB-09` | Inspect panel / detail sheet with combo lines and reasons (doc 06 §6.5)                                                                          | WEB-01                 | Every recommendation renders its reasons; accept/exclude reachable without closing                                                 |
| `WEB-10` | Composition meters wired to deficit groups (doc 05 §5.4)                                                                                         | WEB-02, API-02         | Tapping a meter scrolls to the matching `fills-<role>` group                                                                       |
| `WEB-11` | Bracket selector, core package apply/remove with the change summary (doc 03 §3.3)                                                                | WEB-01, API-01         | Locked and manual entries provably survive a bracket change; single undo reverts the whole operation                               |
| `WEB-12` | Deck switcher: command-bar popover, `⌘K` fuzzy filter, `⌘1–9`, mobile sheet (doc 12 §12.3)                                                       | WEB-01, API-05         | Switch to interactive < 300 ms; opens without waiting on a request                                                                 |
| `WEB-13` | Deck library: grid/list, sort, filter, search, per-deck and bulk actions, empty state (doc 12 §12.4)                                             | WEB-01, API-05         | Works at 360 px; every action reachable by keyboard                                                                                |
| `WEB-14` | Deck creation flow: commander search, partner pairing, bracket pick, core-package offer (doc 12 §12.5)                                           | WEB-11, API-05         | Abandonable at every step; commander search filtered to legal commanders                                                           |
| `WEB-15` | Local-first persistence: IndexedDB replica, command queue, offline drain, `409` replay (doc 12 §12.7)                                            | WEB-01, API-06         | Deck fully editable offline; queue survives reload; conflict resolves without a modal                                              |
| `WEB-16` | Snapshot UI: automatic labels, manual creation, restore with preview (doc 12 §12.8)                                                              | WEB-01, API-07         | Bracket experiment can be fully reverted                                                                                           |
| `WEB-17` | Desktop query bar: chips ⇄ text, autocomplete with counts, raw-mode fallback for nested queries (doc 13 §13.4)                                   | WEB-02, DOM-08, API-08 | Chip edits and text edits round-trip; nested query drops to raw mode with a stated reason                                          |
| `WEB-18` | Mobile faceted filter sheet, live match count, active-filter chip row (doc 13 §13.5)                                                             | WEB-07, DOM-08         | Every field in doc 13 §13.2 reachable without typing syntax; count updates before Apply                                            |
| `WEB-19` | Withheld-by-filter footers and Accepted-region dim-not-hide highlight (doc 13 §13.1)                                                             | WEB-17                 | A filtered-out `combo-3plus` card is always reported, never silently absent                                                        |
| `WEB-20` | Archetype step in the creation flow: nine cards, suggested one preselected with its statistic, target-vector disclosure (doc 14 §14.6)           | WEB-14, API-09         | Suggestion reason always shown; `default` source stated as such                                                                    |
| `WEB-21` | Archetype switching with the non-destructive change summary, plus the assessed-archetype note (doc 14 §14.4–14.5)                                | WEB-20, API-02         | Switching provably adds and removes zero cards; assessment surfaces as a note, never auto-switches                                 |
| `WEB-22` | Import dialog: paste/upload, preview, in-place fixing of unresolved lines, illegal-card flagging, new-vs-merge (doc 15 §15.3)                    | WEB-13, API-04         | Nothing applies before the user confirms; a typo costs one line, never the paste; merge never resurrects an excluded card silently |
| `WEB-23` | Export panel: format picker, live preview, copy-first, always-visible lossiness notice; and the export-before-delete confirm (doc 15 §15.4–15.5) | WEB-13, API-04         | Copy is the primary action; text formats always state what they drop; delete states the 30-day window where the decision is made   |
| `WEB-24` | Import entry from the new-deck flow — paste a list, detect the commander, rejoin at the archetype step (doc 15 §15.1)                            | WEB-14, WEB-22         | Ambiguous commander asks rather than guessing                                                                                      |

## 11.7 Cross-cutting gates

| ID         | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                        | DoD                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `E2E-01`   | Playwright suite, desktop + mobile viewports, covering: build a deck from empty to 100, apply and partially dismantle a core package, exclude and confirm no re-suggestion, switch decks mid-edit and confirm nothing is lost, edit offline and reconcile, filter candidates by query on desktop and by facets on mobile, import a decklist with a deliberate typo and fix it in the preview, export and re-import as JSON and assert the deck is identical | Green in CI on both viewports                                  |
| `PERF-01`  | Budgets from doc 07 §7.3 and doc 08 §8.5 enforced in CI                                                                                                                                                                                                                                                                                                                                                                                                     | Regressions fail the build, not a dashboard                    |
| `A11Y-01`  | Automated axe pass + a manual screen-reader script for both drag and tap paths                                                                                                                                                                                                                                                                                                                                                                              | Zero critical violations; manual script documented and passing |
| `LEGAL-01` | Fan Content Policy compliance, attribution surfaces, name clearance (doc 04 §4.6)                                                                                                                                                                                                                                                                                                                                                                           | Reviewed and signed off **before any public deployment**       |

## 11.8 What to pick up next

The domain layer is done, so everything below is now unblocked in its own right.

**Needs a browser, not a compiler — and blocks deployment of all ingestion:**

1. `DATA-01`, `DATA-02`, `DATA-05` — the terms questions in
   [ADR-0006](adr/0006-data-source-terms-verification.md). Until `DATA-05` is
   answered, `brackets/rules.data.json` stays unpopulated and the bracket loader
   correctly refuses to assert a verdict. `DATA-03` is **closed** and `ING-03`
   **cut** — the project does not query EDHREC ([ADR-0008](adr/0008-drop-edhrec.md)).

**Needs infrastructure:**

2. ~~`DB-01`~~ and ~~`API-01`~~ are done. `API-02` is the next one that matters:
   recommendations and analysis, on the transport `API-01` established.
3. `ING-01`, `ING-02` — Scryfall and Spellbook ingest, once `DATA-01`/`02` land.
4. `ING-05` — core packages from MTGJSON's official decklists plus curation.

**Needs a frontend toolchain:**

5. `FOUND-02` → `UI-01` — design tokens and the four card representations.
   `WEB-01` also converts `apps/web` from `tsc` to Vite.
6. `WEB-02` onward — the workspace, per docs 06–08.

**Worth doing regardless:**

7. Grow `DOM-04`'s curated role-override table and build the 300-card labelled
   fixture set its DoD asks for. That needs real Scryfall data, so it follows
   `ING-01` — the engine and its pattern tests are already in place.

## 11.9 Scoped, not built

| Doc | What it is |
| --- | --- |
| [16 — Archetype customiser](16-archetype-customiser.md) | Let a builder tune the role targets and curve their deck is judged against, instead of accepting the archetype preset. Sparse per-deck override so decks keep inheriting preset improvements; both target functions gain one optional parameter and nothing downstream changes. Three open questions at the end. |

## 11.10 UI-01: a gallery instead of Storybook

The DoD said "Storybook entries". It shipped as a page at `#gallery` and a test
file per primitive, which is that DoD split into the two things it was asking
for and each given to the tool that does it properly.

Storybook asserts nothing. The half of the DoD that matters — "each meets its
size and a11y requirements" — is a set of claims, and claims belong in tests:
the L0 pip is held to doc 07's 6–10 px, the mobile widths are *recomputed* from
doc 08's column counts rather than restated, every tile keeps a 44 px hit area
however small a caller draws it, and both Enter and Space activate every
interactive surface. Storybook would have watched all of that rot.

What Storybook would still have given is somewhere a human can look at a
primitive without building a deck first. That is a page, and it costs one file
instead of forty packages. It renders the fixtures that break things rather
than pretty ones: a card with no art, one with no price, a name too long for the
strip, and a recommendation with an empty `reasons` list — which draws the P4
violation in rust, on screen, where it cannot be ignored.

Looking at that page immediately paid for itself. The combo badge was
`position: absolute` unconditionally; at L2, where it sits in a flow row rather
than over an image, it flew to the corner of the document — missing from the row
and adding a page-wide horizontal scroll. A second pass found two classes with
no CSS rule at all. Both now have tests, and one of them (`card.css.test.ts`)
checks the whole class of defect: every `rt-` class the components render must
have a rule, and no colour may be written as a literal hex instead of a token.

## 11.11 API-03 is no longer on the critical path

ADR-0014 replaced deck ownership with a device id: the browser generates a uuid
into `localStorage` and sends it as `X-Device-Id`, and there is nothing to sign
in to. `API-03` becomes optional work — "sign in to sync across devices" —
layered on top rather than underneath, and the task it was blocking (deployment)
is unblocked. See `DEPLOYING.md`.
