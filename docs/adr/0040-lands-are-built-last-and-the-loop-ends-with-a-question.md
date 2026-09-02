# ADR-0040 — Lands are built last, and the loop ends with a question

**Status:** accepted
**Date:** 2026-09-01
**Extends:** [ADR-0031](0031-a-card-is-offered-under-the-role-it-is-counted-as.md) (a card is
offered under the role it is counted as), [ADR-0034](0034-composition-counts-copies.md)
(composition counts copies), [ADR-0036](0036-a-conflict-is-a-loop-and-a-lost-decision-is-never-silent.md)
(a lost decision is never silent). **Changes:** doc 19 §19.4 Q2's handover
derivation and §19.2's stopping condition.

---

## Context

Three reports, all about Quickbuild, and two of them turn out to be the same
observation from different ends.

> "for quickbuilding, lands are the last things you should pick. You want to
> start with the big things like bombs, win conditions, high synergy combos,
> etc..."

> "quickbuild ended while I was below curve on ramp and spot removal, and also
> only at 58 of 100 cards. Once all your curves are satisfied, it should ask you
> if you'd like to continue quickbuilding, or go back to the suggestion list now
> that your deck allotments are met and you just need to pick X more cards"

Doc 19 Q2 derived the build order as the archetype's targets sorted by
descending `ideal`, on the argument that "the ideal IS the number of slots the
archetype gives a dimension, so the largest is both the one that most determines
whether the deck is buildable and the one that cannot be left until the end".
Every archetype spends 34–37 on `land`, more than on anything else, so land led
all nine orders. The derivation was sound and the answer was backwards.

---

## Decision 1 — a dimension whose target the deck decides is built last

**Largest commitment and most-worth-choosing-deliberately are close to
opposite,** and the land count is where they separate hardest. The mechanism is
in `compositionTargets` and needs no taste to see:

```ts
if (mv < 2.8) adjusted -= 1
else if (mv > 3.5) adjusted += 1
adjusted -= Math.floor((options.modalLandBacks ?? 0) / 2)
```

Every other ideal in `archetype-targets.ts` is settled the moment the archetype
and the bracket are known. The land ideal is not: it is a **function of the deck
you have already built**, because you cannot know how many lands a deck wants
until you know what they are casting. A dimension whose target is not yet
knowable cannot honestly be built first.

So `deferredDimensions(bracket)` **probes** `compositionTargets` — every
archetype, four deck shapes, chosen to move each input the function actually
reads — and returns the keys whose ideal moved. Today that set is exactly
`{ role:land }`. `buildOrder` sorts those after everything else and is otherwise
unchanged.

It is a probe rather than the string `role:land` for a reason that stopped being
hypothetical during this work: **ADR-0037's role-taxonomy change landed
mid-flight**, splitting `counterspell` and `bounce` out of `spot-removal` and
raising `graveyard-hate`. The probe still returns exactly `{ role:land }`
— it went looking rather than being told — land is still last in all nine,
`creature` still leads all nine, and the three new roles took their places by
their own ideals. **No code changed.** Four test expectations that pinned
concrete counts moved, which is the whole cost and is what those tests exist to
report. A new role is deferred if and only if the model makes its ideal
deck-dependent, and land stops being deferred the day that stops being true of
land; neither outcome needs an edit here.

Measured, the resulting order (bracket 3):

```
aggro        creature(32) > ramp(9)  > draw(8)  > spot-removal(6) > … > land(35)
midrange     creature(26) > ramp(11) > draw(9)  > spot-removal(6) > … > land(36)
control      creature(14) > draw(12) > ramp(11) > spot-removal(6) > counterspell(5) > … > land(36)
combo        creature(20) > ramp(13) > draw(10) > tutor(8) > protection(7) > … > land(34)
tokens       creature(24) > token-maker(14) > ramp(10) > draw(8) > … > land(35)
stax         creature(16) > stax(12) > ramp(12) > draw(8) > … > land(35)
voltron      creature(12) > ramp(10) > draw(8) > equipment(7) > protection(7) > … > land(36)
aristocrats  creature(30) > ramp(10) > draw(9) > recursion(7) > sac-outlet(5) > … > land(35)
ramp         creature(22) > ramp(15) > draw(9) > spot-removal(5) > … > land(37)
```

Land last in all nine; every archetype's identity dimension still rises on its
own, which is the property the original derivation was built for.

**On "bombs, win conditions, high synergy combos".** `wincon` and `synergy` are
roles, and **no archetype gives either an ideal** — so neither is a composition
dimension and neither can ever be a gap. There is no ordering over the targets
that can lead a builder to a bomb. What the table does name is `creature`, and
`archetype-targets.ts` reads the unroled remainder as "the deck's unroled
threats and payoffs"; with land deferred, `creature` leads all nine. The rest of
that phrase is answered by Decision 3 rather than by an ordering, because being
honest about what Quickbuild cannot do is the only available answer.

### Rejected

- **Ascending `ideal`** — the direct inversion, on the reading that one card is
  `1 / ideal` of its dimension so the smallest commitment is the most decisive
  pick. It does put land last in all nine with no extra term. Rejected on
  measurement: it puts `token-maker` eighth of ten for tokens and `stax` seventh
  of nine for stax, and leads every archetype with its one or two board wipes.
  An order that buries the archetype's identity to reach "lands last" has traded
  the wrong half.
- **Departure from midrange as the primary key**, on the reading that the
  identity cards are the ones chosen deliberately. Fails twice on measurement:
  midrange against itself is all zeros, so the default archetype gets no order at
  all, and combo's land sits at Δ2 in mid-pack while its draw (Δ1) goes last — so
  it does not deliver "lands last" either. It is kept as the tie-break it already
  was.
- **A hand-written order, or a hand-written list of deferred dimensions.** A
  second table to be reviewed against the first forever. Doc 19 Q2 rejected the
  first of these already; the second is the same mistake one level down.
- **`ROLE_PRECEDENCE`.** Still rejected, still for ADR-0031's reason: one list
  answering two questions.

---

## Decision 2 — the handover threshold is re-derived, because the old one rested
on a coincidence that is now false

Doc 19 Q2 placed the handover at the archetype's largest single target and
argued it was safe to put anywhere in that region because **"the two orderings
coincide on an empty deck"**: with nothing accepted every deficit equals its own
ideal, so largest-gap and largest-commitment are the same list.

Deferring land reverses land's position outright, so that coincidence is gone.
The threshold now genuinely adjudicates between two rival answers and had to be
derived again. `quickbuild.test.ts` pins the **disagreement** where it used to
pin the agreement.

**`handoverSize` is now the sum of the role dimensions' minima** — the smallest
deck that could be inside every band. A real lower bound, because role counts do
not overlap (`archetype-targets.ts` constraint 1: "`land + Σ roles` is therefore
a real budget against 99"). Type dimensions are excluded for the same reason
read backwards: a creature that ramps is counted in both `creature` and `ramp`,
so adding the creature floor would count those cards twice.

Below it a deck cannot be inside every band however its cards were spent, so
being short somewhere is arithmetic rather than evidence — worst-first restates
the archetype and the plan is the only thing that tells the dimensions apart. At
or above it a shortfall is a fact about this deck.

Measured: 55 for midrange at bracket 3, 49 for aggro, 65 for stax. It was 34–37.

> Already re-measured once: ADR-0037 split `counterspell` and `bounce` out of
> `spot-removal`, taking midrange from 56 to 55 and stax from 67 to 65. The
> derivation did not move, which is the point of deriving it.

The same number is where the loop runs out of opinion, which is what makes the
handover, the stopping condition and the "58 of 100" in the report one idea
rather than three.

---

## Decision 3 — the ending is a question, and the panel never closes itself

Doc 19 §19.2 said the loop "ends when every goal is inside its band", and the
panel printed one sentence with no action on it: *"Every composition and curve
goal is inside its band. Nothing to fill."*

**The arithmetic the report ran into.** Role minima sum to 55 for midrange at
bracket 3, so a deck reaches every band at 55 cards with 45 still to find. And a
band's floor is three cards under its ideal, so `ramp` at 8 of 11 is inside its
band and visibly under its meter at the same time. Both readings are honest;
showing one of them and calling it finished is not.

So the ending states what is true and offers both doors:

> Every composition and curve allotment is inside its band. The deck holds 58 of
> 100, so there are 42 more cards to pick. Your archetype leaves 25 slots with no
> target at all — the threats and win conditions — and Quickbuild has no opinion
> about those.
>
> [Keep quickbuilding to the ideals] [Back to the suggestion list]

- **`unroled`** is `DECK_SIZE − Σ ideal(role dimensions)`, the remainder
  `archetype-targets.ts` already reads as the threats. This is where bombs and
  win conditions live and the one part of the deck Quickbuild cannot lead anyone
  to, so it is named rather than implied.
- **Keep going** switches `reach` from `band` to `ideal` — the number the
  composition rail already draws, so it is not a new opinion. `band` stays the
  default because a deck inside its band is not wrong. `beyond` on the plan is
  what tells the panel whether continuing would find anything, so the offer
  cannot appear over an empty loop.
- **Nothing closes on its own.** Doc 19 §19.2's "both are ordinary outcomes"
  stands; what changes is that neither happens without the builder.
- **`held`** is carried on the plan rather than recovered as
  `DECK_SIZE − unallocated`, which floors at zero. Observed in the browser on a
  121-card deck: without it the panel says "the deck holds all 100 cards" to
  someone holding 121.

---

## Decision 4 — three cursors that walked off lists that shorten under them

The report's "ended while gaps remained" was not one defect. Three, all the same
shape, all in `Quickbuild.tsx`, and the plan is recomputed on every accept so
every one of them was reachable in ordinary use.

1. **`gapAt` was an index into `plan.gaps`.** "Different gap" advanced it with a
   modulo taken against the length at the time of the click. Two clicks on a
   three-gap plan left it at 2; the plan then shrank and `plan.gaps[2]` is
   `undefined`, which rendered as "Nothing to fill". **The panel said it was
   finished while ramp and spot removal were still short.** It is a gap KEY now,
   falling back to the leading gap when the chosen one closes. A wrapping index
   was tried first and rejected in the browser: it cannot go out of range but
   points somewhere arbitrary the moment the length changes, which is the
   reshuffling D3 forbids.
2. **`passed` — the skip cursor — had no memory of which gap it counted for.**
   Skipping twice and then having that gap close left a cursor of six pointing
   into the next gap's fresh page of eight, so the panel sliced past almost all
   of it and reported "No more candidates for this gap" about a gap it had not
   shown a single card for. It carries its gap key now.
3. **The queue never refilled once the deep page landed.** `deep` was read as
   "there is nothing further to top up", which is true of the server's answer
   and false of the deck. Found by driving a real deck: at **96 of 100 with an
   eight-card land gap**, the panel said *"Nothing in your colours fills this
   gap"* while `POST /recommendations` returned eight more for the same query at
   the same moment. A queue drained below a trio is refilled — conditioned on
   the deck having changed since the fetch, not on the queue being empty, so it
   cannot loop: `recommend` never offers a card the deck already holds, so its
   answer for one gap changes exactly when the deck does.

---

## Decision 5 — one frame per option, and it fills the box

> "the quickbuild detail pane borders are weirdly not filling their parent pane,
> and each one is different dimensions so it looks very disorganized"

Two causes, both real, and Q4's responsive rule was not either of them —
`repeat(auto-fit, minmax(15rem, 1fr))` collapses its empty tracks, so three
options always take three equal full-width columns.

1. **Six frames for three cards.** `.rt-detail` carries a border, a radius, a
   background and 12px of padding, because where `Detail` normally mounts that
   frame *is* the panel. Quickbuild puts three of them inside three `<li>` boxes
   that carry a frame too. The outer three are grid items and stretch to the
   row; the inner three are ordinary blocks sized to their own text. Measured at
   1600px: three identical 446×959 boxes containing three cards of 918px, 918px
   and 918px of *box* but visibly different amounts of drawn frame, from oracle
   text of 128, 300 and 85 characters.
2. **An inline `width: 340px`.** `Detail` renders `style={{ width: w }}` with `w`
   defaulting to `levelSpec(3).width`. Measured: 340px of card inside a 446px
   box, three times, leaving a 106px strip of empty pane down the right of each.
   **This is the half no selector could have fixed** — inline beats a
   stylesheet — and it is the literal reading of "not filling their parent pane".

The option keeps one frame and the focus rule that rides on it; `.rt-detail`
gives up its own and takes the full box. `Detail` is untouched: the nominal
width is genuinely wanted in the 21rem detail column, and the `<img>` still
needs it as a number to reserve its box before the art loads. `!important` for
the same reason and with the same precedent as `.preview-art .rt-face` in the
same sheet.

Measured after, at five pane widths, with every option identical in width at
every one and identical in height within a row:

| pane | columns | option | card inside |
| --- | --- | --- | --- |
| 1387 | 3 | 446 × 939 | 426 × 898 |
| 1008 | 3 | 319 × 882 | 299 × 842 |
| 700 | 2 | 329 | 309 |
| 426 | 1 | 392 | 372 |
| 360 | 1 | 326 | 306 |

All three options stay in the DOM with their own Add and Reject at every width
(nine focusable controls), and no container overflows horizontally.

---

## Consequences

- `QuickbuildPlan` gains `reach`, `beyond`, `held`, `unallocated` and `unroled`;
  `QuickbuildInput` gains an optional `reach`; `QuickbuildCurveDelta` gains
  optional `actual` and `ideal`; `buildOrder` gains an optional third argument.
  All additive. `handoverSize` changes what it returns and now reads `min`
  rather than `ideal` — the one breaking change, and it has no caller outside
  `quickbuild.ts` and its tests.
- `Quickbuild` gains a required `onReach` prop, and the workspace holds the
  reach because it holds the plan. It resets to `band` when the panel closes.
- A builder now finishes the whole deck before being asked about lands, and then
  faces one large land gap. That is what was asked for, and the handover means
  worst-first is what serves it.
- Nothing in `recommend`, the scorer, the grouping or the wire contract changed.
  Quickbuild is still a view (D2), skip is still a pass (D5), and P4, P5, P6,
  budget, bracket and the ADR-0026 guarantee are still upstream and untouched.
