# ADR-0004: Semantic zoom over continuous scaling

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Pillar P2 requires moving between "the whole pool at once" and "one card in full
detail". The naive implementation is a continuous CSS scale transform on a single
card representation.

## Decision

Four discrete semantic levels (L0 Constellation, L1 Grid, L2 Card, L3 Detail),
each with its own representation and its own rendering strategy, with animated
transitions between them. No continuous intermediate scaling.

## Consequences

- Each level is legible by construction. A continuously scaled card is unreadable
  through most of its range — too small to read, too large to compare.
- Each level can use the right rendering technology: canvas for 5,000 pips, DOM
  for everything that needs hit-testing, drag and accessibility.
- Four representations of a card must be built and maintained (`UI-01`), and each
  needs its own accessibility treatment. L0 in particular needs a parallel
  non-canvas path.
- Zoom anchoring must be implemented explicitly, since there is no single
  transform to preserve. Losing your place on zoom-out is the failure mode that
  makes semantic zoom feel hostile, so this is a first-class requirement, not a
  polish item.

## Alternatives considered

- **Continuous scale transform.** Simplest, and illegible across most of its
  range. Rejected.
- **Two levels (grid and detail).** Loses the "see everything at once" view, which
  is the whole point of P2 and the only way 5,000 candidates are viewable on a
  phone at all. Rejected.
- **More than four levels.** No clear distinct representation for a fifth; adds
  control complexity for no informational gain.
