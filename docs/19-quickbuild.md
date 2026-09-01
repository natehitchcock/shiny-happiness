# 19. Quickbuild

**Status: DRAFT, for review. Nothing here is built.**

A guided loop that fills a deck's composition and curve gaps by asking one
question at a time: *here are three cards for the hole you have; which one?*

The suggestion feed answers "what could go in this deck". Quickbuild answers a
narrower question — "what should go in **next**" — and that narrowing is the
whole feature. A builder with 40 cards and eleven kinds of gap does not need
more options; they need one decision at a time, made in front of enough
information to decide.

---

## 19.1 Entry

A **Quickbuild** button beside Import, Export and Graph in the masthead.

It opens a panel over the **suggestion pane** — not the whole workspace. The
deck rail stays visible on the left and the composition/combos rail on the
right, because the panel's entire justification is closing the gaps those two
rails describe. Covering them would hide the scoreboard while asking you to
play.

---

## 19.2 The loop

```
  pick the deck's most pressing gap
        ↓
  present three candidates for THAT gap, each as full card detail
        ↓
  builder adds one, skips all three, or leaves
        ↓
  recompute; repeat
```

It ends when every goal is inside its band, or when the builder closes the
panel. Both are ordinary outcomes; neither is a failure state.

---

## 19.3 Decisions this spec makes

### D1. Three candidates for ONE gap — not one candidate for each of three gaps

Both readings fit the phrase "three options at a time". They are different
products:

- **Three for one gap** is a *choice*: "you are two two-drops short — here are
  three." The three are comparable, so showing full detail for each pays for
  itself, and the question has an answer.
- **One each for three gaps** is a *smaller feed*. The three cards have nothing
  to do with each other, so there is nothing to compare and the detail is
  wasted; the builder is back to browsing, with a worse view.

**Chosen: three for one gap.** The rejected alternative is recorded because the
phrase genuinely admits it.

### D2. Quickbuild is a VIEW over the existing recommendations, never a second scorer

It reuses the same recommendation pipeline, the same eligibility, the same
scoring. A parallel "quickbuild scorer" would be two rankings disagreeing in
public — the failure `queryColumnsOf` and the shared `metricValue` formatter
already exist to prevent elsewhere.

Consequences that follow, and are not negotiable:

- **P5 holds.** Grouping is the product's opinion; quickbuild may choose which
  group's gap to work on, but it may not invent a grouping or move a card
  between groups.
- **P6 holds.** An excluded card is never presented. See D5 for what "skip"
  does.
- **P4 holds.** Every card shown carries its non-empty `reasons`, including the
  `fills-deficit` reason naming the gap it answers.
- Budget, bracket and colour-identity eligibility are already applied upstream
  and are not re-implemented here.
- An active **filter** still applies. The filter is part of the deck now
  (columns persist with it), so a builder who has filtered to a theme means it.
  **Open question Q3** covers whether that is right.
- **Semantic emphasis** and the ADR-0026 top-three guarantee apply unchanged,
  because they are upstream of the view.

### D3. Gap ordering: worst-first, measured in cards

Curve and composition report gaps in different shapes. `curveDeltas` gives, per
bucket, a `delta` that is the distance to the nearest **edge of the band** and
is `0` inside it. Composition targets give per-dimension deficits.

Both are already counts of cards, so they compare directly: **the gap needing
the most cards goes first.** No weighting between "curve" and "composition" is
invented, because inventing one would be the renderer having an opinion the
model does not.

Ties break toward the gap that has been open longest — a deck that is short one
two-drop and one wipe should not alternate between them on every recompute.
Stability matters more than precision here: a panel that changes its mind each
time you add a card feels broken even when each answer is defensible.

### D4. One card at a time, committed immediately

Each pick is an ordinary accept, through the existing command log (ADR-0020),
so it is undoable and replayable exactly like an accept from the feed. No batch
"apply at the end" mode: a batch would need its own preview, its own undo, and
its own conflict story against a deck edited in another tab.

### D5. Skip is a PASS, not a rejection

Rejecting a card is a permanent statement (P6: never suggested again).
"Show me three others" is not that, and conflating them would make Quickbuild a
minefield — a builder clicking past a card they might want later would silently
exile it.

So: skipping shows three different candidates for the same gap and remembers
nothing beyond the session. **Rejecting** stays available as the explicit,
labelled action it is in the feed.

### D6. Three full card details need width they will not always have

The detail pane is 21rem. Three side by side is ~63rem ≈ 1008px, and the
suggestion feed is **426px** at 1320px with the detail pane open — the case the
four-column layout made ordinary rather than rare.

So the panel is responsive by construction:

| available width | presentation |
|---|---|
| wide | three details side by side |
| medium | three, condensed — art, cost, type, oracle, impact/efficiency |
| narrow | one at a time, with the other two reachable |

The narrow case must not become a carousel that hides the choice: if only one
card is visible, the panel has stopped asking "which of these three" and is
asking "yes or no to this one", which is a different and worse question. **Open
question Q4.**

---

## 19.4 Open questions — for the reviewer

**Q1. Does Quickbuild need a server change?**

Probably yes, and this is the largest unknown in the spec. Groups are cut at
`limitPerGroup` (the workspace asks for 8). The best three cards for *"a
two-drop that is also removal"* may not be inside any group's visible eight —
the group's own ordering has no reason to surface them. Either:

- **(a)** the client picks from what it already has — no contract change, but
  the answers are only as good as the cut; or
- **(b)** the recommendations request grows a "candidates for this gap" mode —
  honest answers, a contract change, and an ADR.

(b) is very likely correct, and the ADR-0026 experience is the evidence: a
guarantee computed server-side still nearly failed to reach the screen because
the client halved a group afterwards. Deciding this changes the size of the
work substantially.

**Q2. What is a "gap" when the deck is nearly empty?**

At 5 cards every bucket is short and the largest deficit is meaningless — the
whole deck is a deficit. Quickbuild is plausibly most valuable exactly there,
so it needs an answer: work the curve first, follow the archetype's own build
order, or say "add a few cards first". Left open deliberately.

**Q3. Should an active filter constrain Quickbuild?**

D2 says yes, on the grounds that the filter is part of the deck. The counter-
argument is real: a builder who filtered to `t:artifact` an hour ago and then
opens Quickbuild may get "no candidates" for a gap artifacts cannot fill, and
the panel will look broken rather than filtered. At minimum the panel must
**say** the filter is narrowing it. Possibly Quickbuild should ignore the filter
and say so instead.

**Q4. Narrow-width behaviour** — see D6. Does the feature degrade to one-at-a-
time, or refuse to open below a width and say why?

**Q5. Does Quickbuild ever suggest a CUT?**

Curve deltas are signed: `delta` is negative when a bucket is **over-full**. A
deck that is four two-drops heavy cannot be fixed by adding anything, and the
existing cut indicator already has an opinion about what to remove. Quickbuild
as specified can only add, so it will eventually be unable to help a deck whose
problem is excess. Extending it to cuts is a bigger feature; refusing to is a
statable limit. Left open.

**Q6. Where does the land count fit?**

Lands are excluded from curve deltas by design ("a 36-land deck is not
over-full at zero"). Composition targets do count them. So a land shortfall is
a composition gap and reaches Quickbuild through that path — worth confirming
that is the intended route rather than an accident.

---

## 19.5 Accessibility (R4) — binding, not aspirational

- The panel is a dialog: focus moves into it on open, is trapped while open,
  returns to the Quickbuild button on close, and **Escape** closes it.
- Every action — add, skip, reject, close — has a tap target and a keyboard
  equivalent with visible focus.
- The three options are a **list**, and moving between them is a keyboard
  operation, not a hover.
- Each recompute announces what changed to a live region. A panel whose content
  silently swaps under a screen-reader user is unusable.
- Nothing is conveyed by colour alone.

---

## 19.6 Out of scope for a first version

- Suggesting cuts (Q5).
- Multi-card "packages" (a combo's missing two pieces as one pick).
- Any automatic build — Quickbuild always asks; it never fills a deck by itself.
- Persisting Quickbuild state across sessions.
