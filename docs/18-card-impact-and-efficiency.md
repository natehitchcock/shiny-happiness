# 18 — Card impact, efficiency, and columns as deck state

**Status: built.** Two card-intrinsic metrics — how much a card does, and how
much of it you get for the mana — plus the change that stops a builder's columns
dying with the page. The open questions are answered in §18.9 and §18.10 records
where the build diverged from this design, in the form
[doc 16](16-archetype-customiser.md) §16.9/§16.10 set.

Everything numeric in this document was measured against the local corpus on
2026-08-31 (34,492 oracle cards, 31,782 of them commander-legal). Nothing here
is a remembered rule of thumb, and where a remembered rule of thumb disagrees
with the corpus the corpus wins — see §18.6, where "a 2/2 for 2" turns out to be
about 15% below what two mana actually buys.

No ADR. Every contract change is a NEW OPTIONAL FIELD — `Deck.columns`,
`Recommendation.impact`, `Recommendation.efficiency`, and two fields on the card
detail response. Nothing existing changed shape or went away, which is the line
AGENTS.md R2 draws.

---

## 18.1 The question these answer

The workspace can already tell a builder that a card fills a ramp gap, completes
two combos, and costs $3. It cannot tell them the thing they ask first when they
look at an unfamiliar card: **is this card big, and is it worth its mana.**

`score` does not answer it — deliberately. Score orders cards *within* a group
and has no meaning across groups (pillar P5), so it cannot be read as "this card
is better than that one" and must not be shown as though it could. Both metrics
here are the opposite kind of number: they are properties of the card alone, the
same in every deck, and they mean the same thing in the `staple` group as in
`combo-3plus`.

That is what makes them columns rather than scoring terms. A column is an extra
fact about each row (doc 13 and `App.tsx`: "a column does NOT filter"), and a
fact about a card is exactly what these are.

## 18.2 Impact is a property of the CARD, not of the deck

The decision, and the one everything else follows from.

A deck-relative impact — "Wrath of God is low impact in YOUR deck because you run
thirty creatures" — was offered and declined. The reasoning that decided it is
worth keeping, because it is not obvious:

- **The deck already has three deck-relative signals** and they are the whole
  rest of the product: combo degree, role deficits, and mechanical synergy. A
  fourth one would say the same things in a different unit, and the builder
  would have no way to tell which of four numbers to believe when they disagree.
- **A card-intrinsic number is stable enough to learn.** A column whose value
  moves every time you accept a card teaches you nothing about the card; you
  cannot carry "Cyclonic Rift is a 7.2" to the next deck. Doc 05's determinism
  requirement is about the same instinct one level down.
- **It is cheap enough to be everywhere.** Card-intrinsic means it can ride on
  card detail, on search results, and on recommendations without any of the
  three needing a deck. `/cards/search` has no deck at all, and a deck-relative
  metric simply could not appear there.

The cost of this decision is stated plainly rather than patched: **the model is
blind to cards whose whole point is a resource or a tax rather than an effect on
something.** Sol Ring scores 0.68, Rhystic Study 0.81, Smothering Tithe 0.81 —
all near the floor, all format-defining cards. This was raised before the model
was built and the answer was *"sol ring is a lower impact card by this metric,
that's fine."* There is no fudge factor rescuing them, and there should not be:
a correction that exists to make three named cards come out right is a
correction that will be wrong for the fourth.

What this document does instead is make the blindness legible rather than
silent. §18.5's `scales` marker and §18.10's list of what the classifier cannot
see are both there so a builder can tell "this card scores low" from "this metric
cannot see this card".

## 18.3 Breadth — how many things the effect touches

Measured over the 31,782 commander-legal cards, as a **partition**: every card
lands in exactly one tier, so the counts sum to the corpus.

| tier | value | cards | what it is |
| --- | ---: | ---: | --- |
| `none` | 0.5 | 15,597 | has text, but names nothing to affect |
| `one` | 1.0 | 10,033 | one target |
| `few` | 2.2 | 184 | up to two targets |
| `several` | 3.5 | 86 | up to three, four or five targets |
| `variable` | 3.5 | 97 | `X target(s)` — unknowable at rank time |
| `unbounded` | 6.0 | 5,785 | all / each, or a plural you control |

A card with **no rules text at all** is not in the table: its impact is exactly
0, not `none × persistence × stakes`. That is not a rounding convenience, it is
what makes §18.6 work — the vanilla creatures are the measuring stick, and a
measuring stick with a nonzero reading at zero cannot calibrate anything.

### Why the curve is superlinear, and why 6.0

Two shapes stacked, not one.

**The counted rungs are `n^1.14`**: 1.00, 2.20, 3.51. A card that hits two things
is worth slightly more than two cards that each hit one, because it is one card
and one payment. The exponent is the only free parameter in the whole breadth
curve and it is very nearly inert: `few` + `several` + `variable` together are
**367 of 31,782 cards, 1.2% of the corpus**, so any exponent between 1.0 and 1.3
reorders almost nothing. It is recorded as a choice rather than dressed up as a
derivation.

**The step to `unbounded` is the height of the whole counted ladder.** The
counted ladder spans 3.5 − 1.0 = 2.5, so unbounded sits at 3.5 + 2.5 = **6.0**.
That rule is what makes "all" a tier of its own rather than a fourth rung: the
distance from the top of the ladder to unbounded equals the entire ladder. Any
smaller value and unbounded is just "several, but more"; any larger and a
one-shot symmetric wrath outranks a repeating engine on breadth alone, which is
the thing §18.4 exists to prevent.

The justification for treating "all" as categorically different is that it is
**unbounded, not large**. Three targets is three targets in every game. "All
creatures" is whatever is on the board, it grows as the game runs, and — this is
the part a fixed count can never have — it is *worth more the worse your
position is*. No count has that property.

`variable` is given the top counted rung, 3.5, and always carries `scales: true`.
An `X`-target spell reaches as far as your mana does; 3.5 is the most it
reliably reaches, and the marker says the number is a floor rather than an
estimate. Rejected: giving `variable` the unbounded value. `X` is bounded by
mana available and "all" is not, and pretending otherwise would put every
Fireball above every Wrath.

## 18.4 Persistence — how many times it happens

| tier | value | cards | what recurs, and what is paid again |
| --- | ---: | ---: | --- |
| `one-shot` | 1.0 | 17,546 | resolves once |
| `activated` | 1.6 | 5,989 | repeats, but the cost is paid every time |
| `triggered` | 1.9 | 6,155 | `whenever` — free, but waits for an event |
| `upkeep` | 2.2 | 2,092 | `at the beginning of` — free and unconditional |

The ordering is not "how often does it happen" but **how much of the cost recurs
with it**: all of it (activated), none of it but conditional on something
happening (triggered), none of it and nothing to wait for (upkeep). That is a
property of the text rather than a guess about the game, which is why it is the
axis chosen.

The ceiling at 2.2 is deliberate and low. A permanent that repeats is worth
roughly twice a one-shot in the way a two-for-one is worth roughly two cards;
past that, what bounds the effect is the game ending, and the model has no
opinion about how long the game runs. A multiplier of 4 or 5 here would let a
minor upkeep trigger outrank a board wipe, which is not true at any table.

**Fragility overrides all of it.** 1,347 commander-legal cards sacrifice
themselves somewhere in their text — as an ability cost, as an upkeep clock, or
outright. Whatever the type line says, the effect happens once, so `fragile`
forces persistence back to `one-shot`. Viridian Zealot's `{1}{G}, Sacrifice this
creature: Destroy target artifact or enchantment` is not a repeating ability; it
is a Naturalize with a body, and pricing it as an engine is the single largest
class of error this model would otherwise make.

## 18.5 Stakes, symmetry, and the honest refusal to guess

**Stakes** — who is on the wrong end of it:

| tier | value | cards |
| --- | ---: | ---: |
| `player` | 1.4 | 4,389 |
| `opposing` | 1.2 | 8,534 |
| `own` | 1.0 | 4,495 |
| `self` | 0.85 | 14,364 |

An **unrestricted** `target creature` is read as `opposing`, not as its own
middle tier. The target is chosen by the caster and the caster chooses the
opponent's; scoring an unrestricted removal spell *below* one that may only hit
an opponent's creatures would say Swords to Plowshares is weaker than a
strictly worse card.

`any target` is `player`, because it can go to the face. That is why Lightning
Bolt (1.4) outscores Swords to Plowshares (1.2) — a genuine, if small,
consequence of the model that a Magic player may reasonably dispute. It is left
standing rather than special-cased, and named here so nobody has to rediscover
it.

### Symmetry: recorded, and priced with a number already in the table

`each opponent` (a one-sided mass effect, 4,954 cards including the
`you control` pump effects and every wrath restricted to one player's board)
and `all creatures` (a symmetric one, 831 cards)
are not the same card and must not score the same. The user's decision rules out
resolving that against the deck's own board — so it is resolved against the
caster instead, which needs no deck at all: **a symmetric mass effect also hits
you, and a one-sided one does not.**

The discount is 0.85 — *the `self` stakes tier, reused rather than invented*. A
symmetric wrath is a wrath that is also pointed at you, and "pointed at you" is
already a number in the table above. Adding a second constant would have been
one more thing to justify and one more thing to drift.

`symmetry` is also reported as its own field (`symmetric` | `one-sided` |
`none`), so the UI can say which it is instead of only showing a number that
quietly contains the answer.

### `scales`: a marker, not a number

2,136 commander-legal cards have an impact that is a function of a resource
rather than a constant — `for each`, `{X}` in the cost, `X target`. Torment of
Hailfire is the type case: its impact is not 8.4, it is 8.4 *times whatever X
was*, and X is not knowable when the column is drawn.

They get the tier's ordinary value and a `scales: true` flag. **An explicit
marker is more honest than a number pretending to be one**, and it costs the UI
one glyph. Rejected: guessing an average X (every guess is a claim about a game
state the ranker cannot see), and excluding them from the metric (they are
2,136 cards including several of the best in the format).

## 18.6 Efficiency — and the fair rate, derived

### The baseline is measured, and the folk rule is wrong

**332-odd vanilla creatures** — commander-legal, creature, and literally no rules
text — are the only cards in Magic whose entire contribution is their body. They
are therefore the only honest measure of what mana buys before text. The
corpus says 339 of them, and:

| MV | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| vanilla P+T | 2.97 | 4.04 | 5.30 | 6.78 | 9.08 | 11.80 |
| all creatures P+T | 2.34 | 3.40 | 4.48 | 5.81 | 7.29 | 9.05 |
| the gap | 0.62 | 0.64 | 0.82 | 0.97 | 1.79 | 2.75 |
| n (all creatures) | 1,193 | 3,459 | 4,344 | 3,756 | 2,467 | 1,299 |

The fitted line is `P+T = 1.699·MV + 0.541` (n = 319 over MV 1–6). "A 2/2 for 2"
would put 4 at two mana and **8 at four**; the corpus says 6.78. The folk rule
overprices big creatures by about 18%, which matters because it is the rule
every deck-building heuristic on the internet is built on.

The measured per-MV table is what ships, not the line: the line reads 10.74 at
six mana against a measured 11.80, and a metric that is wrong by a whole point of
P+T at the top of the curve is wrong exactly where the expensive cards are. The
line is kept for extrapolation past MV 8, where the vanilla sample runs out
(13 cards at 7, two at 8).

### The exchange rate between stats and text

The gap between those two rows is **the format's own price of text**: what the
average creature at each mana value gives up in body to have rules text at all.
Fitting it against the mean impact of all creatures at that mana value, weighted
by card count, through the origin:

**r = 0.4484 stat points per impact point.**

| MV | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mean impact | 1.69 | 2.12 | 2.54 | 2.82 | 2.84 | 2.93 |
| gap ÷ mean impact | 0.37 | 0.30 | 0.32 | 0.34 | 0.63 | 0.94 |

The rate is not constant — it roughly triples between two mana and six. That is a
real property of the corpus and worth stating: **cheap creatures' text is
marginal and expensive creatures' text is the reason you play them.** A single
fitted `r` is a compromise across that, and it is the compromise that ships,
because a per-MV rate makes the metric discontinuous at the MV boundaries — two
cards one mana apart would be priced by two different economies, and the column
would show a step where the cards show a slope.

### The formula, and the one that was rejected

```
statSurplus  = max(0, P+T − vanillaBaseline(MV))     creatures only, else 0
value        = statSurplus + r × impact              stat points
efficiency   = value / (MV + 1)                      stat points per mana
```

**Both terms are surpluses, and that is the whole correction.** The literal
formula this was scoped as — `(P+T + r × impact) / MV` — was built, measured, and
rejected, because it mixes an *absolute* body with a *marginal* text price. `r`
is derived from what a creature gives up to have text; adding it to a body's full
value asks a number about the margin to price the whole. Measured:

| card | literal `(P+T + r·impact) / MV` | as built |
| --- | ---: | ---: |
| Grizzly Bears (2 mana 2/2, no text) | **2.00** | 0.00 |
| Wrath of God | 0.69 | 0.55 |

The literal formula says Grizzly Bears is three times the card Wrath of God is.
That is not a close call and it is not a tuning problem; it is the category
error showing. Measuring the body against what that mana normally buys puts both
terms on the same footing, and a vanilla creature — which by construction gives
you exactly the going rate and nothing else — correctly comes out at zero.

**`max(0, …)` on the body**, because a body below the going rate is not a debt.
Llanowar Elves is a 1/1 for one against a vanilla rate of 2.97, and charging it
−0.97 stat points says the card would be *better if it did nothing at all*,
which is false. The metric measures what you get, and you cannot get less than
nothing.

**The denominator is `MV + 1`, not `MV`.** Two reasons, one of them fatal to the
alternative: 21 commander-legal creatures and a good many noncreature spells have
mana value 0, and `x / 0` has to go somewhere. The place to put it is not
arbitrary — **a spell costs a card as well as its mana**, and the `+ 1` is the
card. It also stops the metric from being a rename of "cheap": under `/MV` the
one-mana column would dominate every sort by construction.

Non-creatures have no stat term at all. A noncreature spell is not a creature
that is *missing* a body; it has none, so it gets neither the surplus nor a
penalty.

### The baseline is regenerated, not frozen

`packages/domain/src/efficiency/baseline.data.json` is **generated from the
corpus** by `apps/ingest`, in the shape `brackets/rules.data.json` already
establishes for data that is not ours to invent. Power creep is real and
continuing; a constant frozen in TypeScript today is a lie in eighteen months
with nothing to make it fail. The file carries the per-MV table, the sample
counts, the fitted line, `r`, and the date it was generated, so a reader can
check it rather than trust it.

The generator imports `cardImpact` from the domain package rather than
reimplementing the classifier — `r` is defined against *this* impact model, and
two copies of it would drift the day either changed.

## 18.7 Columns become deck state

> "any added or removed column should be saved along with the deck — the filters
> are basically part of the deck"

Columns live in `useState` in `App.tsx` today and die with the page. They are
persisted as `Deck.columns`.

### A column is a discriminated union, not a string

```ts
export type DeckColumn =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'metric'; readonly metric: 'impact' | 'efficiency' }
```

The two metrics above ship as **ordinary user columns** — present by default,
removable, reorderable, and sorted exactly like a query column. They are not a
separate privileged row of the table, and the union is what keeps them from
becoming one.

Rejected: a bare `string[]` with metrics encoded as magic query strings
(`"impact"` parsed specially). It works right up until a user types `impact` as
an actual oracle search, and then their column silently becomes something else.
A discriminated union makes that unrepresentable, which is AGENTS.md §7's
standing preference anyway.

### `null` means the defaults, `[]` means none

This is the one place this document diverges from the storage shape doc 16 and
doc 14 settled on, and it diverges for a reason those two did not have.

`target_overrides` and `semantic_emphasis` are both `NOT NULL DEFAULT`, argued on
the grounds that "has overridden nothing" and "has not overridden anything" are
**the same deck**. For columns they are not the same deck:

- A deck that has never touched its columns should show the default two.
- A deck whose builder has removed both should show none, and must not have them
  handed back on the next page load — that is the trap doc 16 §16.5 exists to
  avoid, in the one direction that actually bites here.

So `decks.columns` is **nullable with no default**. `NULL` is "never set — use
`DEFAULT_COLUMNS`", and `[]` is "deliberately none". `PATCH … {"columns": null}`
therefore means "back to the defaults", which is exactly what `null` already
means for `targetOverrides` (back to the archetype) and `semanticEmphasis` (back
to no focus): *clear my customisation*. The three columns read the same way
even though one of them is nullable.

Being nullable also lets `DEFAULT_COLUMNS` change without a data migration.
Under a `NOT NULL DEFAULT '[…]'` every existing row would be frozen holding
whichever default list existed the day it was created, silently and forever —
the same "frozen against a preset that has since been revised" failure doc 16
rejected full snapshots for.

Otherwise it follows 0013 and 0014 exactly: `jsonb`, replaced wholesale on
PATCH, accepted at creation, parsed and never cast on read
(`parseDeckColumns` drops what it cannot read so a bad entry costs that entry
rather than the deck), no index, and no `DeckCommand` — a column is a property
of the deck, not an operation on its contents, and putting it through the
command batch would make "I added a column" undoable in the same queue as
"I added a card".

### What the server does and does not evaluate

A **query column** is evaluated server-side, per row, and returns the ids it
matched — unchanged, `POST /decks/:id/recommendations` still takes
`columns: string[]` and still returns `columns: [{ query, matched }]`.

A **metric column** is evaluated nowhere, because it does not need to be: the
number is already on every recommendation item (§18.8). The client sends only
its query columns in the request body and reads metric columns straight off the
rows.

That is why persisting the union did not force a change to the recommendations
contract, and why the web client can adopt persisted columns without any change
to how it asks for them.

**Both metrics are also query fields** — `impact>=6`, `eff>=1.5` — as of
[ADR-0025](adr/0025-impact-and-efficiency-are-query-fields.md). That does not
collapse the union: a query column ticks, a metric column shows the number, and
you need the number to pick the threshold. What it does mean is that
`{kind:'query', query:'impact>=6'}` is an ordinary column the server evaluates
like any other, and that it is evaluated against `item.impact.score` — the very
number the metric column draws — so a ticked row can never contradict its own
cell.

**The filter compares the raw score, never a display-rounded one.** `cardImpact`
and `cardEfficiency` already quantise to three decimals, so there is one number
per card per metric and both sides read it. A renderer that rounds for display
must move that rounding into `impact.ts`, where the predicate reads it too;
rounding in the renderer alone would make `impact>=6.2` keep a row whose cell
says 6.1.

## 18.8 Where the numbers appear — and why not in `reasons`

Both metrics ride on **every recommendation item** and on **card detail**, so no
surface recomputes them and no surface can disagree about them.

They are **their own fields, not `Reason` members**, and the argument is pillar
P4 rather than convenience:

- A `Reason` answers *why was this card suggested to me, in this deck, right
  now*. Impact and efficiency are true of Lightning Bolt in every deck that has
  ever existed. They explain nothing about the suggestion, so as a reason they
  would be filler.
- `reasons` is a non-empty tuple **by construction**, and that type is the
  guarantee behind "a recommendation the user cannot interrogate is a bug"
  (AGENTS.md §8). A reason that every card qualifies for would satisfy the type
  while hollowing out the guarantee: a card could be suggested for no
  deck-relative reason at all and still typecheck as explained.
- P4 asks for reasons the user can *act on*. "This is a high-impact card" is not
  actionable — there is no setting behind it and nothing to change.

They sit beside `reasons` instead, which is also where the UI wants them: a
column reads one number off a row, and digging a number out of a reason union
would make the column's renderer depend on the shape of the explanation.

## 18.9 The open questions, answered

### 1. Should impact be resolved against the deck? — **No, and it is not close.**

Answered in §18.2. The decisive argument was not purity but duplication: combo
degree, role deficit and mechanical synergy are already three deck-relative
numbers on the same row, and the honest description of a fourth is "a second
opinion about the first three".

### 2. Is a metric column a column, or a different thing? — **A column.**

It was tempting to give the two metrics a fixed pair of always-present cells
outside the column machinery — no add/remove, no sort integration, no
persistence. That was rejected on the first consequence: a builder who does not
care about efficiency would have no way to get rid of it, and a fixed cell that
cannot be removed is a worse version of the problem §18.7 exists to fix. Making
them ordinary columns costs one discriminated union and buys removal, ordering,
sorting and persistence for free, all of which already exist.

The second consequence settled it. Defaults that are ordinary columns can be
changed later — a third metric, a different default pair — without touching
anything but a constant. A privileged pair would have been a second rendering
path to keep in step with the first forever.

### 3. Does the exchange rate belong per mana value? — **No: one rate, and the variation is published instead.**

The measurement says the rate triples between two mana and six (§18.6). A per-MV
rate would fit the corpus better and would be worse to use: the column would step
at every integer mana value, so two cards a mana apart would be priced by two
different economies and the sort order near a boundary would be an artefact of
which side of it a card sat on. One rate, with the per-MV table printed above so
the compromise is visible rather than hidden, is the honest version.

## 18.10 Where the build diverged from this design

Six places. Each is a change to this document made in the same commit as the
code, per AGENTS.md §10.

1. **The efficiency formula measures surpluses, not absolutes.** Scoped as
   `(stat value + effect value) / mana value`. Built as
   `(max(0, P+T − vanillaBaseline(MV)) + r × impact) / (MV + 1)`. The literal
   formula was implemented first and rated Grizzly Bears (2.00) three times
   Wrath of God (0.69); the numbers are in §18.6 and they are the reason, not
   taste.

2. **Breadth has six tiers, not four.** The scoped table had one / up-to-two /
   up-to-three / X / all. Built: `none` was needed because 15,597 commander-legal
   cards affect nothing they name and would otherwise all tie at zero with each
   other and with vanilla creatures; and `several` absorbs "up to four" and "up
   to five" rather than leaving them to fall back to `one`, which is where the
   scoped table would have put them.

3. **`unbounded` includes a bare plural you control.** The scoped signal was
   "all / each". Craterhoof Behemoth says *"creatures you control gain trample
   and get +X/+X"* with no quantifier at all, and under the scoped rule it landed
   in `none` and scored 0.5. Anthems, lords and every Overrun variant are the
   same shape. `overload` is read the same way for the same reason — Cyclonic
   Rift's unbounded mode is in a keyword, not in the sentence.

4. **The corpus counts in this document are a partition and do not match the
   scoped table.** Scoped: one target 9,398 · up to two 249 · up to three 73 ·
   X 119 · all/each 2,292. Those are per-phrase counts and a card can be in
   several at once. §18.3's are disjoint tiers over the same 31,782 cards, so
   `unbounded` is larger (5,785) and the middle rungs are smaller. Both are
   correct measurements of different questions; the model needs the disjoint one.

5. **Fragility is 1,347 cards, not 547.** The scoped signal was "cards that
   sacrifice themselves". As built it is "the text contains sacrificing itself"
   — which catches the ability *cost* case (`Sacrifice this creature: …`), and
   that is the case that actually makes a repeating ability one-shot. It is the
   larger and more useful reading of the same idea, and it is the single biggest
   correction the persistence tier makes.

6. **Reminder text is stripped before anything is matched.** Not scoped and not
   optional: Cyclonic Rift's own reminder text contains the sentence *"change
   'target' in its text to 'each.'"*, so an unstripped classifier reads the word
   `each` off a parenthetical on hundreds of cards and calls them mass effects.
   Self-references (`this creature`, and the card's own name) are normalised at
   the same time, which is what makes fragility detectable at all.

## 18.11 What this does NOT include

- **`impact:` and `efficiency:` as query fields.** They would make
  `impact>=5 mv<=3` a filter, which is clearly wanted, and it is additive later.
  It is left out because a filter over a scaling card needs its own decision —
  does `impact>=5` include a `scales` card whose printed value is 3.5? — and
  that decision does not belong in the same change as the metric itself.
- **Deck-relative impact.** §18.2. Not a "later"; a decision.
- **A third metric.** The column defaults are a constant precisely so that
  adding one is a one-line change when there is a reason.
- **Any re-ingest.** Both metrics are pure functions of columns the corpus
  already stores (`oracle_text`, `type_line`, `mana_cost`, `power`, `toughness`).
  Nothing new is derived at ingest, no card column is added, and the existing
  corpus answers both questions today.
