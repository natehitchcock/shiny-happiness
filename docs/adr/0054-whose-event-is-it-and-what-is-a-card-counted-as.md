# 54. Whose event is it, and what is a card counted as

Date: 2026-09-02

## Status

Accepted.

> **Number 0054 was assigned to this work.** Agents have collided twice by
> deriving a "next free" number from the directory listing; do not do that. The
> next agent should be told a number rather than reading one.

Amends [ADR-0031](0031-a-card-is-offered-under-the-role-it-is-counted-as.md)
(§3 below) and extends [ADR-0022](0022-synergy-events-have-a-subject.md) (§1).

## Context

A playtest found five domain-side defects and left one open question. Two
further reports came from the product owner while the work was in progress. All
eight are in `packages/domain`; the UI was a symptom in every case.

The eight are not one defect, but three of them rhyme, and the rhyme is worth
naming up front: **the product kept describing a card by something that is true
of it rather than by the thing that makes it worth a slot.** Forbidden Orchard
makes tokens — for somebody else. Beast Within makes a token — while being the
best removal spell in its colours. Every Elf is an Elf — and only the lords do
anything about it.

## Decision

### 1. A token given to an opponent is not one of yours

`Forbidden Orchard` — "Whenever you tap this land for mana, **target opponent**
creates a 1/1 Spirit" — derived `token`, `sacrifice-fodder`, `subtype:spirit`
and the role `token-maker`. An aristocrats deck was told those bodies were its
own; ADR-0048's subtype tags multiplied it, so `Hunted Horror` claimed
`subtype:centaur` and `Hunted Troll` claimed `subtype:faerie` and
`ability:flying`.

ADR-0022 already settled this shape for two other verbs. Its sentence is the one
that applies here: **the rules ask for the subject, not for the word.** Scryfall
templating makes the subject readable — a bare "Create a 1/1 Soldier token" is
addressed to you, and "<somebody> creates a 1/1 Soldier token" names its subject
and inflects the verb.

**Four rule tables in three files had made the mistake independently**, so the
subject test lives once, in `token-subject.ts`, and is read by `synergy.ts`'s
`token`, `sacrifice-fodder` and `artifact-etb` rules, by `semantic-tokens.ts`'s
subtype and keyword clauses, and by `role-derivation.ts`'s `token-maker`.

**A REFUSAL, NOT A SUBJECT SPLIT**, and this is where it diverges from ADR-0022.
That ADR split `discard` and `sacrifice-fodder` because the opponent side was a
whole archetype: 481 producers against 30 payoffs, and the producer clause is
*why the card is played*. Here:

| | count |
| --- | --- |
| cards whose only creation clause names an opponent | 33 |
| cards that pay off an opponent getting a creature | 7 |

Seven is thin — thinner than the ten ADR-0048 accepted for `opponent-mill` — but
the number is not what decided it. **Every one of the 33 producers is played *in
spite of* the clause, not for it.** Hunted Horror is a 7/7 for two mana and the
Centaurs are the cost; Forbidden Orchard is a dual land and the Spirits are the
cost. A tag would report Pongify as a Suture Priest enabler, which is a true
sentence about the wrong card, and would put 45 removal spells into a "gives
opponents bodies" family. The door is named rather than closed: the tag would be
`opponent-token`, and it would have to clear the bar this paragraph sets.

**"Its controller creates" was tried and refused**, at ~74%. It is the removal
shell — "Destroy target permanent. Its controller creates a 3/3 Beast" — and it
looks like the same defect. It costs 54 further cards, of which **at least 14
hand the token to you**: a symmetric wipe's controller is also you (March of
Souls, Rampage of the Clans, The Phasing of Zhalfir), Descent of the Dragons and
Terastodon are pointed at your own board on purpose, and Bramble Sovereign,
Genesis Chamber, Dual Nature, Parallel Evolution, Seed the Land, Saw in Half,
Fractured Identity and Yes Man are token engines outright. ADR-0022 made the
same refusal one verb over — "'its controller sacrifices' was tried and rejected
at ~53%".

**The determiner is load-bearing**, and was found by diffing the corpus. A bare
`\bopponents?\b` in the window reads three cards wrong, all the same sentence:
"Whenever a player attacks ONE OF YOUR OPPONENTS, that attacking player
creates…" (Combat Calligrapher, Ellie Brick Master, Jolene). There the opponent
is the OBJECT and the creator is usually you.

**33 commander-legal cards change**, every one read by hand: Forbidden Orchard,
the six Hunted creatures, Clackbridge Troll, Akroan Horse, Captive Audience,
Phelddagrif, Questing Phelddagrif, Hungry Lynx, Ox Drover, Pursued Whale,
Slaughter Specialist, Wedding Ring, Wanted Scoundrels, Vazi, Erestor, Ingenious
Mastery, Overencumbered, Life of the Party, Haunted Angel, Goblin Spymaster,
Bloodvial Purveyor, Hansk, Baffling End, Dowsing Dagger, Phantasmal Sphere, The
Sentry, Tribute to Horobi, Rasputin. **Nothing changes on the `wants` side**,
which was the direction-inversion risk: the clause is still stripped before the
payoff rules read it, so refusing to claim the Faeries does not turn Hunted
Troll into a card that wants them.

Rasputin is the case that shows the unit is the CLAUSE: he makes Knights for
himself and Goblins for everyone else, and he keeps `token`,
`sacrifice-fodder` and `subtype:knight` while losing `subtype:goblin`.

**Found and deliberately not done.** The `treasure` producer is
`/\bTreasure token/i` — a noun with no creation verb in it — so Erestor,
Ingenious Mastery and Wanted Scoundrels still claim to make you Treasure they
give away. Three cards, and fixing it means restructuring a rule that also has
to keep reading "sacrifice a Treasure token" and "Treasure tokens you control".

### 2. `ROLE_PRECEDENCE`, re-derived, with a principle

`token-maker` sat at index 3, above the whole answer block. So:

| card | roles | primaryRole |
|---|---|---|
| Rapid Hybridization | spot-removal, token-maker | **token-maker** |
| Pongify | spot-removal, token-maker | **token-maker** |
| Beast Within | spot-removal, token-maker | **token-maker** |

ADR-0031 made a card *offered* under the role it is *counted* as, so none of the
three ever counted against a spot-removal target and none was ever offered under
one. The playtest saw Nature's Claim and Feed the Swarm read "fills spot-removal
gap" while Beast Within — the best catch-all removal in those colours — read
"curve fit at 3". `role.ts`'s own comment named Beast Within as "spot-removal
*and* makes a token" and then ordered it the other way; the comment's whole
argument is about the answer block's INTERNAL order, and `token-maker` sitting
above that block had never been argued at all.

**THE PRINCIPLE: if this card were cut, which of its jobs would the deck have to
go and replace?** That is what a composition target means. The meter says "you
are four short of removal", so a card offered to close it has to be one that
answers something.

Read against that question, three of the four roles above the answer block are
wrong:

- **A card that ANSWERS something and also leaves a body, a Treasure or a land
  behind is bought for the answer.** The rider is compensation the card pays for
  its own effect: Pongify leaves an Ape, Deadly Derision leaves a Treasure,
  Kayla's Command's "search for a basic Plains" mode is not why it is in a deck.
  So `token-maker`, `ramp` and `tutor` move BELOW the answer block.

- **`sac-outlet` does NOT move**, and that is the argued half. Its removal is not
  a rider — it *is* the outlet. Goblin Bombardment, Blasting Station, Attrition
  and Stronghold Assassin spend one of your own creatures to kill something, so
  the two roles are one ability, and the job with no substitute is the outlet: a
  deck has many ways to kill a creature and few repeatable ways to make one of
  its own die on demand. 54 cards stay.

- **`ramp` falls below `sac-outlet`** as a consequence, and that is a correction
  rather than a side effect: Ashnod's Altar, Phyrexian Altar, Krark-Clan
  Ironworks and Skirk Prospector were all counted as RAMP. 26 cards, every one
  named for the outlet.

The answer block moved as a block; its internal order is ADR-0037's, untouched.

```
land, sac-outlet,
board-wipe, graveyard-hate, counterspell, spot-removal, bounce, stax,
ramp, token-maker, tutor, recursion,
protection, equipment, aura, anthem, evasion, draw, wincon, synergy
```

**336 commander-legal cards change primary role.** Every move, by class:

| from → to | cards |
|---|---:|
| token-maker → spot-removal | 128 |
| ramp → spot-removal | 70 |
| token-maker → board-wipe | 42 |
| ramp → sac-outlet | 26 |
| token-maker → counterspell | 18 |
| token-maker → graveyard-hate | 12 |
| token-maker → bounce | 10 |
| ramp → board-wipe | 9 |
| ramp → graveyard-hate | 8 |
| ramp → counterspell | 8 |
| tutor → spot-removal | 5 |
| tutor → bounce, ramp → bounce, tutor → board-wipe, tutor → counterspell | 2 each |
| sac-outlet → … | 0 |
| tutor → stax | 1 |

Net: spot-removal +204, board-wipe +44, counterspell +28, sac-outlet +26,
graveyard-hate +20, bounce +14; token-maker −224, ramp −123, tutor −12.

Named and moved: Rapid Hybridization, Pongify, Beast Within, Generous Gift, Crib
Swap, Resculpt, Ravenform, Angelic Ascension, Bovine Intervention, Stroke of
Midnight, Secure the Scene, Reduce to Memory, Swan Song, Sublime Epiphany,
Summoner's Bane and Crush Dissent become answers; Ashnod's Altar, Phyrexian
Altar, Krark-Clan Ironworks and Skirk Prospector become outlets; Deadly
Derision, Contract Killing, Crack Open and Deathsprout become removal.

Named and unmoved: Cultivate, Sol Ring, Bitterblossom, Ophiomancer, Doubling
Season, Goblin Bombardment, Blasting Station, Attrition, Chatterfang, and
Skullclamp (still `equipment`, which is ADR-0031's stated
correct-but-surprising case).

**A latent `board-wipe` false positive had to be fixed with it.** Nine cards
destroy the tokens THEY made — Saproling Burst, Sengir Autocrat, Tombstone
Stairwell, Drudge Spell, Dual Nature, Faerie Artisans, Arcane Artisan, Abyssal
Harvester, Shaun — and read as wipes. This was invisible while `token-maker`
outranked `board-wipe`; moving the answer block up would have shipped nine cards
counted as board wipes. The guard asks for a QUALIFIED token clause, because
Aether Snap's bare "exile all tokens" takes everyone's and is a real sweep.

**Nothing in the suite was pinning the old order** — ADR-0031's finding, one file
over. Twenty-four assertions now do.

### 3. The suggestion feed reads type gaps (amends ADR-0031)

```ts
for (const deficit of deficits) {
  if (deficit.dimension.kind === 'role') deficitByRole.set(deficit.dimension.role, deficit)
}
```

Type dimensions were dropped on the floor. `type:creature` is a composition
target and is the second-largest gap on an empty midrange deck, at 31 short —
and it made no `fills-creature` group, contributed no `fills-deficit` reason and
never reached the `w.fill` score term. `quickbuild.ts` reads the same targets
correctly and said "25 more creature" at the same moment the feed had no
creature gap at all. Doc 19 D2 says Quickbuild is a *view* over the
recommendations and never a second scorer, which is what makes the feed the side
that was wrong.

**This amends ADR-0031 rather than contradicting it.** That ADR's ruling was
that grouping and counting must be the same question, and it stated the rule in
terms of `primaryRole` because roles were all the grouping could see. The rule
it was really making is the one now in force: **a card is offered under a
dimension it is counted under**, and `dimensionKeysOf` — the single statement of
"one role and each of its types", which the meters and the web app's gold
overlay already read — is what says which those are.

**The role gap wins; the type gap is the fallback.** That is P4's reasoning and
the same one the emission-order note gives for letting a combo group keep a
staple: the more specific claim about THIS deck wins the card. "You are six
short of removal and this creature is removal" tells the builder something; "you
are thirty-one short of creatures and this is a creature" is satisfied equally
by every creature in the format.

Worst-first was written, measured and REJECTED. `shortfalls` already orders the
gaps worst first, so it was one line, and it matched Quickbuild's
`largest-first` regime. It is also wrong: a type gap is ~31 on an empty deck and
no role gap is close, so every creature is swallowed by `fills-creature` and the
role headings are emptied of creatures. Measured on five real commanders it
moved 1,232 cards out of six role headings into one that says nothing about any
of them — `fills-ramp` with no mana dorks, `fills-spot-removal` with no
creatures that answer permanents.

Measured over the whole eligible pool:

| commander | `fills-creature` | `other` | `high-synergy` |
|---|---:|---|---|
| Ezuri, Renegade Leader | 2,783 | 4,545 → 2,018 | 558 → 302 |
| Meren of Clan Nel Toth | 5,304 | 8,152 → 3,437 | 835 → 246 |
| Krenko, Mob Boss | 2,660 | 4,551 → 2,051 | 323 → 163 |
| Talrand, Sky Summoner | 2,449 | 3,981 → 1,605 | 728 → 655 |

No web change was needed: `App.tsx` already reads a `fills-` key back with
`dimensionName` and looks it up in `analysis.deficits`.

The group key stays `fills-<name>` rather than moving to `dimensionKey`'s
prefixed form, because the key is a wire contract the app already parses, and
only `type:creature` is ever a target so no type name collides with a role name.
`land` is both a role and a card type and would collide if a `type:land` target
were ever added; noted here rather than guarded, because a guard for a target
nobody has written is a branch no test could fail on.

### 4. `high-synergy` stops asserting a popularity statistic

`rationaleFor('high-synergy')` returned *"Played far more in this commander than
in decks generally."* ADR-0008 removed the only source this product had for
that, `stats` is null in production, and the group is filled entirely by
`MECHANICAL_SYNERGY_THRESHOLD`. The playtest saw "High synergy 398" full of
lands whose own reasons read "benefits from your untap".

Four lines below, the `other` branch already carried a comment about this exact
bug being found and fixed *there* — "a claim about popularity made over a list
that was not sorted by any (P4)". The identical mistake survived one line up.

> Mechanically matched to what your deck already does or wants — each row names
> the event. Not a measure of how often anyone plays them.

It says what the group IS rather than only avoiding what it is not, and it points
at the per-row reasons, which are the evidence. `top-<type>` keeps "Most played
for this commander, by card type" and is not the same defect: that group is only
ever built inside `if (statsAvailable)`.

### 5. A lord is a payoff, not another body

`synergyMatches` pushed the `enables` loop before the `payoff` loop and sorted
by weight alone. `Array.prototype.sort` is stable, so an exact tie kept the
first-pushed — and the tie is not an edge case: a commander who both IS an Elf
and WANTS Elves puts `COMMANDER_WEIGHT` into `has` and the same into `wants`, so
every lord ties with itself. `recommend` emits one reason, so the weaker half
was always the one shown.

Measured on Ezuri, Renegade Leader with `subtype:elf` emphasised, over the whole
eligible pool:

| | before | after |
|---|---:|---:|
| Elf-typed rows reading `enables` | 167 | 122 |
| Elf-typed rows reading `payoff` | 0 | 45 |

**PAYOFF LEADS**, and the argument is about how much the sentence tells you: in a
tribal deck every creature of the type supplies the tag and only the lords
consume it, so "pays off your Elves" distinguishes the card from its neighbours
and "is another Elf" does not. `theme` is last, for the reason `THEME_WEIGHT`
already gives.

**WITHIN ONE TAG ONLY**, measured rather than assumed. A global direction
tie-break was written first: across four real decks it moved 87 rows instead of
48, and the extra 39 were CROSS-TAG — a sac outlet in a Meren deck lost "enables
your creature-death" to "pays off your Humans". Two readings of one tag are two
ways of saying one thing and one is more informative; two different tags are two
different claims. So the tag's first-appearance order is an explicit sort key
ahead of the direction, and cross-tag ordering at equal weight is unchanged.
Re-measured: 48 rows change, all `subtype:elf/enables → subtype:elf/payoff`.

Display only. `synergyScore` sums every match and is untouched.

### 6. Impact breaks a score tie

The playtest suggested impact as a tiebreak rather than a score term, and the
measurement supports it. Over four real commanders, **2,547 of the 2,617 emitted
rows — 97.3% — sit inside a run of identical scores**, and 147 of the 182 runs
hold cards whose impact differs by more than half a point. `Dwynen's Elite`
(impact 0.5) and `Lluwen` (11.52) tied at 1.4597; four Elf lords tied at 1.417
with `Ezuri, Renegade Leader` (9.6) fourth of four. The tie was settled by
`edhrecRank` — a popularity number from Scryfall that ADR-0008 already ruled this
product does not reason from.

**A TIE-BREAK AND NOT A TERM.** A term would move cards past cards the score
genuinely separates, which is a much larger claim and one nobody has made. A
tie-break is only consulted where the ranking has already said two cards are
equal.

**IT ORDERS THE PAGE; IT DOES NOT CHOOSE THE PAGE.** Only rows inside the first
`limitPerGroup` are touched, so a tied card at position 500 does not climb into
the window. That is the conservative reading and also the only affordable one:
reordering whole equal-score runs took `recommend` from 130 ms to 320 ms against
doc 11's 200 ms budget, because the biggest groups hold single runs thousands of
rows long. Clamped to the window it is free — A/B in one process, over the whole
eligible pool: Ezuri 52 → 64 ms, Meren 76 → 75 ms, Kenrith (31,769 eligible)
130 → 132 ms.

`cardImpact` is now memoised per call, which also removes a double computation
the query path was already paying.

Effect: 2,254 of 2,617 emitted rows change position, 55 of 56 groups reorder,
and 24 groups get a new leading row — every one a higher-impact card than the
one it replaced.

### 7. `ritual` — mana you get once

> "add mana needs to be a semantic. if I want more cards like dark ritual, I need
> a semantic to focus"

**A broad `mana` tag is refused.** 2,402 commander-legal cards add mana: 1,141
lands, 576 creatures, 451 artifacts, 122 instants and sorceries. Half of what
such a tag would carry is the mana base, which the owner explicitly did not want
tagged.

**What `ritual` adds that the `ramp` ROLE does not**, which is the question that
had to be answered before adding anything:

1. A role is a PARTITION for counting — exactly one per card — so `ramp` holds
   Sol Ring, Cultivate, Llanowar Elves and Dark Ritual in one bucket of 1,385. A
   tag is not exclusive and is matched in both directions.
2. **A role cannot be emphasised at all.** `emphasis` reads `SynergyTag`, never
   `Role`, so "this deck is about rituals" was not expressible.
3. Neither the role nor any existing tag can say the thing that makes a ritual a
   ritual: **the mana does not come back next turn.** A Signet and a Dark Ritual
   are the same role and opposite cards.

75 producers in two shapes — a one-shot spell that adds two or more (Dark
Ritual, Seething Song, Pyretic Ritual, Rite of Flame, Manamorphose, Culling the
Weak) and a permanent that eats itself for two or more (Lion's Eye Diamond,
Krark-Clan Ironworks, Ashnod's Altar, Basal Thrull, Lotus Bloom) — against 96
payoffs: storm, read by its reminder text rather than the word because 20 cards
have "Storm" in their NAMES, and "your second spell each turn".

**Two or more is the line.** One mana for one card is a filter, not a burst;
admitting Lotus Petal pulls in the whole Egg cycle and every "sacrifice this:
add one mana of any color" fixer. Twelve cards inside the 75 are marginal in the
other direction — the Eggs and Attendants that add two but cost more than two to
use — and are left, named, because excluding them needs the card's own mana
value and these rules read text.

**14 sacrifice LANDS excluded**, found by diffing the corpus: Ebon Stronghold,
Dwarven Ruins, Lake of the Dead, Phyrexian Tower, Crystal Vein and the rest read
exactly like rituals and are still the mana base.

Paired with `spell-cast`, which reads true both ways. `ritual` ↔ `treasure` is
REFUSED: a Treasure is a stored lump of mana and the resemblance is exact for one
turn, but `treasure` is in this model as an ARTIFACT that makes mana — its pairs
are `artifact-etb` and `sacrifice-fodder` — and pairing here would offer Dark
Ritual to a Marionette Master deck.

### 8. `creature-cast`, and the sweep that found its neighbours

> "beast whisperer needs to have a semantic about benefiting from casting
> creature spells. are there more semantics like that that are missing?"

Beast Whisperer carried `card-draw` and nothing else. `spell-cast`'s producer is
"the type line says Instant or Sorcery", so a creature-cast rule could not
honestly live under it.

**The sweep**, over every "whenever you cast a <X> spell" template in the
commander-legal corpus:

| class | cards | already carrying a cast/enters want |
|---|---:|---|
| cast a CREATURE spell | 74 | 3 (4%) |
| cast an ARTIFACT spell | 31 | 2 (6%) |
| cast an ENCHANTMENT spell | 22 | 21 (95%) |
| cast your Nth spell each turn | 59 | 3 (5%) |
| `<type> spells you cast` cost/have | 80 | 29 (36%) |

Three different answers, and the enchantment row is what makes them different.
`enchantment-etb` has carried "whenever you cast an enchantment" since it was
written and covers 21 of its 22 cards; its ARTIFACT counterpart never had the
alternative. So:

- **`artifact-etb` is WIDENED**, not split. Casting an artifact and an artifact
  entering are the same deck asking the same question, and that tag already
  means that deck with 3,568 producers behind it. **36 cards gain it**: Patchwork
  Automaton, Chief Engineer, Etherium Sculptor, Sai, Foundry Inspector, Myrsmith.
- **`spell-cast` is WIDENED** to "your second/third spell each turn". That is the
  same event it already means — a count, not a card type. The old rule asked for
  "your FIRST", which was the whole vocabulary. **56 cards gain it**: Kraum,
  Lotho, Ledger Shredder, Jori En, Clarion Spirit.
- **`creature-cast` is a new tag**, because no existing tag means it and folding
  it into `creature-etb` would be a false claim: a token entering does not
  trigger Beast Whisperer, so Young Pyromancer would be offered as its enabler.
  **100 cards gain it.**

**`creature-cast` IS PAYOFF-ONLY, and the producer side is refused on a
measurement.** It would have to be "this card is a creature", which is 17,751 of
the 31,782 commander-legal cards — **55.9%**, against 33.6% for `artifact-etb`,
the widest tag any real pool carries today. It would attach "enables your
creature-cast" to every creature in the deck's colours: true of all of them, and
therefore informative about none. The sentence it would have said — "your thirty
creatures turn this on" — is already said, with a number, by the `type:creature`
composition target and the `fills-creature` group §3 gives it.

So it stands exactly where `extra-turns` stands (ADR-0048): **vocabulary and a
label rather than a score**, stated here rather than left to be discovered. It
still does the job it was asked for — emphasise `creature-cast` and the other 99
payoffs come back, and the card panel has something true to print on Beast
Whisperer.

## Consequences

- **`SynergyTag` gains two members**, `ritual` and `creature-cast` (R2). Nothing
  switches exhaustively on it. `SYNERGY_TAG_VALUES` in `query/ast.ts` derives
  from `SYNERGY_TAGS`, so `tag:ritual` works in search with no further change.
  **`EVENT_TAGS` goes from 24 to 26, APPENDED**: that array's ORDER is a
  persisted contract (migration 0014, `semantic-emphasis.ts`), and inserting in
  the middle would reorder the emphasis stored against decks that already exist.
  Appending preserves every existing tag's relative position.

- **`apps/web/src/tags.ts` gains two entries**, which its own test requires:
  "a burst of mana" and "casting creature spells". The first is not "mana"
  because the `ramp` role already covers mana in general and the tag exists for
  the half it cannot say.

- **`ROLE_PRECEDENCE` changes what every deck is told about itself.** 336 cards
  change primary role, so meters move, `fills-` groups change membership, and
  Quickbuild's gap ordering changes with them. This is the point of the change,
  not a side effect.

- **The corpus must be re-ingested.** `roles`, `primary_role`,
  `synergy_produces` and `synergy_wants` are stored columns computed at ingest,
  so §1, §2, §7 and §8 reach nothing until then. §3, §4, §5 and §6 are computed
  per request and are live at deploy.

- **`recommend`'s cost is unchanged** — 130 → 132 ms on the widest pool measured
  — and the impact cache makes the query path cheaper than it was.

- This does not make the heuristics correct, and ADR-0011's point stands: the
  curated override tables are still the answer for a card that reads wrong.

### Found, and deliberately not done

- **`treasure` still has no subject.** Three cards claim to make you Treasure
  they hand to an opponent (§1).
- **The `tutor` heuristic reads LANDCYCLING as a tutor.** "Forestcycling {2}"
  spells its reminder text as "Search your library for a Forest card", and the
  rule's lookahead only rejects the literal words "land card". Nurturing
  Bristleback, Timeless Dragon, Jeskai Monument, Kayla's Command and 16 others
  hold `tutor` for that reason. It is why `token-maker` was deliberately NOT
  moved below `tutor` in §2 — 20 cards would have moved onto a role they should
  not hold in the first place. The fix belongs to the tutor rule.
- **`opponent-token` is named but not added** (§1).
- **`ritual` producers with a mana value above what they add** — the Eggs and the
  Attendants, twelve of the 75 — are in, and excluding them needs a fact these
  text rules cannot see.
- **`apps/web/src/caching.test.tsx` fails under full-suite parallelism**, four
  tests, and passes in isolation. Verified to fail identically with this branch's
  domain changes stashed, so it is not this work; it belongs to whoever owns
  `apps/web`.
