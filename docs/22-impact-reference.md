# 22 — The impact model, as a reference

**Status: built.** This is a reference for
[`packages/domain/src/impact.ts`](../packages/domain/src/impact.ts): the formula,
every tier value, and the rules in the order they are actually tested.

It is deliberately not [doc 18](18-card-impact-and-efficiency.md). Doc 18 is the
design record — it answers _why 6.0_ and carries the decision history behind
every constant, accreted over ADR-0025, ADR-0029, ADR-0043 and ADR-0055. This
answers _what happens to this card_, which is a different question and was
taking three files and a docblock to answer.

Every number below was read from the shipped source or produced by running that
source against the live corpus on 2026-09-05 — 31,782 commander-legal cards.
Nothing here is quoted from a docblock without being re-measured, and two places
where the docblocks have drifted are called out in §22.11.

**`efficiency/baseline.data.json` no longer exists.** ADR-0070 replaced the
efficiency model outright and deleted it; the sentence below that calls it stale
is left as written because it was true of the model it described.
`impact/by-role.data.json` is unaffected by that change and is still stale on
ADR-0066's terms.

**Re-measured after [ADR-0066](adr/0066-mana-and-taxes-are-rules-not-blind-spots.md)**,
which renamed the four displayed axes, made `when` a trigger word, turned stakes
into five tiers chosen by maximum, and gave mana production and taxes rules of
their own. §22.5, §22.6, §22.9, §22.11 and §22.12 all moved. The two baked data
files (`efficiency/baseline.data.json`, `impact/by-role.data.json`) are STALE as
that ADR landed and are regenerated separately — every efficiency number and
every role band in the app is computed from the old exchange rate until they are.

---

## 22.1 The formula

```
impact = breadth × persistence × stakes × severity × symmetry
```

| factor      | drawn as   | range       | question                                |
| ----------- | ---------- | ----------- | --------------------------------------- |
| breadth     | **Breadth**  | 0.5 – 6.0   | how many things it touches              |
| persistence | **Rate**     | 1.0 – 2.2   | how many times it happens               |
| stakes      | **Stakes**   | 0.85 – 1.4  | who is on the wrong end                 |
| severity    | **Severity** | 0.6 – 1.2   | how hard it hits what it touches        |
| symmetry    | —          | 0.85 or 1.0 | whether a mass effect spares the caster |

The internal names and the drawn names differ on two axes, and deliberately:
`persistence` and `stakes` are the model's own words and are what the union
members are still called, while **Rate** and **Stakes** are what
`packages/ui/src/card/metrics.ts` prints. Only `stakes`'s union MEMBERS were
renamed by ADR-0066, because its tiers themselves changed.

**A mana clause is scored by a different rule and does not use this formula.**
A clause that produces mana scores 1.0 per mana produced and competes as that
clause's score under the winning-clause rule (§22.3, §22.14).

Rounded to three decimal places, because float multiplication of five constants
is otherwise `7.199999999999999` on the wire.

`IMPACT_MAX` is `6.0 × 2.2 × 1.4 × 1.2 = 22.176`, **derived from the tables and
never written down as a literal** — a literal maximum goes stale silently the
first time a rung moves. It is reachable, not theoretical: an upkeep trigger over
every opponent scores exactly this.

---

## 22.2 What it measures, and what it refuses to

Impact reads three fields the corpus already stores — `oracleText`, `typeLine`
and `manaCost` — and derives nothing at ingest.

**It is a property of the card, never of the deck.** Deck-relative impact was
offered and declined: combo degree, role deficit and mechanical synergy are
already three deck-relative numbers on the same suggestion row, and a fourth
would mostly be a second opinion about the first three. Card-intrinsic also means
the number can appear on `/cards/search`, which has no deck at all.

**The cost that was accepted, and then paid off.** The model used to be blind to
cards whose point is a resource or a tax rather than an effect on something: Sol
Ring scored **0.68** and Rhystic Study **0.808**, both correct readings of the
model and both wrong about Magic. ADR-0066 made each a rule rather than an
exception — Sol Ring reads its two mana and scores **2.0**, Rhystic Study reads
as the standing board-wide tax it is and scores **15.84**. There is still
deliberately no fudge factor rescuing named cards: both rules name no card and
were measured over the whole corpus.

**What is still blind.** A card whose point is drawing cards, filling a
graveyard or fixing colours names nothing this model counts. That is stated in
§22.13 and in the pane, and it is not patched.

**Zero means zero.** A card with no rules text scores exactly `0`, and only such
a card does. That is not a rounding convenience: the vanilla creatures are what
`efficiency.ts` calibrates its baseline against, and a measuring stick with a
nonzero reading at zero cannot calibrate anything. The emptiness check runs twice
— once on the raw string, once after reminder text is stripped — because a basic
Forest's entire printed text is the parenthetical `({T}: Add {G}.)` and it walked
past the first check into the `none` floor of 0.425.

---

## 22.3 The pipeline

1. **Strip reminder text**, before any pattern runs. Cyclonic Rift's own reminder
   text reads _change "target" in its text to "each"_ — an unstripped classifier
   reads that `each` and calls hundreds of cards mass effects.
2. **Normalise self-reference to `~`.** Both spellings: cards printed before the
   2024 templating change name themselves ("Masticore deals…"), cards after it
   say "this creature". A legend's short name is normalised too, because later
   lines drop the title.
3. **Split on newlines into ability lines.** The unit is the line, not the
   sentence. Every pattern is written with `.` or `[^…\n]`, and JavaScript's `.`
   does not match a newline, so each rule is confined to one line by
   construction — a line scored in isolation gives exactly the answer it gave in
   card context. A sentence split could promise no such thing: Wrath of God's two
   sentences share a line, and _"They can't be regenerated"_ alone is not a board
   wipe.
4. **Drop the bare `overload {cost}` line.** It is a cost, not an effect.
5. **Score each line** as a complete tuple of all five axes.
6. **The highest-scoring line wins, whole.** Ties go to the earlier line.

**One clause wins and brings its whole tuple** (ADR-0043) — never the maximum of
each axis taken independently. Diregraf Captain took `unbounded` breadth off its
anthem line and `player` stakes off its drain line and reported **15.96** for a
three-mana lord, a combination corresponding to nothing the card does. It now
reports **6.0**, which is what every other lord scores.

---

## 22.4 Breadth — how many things it touches

A partition: every clause is exactly one tier.

| tier        | drawn as             | value | meaning                                       |
| ----------- | -------------------- | ----- | --------------------------------------------- |
| `unbounded` | "Every target"       | 6.0   | all / each / every, a bare plural, or a tax    |
| `several`   | "Several targets"    | 3.5   | up to three, four or five targets              |
| `variable`  | "Variable targets"   | 3.5   | `X target` — always carries `scales`           |
| `few`       | "Few targets"        | 2.2   | up to two targets                              |
| `one`       | "Single targets"     | 1.0   | a single target, or `any target`               |
| `none`      | "No targets"         | 0.5   | the clause affects nothing countable           |

On an `unbounded` clause that is `one-sided`, the drawn words say **whose**:
"Every target on your side" or "Every target on an opponent's side". A
`symmetric` effect keeps the unqualified words, because it genuinely is
everything — that is what the 0.85 discount is charged for.

The counted rungs are `n^1.14` — 1.00, 2.20, 3.51 — so a card hitting two things
beats two cards hitting one apiece, because it is one card and one payment. The
exponent is the only free parameter in the model and is very nearly inert: `few`,
`several` and `variable` together are 371 of 31,782 cards.

The step to `unbounded` is **the height of the whole counted ladder**: the ladder
spans 3.5 − 1.0 = 2.5, so unbounded sits at 3.5 + 2.5 = 6.0. That is what makes
"all" a tier rather than a fourth rung. A value nearer 4 was rejected — it makes
unbounded read as "several, but more".

`variable` takes the top **counted** rung, never the unbounded one. X reaches as
far as your mana does; "all" reaches as far as the board does and keeps growing.
Giving X the unbounded value would put every Fireball above every Wrath.

### Test order — first match wins

| #   | test                                                                                                                                                | tier        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | `all` / `each` / `every` + creature, permanent, player, opponent, land, artifact, enchantment, nonland, spell, card — or a bare plural with a controller phrase — or the card has `overload` — or the clause is a **tax** (§22.14) | `unbounded` |
| 2   | `x target`                                                                                                                                          | `variable`  |
| 3   | `up to (three\|four\|five) target`                                                                                                                  | `several`   |
| 4   | `up to two target`                                                                                                                                  | `few`       |
| 5   | `target` or `any target`                                                                                                                            | `one`       |
| 6   | nothing above matched                                                                                                                               | `none`      |

The bare-plural rule is separate and load-bearing: _"creatures you control gain
trample"_ has no quantifier at all, and the scoped all/each signal alone put
Craterhoof Behemoth, every anthem, every lord and every Overrun variant in
`none`.

---

## 22.5 Persistence — how many times it happens

Ordered by **how much of the cost recurs**, not by how often the effect fires.
That is a property of the text rather than a guess about the game, which is why
it is the axis.

| tier        | drawn as          | value | meaning                                          |
| ----------- | ----------------- | ----- | ------------------------------------------------ |
| `upkeep`    | "Phase-Triggered" | 2.2   | no cost recurs and there is nothing to wait for  |
| `triggered` | "Triggered"       | 1.9   | no cost recurs, but it is conditional on an event |
| `activated` | "Activated"       | 1.6   | the whole cost recurs every time                 |
| `one-shot`  | "Once"            | 1.0   | it happens once                                  |

The ceiling is deliberately low. A permanent that repeats is worth roughly twice
a one-shot the way a two-for-one is worth roughly two cards; past that what
bounds the effect is the game ending, and this model has no opinion about game
length. At 4 or 5 a minor upkeep trigger would outrank a board wipe.

### Test order — first match wins

| #   | test                                                                                                             | tier        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | the card is an **instant or sorcery**, or it is `fragile` (§22.8)                                                | `one-shot`  |
| 2   | `at the beginning of`, or the clause is a **tax** (§22.14)                                                       | `upkeep`    |
| 3   | `whenever`, or the clause is a standing grant to a class of your future spells                                   | `triggered` |
| 4   | a cost, a colon and an effect at the start of a line — the run before the colon is capped at 60 characters, because costs are short and prose is not | `activated` |
| 5   | `when`                                                                                                           | `triggered` |
| 6   | nothing above matched                                                                                            | `one-shot`  |

### `when` is a trigger word (ADR-0066)

_"When ~ enters, draw a card"_ says `when`, not `whenever`, and is exactly as
much a triggered ability. It matched neither rule 2 nor rule 3, fell past rule 4
and landed on `one-shot`: **5,289 commander-legal permanents**, 16.6% of the
corpus, priced as though their ability happened once. Accursed Marauder went
**8.4 → 15.96**; Priest of Gix left the floor.

`\bwhen\b` does not match `whenever` — there is no word boundary after the
fourth letter — so rules 3 and 5 are independent and no `whenever` card moved.

**Bare, not anchored, and that was measured.** Magic templates a trigger at the
start of its ability, so `^(when|whenever|at)\b` is the obvious candidate: it
promotes **5,022** cards against the bare rule's **5,289**, and every one of the
292 clauses in the difference is a genuine trigger — 197 ability-word prefixes
(_"corrupted — when ~ enters"_), 33 triggers granted inside quotation marks, 30
reflexive _"when you do"_ triggers, 20 Saga chapters, 12 delayed triggers after a
replacement effect. Not one is prose, so the anchor costs 281 cards and buys no
precision.

**Rule 5 sits BELOW rule 4, and that is where the false positives were.** 86
clauses are an activated ability whose _effect_ contains a delayed or granted
trigger — Havengul Lich's _"{1}: you may cast target creature card … when you
cast it this turn, …"_. The whole cost recurs on all 86, so `activated` is right
by this axis's own ordering, and asking `when` above the colon rule would have
promoted every one of them.

**A known gap, left open.** The anchored candidate's only unique catch was 15
clauses on 14 cards reading _"at end of combat"_ — genuine phase triggers that
`at the beginning of` does not see. Whether they are `upkeep` or `triggered` was
not decided, so they still read `one-shot`.

### The Quandrix rule

A static grant — _"spells you cast have cascade"_ — is a repeat that never says
`whenever`, so it used to fall to `one-shot`. Quandrix, the Proof grants cascade
unconditionally and forever and scored **0.425**, the model floor; Yidris grants
it only after connecting in combat and only for that turn, and scored **0.808**.

Teval, Arbiter of Virtue settled it by carrying both spellings at once — a static
_"spells you cast have delve"_ and a triggered _"whenever you cast a spell"_.
Breadth and stakes agreed between the two forms; persistence was the only axis
that differed. 251 commander-legal permanents carry a grant of this shape. They
read `triggered`, not `upkeep` — there _is_ something to wait for: you must cast
a spell.

The exclusion that makes it safe: 28 cards say _"spells you cast this turn cost
{1} less"_, hung off an attack trigger or a Saga chapter. Without it, a Saga
chapter is priced as a permanent engine.

---

## 22.6 Stakes — who is on the wrong end of it

**Five tiers chosen by MAXIMUM** (ADR-0066), not a first-match cascade.

| tier                 | drawn as                    | value | meaning                                    |
| -------------------- | --------------------------- | ----- | ------------------------------------------ |
| `opposing-player`    | "another player"            | 1.4   | it can land on another player              |
| `opposing-permanent` | "another player's permanent" | 1.2  | it can land on another player's permanent  |
| `owned-permanent`    | "your own permanent"        | 1.0   | it lands on your own permanent             |
| `owning-player`      | "you"                       | 0.9   | it lands on you                            |
| `nothing`            | "nothing countable"         | 0.85  | it touches nothing countable               |

An unrestricted `target creature` reads as `opposing-permanent`, not as a middle
tier of its own. The target is chosen by the caster and the caster chooses the
opponent's, so scoring Swords to Plowshares below a card that may _only_ hit an
opponent's creatures would rank a strictly worse card higher.

**A person outranks their board on both sides**, because a board is replaceable
and a life total is the game.

**`nothing` is a distinct floor, not a merge into `owning-player`**, and it keeps
the old `self` value of 0.85 exactly so the floor does not reprice. A clause that
drains you for 3 lands on a person; a clause that taps for mana lands on nobody.
The old single floor said those were the same card. **1,020 cards** (3.2%) move
onto `owning-player`.

### The rule: the best thing the clause could land on

Every candidate is offered and the highest wins, so the answer no longer depends
on which pattern is written first. `any target` reaches a player, so it is
`opposing-player` — by what it can hit, not by rule order.

| candidate                                                                                                                              | offers               |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `target (player\|opponent)`, `any target`, or `each (opponent\|player)` / bare `opponents` **not** followed by `control`                | `opposing-player`    |
| breadth resolved to `unbounded`                                                                                                        | `opposing-permanent` |
| `you don't control`, `an opponent controls`, or `target` + up to three qualifier words + a permanent noun, **not** followed by `you control` | `opposing-permanent` |
| `you control`                                                                                                                          | `owned-permanent`    |
| `you (gain\|lose\|draw\|discard\|mill\|skip)`, or damage dealt `to you`                                                                 | `owning-player`      |
| nothing offered                                                                                                                        | `nothing`            |

**`yours only` REMOVES the two opposing candidates rather than outranking them**,
and that distinction is the whole safety of the maximum. A mass effect scoped
entirely to the caster's own side — a mass effect naming `you control`, not an
unrestricted mass effect, not naming a player, never putting an opponent's side
in scope — has no opponent's permanent among its possible targets, so it is not
eligible for `opposing-permanent` at all. Under a naive maximum every anthem and
every lord would have taken the 1.2 off the unbounded rule, and Craterhoof
Behemoth and Diregraf Captain would both have moved: ADR-0043's regression,
arriving by a new route.

### Two defects the ordering fixed, and the maximum preserves

**The possessive.** The player candidate excludes `opponents` followed by
`control`. Without it, _"creatures your opponents control get −1/−1"_ read as
aimed at a person: Doomwake Giant, Bolg and 46 other one-sided anthems were
priced at the player rung, and Bolg reached **18.48** for shrinking the opposing
team by one. 1,472 cards.

**The qualifier gap.** The opposing candidate allows up to three words between
`target` and its noun. Requiring them adjacent cost 1,472 commander-legal cards —
_"destroy target non-Demon creature"_, _"counter target noncreature spell"_ — all
of which fell to the floor and were priced at 0.85 instead of 1.2. The trailing
lookahead is what keeps 1,070 cards that blink or pump _your own_ creature from
reading as attacks on an opponent.

---

## 22.7 Symmetry — whether a mass effect spares you

Only ever asked of a clause whose breadth is `unbounded`.

| value       | multiplier | when                                                                                                    |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `none`      | 1.0        | breadth is not `unbounded` — not a mass effect at all                                                    |
| `symmetric` | 0.85       | an unrestricted mass effect naming no controller and no player, not scoped to your own side              |
| `one-sided` | 1.0        | any other mass effect                                                                                    |

The 0.85 discount is **the `self` stakes tier, reused**. A symmetric wrath is a
wrath that is also pointed at you, and "pointed at you" is already a number in
the stakes table. A second, independently chosen constant was rejected — one more
thing to justify and one more thing to drift out of step.

Measured on the current corpus, the discount reaches **918 cards**; **4,590**
reach `one-sided` and pay nothing.

### The coordinated list

_"Destroy all artifacts, creatures, and enchantments"_ — where `all` is followed
by `artifacts` — never matched a rule looking for `all creatures` alone.
Nevinyrral's Disk, Jokulhaups, Akroma's Vengeance and 117 other wipes were
reported as one-sided, and the pane told a builder the Disk spares their board.

The fix needs an **atomic group**: the restriction sits after the _last_ noun, so
an ordinary greedy list backtracks to "artifacts, creatures", finds a comma
instead of a controller, and matches anyway. JavaScript has no `(?>…)`, so the
list is captured inside a lookahead and replayed with a backreference — one bite
that cannot be given back.

---

## 22.8 Severity — how hard it hits what it touches

The rungs group by **what happens to the object**, never by how good the object
was or who chose it.

| tier      | value | meaning                                              |
| --------- | ----- | ---------------------------------------------------- |
| `exile`   | 1.2   | tuck, steal — it does not come back                  |
| `destroy` | 1.0   | counter, edict — it ends in the graveyard            |
| `none`    | 1.0   | the clause removes nothing — the absence of the ladder |
| `damage`  | 0.8   | −X/−X — it dies only sometimes                       |
| `bounce`  | 0.75  | to hand — it leaves and must be paid for again       |
| `flicker` | 0.7   | blink — it leaves and comes straight back            |
| `tap`     | 0.6   | freeze — a delay; the permanent never leaves         |

**Neutral sits at `destroy`**, and that is the decision the whole axis turns on.
Neutral at the top — `exile` = 1.0 with everything else a penalty — prices every
removal spell below every cantrip. Neutral at the bottom — `flicker` = 1.0 with
everything else a bonus — is a thumb on the scale for removal and inflates the
largest class in the corpus. Destroy is the biggest unambiguous removal class, so
anchoring there moves the fewest cards; and Wrath of God, the anchor quoted
throughout the design docs, is a destroy and therefore holds at **6.12** for
free.

**The floor is above 0.5, and that bound is load-bearing.** A removal clause
always has at least `one` breadth (1.0) because it points at something, while a
clause that affects nothing takes `none` (0.5). So as long as the weakest rung
exceeds 0.5, tapping a creature can never score below gaining three life, and the
multiplier cannot invert the two populations. `tap` is 0.6.

**Damage gets one rung and not a family** because the kill rate is a slope, and a
slope forbids a boundary: 1 damage kills 21.6% of the 17,514 creatures with
printed toughness, 2 kills 46.7%, 3 kills 69.6%, 4 kills 85.7%, 10 kills 99.8%.
Where the single rung sits is then a corpus question — printed damage amounts
have a median of 2 and a mean of 2.71 across 2,188 clauses, landing between the
46.7% and 69.6% rows. 0.8 is that band rounded up, because damage that fails to
kill still shrinks a blocker or goes to a face, and 754 cards deal an amount that
is not a constant at all.

### How the rung is chosen

Severity is **gated on breadth**: a clause whose breadth is `none` cannot have
one, which is also the cheapest guard against _"exile the top card of your
library"_ — card advantage wearing a removal verb. Within a clause the **harshest
rung wins**, because _"destroy target creature; if you do, exile it"_ does both
and the worse outcome is the one that happened.

| rung      | recognised by                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `tap`     | `tap` reaching a quantified permanent within 30 characters                                            |
| `flicker` | `exile … return it/them … to the battlefield`                                                         |
| `bounce`  | `return … to its owner's hand`                                                                        |
| `damage`  | `deals … damage`, or `gets -N/-N`                                                                     |
| `destroy` | `destroy` reaching a permanent; `counter target/all spell`; an edict — `target player … sacrifices`   |
| `exile`   | `exile` reaching a permanent; a tuck — `shuffle/put … into owner's library`; a steal — `gain control of` |

### Three exceptions written into the loop

**Flicker suppresses exile.** Flicker _is_ "exile … then return it", so read in
rung order the gentlest outcome would score as the harshest and Ephemerate would
price as Swords to Plowshares.

**Steal requires `gain`, never `gains`.** Third person is always somebody else
doing the gaining — a control reset that hands everything back, or a donate. Nine
commander-legal cards are resets and all nine read as exile-grade removal before
the distinction was drawn; Brooding Saurian, whose entire text returns every
permanent to its owner, reached the ceiling at **22.176**.

**A permanent is not a card in a zone.** Every removal verb refuses a following
`card` or `cards`. _"Exile target creature"_ takes a permanent off the
battlefield; _"exile target creature **card** from your graveyard"_ is recursion
denial. 907 clauses in the corpus exile something out of a library, graveyard or
hand rather than off the battlefield.

---

## 22.9 Card-level flags

Three facts belong to the card rather than to any one line.

| flag       | set when                                                                                          | effect                                                                              | cards |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| `scales`   | any clause took `variable` breadth, or the text says `for each`, or the mana cost contains `{X}`  | Reported, never priced.                                                              | 2,139 |
| `fragile`  | the text contains `sacrifice ~`                                                                   | Forces `persistence` to `one-shot` on **every** line, whatever the type line says.   | 1,347 |
| `overload` | the text contains the keyword                                                                     | Promotes every real clause to `unbounded` breadth; the bare keyword line is dropped. | 28    |

**Fragility is card-wide because the sacrifice stops everything.** Viridian
Zealot's _"{1}{G}, Sacrifice this creature: Destroy target artifact or
enchantment"_ is not a repeating ability, it is a Naturalize with a body — and
pricing it as an engine is the largest class of error the model would otherwise
make.

**Overload was a phantom.** Read as a clause, `overload {6}{U}` carries no effect
at all — yet it took `unbounded` breadth, won its card under the winning-clause
rule, and reported a tuple describing nothing. 27 of the 28 overload cards scored
an identical **7.2** with severity `none`: Cyclonic Rift, Vandalblast, Mizzium
Mortars and Counterflux do four completely different things and the model could
not tell them apart.

**Scaling is marked, not guessed.** Torment of Hailfire's impact is not 8.4, it
is 8.4 times whatever X was, and X is not knowable when a column is drawn.
Guessing an average X is a claim about a game state the ranker cannot see;
excluding the cards drops 2,139 of them, several the best in the format.

---

## 22.10 What is removed before breadth is measured

Three classes of phrase mention a group the effect does not actually reach. All
three are stripped from the clause before the scope questions are asked —
persistence still reads the line as written.

### Clauses that count rather than affect

Regal Bunnicorn's whole text is _"power and toughness are each equal to the
number of nonland permanents you control"_. It affects nothing at all and scored
**6.0** — the same reach as Craterhoof Behemoth, off a two-mana creature. 160
commander-legal cards took an unbounded reach out of a clause that only counted.

The rule measures **heads, not the preposition**: an explicit short list — `the
number of`, `most common … among`, `mana value among`, `for each
kind/type/different` — and never bare `among`, because _"deals X damage divided
as you choose among X targets"_ is a targeting clause wearing the same
preposition.

**The match stops at the counted noun.** Running to the end of the clause also
swallowed whatever came _after_ the count, which on a damage card is the whole
effect: Hallar's _"deals damage equal to the number of +1/+1 counters on it **to
each opponent**"_ lost its "each opponent" and fell from **15.96** to **0.808**.
So the head is followed by at most three intervening words, then the group noun,
then an optional controller phrase — and the run refuses to cross `to`, `and`,
`or`, `each`, `all` or `every`.

### Serial spell classes

_"Counter all other spells"_ is a real mass effect — those spells are on the
stack together. _"Each spell you cast"_ is not: the spells arrive one at a time
across the whole game and no effect ever touches two of them. A serial class is
the **persistence** axis, never the breadth axis.

The rule requires `you cast`, and that bound is the whole safety of it. Damping
Sphere's _"each spell a player casts costs {1} more"_ and Trinisphere really do
apply to everybody and keep their unbounded reach. Without the removal, Threefold
Signal scored **7.2** — Cyclonic Rift's number — on a card that cannot touch an
opponent at all.

### `for each` riders on a spell grant

Applied only inside a clause already read as a standing grant. Locket of
Yesterdays reads _"spells you cast cost {1} less to cast for each card with the
same name as that spell in your graveyard"_: the trailing `for each` says how big
the discount is, not that the clause reaches a board. Six cards carry both
shapes.

**A known gap, left open deliberately.** The measuring-head list admits `for each
card type` but not plain `for each creature you control`, so roughly two thousand
cards still take an unbounded reach from a clause that only counts. Storm Entity
— a one-mana 1/1 whose whole text is _"enters with a +1/+1 counter on it for each
other spell cast this turn"_ — scores **7.2**, above Wrath of God. Widening the
head list was measured and **moved 2,377 cards**, with genuine false negatives
among them: `for each opponent` is not a measurement but a distributive effect
landing on people, and Smuggler's Share fell from **18.48** to **0.935**. That is
its own pass with its own counter-example hunt.

---

## 22.11 The distribution, measured

Over all 31,782 commander-legal cards, by running the shipped classifier against
the live corpus.

|         | minimum | 25th  | median | 75th  | 90th | 99th  | maximum |
| ------- | ------- | ----- | ------ | ----- | ---- | ----- | ------- |
| **now** | 0       | 0.808 | 1      | 2.128 | 7.2  | 15.96 | 22.176  |
| before ADR-0066 | 0 | 0.6 | 0.95 | 1.92 | 6.72 | 15.96 | 22.176 |

**The ends did not move.** 361 cards still score exactly zero and the maximum is
still reachable at 22.176. The middle rose by roughly a third of a rung, almost
all of it the `when` rule.

Half the corpus sits under **1.0** and the top decile begins at **7.2**. The
distribution is heavily skewed because breadth is a step function: crossing from
`one` to `unbounded` multiplies by six, and nothing else in the model moves a
card that far.

| axis        | tier                 | cards  | share |
| ----------- | -------------------- | ------ | ----- |
| breadth     | `none`               | 15,902 | 50.0% |
|             | `one`                | 9,998  | 31.5% |
|             | `unbounded`          | 5,508  | 17.3% |
|             | `few`                | 187    | 0.6%  |
|             | `variable`           | 100    | 0.3%  |
|             | `several`            | 87     | 0.3%  |
| persistence | `one-shot`           | 14,172 | 44.6% |
|             | `triggered`          | 9,860  | 31.0% |
|             | `activated`          | 5,942  | 18.7% |
|             | `upkeep`             | 1,808  | 5.7%  |
| stakes      | `nothing`            | 13,378 | 42.1% |
|             | `opposing-permanent` | 8,373  | 26.3% |
|             | `owned-permanent`    | 4,974  | 15.7% |
|             | `opposing-player`    | 4,037  | 12.7% |
|             | `owning-player`      | 1,020  | 3.2%  |
| symmetry    | `none`               | 26,274 | 82.7% |
|             | `one-sided`          | 4,590  | 14.4% |
|             | `symmetric`          | 918    | 2.9%  |
| severity    | `none`               | 25,337 | 79.7% |
|             | `damage`             | 2,851  | 9.0%  |
|             | `destroy`            | 1,954  | 6.1%  |
|             | `exile`              | 648    | 2.0%  |
|             | `tap`                | 463    | 1.5%  |
|             | `bounce`             | 431    | 1.4%  |
|             | `flicker`            | 98     | 0.3%  |

**361 cards score exactly zero** — 1.1% of the corpus.

The single largest movement is on the persistence axis: `one-shot` fell from
**57.4%** of the corpus to **44.6%** and `triggered` rose from **18.0%** to
**31.0%**, which is the 5,289 cards that say `when`. The stakes axis re-partitions
rather than moving: the old `self` (14,199) is now `nothing` (13,378) plus
`owning-player` (1,020), and the two opposing rungs are within 10 cards of the
tiers they replaced.

### Two docblock figures that have drifted

`impact.ts`'s symmetry comment says "831 cards" and "4,954"; the current corpus
gives 919 `symmetric` and 4,546 `one-sided`. The severity comment's 1,523 /
636 / 522 are **removal-class populations** taken when the axis was designed and
do not match the final tier counts above, which are what each card ends up
reporting after the harshest-rung rule and the breadth gate have run. Both are
recorded here rather than corrected in place, because the docblocks are quoting
the measurement that justified a decision and that measurement is not wrong — it
is just not the same quantity.

---

## 22.12 Worked examples

Every number produced by running the shipped classifier, not computed by hand.

| card                        | score | breadth     | persistence | stakes               | symmetry    | severity  |
| --------------------------- | ----- | ----------- | ----------- | -------------------- | ----------- | --------- |
| Grand Arbiter Augustin IV   | 18.48 | `unbounded` | `upkeep`    | `opposing-player`    | `one-sided` | `none`    |
| Accursed Marauder           | 15.96 | `unbounded` | `triggered` | `opposing-player`    | `one-sided` | `destroy` |
| Sphere of Resistance        | 15.84 | `unbounded` | `upkeep`    | `opposing-permanent` | `one-sided` | `none`    |
| Rhystic Study               | 15.84 | `unbounded` | `upkeep`    | `opposing-permanent` | `one-sided` | `none`    |
| Thalia, Guardian of Thraben | 15.84 | `unbounded` | `upkeep`    | `opposing-permanent` | `one-sided` | `none`    |
| Craterhoof Behemoth         | 11.4  | `unbounded` | `triggered` | `owned-permanent`    | `one-sided` | `none`    |
| Torment of Hailfire         | 8.4   | `unbounded` | `one-shot`  | `opposing-player`    | `one-sided` | `destroy` |
| Wrath of God                | 6.12  | `unbounded` | `one-shot`  | `opposing-permanent` | `symmetric` | `destroy` |
| Armageddon                  | 6.12  | `unbounded` | `one-shot`  | `opposing-permanent` | `symmetric` | `destroy` |
| Cyclonic Rift               | 5.4   | `unbounded` | `one-shot`  | `opposing-permanent` | `one-sided` | `bounce`  |
| Dark Ritual                 | 3     | `none`      | `one-shot`  | `nothing`            | `none`      | `none`    |
| Priest of Gix               | 3     | `none`      | `triggered` | `nothing`            | `none`      | `none`    |
| Blood Artist                | 2.66  | `one`       | `triggered` | `opposing-player`    | `none`      | `none`    |
| Sol Ring                    | 2     | `none`      | `activated` | `nothing`            | `none`      | `none`    |
| Swords to Plowshares        | 1.44  | `one`       | `one-shot`  | `opposing-permanent` | `none`      | `exile`   |
| Counterspell                | 1.2   | `one`       | `one-shot`  | `opposing-permanent` | `none`      | `destroy` |
| Viridian Zealot             | 1.2   | `one`       | `one-shot`  | `opposing-permanent` | `none`      | `destroy` |
| Lightning Bolt              | 1.12  | `one`       | `one-shot`  | `opposing-player`    | `none`      | `damage`  |
| Arcane Signet               | 1     | `none`      | `activated` | `nothing`            | `none`      | `none`    |
| Rampant Growth              | 1     | `none`      | `one-shot`  | `nothing`            | `none`      | `none`    |
| Ephemerate                  | 0.7   | `one`       | `one-shot`  | `owned-permanent`    | `none`      | `flicker` |
| Grizzly Bears               | 0     | —           | —           | —                    | —           | —         |

Torment of Hailfire and Viridian Zealot carry `scales` and `fragile`
respectively.

**A tuple stops reconstructing the score on a mana clause, and that is a real
cost of the mana rule.** Sol Ring reads `none` / `activated` / `nothing`, whose
product is 0.68, and reports 2.0 — because the mana rule scored the clause and
the tiers are still the honest reading of what the clause targets. Dark Ritual,
Arcane Signet, Rampant Growth and Priest of Gix are the same. Four rows in this
table multiply out to something other than their score, and the alternative was
inventing tier values for a clause that has none.

Five of these are worth reading twice:

- **Grand Arbiter above everything.** Its second line is a tax that names
  opponents, so it takes `upkeep` over an `unbounded` reach at the player rung.
  It is a four-mana enchantment creature at 83% of the model's ceiling, which is
  the tax rule being generous and is stated in ADR-0066 §6 rather than tuned.
- **Craterhoof Behemoth at 11.4.** Its whole effect is a `when ~ enters`
  trigger, and `when` is a trigger word now. The reach is unchanged.
- **Cyclonic Rift below Wrath of God.** Overload promotes the real clause to
  unbounded and it spares your board, so it pays no symmetry discount — but
  bounce is a gentler rung than destroy, and that is enough to put it below a
  card most players would take second.
- **Ephemerate at 0.7.** The flicker exception, visible: it suppresses the
  `exile` its own text contains, so it scores as the gentlest rung rather than
  the harshest.
- **Sol Ring above Lightning Bolt.** 2.0 against 1.12. This is Commander, and a
  two-mana ritual on a permanent is worth more here than three damage once.
  Nothing now sits at the old 0.425 floor in this table.

---

## 22.13 Blind spots, stated

- **Card advantage and fixing.** A card whose point is drawing cards, filling a
  graveyard or fixing colours still names nothing this model counts. Mana and
  taxes were the other two and are now rules (§22.14).
- **A tax may be narrower than `unbounded`.** Ten cards read _"spells your
  opponents cast **that target ~** cost {2} more"_ — a ward wearing a tax's
  templating — and each scores 15.84. Admitted deliberately; see ADR-0066 §6.
- **`at end of combat` is not read.** 14 cards carry a genuine phase trigger that
  `at the beginning of` does not see, and they still read `one-shot`.
- **The `for each` gap.** ~2,000 cards take an unbounded reach from a clause that
  only counts. Widening the rule moves 2,377 cards and creates its own false
  negatives.
- **Valence.** The model cannot tell a payoff from a drawback. _"Whenever
  equipped creature dies"_ reads identically on Halvar and on Skullclamp.
- **X is marked, not valued.** 2,139 cards carry `scales`.
- **One rung for damage.** Deliberate — the kill rate is a slope and a slope
  forbids a boundary — but 1 damage and 10 damage price identically.

**Impact is NOT an input to efficiency, as of
[ADR-0070](adr/0070-an-effect-has-a-price-and-efficiency-is-what-is-left.md).**
It was — efficiency divided it by mana value along with a measured stat
baseline, and refitted an exchange rate against it, so a pass over any rung
above moved every efficiency number twice. That coupling is gone. Efficiency is
now the sum of the fitted mana prices of a card's effects minus its mana value,
and the composite score above appears nowhere in it.

**The one thing efficiency still reads from this module is Rate** (§22.5), as
one priced feature among eighty-one. A rung moved there does move efficiency, by
a little: the four tiers are priced 3.004 / 3.103 / 3.125 / 3.145 mana, a spread
of 0.14 across the whole axis. Nothing else here reaches it.

---

## 22.14 Two rules that are not the formula

Both added by [ADR-0066](adr/0066-mana-and-taxes-are-rules-not-blind-spots.md).
Neither names a card, and both were measured over the whole corpus.

### Mana production — 1.0 per mana, as the clause's score

A clause that produces mana is scored by what it produces rather than by the
nothing it targets. The amount is **that clause's score**, competing under
ADR-0043's winning-clause rule like any other line — never added to the product.
A card whose removal clause scores higher still reports the removal clause and
its own tuple. The larger of the two readings is taken, so a line that both makes
mana and does something bigger keeps the bigger reading.

| it reads | amount |
| --- | --- |
| `Add {C}`, `Add {G}{G}`, `Add {C}{C}{C}` | the length of the symbol run |
| `Add {W}{W}, {W}{U}, or {U}{U}` | the LONGEST run, because a choice gives you one |
| `Add two mana of any color`, `add one mana of any color` | the word |
| `Add X mana` | 1 — the card does not say how much |
| `search your library for a land card … onto the battlefield` | 1, always |

**Reach: 2,344 cards, 7.4% of the corpus** — 1,301 nonlands, 1,043 lands. It
reads 1 mana on 1,962 of them, 2 on 252, 3 on 82, and a tail to Ramos, Dragon
Engine's genuine 10.

**Gross, not net.** _"{1}, {T}: Add {G}{G}"_ nets one and produces two, and this
scores the two. `fixing.ts` nets, deliberately, because it ranks mana bases
against each other; this describes one card, and netting has no answer for a
ritual whose cost is the card's own casting cost.

It is a separate reading from `fixing.ts`'s private `addedMana`, which reads the
same phrasings for a different job. Reusing it would have read _"add two +1/+1
counters"_ as two mana — safe inside `fixing.ts`, which only ever runs on a
land's mana ability, and not safe corpus-wide.

### Taxes — `upkeep` persistence over `unbounded` breadth

A tax is a standing modification to what OTHER people's spells or abilities cost.
It has no trigger word and names no group the breadth rules count, so it used to
score 0.425 — the model floor — for Sphere of Resistance and for Thalia. Stakes
falls out of §22.6 normally. **55 cards** match.

| it reads | example |
| --- | --- |
| a cost increase on spells or abilities | _"spells cost {1} more to cast"_ |
| a cost floor | Trinisphere — _"each spell that would cost less than three mana to cast costs three mana to cast"_ |
| `whenever a player/an opponent casts … unless … pays` | Rhystic Study, Mystic Remora, Esper Sentinel |

Four exclusions, each bought with a card that was in the population and should
not have been:

- **`spells you cast`** — your own cost-reducer is the Quandrix `SPELL_GRANT`
  case at `triggered` (§22.5), not a tax. This is the boundary that matters:
  getting it wrong in the permissive direction turns every cost-reducer into a
  Sphere of Resistance.
- **an activated ability** — Mavinda and Loreseeker's Stone charge more for
  their OWN ability. A tax is static, and no genuine tax sits behind a colon.
- **a temporary tax** — Elspeth Conquers Death's chapter ii taxes for a turn,
  and `upkeep` means nothing recurs and there is nothing to wait for.
- **`this way`** — Elite Spellbinder charges {2} more for the one card it just
  exiled, which reaches one card and not a board.

**The near-disaster, recorded.** A bare `unless … pays` is not a tax rule; it is
the templating of a **soft counterspell**. It caught 143 cards, mostly Daze,
Censor, Syncopate and Mystical Dispute, and would have given Daze `unbounded`
breadth and a score of **7.2 against hard Counterspell's 1.2**. It was caught by
dumping the population and reading it, not by reasoning about the pattern.
