# 45. The focus offer says "related", and `INTERACTION_PAIRS` stays unordered

Date: 2026-09-02

## Status

Accepted.

> **Number 0045 is taken by this ADR.** The next agent should take 0046.

## Context

A user asked for the focus picker to keep going:

> "when selecting a focus, after one is selected, it should add any semantics
> that benefits from that focus or causes that focus, and allow you to add more
> from those, until you are satisfied. maybe even have a 'show all semantics'
> button"

The wording is **directional**. It names two relations — "benefits from that
focus" and "causes that focus" — and asks for the union of both.

This is the third feature to arrive at the same debt. [ADR-0023](0023-damage-to-a-player-is-not-life-loss.md)
found a one-way relation (`player-damage` → `lifeloss`), kept it out of
`INTERACTION_PAIRS`, and noted that a second one-way relation would make an
ordered table the honest answer. [ADR-0029](0029-dealing-damage-is-its-own-event.md)
added `damage` ↔ `creature-death` as the third such shape and called an ordered
table **overdue**.

So the question had to be settled rather than deferred again: give the table a
direction, or ship a symmetric expansion and say plainly in the interface that
it offers "related", not "causes"/"benefits from". Shipping symmetric while the
interface claims direction was never an option — that is a UI stating something
the model does not hold.

## Decision

**The table stays unordered. The interface says "related".** `synergy.ts` is not
modified by this feature at all; `relatedSemantics` in `semantic-emphasis.ts`
reads `interactsWith` and nothing else.

### Why direction is not information the table lost

The decisive point is what `INTERACTION_PAIRS` actually contains. Its docblock
sets one admission criterion — a pair is admitted only when it "reads true in
both directions" — and both prior ADRs applied it as a filter, refusing entries
that failed:

- `player-damage` ↔ `lifeloss`, refused by ADR-0023, because damage to a player
  *is* life loss but life loss is not damage.
- `player-damage` ↔ `attack-trigger`, `damage` ↔ `player-damage`, `damage` ↔
  `lifeloss`, `damage` ↔ `plus1-counter`, `discard` ↔ `opponent-discard`,
  `sacrifice-fodder` ↔ `opponent-sacrifice`, `graveyard-creature` ↔
  `opponent-discard` — all refused, each with a reason on the row.

Every one of the 30 surviving rows was therefore *selected for* bidirectional
truth. Asking "which direction is `token` ↔ `sacrifice-fodder`?" has the answer
"both", because that is why it is in the table. Assigning directions to those
rows would not recover something the unordered form discarded; it would invent
something the admission criterion deliberately excludes, thirty times, on a
judgement per row that this project's own standard says must be measured or
argued rather than guessed.

Two or three rows (`creature-death` ↔ `graveyard-creature`, `damage` ↔
`creature-death`) are one-way in the *mechanics* and were admitted anyway
because they read true in English. Directing the whole table to serve those and
fabricating directions for the other twenty-seven is a bad trade.

### Why the words matter more than usual here

"Causes" and "benefits from" are **already taken**, one panel over. The card
preview labels a card's own `produces` and `wants` with exactly those two
phrases, and `tags.ts` says the tag vocabulary is written to slot in after
them. That relation *is* directional, needs no table, and is the other reading
of the user's sentence. Reusing the same two words for a symmetric cross-tag
relation would make the interface say one thing in two incompatible ways.

There is also existing precedent for the honest phrasing: `TagChip` already
renders this very list as *"Benefits, and benefits from: …"*, a sentence ADR-0023
cites as symmetric in English on purpose. The new offer agrees with it.

### What the user asked for is still delivered

The user's sentence is an **or** over both directions — the union. A symmetric
table returns exactly that union. Direction would only have allowed splitting
one list into two headings, which is presentation, not capability. Nothing in
the request is unmet by the symmetric answer; only a heading would have changed.

A test pins the wording so it cannot drift back: the offer's rendered text must
not match `/\bcauses?\b/` or `/\bbenefits? from\b/`, and must match
`/related|alongside/`.

## Consequences

The debt ADR-0023 and ADR-0029 recorded is **not paid, and is now argued rather
than merely deferred.** A future agent who needs direction should read this
first: the cost is not "add a field", it is re-adjudicating thirty rows whose
selection criterion was symmetry. The case that would justify it is a feature
that must distinguish "what causes X" from "what X causes" *across* tags — this
one does not, because the user asked for both at once.

### The expansion saturates, so "show all" is not decoration

Measured over the 21 tags and 30 pairs:

| | value |
| --- | --- |
| Connected components | **1** — every tag reaches every other |
| Mean degree (first offer) | **2.9**, median 2 |
| Largest degree | `token` 8, `creature-death` 6; 14 of 21 tags have ≤ 3 |
| Mean reach at 2 hops | **9.3 of 21**; worst case `creature-death` **18 of 21** |
| Offer size after 3 greedy hub picks | up to **12** chips |

So the offer is small and meaningful for the first pick or two, and degenerates
toward a slower "show all" if the builder walks the two hubs. Confirmed in the
browser on a mono-black Tergrid deck: three picks
(`opponent-sacrifice` → `creature-death` → `token`) left 7 chips on offer and
only 6 in "show all".

That is why **"Show all semantics" is a first-class control, not a maybe**: it is
the only route to a tag no chosen focus neighbours, the only control that exists
before a focus does, and the way to skip a five-hop walk (`landfall` is five hops
from `player-damage`) for a builder who already knows what they want. It stays
collapsed so the panel is not a wall of 21 toggles.

### The offer is ranked, which needed a new field

`RecommendResult.emphasis` reports support counts for the *emphasised* tags only,
and the offer is by definition unemphasised. `tagSupport` adds the same count for
all 21 tags — computed in the pass that already produced `emphasis`, so it costs
nothing. Without it the offer would be ordered by nothing and would lead with
whichever tag sorts first, including one no card in the deck's colours supports.

A tag with zero support is **still offered**, and says so, because emphasis
reorders and never filters. It just does not lead.
