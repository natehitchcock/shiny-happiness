# 55. Severity is how hard, not how many

Date: 2026-09-02

## Status

Accepted. Extends [ADR-0043](0043-one-clause-wins-and-brings-its-whole-tuple.md)
rather than contradicting it: severity is a fifth tier in the clause tuple, and
the winning clause still brings all of them together.

> **Number 0055 was assigned, not chosen.** The ADR directory was deliberately
> not listed — reading it to find "the next free number" is how 0027 got claimed
> twice, and ADR-0043 records that 0039 was announced by 0038 and then never
> written. The next agent should take 0056.

## Context

> "maybe also, as part of impact calculations, we need a severity value.
> Something to quantify that flickering something is not as severe as bouncing
> it, which is less severe than damage, which is less severe than destroy, which
> is less severe than exile"

A real gap. Before this, `Exile target creature` and `Return target creature to
its owner's hand` were the same card to the model: both `one / one-shot /
opposing / none`, both 1.2.

## The decision that had to come first: the shape

Severity is a property of **removal**, and 79.5% of the corpus removes nothing.
Get the shape wrong and the axis is worse than not having it — a bounce spell
scoring below a cantrip is not an improvement.

**Severity is a multiplier. `none` is not a rung; it is the ABSENCE of the
ladder, and it is worth exactly 1.0.** A clause that removes nothing is
multiplied by one, so 25,279 of the 31,782 commander-legal cards are
bit-identical to what they scored before this axis existed. The axis can only
move cards that actually remove something.

**Neutral sits at `destroy`**, and that is the load-bearing choice:

- Destroy is the largest unambiguous removal class — **1,523** commander-legal
  cards, against exile's 636, tap's 467 and bounce's 431 — so anchoring there
  moves the fewest cards.
- **Wrath of God is a destroy.** An anchor quoted in doc 18 and three ADRs holds
  at 6.12 for free, rather than needing a justification.

### Rejected

- **Neutral at the top** (`exile` = 1.0, everything else a penalty). Every
  removal spell is then priced below every cantrip. This is the absurdity the
  brief named and it is not recoverable by tuning.
- **Neutral at the bottom** (`flicker` = 1.0, everything else a bonus). A thumb
  on the scale for removal, inflating the largest class in the corpus, and it
  moves every anchor.
- **Folding severity into `breadth`'s table** as a refinement of "affects a
  permanent". Breadth answers HOW MANY and severity answers HOW HARD; a tier
  table cannot carry two questions and remain a partition, which is the property
  the breadth docblock is built on.

### The bound that makes the multiplier safe

A removal clause always has at least `one` breadth (1.0) because it points at
something; a clause affecting nothing takes `none` (0.5). **So as long as the
weakest rung exceeds 0.5, removal can never fall below an effect that touches
nothing.** `tap` is 0.6. That is a proof rather than a hope, and it has a test.

## The ladder

| rung | value | also mapped here | why |
| --- | ---: | --- | --- |
| `none` | 1.0 | — | not removal; the absence of the ladder |
| `tap` | 0.6 | freeze | a delay; the permanent never leaves |
| `flicker` | 0.7 | blink | it leaves and comes straight back |
| `bounce` | 0.75 | to hand | it leaves and must be paid for again |
| `damage` | 0.8 | −X/−X | it dies only sometimes |
| `destroy` | 1.0 | counter, edict | it ends in the graveyard |
| `exile` | 1.2 | tuck, steal | it does not come back |

**The governing rule for placing anything not on the owner's list: severity
describes WHAT HAPPENS TO THE OBJECT, never how good the object was or who
chose it.** That single line settles every case the brief raised:

- **counter → destroy.** A countered spell ends in the graveyard, exactly where
  a destroyed permanent ends, and is equally recoverable. The alternative — that
  countering is the most severe thing because the spell never resolves — is a
  claim about *denial*, which is a different axis this model does not have. Said
  rather than smuggled in.
- **edict → destroy.** The chosen permanent is destroyed. That the opponent
  picks their worst is a question about targeting *quality*, and there is no
  axis for that; folding it into severity would make the ladder mean two things.
- **−X/−X → damage.** The same probabilistic kill. It takes the same rung rather
  than inventing a second one that would have to be placed by the same argument.
- **tuck → exile.** Shuffled into a library is as unrecoverable as exile for the
  permanent in question.
- **steal → exile.** You lose it *and* they gain it, a bigger swing than
  destroy. It does not exceed exile because the permanent survives and can still
  be answered.
- **tap/freeze → the floor.** Weaker than flicker: a flicker at least strips
  auras and counters permanently, where a tap returns everything next untap.

### Damage, and how ADR-0029 was reused rather than reopened

ADR-0029 rejected a toughness threshold for damage-as-removal because it
measured the kill rate as a **slope**, not a boundary — over 17,514 creatures
with printed toughness, 1 damage kills 21.6%, 2 kills 46.7%, 3 kills 69.6%,
4 kills 85.7%, 10 kills 99.8%.

**That ruling is why damage gets ONE rung.** A slope forbids a boundary, so the
model does not read the number and interpolate; it says "damage" and prices it
once. Attempting otherwise would also fail on the **754** cards that deal an
amount which is not a constant at all (`X`, "equal to its power").

Where the rung sits is then a separate, corpus-level question, and it was
measured rather than felt: printed damage amounts across **2,188** clauses have
a median of **2** and a mean of **2.71**, which lands between ADR-0029's 46.7%
and 69.6% rows. **0.8** is that band rounded up, because damage that fails to
kill still shrinks a blocker or goes to a face — unlike a failed destroy, which
does not exist.

## Two guards that cost false positives to find

- **`(?! cards?)` separates a permanent from a card in a zone.** "Exile target
  creature" is removal; "exile target creature CARD from your graveyard" is
  recursion denial. Magic's own templating distinguishes them with that one
  word, and 907 clauses in the corpus exile something out of a library,
  graveyard or hand. Without the guard, 50 of them read as removal.
- **Flicker is checked before exile and suppresses it**, because flicker *is*
  "exile … then return it to the battlefield". The other order prices Ephemerate
  as Swords to Plowshares. The window also has to cross a full stop, because the
  templating puts the return in a second sentence — Planar Guide and Legion's
  Initiative exile all creatures and return them at the next end step.

Two more were found by auditing the rises rather than by reading:

- **A control RESET is not a steal.** "Each player **gains** control of all
  permanents they own" hands everything back. Nine commander-legal cards say it
  and all nine read as exile-grade removal; Brooding Saurian, whose entire text
  returns every permanent to its owner, reached the ceiling at 22.176. The rule
  is `gain`, never `gains` — third person is always somebody else doing the
  gaining.
- **A donate is not a steal.** "Have target opponent gain control of target
  permanent you control" is a gift. Giving something away is not removal, and
  the model has no axis for a downside.

## Overload, fixed because severity exposed it

`overload {6}{U}` was read as a clause of its own. It carries no effect, yet it
took `unbounded` breadth, won its card under ADR-0043's winning-clause rule, and
reported a tuple describing nothing.

Measured: **27 of the 28 overload cards scored an identical 7.2 with severity
`none`.** Cyclonic Rift, Vandalblast, Mizzium Mortars and Counterflux do four
completely different things and the model could not tell them apart. Overload is
a **cost on the card's own effect**, so it is now card-level like `fragile`: it
promotes the card's real clauses to `unbounded`, and the bare keyword line is
dropped.

## Consequences

### `IMPACT_MAX` moves: 18.48 → **22.176**

`6.0 × 2.2 × 1.4 × 1.2`. Still **derived** from the tier tables and never
written down, and still **reachable** — an upkeep exile over a targeted
opponent scores exactly it. The mirror in `packages/ui/src/card/metrics.ts`
moves with it and the two are still checked against each other.

Every rendered "N of 18.48" becomes "N of 22.176", and the meter fill moves with
it: Wrath of God draws at 27.6% where it drew at 33.1%. **The card did not move;
the scale did.**

### Corpus-wide

**4,588 of 31,782 cards moved (14.4%): 643 up, 3,945 down.** Mean 2.3954 →
2.2964. Severity distribution: `none` 25,279 (79.5%), `damage` 2,865 (9.0%),
`destroy` 1,955 (6.2%), `exile` 733 (2.3%), `tap` 467 (1.5%), `bounce` 431
(1.4%), `flicker` 52 (0.2%).

| band | before | after |
| --- | ---: | ---: |
| 0 | 361 | 361 |
| 0–1 | 15,599 | 16,695 |
| 1–3 | 10,124 | 9,057 |
| 3–6 | 210 | 589 |
| 6–10 | 4,019 | 3,701 |
| 10–15 | 822 | 924 |
| 15+ | 647 | 455 |

### The anchors

| card | before | after | why |
| --- | ---: | ---: | --- |
| Wrath of God | 6.12 | **6.12** | destroy is neutral |
| Craterhoof Behemoth | 6.0 | **6.0** | removes nothing |
| Sol Ring | 0.68 | **0.68** | removes nothing |
| basic Forest | 0 | **0** | no text |
| Cyclonic Rift | 7.2 | **5.4** | it is a **bounce** |
| Swords to Plowshares | 1.2 | **1.44** | it is an **exile** |

The last two are the evidence the axis works. They were identical in every tier
before and are now separated by the only thing that differs between them.

**Cyclonic Rift now scores below Wrath of God, and that is deliberate.** Both
are board-wide; Rift is one-sided and is still credited for it, but it bounces
where Wrath destroys, and everything Rift answers comes back. The rest of Rift's
real-world reputation lives in tempo and instant speed, and this model has never
had an axis for either — the same stated blindness that prices Sol Ring at 0.68.

### Regenerate both derived files

```
pnpm --filter @roundtable/ingest baseline        # r: 0.4919 -> ~0.512 (estimated, +4.2%)
pnpm --filter @roundtable/ingest impact-roles    # quartiles move; blind-spot counts do not
```

`noCountableEffect` is counted off `breadth`, which severity does not touch, so
the control assertion in `impact-roles.test.ts` is unaffected. The quartiles are
not.

## The pane

A fifth row, **"Ends up"**, in the pane's own register: *tapped, and still there
/ right back where it was / in its owner's hand / damaged, and dead only
sometimes / in the graveyard / gone for good*.

It is drawn **only when the card removes something**. It is the one row that
does not apply to every card, and printing "Ends up: nothing" on four cards in
five is a row that never varies, which is a row that stops being read. `damage`
says out loud that it is not always lethal, because that is the one rung whose
severity is probabilistic and a reader who is not told will assume otherwise.

No constant appears in the copy, so the existing test forbidding drifting
constants in the explainer still holds.
