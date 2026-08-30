# ADR-0011: Deck shaping controls — provenance, budget, curve and synergy

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Six features were requested together. They are listed separately below because
they ship separately, but three of them share one root cause, and naming it is
most of this ADR's value.

`apps/api/src/deck-context.ts` builds the candidate pool with
`priceUsd: null, rarity: null, setCode: null, reserved: false`, because `ING-01`
ingests Scryfall's `oracle_cards` export — **one printing per card**. Printing
data therefore does not exist for candidates, which silently disables three
things that are otherwise fully implemented:

- Budget scoring. `recommend.ts` computes a budget overrun penalty and
  `ScoringWeights.budget` weights it; both are dead code against a null price.
- `price:` in the candidate query language (`DOM-08`).
- `is:reserved` in card search, which `API-01` had to reject outright.

`ING-01` moving to the `default_cards` export — every printing, roughly 110k
records rather than 38k — fixes all three, and is also what makes Universes
Beyond detectable at all.

## Decisions

### 1. Universes Beyond is a property of a card, not of a printing

`promo_types` containing `universesbeyond` is printing-level. Scryfall's
`oracle_cards` export picks an arbitrary printing per card, and on 2026-08-30 the
one it picked for **Sol Ring** was from `msc` with
`promo_types: ['surgefoil', 'universesbeyond']`. Filtering on that flag would
have dropped Sol Ring from every deck.

**A card is Universes Beyond iff EVERY printing of it carries the flag.** Sol Ring
has ordinary printings and survives; `Bill the Pony` (`set=ltr`,
`promo_types: ['universesbeyond']`, no other printing) does not. Verified on
2026-08-30 that the flag is present on ordinary non-promo UB printings, not only
on promos — the rule would be worthless otherwise.

Stored as `cards.universes_beyond`, computed at ingest across all printings.

**It filters rather than flags.** This is the opposite of the bracket rule
(doc 03 §3.2, AGENTS.md §8), and deliberately so: a bracket is a social contract
the user may knowingly cross, whereas "I don't want Warhammer cards in my Magic
deck" is a taste preference with no reason to keep offering. It is a per-deck
setting, so it survives reopening the deck.

### 2. Prices are estimates, and the UI must say so

Hydrating prices makes `ADR-0009` Q7 binding on the interface:

> "prices should be considered dangerously stale after 24 hours … You consume
> price information at your own risk."

Two thresholds are supported, both already on `Deck.budget`: `maxCardUsd` and
`maxTotalUsd`. Every price renders as an estimate with the snapshot date, and the
deck total is **never** presented as what the deck costs to buy. Over-threshold
cards are scored down, not hidden — unlike Universes Beyond, a price limit is a
budget the user may knowingly exceed for one card, which is exactly the bracket
situation.

### 3. The curve target is a shape, not a flat share

The existing `curveFit` is:

```ts
return Math.max(0, 0.25 - share) * 4
```

It compares every bucket against a flat 25%. With eight buckets an even deck sits
at 12.5%, so every bucket scores positive; and `Math.max(0, …)` means an
over-full bucket is never penalised, only un-rewarded. A deck with thirty
two-drops gets no signal to stop.

Replaced with a per-archetype target **distribution** over buckets 0–7, compared
two-sided so an over-represented mana value pushes a card down. Aggro skews low,
control high, combo mid — the same table that already varies role targets by
archetype (doc 14 §14.2), extended to the curve.

### 4. Synergy is mechanical, not statistical

`ADR-0008` removed EDHREC, which left candidate group 7 `high-synergy`
permanently empty — it was defined as "EDHREC synergy above threshold".

It is refilled with **mechanical** synergy: a vocabulary of `SynergyTag` events
where each card `produces` an event or `wants` it. A commander with a death
trigger wants `creature-death`; a sacrifice outlet produces it. A candidate scores
when its `produces` meets the deck's `wants`, or its `wants` meets the deck's
`produces` — both directions, because adding a payoff for something the deck
already does is worth as much as adding an enabler for a payoff it already has.
Commander contributions are weighted above accepted cards.

This is arguably the better signal: a statistic says *that* a card is played
together with another, while a mechanism says *why*, which is what pillar P4
requires the reason to carry.

Derived at ingest into `cards.synergy_produces` and `cards.synergy_wants`, the way
`roles` already is. Deriving over 34k cards per request would not fit the 200 ms
budget (`API-02`).

## Contract changes (AGENTS.md R2)

| Change | Breaking? |
| --- | --- |
| `Reason` gains `{ kind: 'keyword-synergy', tag, direction, withOracleIds }` | New variant. Exhaustive switches over `Reason` become compile errors until updated — which is the point. |
| `Reason`'s `curve-fit` gains optional `delta` and `direction` | No. Adding an optional field is not a contract change. |
| `ScoringWeights` gains `keywordSynergy` | No. It has a default in `DEFAULT_WEIGHTS`. |
| `Deck` gains `excludeUniversesBeyond: boolean` | No. Defaults to `false`; absent means absent. |
| `Card` gains `universesBeyond`, `synergyProduces`, `synergyWants` | New required fields on an interface the ingest constructs. Every construction site is in this repo. |

Migrations `0002` (Universes Beyond) and `0003` (synergy columns) are separate, so
each feature reverts independently.

## Consequences

- `ING-01` gets slower: two passes over a larger export. Acceptable — it runs
  weekly (ADR-0009 Q3), and it is the only way to have printings at all.
- `is:reserved` and `price:` can be **un-rejected** in `/cards/search`
  (doc 10 §10.9 item 3) once printings are hydrated. That item shrinks.
- The synergy heuristics will be wrong on some cards, exactly as role derivation
  is (doc 02 §2.4). The curated override table is the answer, and it is expected
  to grow rather than be engineered away.
- Universes Beyond filtering is a **user setting**, never a default. The corpus
  keeps every card; only the deck's view of it narrows.
