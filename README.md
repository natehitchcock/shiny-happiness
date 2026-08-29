# Roundtable

A web app for building **Magic: The Gathering Commander (EDH)** decks, built around
two ideas: _scalable focus_ — you decide how much of your deck you look at, at how
much detail — and _combo-aware candidate generation_ — suggestions are grouped by
how many combos they complete with cards you have already accepted.

> `Roundtable` is a placeholder codename. Rename freely.

**Status: the domain layer is complete.** `packages/domain` — the pure, shared
contract that `web` and `api` both run — is built and tested end to end: entity
types, combo degree and its incremental patch, role derivation, archetype targets,
legality, composition analysis, the candidate query language, the grouping and
scoring engine, and decklist import/export. 254 tests, no IO, no infrastructure
required.

What remains needs a database, a browser, or an answer from a third party. See
[docs/11-work-breakdown.md](docs/11-work-breakdown.md) §11.8.

**Picking this up fresh?** Start at
[docs/11-work-breakdown.md §11.0](docs/11-work-breakdown.md) — what is done, what
is next, what is blocked and why — then [AGENTS.md](AGENTS.md).

## Read in this order

| Doc                                                                                | What it settles                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [docs/01-vision-and-pillars.md](docs/01-vision-and-pillars.md)                     | What we are building, what we are not, non-negotiable pillars                |
| [docs/02-domain-model.md](docs/02-domain-model.md)                                 | Entities, states, and the precise definition of _combo degree_               |
| [docs/03-brackets-and-legality.md](docs/03-brackets-and-legality.md)               | Commander Brackets 1–5, Game Changers, deck legality                         |
| [docs/04-data-sources.md](docs/04-data-sources.md)                                 | Scryfall, Commander Spellbook, EDHREC, Moxfield — what we may and may not do |
| [docs/05-scoring-and-recommendations.md](docs/05-scoring-and-recommendations.md)   | Grouping, scoring formula, composition targets, core packages                |
| [docs/ux/06-information-architecture.md](docs/ux/06-information-architecture.md)   | Accepted / Candidate regions, grouping, card states                          |
| [docs/ux/07-focus-scaling.md](docs/ux/07-focus-scaling.md)                         | The four zoom levels and what each is for                                    |
| [docs/ux/08-mobile.md](docs/ux/08-mobile.md)                                       | Phone layout, touch interactions, the no-drag-only rule                      |
| [docs/09-architecture.md](docs/09-architecture.md)                                 | Monorepo layout, stack, package boundaries                                   |
| [docs/10-api-contract.md](docs/10-api-contract.md)                                 | HTTP surface between web and api                                             |
| [docs/11-work-breakdown.md](docs/11-work-breakdown.md)                             | Parallelizable task graph for implementing agents                            |
| [docs/12-deck-library-and-persistence.md](docs/12-deck-library-and-persistence.md) | Saving, switching decks, offline sync, snapshots                             |
| [docs/13-candidate-query.md](docs/13-candidate-query.md)                           | Scryfall-style query filter for the candidate pool                           |
| [docs/14-archetypes.md](docs/14-archetypes.md)                                     | Deck archetypes and the composition targets they drive                       |
| [docs/15-import-export.md](docs/15-import-export.md)                               | Getting decklists in and out; export before delete                           |
| [AGENTS.md](AGENTS.md)                                                             | **Rules every implementing agent must follow**                               |

Architecture decisions with lasting consequences are recorded in [docs/adr/](docs/adr/).

## Getting started

```bash
pnpm install
pnpm check        # lint + typecheck + test
pnpm build
```

Requires Node 22+ and pnpm 10. `pnpm check` is what CI runs on every PR.

`packages/db`'s tests run against a **real PostgreSQL**, never a mock — array
containment, partial unique indexes and `SELECT … FOR UPDATE` are exactly what is
worth testing, and none of them exist in a fake. Point `DATABASE_URL` at any
Postgres 16 and they run; without it they skip with a warning rather than
silently passing.

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
pnpm test
```

```
apps/
  web/      React SPA          — WEB-01 replaces the tsc build with Vite
  api/      Fastify HTTP service
  ingest/   Scheduled ingestion workers
packages/
  domain/   ★ Pure types + logic. No IO. The shared contract.
  clients/  Third-party adapters behind one rate limiter
  db/       Schema, migrations, repositories
  ui/       Design-system primitives
```

**The purity rule is enforced, not just documented.** ESLint rejects IO imports,
`Date.now()`, `Math.random()`, `new Date()` and bare `fetch` inside
`packages/domain`, and rejects `fetch` anywhere outside `packages/clients`
(AGENTS.md R1 and R3). Try it: add `Date.now()` to a domain file and run
`pnpm lint`.

### Toolchain note

TypeScript is pinned to `~6.0.3`. TypeScript 7 (the native compiler) builds and
typechecks this repo fine, but `typescript-eslint` does not support it yet, and
lint is where R1 and R3 are enforced — so the pin holds until typescript-eslint
ships TS 7 support.

## The shape of the app, in one picture

```
┌──────────────────────────────────────────────────────────────────────┐
│ [art] Krenko, Mob Boss        Bracket 3 ▾    64/100   zoom ▁▃▅█      │
│ lands 34/36 · ramp 8/11 · draw 6/9 · interaction 5/8 · GC 2/3        │
├───────────────────────────────────┬──────────────────────────────────┤
│ ACCEPTED                          │ CANDIDATES                       │
│  ▸ Core · Bracket 3          24   │  ▸ Completes 3+ combos       6   │
│  ▸ Lands                     34   │  ▸ Completes 2 combos       14   │
│  ▸ Ramp                       8   │  ▸ Completes 1 combo        38   │
│  ▸ Interaction                5   │  ▸ Fills gap: Ramp −3       22   │
│  ▸ Draw                       6   │  ▸ Top sorceries (EDHREC)   10   │
│  ▸ Win conditions             4   │  ▸ High synergy             50   │
└───────────────────────────────────┴──────────────────────────────────┘
```

Both regions share one zoom level, so "spread everything out in front of me" is a
single control. On a phone the two regions become a scrolling candidate feed with
the deck as a bottom sheet — see [docs/ux/08-mobile.md](docs/ux/08-mobile.md).

## Licensing and fan content

This project displays Wizards of the Coast card data and imagery. Before any
public deployment, it must comply with the WotC Fan Content Policy and with the
terms of every upstream data source. See
[docs/04-data-sources.md](docs/04-data-sources.md) — this is tracked as real work,
not a footnote.
