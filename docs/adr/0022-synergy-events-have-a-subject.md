# 22. Synergy events have a subject

Date: 2026-08-31

## Status

Accepted.

> Number 0022 is taken by this ADR. 0021 is card art; another agent may take
> 0023.

> **EXTENDED BY [ADR-0059](0059-a-window-has-an-anchor-and-an-event-has-a-subject.md).**
> This ADR's finding — that an event has a subject and that one tag cannot
> name two of them without lying about one — was applied to five further
> families that had never been asked the question. `lifegain`, `landfall`,
> `card-draw` and the `sacrifice-fodder` WANT lost their subject to the phrase
> "its controller" (ADR-0059 §3, 84 cards); `lifeloss` needed the harder
> answer this ADR gave `discard` — a second tag rather than a narrower rule
> (§4, `self-lifeloss`).

## Context

A user reported three things about Tergrid, God of Fright:

> "it seems that hopeless nightmare isn't tagged with causes discard, which is
> the primary synergy for half of tergrid… tergrid needs benefits from discard…
> and tergrid needs benefits from sacrifice. Why were those missed?"

…and then a fourth, which turned out to be the sharpest of the four:

> "tergrid also causes discard with her lantern side, so she does cause it as
> well"

All four are correct, and they are one defect. **The synergy model
([ADR-0011](0011-deck-shaping-controls.md)) names events but never names who the
event happens to.**

[ADR-0016](0016-synergy-coverage.md) §3 narrowed `discard` to self-discard on
purpose, and gave a good reason:

> `discard` no longer matches "target opponent discards two cards". That is a
> hand attack. It does not feed madness and it does not fill *your* graveyard,
> which is all this tag is paired with — 296 cards were being called discard
> enablers on the strength of a verb.

That reasoning is right about madness and looting. It is also the whole story of
how an entire Commander archetype was deleted: with only one `discard` tag, the
correct fix for the looting deck could only be spelled as the removal of the
hand-attack deck. Measured on the local corpus (31,782 commander-legal cards):

| | count |
| --- | --- |
| cards that make **opponents** discard | 481 |
| cards that pay off opponents discarding | 30 |
| self-discard producers the tag was tuned for | 1,199 |
| self-discard payoffs (madness, "whenever you discard") | 106 |

`sacrifice` fails identically and worse. `sacrifice-fodder`'s only producer rule
is `/\bsacrifice (a|another|an) creature\b/` — the imperative, addressed to you —
and its payoff is a sacrifice outlet eating your own board. "Whenever an opponent
sacrifices" was not expressible at all, so **Tergrid's front face, the entire
reason to play the card, contributed nothing**.

What the four reported cards derived to before this change:

| card | produces | wants |
| --- | --- | --- |
| Hopeless Nightmare | `enchantment-etb`, `lifeloss` | — |
| Mind Rot | `spell-cast` | — |
| Thoughtseize | `lifeloss`, `spell-cast` | — |
| Tergrid // Tergrid's Lantern | `artifact-etb`, `lifeloss`, **`discard`** | `untap` |

Tergrid's single `discard` was not merely on the wrong side. It came from the
punisher clause on the *Lantern* — "…unless they sacrifice a nonland permanent of
their choice **or discard a card**" — where the verb is a bare infinitive only
because its subject is "they". The rule read it as addressed to the caster. So
the app reported Tergrid as a card that loots its own hand, and reported nothing
at all about the ability that makes her a commander.

## Decision

### 1. Two new `SynergyTag` values, splitting two existing tags by subject

`opponent-discard` and `opponent-sacrifice`. This is the contract change this
ADR exists for. Both are additive; no existing value moves or changes meaning.

| event | yours | theirs |
| --- | --- | --- |
| a card leaves a hand | `discard` — loot, rummage, madness | **`opponent-discard`** — Mind Rot, Thoughtseize, Hopeless Nightmare |
| a permanent is sacrificed | `sacrifice-fodder` — aristocrats | **`opponent-sacrifice`** — Diabolic Edict, Fleshbag Marauder, Grave Pact |

The split is readable because Scryfall templating names the subject and inflects
the verb: a bare "discard a card" is addressed to you, and "<somebody> discards a
card" is addressed to them. **The rules ask for a third-person subject, not for
the word "discard".** That is also what keeps a card that eats its own tokens out
of `opponent-sacrifice`.

`each player discards` and `each player sacrifices` match **both** tags. A wheel
empties your hand and theirs; a symmetric edict kills your creature and theirs.
Claiming one and not the other would be false whichever one you picked.

### 2. Four rules, and what they score

Validated the way [`fixing.ts`](../../packages/domain/src/fixing.ts)'s
enters-tapped rule was: a hand-picked set of cards that MUST and MUST NOT match,
run against the real corpus, plus a spread sample of every rule's hits read one
by one.

| tag | direction | corpus | sampled | correct | precision |
| --- | --- | ---: | ---: | ---: | --- |
| `opponent-discard` | produces | 481 | 25 | 25 | **100%** |
| `opponent-discard` | wants | 30 | 30 (all) | 29 | **97%** |
| `opponent-sacrifice` | produces | 304 | 25 | 25 | **100%** |
| `opponent-sacrifice` | wants | 15 | 15 (all) | 15 | **100%** |

46 hand-picked must/must-not cases, 0 failures. The one `wants` miss is Ghirapur
Orrery, whose "if that player has no cards in hand, that player draws three
cards" is a hand *refill*, the opposite of the payoff.

Two rules span a gap rather than requiring adjacency, and the gap class matters:

- **`[^.\n]{0,60}` on the producer side**, because the punisher template puts the
  two events either side of an "or": "loses 3 life unless they sacrifice a
  nonland permanent of their choice **or discard a card**". That template *is*
  Tergrid's Lantern. An adjacency rule reads straight past it.
- **`[^.,\n]{0,60}` on the payoff side** — a comma as well as a full stop,
  because the comma is where a trigger condition ends. Tergrid reads "whenever an
  opponent sacrifices a nontoken permanent or discards a permanent card," (one
  condition, two events, no comma) and Painful Quandary reads "whenever an
  opponent casts a spell, that player loses 5 life unless they discard a card".
  Without the comma boundary the second reads as a payoff when it is a producer —
  a direction inversion, which ADR-0016 already ruled is worse than a gap.

### 3. One rule **narrowed**: the punisher clause is not your discard

`discard`'s producer now refuses the bare "discard a card" when it sits inside
an "unless they / that player / its controller …" clause, via a lookbehind.

A card-level exclusion was rejected: it would strip the tag from a card that has
a punisher clause *and* a real loot ability. This refuses the one clause.

Checked rather than assumed. Exactly **14** commander-legal cards lose `discard`
this way. All 14 were read by hand and all 14 are opponent-discard cards, now
tagged as such: Painful Quandary, Wrench Mind, Court of Ambition, Torment of
Scarabs, Torment of Venom, Starseer Mentor, Thornplate Intimidator, Possessed
Portal, Bandit's Talent, Polygraph Orb, Compulsive Research, The Long Reach of
Night, Ob Nixilis the Adversary, and Tergrid. **None was a loot card.** Beyond
those 14, nothing loses a `discard` or `sacrifice-fodder` tag in either
direction — verified card by card against the stored corpus.

### 4. Four interaction pairs, and three refused

Added:

```
opponent-discard  ↔ opponent-sacrifice
opponent-discard  ↔ lifeloss
opponent-sacrifice ↔ lifeloss
opponent-sacrifice ↔ creature-death
```

The two opponent tags feed each other because the cards say so in one breath —
Torment of Hailfire, Nicol Bolas, Forbidden Ritual and Tergrid's own Lantern all
read "unless that player sacrifices a permanent OR discards a card". Both pair
with `lifeloss` because that is what the punisher shell converts them into in
*both* directions: "loses 3 life unless they discard" is the producer, and Megrim,
Liliana's Caress, Raiders' Wake and Fell Specter are the payoff. And Grave Pact
spells out the last one: "whenever a creature you control dies, each other player
sacrifices a creature" — your deaths are literally what makes them sacrifice.

Refused, because each would rebuild the conflation this ADR removes:

- **`discard` ↔ `opponent-discard`.** Looting yourself does not feed Megrim and
  Megrim does not feed madness. Same verb, different event.
- **`sacrifice-fodder` ↔ `opponent-sacrifice`.** Your tokens are not what an
  edict eats.
- **`graveyard-creature` ↔ `opponent-discard`.** ADR-0016 already ruled that an
  opponent's graveyard is not the resource. Tergrid steals from it, which is a
  property of Tergrid and belongs in the curated override table if anywhere.

All three are asserted as negatives in the tests, so a later "obvious" addition
has to argue with a test rather than slip through.

### 5. `deriveSynergy` reads one face at a time

`oracleText` joins a double-faced card's faces with a newline, and two rules span
a `[^.]` gap that a newline fits inside. On the joined string a subject on the
front face can find its verb on the back. The function now takes the optional
`oracleTextFaces` (added by migration 0009) and unions the per-face results;
absence still means "single-faced, or ingested before the column existed", and
falls back to the whole text.

**Measured, and it changes nothing today: 0 of the 825 multi-faced
commander-legal cards derive differently split than joined.** The reason is that
a `[^.]` gap can only cross the join when the front face's last line carries no
full stop, and real oracle text ends its sentences — so the join is safe by
accident of templating, not by construction.

That number is reported rather than buried because it answers the question this
change was expected to turn on. **Reading faces separately is not what fixed
Tergrid.** Her faces disagree about *direction*, not about subject, and
`produces` and `wants` are separate rule sets, so the union over faces and the
match over the join are the same set either way. What fixed Tergrid was the
subject split plus the two gap rules in §2.

It is kept because it makes the boundary structural instead of incidental, and
because the union across faces is the right model of the question: a card is a
producer if either half produces. The test covering it uses synthetic text and
says so.

The type line is prefixed to every face rather than split with it. Scryfall gives
one joined type line per card ("Legendary Creature — God // Legendary Artifact")
and no per-face decomposition, and the `^[^\n]*` rules ask "is this card an
artifact", which is a question about the card. Splitting a string we were never
handed would be a guess.

### 6. A card that is its own engine is a named case

Tergrid both produces and wants both new tags. `synergyMatches` suppresses the
weaker reading of a tag it has already matched:

```ts
const strong = new Set(matches.map((m) => m.tag))
for (const tag of candidate.wants) {
  if (strong.has(tag)) continue
```

Checked, and **it is correct as written** — no change made. The suppression only
reaches `theme`. A card that produces and wants the same tag still gets its
`enables` match *and* its `payoff` match, because those are read from
`deck.wants` and `deck.produces`, which are different maps. What it stops is
crediting a card for "wanting what its neighbours want" when it is already being
credited at full weight for providing that same thing — one fact counted twice.
Both halves now have a test, so the behaviour is a decision rather than an
accident.

## Consequences

The four reported cards, after:

| card | produces | wants |
| --- | --- | --- |
| Hopeless Nightmare | `enchantment-etb`, `lifeloss`, **`opponent-discard`** | — |
| Mind Rot | `spell-cast`, **`opponent-discard`** | — |
| Thoughtseize | `lifeloss`, `spell-cast`, **`opponent-discard`** | — |
| Tergrid // Tergrid's Lantern | `artifact-etb`, `lifeloss`, **`opponent-discard`**, **`opponent-sacrifice`** | `untap`, **`opponent-discard`**, **`opponent-sacrifice`** |

Tergrid causes and benefits from both events, which is what the user said and
what the card does.

- **`SynergyTag` gains two members** (R2). Nothing switches exhaustively on it.
  `SYNERGY_TAG_VALUES` in `query/ast.ts` derives from `SYNERGY_TAGS`, so
  `tag:opponent-discard` works in search with no further change.
- **`apps/web/src/tags.ts` gains two entries** — "opponents discarding" and
  "opponents sacrificing" — and `discard` is reworded to "discarding your own
  cards". Without the rewording "causes discarding" reads as Mind Rot when it
  means Faithless Looting; the subject has to be said out loud on both now that
  a reader cannot infer it from a word both cards use.
- **`deriveSynergy`'s parameter widens** to accept optional `oracleTextFaces`.
  Additive: every existing caller still compiles.
- **The corpus must be re-ingested.** `synergy_produces` / `synergy_wants` are
  stored columns computed at ingest, so none of this reaches the app until then.
- This does not make the heuristics correct, and ADR-0011's point stands: the
  curated override table is still the answer for a card that reads wrong.

### Found, and deliberately not done

- **Hellbent is an unclaimed self-discard payoff.** "As long as you have no cards
  in hand" is the same sentence as the opponent-side payoff this ADR adds, about
  you. 34 cards. Widening `discard`'s payoff side is a different change and
  belongs with its own sampling.
- **The classic looter is untagged in both directions.** "Target player draws a
  card, then discards a card" (Cephalid Looter, Reckless Scholar, Careful
  Consideration) matches neither `discard` — the verb is inflected, so the self
  rule misses it — nor `opponent-discard`, which is right, because the card is
  pointed at yourself. 19 cards, and the honest fix is on the self side.
- **"Its controller sacrifices" was tried and rejected at ~53%.** 15 cards, and
  it is as often you as an opponent: Animate Dead, Goblin Ski Patrol and
  Celestial Sword all make *you* sacrifice your own permanent.
- **"Each opponent may sacrifice … or discard a card"**, with no "unless", is one
  card in the corpus (Osseous Sticktwister). Not worth a rule.
- **Ward—Discard is the marginal class inside the `unless` rule**, about 3 in 25
  of what that rule reads (Westgate Regent, Spectral Snatcher, Reality Smasher).
  Kept: it literally makes an opponent discard, and it is what Tergrid triggers
  on. Named here so the next audit does not have to rediscover it.
- **`synergyMatches` does not apply `selfCounted` to `enables`/`payoff`.** A
  self-engine commander scored as a cut-hint candidate would match itself in both
  directions. Pre-existing, unrelated to the subject split, and untouched.
