# 9. Architecture

Chosen primarily for one property: **many agents can work in parallel without
colliding.** That means sharp package boundaries, a shared type contract, and a
pure core that can be built and tested with no infrastructure at all.

## 9.1 Monorepo layout

```
roundtable/
├── apps/
│   ├── web/            React + Vite SPA
│   ├── api/            Fastify HTTP service
│   └── ingest/         Scheduled ingestion workers
├── packages/
│   ├── domain/         ★ Pure types + logic. No IO. The contract.
│   ├── clients/        Third-party adapters (Scryfall, Spellbook, EDHREC)
│   ├── db/             Schema, migrations, repositories
│   └── ui/             Design-system primitives (no app logic)
├── docs/
└── infra/
```

pnpm workspaces + Turborepo. TypeScript everywhere, `strict: true`, no `any` in
committed code.

## 9.2 `packages/domain` is the contract

The most important rule in the codebase:

> `packages/domain` contains **only** types and pure functions. No `fetch`, no
> database, no filesystem, no `Date.now()`, no `Math.random()`. Everything in it is
> deterministic and unit-testable with zero setup.

It holds: entity types (doc 02), combo-degree computation, scoring, grouping,
composition targets, bracket rules, legality validation, decklist parsing.

Why it matters: `web` and `api` both depend on it, so the client can compute
recommendations optimistically and the server can compute them authoritatively
from *the same code*. There is no drift between what the phone shows and what the
server says. It is also the piece most amenable to being built by an agent working
alone against tests.

**Changing an exported type in `packages/domain` requires an ADR** and is a
blocking change for other agents. See [AGENTS.md](../AGENTS.md).

## 9.3 Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + TypeScript + Vite | Team-standard, fast HMR, easy code-splitting |
| Routing | React Router | Few routes; no need for a meta-framework |
| State | Zustand + TanStack Query | Zustand for deck/workspace state (simple, no boilerplate); Query for server cache |
| Drag & drop | **dnd-kit** | Pointer/touch/keyboard sensors, activation constraints, and a real accessibility story. `react-beautiful-dnd` is deprecated; HTML5 DnD has no touch support at all |
| Virtualisation | TanStack Virtual | Needed at L1/L2 |
| L0 renderer | Hand-written 2D canvas | 5,000 pips, no library needed |
| Styling | CSS Modules + design tokens | No runtime cost; tokens make theming and contrast auditable |
| Backend | Fastify + TypeScript | Fast, schema-first, JSON Schema validation shared with types |
| Database | PostgreSQL | Cards, combos, decks, stats. GIN indexes for the combo index |
| Cache | Redis | Recommendation results, EDHREC responses, rate-limit state |
| Object store | S3-compatible | Cached card imagery (doc 04 §4.1) |
| Tests | Vitest, Playwright | Unit/integration; Playwright for E2E incl. mobile viewports |

**Not Next.js**: the app is one authenticated, highly interactive workspace with
essentially no SEO surface and no content pages. SSR buys little and the framework
constrains the canvas/virtualisation work. Revisit if a public deck-sharing
surface is ever added — that would change the calculus. Recorded as
[ADR-0003](adr/0003-stack-selection.md).

## 9.4 Where computation happens

Recommendation generation runs **server-side** (it needs the combo index and stats),
returning grouped, annotated candidates. The client then applies **incremental
degree patches locally** on accept/exclude (doc 05 §5.8) so the re-grouping
animation is immediate rather than waiting on a round trip, and reconciles against
the server's authoritative recompute when it arrives.

Both sides run the identical `packages/domain` functions, so the optimistic result
and the authoritative result agree except where the dataset moved underneath. When
they disagree, the server wins and the client reconciles silently.

## 9.5 Data flow

```
Scryfall bulk ─┐
Spellbook     ─┼─→ apps/ingest ─→ Postgres ─┐
EDHREC        ─┘   (snapshot & swap)        │
                                            ├─→ apps/api ─→ apps/web
own corpus ─────→ stats aggregation ────────┘   (+ Redis)     (+ IndexedDB,
                                                               service worker)
```

## 9.6 Key non-functional requirements

- **Determinism**: identical deck + dataset snapshot ⇒ identical recommendations.
  Dataset snapshot id is returned with every recommendation response so a bug
  report can be reproduced exactly.
- **Degradation**: EDHREC unavailable ⇒ groups 6–7 vanish, everything else works
  (doc 05 §5.3). Spellbook unavailable ⇒ combo groups vanish, statistics remain.
  Neither is an error state; both are stated inline.
- **No secrets in the client.** All third-party access is server-side, which also
  makes rate limiting enforceable.
- **Budgets**: doc 07 §7.3 and doc 08 §8.5. Enforced in CI.
