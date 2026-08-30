# 16. Synergy coverage: reading the other half of the corpus

Date: 2026-08-30

## Status

Accepted.

## Context

[ADR-0013](0013-synergy-themes-and-unknowns.md) stopped the app from reporting our
ingest gap as a finding about the cards, and said plainly that it did not fix the
gap:

```
cards                              34,492
with a `produces` tag              13,295
with a `wants` tag                  8,284
with neither                       16,684   (48%)
```

This is that fix. It is the same kind of heuristic as before — regexes over
Scryfall oracle text, per [ADR-0008](0008-drop-edhrec.md), with no deck-statistics
aggregator anywhere near it — so the work was not "write more patterns". It was
**read the 16,684**, cluster them, and then check each new pattern against the
cards it actually catches.

Sampling the untagged set turned up four things the vocabulary could not say and
several it could say but was not saying:

- **4,278 untagged instants and sorceries.** Casting one is the event prowess,
  magecraft and storm are waiting for, and no tag named it.
- **1,472 untagged creatures with an enters-the-battlefield trigger.** Blink is
  one of the most common things a Commander deck is *about*, and no tag named it.
- **1,697 untagged artifacts.** `artifact-etb` existed but only fired on "create
  an artifact token" — 37 cards in the whole corpus.
- **Ramp read as nothing.** The `landfall` pattern wanted the word "land" *after*
  "put", so "search your library for a basic land card, then put it onto the
  battlefield" — the most common landfall enabler there is — matched no rule.
- **`attack-trigger` had no producer at all.** 1,848 cards wanted an event that
  nothing in the corpus could supply, so it could only ever contribute a theme.

## Decision

### 1. Two new `SynergyTag` values

`creature-etb` and `spell-cast`. Both are contract changes, which is why this ADR
exists; both are additive, so no existing value moves.

- **`spell-cast`** — the event is "you cast an instant or sorcery". It is
  produced by *being* one, read off the type line, not out of the rules text, so
  it cannot be wrong about a card it matches. It is wanted by prowess, magecraft,
  storm, "whenever you cast a noncreature spell" and the cost reducers.
- **`creature-etb`** — the event is "a creature enters the battlefield". Produced
  by flicker effects, persist/undying, and reanimation; wanted by every card with
  a "when this creature enters" trigger (it is asking to be blinked) and by every
  "whenever another creature enters" payoff.

Both are paired in `INTERACTION_PAIRS`: tokens and reanimation feed
`creature-etb`; card draw and the graveyard feed `spell-cast`.

### 2. Widened rules, checked against what they catch

Every rule below was sampled — roughly twenty cards it newly matches, read one by
one — and kept only above about 85% on the question *would a deckbuilder agree
this card is about that event*. Notable ones:

| Tag | What it now reads |
| --- | --- |
| `artifact-etb` | the type line says Artifact; and the named token types (Clue, Food, Blood, Powerstone, …) |
| `landfall` | any "land card … onto the battlefield" in one sentence, which is every fetch and every ramp spell |
| `attack-trigger` | produced by an additional combat phase; wanted by "deals combat damage to a player", which is an attack trigger with a harder condition |
| `lifeloss` | damage to a *player* is that player losing life, and "whenever a player loses life" triggers on it |
| `plus1-counter` | "enters with N +1/+1 counters", which never says "put" |
| `graveyard-creature` | flashback, unearth, disturb, encore, descend, "cast from your graveyard", "cards in your graveyard" — the tag already contained `delve` and `threshold`, so it never meant only creatures |
| `lifegain` / `card-draw` | numbers past the closed list they had, plus "equal to" and "that much" |

### 3. Three rules **narrowed**, because the subject matters

This is the part that lost coverage on purpose.

- `discard` no longer matches "target opponent discards two cards". That is a
  hand attack. It does not feed madness and it does not fill *your* graveyard,
  which is all this tag is paired with — 296 cards were being called discard
  enablers on the strength of a verb.
- `graveyard-creature` no longer matches "target player mills three cards", for
  the same reason: an opponent's graveyard is not the resource.
- Damage-based `lifeloss` deliberately excludes "any target", which points at a
  creature about as often as at a player.

### 4. Rules tried, measured, and rejected

Recorded because the next person will think of them too.

- **`destroy target nonland permanent` → `creature-death`.** About 70%: it as
  often points at an enchantment.
- **`fights target creature` → `creature-death`.** About 70%: a fight often fails
  to deal lethal damage, and it is a removal spell before it is a death engine.
- **`goad` → `attack-trigger`.** Wrong direction. Goad makes an *opponent's*
  creature attack, which no "whenever a creature you control attacks" ever sees.
- **`untap all creatures you control` → `attack-trigger`.** A vigilance trick
  more often than a second attack, and it already reads as `untap`.
- **Auras and Equipment as a tag.** 1,280 producers in the untagged set and 27
  payoffs. A tag with no payoff side is a theme label, not an event.

## Consequences

```
                        before    after
cards                   34,492   34,492
with a produces tag     13,295   21,549
with a wants tag         8,284   13,245
with NEITHER            16,684    7,944
                         (48%)    (23%)
```

- **`SynergyTag` gains two members.** Any exhaustive `switch` on it must handle
  them. `apps/web/src/App.tsx` switches on tags only through `TAG_WORDS`, which
  falls back to the hyphenated tag name, so it degrades to "creature etb" and
  "spell cast" rather than breaking — but it needs the two entries, and
  `lifeloss` and `artifact-etb` both now want looser wording than they had
  ("a player losing life", "artifacts") because both tags now read cards that
  are about the event more broadly than the original phrasing admitted.
- **The corpus must be re-ingested** for any of this to reach the app;
  `synergy_produces` / `synergy_wants` are stored columns, computed at ingest.
- **The remaining 7,944 are mostly right.** They are vanilla creatures, combat
  tricks and pump spells — cards with no event to name. Some are auras and
  equipment, which is the one cluster we can see and chose not to tag.
- This does not make the heuristics correct, and ADR-0011's point stands: the
  curated override table is still the answer for a card that reads wrong.
