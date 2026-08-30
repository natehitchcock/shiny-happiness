# 16. Archetype customiser — scope

**Status: scoped, not built.** This document is the design for review. Nothing in
it is implemented.

Let a builder tune the role targets and the mana curve their deck is judged
against, instead of accepting the archetype preset.

## Why it is worth doing

The presets drive more of the app than their name suggests. An archetype's role
vector and curve shape decide the `fills-<role>` candidate groups, the
composition meters, the two-sided curve scoring, and — since ADR-0011 — the cut
hints. A builder who disagrees with the preset currently disagrees with all of
it at once, and has no recourse except picking a different archetype that is
wrong in a different way.

The presets are also honest about being approximations.
`archetype-targets.ts` says so in its own comment: *"Established deckbuilding
heuristics… not a claim of optimality"*. ADR-0008 removed the corpus that was
meant to replace them, so they are now the source of truth indefinitely. A
preset that cannot be corrected by the person using it is a worse position than
it was when a corpus was coming.

## What is tunable

| | Today | After |
| --- | --- | --- |
| Role ideals | `IDEALS[archetype]`, per role | per-deck override, per role |
| Role tolerance | fixed `min`/`max` around the ideal | one "how strict" setting per deck |
| Curve shape | `SHAPES[archetype]`, 8 buckets | per-deck override, per bucket |
| Curve tolerance | `TOLERANCE[archetype]`, one number | same setting as roles |

Deliberately **not** tunable in v1: the scoring weights (`ScoringWeights` is a
separate axis and a much sharper knife), the archetype blend ratio, and the
bracket/curve modifiers that `compositionTargets` applies on top.

## The shape of the data

**A sparse override, not a copy.** The deck stores only the dimensions the user
actually changed:

```ts
export interface TargetOverrides {
  /** Role → ideal card count. Absent means "use the archetype's". */
  readonly roles?: Readonly<Record<string, number>>
  /** Eight buckets, 0–7+. A sparse array; absent entries use the archetype's. */
  readonly curve?: Readonly<Record<number, number>>
  /** 0..1. Absent means the archetype's own tolerance. */
  readonly tolerance?: number
}
```

Sparse rather than a full snapshot for two reasons. The presets will be revised —
they are seed values and doc 14 expects them to improve — and a deck holding a
full copy would be frozen against whichever version it was created under, silently,
forever. And "reset this one role" is then just deleting a key, rather than
diffing against a preset the deck no longer remembers.

**Counts, not shares.** Builders think in "36 lands", not "34.2% of nonland
spells". The curve is stored as counts too and normalised to shares on read, so
the existing share-based `curveFit` is untouched.

## Where it plugs in

Both target functions already take everything else they need; each grows one
optional parameter, so every existing call keeps working:

```ts
compositionTargets(archetype, secondary, options, overrides?)
curveTarget(archetype, secondary, overrides?)
```

That is the whole domain change. `recommend`, `suggestCuts`, the composition
meters and the curve panel all consume the *output* of those two functions and
need no change at all — which is the argument for putting the override there
rather than anywhere else.

## Storage and contract

- Migration `0004`: `decks.target_overrides jsonb NOT NULL DEFAULT '{}'`.
- `Deck` gains `targetOverrides: TargetOverrides`. Additive, defaults to empty.
- `PATCH /decks/:id` accepts `targetOverrides`, replacing wholesale — the object
  is small and a merge protocol would be a second thing to get wrong.
- `GET /decks/:id/analysis` already returns `targets`; it gains `source:
  'archetype' | 'custom'` per dimension so the UI can mark what was changed.

No new endpoint. No change to `DeckCommand` — a target is a property of the deck,
not an operation on its contents, and putting it through the command batch would
make "I moved a slider" undoable in the same queue as "I added a card".

## The interface

A sheet, opened from the archetype label in the masthead. Two columns: roles on
the left, curve on the right, each row a number box with the preset shown beside
it in dim text, and a reset arrow that appears only on a changed row.

Three things it must do that a naive form would not:

- **Show the preset, always.** The value you are overriding is the context for
  the number you are typing. A box showing only `36` cannot tell you the
  archetype wanted 34.
- **Total as you type.** Roles and curve each sum, against 99. Over is a warning,
  not a block — a builder may knowingly aim high while cutting, exactly as they
  may knowingly cross a bracket line (doc 03 §3.2).
- **Say what changes.** On commit, the same change summary the bracket switch
  uses: which groups appear or disappear, how many cut hints change. Tuning a
  target with no visible consequence is how a user loses trust in the numbers.

Reduced to one sentence: it is the composition panel made editable, in place,
with the preset visible behind each field.

## What this does NOT include

- **Named, reusable archetypes** ("save as my Stax"). A per-deck override is a
  strictly smaller feature and answers the immediate complaint. Named archetypes
  need a per-user store, and that needs `API-03` first — there is no user yet.
- **Sharing or importing a tuned archetype.** Follows named archetypes.
- **Per-dimension min/max.** One tolerance for the deck keeps this a page of
  numbers instead of a spreadsheet. If a single tolerance proves too blunt, a
  per-dimension one is an additive change later.

## Open questions for you

1. **Does the curve editor earn its place in v1?** The roles half is what people
   actually argue with; the curve is already a range and is more forgiving. Half
   the build, most of the value — I would ship roles first and add the curve once
   the shape of the sheet is proven.
2. **Should an override survive an archetype change?** If you tune midrange and
   then switch to control, do your numbers follow, or reset? I lean **follow, and
   say so loudly** — silently discarding a user's typed numbers is worse than
   carrying numbers they may not want, and there is a reset for the latter.
3. **Is "over 99" a warning or a block?** I lean warning, per doc 03 §3.2's
   principle that the user may knowingly cross their own line.

## Estimate

Roles only: migration, one domain parameter, one PATCH field, one sheet — about
the size of the Universes Beyond change. With the curve editor: roughly half
again.
