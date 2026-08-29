# ADR-0005: Deck archetypes and the role additions they require

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Composition targets (doc 05 §5.4) were specified as a function of
`(bracket, archetype, curve)`, but archetype was never defined — the seeded table
was effectively a midrange deck's numbers presented as universal. That is wrong in
a way users would notice immediately: telling a control player they are four cards
over on interaction, or an aggro player they are two lands short, is worse than
saying nothing.

The user's original request also asked for counts of *creatures, sorceries and
enchantments*, which the role-only `CompositionTarget` could not express at all.

## Decision

1. Introduce nine archetypes (doc 14 §14.1), each with a target vector. A deck
   carries a primary and an optional secondary, blended 70/30.
2. Generalise `CompositionTarget` from a `Role` to a `CompositionDimension` —
   either a role or a card type — so type counts are first-class.
3. Extend the `Role` union with six roles the archetype targets need:
   `sac-outlet`, `token-maker`, `anthem`, `equipment`, `aura`, `evasion`.
4. Suggest the archetype from commander statistics rather than demanding a blind
   choice, defaulting to `midrange` when no statistics exist.
5. Report an `assessed` archetype beside the declared one, never auto-switching.

Typal/tribal is explicitly **not** an archetype — it is a theme handled by synergy
scoring.

## Consequences

- **This is a `packages/domain` contract change** (R2), which is why it is an ADR.
  `Role` gains six variants and `CompositionTarget` changes shape. Every exhaustive
  `switch` over `Role` becomes a compile error until updated — which is the
  intended behaviour of the `never`-default convention (doc 07 §7 of AGENTS.md) and
  the reason the union is a union.
- Role derivation (`DOM-04`) gets six more categories to get wrong, and the
  curated override table grows. `token-maker` and `evasion` in particular are hard
  to derive from oracle text and will lean on the curated list.
- Nine archetypes × colour identities multiplies the core-package generation
  matrix (doc 05 §5.5). Mitigation: archetype-specific packages are generated only
  where the corpus supports them; otherwise the bracket's general package is used.
  Never emit a package generated from too few decks.
- Users now make one more choice during creation. Mitigated by preselecting the
  statistically likely archetype with its reason shown, and by making the choice
  reversible at any time with no data loss.

## Alternatives considered

- **No archetypes; one universal target table.** The status quo ante. Simple, and
  wrong for roughly every deck that is not midrange. Rejected.
- **Free-text or tag-based archetypes.** Maximum flexibility, no target vectors —
  which is the entire point of the feature. Rejected.
- **Deriving archetype automatically and never asking.** Tempting, but a deck is
  ~15 cards in before its shape is legible, and those are exactly the cards where
  target guidance matters most. We do both: ask, then assess and report
  disagreement (§14.5).
- **Adding an `ArchetypeTag` layer instead of extending `Role`.** Avoids the
  contract change, but a sacrifice outlet is a sacrifice outlet regardless of the
  deck it is in — that is a role, and modelling it as archetype-relative would be
  a lie that complicates every consumer.
- **Twenty-plus archetypes** (group hug, chaos, landfall, blink, wheels…). Most
  differ from an existing row by one or two cards. Rejected for choice paralysis;
  revisit individually if corpus data shows a genuinely distinct target vector.
