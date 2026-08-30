# Synergy tag precision audit

**Date:** 2026-08-30
**Scope:** precision only — of the tags that WERE applied, how many are wrong.

> **Snapshot warning.** Every number here was measured against the tags stored in
> `cards.synergy_produces` / `cards.synergy_wants` in the local Postgres corpus on
> 2026-08-30. That snapshot matches ADR-0013's published figures exactly (34,492
> cards, 17,808 with at least one tag, 16,684 with none), so it reflects the
> `PRODUCES`/`WANTS` rules as they stood **before** the concurrent widening work on
> `packages/domain/src/synergy.ts`. Re-run before acting on any single number.

Method: for each of the 14 tags, in both directions, a seeded random sample of 25
tagged cards (`setseed(0.42)`, `ORDER BY random() LIMIT 25`) was read card by card
and judged by hand against "is this card genuinely about that event, in the sense
a Commander player would mean". Where the tagged population was smaller than 25
the whole population was read. Error classes found by hand were then counted
corpus-wide with SQL, and those counts are given per rule below.

Recall is out of scope. This audit says nothing about the 16,684 untagged cards.

---

## 1. Precision table

Two precision columns where the judgement is contested. **Strict** is "a Commander
player would name this card when describing that theme". **Lenient** is "the card
literally does the thing the tag names, at least once". Where they differ, §3
explains which way each was ruled and why.

| Tag | Direction | Corpus | n | Correct (strict) | Correct (lenient) | Precision (strict / lenient) |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `plus1-counter` | wants | 563 | 25 | 7 | 7 | **28%** |
| `creature-death` | produces | 1131 | 25 | 12 | 16 | **48% / 64%** |
| `token` | wants | 745 | 25 | 4 | 15 | **16% / 60%** |
| `graveyard-creature` | wants | 446 | 25 | 14 | 25 | **56% / 100%** |
| `untap` | wants | 3801 | 25 | 17 | 25 | **68% / 100%** |
| `creature-death` | wants | 444 | 25 | 17 | 20 | **68% / 80%** |
| `lifeloss` | produces | 951 | 25 | 18 | 18 | **72%** |
| `discard` | produces | 1528 | 25 | 18 | 18 | **72%** |
| `graveyard-creature` | produces | 157 | 25 | 18 | 19 | **72% / 76%** |
| `landfall` | produces | 49 | 25 | 20 | 20 | **80%** |
| `artifact-etb` | wants | 5 | 5 (all) | 4 | 4 | **80%** |
| `lifegain` | produces | 2286 | 25 | 21 | 25 | **84% / 100%** |
| `lifeloss` | wants | 8 | 8 (all) | 7 | 7 | **88%** |
| `attack-trigger` | wants | 1848 | 25 | 22 | 22 | **88%** |
| `landfall` | wants | 221 | 25 | 23 | 23 | **92%** |
| `sacrifice-fodder` | produces | 2753 | 25 | 23 | 25 | **92% / 100%** |
| `token` | produces | 3799 | 25 | 24 | 24 | **96%** |
| `plus1-counter` | produces | 2726 | 25 | 24 | 24 | **96%** |
| `discard` | wants | 114 | 25 | 24 | 24 | **96%** |
| `untap` | produces | 291 | 25 | 24 | 24 | **96%** |
| `card-draw` | produces | 4154 | 25 | 25 | 25 | **100%** |
| `card-draw` | wants | 109 | 25 | 25 | 25 | **100%** |
| `lifegain` | wants | 92 | 25 | 25 | 25 | **100%** |
| `sacrifice-fodder` | wants | 566 | 25 | 25 | 25 | **100%** |
| `artifact-etb` | produces | 37 | 25 | 25 | 25 | **100%** |
| `treasure` | produces | 385 | 25 | 25 | 25 | **100%** |
| `attack-trigger` | produces | 0 | — | — | — | *no rule exists* |
| `treasure` | wants | 0 | — | — | — | *rule matches nothing* |

A 25-card sample gives roughly a ±18-point 95% interval at mid-range precision.
Treat the table as ordering evidence, not as three-significant-figure measurement.
Where a finding mattered it was re-counted corpus-wide; those counts are exact and
are the ones quoted in §3.

**Nine of the 26 live tag/direction pairs are at or above 96%.** Sections 3–5 list
what is actually broken; everything not listed there is in good shape (§7).

---

## 2. Structural findings (before any individual rule)

**`attack-trigger` has no `PRODUCES` rule at all.** Zero cards produce it, and
1,848 want it. Because `synergyMatches` only makes an `enables`/`payoff` match
across opposite directions, `attack-trigger` can never produce anything but a
`theme` match at `THEME_WEIGHT = 0.2`. The tag is structurally half-dead: 1,848
cards carry it and it can never lead a reason.

**`treasure`'s `WANTS` rule matches zero cards in the corpus.**

```ts
{ tag: 'treasure', test: /\bwhenever .{0,30}Treasure .{0,20}sacrificed\b/i }
```

Scryfall's actual wording is *"Whenever you sacrifice a Treasure"* and
*"Sacrifice a Treasure:"* — "Treasure" follows the verb, so the rule's word order
never occurs. 18 cards in the corpus use a genuine Treasure-payoff wording; **0**
are tagged `wants treasure`. `treasure` therefore has the mirror problem to
`attack-trigger`: producers only, no wanters, so it too can only ever theme.

**`untap`'s want/produce ratio is 3801 : 291.** The `WANTS` rule is the bare
`/\{T\}:/`. Because `theme` credits a shared want and 11% of the whole corpus
carries `wants untap`, essentially every deck will report an untap theme
regardless of what it is doing. This is a volume problem rather than a per-card
correctness problem (see §5.1).

**`artifact-etb` produces 37 cards against 5 wanters.** Precision on both is fine,
but the pair is too small to ever fire. Noted here because a reader of the table
might otherwise read "100%" as "healthy".

---

## 3. Rules with problems

Ordered worst first. Fixes are written down, **not applied**.

### 3.1 `wants plus1-counter` — 28% precision, 563 cards. Direction inversion.

```ts
{ tag: 'plus1-counter', test: /\bproliferate\b|\bwhenever .{0,40}\+1\/\+1 counter/i }
```

The second alternation matches the standard **producer** phrasing
*"Whenever \<event\>, put a +1/+1 counter on …"*. That is a card that MAKES
counters, filed as a card that WANTS them.

Corpus-wide:

| | count |
| --- | ---: |
| tagged `wants plus1-counter` | 563 |
| ...of those, matching `proliferate` | 103 |
| ...of those, matching `whenever …put… +1/+1 counter` (producer shape) | 389 |
| ...of those, **also** tagged `produces plus1-counter` | **440 (78%)** |

Offending oracle text, all four tagged `wants`:

- **Boar-q-pine** — "Whenever you cast a noncreature spell, put a +1/+1 counter on
  this creature." Makes counters. Wants nothing.
- **Lorescale Coatl** — "Whenever you draw a card, put a +1/+1 counter on this
  creature."
- **Alesha, Who Laughs at Fate** — "Whenever Alesha attacks, put a +1/+1 counter
  on it."
- **Omnath, Locus of the Roil** — "Landfall — Whenever a land you control enters,
  put a +1/+1 counter on target Elemental you control."

Of the 25 sampled, only 7 were genuine payoffs: three that key off a counter
already being there (**Marchesa, the Black Rose** — "Whenever a creature you
control **with a +1/+1 counter on it** dies…"; **Byrke, Long Ear of the Law**;
**Soulblade Corrupter**), one that keys off counters arriving
(**Fetid Gargantua** — "Whenever one or more +1/+1 counters **are put on** this
creature, you may draw two cards"), and three `proliferate` cards.

**This is the direction error the audit was asked to look hardest for, and it is
the largest single defect found.** The consequence is concrete: a deck full of
counter-producers registers a large `deck.produces['plus1-counter']`, and 440
cards that *also* produce counters then match it as `payoff` — the app pairs two
cards that both make counters and tells the user one pays the other off.

**Suggested tightening** (not applied):

```ts
// Keep proliferate. Replace the second alternation with shapes that require the
// counter to already exist, or to be arriving from elsewhere:
{ tag: 'plus1-counter', test: /\bproliferate\b/i },
{ tag: 'plus1-counter', test: /\bwith a \+1\/\+1 counter on (it|them)\b/i },
{ tag: 'plus1-counter', test: /\bwhenever (one or more )?\+1\/\+1 counters? (are|is) put on\b/i },
{ tag: 'plus1-counter', test: /\b(remove|move) (a|one or more|X|\d+) \+1\/\+1 counters?\b/i },
```

The general lesson: `whenever … <noun>` is not a want-shaped regex. `whenever` +
a *trigger condition* is; `whenever` + an *effect* is a produce.

### 3.2 `produces creature-death` — 48% precision, 1131 cards.

Three separate rules are leaking.

**(a) `destroy target creature` is removal, not a sacrifice outlet.**

```ts
{ tag: 'creature-death', test: /\bdestroy target creature\b/i }
```

**359 of the 1131** (32%) are tagged by this rule and by no sacrifice rule. These
are spot-removal spells. The app's reason string for them reads as
"enables your sacrifice fodder", which is not what a removal spell does:

- **Casualties of War** — "• Destroy target artifact. • Destroy target creature.
  • Destroy target enchantment. • Destroy target land. • Destroy target
  planeswalker."
- **Claim the Precious** — "Destroy target creature. The Ring tempts you."
- **Gloomwidow's Feast** — "Destroy target creature with flying."
- **Vote Out**, **Lethal Protection**, **Trystan's Command** (one mode of four).

A removal spell does put a creature in a graveyard, so it is not *nothing* — but
it is an opponent's creature, at instant speed, once. It does not do what an
aristocrats deck needs from `produces creature-death`, which is a repeatable
outlet for its own bodies. **Ruled wrong.** Suggested fix: **drop this rule
entirely**, or move it to a separate `removal` tag that is not paired with
`sacrifice-fodder`.

**(b) `each player sacrifices` matches non-creature sacrifice.**

```ts
{ tag: 'creature-death', test: /\beach player sacrifices\b/i }
```

The rule never checks *what* is sacrificed. **17 cards** sacrifice lands or
permanents, not creatures:

- **Epicenter** — "Target player sacrifices a land of their choice. | Threshold —
  Each player sacrifices **all lands** they control…"
- **Destructive Force** — "Each player sacrifices **five lands** of their choice.
  Destructive Force deals 5 damage to each creature."

Suggested fix: `/\beach player sacrifices (a |an |two |three |\d+ )?creature/i`.

**(c) Opponent-only edicts are not your outlet.** **67 cards.**

```ts
{ tag: 'creature-death', test: /\bsacrifice(s)? (a|another) creature\b/i }
```

matches *"each opponent sacrifices a creature"*:

- **Mogis, God of Slaughter** — "…Mogis deals 2 damage to that player unless
  **they** sacrifice a creature of their choice."
- **Tyrant's Choice** — "If death gets more votes, **each opponent** sacrifices a
  creature of their choice."
- **Rampage of the Valkyries** — "Whenever an Angel you control dies, **each other
  player** sacrifices a creature of their choice."

Suggested fix: require a self-facing subject — add a negative guard for
`(each |target )?(other player|opponent)s? sacrifices?` on that rule, or split
into a self-sac rule (`Sacrifice a creature:` as a cost, `you may sacrifice`) and
an edict rule that is not tagged `creature-death`.

Correctly tagged, for contrast: the Ashnod's-Altar-shaped cards all landed —
Brood Butcher, Thallid Omnivore, Pyre of Heroes, Gnawing Zombie, Ahriman,
Chthonian Nightmare, Tymaret, Martyr's Cause, June. The sac-outlet half of this
tag works well. It is the three extra rules bolted onto it that do not.

### 3.3 `wants token` — 16% strict / 60% lenient, 745 cards.

```ts
{ tag: 'token', test: /\bfor each creature you control\b|\bcreatures you control get\b/i }
```

**592 of the 745** (79%) never contain the word "token" anywhere in their oracle
text. Two distinct failure modes:

**(a) Tribal lords — 162 cards.** `\bcreatures you control get\b` matches
*"Other **Kithkin** creatures you control get +1/+1"*. A lord for a tribe that has
almost no tokens is not a token payoff; it wants that creature type.

- **Knight Exemplar** — "Other Knight creatures you control get +1/+1…"
- **Merrow Reejerey** — "Other Merfolk creatures you control get +1/+1."
- **Arvad the Cursed** — "Other **legendary** creatures you control get +2/+2." A
  token is never legendary, so this is a guaranteed anti-match.
- **Wizened Cenn**, **Stromkirk Captain**, **Narfi, Betrayer King**, **Reaper King**.

**(b) An anti-anthem — 4 cards.** The rule does not check the sign of the buff.

- **Geth, Thane of Contracts** — "Other creatures you control get **-1/-1**."

Geth kills 1/1 tokens on sight. The app will recommend it into a token deck.

**The judgement call, stated openly.** The remaining ~13 sampled cards are generic
whole-team pumps with no token text at all — Warrior's Charge ("Creatures you
control get +1/+1 until end of turn"), Surge of Thoughtweft, Sunblade Elf,
Steadfast Unicorn. **Is a card that pumps the whole team "about tokens"?** I ruled
these **correct** in the lenient column and **wrong** in the strict column, and I
lean toward keeping them: an anthem genuinely is better in a go-wide deck, and
`token` is this vocabulary's only word for going wide. But note what the tag then
means — "go-wide payoff", not "token payoff" — while the reason string the user
reads names tokens. If the rule stays, the reason copy should say "rewards a wide
board" rather than naming tokens.

**Suggested tightening:** require a positive buff, and reject a capitalised tribe
word before "creatures":

```ts
{ tag: 'token', test: /\b(other )?creatures you control get \+\d+\/\+\d+/i },
{ tag: 'token', test: /\bcreature tokens? you control\b/i },
{ tag: 'token', test: /\bfor each creature you control\b/i },
// plus a guard rejecting /other [A-Z][a-z]+ creatures you control get/
```

### 3.4 `produces lifeloss` — 72% precision, 951 cards. Your life is not their life.

```ts
{ tag: 'lifeloss', test: /\beach opponent loses \d+ life\b|\bloses? \d+ life\b/i }
```

The second alternation is subject-blind and matches *"**you** lose N life"* — a
cost or a drawback, not a drain. **346 of the 951** (36%) contain no
"opponent/player loses N life" phrase at all; reading them shows most are
self-payment:

- **Vampiric Tutor** — "Search your library for a card, then shuffle and put that
  card on top. **You lose 2 life.**"
- **Serpent Warrior** — "When this creature enters, **you lose 3 life**."
- **Baleful Force** — "At the beginning of each upkeep, you draw a card and
  **you lose 1 life**."
- **Delusions of Mediocrity** — "When this enchantment leaves the battlefield,
  **you lose 10 life**."
- **Jack-in-the-Mox** — "1 — Sacrifice this artifact and **you lose 5 life**."

`INTERACTION_PAIRS` has `['creature-death', 'lifeloss']` and
`['lifegain', 'lifeloss']`, i.e. `lifeloss` is modelled as the aristocrats drain.
Vampiric Tutor "enabling" Exquisite Blood is a false claim.

**Suggested tightening:**

```ts
{ tag: 'lifeloss', test: /\b(each opponent|target opponent|each player|target player|that player|its controller|defending player)s? loses? (\d+|X|that much) life\b/i }
```

...deliberately not matching a bare `you lose`. Self-life-loss *does* matter
(Gonti's Machinations, Vampire Scrivener and Oath of Lim-Dûl all trigger on it) —
but it deserves its own tag rather than being merged with drain.

### 3.5 `produces discard` — 72% precision, 1528 cards. Their hand is not yours.

```ts
{ tag: 'discard', test: /\bdiscard(s)? (a|two|X|your hand)\b/i }
```

**314 of the 1528** (21%) only ever make an *opponent* discard. That does not fill
your graveyard, does not turn on madness, and does not loot:

- **Corrupt Court Official** — "When this creature enters, **target opponent**
  discards a card."
- **Heartless Pillage** — "**Target opponent** discards two cards."
- **Scythe Specter** — "…**each opponent** discards a card."
- **Capital Punishment** — "**Each opponent** … discards a card for each taxes
  vote."

The interaction table pairs `discard` with `graveyard-creature` and `card-draw`,
i.e. it is modelled as self-discard. Opponent discard is a different card.

There is also a direction error in the sample from the same rule:
**Hobgoblin, Mantled Marauder** — "**Whenever you discard** a card, Hobgoblin gets
+2/+0" — is tagged `produces discard` because the rule matched the trigger
condition. It has no discard outlet; it is a pure payoff.

**Suggested tightening:** require a first-person subject or a cost position, and
guard against a preceding `whenever`:

```ts
{ tag: 'discard', test: /(^|[^a-z])(you may )?discard (a|two|three|X|your hand)\b/i },
{ tag: 'discard', test: /\byou discard (a|two|three|X|your hand)\b/i },
// and reject when the only match is preceded by 'whenever you discard'
```

### 3.6 `produces graveyard-creature` — 72% precision, 157 cards. A co-occurrence rule.

```ts
{ tag: 'graveyard-creature', test: /\bdies\b.{0,60}\bgraveyard\b/i }
```

This is not a rule about a mechanic; it is a rule about two words appearing within
60 characters. **52 of the 157** (33%) are tagged by it with no mill rule firing.
It catches graveyard *hate*, mere mentions, and recursion:

- **Ruin Rat** — "When this creature **dies**, exile target card from an
  opponent's **graveyard**." The opposite of filling a graveyard.
- **Grixis Sojourners** — "When you cycle this card and when this creature
  **dies**, you may exile target card from a **graveyard**."
- **Skyfisher Spider** — "When this creature **dies**, you may gain 1 life for
  each creature card in your **graveyard**." A payoff, not a filler.
- **The Master of Lake-town** — "When The Master of Lake-town **dies**, draw a
  card for each **graveyard** with seven or more cards in it." A pure mention.
- **Wretched Camel** — "When this creature **dies**, if you control a Desert or
  there is a Desert card in your **graveyard**, target player discards a card."

**Suggested fix: delete this rule.** The mill rule
(`/\bmill(s)? \d+|\bput(s)? the top .{0,30}into your graveyard/i`) was correct on
everything it caught in the sample and is doing all the useful work. If self-mill
recall needs help, extend *that* rule — it currently misses "Mill a card" and
"Each player mills a card" because it requires a digit — rather than keeping a
co-occurrence rule.

### 3.7 `produces landfall` — 80% precision, 49 cards.

```ts
{ tag: 'landfall', test: /\bplay an additional land\b|\bput(s)? .{0,30}land .{0,20}battlefield/i }
```

The `play an additional land` half is clean. The `put … land … battlefield` half
catches the Ice Age "sacrifice a land instead" template, which is net-neutral or
net-negative on land drops, plus one stax effect. **12 of the 49** are tagged
without matching `play an additional land`:

- **Kjeldoran Outpost** — "If this land would enter, **sacrifice a Plains**
  instead. If you do, put this land onto the battlefield." Net zero.
- **Scorched Ruins** — "If this land would enter, **sacrifice two untapped lands**
  instead…" Net minus one.
- **Sheltered Valley**, **Heart of Yavimaya** — same template.
- **Land Equilibrium** — "If **an opponent** who controls at least as many lands
  as you do would put a land onto the battlefield, that player instead puts that
  land onto the battlefield then sacrifices a land of their choice." A stax effect
  keyed to opponents' land drops.

**Suggested tightening:** anchor on the ramp shapes rather than the words:

```ts
{ tag: 'landfall', test: /\bplay an additional land\b/i },
{ tag: 'landfall', test: /\bput (that|those|it|them|up to \w+|a|two|three|X) (basic |tapped )*land cards? onto the battlefield/i },
// reject when preceded by "sacrifice a ... instead" or "an opponent ... would put"
```

### 3.8 `wants landfall` — 92% precision, 221 cards. Two clean bugs, tiny volume.

```ts
{ tag: 'landfall', test: /\bLandfall\b|\bwhenever a land .{0,20}enters\b/i }
```

- **The Horizon Seeker** — "(For example, flying, **landfall**, and scry count…)"
  The word appears in **reminder text as an example**. Two cards corpus-wide match
  landfall without having either the ability word or a land-enters trigger.
- **Tunnel Ignus** — "Whenever a land enters under **an opponent's** control … this
  creature deals 3 damage to that player." A punisher, not a payoff. One card.

Fix: require the ability-word form `Landfall —` (em dash) rather than bare
`\bLandfall\b`, and add `you control` / `during your turn` to the trigger half.

### 3.9 `wants creature-death` — 68% strict / 80% lenient, 444 cards.

```ts
{ tag: 'creature-death', test: /\bwhenever (a|another) .{0,40}creature .{0,20}dies\b/i },
{ tag: 'creature-death', test: /\bwhenever .{0,40}\bdies\b/i },
{ tag: 'creature-death', test: /\bwhenever you sacrifice\b/i },
```

The broad-alternation rule flagged in the brief behaves better than expected, but
three classes leak.

**(a) Opponent-only death triggers — 29 cards.** Your sacrifice outlet does not
feed these:

- **Kamber, the Plunderer** — "Whenever a creature **an opponent controls** dies,
  you gain 1 life and create a Blood token."
- **Istvan, Butcher of Eln** — "Whenever a creature **an opponent controls** dies,
  put two +1/+1 counters on Istvan."
- **Vincent Valentine** — same shape on the front face.

**(b) `whenever you sacrifice` is object-blind — 52 cards** sacrifice something
that is not a creature:

- **Sanguine Brushstroke** — "Whenever you sacrifice a **Blood token**, each
  opponent loses 1 life and you gain 1 life." Blood is an artifact.

**(c) Downside triggers.** **Avarice Amulet** — "Whenever equipped creature dies,
**target opponent gains control of this Equipment**." A drawback read as a payoff.

**Judgement disclosed:** three sampled cards are one-shot self-death triggers
("Whenever \<this\> attacks or dies…" — Chaos Balor, Urza's Construction Drone) and
one is a board wipe with a death rider (Death Frenzy — "Whenever a creature dies
**this turn**, you gain 1 life"). I ruled these **wrong** in the strict column and
**right** in the lenient column. They do get value from a sac outlet once; they are
not what a player means by a death-trigger payoff, and Death Frenzy is closer to a
producer than a wanter.

**Suggested tightening:** add `you control` / bare `a creature dies` and reject
`an opponent controls`; scope the third rule to
`whenever you sacrifice (a|another|one or more) (creature|permanent)`.

### 3.10 Small-population defects worth one line each

- **`wants artifact-etb` — Karstoderm.** "Whenever an artifact enters, **remove a
  +1/+1 counter** from this creature." A punisher tagged as a payoff — 1 of the
  entire 5-card population.
- **`wants discard` — Bloodboil Sorcerer.** `\bmadness\b` matched the **ability
  word** in "**Crown of Madness** — {1}{R}, Sacrifice an artifact or creature:
  Goad target creature." 5 such cards corpus-wide. Fix:
  `/\bmadness [{\d]|\bmadness—/i`.
- **`wants attack-trigger` — exalted, 75 cards.** The reminder text reads
  "Whenever a creature you control **attacks alone**…", which the rule matches.
  Exalted rewards attacking with *one* creature, and `attack-trigger` is paired
  with `token` (going wide) in `INTERACTION_PAIRS`. These 75 are an anti-synergy
  dressed as a synergy. **Knight of Infamy**, **Waveskimmer Aven**.
- **`produces token` — the opponent creates it, 66 cards.** **Hunted Lammasu** —
  "When this creature enters, **target opponent** creates a 4/4 black Horror
  creature token." **Chaos Balor** — "…deals 2 damage to target player and **they**
  create two Treasure tokens" (which also gives it a spurious `produces treasure`).
  1.7% of the tag; low priority but a clean fix.
- **`produces card-draw` — the opponent draws, 174 cards (4%).** **Horn of Greed** —
  "Whenever a player plays a land, **that player** draws a card." Also
  **Homesickness** and **Flame of Anor** ("Target player draws two cards"). Low
  rate; the rest of the tag is spotless.
- **`produces untap` — Threaten.** "Untap target creature and gain control of it
  until end of turn." Untapping a stolen creature is not an untap engine. 1 of 25.
- **`produces plus1-counter` — Erithizon.** "Whenever this creature attacks, put a
  +1/+1 counter on target creature **of defending player's choice**." 1 of 25.

---

## 4. Direction errors, called out separately

Getting the direction backwards makes the app pair two cards that both need the
same thing. Everything in this section is that error.

| Where | Scale | What happens |
| --- | --- | --- |
| `wants plus1-counter` (§3.1) | **440 of 563 cards are tagged both directions**; 389 match the producer phrasing | Two counter-*makers* are reported to each other as `payoff`. The single largest defect in the audit. |
| `treasure` (§2) | `WANTS` rule matches **0** cards; **18** genuine Treasure payoffs exist and are tagged `produces treasure` only | **Captain Lannery Storm** ("Whenever you sacrifice a Treasure, Captain Lannery Storm gets +1/+0") is filed as a Treasure *source*. Two Treasure sources then read as redundancy rather than as engine-and-payoff. Also **Gold Rush**, **Black Market Tycoon**, **Evin, Waterdeep Opportunist**. |
| `produces discard` (§3.5) | Hobgoblin, Mantled Marauder and cards like it | "Whenever **you discard** a card, …" matched the produce rule. A pure payoff filed as an enabler. |
| `wants lifeloss` | 1 of the 8-card population | **Within Range** — "Whenever you attack, **each opponent loses life** equal to the number of creatures attacking them." A drain *source* filed as a drain *payoff*. It is not tagged `produces lifeloss` at all, because that rule requires a literal digit and this card says "life equal to". |
| `produces graveyard-creature` (§3.6) | part of the 52 | **Kami of Mourning** grants a graveyard creature a recursion trigger — it wants a stocked graveyard; it is tagged as filling one. **Syr Konrad, the Grim** is a graveyard payoff that matched via `dies … graveyard`. |
| `produces token` | not counted | **Life Finds a Way** — populate ("Create a token that's a copy of a creature token **you control**") is tagged produces only. Populate *requires* a token first; the card wants tokens at least as much as it makes them. A missing want rather than a wrong produce, but the same failure of the direction model. |

---

## 5. Three judgement calls I want on the record

### 5.1 `wants untap` = `/\{T\}:/` — literally true, 3801 times

Every one of the 25 sampled cards does contain a `{T}:` ability, so the lenient
precision is 100% and I cannot honestly call any individual tag "wrong". But:

- **1,205** of the 3,801 are **lands**, and **1,185** of those have `{T}: Add`.
- **735** more are non-land mana rocks and dorks with `{T}: Add`.
- Together, **51% of the tag is mana sources**.

Untapping a Sol Ring or a Cascading Cataracts is fine. It is not a *synergy* in
the sense the reason string implies, and because `theme` credits a shared want,
11% of the corpus sharing this tag means nearly every deck reports an untap theme
it does not have. I ruled the mana-only cards **wrong in the strict column** (17
of 25 useful) on the grounds that the app is making a claim the user will not
recognise. Someone could reasonably rule the opposite; what is not arguable is the
volume.

The rule also has no notion of "untapping this is worthless": **Gate to
Tumbledown** ("{3}{R}, {T}: Seek a nonland card. **Activate only once.**") and
**Prosperity Tycoon** (whose only `{T}:` is inside quoted text on a token it
makes) are both tagged.

**Suggested tightening:** match `/\{T\}:/` only when the effect after the colon is
not solely `Add …`, and reject "Activate only once". That alone would drop roughly
1,900 cards from the tag.

### 5.2 `wants graveyard-creature` — the tag name overpromises

```ts
{ tag: 'graveyard-creature', test: /\bdelve\b|\bescape\b|\bthreshold\b|\bdelirium\b/i }
```

**247 of the 446** (55%) come from this rule alone with no reanimation text.
Threshold, delirium and delve want a *stocked graveyard*; they do not care whether
what is in it is creatures. **Inquisitor's Ox** ("Delirium — this creature gets
+1/+0 and has vigilance as long as there are four or more card types among cards
in your graveyard") is not a card anyone would call a reanimation payoff, and
**delve** actively *exiles* the graveyard rather than wanting it kept
(**Set Adrift**).

I ruled these **correct in the lenient column** — they genuinely are fed by the
self-mill that `produces graveyard-creature` represents, so the pairing works —
and **wrong in the strict column**, because the tag is named for creatures and the
reason string will say so. My recommendation is to keep the rule and **rename the
tag** (`graveyard-fill` / `graveyard-matters`), not to delete the rule.

The reanimation half (`return target creature card from your graveyard`) was 14
for 14 in the sample and needs nothing. The `\bescape\b` alternation also picks up
five cards that *grant* escape (**Underworld Breach**, **Desdemona, Freedom's
Edge**) rather than having it — those are correct anyway, they are graveyard cards.

### 5.3 `produces sacrifice-fodder` is a near-alias of `produces token`

```ts
{ tag: 'token',            test: /\bcreate(s)? .{0,40}\btoken/i },
{ tag: 'sacrifice-fodder', test: /\bcreate(s)? .{0,40}\bcreature token/i },
```

2,753 of the 3,799 `produces token` cards also carry `produces sacrifice-fodder`,
by construction — the only difference between the rules is the word "creature".
All 25 sampled cards did create a creature token, so precision is 100% literally.
I marked 2 wrong in the strict column for making exactly one large token
(**Roar of the Wurm**, one 6/6 Wurm; **Draconautics Engineer**, one 4/4 Dragon on
a once-only exhaust ability) — a 6/6 for five mana is not what "fodder" means.
This is a low-stakes judgement and I would not spend engineering effort on it.
Note only that because `INTERACTION_PAIRS` contains both
`['token','sacrifice-fodder']` and `['token','creature-death']`, one token-maker
fires several relationships at once, and the saturating `synergyScore` is the only
thing stopping that from compounding.

---

## 6. Fix order

Ranked by (cards affected) × (how wrong) × (how damaging the resulting claim is).

| # | Rule | Cards | Precision | Why here |
| --- | --- | ---: | --- | --- |
| 1 | `WANTS plus1-counter`, second alternation (§3.1) | 563, of which **440** are double-tagged | 28% | A **direction inversion**, the worst error class, and it is 78% of the tag. One class of fix. |
| 2 | `PRODUCES creature-death` / `destroy target creature` (§3.2a) | **359** | — | Every one is a removal spell claiming to enable sacrifice fodder. Deleting the rule is the whole fix. |
| 3 | `PRODUCES lifeloss`, bare `loses? \d+ life` (§3.4) | **346** | 72% | Subject-blind; "you lose 2 life" read as a drain. Highest raw count of clearly-wrong cards after #2. |
| 4 | `PRODUCES discard`, opponent-facing (§3.5) | **314** | 72% | Their hand is not your graveyard. Breaks every madness and self-mill pairing. |
| 5 | `WANTS token`, tribal lords + anti-anthem (§3.3) | **166** (162 + 4) | 16–60% | Geth (-1/-1) actively kills the deck it will be recommended into. |
| 6 | `WANTS untap` = `/\{T\}:/` (§5.1) | ~1,900 mana sources of 3,801 | 68% useful | Largest tag in the corpus; distorts `theme` scoring everywhere. Ranked below the above because no single card is *false*. |
| 7 | `WANTS attack-trigger`, exalted (§3.10) | **75** | 88% | Straight anti-synergy given `['token','attack-trigger']`. |
| 8 | `PRODUCES creature-death`, opponent edicts (§3.2c) | **67** | — | Same shape as #4. |
| 9 | `PRODUCES token`, opponent creates (§3.10) | **66** | 96% | Hunted Lammasu hands the opponent a 4/4. |
| 10 | `PRODUCES graveyard-creature`, `dies…graveyard` (§3.6) | **52** | 72% | A pure co-occurrence rule; delete it, the mill rule is doing the work. |
| 11 | `WANTS creature-death`, opponent-only + object-blind sacrifice (§3.9) | **29 + 52** | 68% | |
| 12 | `PRODUCES card-draw`, opponent draws (§3.10) | **174** | 100% in sample | Ranked low despite the count: a 4% rate, and the rest of the tag is the cleanest in the corpus. |
| 13 | `PRODUCES creature-death`, `each player sacrifices` lands (§3.2b) | **17** | — | Small but embarrassing (Destructive Force). |
| 14 | `PRODUCES landfall`, Ice Age land template (§3.7) | **12** | 80% | |
| 15 | `WANTS discard`, `\bmadness\b` ability word (§3.10) | **5** | 96% | |
| 16 | `WANTS landfall`, reminder text + opponent punisher (§3.8) | **3** | 92% | |
| 17 | `WANTS artifact-etb`, Karstoderm (§3.10) | **1 of 5** | 80% | Trivial count, but it is 20% of a five-card tag. |

Separately, and not precision work: `attack-trigger` needs a `PRODUCES` rule and
`treasure` needs a working `WANTS` rule, or neither tag can ever lead a reason
(§2).

---

## 7. What is in good shape

Stated plainly, because a clean result is a finding:

- **`wants lifegain`** (`whenever you gain life`) — 25/25. Nothing to do.
- **`produces card-draw`** and **`wants card-draw`** — 25/25 each. The
  `if you.{0,20}drawn.{0,20}card` alternation correctly picked up Proft's Eidetic
  Memory. Only a 4% opponent-draw leak corpus-wide.
- **`wants sacrifice-fodder`** (`sacrifice (a|another|an) creature`) — 25/25,
  including additional-cost sacrifices, exploit, and forced upkeep sacrifices.
- **`produces treasure`** (`\bTreasure token`) — 25/25.
- **`produces artifact-etb`** — 25/25. Recall is the problem there, not precision:
  the rule only sees artifact *tokens*, so 37 cards carry it while every artifact
  spell in the corpus also causes an artifact to enter.
- **`produces plus1-counter`**, **`produces token`**, **`produces untap`**,
  **`wants discard`** — 24/25 each, one identifiable card apiece.
- **The keyword reminder-text strategy works better than it looks.**
  `produces plus1-counter` correctly caught bolster, modular, monstrosity, renown,
  outlast and megamorph purely through reminder text, and `produces token` caught
  living weapon, amass, incubate, fabricate, populate and job select the same way.
  Matching against reminder text is load-bearing and should be preserved by any
  rewrite. It cost exactly one false positive in this audit (`Crown of Madness`,
  §3.10).
- **The sacrifice-outlet core of `produces creature-death`** — the two
  `sacrifice … creature` rules — was correct on everything it caught. That tag's
  48% precision is entirely attributable to the three extra rules bolted onto it,
  not to the idea.
