# 16. Archetype customiser

**Status: built.** Roles, curve and tolerance are all tunable per deck. The three
open questions at the end are answered, with the reasoning kept rather than
deleted — and §16.10 records where the build diverged from this design and why.

Let a builder tune the role targets and the mana curve their deck is judged
against, instead of accepting the archetype preset.

No ADR. Every contract change is a NEW OPTIONAL FIELD — `Deck.targetOverrides`,
`CompositionTarget.source`, `CurveBand.source`, `fills-deficit`'s `source`, and
one optional parameter each on `compositionTargets` and `curveTarget`. Nothing
existing changed shape or went away, which is exactly the line AGENTS.md R2
draws.

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
  /** Dimension key (`role:ramp`, `type:creature`) → ideal card count. */
  readonly roles?: Readonly<Record<string, number>>
  /** Eight buckets, 0–7+. Sparse; absent entries use the archetype's. */
  readonly curve?: Readonly<Record<number, number>>
  /** 0..1. Absent means the archetype's own tolerance. */
  readonly tolerance?: number
}
```

`roles` is keyed by `dimensionKey`, not by `Role` — see §16.10. A key the
archetype does not name ADDS that target: a midrange deck that wants five stax
pieces can say so without becoming a stax deck, which is this document's opening
complaint one level down.

Read out of `jsonb` through `parseTargetOverrides`, which drops anything it
cannot read rather than throwing. A bad key costs that key, not the deck — and a
deck that will not open is an override nobody can clear, which is the exact trap
§16.5 exists to avoid.

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

- Migration **`0013`** (not `0004` — that number was taken by the deck
  description before this was built): `decks.target_overrides jsonb NOT NULL
  DEFAULT '{}'`.
- `Deck` gains `targetOverrides?: TargetOverrides`. Additive; absent and `{}`
  mean the same thing and no consumer has to tell them apart.
- `PATCH /decks/:id` accepts `targetOverrides`, replacing wholesale — the object
  is small and a merge protocol would be a second thing to get wrong. It also
  accepts `null`, meaning "clear it": a merging endpoint could never express a
  deletion, because "reset ramp" and "leave ramp alone" are both an absent key.
- `GET /decks/:id/analysis` returns `source: 'archetype' | 'custom'` per target
  and per curve band, so the UI can mark what was changed. It also returns
  `preset` per target and a whole `curve.preset`, because the sheet has to show
  the value being overridden and cannot derive it — the preset the deck would be
  judged by includes the bracket and curve modifiers, which depend on the deck's
  own average mana value. `targetOverrides` is echoed back too, so the sheet
  never has to reconstruct the sparse set by diffing (which would report a false
  override every time a typed number happened to equal the preset).
- `Reason` gains `source` on `fills-deficit`. Pillar P4: "fills a ramp gap" and
  "fills the ramp target you set" are different claims, and a card suggested
  against a number the builder typed is suggested on their authority. Hiding that
  hides the one thing they can change when the suggestions look wrong.

No new endpoint. No change to `DeckCommand` — a target is a property of the deck,
not an operation on its contents, and putting it through the command batch would
make "I moved a slider" undoable in the same queue as "I added a card".

## The interface

A sheet, opened from **"Adjust targets" on the Composition panel** — not from the
archetype label in the masthead, as originally sketched. The composition list IS
the thing being tuned; a control for it two regions away has to be found before
it can be used, and the panel it edits is where a builder is already looking when
they disagree with a number. Two columns: roles on the left, curve on the right,
each row a number box with the preset shown beside it in dim text, and a reset
arrow that appears only on a changed row.

Three things it must do that a naive form would not:

- **Show the preset, always.** The value you are overriding is the context for
  the number you are typing. A box showing only `36` cannot tell you the
  archetype wanted 34.
- **Total as you type.** Over is a warning, not a block — a builder may knowingly
  aim high while cutting, exactly as they may knowingly cross a bracket line
  (doc 03 §3.2). Two corrections to this document's arithmetic, both in the
  build:
  - The **roles** total counts ROLE dimensions only, against 99. A creature that
    ramps is counted once as `ramp` and once as `creature`, so adding the type
    rows in would produce a budget no deck could satisfy —
    `archetype-targets.ts` states the same rule as its first constraint.
  - The **curve** total is against `CURVE_REFERENCE_SPELLS` (63), not 99. The
    curve excludes lands, and totalling it against a whole deck would show room
    the deck does not have.
- **Say what changes.** On commit, a summary read off the analysis that comes
  back: which roles crossed into or out of needing cards — which is exactly the
  set of `fills-` groups that appear or disappear, since a group exists iff its
  role is short — and how the cut-hint count moved. Both halves come from one
  response, so the summary can never describe a state that did not exist. Tuning
  a target with no visible consequence is how a user loses trust in the numbers.

Every control is a native input or button with an accessible name, Escape
closes, and focus lands in the first field on open (AGENTS.md R4). A customised
row is marked in the meters and the curve by a glyph and a border, never by
colour alone.

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

## 16.9 The three open questions, answered

### 1. Does the curve editor earn its place in v1? — **Yes, both halves shipped.**

The scope note leaned toward roles first. It was overruled by what the two halves
turned out to cost once the sparse machinery existed. The expensive parts —
deciding sparseness, the storage shape, the migration, the PATCH field, the
`source` flag, the sheet, and the reset affordance — are shared; the curve half
is one more function of about thirty lines and a second column of the same number
boxes. "Half the build" was an estimate made before the shared half was written,
and it did not survive contact with it.

The argument that decided it, though, is not cost. The curve target feeds
`curveFit`, which is a term in the recommendation ordering for **every card**,
and `suggestCuts`, which is what tells a builder what to remove. A builder who
disagrees with the curve is disagreeing with the sort order of the whole pool,
and telling them "roles are yours, the curve is still ours" leaves the more
pervasive of the two signals uncorrectable. Shipping half would also have frozen
the sheet's layout around one column and made the second column a redesign rather
than an addition.

What the curve half costs, and it is a real cost, is the reference count. A
per-bucket override is a count of `CURVE_REFERENCE_SPELLS = 63` — 99 cards minus
36 lands — because `curveTarget` takes no deck. Deriving the denominator from the
deck's own nonland count was rejected: the target a builder typed would then
drift under them every time they accepted a card, which is a worse failure than
being one card off in a 58-spell deck. Everything downstream works in shares, so
the constant only fixes the ratio between a pinned bucket and the preset shape
around it.

### 2. Should an override survive an archetype change? — **Yes: follow, and say so.**

The scope note's reasoning holds and the build follows it. Silently discarding
numbers a builder typed is worse than carrying numbers they may not want, because
only one of those is reversible: there is a reset for the second and nothing at
all for the first. The two are independent columns in one `UPDATE`, and neither
clears the other.

"Say so loudly" is the same change summary as any other save. Switching archetype
produces new targets for every row the builder did not pin, so the summary
already reports what moved — and the overridden rows are marked in the meters, so
a row that did not move when the archetype changed says why on its own face. A
separate archetype-switch warning would be a second mechanism for something the
first already covers.

### 3. Is "over 99" a warning or a block? — **A warning.**

Per doc 03 §3.2: the user may knowingly cross their own line. The total turns
rust and says it is over; the save button stays enabled. The curve behaves the
same way one level down — counts summing past the reference renormalise, keeping
the SHAPE that was asked for rather than clamping to something nobody typed.

## 16.10 Where the build diverged from this design

Four places. Each is a change to this document made in the same commit as the
code, per AGENTS.md §10.

1. **Overrides are keyed by `dimensionKey`, not by `Role`.** A role map cannot
   express "18 creatures", and `type:creature` is a row the composition panel
   already draws and one of the numbers people most want to move. The dimension
   key space is what the meters, the targets and the `fills-` groups already use,
   so an override needs no translation anywhere.

2. **An overridden dimension skips the bracket and curve modifiers.** This
   document listed those modifiers as "not tunable" and left them applying on
   top. They exist to correct a preset written at a neutral curve for the deck in
   front of you; a number the builder typed while looking at that same deck has
   already accounted for it, and applying the correction again counts it twice.
   It also matters for trust: typing 36 lands and watching the meter read 35 is a
   form the user cannot control, and this document's whole interface argument is
   that the number you type is the number you are judged against. Every dimension
   NOT overridden keeps both modifiers in full, which is what "not tunable" was
   protecting.

3. **One tolerance really is one number, so the role bands are scaled by it.**
   The role bands were fixed card counts with no tolerance in them at all. They
   are now scaled by `tolerance / 0.35` — 0.35 being the midrange row's own curve
   tolerance and the middle of that table, which makes "leave the slider alone"
   the exact identity. Floored at one card wide: a target you can only hit
   exactly is one every deck fails, which is the same argument `MIN_HALF_WIDTH`
   already makes in `curve.ts`.

4. **The sheet opens from the Composition panel, and the totals are against 99
   for roles and 63 for the curve.** Both covered above.

## Estimate

Recorded as written, for calibration: "roles only… about the size of the
Universes Beyond change. With the curve editor: roughly half again." The shared
half dominated and the curve column came in well under "half again" — see §16.9.
