# ADR-0060 — The list is the defect, and a role has a subject

**Status:** accepted
**Date:** 2026-09-03
**Amends:** ADR-0054 §2 (`ROLE_PRECEDENCE`, re-derived, with a principle) — §4 below.
**Amends:** ADR-0058 §8 (the `ramp` defect this uncovered) — §2 below closes the residue that ADR recorded by name.
**Extends:** ADR-0022 (synergy events have a subject), ADR-0031 (a card is offered under the role it is counted as), ADR-0037 (interaction is two leaf roles), ADR-0047 (the article that was missing).

> **Number 0060 was assigned to this work.** Agents have collided by deriving a
> "next free" number from the directory listing; do not do that.

---

## 0. The reports

A playtest found five defects in `role-derivation.ts` and `role.ts`, and a
second one landed mid-flight with two more. All seven are in one file plus its
vocabulary, and five of the seven are two sentences repeated:

**A rule read a literal where the rule beside it read a class.** `tutor` read
`(a|any)` while `sac-outlet` read `(a|an|another)`. `draw` counted to four while
its own siblings counted to X. The single-target damage rule refused the letter
X while the mass-damage rule twelve lines above it admitted X and wrote down
why. Every one of these is the same defect, and each had previously been fixed
where it was found and left standing one rule over.

**A rule read a verb without asking who its subject was.** ADR-0022 settled this
for synergy events; ADR-0054 settled it for tokens and built `token-subject.ts`
so it could not recur. It recurred twice more: on `stax`, where Grand Arbiter
Augustin IV's tax names *whose* spells and Thalia's does not, and on
`protection`, where Hunted Horror claims a keyword printed on two Centaurs it
just handed across the table.

The remaining two are about what a card is COUNTED as, and they are §4.

---

## 1. One list of quantifiers

`role-derivation.ts:135` read:

```
search your library for (a|any) …
```

*"Search your library for **an** Equipment card"* fails at the article.
**55 commander-legal cards** match the template and none held `tutor` — and the
three canonical Equipment tutors are all among them, so a voltron deck asking
Quickbuild for five tutors finished 3/5 having never been offered Stoneforge
Mystic, Steelshaper's Gift or Open the Armory. Idyllic Tutor, Fabricate,
Spellseeker, Mystical Teachings, Heliod's Pilgrim, Trinket/Trophy/Tribute/
Treasure Mage are the same card in other colours.

**This was the third report of the missing article.** ADR-0047 fixed
`(a|another)` with no `an` in `sac-outlet`, 81 cards. ADR-0058 fixed a `ramp`
rule that demanded the literal word "basic", 145 cards. So this one is not
fixed where it was found.

### The audit

Every determiner and quantifier list in the file, widened and measured. The
count is CARDS THAT WOULD GAIN THE ROLE, not cards that match the widened
pattern — a sibling rule often already awards it, and counting matches instead
of gains would have reported a 120-card "gap" in the any-land ramp rule that the
basic-land rule beside it already covers.

| rule | shipped list | widening | gains | verdict |
|---|---|---|---:|---|
| `tutor` | `(a\|any)` | `an` | 55 | **fixed** |
| `tutor` | — | `up to N` | 23 | **fixed** — the two ramp rules already read `up to \w+` for the same verb |
| `tutor` | — | a bare numeral | 1 | **fixed** (Behold the Beyond) |
| `draw` | `(a\|two\|three\|four\|X\|that many)` | five…ten | 48 | **fixed** — every Wheel and Timetwister in the format |
| `sac-outlet` (noun) | `(a\|an\|another)` | the numerals | 19 | **fixed** |
| `ramp` (basic land) | `(a\|up to N)` | "any number of", "a number of", a numeral | 3 | **fixed** |
| `spot-removal` (`destroy`/`exile target`) | no quantifier at all | the whole list | 111 + 97 | **fixed**, §5 |
| `board-wipe` (each player sacrifices) | `(all\|X)` | a fixed count | 78 | **refused** — ADR-0037 argued this: a fixed count is a tax the board chooses to pay |
| `sac-outlet` (noun) | — | `this` | 702 | **refused** — "Sacrifice this creature:" is a card spending itself once, not an outlet |
| `graveyard-hate` (exiles) | a list of object phrases | any qualified card | 14 | **refused** — it admits Living Death and Living End, which are reanimation, not hate. Not the same class: that list is of object phrases, not determiners |

The `sac-outlet` row is the sharpest. The TRIBAL outlet rule carried
`(?:a|an|another|two|three|X|\d+)` and the noun rule beside it carried
`(a|an|another)` — two lists of the same quantifiers, in the same file, for the
same verb, disagreeing. The file's own comment warns about this one noun over:
*"two lists of the same nouns that disagree is how the next one goes wrong."*

**So there is now one `QUANTIFIER`, and a rule that wants a quantifier reads
it.** `this` is deliberately absent and is the entry doing the most work.

---

## 2. A land is a land in both directions

Adding `an` to the tutor rule alone would have shipped **ten more landcycling
Islands as tutors**, because the rule's land guard was the literal `\bland
card`: it refused "a basic land card" and admitted "an Island card". So the
article fix and ADR-0058's recorded residue are one change.

ADR-0058 §8 wrote the residue down by name: *"landcycling still derives `tutor`,
because the tutor heuristic reads 'search your library for a Forest card' out of
the reminder text."*

**`LAND_OBJECT` is the single statement of what a land search looks like**, read
by the rule that AWARDS `ramp` for one and by the rule that REFUSES `tutor` for
one. Two lists could not have stayed in agreement; that is this ADR's own §1.

### The refusal ADR-0058 made, and why it can now be lifted

ADR-0058 refused "a named land type … into your hand" because it is 84 cards and
51 of them are landcycling — a discard ability on a Dragon, and Timeless Dragon
counted as ramp would be ADR-0031's defect pointed the other way.

Re-measured on the current corpus: **89 cards, 54 landcycling and 35 real, and
the split is exact.** Every one of the 54 has its search clause inside
reminder-text parentheses and not one of the 35 does. So the 35 can be admitted
without the 54, and `Archaeomancer's Map` and `Gift of Estates` stop being
`synergy` while Timeless Dragon stays out.

All 35 were read by hand: the five Monuments, Kayla's Command, Nissa's
Pilgrimage, Land Grant, Boreas Charger, Sunblade Samurai, Safewright Quest,
Flower // Flourish, The Birth of Meletis. **Thirteen of the 35 held `tutor`**,
which is the same defect from the other side and is closed by the same shared
`LAND_OBJECT`: Land Grant and Liliana's Shade were being offered to decks that
asked for a way to find a combo piece.

### A global reminder-text strip was written, measured and REFUSED

Deleting every `(...)` before the rules read the text is the obvious general
fix, and it is wrong. Measured over the corpus it changes **1,322 cards' roles**,
and the change is not one-directional:

| | cards |
|---|---:|
| correctly stop being `evasion` (reach's reminder text names flying) | 363 |
| **incorrectly** stop being `draw` (cycling's reminder text is the only place the card says it draws) | 522 |
| incorrectly stop being `token-maker`, `ramp`, `recursion` | 379 |

A guard that fixes one rule and breaks another is not a shared guard. So
`NOT_LANDCYCLING` is targeted at the two ramp rules whose object is a land,
where landcycling is the only thing it can reach.

**And it is deliberately NOT on the tutor rule.** Landcycling's object is a
land, so `LAND_OBJECT` already refuses all 54; adding the discard guard there as
well cost **23 real tutors**, because TRANSMUTE is the same "{cost}, Discard
this card: Search your library for…" shape — Muddle the Mixture, Dizzy Spell,
Dimir Machinations, Drift of Phantasms. Found by diffing the corpus after the
guard was added, and removed again.

---

## 3. A tax names whose spells it taxes

`stax` held **93 cards, 80 as primary**, against an archetype target of 12 — and
it found **8 of the format's 39 canonical prison pieces** while a fifth of what
it did find was reminder text.

### The subject

```
/\b(spells? cost|abilities? cost) \{\d+\} more to (cast|activate)/
```

The noun and the verb must be ADJACENT. Thalia says *"Noncreature spells cost
{1} more to cast"* and matched. **Grand Arbiter Augustin IV** says *"Spells
**your opponents cast** cost {1} more to cast"* — he names the subject, the
subject sits between the noun and the verb, and the format's best-known stax
commander derived `role=synergy, produces=[], wants=[]`. **His commander prompt
offered exactly two semantics, "Humans" and "Advisors" — his creature types. A
stax commander was invisible to the model.**

**This needs nothing from `token-subject.ts`, and the reason is worth stating.**
That file answers *whose TOKENS are these*, which is a possession test over a
creation verb and is necessarily spelled as a REFUSAL — a token given away is
not yours. *Whose SPELLS* is not a refusal at all: a tax on your opponents and a
symmetric tax on everyone are **both** stax, and Sphere of Resistance taxes you
too. The rule only has to let the subject clause EXIST. **A window, not a
subject test.**

48 cards carry a `cost {N} more` clause. The rule now reaches all 37 that are
taxes. The 11 refusals are the argument:

- **The ward shape, 12 cards.** *"Spells your opponents cast **that target this
  creature** cost {2} more"* is a pseudo-ward stapled to a fatty — Icefall
  Regent, Sphinx of New Prahv, Boreal Elemental, Elderwood Scion, Esior, Pursued
  Whale. That is protection. A deck told it holds six prison pieces it does not
  have will cut a real one to make room.
- **The card taxing itself**, where "costs {1} more" is a printed cost: Fireball,
  Launch the Fleet, Vanish into Eternity, Dragon's Prey.
- **"cast this way"**, 3 cards, where the tax rides on the card's own
  impulse-draw clause.
- **`spells you cast cost`** — Geist-Fueled Scarecrow taxes its own controller.
  A drawback is not a prison.

### Split second is a note about the stack

```ts
{ role: 'stax', test: /players can't\b/i }
```

fired on **Split Second reminder text**: *"(As long as this spell is on the
stack, players can't cast spells or activate abilities that aren't mana
abilities.)"*

**23 cards, 16 with `stax` as their primary role** — a fifth of the entire
stax-primary pool, and they are fogs and instants: Angel's Grace, Krosan Grip,
Sudden Death, Wipe Away, Extirpate, Trickbind, Sudden Spoiling.

The guard is the four words the templating always puts in front, and it is
exact: **23 dropped, all 23 split second, and no split-second card leaks
through.** A lookbehind on the phrase rather than a search for the words "split
second", because Molten Disaster and Shadow the Hedgehog carry the reminder
without the keyword.

### The prison the role had no template for

Eight rules, each swept over the corpus with every match read by hand.

| rule | matches | new | representative |
|---|---:|---:|---|
| plural-possessive untap lock | 26 | 26 | Back to Basics, Meekstone, Hokori, Choke, Rising Waters |
| `players skip their` | 2 | 2 | Stasis, Eon Hub |
| the attack tax | 16 | 16 | Propaganda, Ghostly Prison, Sphere of Safety, Norn's Annex |
| `Activated abilities of X can't be activated` | 18 | 17 | Null Rod, Cursed Totem, Collector Ouphe, Stony Silence |
| `your opponents can't cast` | 34 | 34 | Drannith Magistrate, Grand Abolisher, Void Winnower |
| the spell-count lock, with a subject | 9 | 2 | Ethersworn Canonist, Curse of Exhaustion |
| `no more than one creature can attack` | 5 | 5 | Silent Arbiter, Dueling Grounds |
| `don't cause abilities to trigger` | 5 | 5 | Torpor Orb, Hushwing Gryff |

Three anchors are load-bearing and each was found by widening and reading:

- **`Activated abilities of`.** A bare `can't be activated` is 74 cards and 42
  are Pacifism-shaped AURAS, which answer one creature and are removal.
- **`unless their controller pays`.** A bare "can't attack … unless … pays" adds
  six, four of them Auras on one creature (Brainwash, Cowed by Wisdom).
- **The subject on the spell-count lock.** Without it the rule also reads
  Yawgmoth's Agenda, Colfenor's Plans, Moderation, Hedonist's Trove and Conduit
  of Worlds, every one of which says *"**YOU** can't cast more than one spell"* —
  a drawback paid for an engine, the opposite of a lock on the table.

And two whole shapes were measured and refused:

- **`enters tapped`** (Kismet, Root Maze) is 572 cards and 500 of them are dual
  lands.
- **`counter it unless that player pays`** (Nether Void) is 90 cards and ~85 are
  WARD on a creature, which is protection.

### The residue, named

`stax` goes **93 → 197 holds, 80 → 178 primaries**. Still unreached, because
each is a one-off mechanism with no template to share: **Smokestack, Tangle
Wire, Trinisphere, Blood Moon, Chalice of the Void, Kismet, Root Maze,
Contamination, Aven Mindcensor.** Nine cards. That is exactly what
`CURATED_OVERRIDES` exists for, and a regex per card is a lookup table with
worse ergonomics and no owner. The table is keyed by oracle id and real card
data now exists, so the blocker its docblock names is gone; populating it is
`DOM-04`'s job and is not done here.

**Armageddon stays `board-wipe` and Elesh Norn stays `anthem` on purpose.** Both
hold their role correctly. Which one COUNTS is a precedence question, not a rule
question, and neither is worth reordering the answer band for.

---

## 4. `ROLE_PRECEDENCE`, re-derived again — and the two type roles split

ADR-0054's principle, unchanged: ***if this card were cut, which of its jobs
would the deck have to go and replace?***

That ADR argued `ramp`, `token-maker` and `tutor` down past the answer block and
**never looked at the two roles left sitting below `protection`.**

**193 of the corpus's 620 Equipment were counted as something else.** Batterskull
was `token-maker`; Sword of the Animist was `ramp`; Kaldra Compleat, Shadowspear,
Sword of Feast and Famine and Lightning Greaves were `protection`; Sword of Fire
and Ice was `spot-removal`.

**The sharp consequence:** Quickbuild's answer to *"5 more ramp"* in a mono-white
deck was **Orcrist, Bitterthorn and Sword of Wealth and Power**. The whole
`fills-ramp` group held eight Equipment and one Aura, no rocks and no lands.

Cut Sword of the Animist and the deck replaces an **Equipment**. The Landfall
trigger is compensation the card pays for costing a card and three mana, in
exactly the sense Pongify's Ape is — ADR-0054's own sentence, one role over.

### The two are not ordered together, and the corpus is the argument

81 cards hold one of these type roles AND an answer role. The question has one
answer for the Equipment and two for the Auras.

- **The 39 Equipment are unanimous.** Viridian Longbow, Heartseeker, Mortarpod,
  Arc Spitter, Heavy Arbalest, Thornbite Staff, Razor Boomerang, Sword of Fire
  and Ice, Blazing Torch, Argentum Armor, Worldslayer. Every one is a package
  that needs a creature, an equip cost and a turn before it answers anything.
  Nobody plays a Longbow as their removal.

- **The 42 Auras split about in half.** Chained to the Rocks, Ossification, On
  Thin Ice, Faith Unbroken, Sheltered by Ghosts, Buried in the Garden and
  Dimensional Exile are Oblivion Ring wearing a different type line — the card's
  whole function is that a permanent is gone. Against them sit the pinger Auras
  (Hermetic Study, Quicksilver Dagger, Fire Whip, Lavamancer's Skill), which read
  exactly like the Equipment.

Where one order cannot be right for both halves, it keeps the **scarcer, more
specific claim** — ADR-0037's stated reason for putting `graveyard-hate` above
`spot-removal`. And the measurement makes it concrete: **`aura` above the answer
block moves Frogify, Ichthyomorphosis, Kasmina's Transmutation, Song of the
Dryads and 66 more OUT of `spot-removal`**, which is the defect §5 of this same
ADR is fixing. Mono-blue holds 84 removal primaries against mono-red's 960, so
it is precisely the colour that cannot afford to have its answers filed under
their card type.

```
land, sac-outlet, equipment,
board-wipe, graveyard-hate, counterspell, spot-removal, bounce, stax,
aura, ramp, token-maker, tutor, recursion,
protection, anthem, evasion, draw, wincon, synergy
```

`sac-outlet` still leads both, untouched, for ADR-0054's stated reason: Rakdos
Riteknife and Junk Jet are outlets whose body happens to be an Equipment, and a
deck has many ways to kill a creature and few repeatable ways to make its own
die on demand.

**356 commander-legal cards change primary role from the reorder alone.**

| from → to | cards |
|---|---:|
| token-maker → equipment | 93 |
| protection → aura | 59 |
| token-maker → aura | 54 |
| spot-removal → equipment | 40 |
| protection → equipment | 39 |
| recursion → aura | 26 |
| ramp → aura | 22 |
| ramp → equipment | 14 |
| recursion → equipment | 3 |
| board-wipe → equipment (Worldslayer, Mjölnir) | 2 |
| stax → equipment (Conqueror's Flail, Godsend) | 2 |
| tutor → aura (Infectious Bloodlust) | 1 |

`equipment` goes **427 → 617 primaries of 619 holds**; the two exceptions are
the sac outlets, which is the ruling working rather than failing. `aura` goes
**1,019 → 1,151**.

ADR-0054's own "named and unmoved" list was re-checked and is still unmoved:
Cultivate, Sol Ring, Bitterblossom, Doubling Season, Goblin Bombardment,
Chatterfang, Beast Within, Pongify — and **Skullclamp, still `equipment`**,
which is ADR-0031's stated correct-but-surprising case.

The playtest independently confirmed that ADR-0054's demotion of `token-maker`
is holding: a tokens deck finished 22/14 on its `token-maker` target with
sensible cut hints. This extends that ruling rather than reversing it.

---

## 5. An answer that answers several is still an answer

Four rules, one sentence: a literal where the sibling read a class.

**Quantified targets.** `destroy target` and `exile target` wanted the verb and
the word "target" adjacent, so every answer that answers more than one thing
fell to the catch-all: By Force, Heliod's Intervention, Force of Vigor, Dregs of
Sorrow, Violent Ultimatum, **Curse of the Swine** ("Exile X target creatures",
which the report found absent from `fills-spot-removal` entirely), and the
60-odd "destroy up to one target" creatures — Noxious Gearhulk, Skyclave
Apparition, Cavalier of Dawn. Both rules read the shared `QUANTIFIER`, and both
GUARDS are untouched, so "exile up to one target creature you control" is still
a blink and ADR-0048's measured refusal of the symmetric flickers stands.

**X in the single-target damage rule.** The mass-damage rule reads
`(X|[2-9]|\d{2,})` and states its reason in one sentence — *"X is included
because it has no cap."* The single-target rule read a bare `\d+`. 171 cards:
Blaze, Lava Burst, Devil's Play, Fireball, Volcanic Geyser, Electrodominance,
Bonfire of the Damned. There is no second argument to make; the first one covers
both.

**Blue's real removal.** Mono-blue held **46** `spot-removal` primaries against
mono-red's **853**, and the gap was mostly bookkeeping: blue does not destroy a
creature, it turns it into a Frog. 34 neutralisation Auras were `aura` and
nothing else — Frogify, Ichthyomorphosis, Kasmina's Transmutation, Witness
Protection, Kenrith's Transformation, Reprobation, Utter Insignificance — and
**Imprisoned in the Moon** and **Song of the Dryads**, the premier catch-all
answers to a permanent of ANY type, were `ramp` and `aura`. Imprisoned in the
Moon ranked 29th in `fills-ramp` because the ramp rule fired on the `{T}: Add
{C}` the card grants to the permanent it is imprisoning.

Two shapes, because they are two claims: an enchanted permanent that LOSES ALL
ITS ABILITIES is answered, and one that IS A LAND now is answered more
completely still.

**Anchored to the start of a line**, which is the only thing that separates the
Aura's own static ability from a clause it QUOTES: Bronzehide Lion returns as an
Aura granting `"{G}{W}: Enchanted creature gains indestructible"` and then loses
*its own* other abilities.

**The one-shot version is refused, 40 cards.** *"Until end of turn, target
creature loses all abilities and becomes a green Elk"* — Turn to Frog, Snakeform,
Humble, Ovinize, Gift of Tusks — is a combat trick, and the creature is back next
turn. That is ADR-0037's stated reason for putting `bounce` below `spot-removal`.
Oko's +1 is the one real loss inside that 40 and it is left, named, rather than
admitted with 39 tricks behind it.

Mono-blue `spot-removal` primaries: **46 → 84**.

**Left standing and named:** Mindbreak Trap ("Exile any number of target
spells") now reads as removal. Six cards of that shape were already reading that
way before this change (Spell Queller, Aven Interrupter, Ashiok's Erasure), so
whether an exiled SPELL is removal or a counterspell is a pre-existing ruling
with its own shape, and this is not the commit to settle it in passing.

`Imprisoned in the Moon` keeps `ramp` in its role SET, because the card does not
say whose permanent it enchants and no rule can read what is not written. Its
primary is now `spot-removal`, which is what the meters and Quickbuild see.

---

## 6. Two more from the second report

**`protection` is derived from an opponent's tokens — the subject question's
fifth table.** `Hunted Horror` — *"When this creature enters, **target opponent**
creates two 3/3 green Centaur creature tokens **with protection from black**"* —
held `roles: [protection, evasion]` with `protection` as its PRIMARY, and was
offered to a mono-black-heavy Teysa deck under "fills protection gap". The
protection is on the two bodies the opponent just got.

ADR-0054 fixed this shape in three files and built `token-subject.ts` precisely
so a fourth would not write it out privately. So this reads that file's list:
`OPPONENT_SUBJECT` is now exported from it as a POSITIVE fragment, and
`NOT_AN_OPPONENT` is rebuilt from the same fragment, so a determiner added to
one is added to both.

The refusal is scoped to the creation CLAUSE, not to the card. **The Sentry,
Golden Guardian** also donates an indestructible token and correctly keeps
`protection`, because its own first line is "Flying, vigilance, indestructible" —
the clause is the unit, never the card. One card in the corpus changes.

**`Toxic Deluge` is not a board wipe** — and the playtest asked the right
question: was `-X/-X` excluded deliberately, or covered by the reasoning and not
implemented?

**Covered and not implemented.** The rule's own comment says the two must agree:
*"a mass -X/-X is a number against toughness exactly as damage is, so it cannot
have a different threshold"* — and the damage rule it is comparing itself to
admits X and says why. The regex then used a different alphabet from the comment
above it.

8 cards, every one a real wipe: Toxic Deluge, Bane of the Living, Kagemaro,
Cloudkill, Terror Tide, Deluge of Doom, Ichor Explosion, Tip the Scales. **The
threshold is untouched**, so the 19 cards printing -1/-1 or -X/-0 — Shrivel,
Night of Souls' Betrayal, Meishin, Bone Flute — stay out for the reason they were
already out. X is unbounded, which is why it belongs above the threshold rather
than beside it.

---

## 7. Corpus effect, whole branch

31,782 commander-legal cards. **1,048 change primary role.**

| role | primaries before | after |
|---|---:|---:|
| spot-removal | 2,563 | **2,873** |
| token-maker | 2,358 | 2,166 |
| draw | 2,035 | 2,048 |
| ramp | 1,431 | 1,384 |
| aura | 1,019 | **1,151** |
| protection | 993 | 886 |
| equipment | 427 | **617** |
| board-wipe | 509 | 515 |
| sac-outlet | 464 | 482 |
| stax | 80 | **178** |
| tutor | 166 | 170 |
| synergy | 11,568 | **11,233** |

`synergy` — the honest catch-all, and the number to watch — falls by 335.
`tutor`'s primaries barely move but its MEMBERSHIP turns over completely: 45
real tutors in, 71 landcycling and land-fetch cards out, 11 of those to `ramp`
where the product owner's ruling puts them.

## 8. Consequences

- **`roles` and `primary_role` are stored columns. This needs a cards
  re-ingest. No migration.**
- `token-subject.ts` gains one export and has its determiner list written once
  instead of twice. That file is owned by another task in flight; the change is
  additive and the existing `CREATES_FOR_YOU` semantics are unchanged.
- `CURATED_OVERRIDES` is still empty, and §3 names nine cards that now have a
  reason to be its first entries.
- Every assertion added here was mutation-checked: 30 mutations, 30 killed, and
  the harness aborts rather than scoring when a mutation changes no bytes.
