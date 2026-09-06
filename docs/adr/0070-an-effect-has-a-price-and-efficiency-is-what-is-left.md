# ADR-0070 — An effect has a price, and efficiency is what is left

**Status:** accepted
**Date:** 2026-09-06
**Supersedes:** [doc 18](../18-card-impact-and-efficiency.md) §18.6 in whole —
the vanilla-creature baseline, the stat/impact exchange rate, and the
`/ (MV + 1)` divisor all go.
**Extends:** [ADR-0025](0025-impact-and-efficiency-are-query-fields.md)
(`efficiency` is a query field compared unrounded, so every number here is a
filter change too), [ADR-0011](0011-deck-shaping-controls.md)
(`roles` and `synergyProduces` are derived at ingest and STORED, which is what
makes them affordable as a vocabulary),
[ADR-0048](0048-membership-is-a-third-direction.md) (membership is not something
a card produces — the rule §4.2 applies to three more tags),
[ADR-0066](0066-mana-and-taxes-are-rules-not-blind-spots.md) (the Rate tiers
this reads).
**Amends:** `Recommendation.efficiency` keeps its name and its type's name and
**changes what it means and what unit it is in**. `CardEfficiency`'s members all
change. `EfficiencyInput` widens. `EfficiencyBaseline`, `EFFICIENCY_BASELINE`,
`vanillaStatline` and `statPointsPerImpactPoint` are removed outright. That is a
contract change under AGENTS.md R2 and is why this document exists.
**Changes:** `packages/domain/src/efficiency.ts` and its data file,
`apps/ingest/src/effect-prices{,-fit}.ts` (replacing `efficiency-baseline.ts`),
`packages/ui/src/card/metrics.ts` and `CardMetrics.tsx`, `apps/web/src/App.tsx`,
`packages/domain/src/query/ast.ts`, six test files and three view-model fixtures.
No migration and no database change: both new inputs are columns that already
exist.

**The shipped price file is a STAND-IN and one test is RED because of it.**
See §8.

---

## 1. The report

> "Efficiency should be calculated based on the average cost of an effect.
> Analyzing all cards that cause similar effects, and how much they cost, then
> adding up all the average costs of each effect and subtracting the mv of the
> card to get a final efficiency score (which can be negative)."

and, on the hard part:

> "Triggered effects are tricky, but we can probably coarsely quantify the
> trigger types by looking at their Rate."

## 2. What was there, and what was wrong with it

```
statSurplus = max(0, P+T − vanillaBaseline(MV))     creatures only
value       = statSurplus + r × impact              stat points
efficiency  = value / (MV + 1)                      stat points per mana
```

`r` was `statPointsPerImpactPoint`, 0.4486, fitted against the mean impact of
all creatures at each mana value. Three things follow from that and all three
are defects:

**Impact was an input.** Doc 18 §18.6 states the coupling and doc 22 §22.13
repeats it: every pass over the impact classifier moved every efficiency number
**twice** — once because the card's impact changed and again because the rate it
was converted at was refitted. ADR-0066 alone moved 5,289 cards' persistence
tier, and the shipped `r` has been known-stale by 3.6% ever since.

**The unit was invented.** "Stat points of surplus per mana" is a quantity
nothing in Magic is denominated in. A builder reading `0.549` has no way to know
whether that is good, and the pane had to spend three lines saying so.

**It could not say a card was bad.** `max(0, …)` floored the body and impact is
non-negative, so the metric's floor was zero and a card that costs more than it
does was indistinguishable from one priced exactly right. `eff<0` had no
spelling.

## 3. How everything below was measured

Scryfall's oracle bulk export, mapped through `packages/clients/src/scryfall.ts`'s
own `skipReason` and `toCard`, which reproduces the live corpus population
exactly: **31,782 commander-legal cards**, mean mana value **3.2911**. Roles and
`synergyProduces` come from the domain's own `deriveRoles` and `deriveSynergy`
running over that text, so they are the same values the database stores. Rate
comes from the shipped `cardImpact`. Every figure in this document was produced
by running that; none is quoted from a docblock.

## 4. Decision

**Every effect carries a mana price learned from the corpus. A card is worth the
sum of its effects' prices. Efficiency is that sum minus what the card costs.**

```
worth      = Σ role prices + Σ produced-event prices + Rate + body
efficiency = worth − manaValue                                      mana
```

The unit is **mana**. Negative is meaningful and is not clamped.

### 4.1 The prices are FITTED, not plain means

Summing plain per-effect means double-counts, and the size of it is not
marginal. The mean mana value of the cards holding `draw` already contains the
cards that also ramp and also remove, so adding the buckets adds those cards
several times. Over the whole corpus, with roles as the vocabulary:

| model | predicted mean MV | actual | mean absolute error |
| --- | ---: | ---: | ---: |
| sum of per-role means | 3.994 | 3.291 | 1.688 |
| least-squares fit | 3.013 | 3.291 | 1.412 |

**A 1.21× systematic inflation**, removed. What the fit does to individual
prices is the more useful way to see it — a fitted coefficient is the
**marginal** price of that effect, which is what "the average cost of an effect"
has to mean once a card can have several:

| role | naive | fitted | role | naive | fitted |
| --- | ---: | ---: | --- | ---: | ---: |
| wincon | 3.85 | 1.88 | token-maker | 3.77 | 2.09 |
| sac-outlet | 3.35 | 1.36 | spot-removal | 3.42 | 2.45 |
| equipment | 2.38 | 0.81 | board-wipe | 4.56 | 3.38 |
| graveyard-hate | 2.81 | 0.94 | land | 0.24 | 0.24 |

Equipment reads 2.38 naively because Equipment are cheap cards; it reads 0.81
fitted because most of an Equipment's mana value is already explained by the
other things the same card does. `land` does not move, because a land almost
never holds a second role — which is the cleanest available demonstration that
the fit is correcting overlap rather than shrinking everything.

**Ordinary least squares with a ridge term of λ = 1**, against 31,782 rows. That
is conditioning and not regularisation: λ = 0 and λ = 1 agree to four decimal
places on every error figure quoted here, and λ = 100 is measurably worse
(0.9589 against 0.9503) and pulls the mean prediction off the corpus mean. It is
there because several features are very nearly collinear — a produced tag that
only ever appears beside one role, a subtype carried by eighty cards — and a
singular normal-equation matrix is a NaN in a data file rather than an error
anybody sees.

### 4.2 The vocabulary is roles, produced semantics, Rate and the body

Four groups, 81 features. Each earned its place against the one before it:

| feature set | features | MAE | 5-fold CV MAE |
| --- | ---: | ---: | ---: |
| roles only | 20 | 1.4122 | 1.4136 |
| + `synergyProduces` | 74 | 1.3866 | 1.3906 |
| + Rate | 78 | 1.2132 | 1.2167 |
| + the body | 81 | **0.9503** | **0.9533** |

**Roles** are 20 buckets and leave **11,231 cards** in the catch-all `synergy`,
whose fitted price came out at **3.286** — the corpus mean of 3.291 to within a
rounding error. A feature that predicts the average predicts nothing, and a
third of the corpus sitting on it is why roles alone are not enough.

**`synergyProduces`, and produces only.** `wants` is a payoff rather than an
effect — a card that likes Treasures does not make one — and `has` is
membership, which ADR-0048 already separated out for exactly this reason. Three
produce tags are excluded on the same principle: **`spell-cast`,
`enchantment-etb` and `artifact-etb` are derived from the TYPE LINE** by
`synergy.ts`, not from any effect. 100%, 100% and 82% of the cards carrying them
are simply members of that type. They live in `produces` because a prowess or
constellation payoff asks for them. Fitted with them in, `spell-cast` takes
**1.13 mana** and every instant and sorcery in the format is repriced by it —
the model becomes a type-line model in disguise. Dropping them costs 0.009 mana
of error and is the difference between coefficients a reader can check against a
card and coefficients they cannot.

A produced tag needs **50 cards** before it is priced, which is the
cross-validated optimum rather than a taste: sweeping 1 / 10 / 20 / 50 / 100 /
300 / 1000 puts held-out error at its minimum at 50 (0.9533), with all 326 tags
priced doing better in sample (0.9454) and worse out of it (0.9554). 54 tags
survive. A tag below the threshold contributes nothing, which is the honest
reading of "the corpus has not shown us what this costs".

**Rate**, the axis `impact.ts` calls `persistence`, is **the one thing taken
from the impact module**. The composite `impact.score` appears nowhere. Its four
tiers partition the corpus, so they also carry the fit's constant — there is no
separate intercept column — and letting them do so is what makes the fit
unbiased: mean predicted mana value **3.2907** against an actual **3.2911**.

**The body** is priced rather than assumed — see §4.4.

### 4.3 Rate is ADDITIVE, and its own contribution is small

Both forms were fitted. The multiplicative form — Rate as a fitted multiplier on
the effect sum, which is what "a repeating effect is worth more" is in spirit —
was solved by alternating least squares:

| form | MAE | multipliers (one-shot / activated / triggered / upkeep) |
| --- | ---: | --- |
| additive, one price per tier | **0.9503** | — |
| multiplicative, one factor per tier | 0.9506 | 0.990 / 1.023 / 1.014 / 1.008 |

Additive wins, and the multipliers say why: they are all within 2.3% of one, so
the multiplicative form has almost nothing to multiply by and pays a slightly
worse fit and a nonlinear solver for the privilege. Fitted without the body in
the design, where the effect sum is smaller and a factor has more room to work,
the multipliers spread to 0.970 / 0.957 / 1.064 / 1.080 and the fit is still
worse than additive (1.2137 against 1.2132). **Additive is the decision, on both
readings.**

**But the honest part is that Rate buys very little either way, and the table in
§4.2 overstates it.** The four tiers span every card, so adding them to a model
that has no intercept adds an intercept — and that is nearly all of the 1.3866 →
1.2132 improvement. Measured against a model that already has an explicit
intercept, Rate's own contribution is:

| model | MAE | Rate buys |
| --- | ---: | ---: |
| roles + produces + intercept | 1.2215 | |
| + Rate | 1.2132 | 0.0083 |
| roles + produces + intercept + body | 1.0636 | |
| + Rate | 1.0585 | 0.0051 |

**Under a hundredth of a mana, both times.** The fitted tier prices show the same
thing directly — one-shot 3.004, activated 3.103, triggered 3.125, upkeep 3.145
— a spread of 0.14 mana across the whole axis. The ordering is the one the
report predicted (a repeating effect does cost more than a one-shot) and the
magnitude is not.

It is kept, for three reasons stated rather than assumed: it is three parameters
against 31,782 rows and cannot overfit; it is what supplies the intercept, so
removing it means adding one anyway; and its sign is right, so it will get more
useful rather than less as the corpus grows. **What it is not is the answer to
"triggered effects are tricky"** — see §7.

### 4.4 A body is an effect, and power costs more than toughness

The body is priced as a little model of its own:

| feature | price | meaning |
| --- | ---: | --- |
| `hasBody` | −1.8486 | the offset for having a body at all |
| `power` | 0.4402 | one point of power, in mana |
| `toughness` | 0.3663 | one point of toughness, in mana |

**A point of power is worth 1.20× a point of toughness**, which is a fact about
Magic the model now simply has, and the reason to fit them as two features
rather than one. Both forms were measured:

| body form | MAE | CV MAE | coefficients |
| --- | ---: | ---: | --- |
| power and toughness separately | **0.9503** | **0.9533** | offset −1.8486, power 0.4402, toughness 0.3663 |
| one summed `P+T` | 0.9505 | 0.9535 | offset −1.8559, per point 0.4029 |

The split fits better on both, by two ten-thousandths of a mana — which is
noise, and is not why it is kept. It is kept because 0.4402 and 0.3663 are a
statement about Magic and 0.4029 is their average wearing a disguise. Two
features against 31,782 rows cost nothing to carry.

**Including the body at all is the single largest improvement any feature
makes**: 1.2132 → 0.9503, a fifth of the remaining error, against the 1.4122
that roles-only least squares reached.

**A card with no printed numeric power and toughness contributes exactly zero
from all three, offset included.** This is the one silent error the file can
make: an instant that inherited the −1.8486 offset with a zero statline attached
would reprice every noncreature in the format at once and nothing downstream
would fail to say so. `efficiency.test.ts` asserts it directly rather than
leaving it to reading. A creature whose power is `*` is in the same class — it
has a body this model cannot name, so it stands on its effects.

**The consequence, stated plainly: a vanilla creature is no longer the floor by
construction.** The metric this replaces defined a vanilla creature as exactly
zero — that was the whole calibration — and could not say that a 6/6 for four is
a good rate. It now can:

| vanilla creature | efficiency |
| --- | ---: |
| Gigantosaurus, 10/10 for 5 | **+4.26** |
| Grizzly Bears, 2/2 for 2 | +0.81 |
| Jedit Ojanen, 5/5 for 7 | **−1.77** |

The mean over all 339 vanilla creatures is **+0.31**, so they are not
systematically mispriced in either direction — the spread is the model reading
rates, which is what it is for.

## 5. What comes out

- **`statPointsPerImpactPoint`** and every use of it.
- **`vanillaStatline`**, `EfficiencyBaseline`, `EFFICIENCY_BASELINE`, and
  `packages/domain/src/efficiency/baseline.data.json`, which nothing else read.
- **`apps/ingest/src/efficiency-baseline.ts`** and its `baseline` script.
- **The `/ (MV + 1)` divisor.** Nothing is divided any more, so the `+ 1` that
  existed to keep a nought-cost card finite has nothing to protect: `cost` is
  now `manaValue` itself, and a nought-cost card is not a special case.
- **Every label that said "per mana."** `packages/ui/src/card/metrics.ts` and
  `apps/web/src/App.tsx`'s `metricScale` both said it; both now say **mana**. A
  stale "per mana" would be the interface asserting a denominator the model no
  longer has.

## 6. What was refused

**A `terms` array on the wire.** Naming each priced feature per card would make
the number checkable, which is this pane's whole ethos. It is refused on
payload: `CardEfficiency` rides on **every** recommendation item, roughly five
terms per card would add tens of kilobytes to a response, and doc 07 §7.3's
budget is not worth a disclosure most readers will not open. The two subtotals
`efficiencyWorking` prints are the compromise.

**Clamping the score at zero.** It is what the old model did and it is the
capability this change was asked for. 43.2% of the corpus is negative.

**Normalising to a 0–10 scale.** ADR-0025's reasoning holds unchanged: the
number a user types into `eff>=1` must be the number the column shows them.

**Dropping Rate once it measured at 0.005 mana.** See §4.3 for why it stays.

**Pricing `synergyWants`.** A payoff is not an effect. The model would learn
that cards which like Treasures cost more, which is true and is not a statement
about what the card does.

## 7. What is left open, stated

**The metric is substantially a measure of cheapness.** `corr(efficiency,
manaValue) = −0.734` over the corpus. That is inherent to a residual: the fit
explains 46% of the variance in mana value, so 54% of what is left is the mana
value itself. The metric it replaces had the same property by construction — it
divided by cost — so this is not a regression, but it is not a fix either, and
anyone reading the column as "card quality" will be misled in the same direction
as before.

**The model prices only what it can NAME, and a card it cannot read is priced at
about the corpus average.** So a cheap card whose text the derivations miss
reads as a bargain. This is the mirror image of the blind spot doc 22 §22.13
records for impact, and the caveat on the pane is where it is said.

**Valence, still.** The model cannot tell a payoff from a drawback, so a
drawback that is not in `roles` or `synergyProduces` is invisible. This is
visible at the top of the list: Phyrexian Dreadnought (+10.20) and Death's
Shadow (+10.68) are a 12/12 and a 13/13 for one mana whose entire drawback the
model cannot see. Nothing is special-cased to hide them.

**Printed mana value, not effective cost.** The bottom of the list is Blinkmoth
Infusion (−10.89), Volcanic Salvo (−9.03) and Enter the Infinite (−8.43) — cards
with affinity, a cost reduction, or a cast-for-free plan. The model reads the
printed number.

**Rate is not the answer to triggered effects.** The report hoped Rate would
coarsely quantify trigger types; measured, it separates them by 0.14 mana. What
a triggered ability is worth is still mostly carried by whatever role or produced
tag the trigger's effect happens to hold, and a card whose trigger produces
something the vocabulary does not name is still priced at the floor. That is its
own pass.

**The corpus prices what is PRINTED, not what is played.** A least-squares fit
over every commander-legal card learns Wizards' costing, including their
mistakes and every deliberately-undercosted card in the format. It is not a
power level.

## 8. The shipped price file is a stand-in, and one test is red

`packages/domain/src/efficiency/effect-prices.data.json` is regenerated by

```
pnpm --filter @roundtable/ingest effect-prices
```

which requires a `DATABASE_URL`. The worktree this change was written in has
none, so **the committed file was fitted by the same code over the Scryfall
corpus described in §3 instead**, and it says so: `source` reads
`scryfall-oracle-bulk` rather than `corpus-database`. The two populations are
the same 31,782 cards, so the coefficients should be close — but "should be
close" is not a measurement, and an unverified price table is exactly the
failure this file is designed around.

So the check is a **red test** rather than a comment:

```
packages/domain/src/efficiency.test.ts
  > the shipped prices > are measured from the corpus database
    expected 'scryfall-oracle-bulk' to be 'corpus-database'
```

It cannot be skimmed past, and it goes green the moment the generator is run
against a corpus database and its output committed. `pnpm test` is red until
then, deliberately, and this is the only failure.

`efficiency.ts` refuses a structurally dead file outright — a table of zeroes
makes every card worth nothing, so efficiency becomes exactly `−manaValue`,
every column silently sorts by cheapness, and nothing downstream reports it.
That guard throws at module load and is tested against four broken tables.

## 9. Consequences

**Every efficiency number in the product changes.** The nine cards the design
docs argue about, computed by the shipped code against the stand-in prices:

| card | worth | mv | efficiency |
| --- | ---: | ---: | ---: |
| Lightning Bolt | 3.266 | 1 | **+2.266** |
| Swords to Plowshares | 3.194 | 1 | **+2.194** |
| Sol Ring | 2.907 | 1 | **+1.907** |
| Dark Ritual | 2.795 | 1 | **+1.795** |
| Counterspell | 2.819 | 2 | **+0.818** |
| Grizzly Bears | 2.811 | 2 | **+0.811** |
| Rhystic Study | 3.176 | 3 | **+0.176** |
| Wrath of God | 4.127 | 4 | **+0.127** |
| Craterhoof Behemoth | 5.460 | 8 | **−2.540** |

Read this list for its shape rather than its ordering. The cheap answers are at
the top and the eight-drop is at the bottom, which is what a mana-difference
metric is for. **Grizzly Bears above Wrath of God is real and is the blind spot
in §7, not a bug**: the bear's body prices at −0.24 and its effects at 3.05, all
of which is the floor a card with no legible text gets; the wrath's board wipe
prices at 1.20 marginal, and four mana is close to what the corpus charges for
it. The old model's test that pinned "a wrath scores above a vanilla bear" is
therefore **removed rather than adjusted** — it was pinning a property of a
model that measured surpluses against a vanilla baseline, and this model has no
vanilla baseline.

**Distribution over 31,782 cards:** min −10.89, 1% −3.90, 25% −0.70, median
+0.13, 75% +0.85, 99% +2.42, max +10.68. **43.2% negative.**

**`eff<0` is a new and useful query** and was unspellable before.

**Sorting is unaffected in code and changed in meaning.** `sortValue` already
distinguished "no value" from zero; zero is now "priced exactly at its cost"
rather than "the floor", and unknowns still sink in both directions.

**No migration, no database change.** `roles` and `synergy_produces` are columns
that already exist, and the generator reads them.

## 10. Testing

`packages/domain/src/efficiency.test.ts` is rewritten against a hand-checkable
fixture price table. The tests that would have caught the errors that matter:

- **the body contributes exactly zero for a noncreature, offset included** —
  three tests, for a noncreature, for a `*` power, and for a null statline
  (§4.4);
- **a negative score is produced and not clamped**;
- **`worth − cost === score` and `effectValue + bodyValue === worth`**, so the
  two numbers the pane prints cannot drift from the one it headlines;
- **an unpriced produce tag contributes nothing** rather than throwing;
- **a duplicated role or tag is counted once**;
- **`assertUsablePrices` refuses** a table of zeroes, a missing role, a missing
  Rate tier and a non-finite price;
- **the shipped fit is unbiased** — predicted mean within 0.1 of the corpus mean
  — and **beats the 1.41 roles-only figure**, and its held-out error is within a
  tenth of a mana of its in-sample error;
- **`source` is `corpus-database`**, which is §8's deliberate red.

`recommend.test.ts`'s efficiency filter fixtures gained real `roles`,
`synergyProduces` and a body: under the new vocabulary the two hand-written
cards scored **identically**, and a filter test whose two rows tie cannot fail.
