# 20. The quick tutorial

**Status: DRAFT, for review. Nothing here is built.**

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

**Proposed:** the tour fires **once, immediately after the first commander is
chosen**, when the workspace exists and is empty. An empty workspace is the best
possible moment: every region is visible, nothing is cluttered, and the reader
has just committed to building something. The landing page gets nothing but the
Help button.

---

## 20.2 What it covers

Seven steps. Each anchors to a real element and says what the region is *for*,
not what it is called — a label the reader can already see is not information.

| # | Anchor | The point |
|---|---|---|
| 1 | `section[aria-label="Deck"]` | Your deck, grouped by the job each card does. The counts are the deck telling you what it still needs. |
| 2 | `section[aria-label="Suggestions"]` | What to add next. Grouped by *why* — every row carries its reasons. |
| 3 | A suggestion row's reasons | The reasons are the product. A card is here because of this, not because it is "good". |
| 4 | `section[aria-label="Analysis"]` | Composition, curve, combos, bracket — the scoreboard the suggestions are trying to move. |
| 5 | The card detail surface | Full card, both faces' rules, impact and value. |
| 6 | Graph button | The same deck as a web of connections, when the lists stop showing you the shape. |
| 7 | Quickbuild button | One question at a time: three cards for your biggest gap. |

Steps 6 and 7 are the two the user named explicitly, and they are last on
purpose — they are alternative ways to work, and they only make sense once the
default way has been named.

---

## 20.3 Decisions this spec makes

### D1. It highlights; it does not drive

The tour points at regions and explains them. It does **not** add a card, open
Quickbuild, or change the deck. A tutorial that acts on your behalf leaves you
holding a deck you did not choose, and this product's whole claim is that every
addition carries a reason you agreed with.

### D2. Skipping is as easy as continuing

"Skip the tour" is a visible control on every step, the same size and prominence
as "Next" — not a small × in a corner. A first-time user who wants to get on
with it must never have to work at escaping. Escape also closes it.

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

---

## 20.4 The masthead — resolved

The row held **Import, Export, Graph**, and this spec plus doc 19 would have
made it five. It does not: **Import and Export move behind an overflow menu**
and the row keeps the three working tools — Graph, Quickbuild, Help. See A1.

Two things follow. The row now grows by one button rather than three, so the
crowding question does not return at seven. And **Help must be genuinely
findable**, because A4 makes it the only route back to a tour someone lost to a
refresh — which is precisely why Help stays on the row and Import/Export are the
pair that leaves it.

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

### A2. Each step scrolls its region into view

One tour everywhere, seven steps on every screen size. Below 900px the regions
stack, so each step scrolls its own region into view before highlighting it —
the tour teaches the layout the reader actually has rather than describing one
they do not.

`prefers-reduced-motion` applies to the scroll as much as to the highlight: an
instant jump, not a glide, for a reader who asked for none.

Rejected: a shorter small-screen tour, which is two tours to keep in sync as the
app changes.

### A3. The tutorial waits for Quickbuild, and ships all seven steps

**This makes doc 19 a hard dependency.** The tutorial does not begin until the
Quickbuild button exists, and ships complete rather than gaining a step later.

The cost, stated: the tutorial is now blocked on a feature that had six open
questions of its own. Four are answered; the build is under way. If Quickbuild
slips, this slips with it — that is the accepted trade for shipping one
coherent tour instead of a six-step tour and a follow-up.

### A4. Opening the tour once counts as seen

The flag is set when the tour **opens**, not when it completes. Someone who
closes the tab at step 3 does not get it again automatically.

The accepted cost is real and was chosen with it stated: a stray refresh at step
1 silently costs a first-time user the entire tour. **Help is the mitigation,
and this raises the bar on A1** — Help has to be genuinely findable, because it
is now the only route back to the tour for anyone who loses it.

### A5. Once per browser, via `localStorage`

Consistent with `lw.deviceId` (ADR-0014) and `lw.cutThreshold`, which already
treat the browser as the identity. Key: `lw.tutorialSeen`.

On a shared machine the second person gets no tour. Consistency wins, and Help
is again the escape hatch.

## 20.6 Accessibility (R4) — binding

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

---

## 20.7 Out of scope

- Any interactive "now you try it" step that requires the user to act.
- Per-feature coach marks appearing as features are first used.
- Localisation.
- A written help page or documentation site; this is a tour, not a manual.
