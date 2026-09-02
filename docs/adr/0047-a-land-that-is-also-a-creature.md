# 47. A land that is also a creature

Date: 2026-09-02

## Status

Accepted.

> **Number 0047 was allocated to this ADR by the coordinator.** The directory was
> not listed to pick it — reading it for "the next free number" is how 0027 got
> claimed twice.

## Context

One report, about one card:

> "ambush commander has no semantic tags. why is that?"

```
Ambush Commander            Creature — Elf

Forests you control are 1/1 green Elf creatures that are still lands.
{1}{G}, Sacrifice an Elf: Target creature gets +3/+3 until end of turn.
```

Two clauses, two different gaps.
[ADR-0038](0038-a-semantic-for-every-clause.md) fixed the second — the
`creature-death` producers all demanded the literal word "creature", and a tribal
outlet names a TYPE. This ADR is the first clause, which ADR-0038 measured,
recorded in its found-and-not-done, and could not land: it needs a new
`SynergyTag`, and R2 makes that an ADR-first change.

### The refusal that had to be made first

The tempting reading is `token` or `sacrifice-fodder`. It is wrong, and it is
wrong in the direction that does damage: those bodies are the player's MANA BASE.
Tagging them as fodder would offer Ashnod's Altar to a Sylvan Advocate deck and
call its lands expendable, which is the opposite of how that deck is played.

So the question is whether a NEW event is warranted, and
[ADR-0029](0029-dealing-damage-is-its-own-event.md) §6 already set the test: a
producer class with no payoff class is a tag that can never match. That is the
ground it refused a `mill` tag on, and that refusal was right.

**The test was applied expecting to refuse, and it passed.**

| | count |
| --- | ---: |
| producers — a land becomes, or arrives as, a creature | **187** |
| of those, NOT the Avatar set's `earthbend` keyword | **73+** |
| payoffs — text that only makes sense if your lands are creatures | **13** |

Thirteen is the smallest want-population of any tag, and it is the same order as
`lifeloss` (19) and `opponent-sacrifice` (15), both of which already exist. The
payoff phrasing is unambiguous — "land creatures you control get +1/+1" — and the
cards are spread across a decade rather than one set: Sylvan Advocate (2016),
Embodiment of Fury and Embodiment of Insight (2016), Halimar Tidecaller (2015),
Tatyova (2021), Jolrael (2022), Blossoming Tortoise (2023), Jyoti (2024), Toph,
Aang, Bumi, Earthbending Student, Earth Rumble Wrestlers.

## Decision

### 1. One new `SynergyTag`: `land-creature`

The contract change this ADR exists for (R2). Additive; no existing value moves or
changes meaning. The vocabulary goes from 21 to 22.

Named as an EVENT, not as the deck. "Manland" is what a player calls the deck, and
the tag names have to slot after "causes" in the UI — the same ruling `burn` got
in ADR-0029. `apps/web/src/tags.ts` renders it "lands becoming creatures", written
to sit beside `landfall`'s "lands entering".

### 2. Five producer rules, each measured by what it ALONE reaches

Counts are cards reached by that rule and no other, over the 31,782 commander-legal
cards:

| rule | only | example |
| --- | ---: | --- |
| `it's still a land` | 37 | Crawling Barrens, Genju of the Cedars, the Zendikons |
| `this/target/that/each <land> becomes a N/N` | 5 | Cavernous Maw, Elvish Branchbender |
| `lands you control are/become … creatures` | 5 | Ambush Commander, Kamahl's Will, Sylvan Awakening |
| `create … land creature token` | 3 | Awaken the Woods, Jyoti, Staff of Titania |
| `earthbend N` / `awaken N` | 3 | Earthbender Ascension, Earthshape |

**187 producers and 13 payoffs gained; ZERO tag assignments lost** anywhere in the
corpus, checked card by card. Clause coverage 48.0% → **48.2%**; cards with no tag
at all 4,542 → **4,537**.

### 3. Three pairs

- **`landfall`** — the same deck read from either end. More lands is more bodies,
  and a deck built to animate its mana base wants a lot of mana base.
- **`attack-trigger`** — what the payoffs are FOR. Every one of the thirteen grants
  vigilance, trample, flying or double strike, and nobody prints those on a
  permanent meant to stay home.
- **`plus1-counter`** — the strongest of the three and the least obvious. Earthbend
  N and awaken N BOTH turn the land into a **0/0** AND put N +1/+1 counters on it.
  The counters are the only reason the land survives the transformation, so this is
  two effects needing each other rather than the trigger-condition-and-effect
  confusion [ADR-0023](0023-damage-is-not-life-loss.md) refused.

**`token` and `sacrifice-fodder` are REFUSED**, and that refusal is the reason this
is a new tag rather than a widening of an old one. See the Context above.

### 4. The same tribal defect in `role-derivation.ts`

Found while fixing ADR-0038 and reported for handoff; it came back as this task's
second half. Both `sac-outlet` heuristics demanded the literal word "creature", so
Ambush Commander and Skirk Prospector fell to the `synergy` catch-all.

This matters more than the tag did. A role feeds the composition meters and
Quickbuild's gap selection, so a deck full of sacrifice outlets was being told it
had none.

The deny list and the missing `i` flag are ADR-0038's, for its reasons. **The colon
is the difference**, and it is deliberate: `creature-death` asks only whether a
creature dies, so it reads Goblin Grenade's "as an additional cost to cast this
spell, sacrifice a Goblin". A sac OUTLET is a repeatable engine you feed on demand,
and the colon is what says the sacrifice is the cost of an activated ability.

**A second defect fell out of it.** A test assertion written expecting Krark-Clan
Ironworks to already be a `sac-outlet` FAILED: the first heuristic listed
`(a|another)` and not `an`, and "artifact" is the one noun there that takes it.
**81 cards** — Arcbound Ravager, Atog, Bosh, Iron Golem, Defiant Salvager — were
catch-all `synergy` on one missing article. The same closed-list defect as the
tribal rule, one article wide instead of one noun wide.

| | count |
| --- | ---: |
| cards gaining `sac-outlet` | **170** |
| of those, leaving the `synergy` catch-all | **56** |
| cards whose PRIMARY role changes | **159** |
| roles lost that were not `synergy` | **0** |

All 95 tribal matches were read by hand and every one is a real outlet. The three
that are lands — Seaside Haven, Springjack Pasture, Starlit Sanctum — keep
`['land']` through the short-circuit in `deriveRoles`, so the land count stays
honest.

## Consequences

- **`SynergyTag` gains one member** (R2). Nothing switches exhaustively on it.
  `SYNERGY_TAG_VALUES` derives from `SYNERGY_TAGS`, so `tag:land-creature` and
  `produces:land-creature` work with no further change, and
  `apps/api/src/schemas.ts` derives its enum from the same constant.
- **`apps/web/src/tags.ts` gains one entry**, which its test requires.
- **The `SYNERGY_TAGS` length assertion in ADR-0029's block moves 21 → 22.** Kept
  as a count rather than softened to `toContain`: a vocabulary that grows without
  anyone noticing is how two tags come to mean the same event.
- **`roles` and `primary_role` are stored columns too**, so the role half needs the
  same card ingest as the tag half. One run does both.
- **The corpus must be re-ingested.** **The ingest was not run as part of this
  change.**

## Found, and deliberately not done

- **A `^[^\n]*\bLand\b[^\n]*\bCreature\b` type-line producer was REJECTED.** It
  reaches three cards and is wrong about two: Scryfall gives one JOINED type line
  per card, so "Land // Artifact Creature — Horror Construct" (Hostile Hostel) and
  "Land // Legendary Creature — Demon" (Westvale Abbey) read as land creatures when
  they are transforming lands whose halves never share a game state. Dryad Arbor is
  the only true one, and one card is not worth two wrong ones.
- **"It's still a CAVE land"** — an optional adjective in the `still` rule was
  measured and moves exactly one card, Cavernous Maw, which the `becomes` rule
  already reads. A rule that moves nothing is machinery.
- **Which guard refuses Hidden Herd was established by mutation, not by reading,
  and the obvious answer was wrong.** The P/T alone refuses Graceful Antelope and
  dies on its own. Hidden Herd is refused by the named subject and the 25-character
  gap TOGETHER, so neither is separately killable and the battery mutates the pair.
  Recorded because the next reader will otherwise go looking for a test that
  cannot exist.
- **`primaryRole` precedence was not touched.** 159 cards now lead with
  `sac-outlet` where they led with `spot-removal`, `evasion` or `token-maker`, and
  that follows from `ROLE_PRECEDENCE`, which is not this ADR's to change. If a
  Siege-Gang Commander should read as removal first, that is a precedence question.
