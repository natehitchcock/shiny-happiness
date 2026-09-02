# 18 — Card impact, efficiency, and columns as deck state

**Status: built.** Two card-intrinsic metrics — how much a card does, and how
much of it you get for the mana — plus the change that stops a builder's columns
dying with the page. The open questions are answered in §18.9 and §18.10 records
where the build diverged from this design, in the form
[doc 16](16-archetype-customiser.md) §16.9/§16.10 set.

Everything numeric in this document was measured against the local corpus on
2026-08-31 (34,492 oracle cards, 31,782 of them commander-legal), and the tier
counts were re-measured against the same corpus on 2026-09-01 after the audit in
**§18.13**. Nothing here is a remembered rule of thumb, and where a remembered
rule of thumb disagrees with the corpus the corpus wins — see §18.6, where "a
2/2 for 2" turns out to be about 15% below what two mana actually buys.

Two generated data files are **stale as shipped** and the commands to refresh
them are in §18.13's last section — and again, with newer numbers, in
**§18.15's**, which supersedes them. Neither was run here: they need a corpus
database, and the honest record of what they will say is a measurement, not a
guess.

**§18.15 (ADR-0043) is the most recent pass** and changes how the tiers are
chosen: clauses are scored, not cards, and the highest-scoring clause supplies
all four tiers at once. Tier counts quoted in §18.3–§18.5 predate it.

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
| `none` | 0.5 | 15,987 | has text, but names nothing to affect |
| `one` | 1.0 | 10,019 | one target |
| `few` | 2.2 | 187 | up to two targets |
| `several` | 3.5 | 86 | up to three, four or five targets |
| `variable` | 3.5 | 99 | `X target(s)` — unknowable at rank time |
| `unbounded` | 6.0 | 5,404 | all / each, or a plural you control |

Re-measured 2026-09-01 over the same 31,782 cards, after §18.13's pass. The
tier VALUES are unchanged; what moved is which cards land in which tier, and it
moved in one direction — 381 cards left `unbounded` for a narrower reading of
what their text actually touches.

A card with **no rules text at all** is not in the table: its impact is exactly
0, not `none × persistence × stakes`. That is not a rounding convenience, it is
what makes §18.6 work — the vanilla creatures are the measuring stick, and a
measuring stick with a nonzero reading at zero cannot calibrate anything.

**Reminder text is not rules text**, and 361 cards score 0 rather than 339.
A basic Forest's whole printed text is `({T}: Add {G}.)`, a parenthetical
restating what the type line already grants. §18.10 item 6 established that
reminder text is stripped before anything is matched; the emptiness test was
asked before the strip rather than after, so every basic, every original dual,
Icehide Golem and Dryad Arbor took the `none` floor of 0.425 instead. See
§18.13.

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
| `player` | 1.4 | 4,148 |
| `opposing` | 1.2 | 7,432 |
| `own` | 1.0 | 5,343 |
| `self` | 0.85 | 14,859 |

Re-measured 2026-09-01. 1,102 cards left `opposing` — nearly all of them cards
whose effect is pointed at the caster's own board and was read as an attack on
somebody else's. See §18.13.

An **unrestricted** `target creature` is read as `opposing`, not as its own
middle tier. The target is chosen by the caster and the caster chooses the
opponent's; scoring an unrestricted removal spell *below* one that may only hit
an opponent's creatures would say Swords to Plowshares is weaker than a
strictly worse card.

**Unrestricted is the operative word, and it was not being honoured.** The
pattern matched the bare `target creature` inside `target creature you
control`, and returned before the `you control` branch was reached — so 1,070
cards were reported as hitting an opponent's board while blinking, untapping or
pumping the caster's own creature (§18.13).

`any target` is `player`, because it can go to the face. That is why Lightning
Bolt (1.4) outscores Swords to Plowshares (1.2) — a genuine, if small,
consequence of the model that a Magic player may reasonably dispute. It is left
standing rather than special-cased, and named here so nobody has to rediscover
it.

### Symmetry: recorded, and priced with a number already in the table

`each opponent` (a one-sided mass effect, 4,469 cards including the
`you control` pump effects and every wrath restricted to one player's board)
and `all creatures` (a symmetric one, 935 cards)
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

2,137 commander-legal cards have an impact that is a function of a resource
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

### The coupling, stated: impact is an INPUT to efficiency

This is the sharpest edge in the whole document and it is easy to miss. `r` is
fitted against the **mean impact of all creatures at each mana value**, so any
change to `cardImpact` changes `r`, and `impact.score` is a term in every
efficiency score besides. A pass over the impact model therefore moves every
efficiency number in the product twice: once because the card's impact changed,
and again because the rate it is converted at did.

The two halves of `baseline.data.json` are affected very differently, and the
difference is worth knowing before anyone panics:

| what | depends on impact? | after §18.13 |
| --- | --- | --- |
| `vanillaStatlineByManaValue` | **no** — power, toughness, oracle text only | byte-identical |
| `vanillaStatlineFit` | **no** | byte-identical: slope 1.6993, intercept 0.5414, n 319 |
| `exchangeRateByManaValue.gap` | **no** | identical |
| `exchangeRateByManaValue.meanImpact` | **yes** | falls 1.5–4.9% at every mana value |
| `statPointsPerImpactPoint` (`r`) | **yes** | **0.4484 → 0.4644**, +3.6% |

The measured baseline — the thing §18.6 is mostly about, and the thing that
contradicts the folk rule — does not move at all, because impact is not one of
its inputs. Only `r` does, and it moves *up*: the same measured gap is now
divided by a smaller mean impact, because the reach false positives that were
inflating mean impact are gone. Cards get slightly more credit per impact point
than before, which is the arithmetic working, not a thumb on the scale.

`r` in the shipped `baseline.data.json` is therefore **stale by 3.6%** until the
generator is re-run. It is stale in a benign direction — every efficiency score
is uniformly a little low, so the ordering between cards is essentially
untouched — but it is stale, and the file says `generatedAt` so a reader can
tell.

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

**Sorting turned out not to be free — see §18.10 item 7.** The other four are. A
metric column draws its number, is removed from the legend, keeps its place in
the list and is saved with the deck; what it does not do is order the rows.

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

Seven places. Each is a change to this document made in the same commit as the
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

7. **A metric column draws a number and does not sort by it.** §18.9 Q2 counted
   sorting among the things ordinary columns buy for free. It is the one that
   had to be given back, and the reason is the DEFAULTS rather than the metrics.
   A query column is a question the builder just asked, and promoting a filter to
   a column means "keep every suggestion and bring the ones I asked about to the
   top" — the button says exactly that. There is no question inside a number, so
   ordering by one means the app supplying the question; and because both metrics
   are present by default it would supply it to every deck that has never touched
   its columns. Two consequences, either one disqualifying: every feed silently
   re-ranked by a card-intrinsic figure over the top of the deck-relative score
   that is the product, and every query the builder actually typed sorting BELOW
   two columns they never chose. `ordersRows` in `apps/web/src/App.tsx` is that
   line, and the legend numbers only the chips on the sorting side of it.

   The way to sort by impact is the one §18.7 already draws: type `impact>=6` and
   promote THAT. It is a question, it has a threshold, it ticks and it sorts.
   "Which of these clear my bar" is the sortable half of the pair; "how do these
   compare" is the half you read. Rejected: keeping the rank and inserting new
   columns at the FRONT of the list so a fresh query still won — it rescues the
   promote button by breaking the documented composition rule instead, and still
   leaves a deck with no query columns ordered by impact rather than by score.

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

---

## 18.12 Impact per role — measured, so the number can be read

**Status: built.** §18.9 declined to give the model bands. This does not
overturn that; it answers a different question, and the difference is the whole
design.

### The failure this fixes

The card detail pane draws `0.68 of 18.48` under a meter, with three tier rows
and the standing "effects only" caveat. For Sol Ring that is a true, complete,
and thoroughly misleading screen. A builder who reads it concludes the app rates
one of the format's defining cards at a twenty-seventh of the scale — and, worse,
that every rock and every land in their deck is the same kind of bad.

The number is right. What is missing is *compared to what*. Measured on the
corpus (31,782 commander-legal cards, 2026-08-31):

| card | impact | role | what the role says |
| --- | ---: | --- | --- |
| Sol Ring | 0.68 | `ramp` | the **median** ramp card |
| Arcane Signet | 0.68 | `ramp` | the median ramp card |
| Command Tower | 0.68 | `land` | the median land |
| Forest | 0 | `land` | no rules text at all — see §18.3 |
| Cultivate | 0.425 | `ramp` | bottom quarter of ramp |
| Swords to Plowshares | 1.2 | `spot-removal` | the median removal spell |
| Wrath of God | 6.12 | `board-wipe` | the **bottom of the middle half** |
| Craterhoof Behemoth | 6.0 | `evasion` | top quarter |
| Cyclonic Rift | 7.2 | `synergy` | top quarter |

Forest was 0.425 here and is now 0 (§18.3). It is the one row in this table
§18.13 moved, and it moved to the value this document already said a card with
no rules text should have.

Wrath of God and Craterhoof are the pair that make the point. Both are around 6,
both are enormous cards, and one of them is an *ordinary* member of its role
while the other is exceptional in its. A single bar — "aim for 6+" — would have
called Wrath elite, Craterhoof elite, and the entire mana base worthless.

### The measured bands

Every commander-legal card, scored by `cardImpact`, grouped by role. Quartiles
are the ordinary interpolating "type 7" definition, the one R, NumPy and every
spreadsheet's `PERCENTILE` mean.

| role | n | q1 | median | q3 | no countable effect |
| --- | ---: | ---: | ---: | ---: | ---: |
| `anthem` | 553 | 6.0 | 6.0 | 11.4 | 0 |
| `aura` | 1,235 | 0.425 | 0.68 | 0.935 | 1,019 |
| `board-wipe` | 502 | 6.12 | 7.2 | 8.4 | 70 |
| `draw` | 3,738 | 0.68 | 0.95 | 2.24 | 2,026 |
| `equipment` | 619 | 0.425 | 0.808 | 1.2 | 422 |
| `evasion` | 7,335 | 0.425 | 0.808 | 2.06 | 4,270 |
| `graveyard-hate` | 100 | 1.36 | 1.4 | 7.155 | 0 |
| `land` | 1,194 | 0.68 | 0.68 | 0.99 | 896 |
| `protection` | 1,205 | 0.425 | 0.95 | 2.64 | 606 |
| `ramp` | 1,401 | 0.68 | 0.68 | 1.4 | 961 |
| `recursion` | 939 | 0.85 | 1.2 | 2.28 | 256 |
| `sac-outlet` | 294 | 0.68 | 0.808 | 2.24 | 158 |
| `spot-removal` | 3,273 | 1.2 | 1.2 | 1.92 | 0 |
| `stax` | 93 | 0.425 | 0.7 | 1.92 | 52 |
| `synergy` | 11,820 | 0.5 | 1.2 | 2.28 | 5,564 |
| `token-maker` | 2,799 | 0.5 | 0.935 | 2.28 | 1,648 |
| `tutor` | 224 | 0.425 | 0.5 | 0.95 | 169 |
| `wincon` | 116 | 0.7 | 0.935 | 1.454 | 82 |

The whole corpus, for comparison: q1 0.68, median 0.95, q3 2.24.

> **These bands are the pre-§18.13 measurement and are stale.** They are the
> contents of the shipped `impact/by-role.data.json`, which is generated and was
> deliberately not regenerated in the same change as the model — see §18.13's
> last section for the command and for what moves. The short version: the bands
> move very little. `q1` is unchanged for **every one of the eighteen roles**;
> the largest move anywhere is `board-wipe`'s median, 7.2 → 6.12, because the
> wipes that were wrongly reported as sparing the caster now take the symmetry
> discount. Whole corpus: q1 0.68 → 0.5, median 0.95 unchanged, q3 2.24 → 1.92.
> Wrath of God is still exactly the `board-wipe` q1, so the worked example below
> still reads true.

**A board wipe's worst quartile is above a ramp card's best.** `board-wipe`'s q1
is 6.12 and `ramp`'s q3 is 1.4 — the two roles do not overlap at all in the
middle. That gap is the reason a single cross-role band would have been a lie
rather than an approximation.

### DESCRIPTIVE, not prescriptive — and why that is not a dodge

§18.9 refused to give the model bands, and `metrics.ts` refused letter grades
because "every cutoff would be the renderer's opinion". Both still hold. What
ships says what cards in a role **do** score, never what a card **should** score,
and it prints the two quartiles beside any placement drawn from them:

> Middle half of the 502 board-wipe cards in the corpus; half of them score 6.12
> to 8.4.

The only cutoffs in that sentence are the corpus's own quartiles and both are on
the screen, so a reader who disagrees is disagreeing with a measurement rather
than with a taste. A prescriptive form — "you want at least 6 here" — was
considered and rejected outright: it would need a target the corpus cannot
supply, it would be the interface's opinion in exactly the way §18.9 forbids,
and there is no deck-independent answer to it anyway. Deck-relative "you need
more of this" is what role deficits already are (§18.2), and that is where it
belongs.

The placement is named for the quartile — *bottom quarter*, *middle half*, *top
quarter* — rather than graded. The boundaries belong to the band they bound:
`score < q1` and `score > q3` are both strict, because the model produces a few
dozen distinct values rather than a continuum and quartiles land exactly on real
cards constantly. Wrath of God **is** the board-wipe q1; calling the format's
archetypal wrath "bottom quarter" by a hair would be the interface losing an
argument it started.

### Where the model cannot see the role at all

`land` is the case the design brief flagged, and it is real but not in the shape
a guess would give. The band is 0.68 to 0.99 — not near-zero, but 0.31 wide on an
18.48 scale, which is a range that tells a reader nothing.

Publishing a "degenerate" flag off a band-width threshold was rejected: any
width cutoff would be invented here, which is the thing this whole section is
avoiding. What ships instead is a **direct measurement of the blindness §18.2
accepts** — how many cards in the role the classifier reads as `breadth: 'none'`,
naming nothing it can affect. 896 of 1,194 lands. 961 of 1,401 ramp cards. **0 of
3,273 spot-removal spells.**

Where that is more than half the role — "most cards in this role", a plain-
language majority rather than a tuned number — the pane's standing caveat is
replaced by the sourced one:

> Effects only — and on 961 of those 1,401 it finds nothing to count at all, so
> that range is largely its blind spot.

It **replaces** rather than stacks: the generic "a card whose job is mana or a
tax reads low here" is the same claim unquantified, and two caveats saying one
thing in a 21rem column is how a pane teaches people to stop reading it.

Note that this fires for `ramp` as well as `land`, which is correct and is the
better half of the feature: the band still says Sol Ring is the median ramp card,
*and* the note says why every ramp card is down there.

### One role per card, and which one

4,891 commander-legal cards hold more than one role. **1,251 of those have roles
that disagree about the placement** — Pathway Arrows is middle-half spot removal
and top-quarter equipment; Pure Reflection is bottom-quarter board-wipe and
middle-half token-maker. Showing every role would hand the reader two verdicts
and no way to arbitrate, which is worse than one.

So the pane shows **`primaryRole`** — the role its own badge already prints three
lines above, so the two cannot disagree — and that pairing is sound because
`primaryRole(roles)` always returns a member of `roles`: the card being placed is
always one of the `n` it is placed against.

**The bands themselves are grouped by membership, not by primary role.** A card
counts toward every role it holds. Two reasons, the second fatal to the
alternative: "what does a board wipe score" is a question about board wipes, and
a card that wipes the board is one whether or not a higher-precedence role wins
its badge; and grouping by `primaryRole` leaves `graveyard-hate` with **zero**
cards, because all 100 of them hold a role that outranks it.

### Baked, not live, and how to regenerate it

`packages/domain/src/impact/by-role.data.json`, generated by
`pnpm --filter @roundtable/ingest impact-roles` — the arrangement
`efficiency/baseline.data.json` already establishes (§18.6), for the same reason.
The generator is read-only against the corpus, runs no ingest, queries no third
party (ADR-0008), and imports `cardImpact` rather than reimplementing it.

Live was rejected on three grounds and the first is decisive: `packages/domain`
is pure (AGENTS.md R1) and cannot have a database. Beyond that, the client has no
corpus at all, and asking the server to re-derive quartiles over 31,782 cards per
card click would buy a cache to invalidate in exchange for a number that changes
only when the corpus does. The file carries `generatedAt` and the corpus size so
a reader can check it rather than trust it.

### Where it lives, and why it is not behind the `Hint`

Inline in `CardMetrics`, under the tier rows and above the notes. Plain text, no
control.

The pane is 21rem wide and a bottom sheet on a phone, which does rule out
eighteen rows of table — but it never needed them. It is showing **one card**, so
it needs **one row**, and one row is two lines of prose. The `Hint` popover would
have fitted the table and was still rejected: the reader who most needs this line
is the one looking at Sol Ring's 0.68 and quietly concluding the app is wrong,
and they have no reason to press anything, because they do not yet know they have
been misled. Help that only opens on request cannot reach them. That is the same
argument `CardMetrics` used to reject a "what is this?" disclosure over the tier
rows, applied to the case that tested it.

Staying non-interactive also keeps AGENTS.md R4 vacuous here rather than adding a
trigger, a focus ring and a tap target to a read-only figure.

### No contract change

New optional fields and new exports only, which is the line AGENTS.md R2 draws:
`CardMetricsProps.impactRole`, `CardView.impactRole`, and
`roleImpactBand` / `impactRolePlacement` / `roleImpactIsMostlyUnreadable` /
`isRole` in `@roundtable/domain`. Nothing on the wire changed — the client looks
the band up locally from `primaryRole`, which card detail has always sent.

---

## 18.13 The reach-and-stakes audit

**Status: built, 2026-09-01.** Two cards were reported wrong by the product
owner. Reading them turned up five rule classes rather than two bugs, and this
section records what was measured, what changed, and what was deliberately left.

### The two specimens

> "reach for Agatha's Soul Cauldron is not everything at once, it's just
> creatures you control and all graveyards"

> "Nevinyrral's Disk does affect your side of the board, the 'Falls On' is wrong"

| card | before | after |
| --- | --- | --- |
| Agatha's Soul Cauldron | 9.792 · unbounded / activated / **opposing** / **symmetric** | 9.6 · unbounded / activated / **own** / **one-sided** |
| Nevinyrral's Disk | 11.52 · unbounded / activated / opposing / **one-sided** | 9.792 · unbounded / activated / opposing / **symmetric** |

Both readings were wrong in the way the reports said, and neither was a
one-card mistake.

Agatha's is worth stating carefully, because the obvious fix is the wrong one.
Its reach really is `unbounded` — "creatures you control" is a set that grows
with the board, which is precisely the reading §18.10 item 3 introduced for
Craterhoof Behemoth, and narrowing it would break every anthem and every lord.
What was wrong was **whose** those creatures are. The tier is right; the two
things that read off it were not.

### The method: disagreement populations, not inspection

"Do another pass over all impact scores" is unbounded work, so it was made
finite. The whole 31,782-card commander-legal corpus was scored, and predicates
were written for the shapes a wrong tier would take — a card scored `opposing`
whose text only ever says "you control", an `unbounded` card whose mass phrase
sits inside a counting clause, a card scoring the `none` floor whose text is
entirely parenthetical. Counts before and after, against the same corpus
snapshot:

| population | before | after |
| --- | ---: | ---: |
| text is entirely reminder text, yet scores above zero | 22 | **0** |
| `target … you control` scored `opposing` | 1,070 | 330 |
| …and the text never names an opponent at all | 730 | **26** |
| `unbounded` + `opposing` where the only scope named is yours | 935 | 364 |
| a symmetric list-wipe reported as one-sided | 120 | 46 |
| `unbounded` taken from a counting clause | 160 | 75 |

The residues are largely the predicates being looser than the rules — they were
written to over-catch on purpose — and are accounted for at the end of this
section rather than assumed away.

**Then the whole corpus was diffed, card by card, before against after.** That
is not ceremony: it is the standing precedent from the trample-reminder-text
rule that made Colossal Dreadmaw a burn payoff, where 176 false positives were
caught only by diffing everything. It earned its keep twice here — see below.
2,369 of 31,782 cards moved; 211 up, 2,158 down.

### The five rule classes, and the counter-example each is bounded by

1. **Reminder text is not rules text.** The emptiness check ran on the raw
   string and the reminder strip ran after it, so a basic Forest — whose entire
   printed text is `({T}: Add {G}.)` — missed the zero path and took the `none`
   floor. 22 cards: every basic, every original dual, Icehide Golem, Dryad
   Arbor. *Bounded by:* the cheap raw check is kept in front of it, so the 339
   genuinely textless creatures still short-circuit without normalising.

2. **`target X you control` is not an attack on an opponent.** The `opposing`
   pattern matched the bare `target creature` inside `target creature you
   control` and returned before the `you control` branch was consulted. A
   bounded negative lookahead that stops at clause punctuation fixes it.
   *Bounded by:* Swords to Plowshares. An unrestricted `target creature` is
   still `opposing`, which is the decision §18.5 makes on purpose; only the
   restricted phrasing is excluded, and a card that hits one of each still
   matches on the unrestricted half.

3. **A mass effect scoped entirely to your own side is `own`.** `breadth ===
   'unbounded'` short-circuited to `opposing` before `you control` was reached,
   and the `yoursOnly` escape hatch only fired when the plural carried *no*
   quantifier — so Agatha's, which says "creatures you control" three times and
   names an opponent nowhere, missed it on the word `all`. *Bounded by:* Wrath
   of God. An unrestricted mass effect overrides the scope test rather than
   losing to it, because a wrath may mention "you control" in a rider and still
   destroy everything.

4. **A wipe that names a LIST of types is still a wipe.** The symmetric signal
   looked for `all creatures` only, so `Destroy all artifacts, creatures, and
   enchantments` — where `all` is followed by `artifacts` — never matched, and
   Nevinyrral's Disk, Jokulhaups, Akroma's Vengeance and 117 others were
   reported one-sided. *Bounded twice:* by `all land cards from your graveyard`,
   which is a **zone** and not a board — excluding `card`/`cards` is what keeps
   every graveyard recursion spell out of the wrath population — and by
   `destroy all artifacts, creatures, and enchantments you don't control`, where
   the restriction sits after the *last* noun. That second one needs the list
   consumed atomically; a greedy list simply backtracks to a shorter one, finds
   a comma instead of a controller, and matches anyway.

5. **A clause that COUNTS a group is not an effect on it.** Regal Bunnicorn's
   whole text is *"power and toughness are each equal to the number of nonland
   permanents you control"*. It affects nothing, and it scored 6.0 — the same
   reach as Craterhoof Behemoth, off a two-mana creature. Zanam Djinn's *"the
   most common color among all permanents"* is a condition on its own stats and
   scored 7.2, above Wrath of God. 160 cards. *Bounded by:* Craterhoof, whose
   text carries **both** shapes — "creatures you control gain trample … where X
   is the number of creatures you control" — so stripping the count must leave
   the effect standing; and by "divided as you choose among X targets", which is
   a targeting clause wearing the same preposition. The rule is therefore a
   short explicit list of measuring *heads*, never a bare `among`.

### What the whole-corpus diff caught that no assertion did

Two regressions, both invisible to every test that existed and to every test
written for the classes above.

**The measured span ate the effect after the count.** Running a measuring clause
to the end of its clause also swallowed whatever followed, which on a damage
card is the entire effect: Hallar, the Firefletcher's *"deals damage equal to
the number of +1/+1 counters on it **to each opponent**"* lost its "each
opponent" and fell 15.96 → 0.808. Armageddon Clock and Dáin of the Ancient Halls
failed the same way. Fixed by stopping the span at the noun being counted.

**A possessive board was read as the people who own it.** `opponents` meant
"this reaches players", which is true of "each opponent loses 3 life" and false
of "creatures your opponents control get -1/-1", where the possessive only names
whose board. This defect **predates the audit** and was hidden by the broken
scope test in class 3 — those cards used to be claimed as `own`, also wrong, and
never reached it. With class 3 fixed they fell through to `player`, and Doomwake
Giant went 11.4 → 15.96, Bolg to 18.48 — *the exact ceiling of the model* — for
shrinking the opposing team by one. 48 cards. Both now have regression tests.

### Regression anchors

The four cards this document and the ADRs quote, before and after:

| card | before | after |
| --- | ---: | ---: |
| Wrath of God | 6.12 | **6.12** |
| Craterhoof Behemoth | 6.0 | **6.0** |
| Sol Ring | 0.68 | **0.68** |
| a basic Forest | 0.425 | **0** (intended — §18.3) |

Also unmoved: Cyclonic Rift 7.2, Torment of Hailfire 8.4, Swords to Plowshares
1.2, Lightning Bolt 1.4, Rhystic Study 0.808, Command Tower 0.68, Arcane Signet
0.68, Cultivate 0.425, Grizzly Bears 0.

**`IMPACT_MAX` did not move.** No tier VALUE was touched — every change is to
which tier a card lands in — so it is still `6.0 × 2.2 × 1.4 = 18.48`, still
derived from the three tables rather than written down, and every rendered
"N of 18.48" is unchanged.

### What has to be regenerated, and what does not

Neither generator was run as part of this change; both are the reader's to run
against a corpus database.

```
pnpm --filter @roundtable/ingest baseline        # r: 0.4484 -> 0.4644
pnpm --filter @roundtable/ingest impact-roles    # the per-role quartiles
```

- **`efficiency/baseline.data.json` — yes, for `r` only.** §18.6's coupling
  table has the detail: the measured per-mana-value baseline and the fitted line
  are byte-identical because impact is not one of their inputs, and only
  `statPointsPerImpactPoint` and the published `meanImpact` column move.
- **`impact/by-role.data.json` — yes, and for two separate reasons.** How stale
  the existing bands are, measured: `q1` is unchanged for every one of the
  eighteen roles the shipped file holds; the largest single move is
  `board-wipe`'s median, 7.2 → 6.12. `land` q3 0.99 → 0.95, `ramp` q3 1.4 →
  1.36, `synergy` median 1.2 → 1.0. The blind-spot counts drift by a few cards
  per role and no role crosses the "mostly unreadable" half-way line in either
  direction, so no card's caveat changes.

  The second reason arrived from a different task and is the more pressing one:
  **ADR-0037 added `counterspell` and `bounce`**, and the shipped file has no
  band for either. `roleImpactBand` returns `null` for a role the corpus never
  measured and the pane simply omits the comparison line, so this degrades
  correctly rather than breaking — but a counterspell currently gets no
  placement at all, and that is exactly what §18.12 exists to give it.

Regenerating both is safe in either order — `impact-roles` does not read the
baseline, and `baseline` does not read the role bands.

### What was found and deliberately NOT done

- ~~**One tier per card is the model's real limit, and it shows on hybrid
  cards.**~~ **Fixed in §18.15 (ADR-0043).** Diregraf Captain was a Zombie lord
  *and* a drain, taking `unbounded` breadth from the anthem clause and `player`
  stakes from the drain clause: 15.96 for a three-mana lord. Clauses are now
  scored rather than cards, and it reports 6.0.
- **`TARGET` does not match the plural `targets`.** Rolling Thunder's real
  oracle text is "divided as you choose among any number of targets" and it
  reads `none`, scoring 0.425. Cheap to fix and deliberately not fixed here: it
  moves cards from `none` to `one`, the opposite direction from everything else
  in this pass, and it deserves its own measurement.
- **A count reached through a preposition still creates reach.** Bribe Taker's
  "for each kind of counter **on** permanents you control" strips the head and
  leaves the plural. 75 cards remain in that population. The measuring-head list
  is explicit and extending it is additive.
- **Cards in a zone are still `unbounded`.** "all creature cards in all
  graveyards" reads as a mass effect, which is defensible — it is unbounded and
  it grows — but it shares a tier with a board wipe. Left alone because the
  right answer is a zone axis, not a regex.

## 18.14 How the numbers are worked out, on request

> "under the help text, you also need to explain the algorithm used to deduce
> efficiency and impact"

A `?` beside the **Impact** and **Efficiency** labels, opening the app's `Hint`
popover. Seven lines for impact, seven for efficiency.

**Behind a disclosure, and §18.12 argued the opposite** — so the difference has
to be said rather than assumed. The two fail differently. A reader who is not
told Sol Ring is the median ramp card concludes the app is wrong and *never
asks*, so help they must request cannot reach them; that line is printed, and
stays printed. A reader who wants to know how the number is derived knows they
want it and goes looking. And the answer is seven lines, which in a 21rem column
and a bottom sheet on a phone would bury the three tier rows it exists to
explain. Nothing that was printed before is now hidden.

**Not the formula.** `0.5 × 1.6 × 0.85 = 0.68` restates Sol Ring's number in a
second notation and leaves the reader exactly as puzzled. What answers them is
that only effects are read, that Sol Ring names nothing to affect, and that this
is a stated limit rather than a verdict — so the copy explains the *method* and
its blind spot, and the arithmetic appears only as its shape: three readings,
multiplied. It uses the same three labels the tier rows above already use, in
the pane's own register.

**No constant is quoted.** The tier values live in `impact.ts` and `r` lives in
a generated data file; copy repeating either goes stale the first time one moves
with nothing to catch it, because a UI string is not covered by the model's
tests. Every number a reader needs is already on screen. There is a test that
fails if a constant appears in the copy.

### A slot, not an import

`Hint` lives in `apps/web` and `@roundtable/ui` does not import from an app, so
`CardMetrics` takes an optional `explain` renderer and decides only *where* the
trigger sits and *what* it says. That also satisfies AGENTS.md R4 once rather
than twice: `Hint` is already a real `<button>` with a focus ring, an accessible
name, a touch target and an escape key, and nothing interactive is added to
`@roundtable/ui`. The L3 `Detail` primitive passes no renderer and draws exactly
what it drew before.

### Reach now says whose, when the model knows whose

The other half of the Agatha's report, and it needs no new field — `symmetry`
and `stakes` are already on the wire and already decide the "Falls on" row
directly below.

| card | before | after |
| --- | --- | --- |
| Wrath of God, Nevinyrral's Disk | everything at once | everything at once |
| Agatha's Soul Cauldron, Craterhoof Behemoth | everything at once | **your whole side at once** |
| Cyclonic Rift (overloaded) | everything at once | **an opponent's whole side at once** |

A `symmetric` effect keeps the unqualified words because it genuinely is
everything — that is what the 0.85 discount is charged for. `player` stakes keep
them too, deliberately: `unbounded` + `player` is both "each opponent loses 3
life" and "all permanents target player controls", the payload cannot tell those
apart, and a phrase true of both beats a guess wrong for one.

### No contract change

New optional prop and new exports only: `CardMetricsProps.explain`,
`MetricExplainer`, `impactAlgorithm`, `efficiencyAlgorithm`,
`IMPACT_ALGORITHM_LABEL` and `EFFICIENCY_ALGORITHM_LABEL`. Nothing on the wire
changed, and `impact.ts` gained no exported type. AGENTS.md R2 is satisfied
without an ADR; ADR-0025's rule that the filter and the cell read one number is
untouched, because no rounding moved and `metricValue` still rounds nowhere.

## 18.15 One clause wins, and it brings its whole tuple (ADR-0043)

> "Quandrix the Proof gives spells cascade, shouldn't that mean that his reach is
> every spell cast? Or he repeats every spell cast?"

**The repeat.** Full reasoning and the rejected alternatives are in
[ADR-0043](adr/0043-one-clause-wins-and-brings-its-whole-tuple.md); this section
records what the model now does and what it measured.

### The tuple travels together

The rule, from the product owner: *"when it comes to choosing one tier per card,
choose all the tiers from the highest impact effect."* Every ability line is
scored as a complete `breadth × persistence × stakes × symmetry`, and the card
reports **the winning line's tiers together** — never the maximum of each axis
taken independently. That closes §18.13's "real limit" bullet.

The unit is the newline-separated **ability line**, reusing ADR-0038's argument:
every pattern in `impact.ts` is written `.` or `[^…\n]`, and JavaScript's `.`
does not match a newline, so each rule is confined to one line by construction
and a line scored alone gives the answer it gave in context. Splitting happens
after reminder text is stripped. The type line is not a clause.

`fragile` and the instant/sorcery pin stay **card-level**, with reasons: when the
card sacrifices itself every one of its lines stops, and a type line is not an
ability.

### Quandrix: persistence, and the measurement that decided it

`Teval, Arbiter of Virtue` carries both spellings at once — the static *"Spells
you cast have delve"* and the triggered *"Whenever you cast a spell, you lose
life equal to its mana value"* — and already scored `none / triggered / self`
off the second clause, a drawback. Breadth and stakes already agreed between the
two forms. **Persistence was the only axis that differed**, and only because the
static spelling never says `whenever`.

The inversion that proved it broken: `Yidris, Maelstrom Wielder` grants cascade
only after combat damage connects, and only that turn — 0.808. Quandrix grants it
unconditionally and forever — 0.425, the model's floor. 251 commander-legal
permanents carry a grant of this shape; 28 more say "this turn" and are excluded,
because a Saga chapter is not a permanent engine.

### A serial class is never board-wide

`each spell you cast` is not `counter all other spells`: the first arrives one
spell at a time across the game, the second is a stack everything sits on
together. Reading the first as reach gave `Threefold Signal` and `Goblin
Anarchomancer` **7.2 with `opposing` stakes** — Cyclonic Rift's number, on cards
that cannot touch an opponent. Five cards say it; the eleven genuine mass effects
on the stack do not move.

### Measured, corpus-wide

**1,902 of 31,782 cards moved (6.0%): 1,728 down, 174 up.** Mean 2.5109 → 2.3821.

| band | before | after |
| --- | ---: | ---: |
| 0 | 361 | 361 |
| 0–1 | 15,953 | 16,103 |
| 1–3 | 9,698 | 9,634 |
| 3–6 | 257 | 199 |
| 6–10 | 3,574 | 4,016 |
| 10–15 | 1,153 | 822 |
| 15+ | 786 | 647 |

The top deflates, which is the point: the cards losing the most were assembling
a tuple from clauses that never met.

| card | before | after |
| --- | ---: | ---: |
| Diregraf Captain | 15.96 | **6.0** |
| Quandrix, the Proof | 0.425 | **0.808** |
| Flamekin Herald, Imoti, The First Sliver, Abaddon, Wildsear | 0.425 | **0.808** |
| Threefold Signal, Goblin Anarchomancer, Seal of the Guildpact | 7.2 | **0.808** |
| Ancient Cellarspawn | 15.96 | **2.66** |
| Aetherflux Reservoir | 15.96 | **2.24** |

### Regression anchors

| card | before | after |
| --- | ---: | ---: |
| Wrath of God | 6.12 | **6.12** |
| Craterhoof Behemoth | 6.0 | **6.0** |
| Sol Ring | 0.68 | **0.68** |
| a basic Forest | 0 | **0** |
| Cyclonic Rift | 7.2 | **7.2** |
| Swords to Plowshares | 1.2 | **1.2** |

All six unmoved. Craterhoof is the natural test of the winning-clause rule — it
carries both a counting shape and an effect shape, and its second line scores 6.0
on its own.

**`IMPACT_MAX` did not move.** No tier VALUE changed, only which tier a clause
lands in, so it is still `6.0 × 2.2 × 1.4 = 18.48` and every rendered
"N of 18.48" keeps its denominator. The mirror in
`packages/ui/src/card/metrics.ts` needs no edit.

### What has to be regenerated

Neither generator was run as part of this change; both are the reader's to run
against a corpus database.

```
pnpm --filter @roundtable/ingest baseline        # r: 0.4644 -> ~0.4934 (estimated)
pnpm --filter @roundtable/ingest impact-roles    # the per-role quartiles
```

Mean impact fell at every mana value, so `statPointsPerImpactPoint` — fitted
against exactly that mean — rises by about 6.7%. The estimate reuses the shipped
gaps, which do not depend on impact, and recomputes only the mean; the generator
is authoritative. `impact/by-role.data.json` is quartiles of `cardImpact().score`
per role and moves for the same reason. Either order is safe.

### What was found and deliberately NOT done

- **A bare `for each <noun>` still creates reach.** `MEASURING_HEAD` admits
  `for each card type` but not `for each creature you control`, so a clause that
  only counts still reads as a mass effect. `Storm Entity`, a one-mana 1/1,
  scores 7.2. Widening the head list was **measured and rejected here**: it moved
  2,377 cards and introduced false negatives, because `for each opponent` is a
  distributive effect on people rather than a measurement — `Smuggler's Share`
  fell 18.48 → 0.935, the Hallar regression on a different noun. Its own pass.
  The narrow overlap where the new `triggered` reading would have *multiplied*
  that false reach is fixed; six cards carried both shapes.
- **A zone clause is not a board, and now says so out loud.** 173 of the 174
  rises are per-clause scoring removing a mask: a clause saying "all X cards"
  with no "you control" in it falls to `opposing`, where it used to borrow `own`
  from a different clause. `Kaheera, the Orphanguard`'s companion condition and
  `Summon: Titan`'s graveyard return read this way. The old answer was right by
  accident. §18.13 already lists the zone axis as the right fix.
- **Two abilities can share one line.** `Saheeli, Filigree Master`'s emblem grants
  an anthem and a spell discount in a single quoted line, so the newline unit
  cannot separate them — the one rise this pass genuinely causes, 9.6 → 11.4.
  Inherited from ADR-0038's unit, not introduced here.
