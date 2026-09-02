# 33. A tour step with no anchor is skipped, and the count stays seven

Date: 2026-09-01

## Status

Accepted. Implements doc 20 §20.2's seven steps and D3's skipping rule, and
refines A4 for the one case A4 did not consider.

> **Number 0033 was assigned to this work before it started.** Ask for a number;
> do not scan `docs/adr/` for the next free one — agents have collided twice.

## Context

Doc 20 §20.2 names seven steps and §20.6 writes the announcement as "Step 3 of
7". D3 says anchors are semantic and that **a step whose anchor is not on screen
is scrolled to, and one whose anchor does not exist at all is skipped rather
than pointed at emptily.**

Two of the seven are conditional, and the two are conditional in different ways:

- **Step 3, a suggestion row's reasons.** Absent until the recommendation
  request lands. §20.1 fires the tour immediately after the first commander is
  chosen, which is often before the feed has arrived, so this anchor typically
  appears WHILE the reader is on step 1.
- **Step 5, the card detail surface.** Absent until a card is open. On the empty
  workspace §20.1 chooses as the best moment, nothing is open — and D1 forbids
  the tour from opening one to have something to point at. Confirmed in a
  browser: on a fresh deck the tour runs six steps and the numbering goes 4 → 6.

So "which steps exist" is not a fact that can be settled once. It also cannot be
allowed to renumber the tour under the reader.

## Decision

### 1. Anchors are resolved when the step is REACHED, not when the tour opens

`seek(from, direction, present)` walks from the current index in the direction of
travel and returns the first step whose anchor is in the document, or `null` when
there is none that way — which is what finishes the tour going forwards and what
disables Back on the first step going backwards.

Resolving once at open was the obvious alternative and it is wrong for step 3
specifically: the feed commonly lands while the reader is still reading step 1,
and a list fixed at open would have dropped the reasons step for good, on every
first run, which is the run that matters most.

### 2. The denominator is the canonical seven, always

§20.6 writes "Step 3 of 7" and that is taken literally: the count is the tour's
SHAPE, not a running total of what happens to be present. A skipped step shows as
a gap in the sequence — 4 then 6 — rather than renumbering.

Rejected: numbering against the present steps ("Step 5 of 6"). It makes the
number mean nothing across sessions, since the same step is "3 of 6" on an empty
deck and "3 of 7" with a card open, and it is the number a reader would quote in
a support conversation. A visible gap is honest about something having been
skipped; a renumbered sequence hides it.

### 3. Graph and Quickbuild are anchored by `data-tour`, not by their label

There is no CSS selector for an accessible name. The two honest alternatives were
both worse: `header .act:nth-child(7)` is the positional anchor D3 forbids by
name, and matching on text breaks the moment a button is relabelled — which has
already happened to Graph, which used to say "Web".

### 4. Help from the LANDING PAGE does not set `lw.tutorialSeen`

A4 says the flag is set when the tour opens, and accepts that a refresh at step 1
costs a first-timer the whole tour. It was decided about the seven-step region
tour.

The landing page cannot show a single step of that tour: the deck rail, the feed
and the analysis rail do not exist, so all seven anchors are absent and D5's
how-to-start step is what runs. Setting the flag there would let someone who
pressed Help before choosing a commander lose the real tour without ever having
been shown one step of it — which is the precise failure A4 names Help as the
mitigation for. So the flag belongs to the workspace tour, and only the workspace
writes it.

This is a refinement of A4 rather than a weakening: opening the region tour still
counts as seeing it, unconditionally.

### 5. Being on screen is a guarantee, not an animation

A2 says each step scrolls its region into view, with `prefers-reduced-motion`
getting an instant jump rather than a glide. Both are implemented — and the glide
is then CHECKED.

A programmatic smooth scroll is the one kind that does not always happen: Chrome
drives it from the compositor, so it is suspended while the document is not being
presented and cancelled outright if the reader touches the wheel while it runs,
which on a tour that has just told them to look at something is not rare. When it
does not arrive, the step dims the page and rings a region thousands of pixels
below the fold: the reader sees a darkened screen with no spotlight anywhere on
it, which is D3's "pointed at emptily" reached from the other side and worse,
because nothing on screen suggests what went wrong.

So the glide is started and a deadline checks whether the region actually
arrived; one that is still off screen is jumped to. When the animation works the
check does nothing.

## Consequences

**The first run is six steps, not seven,** because nothing is open for step 5.
Measured in a browser at three widths: on a fresh deck the tour goes 1, 2, 3, 4,
6, 7, and with a card open at 1320px all seven run and step 5's spotlight lands
on the 336px detail column.

**The spotlight does not animate.** `Tour.tsx` repositions it on every `scroll`
event, because a top-layer element does not move with the page behind it, and a
transition on `left`/`top` is restarted by every one of those — so the ring would
trail the page for the whole of each step's scroll and settle after it. The
tour's only motion is the scroll, which is where A2 puts it and where
`prefers-reduced-motion` is honoured.

**The overlay is a `popover`, promoted at runtime**, exactly as `Hint` does it.
`.region` carries `container-type: inline-size`, which makes it a containing
block for fixed-position descendants, and `.analysis-scroll` is `overflow-y:
auto`; neither reaches the top layer. Verified on the running app:
`:popover-open` matches and the layer measures the full viewport.

**The masthead threshold did not move.** ADR-0032 derived 1175px against "three
buttons and a menu" with the overflow trigger at 25.9px. Measured with the real
control set in place: wordmark 135.1, Graph 47.6, Quickbuild 73.6, Help 39.6,
overflow **25.9**, nine children, 16px gaps, 48px padding — every term as
derived. The row is one line at 1176 and two at 1175, and the tools stay together
down to a 320px viewport.

**Anchors are resolved in the click handler, not read off the render.** The first
build computed the next and previous steps during render and used those values
when Next was pressed, which makes them a snapshot of the DOM as it was at the
last commit — and a step whose anchor appeared since then was still skipped,
which is the opposite of what Decision 1 says. Step 3 is exactly that step.
`go()` calls `seek` itself.

**"On the page" means "not inside a hidden subtree".** Doc 17's Graph is a mode:
it hides `.workspace` with the `hidden` attribute rather than unmounting it, so
that leaving the graph does not re-run the pipeline. `querySelector` matches
inside a hidden subtree, so Help from the graph reported all five workspace
anchors present and measured every one at 0×0 — a 12×12 ring in the corner of a
fully dimmed page. `present()` tests `closest('[hidden]')`, and not
`offsetParent` or `checkVisibility`: jsdom has no layout, so a geometric test
would report every anchor invisible and skip every step in every test.

## Rejected

**Opening a card so step 5 always has something to point at.** It is the obvious
way to get seven steps on a fresh deck, and D1 forbids it in as many words: the
tour highlights, it does not drive. A tutorial that opens a panel on your behalf
has started making decisions for you.

**A shorter tour below 900px.** A2 rejected it already, and building it would
have meant two tours to keep in sync. Verified instead that the single tour works
where the regions stack: at 700px the page is 10,094px tall with the analysis
rail 8,644px down, and each step brings its own region into view — measured,
scrollY went 0 → 912 → 8,928 with the ring on its anchor at every stop.

**Resolving the step list once when the tour opens.** Simpler, and it loses the
reasons step on the run that matters most. See Decision 1.
