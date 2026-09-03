# 52. A colour you cannot reach by tapping is not a colour you have

Date: 2026-09-02

## Status

Accepted. **Amends ADR-0035**, which stands except where noted below: this
closes the two cases 0035 recorded as *known and not fixed*, and revises one
sentence of its "what is not changing" section.

> **Number 0052 was assigned to this work.** 0049 and 0052 were both claimed by
> agents running concurrently. Do not derive a free number by reading the
> directory — several pairs of agents have collided that way.

## Context

Two independent playtests — a Grixis combo deck and a five-colour Najeela deck —
reported the same failure, in the words of the second:

> the mana base it builds is one a player would not play

Reproduced exactly. Five colours, `fills-land`, **677 candidates**:

| rank | card | what it actually does |
|---|---|---|
| 1 | The Mycosynth Gardens | `{T}: Add {C}` / `{1}, {T}: any colour` |
| 2 | Lazotep Quarry | `{T}: Add {C}` / `{T}, Sacrifice a creature: any colour` |
| 3–35 | **a 33-way tie at 2.250** | City of Brass and Reflecting Pool tied with Baldur's Gate, The Grey Havens, Gemstone Caverns, Mirrex, Three Tree City, Study Hall |
| 45–55 | Breeding Pool, Steam Vents, Hallowed Fountain, Blood Crypt | |
| 247–261 | the Triomes | |
| 651–657 | the fetchlands, at 0.700 | `producedMana: []` |

Three colours was the same shape: Steam Vents 54th, Blood Crypt 55th, Volcanic
Island 76th, Underground Sea 72nd, under a head of The Mycosynth Gardens,
Conduit Pylons, Hidden Grotto and The Grey Havens — every one of them `{C}` in
that deck.

Four distinct defects, deliberately not conflated.

### 1. The coverage term saturates, and at five colours it *is* the head

`sqrt(coloursCovered / identity.length)` where `coloursCovered` counts
`producedMana`. ADR-0035 kept `sqrt` on the argument that no reshaping of
`covered / n` can order two lands that *both* cover the whole identity. That
argument is still correct. What 0035 did not weigh is that at wide identities
**almost everything covers the whole identity**: 153 legal lands claim all five
colours in `producedMana`, and the old rule gave them at most five distinct
values (1.0, and 1.0 times the tapped, restricted and must-be-cast discounts).
Thirty-three landed on exactly 2.250 in this deck.

A 33-way tie is not noise to be broken with a nudge. It is the term reporting,
truly, that it has run out of things to say — and the question it never asked is
what reaching those five colours *costs*.

### 2. A phrasing false negative in the spend-restriction rule

`fixing.ts` matched a coloured ability with:

```ts
const COLOURED_ADD = /\{[WUBRG]\}|any colou?r|any type|mana of any/i
```

This does not match **"Add two mana in any combination of colors"**, so
`restrictedFixing` never set `sawColouredAbility` and the 0.5 discount was
skipped — on a card whose *very next sentence* is the exact "Spend this mana
only to…" template the rule looks for. Population is exactly three: **Great Hall
of the Citadel** (scored 2.250, ranked 19th, and Quickbuild put it in the deck),
**Crucible of the Spirit Dragon**, and **The Mystical Archive** (not
Commander-legal, so two in the legal corpus). ADR-0035's "zero false positives"
claim survives untouched; this is a false *negative* it did not measure.

### 3. Fetchlands score 0.700

Flooded Strand has `producedMana: []` and **the data is right** — a fetch makes
no mana — so it fell to `NO_FIXING`, scored on the land deficit alone, and
ranked 652nd of 677 in a five-colour deck, below every `{T}: Add {C}` utility
land in the format. Its whole function is fixing.

The trap on the other side is the one the playtest walked into: Quickbuild put
**Evolving Wilds, Terramorphic Expanse and Myriad Landscape into a deck with
zero basic lands**, where all three are blank cards, and nothing on screen said
the deck had no basics.

### 4. The reason chip asserts something false

Every cost-gated land rendered **"taps for 5 of your 5 colours"**. It is false on
all of them — Baldur's Gate taps for `{C}` and wants `{2}` and a board of Gates
(the deck had two), The Grey Havens reads colours off legendary creature cards
in your *graveyard*, Gemstone Caverns needs a luck counter it can only have from
an opening hand, Mirrex works only on the turn it entered, and the Vivid cycle
taps for one colour freely and needs a charge counter for the other four. That is
a **P4** violation, and fixing the score without fixing the claim would leave the
product lying more quietly.

## Decision

### Colours are attributed per ability, and each is priced by what it costs

ADR-0035 said fixing this "needs per-ability colour attribution, which the data
shape does not carry". That is true of `producedMana`, which is a flat array. It
is **not** true of the oracle text, where an ability states its own cost on its
own line. So `fixing.ts` now reads abilities, not cards: for each colour of the
identity it keeps the *openness* of the best ability that reaches it, and the
term is the mean openness times the same `sqrt` coverage curve.

Applied **outside** the root, and that is load-bearing: `sqrt` would take a 0.5
discount folded into the numerator and hand back 0.707. The concavity that makes
diminishing returns work is the same concavity that softens a penalty. Folded
inside, Cavern of Souls would have gone *up* under this change.

| discount | value | derivation |
|---|---|---|
| CONVERSION | 0.30 | the ability nets no mana. `{1}, {T}: Add one mana of any color` adds **nothing** to your pool — it turns one generic into one coloured, so it is two lands doing one land's work (× 0.5) and does nothing at all until the second land is there, which is the delay `TAPPED_PENALTY` already prices (× 0.6). Two different costs, so they compose. |
| CONDITIONAL | 0.25 | the colours come from a game state, not the land. `RESTRICTED_PENALTY` squared, and the square is the argument: a spend-restriction limits what the mana may buy; this limits that **and** whether there is any mana at all. |
| MIRRORED | 0.50 | the colours come from a **land** you control. Held at the restriction penalty, not the conditional one — see the counter-examples below. |
| ONE SHOT | 0.15 | the cost eats a permanent or a counter, so the ability works once and the card is a colourless land for the rest of the game. Set **equal to `COLOURLESS_ONLY`** on purpose: that is the whole claim, not a coincidence. |

**Life is deliberately not a gate.** `{T}, Pay 1 life` and "this land deals 1
damage to you" are the price of the best fixing in the format — City of Brass,
Mana Confluence, Tarnished Citadel, Grand Coliseum, every painland, every
shockland, every fetchland. A rule that reads "this land hurts you" as a
condition demotes the entire class it was written to promote. **Life is a price
you pay out of a resource you always have; mana, cards, counters and board states
are prerequisites you may not have at all.** That is the whole distinction, and
it is the hard part of this change.

**Filter lands survive by derivation rather than exception.** ADR-0035 refused to
demote Mystic Gate and Cascade Bluffs to catch Baxter Building, and had to phrase
that refusal as an exception because "costs mana to activate" catches both. *Net*
mana separates them without one: a filter land pays one and gets **two**, so it
nets what a plain land nets and is not a converter. The same arithmetic catches
Baxter Building (`{4}` for four) and Crystal Quarry (`{5}` for five) — the case
0035 recorded as known and unfixed — because those net zero.

### A fetch is scored on what it finds, and only when the deck can pay it off

`fixingFor` takes an optional `DeckLands` — the basic land types the deck already
holds, and whether any of them is an actual `Basic`. A fetch is then scored on
the colours of the land types it names *intersected with what the deck holds*:
Flooded Strand in a deck with Islands and no Plains reaches one colour, not two,
and Evolving Wilds in a deck of nothing but nonbasic duals reaches none, because
it cannot find a Triome.

**Absent means nothing fetchable, not "unknown, assume the best."** This is the
second input in `recommend` that does not default to no-effect, for exactly the
reason `gameChangerBudget` does not: the no-effect default would spend an
allowance the caller never said the deck had. A caller that forgets gets fetches
scored at zero, which is what they scored before this existed — forgetting is a
no-op regression, never a new way to recommend a dead card.

It has to be a new input. `findEligibleCards` filters basic lands out of the
candidate pool **in SQL**, so `recommend` cannot see the deck's twelve Islands
however hard it looks; the API route, which already loads the deck's own cards
for the composition count, is the only place the answer exists. Only *accepted*
cards count — a card in `considering` is not in the library yet, and a fetch
recommended on the strength of a basic the builder has not taken is exactly the
dead draw this prevents.

**A land that makes mana is scored on the mana it makes, never as a fetch.**
Myriad Landscape taps for `{C}` and can sacrifice itself for two basics that
*share* a land type — the same colour twice, which is ramp and not fixing. It
stays a colourless land.

### The reason says how, not just how many

`Fixing.reach` is new and rides out on the `mana-fixing` reason as an optional
field (R2: absent reads as `taps`, which is what the old sentence already
assumed). Five sentences, each true of every card it appears on:

| reach | sentence |
|---|---|
| `taps` | taps for 2 of your 5 colours |
| `restricted` | 5 of your 5 colours, but that mana is restricted |
| `gated` | 5 of your 5 colours, but not just by tapping |
| `fetches` | fetches a land for 2 of your 5 colours |
| `colourless` | taps for colourless |

`reach` reports the **worst** reach among the colours claimed, not the best,
because the sentence has to be true of all of them. Vivid Crag taps for `{R}`
freely and needs a charge counter for the other four; reporting the free one
renders "taps for 5 of your 5 colours" on a card that taps for one.

The score and the reason are allowed to disagree, and Baldur's Gate is why. Its
value takes the colourless floor, because it really does say `{T}: Add {C}` on
its first line and is worth no less than a land that taps for `{C}`. Reporting
`colourless` would score it correctly and then tell the builder something else
false — it is not a colourless land, it is a land whose colours are behind `{2}`
and a board of Gates. So the score takes the floor and the sentence explains the
score instead of repeating it.

### Three smaller corrections, all measured over the corpus

- **`COLOURED_ADD` now matches "in any combination of colors"** (defect 2). 34
  flagged → 36.
- **22 lands claiming five colours make one or two.** "As this land enters,
  choose a color" resolves once and never again, so `{T}: Add {U} or one mana of
  the chosen color` is a *dual*. The Thriving cycle, the Gate cycle, Cryptic
  Spires, Uncharted Haven. The chip read "5 of your 5 colours" on all of them.
- **An ability in quotation marks belongs to something else.** Treasure Map —
  the card that led the whole ADR-0035 measurement — claimed five colours from
  reminder text about the *tokens* it makes. Quotation marks, not parentheses:
  Tundra's entire mana ability is reminder text and stripping parentheses
  deletes the card. And only when the quote is introduced by `with` or `have`,
  which is the second audit finding below.

### The sentence is audited over the corpus, not argued about

Every rule above was checked by scoring all 1,168 legal lands. That is not the
same as checking the **sentence**, and doing the second found two claims the
first could not — both false, and neither reachable from the report:

- **All twenty filter lands rendered "taps for 2 of your 5 colours".** You
  cannot get `{W}` out of Mystic Gate without already having `{W}` or `{U}`.
  The fix is to stop `reach` and `value` being computed by the same number:
  paying mana always costs a card its `taps` claim, and costs it *value* only
  when it does not get the mana back. Mystic Gate keeps 0.632, identical to
  Steam Vents, and now says "2 of your 5 colours, but not just by tapping".
  ADR-0035's refusal to demote the filter cycle is left exactly where the
  net-mana rule put it.
- **Dryad Arbor rendered "taps for colourless"** on a card that makes no
  colourless mana at all. It is the one land in the corpus whose whole mana
  ability is quoted reminder text about *itself* — `it has "{T}: Add {G}."` —
  and the quote-stripping rule had been written on the claim that no such card
  exists. The discriminator is grammatical: `with "` introduces a token's
  ability, `have "` one granted to other permanents, `has "` a card talking
  about itself.

After both fixes, over 1,168 legal lands: **zero** cards render "taps for N"
where every coloured ability costs more than `{T}`, and **zero** render "taps
for colourless" while producing no `{C}`.

### What is not changing

**`sqrt` stays, and `w.fixing` stays at 1.2.** Both for ADR-0035's reasons,
which are unaffected: `near-combo` is a mixed group in which two of 334 cards
were lands, and raising the weight would buy ordering in the one group that
wants it by distorting the others.

**One sentence of 0035 is revised.** It said the coverage curve "was the obvious
suspect and it is not the culprit". Half right: the curve's *shape* was not the
culprit, and reshaping it still cannot help. Its **numerator** was — `covered`
counted colours the card can ever make, so every any-colour land pinned it at
`n` and the curve had nothing left to do.

## Consequences

**993 of the 1,168 legal lands are unchanged.** Of the 175 that move, 23 are
fetchlands going up and the rest are gated lands coming down.

### `fills-land` top 10, before and after

**Two colours** — Niv-Mizzet, Parun (Izzet), 438 candidates. ADR-0035's
regression case, and it gets strictly better:

| # | before | after |
|---|---|---|
| 1 | The Mycosynth Gardens | Fiery Islet |
| 2 | Fiery Islet | **Steam Vents** |
| 3 | Horizon of Progress | **Sulfur Falls** |
| 4 | **Capital City** | **City of Brass** |
| 5 | **Baxter Building** | **Shivan Reef** |
| 6 | Steam Vents | **Mana Confluence** |
| 7 | Sulfur Falls | **Training Center** |
| 8 | City of Brass | **Stormcarved Coast** |
| 9 | Shivan Reef | **Cascade Bluffs** |
| 10 | Mana Confluence | **Frostboil Snarl** |

Capital City (4 → 104) and Baxter Building (5 → 105) are the two cards ADR-0035
named as known and unfixed. The Mycosynth Gardens goes 1 → 73. Every row of the
new top ten is a real dual, and no card that was in the old top ten and deserved
to be there has moved down.

**Three colours** — Kess, Dissident Mage (Grixis), 514 candidates:

| # | before | after |
|---|---|---|
| 1 | The Mycosynth Gardens | **City of Brass** |
| 2 | Conduit Pylons | **Mana Confluence** |
| 3 | Hidden Grotto | **Forbidden Orchard** |
| 4 | The Grey Havens | **Starting Town** |
| 5 | City of Brass | **Tarnished Citadel** |
| 6 | Mana Confluence | **Glimmervoid** |
| 7 | Nykthos, Shrine to Nyx | **Lotus Vale** |
| 8 | Reflecting Pool | Takenuma, Abandoned Mire |
| 9 | Three Tree City | **Watery Grave** |
| 10 | Gemstone Caverns | **Steam Vents** |

Steam Vents 54 → 10, Watery Grave 53 → 9, Underground Sea 72 → 28, Volcanic
Island 76 → 32, Darkslick Shores 93 → 44, Spirebluff Canal 94 → 45.

**Five colours** — Najeela, the Blade-Blossom, 677 candidates:

| # | before | after |
|---|---|---|
| 1 | The Mycosynth Gardens | **City of Brass** |
| 2 | Lazotep Quarry | **Forbidden Orchard** |
| 3 | City of Brass | **Starting Town** |
| 4 | Reflecting Pool | **Tarnished Citadel** |
| 5 | Three Tree City | **Glimmervoid** |
| 6 | Gemstone Caverns | Storm the Vault // Vault of Catlacan |
| 7 | Spire of Industry | Shifting Woodland |
| 8 | Plaza of Heroes | Murmuring Bosk |
| 9 | Talon Gates of Madara | **Mana Confluence** |
| 10 | Opal Palace | **Prismatic Vista** |

Breeding Pool 45 → 13, Hallowed Fountain 47 → 15, Steam Vents 48 → 16, Blood
Crypt 49 → 17, the Triomes 247–261 → 194–209. Going the other way: Lazotep
Quarry 2 → 486, Baldur's Gate 21 → 586, Three Tree City 5 → 509, Gemstone
Caverns 6 → 477, The Grey Havens 15 → 479, Great Hall of the Citadel 16 → 160.

**Fetchlands, in a deck that can pay them off** (the same deck with five basics
accepted): Prismatic Vista 662 → **10**, Flooded Strand 652 → 388, Polluted
Delta 651 → 387. In the same deck with **no** basics they stay at 0.700 and
651st, which is the guard working.

### The tie, and how it broke

Across the 153 lands that claim all five colours, the old rule produced at most
five distinct fixing values; the new one produces **14**. The twelve still at the
ceiling are exactly the twelve lands that genuinely tap for any colour with no
gate at all: City of Brass, Command Tower, Forbidden Orchard, Forsaken City,
Glimmervoid, Lotus Vale, Mana Confluence, Rainbow Vale, Starting Town, Tarnished
Citadel, Thran Quarry, Undiscovered Paradise. Every one has its drawback in a
*separate triggered ability*, which is the same shape as City of Brass's damage
and is a line this file now draws consistently.

The 33-way tie at the head is gone. A large tie remains further down — 48 cards
at 1.809 in the five-colour deck — and it is a different thing: those are the
shocks, duals, fastlands, painlands and Battlebond lands that each tap for two of
your five colours. They really are equivalent as fixers, and saying so is not a
failure to discriminate.

### Counter-examples hunted, and what they cost

The rule had to demote gated lands **without** demoting City of Brass and Mana
Confluence, whose cost is life rather than mana. Checked by sweeping the whole
legal land corpus rather than by example:

- **Every premium fixer survives at `taps`.** All ten shocklands, all ten duals,
  the whole filter cycle, every fastland, painland and Battlebond land at 0.632;
  the Triomes at 0.465; City of Brass, Mana Confluence, Command Tower and
  Tarnished Citadel at 1.000; Grand Coliseum and Path of Ancestry at 0.600
  (tapped, correctly).
- **Reflecting Pool, Exotic Orchard and Horizon of Progress are demoted, to
  0.5**, and this is the counter-example that forced `MIRRORED` to exist as a
  separate tier from `CONDITIONAL`. Their condition is "a land you control", and
  a deck the product is at this moment computing a *land deficit* for is not a
  deck that will control no lands. What they genuinely cannot be is your **first**
  source of a colour — they copy a mana base rather than build one — and that is
  the same every-turn limit a spend-restriction is. Reflecting Pool goes 4 → 154
  at five colours. Accepted, and named here so it is a decision rather than a
  surprise. The same tier saves Nimbus Maze and the Tainted
  cycle, whose "Activate only if you control an Island / a Swamp" is the same
  kind of condition and would otherwise have been priced at 0.25.
- **Nykthos, Gaea's Cradle, Serra's Sanctum, Cabal Coffers and Phyrexian Tower
  fall to the colourless floor.** They are build-arounds and ramp, not fixing,
  and this is the *fixing* term. Correct, and worth stating because they are
  strong cards.
- **Glimmervoid, Thran Quarry, Rainbow Vale and Undiscovered Paradise keep
  1.000** despite real drawbacks, because those drawbacks are separate triggered
  abilities and their mana ability costs `{T}` and nothing else — the same
  reading that saves City of Brass. Consistent, and generous; named as the known
  soft edge of the line.

### Known and not fixed

- **A one-colour land with a near-combo can still beat a two-colour one.**
  Shifting Woodland (1 of 5, plus a near-combo) ranks 7th at five colours, above
  Steam Vents at 16th. This is ADR-0035's 0.35-versus-0.40 arithmetic, unchanged
  and still bounded; it takes an actual near-combo rather than any incidental
  keyword.
- **A spell whose back face is a land is still grouped as a land.** Storm the
  Vault // Vault of Catlacan is a `{2}{U}{R}` Legendary Enchantment and ranks
  6th. Its land face genuinely taps for any colour, so the fixing term is right
  about it; what is wrong is the category, and under ADR-0031's principle the fix
  is in role derivation. It was 2nd in the playtest and is 6th now, which is a
  discount and not a cure.
- **Aether Hub keeps a full-value ability behind one energy counter.** Priced as
  a one-shot via `Pay {E}`, which is right for the second activation and
  generous for the first.
