# ADR-0066 — Mana and taxes are rules, not blind spots

**Status:** accepted
**Date:** 2026-09-05
**Extends:** [ADR-0025](0025-impact-and-efficiency-are-query-fields.md) (impact
is a query field compared unrounded, so every number below is a filter change
too), [ADR-0043](0043-one-clause-wins-and-brings-its-whole-tuple.md) (the
winning-clause rule the mana score competes under),
[ADR-0055](0055-severity-is-how-hard-not-how-many.md) (severity, untouched here).
**Amends:** the stakes axis of `packages/domain/src/impact.ts` — four tiers
chosen by first match become five chosen by maximum, and `StakesTier`'s union
members are renamed with them. `BreadthTier` and `PersistenceTier` keep their
identifiers; only their displayed words change.
**Changes:** `packages/domain/src/impact.ts`, `packages/ui/src/card/metrics.ts`,
their tests, and three view-model fixtures in `apps/web/src/Gallery.tsx`. No
migration, no wire-type change beyond the `stakes` string values, and
`IMPACT_MAX` is unmoved at 22.176.

**Both baked data files are STALE as this lands.** See §7.

---

## 1. The report

> "Taxes are Phase-triggered, every target, so they should be rated pretty high."

and, on the axis names:

> Reach / Repeats / Falls on / Ends up become Breadth / Rate / Stakes /
> Severity.

and, on the model's own stated blindness:

> a clause that produces mana scores 1.0 per mana produced.

## 2. How it was measured

Every count in this document was produced by running the shipped classifier
against **31,782 commander-legal cards** — the Scryfall oracle export filtered by
`packages/clients/src/scryfall.ts`'s own rules, which reproduces the live
corpus's card count exactly and reproduced doc 22 §22.11's entire distribution
table, tier for tier, before anything here was changed. That agreement is what
makes the after-numbers comparable to the before-numbers.

## 3. Four defects

### 3.1 `when` was not a trigger word

`WHENEVER` was `/\bwhenever\b/` and `UPKEEP` was `/at the beginning of/`. A plain
_"When ~ enters, draw a card"_ matched neither, fell past the activated test and
landed on `one-shot`. **5,289 commander-legal permanents** — 16.6% of the corpus
— were priced as though their ability happened once. Accursed Marauder scored
8.4 for a board wipe on a stick; Priest of Gix scored the model floor.

### 3.2 Stakes depended on the order its rules were written in

A four-tier first-match cascade. `any target` reached a player only because the
targeting rule happened to sit above the unbounded rule, and the bottom tier
`self` meant two different things at once: "it lands on the card itself" and "it
lands on nothing at all". A clause that drains you for 3 and a clause that taps
for mana priced identically at 0.85.

### 3.3 Mana was invisible

Sol Ring scored **0.68** against a corpus median of 0.95, below half the cards in
the format. The docblock accepted this openly, and the pane had a whole sentence
apologising for it.

### 3.4 A tax read as nothing happening

A static tax names no trigger word, so it fell to `one-shot`, and it names no
group the breadth rules count, so it fell to `none`: **0.425**, the model floor,
for Sphere of Resistance and for Thalia, Guardian of Thraben.

## 4. Decision

### 4.1 `when` reads as `triggered` (1.9) — measured, not assumed

Magic templates a triggered ability at the start of its ability, so an anchored
`^(when|whenever|at)\b` is the obvious candidate and it is the wrong one. Both
were counted over the whole corpus:

| candidate | cards it promotes |
| --- | ---: |
| bare `/\bwhen\b/` | **5,289** |
| anchored `/^(when\|whenever\|at)\b/` | 5,022 |

The anchor misses **292 clauses on 281 cards**. Every one of them was read, and
every one is a genuine triggered ability:

| what the anchor misses | clauses |
| --- | ---: |
| an ability-word prefix — _"corrupted — when ~ enters"_, _"revolt —"_, _"metalcraft —"_ | 197 |
| a trigger granted inside quotation marks — _"all slivers have \"when ~ enters …\""_ | 33 |
| a reflexive _"when you do"_ hung off an exert or a sacrifice | 30 |
| a Saga chapter's delayed trigger | 20 |
| a delayed trigger following a replacement effect | 12 |

Not one is prose. The false-positive rate the anchor was supposed to buy is
**zero either way**: the warned shapes — "only when", "as long as" — do not
appear in the difference, and "when you do" is a real trigger rather than the
prose it looks like. So the anchor costs 281 cards and buys nothing, and the
bare word wins.

**Its place in the ladder is below `activated`, and that is where the real
false positives were.** 86 clauses are an activated ability whose EFFECT
contains a delayed or granted trigger — Havengul Lich's _"{1}: you may cast
target creature card in a graveyard this turn. when you cast it this turn, …"_.
The whole cost recurs on every one of them, so `activated` is the correct
reading by this axis's own ordering principle, and testing `when` above the
colon rule would have promoted all 86 to a rung that means no cost recurs.
Ordering it below removes the entire population. `whenever` keeps its existing
place above `activated`; `\bwhen\b` does not match `whenever`, so the two tests
are independent and no card changes on that account.

`at the beginning of` still reads `upkeep`, which is what "Phase-Triggered"
means: a trigger on a phase rather than on an event.

### 4.2 Stakes is five tiers chosen by maximum

| tier | value | means |
| --- | ---: | --- |
| `opposing-player` | 1.4 | it can land on another player |
| `opposing-permanent` | 1.2 | it can land on another player's permanent |
| `owned-permanent` | 1.0 | it lands on your own permanent |
| `owning-player` | 0.9 | it lands on you |
| `nothing` | 0.85 | it touches nothing countable |

The rule is **the highest-scoring option among all possible targets of the
clause**, not the first pattern that matches. `any target` reaches a player, so
it is `opposing-player` because that is the best thing it could hit — not
because of where the rule sits in the file.

`nothing` keeps 0.85 exactly, so the floor does not reprice. It stays a distinct
rung rather than merging into `owning-player`: a drain and a mana ability are
not the same card, and the old single floor said they were. **1,020 cards**
(3.2%) move off the floor onto `owning-player`.

**`yoursOnly` removes the opposing candidates rather than outranking them**, and
that distinction is the whole safety of the maximum. A mass effect scoped
entirely to the caster's own side has no opponent's permanent among its possible
targets. Under a naive maximum every anthem and every lord would have taken the
1.2 off the unbounded rule, and Craterhoof Behemoth and Diregraf Captain would
both have moved — which is ADR-0043's regression, arriving by a new route.

**Both defects the old cascade fixed are preserved, and both are tested.** Bare
`opponents` followed by `control` is a possessive naming a board and never
reaches the player rung (1,472 cards); `OPPOSING`'s trailing lookahead keeps
`target <up to three qualifier words> <noun> you control` off the opposing rungs
(1,070 cards).

`IMPACT_MAX` is **derived**, and was confirmed rather than assumed: the top of
the ladder is still 1.4, so `6.0 × 2.2 × 1.4 × 1.2 = 22.176` is unchanged.

### 4.3 A mana clause scores 1.0 per mana produced

Sol Ring **2.0**, Arcane Signet **1.0**, Dark Ritual **3.0**, Rampant Growth
**1.0**.

The amount is **that clause's score**, competing under ADR-0043's winning-clause
rule like any other line — never added to the product, and never a special case
for a named card. A card whose removal clause scores higher still reports the
removal clause and its own tuple. The larger of the two readings is taken rather
than the mana amount outright, so a line that both makes mana and does something
bigger keeps the bigger reading.

**Reach: 2,344 cards, 7.4% of the corpus** — 1,301 nonlands and 1,043 lands.
The amounts it reads are 1 on 1,962 of them, 2 on 252, 3 on 82, and a long tail
to Ramos, Dragon Engine's genuine 10.

**Gross, not net, and the alternative was considered.** _"{1}, {T}: Add {G}{G}"_
nets one mana and produces two, and this scores the two. Net is the better
measure of a mana base — it is exactly what `fixing.ts` computes, deliberately,
for that job — but impact is a property of the card rather than of a turn, and
netting has no answer for the large class of rituals and triggers whose cost is
not an activation cost at all: Dark Ritual's {B} is the card's own casting cost,
and subtracting it would price a ritual by the arbitrage rather than by what it
does. `fixing.ts` nets because it ranks mana bases against each other; this does
not, because it describes one card.

**A premise correction, recorded because it changes the reasoning rather than
the outcome.** `fixing.ts` was said to have `producesMana` but no amount. It has
both: a private `addedMana` reading the same three phrasings this rule reads. It
was **not** reused, and the reason is measured rather than aesthetic — its word
form is a bare `add (one|two|…)`, which is safe there because it only ever runs
on a land's mana ability, and unsafe corpus-wide because it would read _"add two
+1/+1 counters"_ as two mana. This rule asks for a mana symbol or the word
`mana` before it counts anything. A choice between runs — _"Add {W}{W}, {W}{U},
or {U}{U}"_ — is one run, which is the conclusion `fixing.ts` reaches for the
same card by the same argument.

**Land ramp is included, and it is the one extension beyond the literal
specification.** Rampant Growth matches none of the four `Add` spellings, and
its target of 1.0 cannot be met without reading _"search your library for a land
card … onto the battlefield"_ as producing mana. A land on the battlefield is a
mana source. It is counted as **exactly one**, always, even where the clause
lands two (Skyshroud Claim, Explosive Vegetation): how many lands a multi-land
tutor actually puts onto the battlefield is a second measurement this pass did
not make, and undercounting by one is the honest way to be wrong about it.

### 4.4 A tax is `upkeep` persistence over `unbounded` breadth

Stakes falls out of §4.2 normally. **55 cards** match, and all 55 were read.
Sphere of Resistance, Thalia, Trinisphere and Rhystic Study score **15.84**;
Grand Arbiter Augustin IV scores **18.48** because its clause names opponents
and takes the player rung.

**The boundary is whose spells.** _"Spells you cast cost {1} less"_ is a cost
modification too, and it is already the Quandrix `SPELL_GRANT` case at
`triggered`. `TAX_IS_YOURS` excludes it. Getting this line wrong in the
permissive direction turns every cost-reducer into a Sphere of Resistance, so
every exclusion below was made in the conservative direction.

## 5. What was refused

**A bare `unless … pays` as the Rhystic branch — the measured near-disaster.**
It is not a tax rule at all; it is the templating of a **soft counterspell**. It
caught **143 cards**, of which the great majority were Daze, Censor, Syncopate,
Rune Snag, Mystical Dispute, Lose Focus and every other _"counter target spell
unless its controller pays {2}"_ in the format. A soft counterspell answers ONE
spell already on the stack. Priced as a tax it would have taken `unbounded`
breadth and scored **7.2 against hard Counterspell's 1.2** — the single worst
reading this pass could have produced. It was caught only by dumping the
population and reading it. Anchoring on `whenever a player/an opponent casts`
keeps the eleven standing ones (Rhystic Study, Mystic Remora, Esper Sentinel,
Nether Void, Aether Barrier, Spelltithe Enforcer, Isolation Cell, Soul Barrier,
In the Eye of Chaos, Cephalid Shrine, Chancellor of the Annex) and drops the
rest.

**A tax on an activated ability.** Mavinda, Students' Advocate charges {8} more
for a spell YOU recast and Loreseeker's Stone charges {1} more to activate its
own ability. Both are a cost a card puts on itself. A tax is a static ability,
never an activated one, and not one genuine tax in the corpus sits behind a
colon — so `ACTIVATED` separates them at no cost.

**A temporary tax.** Elspeth Conquers Death's chapter ii, Tax Collector and
Academy Loremaster all tax for one turn. `upkeep` means nothing recurs and there
is nothing to wait for, and a Saga chapter is neither. This is the exclusion
`SPELL_GRANT` already makes, reused for the same reason.

**A cost charged to one exiled card.** Elite Spellbinder, Lightstall Inquisitor,
Invasion of Gobakhan and Soul Partition exile a single card and charge {2} more
for _that card_ — _"a spell cast by an opponent this way costs {2} more"_. The
phrase points back at the one card the clause just exiled, so it reaches one
card and not a board; admitting it would have given a three-mana 3/1 an
unbounded reach.

**Propaganda and Smothering Tithe.** Both match a payment-demanded shape and
neither modifies what a spell or an ability costs: Propaganda taxes an ATTACK
and Smothering Tithe taxes a DRAW. They are real cards doing a real thing and
they are not taxes by the definition this rule was given.

**Renaming `BreadthTier` and `PersistenceTier`.** Only their displayed words
change. The identifiers are a much larger diff for no gain.

**Hand-editing the two baked data files.** See §7.

## 6. What is left open, stated

**`at end of combat` is unclaimed.** The anchored candidate's only unique catch
was 15 clauses on 14 cards reading _"at end of combat, destroy all creatures
blocking ~"_ — genuine phase triggers that `at the beginning of` does not see.
Whether they are `upkeep` (a phase trigger, like the words say) or `triggered`
is a tier decision that was not delegated to this pass, so they still read
`one-shot`. It is 14 cards and it is written down rather than guessed at.

**The ward-tax family reads as board-wide.** Ten cards say _"spells your
opponents cast **that target ~** cost {2} more to cast"_ — Icefall Regent,
Sphinx of New Prahv, Charix, Kopala and six others. They are taxes by the stated
definition (they are about what other people pay) and they are narrower than
`unbounded` breadth claims, so each scores 15.84 for what is really a ward. The
rule admits them deliberately rather than by oversight; narrowing it needs a
judgement about how narrow a tax may be and still be one.

**Sol Ring now outranks Lightning Bolt** — 2.0 against 1.12. That is a real
claim and it is the intended one: this is Commander, and a two-mana ritual on a
permanent is worth more here than three damage once. The regression test that
asserted "mass > spot removal > mana rock" was rewritten to end at a vanilla
creature rather than adjusted until it passed.

**Craterhoof Behemoth moved 6.0 → 11.4** and Rhystic Study 0.808 → 15.84. Both
are consequences of rules above, both are asserted with their reasons beside
them, and both broke a "six regression anchors" test that has been updated
rather than deleted.

## 7. The baked data files are stale

`packages/domain/src/efficiency/baseline.data.json` and
`packages/domain/src/impact/by-role.data.json` are generated by
`apps/ingest/src/efficiency-baseline.ts` and `apps/ingest/src/impact-by-role.ts`
against a corpus **database**, which this branch has no access to.

`efficiency.ts` reads `cardImpact` and multiplies by `statPointsPerImpactPoint`
from the first file, so **every efficiency number in the app is computed from a
stale exchange rate until both are regenerated**, and every role band in the
pane's "middle half of the N ramp cards" line is a band measured against the old
scores. Neither file was hand-edited, and neither should be: the exchange rate
between impact and stats is refitted from the corpus, not chosen.

**Regenerate both in a checkout with `DATABASE_URL` before merging.**

## 8. Consequences

The distribution over all 31,782 commander-legal cards, before and after:

| | minimum | 25th | median | 75th | 90th | 99th | maximum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 0 | 0.6 | 0.95 | 1.92 | 6.72 | 15.96 | 22.176 |
| after | 0 | 0.808 | 1 | 2.128 | 7.2 | 15.96 | 22.176 |

The ends do not move. **361 cards still score exactly zero** and the maximum is
still reachable at 22.176. The middle rises by roughly a third of a rung,
almost all of it the `when` rule: `one-shot` falls from 57.4% of the corpus to
44.6% and `triggered` rises from 18.0% to 31.0%.

The full tier tables are in [doc 22](../22-impact-reference.md) §22.11, measured
after this change rather than predicted from it.

## 9. Testing

`packages/domain/src/impact.test.ts` gains three describe blocks — mana, taxes,
and the stakes maximum — and each carries the counter-example that bounds its
rule rather than only the case it was written for: `add two +1/+1 counters` is
not two mana, a filter land's choice of runs is one run, Daze is not a tax, a
cost-reducer for your own spells is not a tax, a one-turn tax is not a standing
one, and an anthem is not promoted to an opponent by the maximum.

Every value that moved in an existing test moved with a comment naming the rule
that moved it. Two tests changed their claim rather than their number: the
ordering chain (§6, Sol Ring) and the persistence anchor, which used Rhystic
Study as its `triggered` example and could not keep doing so once Rhystic Study
became a tax.

**Not verified on this branch:** the eight Postgres suites (`apps/api`'s
`api.test.ts`, `api-02`, `api-06`, `recommendations.perf`; `packages/db`'s
`db.test.ts`, `staples-resolve`; `apps/ingest`'s `scryfall-ingest`,
`spellbook-ingest`) — 335 tests — which need `DATABASE_URL` and were run with
`LW_ALLOW_NO_DB=1`.
