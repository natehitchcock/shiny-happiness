# 32. A row stops shedding and takes a second line

Date: 2026-09-01

## Status

Accepted. Terminates the shedding chain derived in `apps/web/src/styles.css`,
and extends it to the masthead. Consumes doc 20 §20.4 / A1 for the masthead's
control set.

> **Number 0032 was assigned to this work before it started.** Ask for a number;
> do not scan `docs/adr/` for the next free one — agents have collided twice.

## Context

A suggestion row and a deck row are a card name plus the cells that comment on
it. When the column narrows, the name is the only flexible child, so it absorbs
the whole deficit. A `min-width: 5rem` floor stopped it reaching zero, and a
chain of `@container` queries sheds cells — efficiency, impact, price, mana cost
— at the widths where the name would otherwise go under that floor.

The user's report is that this is not enough:

> when the screen becomes so narrow that the right and left items collide, stack
> them instead. this goes for the header and for the suggestion entry line items.
> otherwise, the add/remove buttons and mv etc… cause the name to clip beyond
> what is readable

The width they were looking at is measurable. On an ordinary 1400px laptop the
deck rail's query container is 286px; measured there, a deck row had already shed
its price and still gave the name **85.5px**, with the mana cost, the lock and
the Remove button all present. "The add/remove buttons and mv."

## Decision

### 1. Readable is 165px, measured, and it is not the floor

Every distinct card name in the corpus — 34,442 of them — was drawn with
`measureText` in `.card-row .name`'s own resolved font (Karla 400 15px) and the
width at which the whole name fits taken as a distribution:

| percentile | width  |
| ---------- | ------ |
| p50        | 116.4  |
| p75        | 138.6  |
| p90        | 164.2  |
| p95        | 182.5  |

**165px** is the ninetieth percentile and is what this project means by a
readable card name.

The 5rem floor is a different number doing a different job, and conflating them
is what made the defect invisible. 80px is where a name stops _distinguishing_
one card from another: measured the same way, the shortest prefix that is unique
in the corpus, plus its ellipsis, is under 80px for 70% of cards (p90 97.2px).
80px is an honest floor against overflow. It is not a readable width — a whole
name fits inside it for **10.7%** of the corpus.

### 2. Shedding cannot deliver a readable name at any width

Measured on the running app, at the best pixel of each shed — the moment the cell
disappears and the name springs back — the name is 137.6px (efficiency), 137.2
(impact), 141.6 (price) and 161.1 (mana). Every one is short of 165, and by the
next threshold the name is back at 80. Its mean across the chain's whole
operating band, 232px to 576px of container, is about 113px, at which 45% of
names read whole.

So the chain was never buying readability. It was postponing overflow. That is
the finding this ADR is built on, and it is why the answer is not "shed harder".

### 3. The chain terminates in a stack rather than continuing

One rule, two remedies. Every threshold answers the same question — at what width
can the row no longer hold a floored name beside what it carries? — and gives the
cheapest answer still available:

- while that answer is "drop a number the page prints somewhere else", it is a
  `display: none`: efficiency, then impact, both drawn in full with their tier
  and their working in the detail pane;
- when the only cells left are ones the row exists to show, the answer becomes
  "take a second line", and the shedding order **resumes on it**.

The two stacking thresholds are the price's old ones, unmoved — 375 for a
suggestion row and 342 for a deck row — because the arithmetic that produced them
did not change. Only what the row does about them changed. On the second line the
same order runs again against the same derivation with the name no longer on the
line: the price goes at 287 and 254, the mana cost at 225 and 192.

Stacked, line one is the name (and, on a suggestion row, the combo badge beside
it); line two is everything else, in the same order, against the same right edge,
so the number columns still read straight down the list.

### 4. The pane-open promise is inherited, not renegotiated

`styles.test.ts` pins that opening a card must not reformat the rows behind it,
and the four-column layout's 1320px threshold was derived partly from it. At that
threshold the feed's query container is **389px** — measured, with the grid
forced so it could be reproduced at a fixed viewport, at a 1303px layout viewport
(1320 innerWidth less a 17px classic scrollbar).

375 is below 389, so opening a card does not restack the feed. The promise holds
unchanged and now covers more: it used to say the price survives an open, and it
now says the row's _shape_ does, with the price riding down onto the second line
rather than leaving. The feed's floor in the 1320px derivation is the same pixel
it has been through two re-derivations — 375 + 32 = 407 — and means "the width at
which a suggestion row stops fitting on one line" instead of "the width at which
it drops its price". **1320px is unchanged.**

The margin is 14px, and it would take a 31px scrollbar to close it.

### 5. The masthead breaks into two named groups at 1175px

It already wrapped; where it wrapped was the problem. Measured with doc 20
§20.4's control set, it broke between Quickbuild and Help at 1092px, left the
overflow trigger alone on a line at 282px, and reached 217.6px of sticky height
at 320px on a screen with 568px to spend.

The split is the user's own: identity and state on line one, tools on line two. A
zero-height flex item ordered between the groups makes the break happen in one
place. 1175 is derived from the parts, all measured:

```
padding 48 + wordmark 135.1 + deck-name floor 80 + progress 180
  + count 103.2 + bracket chip 298 (its widest state) + Graph 47.6
  + Quickbuild 73.6 + Help 39.6 + overflow 25.9 + eight gaps 128
= 1159.0   →  breaks at 1158 of masthead, + 17 of scrollbar  →  1175
```

The deck name gets the same 5rem floor a card name gets, **as a flex basis**
rather than only a `min-width`: a flex container decides where to wrap using each
item's hypothetical main size, so with `flex-basis: auto` a long deck name pushed
the tools onto a second line before anything shrank. Without that the threshold
is not a threshold, because a deck's name is user text of unbounded length.

## Consequences

**The rows.** Measured on the running app, at every container width from 600px
down to 180px there is zero overflow, every control hit-tests through
`elementFromPoint`, and keyboard focus draws the standard 2px brass ring inside
the column.

Density moves in opposite directions on the two shapes, and the surprising one is
good. A suggestion row's mean height goes from **151.3px at 376** to **100.2px at
375** — 34% _shorter_ — because the reasons inside an 80px name cell were wrapping
into a stack of lines, and a full-width cell fits them in far fewer. A deck row's
goes from 49.7 to 73.6, +48%, and that is the real cost: about 2,000px more
scrolling on an 86-card rail, paid to take the name from 85.5px (12% of names
whole) to 268px (99%).

**What is still unreadable.** Between 376 and 491 of container the row is on one
line with 80–142px of name. On this machine that band is only entered with the
detail pane open between a 1320px and a 1454px viewport, and the pane is drawing
the name it is squeezing.

**The deck rail restacks when the pane opens** between a 1669px and a 2006px
viewport, because its reserved track is pinned at 313px while its own `1fr` share
above 1669 is wider than the 375 it needs for one line. The sheet already accepts
a rail reformat on open in the 1320–1375 band; this is more of the same and moves
in the readable direction. Closing it would mean raising 1320 to 1382, which is
another decision's number.

**The masthead.** Two lines from 1175 down to 908 of masthead, then three, then
four below 420 — with the tools together at every width down to a 283px masthead,
where they split today. Measured against today's behaviour with the same control
set: 908 → 104.7px both ways, but the tools stop being cut in half; 500 → 147.9
becomes 139.9; 375 → 188.6 becomes 172.6; 320 → 217.6 becomes 193.6.

The one place it costs height is the top of the band. Because 1175 is derived
against the bracket chip's **widest** state, a deck whose chip is narrower would
have fitted on one line a little below it — measured, this deck's chip is 231.8px
and it held one line down to 1092, so between 1093 and 1175 it now takes two
lines and 39px more sticky height than it strictly needs. That is the mild
direction and it is chosen deliberately: the alternative is deriving against a
chip some decks exceed, and being wrong the other way means the split toolbar
this ADR exists to remove.

The tool line holds four controls; each further one costs about 66px, so seven
reach 481 and the promise is gone on every phone. That is what A1 is for.

## Rejected

**Raising the 5rem floor to the readable 165 and letting the chain shed harder.**
It works and it is worse: derived, a feed row would drop efficiency at 576,
impact at 518, the price at 460 and the mana cost at 398, so at the very widths
stacking keeps everything, the row would be a name and two buttons. Stacking buys
the same name width by spending 22px of height instead of four columns of
information.

**Stacking one step later, where the mana cost would otherwise go** (313 and
280). It is the tidier story — stack rather than lose the one number that is not
repeated anywhere else on the page — and it does not fire where the user was
looking. The deck rail's 286px container is above 280, so the row would stay on
one line with 85.5px of name. That is the report, verbatim.

**Giving the name the full 100% and dropping the combo badge to line two.** It
reads as a property of the controls there rather than of the card, and the row's
left column stops existing.

**Bringing a shed metric cell back onto the second line**, which at a 375px
container has room for exactly one. A column that reappears as the window narrows
cannot be read as a shedding order at all.

**A `<div>` around the masthead's buttons in `App.tsx`.** Rejected on ownership
rather than on mechanism: that file is being edited by the Quickbuild work at
this exact spot, and a wrapper is a merge conflict where a pseudo-element is not.

**`margin-block: calc(var(--step) * -1)` on the masthead break** to cancel one of
the two row gaps a zero-height line costs. It is the obvious trick and it does
nothing — Chrome clamps a flex line's cross size at zero, and the masthead
measured 120.7px with it and 120.7px without. Halving `row-gap` while the break
is present is what works, and it leaves a useful hierarchy: half a gap between
lines within a group, a full one between groups.

## Not done

`.act` controls are 23–58px wide and 19–23px tall at every width, stacked or not.
That is below doc 08 §8.3's 44×44 touch target, it is unchanged by this work, and
fixing it is an app-wide change to `.act` rather than a row-layout one.

The masthead's progress bar holds a 180px minimum and a whole line even when it
is inactive and `opacity: 0`. Making it `display: none` when idle would remove a
line from the narrow masthead most of the time.
