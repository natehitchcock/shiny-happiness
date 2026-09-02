# 35. A land is worth what its mana costs you, not what Scryfall says it makes

Date: 2026-09-01

## Status

Accepted.

> **Number 0035 was assigned to this work.** 0033 and 0034 were claimed by
> agents running concurrently. Do not derive a free number by reading the
> directory — several pairs of agents have collided that way.

## Context

Reported by a builder:

> "I'm also not seeing any of the dual or triple lands, shock lands, etc… that I
> would expect to see in the land recommendations. For lands, the more colors it
> satisfies from your deck, the better candidate it is."

The principle in the second sentence was already implemented. `fixing.ts` scores
`sqrt(coloursCovered / identity.length)` at weight 1.2, which is heavier than
`keywordSynergy`, and ADR-0011's own note says this is exactly so that mana
beats rules text inside the land group.

It does not. Measured in the browser on a real Izzet deck (Niv-Mizzet, Parun,
midrange, bracket 3, no budget), the eight rows under **"Fills gap · land −37"**
— 442 candidates — were:

| # | card | type line |
|---|---|---|
| 1 | Matzalantli, the Great Door // The Core | Legendary Artifact // Legendary Land |
| 2 | Treasure Map // Treasure Cove | Artifact // Land |
| 3 | Rush of Inspiration // Crackling Falls | **Instant** // Land |
| 4 | Azor's Gateway // Sanctum of the Sun | Legendary Artifact // Legendary Land |
| 5 | The Mycosynth Gardens | Land — Sphere |
| 6 | Fiery Islet | Land |
| 7 | Horizon of Progress | Land |
| 8 | Voldaren Estate | Land |

No dual, no shockland, and four of the eight not lands. Steam Vents was 20th,
Sulfur Falls 21st, Command Tower 18th.

Ruled out by measurement, so that the next person does not re-check them:
**budget** (`deck.budget` is null and `budgetOverrun` was 0 for every card —
Mana Confluence at $34.50 tied Command Tower at $0.22); **inclusion and corpus
synergy** (`stats: null` in the API by ADR-0008, so both terms are identically
zero); **eligibility filters** (Steam Vents is in the pool and in the group;
Breeding Pool and Raugrin Triome are absent because they are not in R/U, which
is correct); **`entersTapped` demoting Triomes** (Path of Ancestry scored
`1.2 × 1.0 × 0.6`, proportional, not eliminated).

The cause is arithmetic, and it has two halves.

**`producedMana` overstates.** It is Scryfall's "colours this card can ever
make" and it counts an ability at full value however it is gated. Villainous
Hideout lists five colours and gives an Izzet deck none of them — its any-colour
mana may be spent only on Villain spells. Treasure Map lists six, after {2}, a
card, and three activations.

**The coverage term saturates.** In a two-colour deck every land that taps for
both colours scores an identical 1.0, so within that block — which is most of
the playable lands — the term contributes *no ordering at all*, and the order
falls through to the terms it exists to overrule. The numbers meet almost
exactly:

```
one incidental shared synergy tag   keywordSynergy × 0.5   = 0.35
one whole colour of a 2-colour deck  fixing × (1 − √0.5)   = 0.35
one near-combo                       near × log2(2)        = 0.40
```

Baxter Building (EDHREC 9,690) outranked Steam Vents (EDHREC 65) because its
"{4}, {T}: Draw a card" earns `card-draw`, which Niv-Mizzet wants. That is the
defect ADR-0011 raised `fixing` to fix, still live one level down: the term
lifted duals above basics and then stopped.

## Decision

**Coverage is discounted by what the mana costs you.** `fixingFor` already did
this once — `TAPPED_PENALTY` — and this generalises that single idea rather than
adding new terms. Discounts multiply, so two problems rank below either one.

| discount | value | derivation |
|---|---|---|
| enters tapped | 0.6 | unchanged; the existing anchor. Costs you one turn. |
| every coloured ability is spend-restricted | 0.5 | below tapped: a restriction costs you *every* turn, not the first. |
| has a mana cost, so is not a land drop | 0.4 | below a real land making one of your two colours (√0.5 = 0.707), above one making none (`COLOURLESS_ONLY`, 0.15). |

Both new rules were validated against all 1,168 legal lands in the corpus, not
against hand-picked examples:

- **Spend-restricted** is a fixed Oracle template, matched per ability, and a
  card is only discounted when *every* coloured ability is restricted. 34 lands
  — the tribal and faction any-colour lands (Cavern of Souls, Unclaimed
  Territory, Ancient Ziggurat, Sliver Hive). Zero false positives across 23
  premium fixers, including the whole filter-land cycle and Plaza of Heroes,
  which keeps one unrestricted coloured ability.
- **Has a mana cost** needs no rules text: a land has no mana cost, so
  `manaValue > 0` on a card whose `types` include `land` is exactly and only the
  56 two-faced cards with a spell front. Zero single-faced lands match.

**And `entersTapped` is read per clause, not per card.** It tested the whole of
`oracleText` for a conditional word, so any "unless" or "if you do" anywhere
cancelled an unconditional tapped clause elsewhere. Over the corpus that is 20
lands, every one wrong in the same direction: Dakmor Salvage (the "if you do" is
inside *Dredge's reminder text*), the karoo cycle and Rupture Spire ("sacrifice
it unless you pay {1}" is a second cost), Valakut, and the two-faced cards where
`oracleText` is both faces concatenated so the spell face cancelled the land
face. Splitting on lines fixes all 20 and moves none the other way — the 30
hand-picked lands the rule was originally validated against are unchanged,
because a shockland states its condition in the *same* clause as its tapped-ness.

### What is not changing, and why

**`sqrt` stays.** It was the obvious suspect and it is not the culprit. It
cannot order two lands that both cover the whole identity, which is the case
that was reported; and it cannot be made much steeper, because any concave curve
through (0,0) and (1,1) scores one of two colours at 0.5 or more, so against
0.707 the most a reshape could buy is 0.2 — while giving up concavity means
giving up diminishing returns, the one part of the term nobody disputes.

**`w.fixing` stays at 1.2.** Raising it was the other way to make coverage
decisive, and the original `sqrt` docblock's warning about "a five-colour land
outranking a combo piece" is why not. Grouping runs before scoring, but the
groups are not all one kind of card: on this deck `near-combo` held 334 cards of
which two were lands, Wandering Fumarole 23rd, carrying a fixing term every
spell beside it scores zero on. Raising the weight would buy ordering in the one
group that wants it by distorting the mixed ones.

## Consequences

The same deck and endpoint, `fills-land`, 442 candidates:

| card | before | after |
|---|---|---|
| Matzalantli, the Great Door // The Core | 1 | 85 |
| Treasure Map // Treasure Cove | 2 | 86 |
| Rush of Inspiration // Crackling Falls | 3 | 127 |
| Voldaren Estate | 8 | 88 |
| Cavern of Souls | 23 | 174 |
| Command Tower | 18 | **7** |
| Exotic Orchard | 19 | **8** |
| Steam Vents | 20 | **9** |
| Sulfur Falls | 21 | **10** |
| Shivan Reef | 24 | **12** |
| Training Center | 26 | **14** |
| Stormcarved Coast | 31 | **19** |

This changes what the product recommends for every deck with a land gap, which
is why it is an ADR. Nothing is filtered: every demoted card is still in the
group and still reachable, for the same reason a tapped dual is not scored as
zero — these are real cards real decks play. What the category may not do is
lead with them.

### Known and not fixed

**A coloured ability gated behind a mana cost is not detected.** Capital City
({1} for a colour) and Baxter Building ({4} for four) still rank 4th and 5th,
above Steam Vents, on `card-draw` tags. Every rule tried for this also flagged
the entire filter-land cycle — Mystic Gate, Cascade Bluffs, Graven Cairns — whose
activation cost is a hybrid mana symbol, because `producedMana` is a flat array
with no attribution to the ability that produces each colour. Demoting the filter
lands to catch Baxter Building is the trade this file already refused once, for
shocklands. Fixing it properly needs per-ability colour attribution, which the
data shape does not carry.

**A one-colour land can still beat a two-colour one.** Minamo, School at Water's
Edge (one of two colours, plus a near-combo) ranks 6th, above Steam Vents. This
is the 0.35-versus-0.40 arithmetic above, and it is the part of the builder's
principle that is still not fully honoured. It is bounded now — it takes an
actual near-combo rather than any incidental keyword — but it is not gone.

**A spell whose back face is a land is still counted and grouped as a land.**
Rush of Inspiration is an Instant that draws two cards, and it is in the land
category at all because `card.roles` is `["land"]`. Under ADR-0031's principle —
a card is offered under the role it is counted as — the better fix is in role
derivation, not in scoring. That is a larger blast radius and a different task;
this ADR only stops such cards from leading the category.
