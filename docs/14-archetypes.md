# 14. Deck archetypes

An archetype is the deck's **plan** — how it intends to win and what it needs to
get there. It is the missing input to composition targets: "how many lands should
I run" has no answer until you know whether this is an aggro deck or a control
deck, and the difference is four or five cards in several roles at once.

Doc 05 §5.4 already made targets a function of `(bracket, archetype, curve)`.
This document defines the archetype half.

## 14.1 The archetypes

Nine, chosen because each produces a *materially different* target vector. A
tenth that only shifts one number by one is not worth the choice it costs the user.

| Key | Name | The plan |
| --- | --- | --- |
| `aggro` | Aggro | Deploy threats early, attack, close before the table stabilises |
| `midrange` | Midrange | Efficient threats and answers; win by out-valuing everyone. **Default** |
| `control` | Control | Answer everything, draw more cards, win late with a small threat count |
| `combo` | Combo | Assemble a specific interaction; protect it; win from it |
| `ramp` | Ramp / Big mana | Accelerate hard, cast things nobody else can |
| `aristocrats` | Aristocrats | Sacrifice your own creatures for value and reach |
| `voltron` | Voltron | Make one creature enormous and unanswerable, usually the commander |
| `tokens` | Tokens / Go-wide | Flood the board, then make the board lethal |
| `stax` | Stax / Prison | Deny resources and win slowly under a locked table |

**Typal (tribal) is not an archetype.** "Goblins" is a *theme* that sits on top of
one — Krenko goblins is `tokens` or `aggro`, Sliver Overlord is `combo`. Themes
are handled by synergy scoring (doc 05), not by target vectors. Conflating them
would give us thirty archetypes that mostly differ by creature type.

### Hybrids

A deck may declare a **primary and an optional secondary** archetype
(`combo` + `control` is a real and common deck). Targets blend **70/30** toward
the primary, rounded to whole cards. Two archetypes is the cap: a deck claiming
three has no plan.

## 14.2 Targets per archetype

Composition targets generalise from roles to a **dimension**, because the user's
question is both "how much ramp" (a role) and "how many creatures" (a type):

```ts
type CompositionDimension =
  | { kind: 'role'; role: Role }
  | { kind: 'type'; type: CardType }   // creature, instant, sorcery, artifact, ...

interface CompositionTarget {
  dimension: CompositionDimension
  min: number; ideal: number; max: number
}
```

**Seed ideals.** `DATA-03` and `ING-05` are not coming — [ADR-0008](adr/0008-drop-edhrec.md)
removed the corpus these were to be replaced by, so they are the source of truth
indefinitely rather than a placeholder. Still not a claim of optimality; the
reasoning for each row now lives beside it in
`packages/domain/src/archetype-targets.ts`, because a number nobody can argue
with is a number nobody can correct.

| | land | ramp | draw | spot-rem. | wipe | tutor | protect. | creature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aggro | 35 | 9 | 8 | 7 | 1 | 2 | 4 | 32 |
| midrange | 36 | 11 | 9 | 8 | 3 | 3 | 4 | 26 |
| control | 36 | 11 | 12 | 12 | 5 | 3 | 5 | 14 |
| combo | 34 | 13 | 10 | 6 | 1 | 8 | 7 | 20 |
| ramp | 37 | 15 | 9 | 6 | 3 | 3 | 4 | 22 |
| aristocrats | 35 | 10 | 9 | 7 | 3 | 4 | 4 | 30 |
| voltron | 36 | 10 | 8 | 8 | 2 | 5 | 7 | 12 |
| tokens | 35 | 10 | 8 | 7 | 2 | 3 | 4 | 24 |
| stax | 35 | 12 | 8 | 8 | 3 | 5 | 5 | 16 |

Archetype-specific dimensions, applied only where the archetype names them:

| Archetype | Additional targets |
| --- | --- |
| aristocrats | `sac-outlet` 5, `recursion` 7 |
| voltron | `equipment` 7, `aura` 3, `evasion` 3 |
| tokens | `token-maker` 14, `anthem` 5 |
| stax | `stax` 12 |
| combo | (tutors and protection already raised above) |

**Two constraints bind the table, and the first revision to it broke on both.**

*Roles do not overlap.* Composition counts by `primaryRole`, so `land + Σ roles`
is a budget against 99 and the remainder is the deck's threats and payoffs. The
first voltron row spent 97 of 99 and went over outright at bracket 4, because it
was written as though `protection` and `equipment` were separate cards — under
`ROLE_PRECEDENCE` a pair of Lightning Greaves is protection, not equipment, and
almost every evasion-granter in the deck is counted as something else first. A
vector no deck can be built to is also a vector `assessArchetype` can never
match, so the archetype quietly became unreachable.

*Lands are the neutral-curve number.* The curve modifier below removes a land
under 2.8 average mana value and adds one over 3.5. Aggro's own target curve sits
at ~2.7 and control's at ~3.8, so both trip it every time — and if the base
number had already priced that in, the shift would be applied twice. It had been:
aggro was settling at 33 lands and control at 38. The table now holds the count
at a neutral curve, and aggro settles at 34, control at 37.

The **bracket and curve modifiers from doc 05 §5.4 still apply on top** — they are
orthogonal. A Bracket 5 combo deck gets the combo row plus the bracket-5 draw and
interaction bumps.

### New roles this requires

`sac-outlet`, `token-maker`, `anthem`, `equipment`, `aura`, `evasion` are added to
the `Role` union. That is a `packages/domain` contract change, recorded in
[ADR-0005](adr/0005-archetypes.md) per R2.

## 14.3 Archetype is suggested, not demanded

Making someone choose blind from nine options before they have seen a single card
is a bad first experience, and most commanders have an obvious answer.

On commander selection, the app **ranks the archetypes for that commander** from
the project's own imported-deck corpus, and preselects the top one with its
reason visible:

> **Tokens** — 54% of Krenko decks build this way
> Also common: Aggro (31%) · Combo (9%)

- The suggestion is preselected, not forced; every archetype stays one tap away.
- With no statistics available (a new or obscure commander), default to `midrange`
  and say so — `midrange` is the least-wrong default because its targets are the
  base table.
- Archetype is **changeable at any time**, and the creation flow says so, so the
  choice carries no weight.

## 14.4 What archetype changes, and what it does not

**Changes:**

- Composition targets, and therefore the header meters and every
  `fills-<dimension>` candidate group (doc 05 §5.3).
- Default scoring weights: `aggro` raises `w_curve`, `combo` raises `w_combo` and
  `w_tutor`, `control` raises the interaction component of `roleDeficitFit`.
  Weights stay user-overridable; archetype only moves the defaults.
- Core package selection within a bracket, where the corpus supports an
  archetype-specific package (doc 03 §3.3). Where it does not, the bracket's
  general package is used — never a silently worse guess.

**Does not change:**

- Any accepted card. Switching archetype is not destructive, exactly like
  switching bracket (doc 03 §3.3, P6). Deficits move; the deck does not.
- Legality, bracket compliance, or combo detection — all archetype-independent.

Switching produces the same honest summary as a bracket change:
*"Midrange → Control: ramp 11→11, draw 9→12, interaction 8→12, creatures 26→14.
Nothing was added or removed."*

## 14.5 Assessed archetype

Like `assessed` vs `target` bracket (doc 10 §10.5), the app reports what the deck
**actually looks like** alongside what you said it was.

```ts
assessArchetype(deck: Deck, targets: ArchetypeTargets): {
  assessed: ArchetypeKey
  confidence: number              // 0..1
  distances: Record<ArchetypeKey, number>
}
```

Build the deck's composition vector over the shared dimensions, normalise, and
take the nearest archetype by weighted Euclidean distance. Deterministic, pure,
and explainable — the user can be shown *which dimensions* pushed the assessment.

Surface it only when it disagrees meaningfully (different archetype, confidence
above a threshold), as a note rather than a warning:

> This reads more like **Midrange** than Aggro — your curve is 3.4 and you are at
> 12 interaction. Switch target, or keep building?

Never auto-switch. The user's stated plan is the plan; the assessment is
information, and a tool that silently rewrites your intent is a tool you stop
trusting.

## 14.6 In the creation flow

Archetype is **step 2** of the four in doc 12 §12.5, between commander and bracket:

1. Pick a commander
2. **Pick an archetype** — nine cards, the suggested one preselected with its
   statistic, a "why these numbers" disclosure showing the target vector
3. Pick a target bracket
4. Offer the core package

Each archetype card shows its name, a one-line plan, and its three most
*distinguishing* numbers versus midrange (control shows `draw 12 · removal 12 ·
creatures 14`) — not all eight, which is unreadable, and not none, which makes
the choice arbitrary.
