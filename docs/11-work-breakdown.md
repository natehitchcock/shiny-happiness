# 11. Work breakdown

Tasks sized for one agent to complete in one focused pass. Each has an owner
scope (files it may touch), explicit dependencies, and a definition of done.

**Read [AGENTS.md](../AGENTS.md) before picking up any task.**

## 11.1 Dependency graph

```
 FOUND-01 ─┬─→ DOM-01 ─┬─→ DOM-02 ─→ DOM-03 ─→ DOM-05 ─┐
           │           ├─→ DOM-04 ──────────────────────┤
           │           └─→ DOM-06                       │
           │                                            ├─→ API-02 ─┐
           ├─→ DATA-01 ─→ ING-01 ─┐                     │           │
           ├─→ DATA-02 ─→ ING-02 ─┼─→ DB-01 ─→ API-01 ──┘           │
           ├─→ DATA-03 ─→ ING-03 ─┘                                 │
           ├─→ DATA-05 ─→ DOM-06                                    │
           │                                                        │
           └─→ UI-01 ─┬─→ WEB-01 ─→ WEB-02 ─┬─→ WEB-03 ─→ WEB-04 ───┤
                      │                     ├─→ WEB-05              │
                      └─→ WEB-06 ───────────┴─→ WEB-07 ─→ WEB-08 ───┴─→ E2E-01
                                                                        PERF-01
                                                                        A11Y-01
```

Everything under `DOM-*` and `UI-*` can start immediately after `FOUND-01` and
runs fully parallel with the data work. That is the point of the pure-domain rule.

## 11.2 Foundation

| ID | Task | Scope | DoD |
| --- | --- | --- | --- |
| `FOUND-01` | Monorepo skeleton: pnpm workspaces, Turborepo, TS strict configs, ESLint/Prettier, Vitest, CI running lint + typecheck + test on every PR | root, all package manifests | `pnpm install && pnpm build && pnpm test` green on a clean clone; CI green |
| `FOUND-02` | Design tokens + theming (light/dark, contrast-audited), `packages/ui` scaffold | `packages/ui` | Tokens documented; contrast ≥ 4.5:1 verified by a test |

## 11.3 Domain — pure, no IO, parallelisable

| ID | Task | Depends | DoD |
| --- | --- | --- | --- |
| `DOM-01` | Entity types per doc 02, branded ids, exhaustive discriminated unions | FOUND-01 | Types exported; no `any`; typecheck green |
| `DOM-02` | Combo index + `comboDegree` / `nearCombos` **exactly per doc 02 §2.3** | DOM-01 | Unit tests incl. the two-separate-combos case, the shared-pieces case, and empty/degenerate inputs |
| `DOM-03` | Incremental degree patching (doc 05 §5.8) | DOM-02 | Property test: incremental result ≡ full recompute, over randomised accept/exclude sequences |
| `DOM-04` | Role derivation: heuristics + curated override table + precedence | DOM-01 | ≥ 95% agreement with a 300-card hand-labelled fixture set |
| `DOM-05` | Grouping + scoring engine (doc 05 §5.3, §5.6) | DOM-02, DOM-04 | Deterministic; golden-file tests over 5 fixture decks; every output carries non-empty `reasons` |
| `DOM-06` | Bracket rules, legality validation, composition targets | DOM-01, DATA-05 | Legality tests incl. colour identity, partners, singleton exceptions |
| `DOM-07` | Decklist text parser (doc 10 §10.7) | DOM-01 | Parses Moxfield/Archidekt/TappedOut/MTGO export formats from fixtures; reports unresolved lines rather than throwing |

## 11.4 Data and ingestion

| ID | Task | Depends | DoD |
| --- | --- | --- | --- |
| `DATA-01` | **Read current Scryfall API docs + terms**; write [ADR-0002](adr/0002-data-sources.md) addendum with the actual rate limits, bulk endpoints, attribution and image-caching requirements | — | ADR updated with quoted terms + retrieval date |
| `DATA-02` | Same for Commander Spellbook: API shape, export format, terms, attribution; contact them | — | ADR addendum; contact attempt recorded |
| `DATA-03` | Same for EDHREC: `robots.txt`, terms, endpoints. **Send the permission request.** | — | ADR addendum; email sent; feature flag defaults to off until answered |
| `DATA-04` | Apply for Moxfield API access. Do not scrape in the meantime | — | Request submitted and recorded; `MoxfieldImporter` throws `NotAuthorizedError` |
| `DATA-05` | Fetch the **current official** Commander bracket rules + Game Changers list into `brackets/rules.data.json` with source URL and date | — | File checked in; no bracket constant hardcoded anywhere else |
| `ING-01` | Scryfall bulk ingest: download, stream-parse, map to `Card`, snapshot-and-swap | DATA-01, DB-01 | Full ingest completes; shared rate limiter enforced; re-run is idempotent |
| `ING-02` | Spellbook combo ingest + oracle-id mapping, **failing loudly on unmapped cards** | DATA-02, DB-01 | Unmapped cards reported, not dropped |
| `ING-03` | EDHREC stats fetcher: on-demand + warm cache, robots.txt honoured at runtime, serve-stale-on-error | DATA-03, DB-01 | Degrades cleanly when disabled; single-flight verified by test |
| `ING-04` | Image caching pipeline to object store, three sizes (doc 07 §7.3) | ING-01 | No client request ever hits a third-party image host |
| `ING-05` | Core package generation (doc 05 §5.5), emitting versioned checked-in artifacts | ING-03, DOM-04 | Reproducible from a fixed corpus; output diff is human-reviewable |

## 11.5 Backend

| ID | Task | Depends | DoD |
| --- | --- | --- | --- |
| `DB-01` | Postgres schema + migrations; GIN index on the combo index | DOM-01 | Migrations up/down clean; combo lookup < 10 ms at full data volume |
| `API-01` | Cards + decks endpoints, incl. the batched command endpoint with idempotency and partial-success reporting | DB-01, DOM-01 | Contract tests against doc 10; `rejected` populated correctly |
| `API-02` | Recommendations + analysis endpoints, incl. `unavailable` degradation | API-01, DOM-05, DOM-06 | Full recompute < 200 ms p95 on a 100-card deck; degradation test with each source disabled |
| `API-03` | Auth, per-user rate limiting, deck ownership | API-01 | No deck readable cross-user; 429 with `Retry-After` |
| `API-04` | Import/export endpoints | DOM-07 | Round-trip: export JSON → import → identical deck incl. origins, exclusions, locks |

## 11.6 Frontend

| ID | Task | Depends | DoD |
| --- | --- | --- | --- |
| `UI-01` | Card primitives at all four zoom representations (pip/tile/card/detail) | FOUND-02 | Storybook entries; each meets its size and a11y requirements |
| `WEB-01` | App shell, routing, deck state store, optimistic mutation + reconcile | UI-01, API-01 | Offline mutation queues and replays |
| `WEB-02` | Two-region workspace + draggable divider + grouping (doc 06) | WEB-01 | Divider snaps and persists; group collapse persists |
| `WEB-03` | Zoom system: 4 levels, shared across regions, anchoring, persistence (doc 07) | WEB-02 | All four control paths work; anchor preserved across a full L2→L0→L2 cycle |
| `WEB-04` | L0 canvas renderer + its parallel accessibility path | WEB-03 | 5,000 pips < 300 ms; screen-reader summary present and tested |
| `WEB-05` | Virtualised L1/L2 grids with per-level image sizing | WEB-03 | 60 fps scroll on throttled mobile |
| `WEB-06` | dnd-kit setup: pointer/touch/keyboard sensors, activation constraints, live-region announcements | UI-01 | **Every drag has a working tap and keyboard equivalent** (doc 08 §8.2) |
| `WEB-07` | Mobile layout: bottom sheet with three detents, swipe accept/reject, gesture disambiguation (doc 08) | WEB-06 | Verified at 360 px; axis-lock prevents accidental accepts while scrolling |
| `WEB-08` | Re-grouping animation + reduced-motion equivalent (doc 06 §6.4) | WEB-05, DOM-03 | Accept → settled < 400 ms; reduced-motion path conveys the same information |
| `WEB-09` | Inspect panel / detail sheet with combo lines and reasons (doc 06 §6.5) | WEB-01 | Every recommendation renders its reasons; accept/exclude reachable without closing |
| `WEB-10` | Composition meters wired to deficit groups (doc 05 §5.4) | WEB-02, API-02 | Tapping a meter scrolls to the matching `fills-<role>` group |
| `WEB-11` | Bracket selector, core package apply/remove with the change summary (doc 03 §3.3) | WEB-01, API-01 | Locked and manual entries provably survive a bracket change; single undo reverts the whole operation |

## 11.7 Cross-cutting gates

| ID | Task | DoD |
| --- | --- | --- |
| `E2E-01` | Playwright suite, desktop + mobile viewports, covering: build a deck from empty to 100, apply and partially dismantle a core package, exclude and confirm no re-suggestion | Green in CI on both viewports |
| `PERF-01` | Budgets from doc 07 §7.3 and doc 08 §8.5 enforced in CI | Regressions fail the build, not a dashboard |
| `A11Y-01` | Automated axe pass + a manual screen-reader script for both drag and tap paths | Zero critical violations; manual script documented and passing |
| `LEGAL-01` | Fan Content Policy compliance, attribution surfaces, name clearance (doc 04 §4.6) | Reviewed and signed off **before any public deployment** |

## 11.8 Suggested first wave

Six agents, no file conflicts, no ordering between them:

1. `FOUND-01` — must land first; everything else waits on it.
2. Then simultaneously: `DOM-01`→`DOM-02` · `DATA-01`+`DATA-02`+`DATA-05` ·
   `FOUND-02`→`UI-01` · `DB-01` · `DOM-07` · `DATA-03`+`DATA-04` (correspondence).

`DOM-02` is the highest-value early task: it is the feature that distinguishes
this product, it is pure, and it is fully testable before any data pipeline exists.
