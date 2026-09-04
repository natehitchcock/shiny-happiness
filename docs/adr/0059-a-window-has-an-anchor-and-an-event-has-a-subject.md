# 59. A window has an anchor, and an event has a subject

Date: 2026-09-03

## Status

Accepted.

> **Number 0059 was assigned to this work.** Agents have collided twice by
> deriving a "next free" number from the directory listing; do not do that. The
> next agent should be told a number rather than reading one.

Extends [ADR-0022](0022-synergy-events-have-a-subject.md) and
[ADR-0054](0054-whose-event-is-it-and-what-is-a-card-counted-as.md) §1 (the
subject test, §§2–3 below). Amends
[ADR-0023](0023-damage-is-not-life-loss.md) §6 (§4). Nothing here contradicts
an earlier ruling; §4 and §6 both re-measure a refusal an earlier ADR made and
one of them is left standing.

## Context

Four playtests found defects in `packages/domain/src/synergy.ts`. They are not
one bug, and they are not eight either. They are **two classes and a handful**,
and naming the classes is most of the value:

1. **A window measured from the wrong anchor.** Two rules read one clause and
   differ by nine characters, and the narrower rule was the easier one to match.
2. **An event whose subject was never asked.** ADR-0022 established that a
   synergy event has a subject and ADR-0054 gave the token family one. Five more
   families never got the question.

The rhyme between them is that both are a rule looking at the right words for
the wrong reason, and in both the fix is structural rather than a bigger number
or a longer list.

## 1. `sacrifice-fodder` was a strict superset of `token`, and it is a subset

The two producer rules read the same clause:

```
token             ${CREATES_FOR_YOU} .{0,40}\btoken
sacrifice-fodder  ${CREATES_FOR_YOU} .{0,40}\bcreature token
```

`creature token` **starts nine characters earlier** than the bare word `token`
does, so inside a window of the same size the narrower rule matches strings the
wider one cannot. Every token whose description runs 32 to 40 characters was
fodder that was not a token.

**277 commander-legal cards.** Reported on Aviation Pioneer — "create a 1/1
colorless Thopter artifact creature token with flying" — whose row said
`primary_role: token-maker` beside `synergy_produces` claiming it makes no
tokens. Foundry of the Consuls is the one the playtest watched it happen to, in
a token deck, on screen.

**The fix is the anchor, not the number.** All three token-clause rules now end
at the word `token` and express their differences as zero-width lookbehinds:

```
token             ${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}\btoken
sacrifice-fodder  ${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}(?<=\bcreature )\btoken
artifact-etb      ${CREATES_FOR_YOU} ${TOKEN_DESCRIPTION}(?<=\b(?:artifact|Clue|…) (?:creature )?)\btoken
```

`sacrifice-fodder ⊆ token` is now true **by construction**, and the suite pins
it as a property over every description length rather than as a number, because
a number chosen by measurement can be un-chosen and an invariant cannot.

The window is 49 because that is the old 40 plus the nine characters of
`creature `, so `sacrifice-fodder` reads exactly the 2,536 cards it read before
and `token` gains the 277 it should always have had. Widening further keeps
paying a little — 50 adds 22, 60 adds 59 — and every extra card is one
`sacrifice-fodder` was already claiming, which is a second change and not this
one.

`artifact-etb` gains an adjective in the same pass: the rule wanted `artifact
token` adjacent and the game writes the whole type line out. **133 cards**, and
a Thopter is an artifact entering the battlefield whatever else it also is.

The gap stays `.` rather than becoming `[^.\n]`: measured over the corpus, a
sentence-crossing gap matches **zero** cards the sentence-bounded one refuses,
and this file's own ruling is that a branch a test cannot fail on is machinery.

## 2. The same defect on the trigger side, and the audit that found the rest

`whenever .{0,40}\bdies\b` reaches **308 of the 430** commander-legal cards that
carry a "whenever … dies" trigger. Blood Artist's subject —
`Blood Artist or another creature ` — is 33 characters and matched. Zulaport
Cutthroat prints the same sentence plus "you control", runs to 46, and matched
nothing at all. **The two cards an aristocrats deck is built out of disagreed
about whether a death was worth anything, and the one at EDHREC 234 said no.**
Cruel Celebrant, Butcher of Malakir, Kalastria Highborn, Xathrid Necromancer and
Headless Rider are the same sentence again.

Eighty is where the measurement stops paying, and the ceiling was found by
reading the cards each widening admits rather than by picking a round number: 60
reaches 413, 80 reaches 423 and all 91 cards it adds are real death triggers.
The **first** match at 90 is Rivaz of the Claw, where the words inside the window
have stopped being a subject — which is the signal that the window has left the
grammar it was measuring.

Because the class had now produced two high-impact defects, **every bounded
window in the file was audited** the same way: how many cards carry the trigger
at all, against how many the window reaches.

| rule | window | reaches | of | verdict |
| --- | --- | --- | --- | --- |
| `creature-death` whenever … dies | 40 | 308 | 430 | **widened to 80** |
| `attack-trigger` whenever … attacks | 30 | 1,694 | 1,764 | **widened to 60** |
| `lifeloss` whenever … loses life | 40 | 21 | 32 | left; see §4, which replaces the rule |
| `attack-trigger` … combat damage to a player | 45 | 697 | 706 | left |
| `landfall` whenever a land … enters | 20 | 197 | 205 | left |
| `token` whenever … token … enters | 30 | 23 | 24 | left |
| `opponent-discard` / `-sacrifice` / `-mill` | 60 | 50 | 52 | left |
| `treasure` whenever … Treasure … sacrificed | 30 | **0** | **0** | see below |

The `attack-trigger` widening is 69 cards: Winota, Joiner of Forces, Kindred
Discovery, Nahiri, Forged in Fury, Hooded Blightfang and every Samurai that
cares about attacking alone. Thirty characters holds a NAME and not a described
subject.

The two widened rules end up with **different gap classes, and the difference is
measured**. `dies` takes `[^.\n]`, which costs nothing at 80 and buys the
sentence boundary. `attacks` keeps `.`, because the boundary costs exactly one
card — **Mr. Foxglove**, whose own name carries a full stop, the honorific trap
`creature-etb` already documents on "J. Jonah Jameson" — and buys nothing
measurable. `.` is already bounded by the face, which was the guarantee that
mattered.

**`treasure`'s payoff rule matches nothing.** `whenever .{0,30}Treasure
.{0,20}sacrificed` assumes a word order the game does not use: no commander-legal
card puts "Treasure" before "sacrificed" on one line, and the real templating is
"sacrifice a Treasure" (14 cards). It is left as found and recorded here rather
than fixed, because it is a different rule rather than a wider window, and a
`treasure` payoff class is a claim that wants its own measurement. **Stated so
that it is a known gap and not a discovery.**

## 3. Five more families get a subject, and the phrase is "its controller"

ADR-0054 built `token-subject.ts` so a fourth rule table could not write the
subject test out privately. This is the fifth through ninth.

The reported case is the sharpest in the product. **Swords to Plowshares** —
"Exile target creature. **Its controller** gains life equal to its power" —
ranked **#1 in Staples** for a Heliod deck, with the reason "enables your
emphasised gaining life". Heliod triggers on **you** gaining life. The card never
triggers him.

`Divine Offering` ("**You** gain life") is correctly tagged, which is the tell:
the derivation reads the subject in the easy case and never asked in the hard
one.

### "Its controller" is two different people

ADR-0054 tried this phrase for `creates` and refused it at ~74% precision. The
refusal was right and the reason it was right is the whole of this section: the
phrase does not mean one thing. Read the **antecedent** and it means two.

```
Swords to Plowshares  "Exile TARGET creature. Its controller gains life…"
Essence Sliver        "Whenever a Sliver deals damage, its controller gains
                       that much life."
```

The first "it" is a permanent you answered — somebody else's, because that is
what removal is pointed at. The second is a creature that **triggered**
something, which in your own deck is yours.

**`target` is the antecedent test**, and it is the game's own word for the thing
a card is answering. It was chosen over a list of answer verbs (destroy, exile,
counter, return, put) after both were measured, and it is better in the way that
matters: **it refuses the symmetric shells for free.** "Destroy ALL nonbasic
lands. For each land destroyed this way, its controller may search…" is From the
Ashes, where the controller is also you — a verb list catches it and `target`
does not, because a wipe names no target. Wave of Vitriol, March of Souls and
Martyr's Cry are the same sentence.

### The window is not shared with `creates`, and that is the finding

The obvious move is to reuse `OPPONENT_SUBJECT`, whose window reaches fifty
characters back from the verb. **Measured, it is a disaster on `draws`:** the
same reach takes `card-draw` off **118 cards**, and most of them are the payoffs
that are the reason the deck exists. "Whenever an opponent draws a card, **you**
may draw two cards" is Consecrated Sphinx; Smothering Tithe, Fate Unraveler,
Underworld Dreams, Orcish Bowmasters and Leela are the same shape.

`creates` can afford the reach because a trigger condition about an opponent
creating something is rare. `draws` cannot. So `token-subject.ts` now holds
**two determiner lists with the measurement for each beside it** — one windowed,
one adjacent — which is the one exception this file makes to its own rule
against a second list of the same words. What ADR-0054 forbade was two lists in
two **files**, where nobody can see them disagree.

### What it moves

| tag | before | after | |
| --- | --- | --- | --- |
| produces `lifegain` | 2,424 | 2,400 | −24 |
| produces `card-draw` | 4,002 | 3,965 | −37 |
| produces `landfall` | 461 | 447 | −14 |
| wants `sacrifice-fodder` | 536 | 527 | −9 |

**All 84 read by hand; all 84 hand the life, the card, the land or the choice to
somebody else.** Swords to Plowshares, Path to Exile, Illumination, Nature's
Claim, Condemn, Oust, Last Breath, both Phelddagrifs, Bargain, Lord of
Tresserhorn, Master of the Feast, Forced Fruition, Thought-Knot Seer, Ghost
Quarter, Assassin's Trophy, Old-Growth Dryads.

The cards it **keeps** are the other reading, and they are the reason the
antecedent test exists: Essence Sliver, Genju of the Fields, Edric Spymaster of
Trest, Selvala, Kavu Lair, Synapse Sliver, Horn of Greed, Glademuse, Ludevic,
Nekusar, Archivist of Gondor.

`sacrifice-fodder`'s WANT side had no subject test at all, so **Clackbridge
Troll** was offered to an aristocrats deck as "benefits from your expendable
bodies". The Goats it eats are the ones it gave away. It takes the wider
`addressedToYou`, because the verb is a bare infinitive and having no named
subject is what makes the clause yours — ADR-0022's device, one verb over.

### `token` stays refused, re-measured rather than assumed

Restricting ADR-0054's rejected "its controller creates" to a targeted
antecedent does **not** rescue its precision. The cards that broke it — March of
Souls, Rampage of the Clans, Descent of the Dragons, Terastodon, Saw in Half —
are removal shells whose controller is you on purpose, and Descent, Terastodon
and Saw in Half all name a target. **That refusal stands exactly where ADR-0054
left it**, and the suite now pins it.

### Named cost

Dire-Strain Rampage puts its **second** "its controller" clause 200 characters
past the target and keeps its `landfall`. One card.

## 4. `lifeloss` needed a tag, not a subject test

`lifeloss` had no subject test either, and this one could not be fixed with a
regex.

**257 of its 1,062 producers lose the life themselves** — Dark Confidant, Grim
Tutor, Foul Imp, Ad Nauseam, Feed the Swarm — while the panel renders the tag as
"opponents losing life". A Vito deck was offered a card that takes life off its
own total as an enabler for taking it off theirs.

ADR-0023 §6 saw the payoff half and left it: *"that leaves 12 self-life payoffs
on `lifeloss` alone, which is correct."* It was right about the payoffs and it
never measured the producers. With both sides subject-agnostic **the tag matched
in both wrong directions at once**: 257 self-producers against 7 opponent
payoffs, and 805 opponent-producers against 10 self ones.

Neither half-fix is available:

- Narrowing **only the producer** leaves Vilis wanting an event nothing emits.
- Narrowing **both sides** deletes the Vilis deck — which is the mistake
  ADR-0016 records against itself, *"narrowed it to here and stopped, which
  deleted the opponent side rather than modelling it."*

An event with two subjects needs two names, which is ADR-0022's whole finding.
`self-lifeloss` is appended to `EVENT_TAGS`.

| | before | after |
| --- | --- | --- |
| produces `lifeloss` | 1,062 | 805 |
| produces `self-lifeloss` | — | 317 |
| wants `lifeloss` | 19 | 7 |
| wants `self-lifeloss` | — | 12 |

60 cards produce both, which is the symmetric drain and is correct — ADR-0022's
ruling about "each player discards", one event over. 317 and 12 is the same
order as `land-creature`'s 185 and 12, the count ADR-0047 admitted a tag on.

**Named for the self side**, against the convention that the bare tag is yours
(`discard` / `opponent-discard`). `lifeloss` is a stored value whose label has
said "opponents" since it was written, so renaming it would break every deck
that emphasises it in order to fix a word. The asymmetry is the cheaper of the
two and it is written into the tag's docblock so the next reader does not
quietly "correct" it.

Two pairs, both true read either way: `self-lifeloss` ↔ `card-draw` (Necropotence,
Bolas's Citadel, Vilis, Ad Nauseam turn life into cards) and `self-lifeloss` ↔
`lifegain` (gaining it back is how the deck survives doing that).
`self-lifeloss` ↔ `lifeloss` is refused — one verb, two subjects, and a tag does
not feed itself.

## 5. Every basic land wanted untapping

`{ tag: 'untap', test: /\{T\}:/ }` asked whether a permanent has a tap ability at
all, and **1,129 of the 1,194 commander-legal lands have one — 94.5%**. Since
every deck runs about thirty-six lands, `untap` was **the largest single want in
every deck in the product**, and it was the mana base saying it.

The playtest demonstrated it rather than inferring it: with nine Forests in a
green deck, every top-eight row in both the ramp and spot-removal groups was
chipped "shares your untapping theme" — Thornbite Staff, Lux Cannon, Crooked
Scales, Acorn Catapult. Remove the Forests and the chips vanish; re-add them and
they return. It buried green's real cards and hid two other changes.

**What the rule is for was measured before it was narrowed.** The 324 producers
are Seedborn Muse, Wilderness Reclamation, Voltaic Key, Kiora and Thornbite
Staff, and what they are worth is a **second activation of an ability that does
something**. Two guards follow from that, and no more than two:

1. **The effect is not "Add".** A land tapping for mana is the mana base — the
   product owner's own line, already load-bearing for `ritual`. 1,129 → 442.
2. **The cost does not eat the permanent.** "{T}, Sacrifice this land: Destroy
   target nonbasic land" is Wasteland, and untapping Wasteland is worth nothing
   because it is not there. 442 → 294.

And the same reading found a miss in the other direction: `/\{T\}:/` required
the tap to be the **whole cost**, so **399 cards** whose only tap ability is a
compound one wanted nothing at all — Hell's Caretaker, Cryptbreaker, Krovikan
Sorcerer, Balloon Peddler.

```
wants untap          3,538 → 2,518   (−1,419, +399)
lands with the want  1,129/1,194 (94.5%) → 294/1,194 (24.6%)
```

Krenko, Arcanis, Staff of Domination, Voltaic Key, Mikokoro, Deserted Temple and
Arcane Lighthouse all keep it. **The cost is stated rather than hidden:** Sol
Ring, Gilded Lotus, Gaea's Cradle and every mana dork lose the want, and
untapping those is a real thing decks do. It is a thing they do to make **mana**,
which `ramp` and `ritual` already name, and saying it here as well is not worth
94.5% of the mana base.

`\s+` and not `\s*` is the whole rule in one character: a star lets the engine
match zero whitespace and hand the space itself to the lookahead, so `(?!Add\b)`
succeeds against `" Add"` and every basic land comes straight back. Found by
measuring, not by reading.

## 6. Four smaller ones, and one verdict

**A keyword matching inside a longer keyword.** `Double` and `Double strike` are
both in the generated vocabulary and `\bDouble\b` matches inside the second: 175
cards claimed `ability:double` because their text says "double strike", and the
focus prompt offered the two as adjacent chips meaning the same thing. The
vocabulary is generated, so the fix cannot be to delete a word — a keyword
pattern now refuses the longer keywords it is a prefix of, **built from the
vocabulary rather than listed**, so the fifth pair arrives already handled. Four
pairs today; `Hexproof`/`Hexproof from` is the other live one, 6 cards.

**A negation read as a want.** Karn Liberated wanted `subtype:aura` out of
"leaving in exile all **non-Aura** permanent cards", and Mikaeus benefited from
Humans off "Other **non-Human** creatures you control get +1/+1" — he is a
Zombie.

But **a pre-existing test asserted the opposite and it was right**: Ruthless
Winnower, "each player sacrifices a **non-Elf** creature of their choice", is an
Elf whose edict spares your board, and the negation is the whole reason to play
it. That test found the discriminator instead of being relaxed. **A negation
names a want only when the card IS that subtype**: "not one of mine" is a tribal
card naming its tribe, "not one of those" is everybody else naming a category.
The type line tells them apart.

**An Aura that makes a subtype rather than wanting one.** Frogify does not
benefit from Frogs; it turns an opponent's creature into one, which is the
direction inversion ADR-0016 calls the worst error this model can make. Refused
rather than re-pointed at `produces`, because the transformed creature is the one
the card just answered — ADR-0054's donated-token ruling, one clause on.

The corpus diff then caught the guard that needed: **"AS LONG AS equipped
creature IS a Human, it has lifelink" is a condition, not a transformation**, and
an unguarded rule took the tag off the whole Human-Equipment cycle. 61 clauses
become 49 and all 12 handed back are payoffs — Butcher's Cleaver, Sharpened
Pitchfork, True-Faith Censer, Blade of the Bloodchief, Lavamancer's Skill.

Together these drop **307 tag claims across 299 cards and add none**. Named
residual misses, stated rather than hidden: Call to the Grave and Fiery Cannonade
spare a tribe from a **symmetric** harm without being that tribe, so they lose a
want that was real. Telling those from Power Word Kill needs to know whether a
clause is a harm avoided or a category excluded — which is the same missing axis
as the next item.

**"Storm" in a card's own name.** `spell-cast` read the bare word, and Scryfall
spells a card's own name out in its oracle text, so "Storm's Wrath deals 4 damage
to each creature" claimed to be a spellslinger payoff. 21 cards, 19 of them
weather. The instrument is the one the `ritual` payoff rule already uses — read
the keyword by its **reminder text** — and using it in both places is the point.
Measured to cost nothing: all 33 cards with the storm keyword print the reminder,
zero exceptions.

The other two of the 21 matched on the word inside a **token's** name, "a 1/2
blue Bird creature token with flying named Storm Crow", and one of them —
Murmuration — is a real payoff no correct rule could reach. So the corpus diff
paid for itself: a card that **counts** the spells you cast is now its own rule.
12 cards.

### The verdict on valence: not expressible

`Halvar, God of Battle // Sword of the Realms` derives `wants: creature-death`
from "Whenever equipped creature dies, return it to its owner's hand". That is
damage control, not a payoff, and the consequence is Wrath of God offered to a
voltron deck as "enables your creature dying".

**This is valence, not direction, and the model cannot express it.** The proof is
one clause shape:

```
Skullclamp          Whenever equipped creature dies, draw two cards.
Avarice Amulet      Whenever equipped creature dies, target opponent gains
                    control of this Equipment.
```

16 commander-legal cards carry that clause. **10 are payoffs and 6 are
consolations**, and Avarice Amulet is an outright drawback reading as a death
payoff. **No clause-level test separates them**, because the difference is
entirely in what the effect is worth.

The three directions — `produces`, `wants`, `has` — each answer "does this event
relate to this card". None carries a sign, and `wants` is *defined* as "is better
when this happens", which is what makes a consolation clause a lie in that
vocabulary rather than an imprecision. Fixing it needs **either** a fourth
direction or a sign on `wants` — a `SynergyProfile` contract change under R2,
with its own ADR — **and** a way to derive it, which is a hand-maintained
vocabulary of effects-that-are-good and exactly the shape ADR-0060 just ruled
against ("the list is the defect").

**No fix attempted.** Refusing Halvar's want would be its own false claim: he
does relate to creature death, he simply does not want it. Recorded so the next
agent starts from the measurement rather than the symptom.

## 7. Consequences

- **`synergy_produces` and `synergy_wants` are stored columns. This needs a
  cards re-ingest. No migration** — `self-lifeloss` is a new value in an existing
  `text[]`, and `EVENT_TAGS` is appended to rather than reordered, which is what
  migration 0014's ordering guarantee requires.
- `token-subject.ts` gains two exports. It was edited by another task in flight
  during this work (ADR-0060 §6); that change was merged and reconciled rather
  than reverted — the intent was the same, and the new exports sit beside
  `OPPONENT_SUBJECT` with the reason they do not share its window written
  between them.
- **Shared files touched:** `packages/domain/src/semantic-tokens.ts` and its
  test (§6), and `apps/web/src/tags.ts` for one label — without it the new tag
  falls through to the hyphen-stripping fallback and the panel reads
  "self lifeloss".
- `treasure`'s payoff rule matches zero cards (§2) and is left as a named gap.
- Valence is unexpressible and is not attempted (§6).
- Every assertion added here was mutation-checked: **35 mutations, 35 killed.**
  Two earlier attempts escaped and were **bad mutations rather than test gaps** —
  an alternation prepended to a regex disables nothing, and stripping one branch
  of three left the branch the card matched. Both were rewritten until they bit.
  The harness aborts with a distinct exit code rather than scoring when a
  mutation changes no bytes, proven by feeding it a search string written with a
  bare LF against this CRLF tree.

## 8. Re-ingest

```
pnpm --filter @roundtable/ingest build
DATABASE_URL=… pnpm --filter @roundtable/ingest start cards
```
