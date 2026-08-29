# ADR-0002: Data source selection

- **Status:** Accepted (pending verification tasks DATA-01…05)
- **Date:** 2026-08-29

## Context

The app needs four kinds of external data: card data and imagery; combo data;
aggregate deck statistics; and deck import. Candidate sources are Scryfall,
Commander Spellbook, EDHREC and Moxfield. They differ enormously in how
legitimately available they are, and that difference has to drive the design
rather than be discovered after launch.

## Decision

| Need | Source | Status |
| --- | --- | --- |
| Cards, imagery, legality | **Scryfall** | Primary. Bulk data, rate-limited, images cached to our own store |
| Combos | **Commander Spellbook** | Primary. Structured combo data is the only viable source for combo degree |
| Aggregate statistics | **EDHREC**, plus our own corpus | Careful use, cached hard, permission requested, feature-flagged until answered |
| Deck import | **User-pasted text / file upload** | Primary. Zero third-party risk, covers every site |
| Deck import from URL | Moxfield | **Out of scope.** Adapter seam exists and returns `NotAuthorizedError`; not pursued |

All access goes through `packages/clients` behind narrow interfaces
(`CardSource`, `ComboSource`, `StatsSource`, `DeckImporter`) sharing one rate
limiter and cache.

## Consequences

- Combo degree — the product's differentiating feature — depends on Commander
  Spellbook. If that source becomes unavailable the feature degrades to nothing.
  Mitigation: keep a local snapshot; the data changes slowly. Accepted risk.
- EDHREC dependency is the fragile one: undocumented endpoints, no contract. Every
  EDHREC-derived feature must degrade cleanly (doc 05 §5.3). This is designed in,
  not bolted on.
- Dropping Moxfield costs the URL-import convenience and some bracket×colour
  correlation data. The text importer covers the actual user need — and covers
  Archidekt and TappedOut too, which a Moxfield integration never would — while
  EDHREC plus our own corpus covers the statistics.
- Card imagery must be cached to our own object store, which is real cost and real
  work (`ING-04`), and is required by Scryfall's guidelines regardless.

## Alternatives considered

- **Deriving combos from EDHREC synergy or from oracle text.** Rejected: synergy
  is not combo-hood, and no text parser finds "these three permanents loop".
- **Scraping Moxfield.** Rejected: they actively block automated access. Routing
  around access controls is not something this project does, and it would be a
  fragile foundation even if it were.
- **MTGJSON instead of Scryfall.** Viable for card data, weaker for imagery and
  Commander-specific fields. Revisit if Scryfall terms become a problem.
- **Building our own combo database.** Enormous ongoing curation cost for a worse
  result than a mature community project. Revisit only if Spellbook disappears.
