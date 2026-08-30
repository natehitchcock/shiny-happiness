# 13. Synergy: shared themes, and not claiming what we did not check

Date: 2026-08-30

## Status

Accepted.

## Context

The deck pane labelled most of a deck **"no synergy"**. Two separate causes.

**Half the corpus has no synergy tags at all.** `deriveSynergy` reads oracle text
with regexes; it is a heuristic and it says so. Measured against the loaded
corpus:

```
cards                              34,492
with a `produces` tag              13,295
with a `wants` tag                  8,284
with neither                       16,684   (48%)
```

For those 16,684, `synergyMatches` returns nothing and `synergyScore` returns 0 —
which the cut hints read as "this card contributes no synergy". That is not what
it means. It means we did not read the card. The app was asserting something it
had never checked, on about half of every deck, and the volume of false labels
made the true ones impossible to pick out.

**Matching only counted two directions.** A match required either
`candidate.produces ∩ deck.wants` (enables) or `candidate.wants ∩ deck.produces`
(payoff). So three cards that all pay off +1/+1 counters, in a deck with nothing
that makes them, each reported no synergy with the other two — even though they
are in the deck for exactly the same reason.

## Decision

**1. A third direction, `theme`, for a want the deck already shares.**

`SynergyMatch.direction` gains `'theme'`: the candidate wants a tag that other
cards in the deck also want. Weighted at `THEME_WEIGHT = 0.2` of a normal match,
because a theme without an engine wins no games — it must never outrank the card
that actually provides what the deck wants.

Only where there was no stronger reading of the same tag. A card that already
pays off the deck's engine is not additionally credited for wanting what its
neighbours want; that is one fact counted twice.

A shared **produce** is deliberately *not* counted. Two sacrifice outlets are
redundancy, not synergy, and counting it would have every token deck claim that
every token maker synergises with every other one.

**2. `synergyMatches` takes `{ selfCounted }`.**

Every accepted card contributes its own wants to the deck profile, so a card
already in the deck would always share a theme with itself. Cut hints pass
`selfCounted: true`; recommendations, scoring cards that are *not* in the deck
and so contribute nothing to the profile, leave it false. Getting this wrong in
either direction is off by exactly one card, which is the difference between a
theme and no theme in a small deck.

**3. A new cut reason, `unknown-synergy`.**

A card with no derived tags gets `unknown-synergy` ("synergy unknown"), not
`no-synergy`. It carries `W_NO_SYNERGY / 3` rather than the full weight: not
zero, because a card we can say nothing about is weaker evidence of a keeper than
one we can; not the full weight, because the gap is in our ingest and charging
the card for it would push out cards whose text our regexes merely fail to read.

## Consequences

- `SynergyMatch.direction` and `RecommendationReason`'s `keyword-synergy`
  direction both widen to include `'theme'`. Additive; existing values unchanged.
- `CutReason` gains a variant. Any consumer switching on `kind` must handle it —
  the web app renders it as "synergy unknown", in the language of *our*
  uncertainty rather than the card's.
- Cut scores shift down slightly for untagged cards, so a deck's hint ordering
  changes. That is the point.
- **This does not fix the ingest.** 48% coverage is the real number and it is
  still 48%; this stops us from reporting the gap as a finding about the cards.
  Widening `PRODUCES`/`WANTS` is separate work, and this ADR makes its value
  measurable: the count of `unknown-synergy` hints is the coverage gap, visible.
