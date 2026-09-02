# 20. The quick tutorial

**Status: BUILT.** §20.5's five questions were answered by the product owner on
2026-09-01 and are recorded below with their reasoning and their accepted costs.
What was built to them is recorded beside them, along with the two places the
build had to decide something the answers did not reach — both in ADR-0033.

A first-run walkthrough that names each region of the workspace and says what it
is for, plus the Graph and Quickbuild buttons — and a **Help** button that
starts the same tour on demand.

---

## 20.1 The problem this has to solve first

**On a first visit there is no workspace to tour.** The landing page is a
commander picker: "Build a Commander deck around combos and synergies. Pick a
commander to begin." The deck rail, the suggestion feed and the analysis rail do
not exist until a commander is chosen.

So "first time" cannot mean "on first load". A tour that opens over the landing
page can only describe things the reader cannot see, which is worse than no tour
— it asks them to memorise a layout instead of recognising one.

**Built:** the tour fires **once, immediately after the first commander is
chosen**, when the workspace exists and is empty. An empty workspace is the best
possible moment: every region is visible, nothing is cluttered, and the reader
has just committed to building something. The landing page gets nothing but the
Help button.

The trigger is a **transition**, not a state, and only `App` can see it: from
inside `Workspace` a deck that has just been created and one restored from
`roundtable.deck` look identical. `App` passes `freshlyCreated`, set by the
landing page's `onCreated` and by nothing else — so switching to an existing deck
does not fire the tour even on a browser that has never seen one.

---

## 20.2 What it covers

Seven steps. Each anchors to a real element and says what the region is *for*,
not what it is called — a label the reader can already see is not information.

| # | Anchor, as built | The point |
|---|---|---|
| 1 | `section[aria-label="Deck"]` | Your deck, grouped by job. The counts are the deck telling you what it still needs. |
| 2 | `section[aria-label="Suggestions"]` | What to add next. Grouped by *why* — every row carries its reasons. |
| 3 | `section[aria-label="Suggestions"] .card-row .reasons` | The reasons are the product. A card is here because of this, not because it is "good". |
| 4 | `section[aria-label="Analysis"]` | Composition, curve, combos, bracket — the scoreboard the suggestions are trying to move. |
| 5 | `.preview` | Full card, both faces' rules, impact and value. |
| 6 | `[data-tour="graph"]` | The same deck as a web of connections, when the lists stop showing you the shape. |
| 7 | `[data-tour="quickbuild"]` | One question at a time: three cards for your biggest gap. |

Steps 6 and 7 are the two the user named explicitly, and they are last on
purpose — they are alternative ways to work, and they only make sense once the
default way has been named.

**Steps 6 and 7 carry a `data-tour` hook rather than being matched on their
label.** There is no CSS selector for an accessible name, and both honest
alternatives are worse: `header .act:nth-child(7)` is the positional anchor D3
forbids by name, and matching on text breaks the moment a button is relabelled —
which has already happened to Graph, which used to say "Web".

**Two of the seven are conditional, and on a first run the tour is six steps.**
The card detail surface does not exist until a card is open, and on the empty
workspace §20.1 chooses, nothing is — so step 5 is skipped and the reader sees
the sequence go 4, 6, 7. D1 is why it is not simply opened. See ADR-0033.

---

## 20.3 Decisions this spec makes

### D1. It highlights; it does not drive

The tour points at regions and explains them. It does **not** add a card, open
Quickbuild, or change the deck. A tutorial that acts on your behalf leaves you
holding a deck you did not choose, and this product's whole claim is that every
addition carries a reason you agreed with.

Its visible consequence is step 5's skip, above.

### D2. Skipping is as easy as continuing

"Skip the tour" is a visible control on every step, the same size and prominence
as "Next" — not a small × in a corner. A first-time user who wants to get on
with it must never have to work at escaping. Escape also closes it.

**Built** as a third button in the same row, sharing Next's class and — through
`flex: 1 1 auto` — its size. `tour.test.tsx` asserts the two class names are
equal on all seven steps, because "same prominence" is otherwise free to drift.

### D3. Anchors are semantic, not positional

Steps anchor to `aria-label`ed landmarks and named controls, never to
coordinates or nth-child. The layout genuinely moves: three columns normally, a
**fourth** detail column above 1320px, and a single column with a bottom sheet
below 900px. A tour pinned to positions would describe a layout the reader is
not looking at.

**Consequence: a step whose anchor is not on screen is scrolled to, not
faked.** Below 900px the regions stack and the detail pane is a sheet, so each
step brings its own region into view first — see A2. A step whose anchor does
not exist at all is skipped rather than pointed at emptily.

**Built:** anchors are resolved when a step is REACHED, not once when the tour
opens. Step 3's anchor typically appears while the reader is still on step 1,
because §20.1 fires the tour before the feed has landed; a list fixed at open
would have dropped the reasons step on every first run. ADR-0033 §1.

### D4. Seen-state lives in `localStorage`

Precedent exists and is already the convention: `lw.deviceId` (ADR-0014) and
`lw.cutThreshold` both live there. A tutorial flag is a property of *this
browser*, not of a deck — the same deck opened on a phone by the same person is
a first visit for that screen, and a different deck on this browser is not.

Key: `lw.tutorialSeen`. Note the sort control (ADR-0028) deliberately chose no
persistence at all; that was right for a transient view preference and is not
the same question.

### D5. The Help button re-runs the same tour

One implementation, not a "tour" and a separate "help page" that drift apart.
Help is available from the landing page as well as the workspace; from the
landing page it explains what the app is and how to start, then defers the
region steps until there is a workspace.

**Built:** one `Tour` component. On the landing page none of the seven anchors
resolve, so it shows a single unanchored "Pick a commander to begin" card — no
step number, no spotlight — and it does **not** set `lw.tutorialSeen`. That last
part is a refinement of A4 rather than a hole in it, and ADR-0033 §4 has the
reasoning: the flag guards the seven-step region tour, and the landing page
cannot show one step of it.

---

## 20.4 The masthead — resolved, and built

The row held **Import, Export, Graph**, and this spec plus doc 19 would have
made it five. It does not: **Import and Export move behind an overflow menu**
and the row keeps the three working tools — Graph, Quickbuild, Help. See A1.

Two things follow. The row now grows by one button rather than three, so the
crowding question does not return at seven. And **Help must be genuinely
findable**, because A4 makes it the only route back to a tour someone lost to a
refresh — which is precisely why Help stays on the row and Import/Export are the
pair that leaves it.

### What was built

`OverflowMenu.tsx`, following `DeckMenu` in this same masthead rather than
inventing a second idiom: a relatively positioned root, a trigger carrying
`aria-haspopup="menu"` and `aria-expanded`, a `role="menu"` popup with
`role="menuitem"` children, and dismissal on Escape and on a pointer-down
outside. It adds the two things `DeckMenu` never needed, both consequences of
this being the ONLY route to Import and Export: **arrow-key roving** between
items (Up, Down, Home, End, wrapping both ways) and **focus returning to the
trigger** on close. Tab closes rather than trapping — it is a menu, not a dialog.

It is `position: absolute`, not the top layer the tour and the hints use. The
masthead neither scrolls nor carries `container-type`, so there is no clipping
ancestor to escape.

### The 1175px threshold did not need re-deriving

ADR-0032 derived the masthead's break against doc 20 §20.4's control set before
it existed, measuring the three absent buttons by relabelling three that did —
**nine children, eight 16px gaps, and an overflow trigger of 25.9px.** Measured
on the running app with the real controls in place:

| term | ADR-0032 assumed | measured |
|---|---|---|
| children / gaps | 9 / 8 × 16px | 9 / 8 × 16px |
| padding | 48 | 48 |
| wordmark | 135.1 | 135.1 |
| Graph | 47.6 | 47.6 |
| Quickbuild | 73.6 | 73.6 |
| Help | 39.6 | 39.6 |
| overflow ⋯ | 25.9 | **25.9** |

The trigger is a bare `.act` — 2px/7px padding, a 1px border, one ⋯ at 0.72rem —
and `styles.test.ts` now pins that it declares nothing that changes its box, so
inflating it has to come with re-deriving the threshold. Behaviour, measured: one
line at 1176px, two at 1175, and the tools together at every width down to 320.

One rule did have to change. `.masthead > .act { order: 2 }` does not reach the
menu, because the trigger sits inside a positioning wrapper — without adding
`.masthead > .overflow-menu` the menu keeps the default order of 0 and lands on
line one beside the bracket chip, which is the split toolbar ADR-0032 exists to
remove.

---

## 20.5 Answered questions

All five were decided by the product owner on 2026-09-01. Recorded with the
reasoning, and with the costs each answer accepts.

### A1. Import and Export move behind an overflow menu

The row keeps **Graph, Quickbuild and Help** — the working tools — and gains a
menu holding Import and Export, which are session bookends rather than things
you reach for while building.

This is the answer that stops the row growing again at seven. It also changes a
constraint another piece of work is building to: the masthead is being made to
stack at narrow widths, and it should now be designed around **three buttons and
a menu**, not five buttons.

**Built.** §20.4 above. Import and Export do exactly what they did — verified on
the running app from their new home: Import opens its dialog, Export copied
`1 Krenko, Mob Boss` and printed "Copied 1 line".

### A2. Each step scrolls its region into view

One tour everywhere, seven steps on every screen size. Below 900px the regions
stack, so each step scrolls its own region into view before highlighting it —
the tour teaches the layout the reader actually has rather than describing one
they do not.

`prefers-reduced-motion` applies to the scroll as much as to the highlight: an
instant jump, not a glide, for a reader who asked for none.

Rejected: a shorter small-screen tour, which is two tours to keep in sync as the
app changes.

**Built**, with one addition A2 did not have to anticipate: the glide is started
and then **checked**. A programmatic smooth scroll is suspended while the
document is not being presented and cancelled outright if the reader touches the
wheel while it runs, and when it does not arrive the step dims the page and rings
a region below the fold — a darkened screen with no spotlight on it. A deadline
jumps to any region that has not arrived. ADR-0033 §5.

### A3. The tutorial waits for Quickbuild, and ships all seven steps

**This makes doc 19 a hard dependency.** The tutorial does not begin until the
Quickbuild button exists, and ships complete rather than gaining a step later.

The cost, stated: the tutorial is now blocked on a feature that had six open
questions of its own. Four are answered; the build is under way. If Quickbuild
slips, this slips with it — that is the accepted trade for shipping one
coherent tour instead of a six-step tour and a follow-up.

**Resolved: doc 19 is BUILT.** Step 7 points at a Quickbuild button that is
really there, verified in a browser — its spotlight lands on a 74 × 23px button
in the masthead.

### A4. Opening the tour once counts as seen

The flag is set when the tour **opens**, not when it completes. Someone who
closes the tab at step 3 does not get it again automatically.

The accepted cost is real and was chosen with it stated: a stray refresh at step
1 silently costs a first-time user the entire tour. **Help is the mitigation,
and this raises the bar on A1** — Help has to be genuinely findable, because it
is now the only route back to the tour for anyone who loses it.

**Built, cost included.** Verified end to end in a browser: with `localStorage`
cleared, choosing a commander opened the tour and `lw.tutorialSeen` read `yes`
while the reader was still on step 1; Escape at step 3 and a reload did not
reopen it; Help brought the same tour back from step 1.

The one case A4 did not reach is Help on the **landing page**, which does not set
the flag — see D5 and ADR-0033 §4.

### A5. Once per browser, via `localStorage`

Consistent with `lw.deviceId` (ADR-0014) and `lw.cutThreshold`, which already
treat the browser as the identity. Key: `lw.tutorialSeen`.

On a shared machine the second person gets no tour. Consistency wins, and Help
is again the escape hatch.

**Built.** Observed on the running app sitting beside `lw.deviceId`,
`lw.cutThreshold` and `lw.autoQuery`.

## 20.6 Accessibility (R4) — binding, not aspirational

- Each step is a dialog: focus moves to it, is trapped while open, and returns
  to a sensible place on exit — the Help button when dismissed, the workspace
  when finished.
- **Escape** closes the tour at any step.
- Next / Back / Skip are all keyboard-reachable with visible focus, and the tour
  is fully operable without a pointer.
- The highlight is never the only signal: each step's text names the region in
  words, so a reader who cannot see the spotlight still knows what is being
  discussed.
- Step changes are announced to a live region ("Step 3 of 7: …").
- `prefers-reduced-motion` is already respected in four places in the stylesheet
  and must be here too: no sweeping spotlight transitions for a reader who asked
  for none.
- The spotlight must not clip. The hint popovers were moved into the **top
  layer** for exactly this reason (ADR: hints, doc 17 work) — clipping is not
  stacking, and no `z-index` fixes an `overflow: auto` ancestor. The tour's
  overlay should use the same mechanism rather than rediscover the problem.

All of it is built, and checked in a real browser rather than asserted:

| claim | how it was checked |
|---|---|
| dialog semantics | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the step title, read off the live DOM |
| focus moves in on open | `document.activeElement.className === 'tour-card'` after pressing Help |
| the dialog, not a button | so a screen reader reads the step's title and body on arrival rather than "Next, button" |
| Next/Back/Skip reachable | real `Tab` from the dialog landed on Next (Back is disabled on step 1 and skipped by the browser); real `Enter` × 6 walked all seven steps |
| visible focus | `outline: solid 2px` in `--brass` on the focused control, off the live DOM |
| focus trapped | `tour.test.tsx`: Tab off the last control wraps to Back, Shift+Tab off the first wraps to Skip |
| Escape at any step | real `Escape` at step 3 removed the tour; also checked on the landing page's single step |
| focus returns sensibly | after Escape, `document.activeElement` was the Help button; after Done, it was `.workspace` |
| announced to a live region | `role="status"`, `aria-live="polite"`, mounted empty from the first render; observed reading "Step 3 of 7: The reasons on a row" |
| never colour alone | every step prints "Step *n* of 7" and a title naming the region in words |
| `prefers-reduced-motion` | with the query reporting `reduce`, every step asked `scrollIntoView` for `behavior: 'auto'`; with it reporting `no-preference`, `'smooth'` |
| the overlay does not clip | `layer.matches(':popover-open')` is true and the layer measures the full viewport, over a `.region` whose `container-type` is `inline-size` and an `.analysis-scroll` whose `overflow-y` is `auto` |

**The spotlight does not animate**, and that is how §20.6's motion clause is
honoured rather than a way around it. `Tour.tsx` repositions the ring on every
`scroll` event — a top-layer element does not move with the page behind it — and
a transition on `left`/`top` is restarted by every one of them, so the ring would
trail the page through each step's scroll. The tour's only motion is that scroll,
which is where A2 puts the preference. ADR-0033.

---

## 20.7 Out of scope

- Any interactive "now you try it" step that requires the user to act.
- Per-feature coach marks appearing as features are first used.
- Localisation.
- A written help page or documentation site; this is a tour, not a manual.

---

## 20.8 Verified in a browser, at three widths

jsdom has no layout: it cannot check that a spotlight lands on the right
element, that a region scrolls into view, or that nothing clips. Those were
driven on the running app against the real corpus (34,493 cards), with the
spotlight's box compared to its anchor's box on every step.

| width | layout | result |
|---|---|---|
| 2560 | three columns, nothing open | steps 1, 2, 3, 4, 6, 7 — step 5 skipped, no card open. Every ring exactly its anchor's box + a 6px halo |
| 1320 | four columns, detail pane open | all seven, including step 5 on the 336px detail column. Every ring on its anchor; the card fully on screen every time |
| 700 | one column, regions stacked | a 10,094px page with the analysis rail 8,644px down. `scrollY` went 0 → 912 → 8,928, each region brought into view, the ring on its anchor and inside the viewport at every stop |

The masthead was measured across 1400, 1200, 1176, 1175, 1100, 950, 900, 700,
500, 375 and 320: one line down to 1176, two from 1175, and Graph · Quickbuild ·
Help · ⋯ together on one line at every one of them.

**Eleven defects were found and fixed** — three in the browser, eight more by a
code review with fresh eyes. Every one has a regression test, and every one of
those tests is confirmed by a mutation that it kills.

Found in the browser:

1. The spotlight's CSS transition left the ring on the previous step's box, and
   restarts on every scroll event of a glide besides.
2. Positioning the ring *before* an instant scroll rather than after it left it
   off screen while the region it named was centred.
3. **The overflow menu did not close on Escape unless focus was inside it.** Its
   Escape lived on the component's own `onKeyDown`, and a React handler on the
   root only sees events whose target is inside the root — so once focus had
   drifted, the menu could only be closed with a mouse. `DeckMenu`, the
   precedent this follows, always listened on `document`, and the comment beside
   this code claimed it did too.

Found by review, and each one invisible to jsdom for a nameable reason:

4. **`showPopover()` had no cleanup.** StrictMode runs every layout effect twice
   on mount, and the spec says a second `showPopover()` on a showing popover
   throws. Chrome happens to make it a no-op — measured — which is the only
   reason it worked. Now hidden in the cleanup, and tested against a deliberate
   stub that throws the way the spec says, because jsdom has no Popover API at
   all and the whole branch was otherwise dead in every test.
5. **`forward`/`backward` were snapshotted at render, not read when Next was
   pressed** — so a step whose anchor appeared while the reader sat on the one
   before was still skipped. That is exactly what D3, ADR-0033 §1 and this
   file promise, and §20.1 manufactures the window by firing before the feed
   lands. `go()` now calls `seek` itself.
6. **Graph mode spotlit hidden regions.** Doc 17 hides `.workspace` with the
   `hidden` attribute rather than unmounting it, and `querySelector` matches
   inside a hidden subtree — so Help from the graph reported all five workspace
   anchors present, measured each at 0×0, and drew a 12×12 ring in the corner of
   a fully dimmed page. `present()` now excludes hidden subtrees, and Help from
   the graph correctly opens at step 6 on the Graph button itself.
7. **Back onto step 1 stranded focus on `<body>`.** A browser blurs an element
   that becomes disabled while focused; `<body>` is outside `.tour-layer`, so
   the Tab trap's handler never ran at all and Tab walked into the dimmed page.
   A step change now catches focus that has left the card.
8. **The first painted frame was a scrim with no hole**, because `position()`
   ran from a passive effect. `Hint.tsx` documents this exact trap and uses
   `useLayoutEffect`; this now does too, with no dependency list so it also
   re-measures on every commit.
9. **The ring went stale on reflow.** Only `scroll` and `resize` were watched,
   and §20.1 opens the tour before the feed and analysis land — when they
   arrive the anchor moves with no event. A `ResizeObserver` on the anchor and
   on the document element closes it.
10. **Escape was not consumed**, so leaving the tour at step 5 also shut the card
    preview behind it — and step 5's anchor is `.preview`, so a card is open by
    definition. `App.tsx` states the convention in a comment: "Consumed here so
    the innermost open thing is the one that closes." Both the tour and the menu
    now listen in the capture phase and stop propagation, which is what puts
    them ahead of the bubble-phase listeners the preview, the target sheet and a
    pinned hint all use.
11. **`.tour-progress`'s size and margin were dead CSS.** It is a `<p>` inside
    `.tour-card`, so the bare class lost to `.tour-card p` on specificity and on
    order, and "STEP 3 OF 7" rendered at the body's 0.86rem. Now
    `.tour-card .tour-progress`, and pinned through the same cascade walker that
    caught the basic-land row.

**Five tests were vacuous and were repaired rather than deleted**, which matters
because they are why some of the above survived. The worst: `styles.test.ts`
pinned that `.overflow-trigger` declares nothing that changes its box — and there
is no `.overflow-trigger` rule in the sheet at all, so the regex yielded an empty
string and all five assertions passed against nothing. It now asserts positively
on `.act`'s padding, font and border (which is what the 25.9px actually is) and
scans **every** rule mentioning the trigger, so `.act.overflow-trigger { padding
}` no longer slips through. Also repaired: a test named "skips a step whose
anchor arrives late" that never made anything arrive late (it is now two tests,
one of which is the regression test for defect 5); an assertion on an exported
constant that would have passed with the component deleted; a test that fetched
elements by button role and then asserted they were buttons; and two
`beforeEach(workspace)` calls that handed vitest's TestContext in as the options
object.

A full pass — landing tour, deck creation, the auto-fired seven-step tour walked
to the end, the overflow menu, Escape over an open card, and Help from inside the
Graph mode — produced **no console errors and no unhandled rejections**.

**Not verified with real input:** the browser window was occluded for the later
part of the session — every tab reported `document.visibilityState === 'hidden'`
— which suspends compositor-driven animation and stops synthetic input reaching
the page. Real `Tab` and `Enter` were used for the keyboard walkthrough before
that, and the overflow menu's Escape, focus-on-open and focus-return were driven
through the page's own handlers instead. Its **arrow-key roving was not
re-checked with a real key press**; it is covered by `overflow-menu.test.tsx`,
whose assertions are confirmed by mutation.

**One measured caveat, recorded rather than rounded away.** In an occluded
window, `ResizeObserver` delivery is throttled along with everything else driven
by the rendering loop, and the deck rail's spotlight was observed trailing its
anchor's HEIGHT by 17.5px on a 5,715px box — 0.3%, with `left`, `top` and
`width` exact — until the next `position()` call, which any scroll or a
delivered observation triggers. The visible consequence is that the ring's
bottom edge, already thousands of pixels below the fold on that region, is
briefly a little short. It is listed because it was seen, not because it is
worth fixing: the three mechanisms that place the ring (a layout effect on every
commit, the scroll listener, and the observer) all corrected it immediately.

**Re-verified after rebasing onto `main`**, which had moved by six commits
including 375 lines of `App.tsx` (ADRs 0034–0036 and a Quickbuild change). The
merge was textually clean, which is not the same as correct, so the masthead was
re-measured from the running app: nine children, and wordmark 135.1 / Graph 47.6
/ Quickbuild 73.6 / Help 39.6 / overflow **25.9** — every term as ADR-0032
derived it. The tour fired once on a fresh commander, walked 1, 2, 3, 4, 6, 7
with every spotlight exactly on its anchor, finished with focus on `.workspace`,
and logged nothing to the console.
