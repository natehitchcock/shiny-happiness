# 23. Damage is not life loss

Date: 2026-08-31

## Status

Accepted.

> **Number 0023 is taken by this ADR.** 0022 is the synergy subject split, dated
> the same day; 0021 is card art. The next agent should take 0024.

## Context

A user reported one sentence:

> "damage is not life loss, they are separate effects"

They are right, and there was an explicit rule doing the conflation, in
[`synergy.ts`](../../packages/domain/src/synergy.ts):

```ts
{
  tag: 'lifeloss',
  test: /\bdeals \d+ damage to (target player|target opponent|each opponent|each player)\b|\bdeals damage to (target player|each opponent)\b/i,
},
```

Measured on the local Postgres corpus, 31,782 commander-legal cards:

| | count |
| --- | ---: |
| cards tagged `produces lifeloss` | 1,446 |
| of those, tagged only because of the damage rule | **384** |
| cards tagged `wants lifeloss` | 7 |

So Impact Tremors, Purphoros, God of the Forge and Manabarbs were reported as
drain. A burn deck read as a Vito deck, and the app would recommend Exsanguinate
to a Torbran player and call it a match.

The recall side was worse than the precision side, and nobody had counted it.
**Lightning Bolt derived `produces: ['spell-cast']` and nothing else.** Torbran,
Thane of Red Fell, Fiery Emancipation, Furnace of Rath and Angrath's Marauders
derived nothing at all in either direction. The tag that existed was wrong, and
the tag that would have been right did not exist.

### The nuance, which is what makes this not a rename

Damage dealt to a player causes that player to lose that much life (CR 120.3c).
So a payoff reading "whenever an opponent loses life" **does** trigger on a
Lightning Bolt — Exquisite Blood, Mindcrank, Bloodthirsty Conqueror and The
Master of Lake-town each print `(Damage causes loss of life.)` as reminder text
on the card. Vilis, Broker of Blood prints it too.

The reverse is false. A drain spell deals no damage, so Torbran doubles nothing
and Chandra's Spitfire never triggers.

This is therefore the same shape as [ADR-0022](0022-synergy-events-have-a-subject.md)'s
`discard`/`opponent-discard` split — one event doing two jobs — except that the
relationship between the two halves is **directional**.

## Decision

### 1. One new `SynergyTag`: `player-damage`

This is the contract change this ADR exists for (AGENTS.md R2). Additive; no
existing value moves or changes meaning.

| event | tag | cards |
| --- | --- | --- |
| a player's life total goes down | `lifeloss` — Exsanguinate, Zulaport Cutthroat, Torment of Hailfire | 1,062 produce |
| a source deals damage to a player | **`player-damage`** — Lightning Bolt, Impact Tremors, Manabarbs, Fireball | 1,576 produce |

Named `player-damage` and not `damage`, because most damage in Magic points at a
creature and that is removal, not burn. Not `burn`, because this file's model is
events and `burn` is a deck archetype. Not `noncombat-damage`, which would be
accurate about the producer rules and wrong about the payoffs — a damage doubler
doubles combat damage too.

### 2. The direction lives in the rules, not in `INTERACTION_PAIRS`

`INTERACTION_PAIRS` is documented as unordered on purpose:

> Written as unordered PAIRS rather than an adjacency map, so symmetry is
> structural. "A interacts with B but B does not interact with A" is not a thing
> that can be expressed here, and therefore not a thing that can drift.

**That is a good property and it was not weakened.** The pair table cannot say
"damage causes life loss but not the reverse", and it should not be taught to:
its one consumer, `TagChip` in `apps/web/src/App.tsx`, renders a pair as

> Benefits, and benefits from: …

which is symmetric in English as well as in the data. Adding
`['player-damage', 'lifeloss']` would put the reported conflation straight back
into the sentence the user reads.

So the entailment is carried by the **payoff rules**, which is the only side it
holds on:

```ts
// PRODUCES — three rules, all `player-damage`, none of them `lifeloss`.
{ tag: 'player-damage', test: /\bdeals (?:(?:\d+|X|that much) damage|…) to …/i },

// WANTS — the same sentence, claimed for both events.
{ tag: 'lifeloss',      test: /\bwhenever [^.,\n]{0,40}\blos[et]s? life\b/i },
{ tag: 'player-damage', test: /\bwhenever [^.,\n]{0,40}\b(?:an opponent|a player|…) los[et]s? life\b/i },
```

A card that deals damage produces `player-damage` and never `lifeloss`. A card
that pays off an opponent losing life wants **both**. Read across
`synergyMatches`, that is exactly the asymmetry:

| deck | candidate | before | after |
| --- | --- | --- | --- |
| Exquisite Blood (wants life loss) | Lightning Bolt | no match at all | `enables player-damage` ✔ |
| burn (produces damage) | Exquisite Blood | no match | `payoff player-damage` ✔ |
| Exsanguinate (produces life loss) | Torbran | no match | still no match ✔ |
| Exsanguinate | Exquisite Blood | `payoff lifeloss` | `payoff lifeloss` ✔ |

There is precedent inside the file for one sentence claiming two tags: ADR-0022
ruled that "each player discards" matches `discard` **and** `opponent-discard`,
because one event is genuinely two events. This is the same move made once
rather than twice — one payoff, two events that satisfy it.

**Answering the question directly: no, a damage-to-player card does not keep
`lifeloss`.** Keeping it would leave `produces lifeloss` at 1,446 and fix
nothing; the user's complaint is precisely that the producer side lies. The
payoff side alone carries the bridge, and it is enough, because `synergyMatches`
only ever pairs a produce against a want.

### 3. Combat damage is out, and the exclusion is per clause

751 cards carry "deals combat damage to a player". None is a burn card, all are
attack triggers, and `attack-trigger` already owns the event — it has a rule for
exactly this wording. Admitting them would have given `player-damage` the
`untap` disease documented in [the audit](../synergy-audit.md) §2: a tag so
common that every deck reports it.

The rules exclude combat without mentioning it. Scryfall's combat trigger never
states an amount, so the word "combat" occupies the position the producer rule
requires a number in — `deals 3 damage`, `deals X damage`, `deals damage equal
to`. Nothing further was needed, which was checked rather than assumed.

**A card-level "does it say combat damage" exclusion was tried and rejected on
two cards**: Kediss, Emberclaw Familiar and Amarant Coral, whose trigger is
combat damage and whose *effect* is noncombat damage to every other opponent.
The clause is the unit, not the card. Both are in the test file.

### 4. "Any target" is now IN, reversing the old rule's note

The rule this replaces carried:

> Deliberately not "any target", which as often points at a creature and takes
> nobody's life total with it.

That was right for `lifeloss` and wrong here. "Any target" is the archetypal burn
template — 548 cards, sampled 25 and read by hand, all burn: Tarfire,
Staggershock, Skewer the Critics, Rekindled Flame, Prodigal Sorcerer. The
question this tag asks is whether the card can be pointed at a face, not whether
it always is.

### 5. Rules and scores

Validated the way [`fixing.ts`](../../packages/domain/src/fixing.ts)'s
enters-tapped rule and ADR-0022's four rules were: a hand-picked set of cards
that MUST and MUST NOT match, run against the stored corpus, plus a seeded
sample of each rule's hits read one by one.

| tag | direction | corpus | sampled | correct | precision |
| --- | --- | ---: | ---: | ---: | --- |
| `player-damage` | produces | 1,576 | 55 (two seeds) | 55 | **100%** |
| `player-damage` | wants | 59 | 59 (all) | 59 lenient / 57 strict | **100% / 97%** |
| `lifeloss` | wants | 19 | 19 (all) | 19 | **100%** (was 88%) |

**65 hand-picked must/must-not cases, 0 failures.** The two strict misses on the
payoff side are Uncivil Unrest and Anthem of Rakdos, creature-source doublers
that mostly double combat damage; they are literally damage amplifiers and are
kept.

`lifeloss`'s payoff rule gained the ADR-0022 comma boundary and lost its
requirement for the third-person verb, because the bridge is a strict subset of
it and a broken base makes an incoherent subset.

26 cards in the corpus put "whenever" and "loses life" in one sentence. 19 are
payoffs; the other 7 are **producers wearing a payoff sentence** — Within Range,
Graveblade Marauder, Tomb Blade, Black Widow, Jaws of Defeat, Shriveling Rot and
Teval — and every one of the 7 carries a comma between the trigger and the loss:
"Whenever you attack, each opponent loses life". The boundary refuses all seven
and costs nothing.

Only one of the seven was reaching the old rule's 30-character gap, so **Within
Range is the only card in the corpus that loses `wants lifeloss`**, taking that
direction from 6 right out of 7 to 19 right out of 19. The 13 gained are led by
the ones that say "whenever *you lose* life" rather than "loses": Vilis,
Transcendence, Lich's Tomb, Oath of Lim-Dûl and eight more, plus Emet-Selch's
"whenever one or more opponents *lose* life".

### 6. The bridge stops at somebody else's life

12 of the 19 life-loss payoffs are about **your** life ("whenever you lose
life"), and they do **not** get `player-damage`. The producer rules tag damage
aimed at players and opponents and deliberately refuse "deals 2 damage to you",
so offering Vilis a Lightning Bolt would be a match on a life total the spell
never touches. The bridge covers the 7 third-person payoffs: Exquisite Blood,
Mindcrank, Bloodthirsty Conqueror, Valgavoth, Kefka, Emet-Selch and The Master
of Lake-town.

### 7. One interaction pair added, three refused

Added: **`player-damage` ↔ `spell-cast`.** 489 of the 1,576 producers are
instants or sorceries, and 58 cards spell the causation out in a single line —
"whenever you cast an instant or sorcery spell, this deals 2 damage to each
opponent" is Guttersnipe, Firebrand Archer, Electrostatic Field and Urabrask. A
burn deck is a spellslinger deck, read in either direction, which is the bar the
unordered table sets.

Refused:

- **`player-damage` ↔ `lifeloss`** — §2. This is the pairing the ADR exists to
  refuse.
- **`player-damage` ↔ `attack-trigger`** — combat damage is the event this tag is
  defined to exclude.
- **`player-damage` ↔ `creature-etb`** — considered on the strength of Impact
  Tremors and Purphoros and refused: what those cards pair is a trigger
  *condition* with an effect. Admit that and every condition pairs with every
  effect, which is not a relation between events at all.

All three refusals are asserted as negatives in the tests, so a later "obvious"
addition has to argue with a test rather than slip through.

## Consequences

### What happens to the 384

They keep a tag; they change which one. All 384 that lose `produces lifeloss`
gain `produces player-damage` — verified card by card, not sampled. **Nothing
becomes untagged.** 13 cards produce both, because they burn and drain in one
card (Nicol Bolas, the Deceiver: "+3: each opponent loses 3 life…", "−11: deals
7 damage to each opponent"), and claiming one and not the other would be false
whichever was picked.

The wider recall is the bigger number: **1,576 cards produce `player-damage`,
and 308 of them derived a completely empty `produces` before.** Lightning Bolt is
one of them.

Corpus-wide, **no tag other than `lifeloss` and `player-damage` moves by a single
card** — checked for all 18 other tags in both directions against the stored
profiles.

### Elsewhere

- **`SynergyTag` gains one member** (R2). Nothing switches exhaustively on it.
  `SYNERGY_TAG_VALUES` in `query/ast.ts` derives from `SYNERGY_TAGS`, so
  `tag:player-damage`, `produces:player-damage` and `wants:player-damage` all
  work in search with no further change.
- **`apps/web/src/tags.ts` needs one entry, and this ADR does not add it** —
  `apps/web` is owned by another agent this cycle. Until it lands, `readable`
  falls through to its hyphen-stripping fallback and the chip reads "player
  damage", which is legible but is the wire spelling. The entry wanted is
  `'player-damage': 'damage to opponents'`. `lifeloss` is currently worded
  `'opponents losing life'` and should stay that way — it is now the only tag
  that means it.
- **The corpus must be re-ingested.** `synergy_produces` / `synergy_wants` are
  stored columns computed at ingest, so none of this reaches the app until then.
  **The ingest was not run as part of this change.**
- This does not make the heuristics correct, and ADR-0011's point stands: the
  curated override table is still the answer for a card that reads wrong.

### Found, and deliberately not done

- **`lifeloss` has ADR-0022's subject defect and it is now the last tag that
  does.** `\bloses? (\d+|X) life\b` matches "you lose 3 life" and "each opponent
  loses 3 life" identically, so Necropotence's drawback and Exsanguinate's win
  condition are one tag. That is the same bug the discard split fixed, one tag
  over, and it is a whole ADR of its own — a producer split needs its own
  sampling, and it would move the 1,062 number this ADR just measured.
- **"For each 1 life your opponents have lost this turn" is an unclaimed
  life-loss payoff.** Neheb, the Eternal is the famous one. The wording never
  says "whenever", so no rule in this file can see it.
- **Damage to a planeswalker is not modelled at all.** "Deals 3 damage to target
  player or planeswalker" is tagged on the player half and says nothing about
  the other, which is correct but silent.
- **Toralf, God of Fury wants damage to a permanent, not to a player**, so it
  gets `produces player-damage` (its Hammer really does burn a face) and not
  `wants`. It is a burn commander that this tag half-describes. A
  `permanent-damage` event would be the honest fix and nothing would pay it off.
- **Malcolm and Breeches were refused** as damage payoffs: "whenever one or more
  Pirates you control deal damage to your opponents" restricts the source to
  your creatures, so a burn spell cannot supply it. Named here so the next audit
  does not have to rediscover the ruling.
- **`interactsWith` still has no direction, and now has a reason to want one.**
  This ADR routes around it deliberately; if a second one-way relation shows up,
  the honest answer is an ordered table plus a symmetric view for the UI, not a
  second workaround.
