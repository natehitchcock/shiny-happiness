# 38. A semantic for every clause, and a combo piece nobody named

Date: 2026-09-01

## Status

Accepted.

> **Number 0038 is taken by this ADR.** It was assigned rather than chosen — the
> ADR directory was deliberately not listed, because reading it to find "the next
> free number" is how 0027 got claimed twice. The next agent should take 0039.

## Context

Three reports, in the order they arrived:

1. > "Moritte of the Frost seems to have no semantics, even though she does both
   > +1/+1 counters and copy a creature"
2. > "Ashnod's Altar says it combos with Moritte of the Frost, but I don't think
   > it does"
3. > "Do another pass over the semantics extracted from each card. Each clause on
   > the card should likely have at least one semantic associated with it."

The third is the work. The first two are symptoms, and they turn out to have
nothing to do with each other: one is a rule gap in `synergy.ts`, the other is a
data-handling bug in the Spellbook adapter.

`Moritte of the Frost`, verbatim from the corpus:

```
Legendary Snow Creature — Shapeshifter

Changeling (This card is every creature type.)
You may have Moritte enter as a copy of a permanent you control, except it's
legendary and snow in addition to its other types and, if it's a creature, it
enters with two additional +1/+1 counters on it and has changeling.
```

Derived before this change: `produces: []`, `wants: []`.

**This is not a two-faced-card bug**, and it is not a card-name bug either.
Moritte is single-faced, and `deriveSynergy` already reads every face and
prefixes the type line to each — ADR-0029 recorded the measurement (0 of 825
multi-faced cards derive differently split than joined) and nothing here changes
it. The `plus1-counter` producer rule simply asked for `enters with
(a|an|one|two|three|four|X|\d+) \+1\/\+1 counter`, a closed list of amounts, and
Moritte says "two ADDITIONAL". One word wide.

### Report 3 is a measurement, not a reading

"Each clause should have at least one semantic" is a testable property, so it was
tested before anything was changed.

**The unit is the ABILITY LINE** — a newline-separated line of oracle text — and
not the sentence. The reason is mechanical rather than stylistic: every gap in
the rule tables is written `.` or `[^.\n]`, and JavaScript's `.` does not match a
newline, so each rule is confined to one line by construction. A line tested in
isolation therefore gives exactly the answer it gives in card context, which a
sentence split could not promise. (Two rules use `[^.]{0,N}`, which *can* cross a
newline. The probe attributes each rule's match by its INDEX in the text rather
than by re-testing the line, so those two are handled exactly rather than
approximated.) The type line is prefixed to every face as `deriveSynergy` does
it, but is not itself a clause: a match landing wholly inside it — which is how
`artifact-etb`, `enchantment-etb` and `spell-cast` are produced — covers no
clause, and is not counted as if it did.

Over all 31,782 commander-legal cards: **60,216 clause instances, of which 27,671
(46.0%) produced a tag and 32,545 (54.0%) produced none.**

Ranking the uncovered ones by shape is what makes the task finite. It turns "look
at every card" into "here are the classes accounting for most of the gap", and it
is the deliverable this ADR is built on:

| share | class of uncovered clause | verdict |
| ---: | --- | --- |
| 26.0% | evergreen keyword line only (`Flying`, `Trample`, `Vigilance, haste`) | correctly uncovered |
| 14.6% | long tail, no shared shape | correctly uncovered |
| 12.0% | static P/T or keyword grant ("gets +2/+2", "has flying") | correctly uncovered |
| 5.0% | `Enchant creature` / `Equip {2}` / `Attach` | correctly uncovered |
| 4.9% | cost, timing and rules modifiers ("costs {1} less", "can't be cast") | correctly uncovered |
| 3.9% | Aura and Equipment static buffs | correctly uncovered |
| 3.7% | combat-only triggers and restrictions ("whenever this blocks") | correctly uncovered |
| 3.1% | a keyword and its reminder text | correctly uncovered |
| 2.6% | upkeep / end-step / phase triggers | correctly uncovered |
| 2.3% | scry, surveil, look at the top, impulse draw | partly — surveil already reads |
| 2.3% | `enters tapped` | correctly uncovered |
| 2.2% | modal headers and bullet markers | correctly uncovered |
| 2.2% | exile-based removal | correctly uncovered |
| 2.2% | destroy / mass destruction of noncreatures | correctly uncovered |
| 2.1% | bounce and tuck | correctly uncovered |
| 1.5% | counters that are not +1/+1 | correctly uncovered |
| 1.5% | tutors | **partly a gap** — see rule 6 |
| 1.5% | counterspells and "can't be countered" | correctly uncovered |
| 1.3% | mana abilities and ramp | correctly uncovered |
| 0.6% | self-sacrifice | **a gap** — see rule 2 |
| 0.3% | clone / copy effects | correctly uncovered — §5 |

The eight rules below come out of that ranking. **They are not an attempt at
100%, and 100% would be a defect**: most of that table is clauses that genuinely
carry no synergy meaning. A rule that fires on everything is worth nothing, which
is the ground ADR-0029 §6 refused a `mill` tag on, and §5 refuses a `copy` tag on
here.

## Decision

### 1. Eight rules, and no new tag

`SYNERGY_TAGS` is unchanged at 21 members, so `INTERACTION_PAIRS` and
`apps/web/src/tags.ts` needed nothing — every event these rules read was already
in the vocabulary and already paired. **This is not a contract change (R2).**

| rule | side : tag | new cards | what the old rule could not see |
| --- | --- | ---: | --- |
| 1 | `wants:creature-etb` | 527 | "When **Tolsimir** enters" — the name template |
| 2 | `produces:creature-death` | 510 | "Sacrifice **this** creature" |
| 3 | `wants:spell-cast` | 246 | "Whenever you cast **a spell**" |
| 4 | `wants:attack-trigger` | 149 | "Whenever you **attack**" |
| 5 | `produces:plus1-counter` | 128 | "enters with two **additional** +1/+1 counters" |
| 6 | `produces:landfall` | 75 | fetchlands, which never say "land" |
| 7 | `wants:plus1-counter` | 42 | "each creature … with **a** +1/+1 counter on it" |
| 8 | `wants:token` | 37 | "creature **tokens** you control get +1/+1" |

**1,714 tag assignments gained across the corpus and ZERO lost**, checked card by
card rather than inferred from totals. Clause coverage **46.0% → 47.9%**; cards
with no tag at all **5,018 → 4,568**.

The move is small in percentage terms and that is expected — the denominator is
dominated by clauses that should stay uncovered. What it is not small in is
cards: one in fourteen commander-legal cards gained a tag.

### 2. Two rules were decided against their obvious version, by measurement

**Substituting the card's own name out of the text** is the general fix rule 1
solves specially, and it was written and rejected. It reaches 12 cards this rule
does not — the ones whose names carry a full stop, "J. Jonah Jameson", "Ms.
Marvel", "U.S.Agent" — and it costs 30 cards their existing tags, because a
card's name is also ordinary English. All twenty cards named "… Storm" lose
`spell-cast`, since the keyword STORM is what that rule reads and substitution
eats the word. Twelve missed is cheaper than thirty broken.

Rule 1 instead asks for a capitalised subject and no `i` flag, and requires the
type line to say `Creature` first. Audited rather than trusted: over all 527
matches the capitalised subject traces back to the card's own name in 527 cases
and fails to in none.

**Putting the article into the existing `plus1-counter` payoff branch** — a
two-character change — reaches 182 cards instead of 42, and the extra 140 are
PRODUCERS: "THIS creature ENTERS WITH a +1/+1 counter on it for each Zombie card
in your graveyard" is Diregraf Colossus, and every bloodthirst reminder text
reads the same way. That is the direction inversion the file's own comments call
worse than a missing tag. The leading determiner (`each`, `another`, `all`,
`target`, `attacking`) is what refuses them.

An explicit `(?!enters)` guard was added to say that out loud and then **removed**:
it moves exactly zero cards, because the determiner already refuses every one,
and it survived every mutation the tests could make. Same ruling ADR-0029 gave
the `itself` exclusion — a branch a test cannot fail on is machinery.

### 3. A `copy` tag is refused

Moritte's other half — "enter as a copy of a permanent you control" — gets no
tag, and that is a decision rather than an omission.

Measured: 452 commander-legal cards copy a permanent, and 76 have text that is
payoff-shaped about copying. **Every one of those 76 is a SPELL copy** —
magecraft, "whenever you cast an instant or sorcery spell, copy it", "whenever
you cast a Faerie or Wizard permanent spell, copy it" — which `spell-cast`
already owns. Nothing in the corpus pays off *having a copy of a permanent*.

That is exactly ADR-0029 §6's ground for refusing `mill`: a producer class with
no payoff class is a tag that can never match, and 452 cards would carry a label
that changes no recommendation.

### 4. Report 2 — the Ashnod's Altar combo is a data-handling bug

The pairing is **wrong**, and the cause is neither `combo-index.ts` nor the
source data being false.

Commander Spellbook variant `2034-3388--5` is Moritte + Ashnod's Altar + TEMPLATE
5, and its own steps name the template: "returning itself to the battlefield as a
copy of THE CREATURE WITH PERSIST". Moritte has no persist; she has to copy a
creature that does, and that creature is a third piece.

Spellbook publishes those pieces in `requires[]`, describing each as a card CLASS
with a Scryfall query rather than a card id — "Mana Dork or Mana Dork Creator",
"Creature with Persist". `toCombo` read `uses[]` and never `requires[]`, so the
class pieces were dropped without a word and the combo was stored two pieces
long.

Measured across the stored corpus by the negative segment Spellbook's variant ids
use for templates:

- **4,813 of 108,046 combos (4.5%) lost at least one piece.**
- **1,192 of those are stored as TWO-CARD INFINITES** — the exact shape brackets
  1–3 restrict (doc 03 §3.2). This was mis-assessing decks, not only
  mis-labelling one pairing.

**Decision: skip and report, rather than store short.** That is the ruling this
ingest already made one layer down about a combo naming a card the corpus does
not have — "storing a combo whose pieces are half-missing produces a combo that
can never be completed and silently wrong combo degrees" (doc 04 §4.2, AGENTS.md
§8). A template piece is the same wound one layer up: the piece is missing from
the source, not from our corpus. `variantSkipReason` gains a third reason,
`template-piece`; `ComboIngestReport` gains `templateRequired`; and `ingest
combos` prints the count and the first ten class names, so the 4.5% is visible
rather than inferred.

`combo-index.ts` needed no change. Its `pieces.length < 2` guard was already
correct for what it could see; it was being handed a lie.

## Consequences

- **`packages/domain/src/synergy.ts`** gains eight rules and widens one. No new
  tag, no new pair, no change to `apps/web/src/tags.ts`.
- **`packages/clients/src/spellbook.ts`** stops storing combos it cannot
  represent. `VariantSkipReason` gains a member — additive, and its one consumer
  is the combo ingest, which now handles it.
- **Two fixture-backed tests had to be CHANGED rather than added**, and that is
  the finding behind the finding. `spellbook-variants-sample.json` has always
  carried `2105-3337--140` — Combat Celebrant + Fable of the Mirror-Breaker + "a
  mana dork" — and the tests asserted `variantSkipReason` returns null for it and
  `toCombo` maps it. The case was in the fixture the whole time with the wrong
  answer pinned to it.
- **The corpus must be re-ingested.** `synergy_produces` / `synergy_wants` are
  stored columns computed at ingest, and the combo table is written by the same
  run, so none of this reaches the app until then. **Neither ingest was run as
  part of this change.**
- **The combo count will DROP by roughly 4,813** on the next combo ingest. That is
  the intended effect and it should not be read as an ingest failure.

## Found, and deliberately not done

- **Template pieces should be MODELLED, not dropped.** Carrying the template
  count on `Combo` would make these 4,813 combos read "one piece away, and the
  piece is a card class" instead of vanishing, which is strictly better product
  behaviour — and it needs a new column, a migration and an ingest write. Skipping
  is the correct answer until then because it is the one of the two that is wrong
  in the safe direction.
- **The pre-2024 self-sacrifice templating** spells the card's own name
  ("Sacrifice Ashnod's Altar") and rule 2 cannot see it, for the same reason
  §2 gives about substitution.
- **`whenever you cast a spell with mana value 5 or greater`** is caught by rule
  3 and should not be — a Ponder does not turn Radagast on. Six cards against
  246, and pinning them out needs a lookahead no test could fail on.
- **`amass`** creates a token and puts a +1/+1 counter, and 5 cards print it
  without the reminder text that already carries both tags. Too small to earn a
  rule; recorded so the next audit does not rediscover it.
- **Self-recursion from the graveyard** ("Return this card from your graveyard to
  your hand") is 1,440 uncovered clauses and was left alone deliberately.
  `graveyard-creature` means the graveyard as a RESOURCE; a card that recurs
  itself does not benefit from a full yard, it fills its own.
- **Opponent mill** is still not modelled and still correctly so (ADR-0029 §6).
  The probe now names the class, at 2.3% of uncovered clauses.
- **`interactsWith` still has no direction.** ADR-0029 called it overdue; this ADR
  added no one-way relation, so the debt is unchanged rather than worse.
