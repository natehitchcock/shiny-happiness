# ADR-0058 — A role is one word and not one job

**Status:** accepted
**Date:** 2026-09-03
**Extends:** ADR-0031 (a card is offered under the role it is counted as), ADR-0037 (interaction is two leaf roles), ADR-0054 (whose event is it, and what is a card counted as).
**Companion:** ADR-0057, which makes the OPPOSITE ruling one level up. Read both.

> **AMENDED BY [ADR-0060](0060-the-list-is-the-defect-and-a-role-has-a-subject.md).**
> §8 of this ADR widened `ramp` past the literal "basic land card" for a land put
> ONTO THE BATTLEFIELD, and recorded two things it left standing. Both are now
> closed, and the second is why the first could be:
>
> - *"Landcycling still derives `tutor`, because the tutor heuristic reads
>   'search your library for a Forest card' out of the reminder text."* The tutor
>   rule's land guard was the literal `\bland card`; ADR-0060 §2 replaces it with
>   a shared `LAND_OBJECT` that the ramp rules read too, so the rule that awards
>   `ramp` for a land search and the rule that refuses `tutor` for one cannot
>   drift apart.
> - The refusal of "a named land type … **into your hand**" — 84 cards, 51 of
>   them landcycling — was correct as the rule was then writable. Re-measured:
>   89 cards, 54 landcycling and 35 real, and **the parenthesis splits them
>   exactly**. So Archaeomancer's Map and Gift of Estates are admitted and
>   Timeless Dragon is still refused. §2 also records the global reminder-text
>   strip that was written, measured at 1,322 changed cards, and refused.
>
> ADR-0060 §6 also answers a question this ADR's `board-wipe` reasoning left
> implicit: the mass `-X/-X` rule refused the letter X that its own comment said
> it had to admit, so Toxic Deluge was `synergy`.

---

## 1. The report

> "qualifiers should also be things like type or subtype requirements. For
> example, things that destroy target artifact are spot removal, but qualified
> with artifact"

`Disenchant`, `Naturalize`, `Krosan Grip`, `Vandalblast` and `Return to Dust`
are all `spot-removal` today, with nothing recording that none of them can kill
a creature. `Bane of Progress` is a `board-wipe` that destroys all artifacts and
enchantments — a sweeper that answers no creature.

**This matters more than the tag case.** Roles are what the composition meters
*count*. If an archetype wants 6 spot-removal and the deck holds 6
artifact-removal spells, the meter reads satisfied while the deck cannot kill a
creature. That is precisely the defect ADR-0031 and ADR-0054 were written for —
a card counted under a role whose job it does not do — one level finer. A tag
qualifier makes a reason more honest; a role qualifier stops a meter lying about
whether the deck is finished.

---

## 2. The measurement

By primary role, over the 31,782 commander-legal cards:

| role | primary | cannot answer a creature | unreadable scope |
| --- | ---: | ---: | ---: |
| spot-removal | 2,563 | 446 (17.4%) | 59 |
| board-wipe | 509 | 53 (10.4%) | 28 |
| bounce | 259 | 8 (3.1%) | 44 |
| counterspell | 431 | 120 (27.8%) restricted by type/mv/colour | 353 |
| graveyard-hate | 108 | — the graveyard IS the role | — |

Restricted spot-removal, by what it CAN hit: artifact+enchantment 149,
artifact 99, land 93, enchantment 66, artifact+land 19, other 20.

**And it is a colour story, which is what makes it worth building.**
Creature-capable spot-removal per mono-colour identity:

```
R  853 → 709      B  444 → 420      W  436 → 335
C  141 → 134      U   46 →  40      G  207 →  54
```

Green's removal is three quarters Naturalize effects. A green deck's removal
meter reads satisfied out of a pool that mostly cannot kill anything, and the
colour pie says that is exactly where it should be worst.

**No archetype becomes unsatisfiable.** Green still holds 54 creature-capable
removal spells against the highest target in the table (aristocrats and
voltron, 7).

---

## 3. Partial, not binary

**The opposite ruling to ADR-0057**, and the difference falls out of what the
two things are.

A tag qualifier is a GAME RULE and a trigger has no partial state: Counterspell
does not half-fire Y'shtola, so it is excluded. A role qualifier is a JUDGEMENT
ABOUT COVERAGE: Disenchant really is removal, a deck needs some, and refusing to
count it would be a worse error than counting it fully — a deck told it holds
zero answers will cut real ones to make room.

**Nothing here removes a card from a role, from a count or from a group.** What
it does is decide which of several real answers is offered FIRST, when the deck
is short of a coverage its own answers do not provide. That is a ranking change
inside a group, which pillar P5 permits — grouping is the product's opinion and
the score orders within it — and it needs no new composition dimension, no new
curated number and no reach into `archetype-targets.ts`.

---

## 4. Does it work?

Measured rather than asserted, because the alternative was reconsidering the
sub-target.

`edhrec_rank` is NULL for all 31,782 rows (ADR-0008 removed EDHREC), so within a
`fills-` group with no combo, no curve signal and no synergy the order today is
effectively arbitrary — which is the condition the simulation reproduces. 5,000
six-card removal suites drawn at random from green's 207-card pool:

| | mean creature answers | can kill NOTHING | fewer than two |
| --- | ---: | ---: | ---: |
| before | 1.58 | **15.0%** | 50.2% |
| after | 2.14 | **0.0%** | 25.2% |

The answer to "does the ordering change produce a deck that can kill a
creature?" is yes, in 100% of draws against 85% before.

---

## 5. The sub-target, deferred with a reason

A third `CompositionDimension` member — "of your 6 removal, at least 3 must be
creature-capable" — was considered and deferred, and the reason is not cost.

**That number has no source.** It is not in `archetype-targets.ts`, it is not
derivable from the corpus, and it would have to be answered for every archetype
and every restricted role. Inventing roughly twenty of them is exactly what
ADR-0006 forbids: rules written from memory rather than measured or sourced.
Better to ship no sub-target than twenty numbers nobody can defend.

It is expressible if someone ever has the numbers: `CompositionDimension` is a
two-member union (`{kind:'role'}` | `{kind:'type'}`) and `Ideals` is
`Partial<Record<Role, number>>` plus one hard-coded `creature` escape hatch, so
a third member plus a matching emission from `dimensionKeysOf` is the shape.
`composition.ts` already documents the bug you get if those two disagree.

**Fractional counting was refused, and on evidence rather than principle.**
`Math.round` is applied to the only fraction that exists today (the 70/30
archetype blend). Two strings break:

- `apps/web/src/App.tsx` renders `{r.actual} / {r.ideal}` raw, and the aria
  label interpolates them unrounded — a half-counted Disenchant reads
  **"5.5 / 6"** to a screen reader;
- `packages/domain/src/quickbuild.ts` computes `short: want - target.actual` and
  calls it a number of cards — a deck would be told it is **1.5 cards short**.

No type would break. Several strings would. That is why the next person should
not try it either.

---

## 6. ROLE_PRECEDENCE

ADR-0054 re-derived precedence on the principle *"if this card were cut, which
of its jobs would the deck have to replace?"* A qualifier is a sharper statement
of the same question: for Vandalblast the answer is *artifact removal*, not
*removal*.

The precedent already exists in that file. ADR-0037 moved `graveyard-hate`
ABOVE `spot-removal` for exactly this reason — a strictly narrower answer
describes the card better. A qualifier is that ruling made general instead of
made once per pair.

**`ROLE_PRECEDENCE` is not reordered.** The scope goes beside the primary role,
not into the ordering. This is recorded because the next person to argue
precedence would otherwise re-derive the connection.

---

## 7. What is outside the mechanism, and why

`counterspell` and `graveyard-hate` are deliberately excluded from the ordering
term. A counterspell's object is "target spell", which is not a permanent type,
so `answerScope` reads nothing for 353 of the corpus's 431 counterspells; a
graveyard's object is the graveyard, which is the whole of that role. A term
over either would be noise with a number on it.

The coverage question is asked about **one type, `creature`**, and the
restriction is measured rather than lazy. The corpus says the harm runs one way.
A deck full of Swords to Plowshares and short of artifact removal is a real gap,
but nobody has measured how often it happens or what it costs, and asking about
all six permanent types would mean five thresholds with no evidence behind them.
Widening it is one line plus a measurement, in that order.

**The threshold is a quarter**, and it has to be a share rather than a count: a
deck with two answers is short of everything and a deck with twelve is not, and
one number cannot mean both. The denominator is the deck's best-covered type,
because the question is whether its answers are lopsided.

**Silent for a deck with no answers at all**, which is the case that looks like
it should shout. A deck holding nothing is short of everything, and naming a
type would be the model inventing a target — the thing the sub-target was
deferred for. `findDeficits` already says "you are six short of removal"; this
only ever splits a tie between two cards that both fill that gap.

---

## 8. The `ramp` defect this uncovered, which was larger than the feature

While measuring what a role's object can reach:

```
Nature's Lore   roles=[synergy]
Three Visits    roles=[synergy]
Farseek         roles=[synergy]
Scapeshift      roles=[synergy]
```

The `ramp` rule read `search your library for (a|up to N) **basic land card** …
onto the battlefield`, and the format's best ramp spells say neither word — they
name a Forest. **145 non-land cards search out a land, put it onto the
battlefield or into hand, and hold no `ramp` role.** The app was telling a
builder it could not tell what Three Visits does.

Two rules were added and every one of the 54 cards they reach was read by hand;
there is no false positive to report.

- **A named land type onto the battlefield**, 38 cards. No `i` flag — the
  capital is what marks a land type, the same rule `semantic-tokens.ts` relies
  on, so "a mountain of cards" is not ramp.
- **Any land card onto the battlefield**, 16 cards, which the old rule refused
  because it demanded "basic".

**Onto the battlefield only**, and the refusal is the larger half of the
decision: admitting "into your hand" for a named type is 84 further cards and 51
of them are LANDCYCLING — a discard ability on a Dragon. Timeless Dragon counted
as ramp would be ADR-0031's defect pointed the other way. The existing "land
card … into your hand" rule is untouched.

Corpus diff: 54 cards gain `ramp`, **zero lose it**, 46 primary roles move and
every one moves INTO ramp from a less specific role (31 from `synergy`, 6 from
`evasion`, 3 from `token-maker`, 2 from `protection`, one each from `anthem`,
`tutor`, `recursion`, `draw`).

**`roles` and `primary_role` are stored columns, so this needs a cards
re-ingest.** No migration.

Left standing and recorded: landcycling still derives `tutor`, because the tutor
heuristic reads "search your library for a Forest card" out of the reminder
text. That is a pre-existing defect with its own shape and is not touched here.

---

## 9. The `role:` filter

Two defects, found while measuring whether a role qualifier could be spelled
`role:spot-removal(artifact)`, and fixed as their own commit because neither
depends on that syntax shipping:

- **`role:` was the one value field with no suggestion at all.** Every neighbour
  offers something — `is:` lists its predicates, a synergy tag gets a near-miss
  list, a colour is told to use WUBRG — and a mistyped role got a bare
  rejection, from the shortest and most closed vocabulary in the grammar. The
  near-miss scoring is now shared with the tag branch it was written for.
- **A `)` with no `(` before it was dropped in silence.** `parseAnd` breaks on
  an rparen and `parseOr` only continues on an `or`, so a stray closer fell out
  of the bottom of the parser; the `unexpected )` error inside `parseUnary` is
  unreachable because the tokenizer never lets a `)` open a term. Since doc 10
  §10.4 refuses to apply a query with errors, the user got one confusing message
  and a search box that filtered on nothing with no second reason given.

**No qualifier syntax is added to `role:`.** `role:spot-removal` keeps matching
every card holding the role, qualified or not, which is right for the same
reason the count is unchanged: Disenchant is spot-removal.

---

## 10. Consequences

- `packages/domain/src/answer-scope.ts` is new and pure. It reads the SAME verbs
  `role-derivation.ts` reads to award the role — a second list of removal verbs
  that disagreed with the first would mean a card counted under a role whose
  scope could not be read, which is this file's own bug one layer down.
- `RecommendInput.deckAnswers` is a new optional input, built by
  `answerCoverage` at the caller for the reason `deckLands` is: the answer is a
  property of the cards the deck already holds, and `recommend` is handed a
  candidate pool rather than a deck. Absent means "not asked" and the term is
  zero, which is what every caller got before this existed.
- The term is scaled off `w.fill` at a half rather than getting its own weight.
  It is a refinement of "this card fills your gap", so a builder who turns the
  fill weight down should turn this down with it; a separate knob would let the
  two disagree about one question. The ceiling is what keeps it a tie-break: it
  can reorder inside a gap and can never outweigh having one.
- A cards re-ingest is required for §8. Nothing needs a migration.
