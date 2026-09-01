# 29. Dealing damage is its own event

Date: 2026-09-01

## Status

Accepted.

> **Number 0029 is taken by this ADR.** 0024–0028 are taken; 0027 was claimed by
> a concurrent agent. The next agent should take 0030.

## Context

A user reported one sentence about one card:

> "nicol bolas has more semantics that should have been parsed on his
> planeswalker side"

`Nicol Bolas, the Ravager // Nicol Bolas, the Arisen`, back face, verbatim from
the corpus:

```
+2: Draw two cards.
−3: Nicol Bolas deals 10 damage to target creature or planeswalker.
−4: Put target creature or planeswalker card from a graveyard onto the battlefield
    under your control.
−12: Exile all but the bottom card of target player's library.
```

Derived before this change: `produces: ['card-draw', 'opponent-discard']`,
`wants: []`. Only the `+2` was read; `opponent-discard` comes from the front
face. Three of his four abilities said nothing at all.

**This is not a two-faced-card bug.** `deriveSynergy` already reads every face
and already prefixes the type line to each, and the docstring on that function
records the measurement: 0 of 825 multi-faced commander-legal cards derive
differently split than joined. It is two rule-class gaps that happen to meet on
one card, and Bolas is the reporter rather than the requirement.

### Gap 1 — most of the damage in Magic was invisible

[ADR-0023](0023-damage-is-not-life-loss.md) built `player-damage` for damage
aimed at a face, which was the right half to build first and was only ever half.
1,269 commander-legal cards deal damage that can never reach a player — Flame
Slash, Blasphemous Act, Anger of the Gods, Pyroclasm, every fight spell, and
Bolas's `−3` — and not one of them said anything about it.

### Gap 2 — the reanimation rules were written around one verb

The diagnosis this change started from was that the `graveyard-creature` rules
assume "from **your** graveyard". **That was wrong, and checking is what
corrected it**: two of the three already accept `(your|a) graveyard`. What none
of them accepts is the other verb. Scryfall templates reanimation two ways —
"RETURN target creature card from a graveyard TO the battlefield" and "PUT target
creature card from a graveyard ONTO the battlefield" — and every rule in the file
was built on the first. Reanimate, Rise from the Grave, Beacon of Unrest,
Necromancy, Portal to Phyrexia, Debtors' Knell and Bolas's `−4` matched nothing.

### Gap 3 — milling and library exile are not modelled at all

Bolas's `−12` names an event no tag in `SYNERGY_TAGS` covers. §6 rules on it.

## Decision

### 1. One new `SynergyTag`: `damage`

This is the contract change this ADR exists for (AGENTS.md R2). Additive; no
existing value moves or changes meaning. The vocabulary goes from 20 to 21.

The event is **a source deals damage to something**, and it is deliberately
subject-agnostic — a doubler doubles it and an enrage trigger notices it
wherever it landed.

**The rejected alternative was folding damage into `creature-death`**, and it was
written and measured before being thrown away, so the reasoning is worth keeping.
"Destroy target creature" always kills; "deals 3 damage to target creature" kills
only if toughness is 3 or less, and the card cannot know. Over the 17,514
commander-legal creatures that print a numeric toughness:

| damage | creatures it kills | share |
| ---: | ---: | ---: |
| 1 | 3,777 | 21.6% |
| 2 | 8,176 | 46.7% |
| 3 | 12,181 | 69.6% |
| 4 | 15,005 | 85.7% |
| 5 | 16,366 | 93.4% |
| 10 | 17,480 | 99.8% |

That is a slope, not a boundary. A threshold on it — 4 was the candidate, on the
argument that this file already dropped "fights target creature" at "about 70%
precision" and 3 measures 69.6% — makes the producer promise a death the card
does not promise, and buries a modelling judgement inside a regex. The user's
ruling is the correct one and it is the same ruling ADR-0023 made one event over:
damage is not life loss, and it is not creature death either.

**A tag scoped to permanents was also rejected**, and its rejection was already
on file. ADR-0023's found-and-not-done list says a `permanent-damage` event
"would be the honest fix and nothing would pay it off". Read subject-agnostically
that stops being true — §4 measures the payoff class at 213 commander-legal
cards — and a permanent-scoped tag would additionally have split the amplifiers,
which are the largest payoff shape and mostly do not name a subject at all.

### 2. The boundary against `player-damage`: strict containment

`player-damage` is not replaced and does not change. It is now the strictly
narrower event, and "strictly" is measured, not asserted:

> **All 1,576 commander-legal `player-damage` producers also produce `damage`.
> Zero exceptions, checked card by card.**

| card | `damage` | `player-damage` |
| --- | :-: | :-: |
| Lightning Bolt — "3 damage to any target" | ✔ | ✔ |
| Impact Tremors — "1 damage to each opponent" | ✔ | ✔ |
| Flame Slash — "4 damage to target creature" | ✔ | — |
| Bolas `−3` — "10 damage to target creature or planeswalker" | ✔ | — |
| Exsanguinate — "each opponent loses X life" | — | — |

`player-damage` is kept rather than absorbed because it alone carries ADR-0023's
one-way bridge to `lifeloss`: "whenever an opponent loses life" is satisfied by a
Lightning Bolt and not by a Flame Slash, and only the narrower tag can say so.
Merging them would put back the conflation that ADR exists to refuse.

**"Any target" produces both**, keeping ADR-0023 §4's ruling intact. That rule
asked whether a card can be pointed at a face; this one asks whether it deals
damage. Both answers are yes for a Bolt, and a card is allowed to name two
events — ADR-0022 ruled exactly that about "each player discards".

### 3. "Spells" is a description, not a restriction

The user's words were "spells that do damage", and the coordinator asked whether
that is a real boundary. Measured, it is not, and the name reflects the boundary
that was actually drawn:

- **1,158 of the 2,741 commander-legal producers (42.2%) are instants or
  sorceries.** A spell restriction would refuse the majority of the class.
- **Only 7 of the 48 amplifier payoffs restrict the source to an instant or
  sorcery** (Fire Servant, Pyromancer's Swath, Obosh…). The other 41 — Furnace
  of Rath, Fiery Emancipation, Torbran, Gratuitous Violence — say "a source you
  control" and mean it.
- **The card that prompted this ADR is a planeswalker loyalty ability.** A
  `spell-damage` tag would have missed the report it came from.

So the tag is `damage` and not `spell-damage`. The archetype connection is
carried where it belongs, as an `INTERACTION_PAIRS` entry with `spell-cast`.

### 4. The payoffs, in four shapes

A tag nobody's deck wants is a label rather than a semantic. This one is wanted
by **213 commander-legal cards**, and each shape gets its own rule because each
is a different card:

| shape | rule reads | cards | examples |
| --- | --- | ---: | --- |
| enrage | `enrage`, "whenever this creature is dealt damage" | 63 | Ripjaw Raptor, Boros Reckoner, Stuffy Doll, Brash Taunter |
| the same trigger, elsewhere | "whenever a/another/equipped/enchanted creature is dealt damage" | 15 | Repercussion, Blazing Sunsteel, Fiendlash, Rite of Passage |
| amplifiers | "would deal damage … it deals double / triple / that much plus" | 48 | Fiery Emancipation, Furnace of Rath, Gratuitous Violence, City on Fire |
| excess and "a source you control" | `excess (noncombat) damage`, "whenever a source you control deals damage" | 46 | Toralf, Aegar, Tamanoa, Chandra's Incinerator, Quest for Pure Flame |
| damaged-already removal | "creature … dealt damage this turn" | 20 | Witch's Mist, Avenging Arrow, Fathom Fleet Cutthroat, Bitter Downfall |

**The amplifiers keep `player-damage` as well as gaining `damage`**, which is
one sentence naming two events — ADR-0022's ruling about "each player discards",
applied unchanged. ADR-0023 had to write that rule requiring the damage to land
on a player because `player-damage` was the only damage tag there was; the cards
themselves mostly say "a permanent or player".

Three refusals are inherited from ADR-0023 and asserted as negative tests:
prevention that reads like amplification (Ghosts of the Innocent, Battletide
Alchemist), payoffs whose source can only be the card itself (Curiosity), and
combat damage.

**Bloodthirst goes to `player-damage`, not to `damage`.** Its reminder text
reads "if an OPPONENT was dealt damage this turn", so a Flame Slash aimed at a
creature does not turn it on. 24 cards, and they were the whole of that tag's
change.

### 5. Two `INTERACTION_PAIRS` entries, four refusals

**`damage` ↔ `creature-death` is the pair this ADR exists to place**, and placing
it in the table rather than in the rules *is* the decision. Lethal damage
destroys a creature (CR 704.5g), but "lethal" depends on a toughness the card
cannot see, and the table above shows there is no point on that slope where a
producer could honestly promise a death. A pair claims the weaker, true thing:
these two events feed each other. Burn is how a death-trigger deck gets deaths
without a sacrifice outlet, and a Blood Artist is what makes a burn spell worth
more than its damage.

The unordered table can carry this because it already carries the same shape.
`creature-death` ↔ `graveyard-creature` is one-way in the mechanics — deaths fill
a yard, a yard causes no deaths — and reads true in both directions in English,
which is the bar this table sets. The same is true here.

**`damage` ↔ `spell-cast`** follows `player-damage`'s pairing on stronger
evidence than ADR-0023 had: 1,158 of 2,741 producers are instants or sorceries,
against the 489 of 1,576 that ADR counted.

Refused, all four asserted as negative tests:

- **`damage` ↔ `player-damage`.** One is a strict subset of the other, and a tag
  does not feed itself. This is ADR-0022's `discard` ↔ `opponent-discard`
  refusal, one event over.
- **`damage` ↔ `lifeloss`.** ADR-0023 exists to refuse this and nothing here
  changes it. A drain spell still deals no damage.
- **`damage` ↔ `attack-trigger`.** Combat damage is the event the producer rules
  are built to exclude.
- **`damage` ↔ `plus1-counter`**, considered on the strength of the enrage
  dinosaurs, which almost all grow when damaged. That pairs a trigger CONDITION
  with an effect, which ADR-0023 already ruled is not a relation between events
  at all — admit it and every condition pairs with every effect.

### 6. No `mill` or library-exile tag, and the `−12` stays silent

Bolas's ultimate exiles a library. Nothing in `SYNERGY_TAGS` covers it, and this
ADR deliberately leaves it that way.

- **The mill that has payoffs is already modelled.** `graveyard-creature`'s
  producer rule reads `mill N cards`, `you mill`, `each player mills` and
  `surveil N` — self-mill, which is what fills the yard a reanimator spends.
- **The other half has no payoff to pair with.** Milling an opponent fills
  *their* graveyard, and [ADR-0016](0016-synergy-coverage.md) ruled that an
  opponent's graveyard is not the resource this model tracks — a ruling ADR-0022
  reasserted when it refused `graveyard-creature` ↔ `opponent-discard` by name. A
  `mill` tag would need that exact pairing to be worth anything, so adding it
  means overturning two ADRs to make it non-inert.
- **83 commander-legal cards exile from a library.** Decking an opponent is a win
  condition rather than an event another card in the deck pays off, and this
  file's model is events. Bolas's `−12` wins the game; it does not feed anything.

The honest version of this gap is a `mill`/self-mill subject split with its own
sampling and its own pair argument. That is a whole ADR, and not this one.

### 7. Reanimation, in both directions, with the subject kept

Two rules, deliberately different widths.

**`produces creature-etb` reads any graveyard.** Whose yard the card came out of
does not change the fact that a creature entered the battlefield, which is all a
blink or enters-trigger deck asks for. 37 commander-legal cards.

**`wants graveyard-creature` reads only "a" or "your" graveyard.** ADR-0016 ruled
that an opponent's graveyard is not the resource; a card that can only rob theirs
is not evidence that a deck wants its own yard filled. That refuses 15 cards —
Sepulchral Primordial, Ink-Eyes, Zareth San, Gruesome Encore, Macabre Mockery.
"A graveyard" stays in because it includes yours.

Not restricted to creature cards, for the reason the neighbouring rules give:
this tag has meant the graveyard as a resource since `delve` and `threshold` were
added to it, and Restore, Nomad Mythmaker and Soul of Windgrace recur a land or
an Aura for the same deck.

### 8. The model's vocabulary and the search box's vocabulary diverge, on purpose

This is new and is worth saying plainly, because it is the first time.

`apps/web/src/tags.ts` writes every label to slot after "causes" or "benefits
from" — `token` → "making tokens", `lifegain` → "gaining life". Every internal
tag therefore has to name an **event**. `burn` is an archetype and fails that
sentence: "causes burn" reads wrong beside "causes making tokens".

But `burn` is the word a player types. So:

- **the tag is `damage`**, and its label is **"dealing damage"**, beside
  `player-damage` → **"damage to opponents"** (which was missing entirely and was
  falling through to the hyphen-stripping fallback — ADR-0023 flagged it and
  could not fix it);
- **`burn` is a query VALUE alias**, in a new `TAG_ALIASES` map inside
  `normaliseTag`. `FIELD_ALIASES` above it already lets a user type `causes:` for
  `produces:`; this is the same established mechanism one level down. Because
  `normaliseTag` is the single choke point for both validation and evaluation,
  `produces:burn`, `wants:burn` and `tag:burn` all work from one entry.

It is one alias and deliberately not a synonym table. An alias is warranted where
the natural word for a thing is an archetype and the tag must be an event; that
is one tag today, and each future one should have to argue. A near-miss
(`tag:burnn`, `tag:aristocrats`) is still an error, which matters because an
unvalidated term is dropped from the AST and an empty AST matches everything.

Both halves are pinned by tests, including a new `apps/web/src/tags.test.ts` that
asserts **every** tag in `SYNERGY_TAGS` has words — the file had no test at all,
which is how three tags came to be missing from it before.

## Measurement

Derived over the full stored corpus — 34,492 cards, 31,782 commander-legal —
with the real `deriveSynergy`, before and after. Nothing was estimated.

| tag | direction | corpus before → after | commander-legal before → after |
| --- | --- | --- | --- |
| **`damage`** | produces | 0 → **2,941** | 0 → **2,741** |
| **`damage`** | wants | 0 → **229** | 0 → **213** |
| `player-damage` | wants | 64 → 88 (+24, all bloodthirst) | 59 → 83 |
| `creature-etb` | produces | 391 → 428 (+37) | 367 → 403 |
| `graveyard-creature` | wants | 1,566 → 1,607 (+41) | 1,460 → 1,499 |
| `player-damage` | produces | 1,709 → 1,709 (unchanged) | 1,576 → 1,576 |
| `creature-death` | produces | 1,234 → 1,234 (unchanged) | 1,161 → 1,161 |

**No other tag moves by a single card in either direction, and nothing loses a
tag** — checked for all 21 tags, both directions, over all 34,492 cards. Cards
with no tag at all fall from 5,621 to 5,492; **129 cards go from a completely
empty profile to a tag**, led by Electryte, Crater Elemental, Skarrgan Hellkite,
Jeska, Thrice Reborn and Arms Dealer.

`creature-death` not moving is the ruling made visible: the rejected version of
this change moved it by +487.

### Precision, read by hand

**82 cards read one by one across four samples.**

| sample | read | correct | notes |
| --- | ---: | ---: | --- |
| `damage` produces, seeded from the additions | 20 | **20** | Flame Slash, Abrade, Arc Lightning, Fiery Cannonade, Sword of Fire and Ice, Tephraderm, Nicol Bolas Planeswalker |
| `damage` wants, seeded from the additions | 22 | **19** | 3 are enrage-shaped drawbacks — Phyrexian Negator, Jagged Poppet, Volatile Rig. Same class as ADR-0016's Alabaster Dragon: the card genuinely cares about being damaged, it just does not enjoy it |
| `player-damage` wants additions | 24 | **24** | all 24 are bloodthirst, read in full rather than sampled |
| reanimation, both rules | 81 | **80** | read in full: 44 on the `wants` side, 37 on `creature-etb`. §"one borderline" below |

Earlier drafts also read all 11 distinct clause shapes of the rejected targeted
rule and all 23 of the rejected sweeper rule, plus 9 cards whose damage clause
sits inside a trigger condition — Needletooth Raptor, Mage-Ring Responder,
Balefire Dragon, Lord of Shatterskull Pass — checked specifically for the
direction inversion this file calls its worst error. All nine are producers whose
damage is the *effect* of a trigger. No inversion.

**One borderline is kept and named.** Tergrid's Lantern reads "put that card from
**a** graveyard onto the battlefield", so she gains `wants graveyard-creature` on
a card that robs opponents. It reads right anyway — `graveyard-creature` pairs
with `discard`, and making opponents discard permanents into their yards to steal
them is precisely what Tergrid does — but it is a judgement, and it is 1 card
in 44.

### The counter-examples that were hunted

| hunted | cards | verdict |
| --- | ---: | --- |
| damage a card deals **to you** as a cost | 105 | **refused.** Ancient Tomb, Mana Vault, the painlands, the Talismans. ADR-0023 §6's ruling one subject over: their damage is a cost, not a plan |
| combat damage | 751 | refused, and without a word about it. Scryfall's combat trigger states no amount, so "combat" sits where the rule wants a number |
| a combat trigger whose EFFECT is noncombat damage | 20 | **admitted.** Balefire Dragon, Questing Beast, Sword of Fire and Ice. The clause is the unit, not the card (ADR-0023 §3) |
| **trample's reminder text** | 176 | **refused, and it was a live bug.** "(This creature can deal excess COMBAT damage to the player…)" — a permissive adjective gap in the excess-damage rule made every trample creature a burn payoff. Colossal Dreadmaw is the card that caught it, and it is now a test |
| damage prevention, "prevent the next N damage" | 8 | refused — never says "deals" |
| replacement effects that REDUCE damage | 2 | **admitted, and named as false positives.** Divine Presence and Forethought Amulet read "it deals 3 damage … instead" of 4. 2 in 2,741 is 0.07%, and a clause for two cards costs more than it saves |
| self-damage as `itself` rather than `you` | 1 | an `itself` exclusion was written and dropped: it moved one card, and a branch no test can fail on is machinery |
| reanimation from an opponent's graveyard only | 15 | `creature-etb` yes, `graveyard-creature` no (§7) |

One measured cost is accepted rather than engineered around: **Sorrow's Path**,
"deals 2 damage to you and each creature you control", is refused by the "to you"
lookahead even though it sweeps. One card, against a nested lookahead no test
could pin.

### Tests, and the mutants they killed

**25 mutants, 25 killed, 0 survivors.** Each mutant is a single-line exact
replacement; the harness asserts the anchor occurs exactly once and that the file
content actually changed, and refuses to report a verdict otherwise. That check
exists because a concurrent agent's first mutation pass reported five survivors
that were all false — this repo's working tree is CRLF and a multi-line pattern
had silently matched nothing, so the mutant was never applied.

Killed: every branch of the three producer rules (`\d+`, `X`, `that much`, the
"to you" refusal, the trailing-amount rule, the divided rule); all five payoff
rules, removed and — where they have one — widened; the trample-shaped widening
of the excess rule; bloodthirst; both new pair entries, plus adding the refused
`damage` ↔ `player-damage`; dropping `damage` from `SYNERGY_TAGS`; both
reanimation rules, removed and re-subjected in each direction; the `burn` alias,
removed and repointed at the wrong tag; and both new label entries.

## Consequences

- **A damage deck now reads as a damage deck.** 2,741 commander-legal cards
  produce the event and 213 pay it off, and neither number was reachable before.
  A creature-removal deck can be offered Fiery Emancipation; a Ripjaw Raptor deck
  can be offered a Flame Slash.
- **`SynergyTag` gains one member** (R2). Nothing switches exhaustively on it.
  `SYNERGY_TAG_VALUES` derives from `SYNERGY_TAGS`, so `tag:damage`,
  `produces:damage`, `wants:damage` — and `tag:burn` — all work with no further
  change. `apps/api/src/schemas.ts` derives its enum from the same constant.
- **`apps/web/src/tags.ts` gains two entries and its first test.**
- **The corpus must be re-ingested.** `synergy_produces` / `synergy_wants` are
  stored columns computed at ingest, so none of this reaches the app until then.
  **The ingest was not run as part of this change.**

### Found, and deliberately not done

- **A `mill` tag** — §6. It needs a subject split and its own pair argument.
- **`lifeloss` still has ADR-0022's subject defect**, unchanged by this ADR and
  still the last tag that has it.
- **`creature-death` has no subject split either.** "Destroy all creatures" hits
  your board and theirs, and a Zulaport Cutthroat deck cares about the first
  while a Blood Artist deck cares about both. Untouched here, and now visible
  from a second angle: `damage` ↔ `creature-death` inherits the same blur.
- **Damage to a planeswalker is still not modelled as its own thing**, which
  ADR-0023 also noted. `damage` now covers it as damage, which is a better
  silence than the previous one.
- **The two damage-reducing replacement effects** (Divine Presence, Forethought
  Amulet) produce `damage` and should not. Named so the next audit does not have
  to rediscover them.
- **`interactsWith` still has no direction**, and this ADR routes around it for
  the second time — `damage` ↔ `creature-death` is one-way in the mechanics, like
  `creature-death` ↔ `graveyard-creature` before it. ADR-0023 said that if a
  second one-way relation showed up the honest answer would be an ordered table
  plus a symmetric view for the UI. This is the third. It is now overdue.
