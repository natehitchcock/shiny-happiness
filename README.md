# Roundtable

A web app for building **Magic: The Gathering Commander (EDH)** decks, built around
two ideas: *scalable focus* — you decide how much of your deck you look at, at how
much detail — and *combo-aware candidate generation* — suggestions are grouped by
how many combos they complete with cards you have already accepted.

> `Roundtable` is a placeholder codename. Rename freely.

**Status: specification only.** There is no implementation yet. This repository
currently contains the design, the domain rules, and the work breakdown that
implementing agents will build from.

## Read in this order

| Doc | What it settles |
| --- | --- |
| [docs/01-vision-and-pillars.md](docs/01-vision-and-pillars.md) | What we are building, what we are not, non-negotiable pillars |
| [docs/02-domain-model.md](docs/02-domain-model.md) | Entities, states, and the precise definition of *combo degree* |
| [docs/03-brackets-and-legality.md](docs/03-brackets-and-legality.md) | Commander Brackets 1–5, Game Changers, deck legality |
| [docs/04-data-sources.md](docs/04-data-sources.md) | Scryfall, Commander Spellbook, EDHREC, Moxfield — what we may and may not do |
| [docs/05-scoring-and-recommendations.md](docs/05-scoring-and-recommendations.md) | Grouping, scoring formula, composition targets, core packages |
| [docs/ux/06-information-architecture.md](docs/ux/06-information-architecture.md) | Accepted / Candidate regions, grouping, card states |
| [docs/ux/07-focus-scaling.md](docs/ux/07-focus-scaling.md) | The four zoom levels and what each is for |
| [docs/ux/08-mobile.md](docs/ux/08-mobile.md) | Phone layout, touch interactions, the no-drag-only rule |
| [docs/09-architecture.md](docs/09-architecture.md) | Monorepo layout, stack, package boundaries |
| [docs/10-api-contract.md](docs/10-api-contract.md) | HTTP surface between web and api |
| [docs/11-work-breakdown.md](docs/11-work-breakdown.md) | Parallelizable task graph for implementing agents |
| [docs/12-deck-library-and-persistence.md](docs/12-deck-library-and-persistence.md) | Saving, switching decks, offline sync, snapshots |
| [docs/13-candidate-query.md](docs/13-candidate-query.md) | Scryfall-style query filter for the candidate pool |
| [docs/14-archetypes.md](docs/14-archetypes.md) | Deck archetypes and the composition targets they drive |
| [docs/15-import-export.md](docs/15-import-export.md) | Getting decklists in and out; export before delete |
| [AGENTS.md](AGENTS.md) | **Rules every implementing agent must follow** |

Architecture decisions with lasting consequences are recorded in [docs/adr/](docs/adr/).

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
