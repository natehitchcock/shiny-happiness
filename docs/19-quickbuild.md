# 19. Quickbuild

**Status: BUILT.** §19.4's six open questions are answered below, each with the
reasoning and, where the answer came from measurement, the numbers.

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

## 19.4 Questions, answered

All six are settled. Q1, Q2 and Q6 were settled by measurement or by reading
the code; Q3, Q4 and Q5 were product decisions. Where a number appears below it
was measured, not recalled.

### Q1. Does Quickbuild need a server change? — **No. The gap becomes a query.**

Measured on eight real decks (10–99 cards accepted, ~5,000 eligible candidates
each) by running `recommend` twice with identical inputs: once at
`limitPerGroup: 8` and through the client's own `shownGroups` merge-and-halve,
and once with the cut lifted. Same scorer both sides, so this compares a view
against a view rather than inventing a second ranking.

Restricted to gaps where the cut actually bites:

| gap | n | all three already visible | of the individual cards |
|---|---|---|---|
| composition, role (`fills-<role>` exists) | 49 | **96%** | 99% |
| composition, type (no group exists) | 5 | 40% | 67% |
| curve (no group exists) | 6 | **33%** | 61% |
| compound, role × curve | 19 | 63% | 79% |

So the spec's option **(a)** — pick from what the client already holds — is
right for a plain role gap and right *by construction*: the product already
emits a group named for that gap, sorted by the same score, so the top three of
the visible eight are the top three, full stop.

It fails for curve, and cannot be rescued client-side. The mechanism, not just
the observation: **curve is not a grouping dimension anywhere**, and `curveFit`
returns the *same value for every card in a bucket*, weighted 0.3 — the
smallest of the varying terms, against synergy 0.8, inclusion 0.6, keyword
synergy 0.7 and emphasis 1.0. The group's order therefore carries no signal
about mana value at all. Observed: the best two-drop removal sitting at rank
17, 19, 29 and 39 of its own group, always past the cut. No client-side picking
recovers a signal the ordering does not carry.

Option **(b)** — a server "gap mode" — would fix it, at the cost of a wire
contract change and an ADR. It is not needed, because a third option exists
that the spec did not consider:

**(c) the gap becomes an ordinary `query` on the ordinary request.** `groups`,
`query` and `limitPerGroup` are already on `POST /recommendations`, so
`{ groups: ['fills-ramp'], query: 'role:ramp mv=2' }` asks the narrower question
with **no contract change and no ADR**, and inherits P4, P5, P6, budget,
bracket, colour identity, semantic emphasis and the ADR-0026 guarantee intact,
because it is the same code path. Measured: **12 of 12 gaps exactly right, 36 of
36 cards.**

Two things that fell out of the measurement and would otherwise have shipped as
silent bugs:

- **Bucket 7 is a catch-all.** `curveBucket` clamps at `CURVE_BUCKETS - 1`, so
  the top bucket holds "seven or more" and `mv=7` silently drops the rest of
  it. It missed Darksteel Forge (mana value 9) on a real deck. `gapQuery` emits
  `mv>=7` there and `mv=N` everywhere else.
- **The role divergence (ADR-0031).** Option (c) was only 7/12 until grouping
  and counting were made to agree; every one of its misses was that defect. See
  below.

**`limitPerGroup: 8`, never 3.** Asking for three would make the focus
guarantee append three more to a list of three, and taking the first three from
that would discard exactly the rows ADR-0026 promised — the same defect, one
layer up, reintroduced by the caller. The panel asks for the normal eight and
takes three from the front.

**Candidates are taken in the order the server emitted the groups**, never by
comparing scores across a group boundary. Scores order cards within a group and
nowhere else (P5). A role gap names its own group, so there is only one; a type
or curve gap has none, so every group is asked and the product's own priority —
combo, near-combo, the gap groups, staples — decides what leads.

#### What Q1 turned up on the way: ADR-0031

The measurement found a live defect older than Quickbuild. Grouping assigned
`fills-<role>` from `pooled.roles[0]` — raw database array order — while
`countComposition` counts a card under `primaryRole(roles)`. The two disagreed
on **8.4%** of the candidate pool, putting **20.4%** of the rows shown under a
`Fills gap · X` heading on cards that do not count toward X at all. "Fills gap ·
draw −9" offered Shorikai, Genesis Engine, Ominous Seas and Bone Miser, all of
which count as `token-maker`; accepting one moved a meter the heading had not
named, which makes the `fills-deficit` reason false rather than imprecise (P4).

Fixed in its own commit, with ADR-0031. Quickbuild's whole promise is "accept
this and the gap you were shown closes", so it could not be built on top of it.

### Q2. What is a gap when the deck is nearly empty? — **The archetype's build order, derived.**

Not the curve, and not "add a few cards first". Below a threshold the deck
follows its archetype's own build order; above it, the largest gap leads (D3).

**The order is derived from `archetype-targets.ts`, not written down.** It is
the targets sorted by descending `ideal` — the ideal *is* the number of slots
the archetype spends on a dimension, so the largest is both what most decides
whether the deck is buildable and what cannot be left to the end. Thirty-six
lands do not fit into whatever is left over.

The reason to derive rather than tabulate is visible in the output: each
archetype's identity dimension rises on its own.

```
aggro        land(35) > creature(32) > ramp(9)  > draw(8) > spot-removal(7) > …
control      land(36) > creature(14) > spot-removal(12) > draw(12) > ramp(11) > …
combo        land(34) > creature(20) > ramp(13) > draw(10) > tutor(8) > protection(7) > …
tokens       land(35) > creature(24) > token-maker(14) > ramp(10) > …
stax         land(35) > creature(16) > stax(12) > ramp(12) > draw(8) > …
voltron      land(36) > creature(12) > ramp(10) > draw(8) > spot-removal(8) > equipment(7) > …
aristocrats  land(35) > creature(30) > ramp(10) > draw(9) > recursion(7) > spot-removal(7) > …
```

No table says "stax decks care about stax" — the number 12 already said it.

**Ties break toward the dimension that departs furthest from the MIDRANGE row**,
which `archetype-targets.ts` names as "the reference every other row is stated
relative to" and doc 14 §14.3 calls the least-wrong default. Stax spends 12 on
`ramp` and 12 on `stax`; midrange spends 11 on ramp and nothing on stax, so
`stax` is the half of that tie that says what the deck is. Then by key, so the
order is total and cannot depend on iteration luck (D3). The tie-break earns
its place: it also puts control's removal above its draw, aristocrats' recursion
above its removal, and voltron's equipment above its protection.

**Rejected: `ROLE_PRECEDENCE`.** It exists to pick a card's single counted role,
ordered "most specific first" for that purpose. That it also begins with `land`
is a coincidence, and the first time either purpose moved the other would have
been silently wrong. One list answering two questions is exactly how ADR-0031's
defect happened.

**Rejected: a hand-written order beside the targets.** It was the fallback if
nothing could be derived. Nothing needed it, and a second table would have to be
reviewed against the first forever.

**The handover threshold is the archetype's own largest single target** (the
land count, 34–37) — derived, not chosen. Below it, worst-first carries almost
no information: a twelve-card midrange deck is twenty-four lands short, twenty
creatures short and nine ramp short, so the land gap dominates every other gap
and keeps dominating until the mana base is nearly done, while the rest of the
deck has no shape at all. Above it the deck holds enough cards that a dimension
being short is a fact about *this deck* rather than a restatement of its
archetype.

The handover is safe to place anywhere in that region because **the two
orderings coincide on an empty deck**: with nothing accepted every deficit
equals its own ideal, so "largest gap" and "largest commitment" are the same
list, and they separate only as the builder fills things in. A test pins that
agreement. The threshold decides when to stop trusting the plan; it does not
adjudicate between two rival answers.

### Q3. Should an active filter constrain Quickbuild? — **Yes, and the panel says so.**

The gap's query is ANDed with the builder's, and whenever a filter is in force
the panel prints it: *"Your filter `t:artifact` is also in force, so these are
the best candidates that match it. Clear it to see the rest."*

Saying it is the whole mitigation for the risk Q3 names. A filter set an hour
ago can leave a gap with no candidates, and "nothing fills this gap" and
"nothing matching your filter fills this gap" must not render as the same
sentence — so they do not.

### Q4. Narrow widths — **degrade to one, never to a yes/no.**

The grid is `repeat(auto-fit, minmax(15rem, 1fr))`, so the pane's own width
decides how many are drawn: three at 1000px, two at 700px, one at 420px and
below (measured in a browser). At every width **all three stay in the DOM with
their own Add and Reject**, so all three are reachable by Tab, and the panel
always prints "Option *n* of 3". It never becomes "yes or no to this one card",
which is a different and worse question than "which of these three".

### Q5. Does Quickbuild ever suggest a cut? — **No, and it says so.**

An over-full bucket cannot be closed by adding anything, so it is never offered
as a gap. It is reported separately instead, and the panel prints the limit:
*"Quickbuild only adds cards, so it cannot help with 2 too many at mana value 5.
The cut indicator names 1 card to consider removing."*

Never silently skipped. A wizard that appears to do nothing is worse than one
that names what it does not do.

### Q6. Where does the land count fit? — **A composition gap, and intended.**

Confirmed by reading `curve.ts` and `composition.ts`, and it is deliberate three
times over, not incidental:

1. `land` is a `Role` and is **first** in `ROLE_PRECEDENCE`, commented "land
   wins outright because the land count is the number people check first".
2. Every archetype in `archetype-targets.ts` carries an explicit `land:` ideal
   (34–37) with a band and a curve-based modifier.
3. `countComposition` explicitly excludes lands from `manaCurve`, commented "a
   36-land deck is not over-full at zero".

So a land shortfall is always a `fills-land` composition gap and can never be a
curve gap. Confirmed empirically: `role:land` appeared as a composition gap on
all eight decks measured.

### One number the panel states differently from the rails

The composition rail shows progress toward the **ideal** (`0 / 38`) and the feed
heading reports distance to it (`Fills gap · land −38`). The panel asks for the
distance to the **band** instead — "35 more land".

Deliberate, and worth stating because three numbers for one gap invites a bug
report. Quickbuild's question is "what should go in next", and a deck inside its
band is not wrong; asking for 38 would have it keep working a gap the meter
beside it already shows as satisfied. The rails answer "how close am I to the
shape I want", which is a different and equally real question. Both are labelled
in words rather than left as bare numbers.

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

All of it is built, and all of it was checked with real key presses in a real
browser rather than asserted:

| claim | how it was checked |
|---|---|
| dialog semantics | `role="dialog"`, `aria-label="Quickbuild"` read off the live DOM |
| focus moves in on open | `document.activeElement === .quickbuild` after the masthead click |
| focus trapped | real `Tab` on the last control landed on `Close`; real `Shift+Tab` on the first landed on `Skip these three`; both stayed inside |
| Escape closes | real `Escape` removed the panel |
| focus returns | after Escape, `document.activeElement` was the Quickbuild button, `aria-pressed="false"` |
| every action keyboard-reachable | nine focusable controls, and every option keeps its own Add and Reject at every width |
| each recompute announced | `role="status"`, `aria-live="polite"`, mounted empty from the first render; observed changing from "35 more land. 3 options: The Mycosynth Gardens, …" to "34 more land. 3 options: …" after an add |
| the three are a list | `<ul>` labelled "Three candidates for this gap"; each option labelled "Option 2 of 3: Lazotep Quarry", because `Detail` renders its own reason list inside and unlabelled items would be indistinguishable from it |
| nothing by colour alone | the focused option carries a left rule *and* the panel prints "Option n of 3"; the filter, limit and failure notes are sentences before they are anything else |

---

## 19.6 Out of scope for a first version

- Suggesting cuts (Q5).
- Multi-card "packages" (a combo's missing two pieces as one pick).
- Any automatic build — Quickbuild always asks; it never fills a deck by itself.
- Persisting Quickbuild state across sessions.
