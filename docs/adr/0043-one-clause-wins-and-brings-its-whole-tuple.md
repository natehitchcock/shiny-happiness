# 43. One clause wins, and it brings its whole tuple

Date: 2026-09-01

## Status

Accepted.

> **Number 0043 was assigned, not chosen.** The ADR directory was deliberately
> not listed to find "the next free number" — that is how 0027 got claimed twice
> and how 0038 records the same hazard. The next agent should take 0044.
>
> While writing this, 0039 was found NOT to exist: 0038 ends by saying "the next
> agent should take 0039", 0040 is the next file on disk, and nothing in the tree
> references 0039. The audit whose conclusion this ADR acts on was real — its
> headline measurement, Diregraf Captain at 15.96, reproduces exactly — but it
> was never written down. That is recorded here so nobody hunts for it again.

## Context

The report:

> "Quandrix the Proof gives spells cascade, shouldn't that mean that his reach is
> every spell cast? Or he repeats every spell cast?"

`Quandrix, the Proof`, verbatim from the corpus:

```
Legendary Creature — Elder Dragon        {4}{G}{U}

Flying, trample
Cascade (When you cast this spell, exile cards from the top of your library
until you exile a nonland card that costs less. …)
Instant and sorcery spells you cast from your hand have cascade.
```

Scored **0.425** — `none / one-shot / self`, the model's exact floor, the same
number as a creature whose only text is a keyword, below Sol Ring's 0.68.

The question is which axis, and it turned out to have a measured answer rather
than a taste. Underneath it sat the structural limit the missing audit named:
one tier per card, chosen per axis, lets a card report a combination no single
clause of it produces.

## Decision

### 1. One clause wins, and it brings its whole tuple

The product owner's rule:

> "when it comes to choosing one tier per card, choose all the tiers from the
> highest impact effect"

So: score every ability line as a complete `breadth × persistence × stakes ×
symmetry`, and the card reports **the winning line's tiers together**. Never the
maximum of each axis taken independently.

`Diregraf Captain` is the case that names the defect:

```
Deathtouch
Other Zombie creatures you control get +1/+1.
Whenever another Zombie you control dies, target opponent loses 1 life.
```

| clause | tuple | score |
| --- | --- | ---: |
| `deathtouch` | none / one-shot / self | 0.425 |
| the lord clause | unbounded / one-shot / own / one-sided | **6.0** |
| the drain clause | one / triggered / player | 2.66 |

It used to report `unbounded` (from the lord) × `triggered` and `player` (from
the drain) = **15.96**, above Wrath of God, for a three-mana lord. No line of the
card is a board-wide effect aimed at a life total. It now reports 6.0 — which is
what `Glorious Anthem` and `Knight Exemplar` score, because it is the same card.

**The unit is the ability line**, newline-separated, and that is ADR-0038's
reasoning reused rather than freshly invented: every pattern in `impact.ts` is
written `.` or `[^…\n]`, and JavaScript's `.` does not match a newline, so each
rule is already confined to one line by construction. A line scored in isolation
gives exactly the answer it gave in card context. A sentence split could promise
no such thing — Wrath of God's two sentences share a line, and *"They can't be
regenerated"* alone is not a board wipe.

Splitting happens **after** `normalise`, so reminder text can never become a
clause of its own. The type line is not a clause and is not scored.

Two facts stay card-level, with reasons rather than by omission:

- **`fragile`** — when the card sacrifices itself, *every* one of its lines
  stops. Pinning only the line that spells the sacrifice would price the rest of
  the card as an engine it no longer has. Viridian Zealot is a Naturalize with a
  body however you split it.
- **the instant/sorcery pin** — a property of the type line, applied to all lines.

### 2. A static grant to a class of your future spells is `triggered`

**Persistence, not breadth**, and three measurements decided it.

**Teval, Arbiter of Virtue carries both spellings at once:**

```
Flying, lifelink
Spells you cast have delve.
Whenever you cast a spell, you lose life equal to its mana value.
```

Teval already scored `none / triggered / self`, entirely off the second clause —
a *drawback*. Breadth and stakes already agreed between the static and triggered
spellings of "an effect that happens once per spell you cast". **Persistence was
the only axis that differed**, and it differed only because the static spelling
never says the word `whenever`, so the ladder fell through to `one-shot`.

**The ordering was inverted.** `Yidris, Maelstrom Wielder` grants cascade only
after connecting in combat, and only for that turn: 0.808. Quandrix grants it
unconditionally, every turn, for the rest of the game: 0.425. The strictly
conditional card outranked the unconditional one, and the whole difference was
one word.

**The breadth reading already exists in the corpus, and it is already wrong.**
See §3.

`triggered` and not `upkeep`, because there is something to wait for: you must
cast a spell. That also lands the static spelling on exactly the tier the
triggered spelling already had, which is the point.

The `this turn` lookahead is load-bearing: 28 cards say "spells you cast **this
turn** cost {1} less", a one-turn effect hung off an attack trigger or a Saga
chapter. Promoting those would price a Saga chapter as a permanent engine.

### 3. A serial class of spells is never board-wide

Found while hunting counter-examples for §2, and it is the *breadth* reading of
the same report — already implemented by accident, and already producing wrong
numbers.

`MASS_QUANTIFIED` lists `spell` among the nouns a mass quantifier may take. That
is right for `counter all other spells`: those spells are on the stack together,
one effect touches all of them, the reach is real. It is wrong for `each spell
you cast`, where the spells arrive one at a time across the whole game and no
effect ever touches two.

| card | was | is |
| --- | ---: | ---: |
| `Threefold Signal` — "each spell you cast that's exactly three colors has replicate {3}" | **7.2** | 0.808 |
| `Goblin Anarchomancer` — a 2-mana 2/2, "each spell you cast that's red or green costs {1} less" | **7.2** | 0.808 |
| `Seal of the Guildpact` | **7.2** | 0.808 |

7.2 is Cyclonic Rift's number, on cards that cannot touch an opponent at all —
the breadth error and the stakes error arrive together, because the stakes
ladder sends anything `unbounded` to `opposing` by default. This is the Colossal
Dreadmaw shape: a false positive at the top of the scale, invisible until the
whole corpus was diffed.

Five commander-legal cards say `each/every/all spell(s) you cast`. The eleven
genuine mass effects on the stack — Summary Dismissal, Swift Silence,
Trinisphere, Defense Grid, Damping Sphere — say no such thing and do not move.

## Consequences

### Measured, corpus-wide, over all 31,782 commander-legal cards

**1,902 cards moved (6.0%): 1,728 down, 174 up.** Mean impact 2.5109 → 2.3821.

| band | before | after |
| --- | ---: | ---: |
| 0 | 361 | 361 |
| 0–1 | 15,953 | 16,103 |
| 1–3 | 9,698 | 9,634 |
| 3–6 | 257 | 199 |
| 6–10 | 3,574 | 4,016 |
| 10–15 | 1,153 | 822 |
| 15+ | 786 | 647 |

The top of the scale deflates, which is the fix: 15+ falls by 139 cards and
10–15 by 331, and those are the cards that were assembling a tuple from clauses
that never met.

### The six regression anchors all hold, unmoved

| card | score |
| --- | ---: |
| Wrath of God | 6.12 |
| Craterhoof Behemoth | 6.0 |
| Sol Ring | 0.68 |
| basic Forest | 0 |
| Cyclonic Rift | 7.2 |
| Swords to Plowshares | 1.2 |

Craterhoof is the interesting one, because it carries both a counting shape and
an effect shape: `MEASURED` strips *"where X is the number of creatures you
control"*, `MASS_PLURAL` keeps *"creatures you control gain trample"*, and the
line scores 6.0 on its own. Cyclonic Rift's two lines score 1.2 and 7.2, and the
overload keyword — a line of its own — wins with `unbounded` intact.

### `IMPACT_MAX` does not move

Still **18.48**. No tier *value* changed; only which tier a clause lands in. The
mirror in `packages/ui/src/card/metrics.ts` needs no edit, and every rendered
"N of 18.48" keeps its denominator.

### `r` and the role bands must be regenerated

Impact is an input to efficiency. `statPointsPerImpactPoint` is fitted against
the mean impact of all creatures at each mana value, and that mean fell at every
mana value. Reusing the shipped gaps and recomputing only the mean gives an
estimated **r ≈ 0.4934, up ~6.7% from 0.4644** — the same benign direction as
last time: a smaller mean over the same measured gap.

`impact/by-role.data.json` is quartiles of `cardImpact().score` per role and
moves for the same reason.

```
pnpm --filter @roundtable/ingest baseline
pnpm --filter @roundtable/ingest impact-roles
```

### The 174 rises, stated rather than buried

Only **one** is caused by the new rules meeting an existing false positive:
`Saheeli, Filigree Master` 9.6 → 11.4, whose emblem puts an anthem and a spell
grant on a single line — a genuine limit of the newline unit, inherited from
ADR-0038 and not introduced here.

The other 173 are per-clause scoring removing a *mask*. A clause that says "all
X cards" with no "you control" in it now falls to `opposing`, where it used to
borrow `own` from a different clause. `Kaheera, the Orphanguard`'s companion
condition, `Summon: Titan`'s "return all land cards from your graveyard", and
`Risen Executioner`'s graveyard cost all read this way. The old answer was right
by accident; the new one is wrong for a reason that is now visible and
addressable — a **zone** clause is not a board. That is its own pass.

### Known and deliberately not fixed

`MEASURING_HEAD` admits `for each card type` but not plain `for each creature
you control`, so a clause that only **counts** still takes `unbounded` reach.
`Storm Entity`, a one-mana 1/1 whose whole text is *"enters with a +1/+1 counter
on it for each other spell cast this turn"*, scores 7.2 — above Wrath of God.
This is the Regal Bunnicorn defect on the nouns the head list never covered.

Widening the head list was **measured and rejected for this pass**: it moved
2,377 cards and introduced false negatives of its own, because `for each
opponent` is not a measurement but a distributive effect landing on people —
`Smuggler's Share` fell from 18.48 to 0.935, which is the Hallar regression
recorded in `MEASURED`'s docblock, on a different noun. It needs its own
counter-example hunt.

What *is* fixed is the narrow overlap where the new `triggered` reading would
have **multiplied** that false reach rather than replacing it: within a clause
the spell-grant rule already claimed, a trailing `for each <object>` is scaling,
not a second effect. Six cards carried both shapes; without it Locket of
Yesterdays would have gone 7.2 → 13.68.

### Two surviving mutations, both provably unobservable

Of 22 mutations, 20 were killed. The two survivors were checked against the
corpus rather than papered over with a test:

- dropping blank clauses — an empty clause scores 0.425, which is exactly the
  floor a real clause can reach, so it ties and never wins. Kept anyway, and the
  code says why.
- the rider's noun list excluding people — no clause in the corpus carries both
  a spell grant and a `for each opponent` rider. A redundant second guard in the
  intervening-word lookahead was **deleted** rather than left untestable.

### Handed off, not touched: the `spell-cast` semantics gap

`synergy.ts` belongs to another task and was not edited. The report also asked
whether `produces: []` on Quandrix is thin. Measured, and the answer splits:

**The producer side is correct as it stands.** `produces: 'spell-cast'` is
derived from one rule — `/^[^\n]*\b(Instant|Sorcery)\b/`, the type line — and
all **7,211** cards carrying the tag are instants or sorceries. The tag means
"this card IS the spell a prowess trigger waits for", not "this card causes
spells to be cast". Quandrix is a creature, so `produces: []` is right under
that definition, and widening it would make one tag mean two things — Quandrix
would then both produce and want `spell-cast`, satisfying itself.

There is a real argument on the other side, because cascade genuinely *does*
cast extra spells: **24** commander-legal cards grant cascade, storm, replicate
or conspire to your own spells and produce nothing, among them Maelstrom Nexus,
Wort, the Raidmother, Djinn Illuminatus and Rain of Riches. That is a
definitional decision for whoever owns the file, not a missing regex.

**The wants side has a plain gap, and it is the actionable half.** The rule
matches `instant and sorcery spells you cast` and a list of keywords, so it
catches Quandrix and misses the other spellings:

| population | count |
| --- | ---: |
| permanents granting something to `spells you cast` (the impact rule's population) | 251 |
| …carrying **no semantic at all** (`produces: []` and `wants: []`) | **66** |
| …not carrying `wants: 'spell-cast'` | 212 |
| cascade granters specifically | 7, of which 4 have no `spell-cast` want |

The 66 with nothing include Grand Arbiter Augustin IV, Urza, Lord Protector,
Goblin Warchief, Chief Engineer and Flamekin Herald — cards whose entire
function is modifying the spells you cast. Flamekin Herald says "Commander
spells you cast", Imoti says "spells you cast with mana value 6 or greater",
The First Sliver says "Sliver spells you cast": all the same clause, none
matched. This is exactly the ADR-0038 property — a semantic for every clause —
failing on a shape that clause-splitting has now made easy to name.

## Alternatives rejected

**Breadth for the cascade grant.** The argument was that a static grant over an
open-ended class *is* breadth because the class is unbounded. Tested and
rejected on evidence: where the model already does this — the 25 `each spell`
cards — it produces Threefold Signal at 7.2 with `opposing` stakes on a card
that only helps its controller. Handing Flamekin Herald, a three-mana 1/1 whose
grant reaches only commander spells, the same 6.0 as Craterhoof Behemoth is the
same error one step further. Breadth counts what one effect touches *at once*,
and no effect here ever touches two spells.

**Maximum per axis, kept.** That is the defect, not the design.

**Per-clause fragility.** Considered and rejected: the card leaving the
battlefield ends every clause, so it is genuinely card-level. It also preserves
the two Viridian Zealot and Masticore regressions already recorded.
