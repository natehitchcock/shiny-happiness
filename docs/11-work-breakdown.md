# 11. Work breakdown

Tasks sized for one agent to complete in one focused pass. Each has an owner
scope (files it may touch), explicit dependencies, and a definition of done.

**Read [AGENTS.md](../AGENTS.md) before picking up any task.**

## 11.1 Dependency graph

```
 FOUND-01 ─┬─→ DOM-01 ─┬─→ DOM-02 ─→ DOM-03 ─→ DOM-05 ─┐
   (done)  │  (done)   │  (done)   ├─→ DOM-09 ─→ DOM-06 ┤
           │           ├─→ DOM-04 ─┘                    │
           │           ├─→ DOM-07  └─→ DOM-08           │
           │           │                                ├─→ API-02 ─┬─→ API-05..09
           ├─→ DATA-01 ─→ ING-01 ─┐                     │           │
           ├─→ DATA-02 ─→ ING-02 ─┼─→ DB-01 ─→ API-01 ──┘           │
           ├─→ DATA-03 ─→ ING-03 ─┴─→ ING-05                        │
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

`FOUND-01`, `DOM-01` and `DOM-02` are **merged** — the monorepo, toolchain, CI,
entity types and combo degree all exist. The feature the product rests on is
built and tested; everything else is assembly.

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
| `FOUND-02` | Design tokens + theming (light/dark, contrast-audited), `packages/ui` scaffold                                                                                                                       | `packages/ui`               | Tokens documented; contrast ≥ 4.5:1 verified by a test                                                        |

## 11.3 Domain — pure, no IO, parallelisable

| ID       | Task                                                                                                                                 | Depends                 | DoD                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOM-01` | ✅ **Done.** Entity types per doc 02, branded ids, exhaustive discriminated unions, `assertNever`, role precedence | FOUND-01 | ✅ Types exported; no `any`; typecheck green |
| `DOM-02` | ✅ **Done.** Combo index, `comboDegree`, `nearCombos`, `annotateCombos`, `deckCombos`, `candidatesAffectedBy` — exactly per doc 02 §2.3 | DOM-01 | ✅ 29 tests covering the shared-pieces case, the two-separate-combos case, and degenerate inputs (empty combo, empty pool, empty accepted set, duplicate ids, duplicate pieces, already-accepted candidate). Mutation-tested: four deliberate breaks to the definition are each caught |
| `DOM-03` | Incremental degree patching (doc 05 §5.8)                                                                                            | DOM-02                  | Property test: incremental result ≡ full recompute, over randomised accept/exclude sequences                                                                                                                                              |
| `DOM-04` | Role derivation: heuristics + curated override table + precedence                                                                    | DOM-01                  | ≥ 95% agreement with a 300-card hand-labelled fixture set                                                                                                                                                                                 |
| `DOM-05` | Grouping + scoring engine (doc 05 §5.3, §5.6)                                                                                        | DOM-02, DOM-04          | Deterministic; golden-file tests over 5 fixture decks; every output carries non-empty `reasons`                                                                                                                                           |
| `DOM-06` | Bracket rules, legality validation, composition targets over `CompositionDimension`                                                  | DOM-01, DATA-05, DOM-09 | Legality tests incl. colour identity, partners, singleton exceptions                                                                                                                                                                      |
| `DOM-09` | Archetype definitions, target vectors, 70/30 hybrid blending, `assessArchetype` (doc 14)                                             | DOM-01, DOM-04          | Blend rounds to whole cards; assessment deterministic and reports its drivers; every archetype row covered by a fixture deck                                                                                                              |
| `DOM-08` | Candidate query language: lexer, parser, evaluator, `formatQuery`, `describeQuery` (doc 13 §13.2–13.3)                               | DOM-01, DOM-04          | Property test: `formatQuery(parse(s))` idempotent; partial parses usable; unknown field errors with position and suggestion; **no regex support**                                                                                         |
| `DOM-07` | Decklist parse **and** format, all supported formats, format sniffing, name resolution with a confidence floor (doc 15 §15.2, §15.6) | DOM-01                  | Fixtures from every supported source plus split cards, MDFCs, adventures, accented names, CRLF, trailing sideboard, no commander marker; unresolved lines reported, never thrown; below the confidence floor it asks rather than guessing |

## 11.4 Data and ingestion

| ID        | Task                                                                                                                                                       | Depends                | DoD                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA-01` | Answer the seven Scryfall questions in [ADR-0006](adr/0006-data-source-terms-verification.md)                                                              | —                      | Each answered with **quoted wording and a retrieval date**; ADR-0006 superseded. Q4 (image licensing) gates `ING-04`                                             |
| `DATA-02` | Answer the six Commander Spellbook questions in [ADR-0006](adr/0006-data-source-terms-verification.md)                                                     | —                      | Quoted wording + retrieval date. Q5 (card identifier) gates `ING-02`'s oracle-id mapping                                                                         |
| `DATA-03` | Answer the five EDHREC questions in [ADR-0006](adr/0006-data-source-terms-verification.md) and **send the permission request**                             | —                      | Quoted `robots.txt` + date; request sent and recorded; feature flag stays off by default until answered                                                          |
| `DATA-05` | Fetch the **current official** bracket rules + Game Changers list into `brackets/rules.data.json` ([ADR-0006](adr/0006-data-source-terms-verification.md)) | —                      | Checked in with source URL and retrieval date; list fetched, never recalled; no bracket constant hardcoded elsewhere                                             |
| `ING-01`  | Scryfall bulk ingest: download, stream-parse, map to `Card`, snapshot-and-swap                                                                             | DATA-01, DB-01         | Full ingest completes; shared rate limiter enforced; re-run is idempotent                                                                                        |
| `ING-02`  | Spellbook combo ingest + oracle-id mapping, **failing loudly on unmapped cards**                                                                           | DATA-02, DB-01         | Unmapped cards reported, not dropped                                                                                                                             |
| `ING-03`  | EDHREC stats fetcher: on-demand + warm cache, robots.txt honoured at runtime, serve-stale-on-error                                                         | DATA-03, DB-01         | Degrades cleanly when disabled; single-flight verified by test                                                                                                   |
| `ING-04`  | Image caching pipeline to object store, three sizes (doc 07 §7.3)                                                                                          | ING-01                 | No client request ever hits a third-party image host                                                                                                             |
| `ING-05`  | Core package generation (doc 05 §5.5), per bracket and — where the corpus supports it — per archetype                                                      | ING-03, DOM-04, DOM-09 | Reproducible from a fixed corpus; output diff is human-reviewable; falls back to the bracket's general package rather than emitting one built from too few decks |

## 11.5 Backend

| ID       | Task                                                                                                                | Depends                | DoD                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB-01`  | Postgres schema + migrations; GIN index on the combo index                                                          | DOM-01                 | Migrations up/down clean; combo lookup < 10 ms at full data volume                                                                                                                      |
| `API-01` | Cards + decks endpoints, incl. the batched command endpoint with idempotency and partial-success reporting          | DB-01, DOM-01          | Contract tests against doc 10; `rejected` populated correctly                                                                                                                           |
| `API-02` | Recommendations + analysis endpoints, incl. `unavailable` degradation                                               | API-01, DOM-05, DOM-06 | Full recompute < 200 ms p95 on a 100-card deck; degradation test with each source disabled                                                                                              |
| `API-03` | Auth, per-user rate limiting, deck ownership                                                                        | API-01                 | No deck readable cross-user; 429 with `Retry-After`                                                                                                                                     |
| `API-04` | Import preview/commit and export endpoints (doc 10 §10.7)                                                           | DOM-07                 | Preview applies nothing; `illegal` and `previouslyExcluded` populated; round-trip export JSON → import → identical deck incl. origins, exclusions, locks, tags, archetype and snapshots |
| `API-05` | Deck library: list/filter/sort, `recent`, duplicate, archive, soft delete (doc 12 §12.2–12.4)                       | API-01                 | `DeckSummary` projection never loads entries; duplicate copies exclusions and locks                                                                                                     |
| `API-06` | Optimistic concurrency: `baseVersion`, `409` with `since`, workspace-state endpoint (doc 12 §12.6–12.7)             | API-01                 | Concurrent-edit test from two clients converges without data loss                                                                                                                       |
| `API-07` | Snapshots: auto before bulk ops, manual, restore (doc 12 §12.8)                                                     | API-01                 | Restore is itself undoable; retention enforced                                                                                                                                          |
| `API-08` | Query validate/suggest endpoints, corpus histograms for autocomplete counts (doc 10 §10.4)                          | API-02, DOM-08         | Suggest p95 < 40 ms; counts served from precomputed histograms                                                                                                                          |
| `API-09` | Archetype endpoints incl. per-commander suggestion with `source`, and archetype on deck create/patch (doc 10 §10.6) | API-01, DOM-09, ING-03 | `source: 'default'` returned honestly when no statistics exist                                                                                                                          |

## 11.6 Frontend

| ID       | Task                                                                                                                                             | Depends                | DoD                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `UI-01`  | Card primitives at all four zoom representations (pip/tile/card/detail)                                                                          | FOUND-02               | Storybook entries; each meets its size and a11y requirements                                                                       |
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

`FOUND-01`, `DOM-01` and `DOM-02` are merged. These five can start now, in
parallel, with no file conflicts and no ordering between them:

1. `DOM-03` — incremental degree patching, on top of `candidatesAffectedBy`,
   which `DOM-02` already provides. The property test (incremental ≡ full
   recompute) is the whole task.
2. `DOM-04` — role derivation. `DOM-05`, `DOM-08` and `DOM-09` all need it, so
   it is the next bottleneck.
3. `FOUND-02` → `UI-01` — design tokens and the four card representations.
4. `DB-01` — schema and migrations; `Combo` and `Card` types are settled now.
5. `DOM-07` — the decklist parser; self-contained and fixture-driven.

And the one that needs a browser rather than a compiler:

6. `DATA-01` + `DATA-02` + `DATA-05` — the terms questions in
   [ADR-0006](adr/0006-data-source-terms-verification.md). These block *deployment*
   of anything that ingests, so the sooner they are answered the better.
   `DATA-03` (the EDHREC permission request) should go out now — it is one email
   and the reply time is outside our control.
