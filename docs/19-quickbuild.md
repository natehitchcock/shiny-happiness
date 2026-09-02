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
  offer the curated staples, then the curated staple lands   ← the opening phase
        ↓                                                       (ADR-0044)
  then pick the deck's most pressing gap, in the derived
  build order                                               ← ADR-0040, untouched
        ↓
  present three candidates for THAT gap, each as full card detail
        ↓
  builder adds one, skips all three, or leaves
        ↓
  recompute; repeat
```

### The opening phase (ADR-0044)

Two gaps of `kind: 'staples'` sit ahead of everything the build order derives:
the cards essentially every deck in these colours wants, and then the lands.
They are prepended rather than sorted in, because `sort` weighs composition
against curve by *cards owed against a target* (D3) and a staples count is
neither owed nor against a target — mixing them would need a weighting this
spec has no basis to invent.

The two counts are the `total` of the `staple` and `staple-land` candidate
groups, read off the recommendations response the workspace already holds. They
are **not** recomputed from the curated list and the deck: `recommend` has
already applied the colour identity, the accepted set, the exclusions (P6), the
per-card budget cap and the deck's remaining bracket allowance, and none of
those inputs reach `quickbuildPlan`. The feed is on screen beside the panel, so
a second count computed here could contradict the heading the builder is looking
at. One definition, two surfaces.

**The phase ends by arithmetic, not by a switch.** Every accept and every
rejection removes a card from the group that produced the count, so the count
falls by one and the gap disappears when the last one goes — `short > 0` is the
same condition that opens a composition gap. There is no terminal state to stall
in and no empty group to sit on. When both reach zero the plan is identical to
the plan a caller that never sent the field would have got, and the derived
order leads: creature first, land last.

A staples gap adds **no query clause**. Its key *is* the group key, so the panel
asks for that group and nothing else; there is no expressible filter for "is on
the curated list", and a second, weaker copy of a decision already made is what
ADR-0031 is about. The builder's own filter still travels with it (Q3).

It runs out of gaps when the staples are spent and every goal is inside its
band, or the builder closes the panel. Both are ordinary outcomes; neither is a
failure state.

**Running out of gaps is not the same as being finished, and §19.8 is about the
difference.** The panel used to print one sentence and stop there, which read as
completion to a builder forty-two cards short of a legal deck. It now says what
is true and asks which way to go, and it never closes itself (ADR-0040).

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

#### D6 addendum — the three boxes were ragged, and the grid was not why (ADR-0040)

> "the quickbuild detail pane borders are weirdly not filling their parent pane,
> and each one is different dimensions so it looks very disorganized"

Q4's rule was not at fault: `repeat(auto-fit, minmax(15rem, 1fr))` collapses its
empty tracks, so three options always take three equal full-width columns. Two
other things were.

**Six frames for three cards.** `.rt-detail` carries a border, a radius, a
background and 12px of padding, because where `Detail` normally mounts that
frame *is* the panel. The panel put three of them inside three `<li>` boxes that
carry a frame too. The outer three are grid items and stretch to the row; the
inner three are ordinary blocks sized to their own text — so oracle text of 128,
300 and 85 characters drew three visibly different rectangles floating inside
three identical ones.

**An inline `width: 340px`.** `Detail` renders `style={{ width: w }}` with `w`
defaulting to `levelSpec(3).width`. Measured at 1600px: **340px of card inside a
446px box, leaving a 106px strip of empty pane down the right of each.** That is
the literal reading of "not filling their parent pane", and it is the half no
selector could have fixed, because inline beats a stylesheet.

The option keeps one frame — and the left rule that marks focus without relying
on colour — and `.rt-detail` gives up its own and takes the whole box.
`Detail` is untouched: the nominal width is genuinely wanted in the 21rem detail
column, and the `<img>` still needs it as a number to reserve its box before the
art loads. `!important`, with the same reasoning and the same precedent as
`.preview-art .rt-face` in the same sheet.

Measured after, at five pane widths — every option identical in width at every
one, and identical in height within a row:

| pane | columns | option box | card inside |
| --- | --- | --- | --- |
| 1387 | 3 | 446 × 939 | 426 × 898 |
| 1008 | 3 | 319 × 882 | 299 × 842 |
| 700 | 2 | 329 | 309 |
| **426** (1320px with the detail pane open) | 1 | 392 | 372 |
| 360 (mobile) | 1 | 326 | 306 |

All three stay in the DOM with their own Add and Reject at every width — nine
focusable controls throughout — and nothing overflows horizontally.

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

### Q2. What is a gap when the deck is nearly empty? — **The archetype's build order, derived. Lands last (ADR-0040).**

Not the curve, and not "add a few cards first". Below a threshold the deck
follows its archetype's own build order; above it, the largest gap leads (D3).

**The order is derived from `archetype-targets.ts`, not written down.** It has
two terms, and the first one is a correction to what this section originally
said.

**A dimension whose target the DECK'S OWN CONTENTS move is built last.** The
report was "lands are the last things you should pick", and the first version of
this order led with land in all nine archetypes — because land is the largest
ideal in every row and the order was descending ideal. Largest commitment and
most-worth-choosing-deliberately turn out to be close to opposite, and
`compositionTargets` says where they separate: the curve modifier moves the land
ideal by one in each direction against the deck's own average mana value, and
`modalLandBacks` moves it again. **Every other ideal is settled once the
archetype and bracket are known; the land ideal is a function of the deck you
have already built.** You cannot know how many lands a deck wants until you know
what they are casting, and a target that is not yet knowable cannot be built
first.

`deferredDimensions` finds that set by **probing** `compositionTargets` — every
archetype, four deck shapes — rather than by naming `role:land`. A new role is
deferred if and only if the model makes its ideal deck-dependent, which is what
lets this survive the role taxonomy moving underneath it.

**Past the deferred ones the order is what it was:** the targets sorted by what
the archetype spends on them, largest commitment first. The reason to derive
rather than tabulate is still visible in the output — each archetype's identity
dimension rises on its own — and `creature`, which `archetype-targets.ts` reads
as the threat count, now leads all nine.

```
aggro        creature(32) > ramp(9)  > draw(8)  > spot-removal(6) > … > land(35)
midrange     creature(26) > ramp(11) > draw(9)  > spot-removal(6) > … > land(36)
control      creature(14) > draw(12) > ramp(11) > spot-removal(6) > counterspell(5) > … > land(36)
combo        creature(20) > ramp(13) > draw(10) > tutor(8) > protection(7) > … > land(34)
ramp         creature(22) > ramp(15) > draw(9)  > spot-removal(5) > … > land(37)
tokens       creature(24) > token-maker(14) > ramp(10) > draw(8) > … > land(35)
stax         creature(16) > stax(12) > ramp(12) > draw(8) > … > land(35)
voltron      creature(12) > ramp(10) > draw(8) > equipment(7) > protection(7) > … > land(36)
aristocrats  creature(30) > ramp(10) > draw(9) > recursion(7) > sac-outlet(5) > … > land(35)
```

No table says "stax decks care about stax" — the number 12 already said it. And
no table says "lands last" — `compositionTargets` already said that too.

> **This has already survived one taxonomy change, which is what the probe was
> for.** ADR-0037 split `counterspell` and `bounce` out of `spot-removal` and
> raised `graveyard-hate` while this was being written. `deferredDimensions`
> still returns exactly `{ role:land }` — it went looking rather than being told
> — land is still last in all nine, `creature` still leads all nine, and the
> three new roles took their places by their own ideals. **No code changed.**
> Four test expectations that pinned concrete counts moved, which is the whole
> cost and is exactly what those tests are there to report.

**The rest of "bombs, win conditions, high synergy combos" is not an ordering
problem.** `wincon` and `synergy` are roles, and **no archetype gives either an
ideal**, so neither is a composition dimension and neither can ever be a gap.
There is no order over these targets that leads a builder to a bomb. That half
of the report is answered where the loop ends (§19.8), by saying so.

**Rejected on measurement: ascending `ideal`** — the direct inversion, on the
reading that one card is `1 / ideal` of its dimension. It does put land last in
all nine with no extra term, and it sinks exactly what this derivation exists
for: `token-maker` eighth of ten for tokens, `stax` seventh of nine, and every
archetype led by its one or two board wipes.

**Rejected on measurement: departure from midrange as the primary key.** Midrange
against itself is all zeros, so the default archetype gets no order at all; and
combo's land sits at Δ2 in mid-pack while its draw (Δ1) goes last, so it does not
deliver "lands last" either. It stays as the tie-break it already was.

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

**The handover threshold is the smallest deck that could be inside every band** —
the sum of the role dimensions' minima. Measured: **56** for midrange at bracket
3, 49 for aggro, 65 for stax.

It is a real lower bound because role counts do not overlap
(`archetype-targets.ts` constraint 1: "`land + Σ roles` is therefore a real
budget against 99"). Type dimensions are excluded for the same reason read
backwards — a creature that ramps is counted in both `creature` and `ramp`, so
adding the creature floor would count those cards twice.

Below it a deck **cannot** be inside every band however its cards were spent, so
being short somewhere is arithmetic rather than evidence: worst-first restates
the archetype and the plan is the only thing that tells the dimensions apart.
At or above it a shortfall is a fact about *this deck* and the deck's own shape
wins.

The threshold is compared against `counts.total`, and **`total` counts copies
since ADR-0034**.

> **This threshold was re-derived, and the reason is worth keeping (ADR-0040).**
> It used to be the archetype's largest single target — the land count, 34–37 —
> and it was safe to place anywhere in that region because **the two orderings
> coincided on an empty deck**: with nothing accepted every deficit equals its
> own ideal, so "largest gap" and "largest commitment" were the same list.
> Deferring the land count reverses land's position outright, so **that
> coincidence is gone**. The threshold now genuinely adjudicates between two
> rival answers, which is why it could not keep a value justified by their
> agreeing. A test pins the **disagreement** where it used to pin the agreement.

The same number is where the loop runs out of opinion — a deck inside every band
holds at least this many cards by construction — which is what makes the
handover, the ending in §19.8 and the "58 of 100" in the report one idea rather
than three.

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

> **That eight-of-eight measurement was taken against a broken count and should
> not be read as evidence about decks** (ADR-0034). `countComposition` was
> counting distinct oracle ids, so every deck holding basics reported a land gap
> it did not have — Yedora Sacrifice Engine measured 8 lands while holding 27.
> The structural claim above is unaffected: a land still cannot be a curve gap,
> because lands are excluded from `manaCurve`. What is void is the frequency.
> Re-measured after the fix, Yedora's largest gap is **ramp**, not land.

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

---

## 19.7 The queue — why the next trio is already in hand

The loop in §19.2 recomputed and refetched after every pick, so each one cost a
round trip through the workspace's own pipeline — the 600 ms click buffer, the
recompute, the 1.5 s settle — before the panel even asked for new candidates.

Measured in a browser on a real deck, from the click to the next trio being on
screen, with the same deck state on both sides:

| | before | after |
|---|---|---|
| time to the next trio | **5,447 ms, 5,998 ms** | **33, 39, 40, 42 ms** |
| recommendations requests per pick | 2 | **0** |
| picks that showed a loading state | all | none |

About **150x**, and the requests on the path go to zero. The remaining ~35 ms is
one React render: the click retires the card optimistically, the queue filters
it out, and the next candidate slides up.

(The "after" numbers are read from a `MutationObserver` on the option list. An
earlier poll loop reported ~1,000 ms for the same picks, which was the browser
clamping its own nested timers rather than anything the panel did — worth
recording, because the first version of this measurement would have understated
the change by a factor of twenty-five.)

### What is prefetched, and why there is only one thing to prefetch

A trio has four outcomes — take the first, the second, the third, or skip all
three — and they look like four different next states. They are not.

**Measured on four real decks, 48 consecutive picks:**

| question | answer |
|---|---|
| Is the leading gap the same after a pick? | **48 / 48 (100%)** |
| Is the fresh top three exactly the held list minus the taken card? | 26 / 48 (54%) |
| How many of the three are the same? | **120 / 144 cards (83%)** |
| How often do all three differ? | **0 / 48** |

The gap survives a pick essentially always, because the gaps that lead are large
— a deck 27 lands short does not stop being short because one land went in. And
because the gap survives, **all four outcomes consume from one list**: they
differ only in which card leaves it, never in which query produced it. So there
is nothing to fan out. One fetch answers every branch, and the "four requests,
one per outcome" version of this feature does not need to exist.

What the queue holds is therefore simply *this gap's candidates*, and a pick is
a filter over them rather than a request.

### What is discarded

The queue is keyed by **gap and filter**. When either changes it is dropped on
the spot — not filtered, not shown while a replacement loads. A stale trio under
a live heading is worse than the wait this removes, so the empty moment is the
correct behaviour and there is a test that asserts the old gap's cards are gone
*before* the new answer arrives.

A superseded fetch cannot be cancelled, only recognised on arrival, so the panel
carries a `generation` counter — the same device, for the same reason, as the
one in `pipeline.ts`. A late answer whose gap and filter both happen to match
the current question again is still dropped, because it was computed three
questions ago.

### The ranking inside a gap is fixed when the gap opens

This is the honest cost, stated rather than hidden. The 54% figure above is the
whole of it: after a pick the pool genuinely reorders a little, because the
accepted card joins the deck's synergy profile and every candidate's score moves
with it. The queue does not follow that drift until it is refilled.

It is accepted for three reasons. The drift is small and bounded — 83% of cards
in common, and never a case in 48 where all three changed. It is confined to the
third slot, a card the builder has not looked at yet. And the product already
takes this position deliberately elsewhere: `pipeline.ts`'s settle exists so
that "the list does not reshuffle under a user who is mid-click".

The drift is bounded in time as well as size: the background top-up re-asks with
the current deck state, so the ranking refreshes as the builder works through a
gap rather than never.

### The two page sizes

`limitPerGroup: 8` for the first fetch — what the feed asks for, so the panel's
first paint is as fast as the feed's — and **24 in the background while the
builder reads that first trio**. That is literally the "queue up the next query
while they are picking" the change was asked for.

Depth is nearly free on the wire (43 ms at limit 8, 46 ms at limit 30, measured
against the live API) but not free in hydration, which fetches a card, a price
and an image per row. Hence small first, deep second, off the path anyone waits
on. A gap asked of every group — every type and curve gap — already comes back
with about 67 rows and never triggers a top-up at all.

**Neither page is three (ADR-0026).** A three-row request lets the focus
guarantee append past a three-row list, and taking three from the front of that
discards exactly the rows it promised. Asking for *more* is always safe: the
guarantee appends at the tail and the panel reads from the head.

A background top-up is silent in every direction — no waiting state, no
announcement, no bar, and a failure is swallowed. There are three cards in front
of the builder and nothing about their situation has changed.

### The loading bar

It appears only when the queue cannot answer **and** the wait has outlasted
**150 ms**.

That number is derived from two ends. Below it, about 100 ms is the limit under
which a delay is not experienced as a wait at all, so a bar shown and hidden
inside that window reports a wait the builder did not have. Above it, the gap
fetch runs at a 43 ms median and a 60 ms p90 against the live API, so 150 ms
sits above the common case with headroom for hydration and render and a normal
fetch never reaches it. It stays far below the one-second mark where an
interface stops feeling continuous, so a genuinely slow fetch still gets its bar
promptly — this delays the bar, it does not suppress it. A silent wait is worse
than a visible one.

Verified in a browser by delaying only the recommendations call and sampling the
panel every 50 ms. Reading `0` for an empty panel, `B` for the bar and `3` for a
trio, one gap change produced:

```
0 B B B 3 3 3
```

Nothing at ~50 ms — the queue has been discarded but the wait has not yet earned
a bar. The bar from about 100 ms to 200 ms, while there is genuinely nothing to
show. Gone the moment the trio lands. Across the six measured picks that were
served from the queue, it never appeared at all.

### What did not change

Skip is still a pass (D5): it advances a cursor and sends nothing, and the
six-skip test still shows zero commands and an unchanged excluded count. Each
pick is still an ordinary accept through the command log (D4). The filter is
still respected and still said out loud (Q3). P6 is now enforced *harder* than
before: the queue is filtered against the deck's accepted and excluded ids on
every render, so a card excluded in the feed behind the panel leaves the queue
the same frame, without a refetch.

### Why not `usePipeline`

`pipeline.ts` is the deck's **write** pipeline: it buffers clicks, sends
commands, and deliberately delays applying the answer so the list does not move
under someone mid-click. Quickbuild's queue is a **read-ahead cache**. It sends
no commands, has nothing to batch, and must not delay anything — its whole
purpose is to remove a delay.

Mounting a second `usePipeline` would give the panel a second progress bar
animating on a fabricated schedule (`ASSUMED_QUERY_MS`) toward a fabricated
midpoint, to answer a question that is binary: is a trio in hand or not. What is
reused is the part that transfers — the `generation` counter, and the lesson
behind `describe` returning `string | undefined`, which is why the live region
stays silent while a first fetch runs instead of narrating "Preparing…" at a
screen reader.

### What the queue got wrong, and how it was found (ADR-0040)

`deep` was treated as "there is nothing further to top up". That is true of the
**server's answer** and false of the **deck**, and the two are not the same
question: `recommend` never offers a card the deck already holds, so its answer
for one gap changes every time the builder takes one.

A builder working a single large gap therefore consumed all twenty-four held
candidates and the queue emptied for good. Found by driving a real deck rather
than by reading: at **96 of 100 cards on an eight-card land gap**, the panel said
*"Nothing in your colours fills this gap"* while `POST /recommendations`
returned eight more for the same query at the same moment. That is a false
statement about the deck, made in the sentence Q3 built specifically so that
"nothing fills this" and "your filter excluded them" would never render the same
— and it was a third route to the report's "ended while gaps remained".

A queue drained below a trio is now refilled. It cannot loop, because the refill
is conditioned on **the deck having changed since the fetch** and not on the
queue being empty: the queue records `retiredIds.size` at fetch time, and asking
again with an unchanged deck would return the identical list, so it is not
asked. The refill shows the loading bar only when the queue is completely dry,
which is the one case where there is genuinely nothing on screen to read.

---

## 19.8 The ending — running out of gaps is not being finished (ADR-0040)

> "quickbuild ended while I was below curve on ramp and spot removal, and also
> only at 58 of 100 cards. Once all your curves are satisfied, it should ask you
> if you'd like to continue quickbuilding, or go back to the suggestion list now
> that your deck allotments are met and you just need to pick X more cards"

### The arithmetic behind 58

Both halves of that report were true at once, and the panel said neither.

**A band's floor is three cards under its ideal.** `ramp` at 8 of 11 is inside
its band and visibly under its meter at the same time, so "below curve on ramp"
and "no ramp gap" are both correct readings of the same deck. §19.4's note on
the three numbers already said the panel measures to the band; what it did not
say is what that looks like when the last gap closes.

**The role minima sum to 55** for midrange at bracket 3 — that is the same
number as the handover threshold, and not a coincidence. So a deck reaches every
band at 55 cards **with 45 still to find**, and the panel's "Nothing to fill."
read as completion to someone forty-two cards short of a legal deck.

**And 25 of those slots have no target at all.** Midrange spends 75 of 100 on
roles; the remainder is what `archetype-targets.ts` calls "the deck's unroled
threats and payoffs". `wincon` and `synergy` are roles no archetype gives an
ideal, so bombs and win conditions are not composition dimensions and can never
be gaps. This is the one part of the deck Quickbuild genuinely cannot lead
anybody to.

### What it says now

> Every composition and curve allotment is inside its band. The deck holds 58 of
> 100, so there are 42 more cards to pick. Your archetype leaves 25 slots with no
> target at all — the threats and win conditions — and Quickbuild has no opinion
> about those.
>
> **[Keep quickbuilding to the ideals] [Back to the suggestion list]**

- **It never closes itself.** §19.2's "both are ordinary outcomes" stands; what
  changed is that neither happens without the builder saying so. Same principle
  as Q5: a wizard that goes quiet about its own limit looks broken instead.
- **Keep going switches `reach` from `band` to `ideal`** — the number the
  composition rail is already drawing, so it is not a new opinion, just the other
  honest one. `band` stays the default, and the reach resets to it every time the
  panel opens: reaching for the ideals is something the builder asked for once,
  about the deck as it stood.
- **`beyond` on the plan is what decides whether the offer appears.** It is the
  gaps that would exist one reach further out, so the button cannot be a door
  onto the same ending.
- **The count is the deck's own.** `held` is carried rather than recovered as
  `DECK_SIZE − unallocated`, which floors at zero — observed on a 121-card deck,
  where the arithmetic version says "the deck holds all 100 cards".
- **It is announced.** The ending is the one moment the panel stops asking
  questions, and a screen-reader user who hears nothing there cannot learn that
  a choice is waiting.

### The three cursors that ended the loop early

"Ended while gaps remained" was not one defect. Three, all the same shape — a
cursor over a list that shortens underneath it — and the plan is recomputed on
every accept, so all three were reachable in ordinary use.

| what | what the builder saw |
| --- | --- |
| `gapAt` was an INDEX into `plan.gaps`; "Different gap" advanced it modulo the length at click time | two clicks, then the plan shrank, and `plan.gaps[2]` is `undefined` → **"Nothing to fill"** with ramp and spot removal still short |
| `passed`, the skip cursor, had no memory of which gap it counted for | skip twice, that gap closes, and a cursor of six slices past the next gap's whole first page → **"No more candidates for this gap"** about a gap it had never shown a card for |
| the queue never refilled once `deep` landed | **"Nothing in your colours fills this gap"** at 96 of 100 while the server returned eight more |

The first is a gap **key** now, falling back to the leading gap when the chosen
one closes. A wrapping index was tried first and rejected in the browser: it
cannot go out of range, but it points somewhere arbitrary the moment the length
changes, which is exactly the reshuffling D3 forbids.

### Walking a real deck from empty to the ending

Driven in a browser on an Atraxa midrange deck at bracket 3, taking the first
option every time. The gap sequence, in the order the panel offered it:

```
build-order regime   creature → ramp → draw → spot removal → protection
                     → board wipe → tutor → LAND (last, at 34 short)
handover at 55       ordering flips to largest-gap-first
largest-first        land → spot removal → protection → (ends)
```

Land is last in the build order **while being by far the largest gap** — 34
short on an empty deck against a creature gap of 19 — which is the whole of the
change, visible in one line. It is then picked up by worst-first once the deck
is big enough for its own counts to be evidence, which is the handover doing the
job it was re-derived for.

The ending fired with every composition meter inside its band, and printed the
deck's real count rather than a hundred.
