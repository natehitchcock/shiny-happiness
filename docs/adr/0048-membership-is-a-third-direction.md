# 48. Membership is a third direction, and it is not stored

Date: 2026-09-02

## Status

Accepted. Extends [ADR-0046](0046-subtypes-and-keywords-are-semantic-tokens.md).
Overrides ADR-0029 §6 on `mill` — see below.

> **Number 0048 is taken by this ADR.** 0045, 0046 and 0047 are taken. The next
> agent should take 0049.

## Context

ADR-0046 added 317 keyword tags and 269 subtype tags, and then measured something
uncomfortable: **only 19 of the 317 keywords could ever appear in a match.**

The diagnosis at the time was that keywords are inert — almost nothing in Magic
pays off a keyword by name. The user's reading was different and better:

> "maybe for the keywords, we need a 'has' semantic category. Separate from
> Benefits from and causes."

They are right, and the symptom was not inertness. `synergyMatches` pairs
`produces` with `wants`, and membership had been crammed into `produces` because
`produces` was the only supply-side verb there was. **A card does not *cause*
flying, it *has* it.** Ambush Commander does not *produce* Elf, it *is* one. The
vocabulary had two verbs for three relations, and a tag can only appear in a
match through a verb it does not have.

## Decision

`SynergyProfile` gains a third direction.

| direction | meaning | examples |
| --- | --- | --- |
| `has` | what the card **is** or **has** | its type line's subtypes; its keywords |
| `produces` | what it **causes** | "create a 1/1 Soldier token"; "target creature gains flying" |
| `wants` | what it **pays off** | unchanged |

The line between the first two is real rather than a relabelling: **a token maker
CAUSES a Soldier and is not one.** That distinction was invisible while there
were two verbs, and one whole claim could not be expressed at all — **granting**
a keyword. That clause was stripped out of the payoff read to stop a direction
inversion ("target creature gains flying" is not a flying payoff) and then thrown
away, so **495 cards that hand out flying said nothing about flying**. `produces`
now carries it, along with tokens made with a keyword.

### Which directions pair

`has` is a second way of **supplying** a tag, so it pairs with `wants` in both
directions exactly as `produces` does:

- `candidate.has` ∩ `deck.wants` → **enables**. A flier supplies what Favorable
  Winds wants.
- `candidate.wants` ∩ `deck.has` → **payoff**. Favorable Winds pays off a deck of
  fliers. The weight is `deck.produces + deck.has`, because a deck with six fliers
  and a card that grants flying supplies both.

`has ↔ has` is **not** scored, for the same reason `produces ↔ produces` is not:
two Elves are redundancy, not synergy. What makes a tribe a deck is the card that
*wants* the tribe, and that card is already the other half of both pairings above.
`has ↔ produces` is refused on the same ground — an Elf and an Elf-token maker
are two copies of the same effect.

### "Has can still imply certain benefits from and causes"

The user's own qualifier, and it needs an answer rather than silence. **No
implication is added, because the pairing being symmetric already carries it.** A
flier gets credit in a deck with a flying payoff, and the payoff gets credit in a
deck of fliers; there is nothing left for an implication to add. The one thing it
*would* add — a shared `has` counting as a theme — is the redundancy refused
above. Nothing is hardcoded in the scorer, and if an implication is ever wanted it
belongs in the rules that emit the tags.

### `has` is DERIVED, not stored — and this is the rule to remember

A third array means a third column, a migration and wire growth. Measured on
`pg_column_size` over the 31,782 eligible rows:

| | adds | net after the ADR-0046 read trim |
| --- | --- | --- |
| two arrays | +1.247 MiB | +0.335 MiB |
| three arrays | +1.980 MiB | **+1.068 MiB** |

Migration 0017 was written and then **deleted unapplied**, because the third
column is the one that should not exist:

**`synergy_produces` and `synergy_wants` are regexes over `oracle_text`** — the
column a trimmed read most wants to drop — so ADR-0011 stores them and buys
something real. **`synergy_has` is two set intersections over `type_line` and
`keywords`, both already in every read.** Storing it would ship 1.98 MiB of a pure
function of 1.43 MiB already on the wire, to save a measured **13.0 ms** for a
whole 31,782-card corpus pass.

> **Store a derivation whose inputs the read does not need. Derive one whose
> inputs it already carries.**

`toCard` fills it on every read. That removes a state rather than adding one:
there is no "written before the migration" window, no re-ingest before tribal
matching works, and regenerating the vocabulary takes effect on deploy instead of
after 34k rows are rewritten.

**The coupling this creates is enforced, not remembered.** `type_line` and
`keywords` are now load-bearing for something a reader of the `SELECT` would not
guess: drop either and every card's tribe and evasion tags silently become `[]`,
tribal matching stops working, and nothing throws. `db.test.ts` fails if either
leaves the eligible column list. A derivation whose inputs can be trimmed away by
someone doing exactly what the comment above them recommends is a landmine rather
than a saving.

### Display: one direction, two frames

"Is an Elf" and "has flying" are not the same sentence, and a single heading over
both would have to pick one and be wrong about the other. The card panel draws
two rows, **Is** and **Has**, split on the tag's own prefix — so nothing is stored
to support it. Membership is drawn first, because it is what the card *is* and the
other two rows are about it.

The chip is a **dashed border**, not a third colour. The two existing directions
are already told apart by their labelled rows, and a third hue would lean on
colour for a distinction a reader may not be able to see. A dash reads at any
contrast and says the right thing: a membership tag is a quieter claim than an
engine.

`has:` is the filter field. Checked before choosing: `is` is taken by the
predicate field and `kw`/`type` are the Scryfall-style card filters, but `has` was
free. `tag:` now reads all three directions.

## Also in this pass

Four smaller decisions the same user request pulled in.

### `opponent-mill` — an OVERRIDE of ADR-0029 §6, not a quiet contradiction

ADR-0029 §6 refused a mill tag because nothing paid it off, and that reasoning is
still on disk and still correct about the tag it refused. The user has overruled
it, and **what changed** is the part worth recording:

1. **The scope is narrower than the tag that was refused.** Self-mill was never
   the gap — `graveyard-creature` has read "you mill", "mill N cards" and
   "surveil N" since ADR-0016. What no rule could see is milling an **opponent**,
   which ADR-0016 and ADR-0022 both ruled is a different resource. 242 cards.
2. **The payoff class is not empty**, though it is small. Glowing One, Infesting
   Radroach, Zellix and Lo and Li trigger on a player milling; Spoils of War,
   Spoils of Evil, Jailbreak and Dawnbreak Reclaimer count or take from an
   opponent's graveyard. **10 cards**, against the zero ADR-0029 measured.

Named `opponent-mill` because this file puts the subject in the name
(`discard`/`opponent-discard`, `sacrifice-fodder`/`opponent-sacrifice`) and a bare
`mill` would name the half that is already `graveyard-creature`. `mill` is aliased
to it in the search box, the way `burn` is aliased to `damage`.

One pair: **`opponent-mill` ↔ `opponent-discard`**, because the cards say both in
one breath — Lo and Li reads "whenever an opponent DISCARDS a card or MILLS one or
more cards", which is the bar ADR-0022 set for exactly this shape. `↔
graveyard-creature` is refused: different graveyard, and pairing them would offer
a self-mill reanimator a Glimpse the Unthinkable.

### `extra-turns` — and it cannot score, which is said out loud

53 producers. **Zero payoffs**, measured: every payoff template that looked
promising matched the Force cycle's "if it's not your turn", which is about
instant-speed interaction. `synergyMatches` needs a `wants` on the other side, so
this tag is vocabulary and a label rather than a score — the same standing the
derived keyword families have. A pair in `INTERACTION_PAIRS` does not change that,
because `interactsWith` feeds the card panel and not the matcher.

The regex is **imported from `bracket-barometers.ts`**, not written again. That
rule already knows the three cards that *deny* extra turns ("would BEGIN" is the
denial verb, "takes" is the grant) and that Emrakul omits "after this one"; a
second regex would be a second answer to one question.

### A blink is not removal

Teferi's Time Twist was `spot-removal` because `exile target` had no guard for
"you control". **The tag was already right** — `deriveSynergy` reads it as
`creature-etb`, which is the flicker semantic — so a `flicker` tag would have been
a second name for an existing one, which is worse than the bug. Only the role was
wrong.

The fix is not a new judgement: the `bounce` rule ten lines above already carries
exactly this exclusion with exactly this reason written beside it — *"self-bounce
is a blink/value effect, not an answer"* — and the sentence is true one verb over.
33 cards.

The **symmetric** flickers are deliberately left as removal. "Exile target
creature. At the beginning of the next end step, return that card" names no
controller, and a guard wide enough to reach them also swallows the removal *half*
of every modal card that offers both — Settle Beyond Reality's "exile target
creature you don't control", Eldrazi Confluence's. 28 more cards for the loss of a
real mode on several, and the clause is the unit rather than the card. Measured
and refused, not missed.

### The commander sweep, and two rule gaps it found

The user asked for every commander to carry at least one semantic, with the
exceptions listed for review. **3,411 commander-legal cards can lead a deck, and
every one now carries at least one semantic. The exception list is empty.** Under
the two-direction model, **515 of them carried none**.

515 carry *only* membership — "is a Human Wizard with flying" — which is a true
claim and a thin one, and is the honest list of cards the event tables still
cannot read. Reading it found two rules that were wrong rather than missing:

- **`landfall` wanted "an additional land"**, a closed determiner list of one, and
  so missed "you may play TWO additional lands on each of your turns" — Azusa,
  Lost but Seeking, the commander the archetype is named after.
- **`token` wanted an active-voice "create … token"**, and so missed all fifteen
  token **doublers**: Doubling Season, Anointed Procession, Parallel Lives,
  Mondrak, Chatterfang, Adrix and Nev, Divine Visitation. A replacement effect
  puts the verb after its object and in the passive. They are the most-played
  cards in that archetype and carried no token tag at all.

## Consequences

- `Card.synergyHas` and `SynergyProfile.has` are **optional**, and the optionality
  now means only "a `Card` built by hand, in a test or by a caller with no
  vocabulary". Every card that came out of the database has one.
- **No migration.** Nothing about this change needs a re-ingest to become visible.
  The `produces` rules that changed in this pass (`landfall`, `token`,
  `opponent-mill`, `extra-turns`) do.
- `EVENT_TAGS` is 24 and is still the closed, hand-written list; `SYNERGY_TAGS` is
  that plus the generated families. The count assertion moved to `EVENT_TAGS`,
  which is what keeps anyone from adding a twenty-fifth event without saying so.
- **`SYNERGY_TAGS` is append-only**, and that is a persisted contract rather than
  a style note: `semantic-emphasis.ts` sorts stored emphasis into this array's
  order and migration 0014 documents the guarantee, so inserting a tag mid-array
  silently reorders scoring ties for decks that already exist.
