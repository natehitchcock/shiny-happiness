# 24. Two colour charts: identity and generation

Date: 2026-08-31

## Status

Accepted.

> **Number 0024 is taken by this ADR.** 0023 is damage-versus-life-loss, dated
> the same day. The next agent should take 0025.

## Context

A user reported one sentence:

> "colorless cards aren't showing up in the mana colors pie chart. There should
> be two pie charts, one for color identity of cards, and one for color
> generation, and colorless cards should be on both"

They are right about all three parts. The single chart under the composition
bars was built on this, in [`analysis.ts`](../../apps/api/src/routes/analysis.ts):

```ts
const pips:    Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
const sources: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
for (const oracleId of accepted) {
  const card = cards.get(oracleId)
  if (card === undefined) continue
  for (const symbol of card.manaCost?.match(/\{([WUBRG])\}/g) ?? []) { ...pips... }
  if (card.types.includes('land')) {
    for (const color of card.colorIdentity) sources[color] = ... }
}
```

Three separate defects, none of which the chart could survive:

1. **There is no colourless bucket anywhere.** Neither record has a `C` key and
   the pip regex is `[WUBRG]`. Sol Ring, Wastes and every utility land were in
   the deck and in no slice.
2. **`sources` reads `colorIdentity`, which is the wrong field.** Command
   Tower's identity is `[]` and it taps for all five, so the best fixing land in
   the format contributed nothing to any colour. A fetchland has the same empty
   identity and produces nothing at all, and the old code could not tell them
   apart. `Card.producedMana` — Scryfall's `produced_mana`, added by migration
   0008 and explicitly including `C` — is the field that answers the question.
3. **`accepted` is `acceptedSet`, which is a `Set` of oracle ids.** Ten
   Mountains counted once. For a mana-base chart that is not an approximation,
   it is a different question with a coincidentally similar shape.

The third defect had already been noticed and worked around in the client, which
labelled its land figure **"N lands"** rather than "sources" precisely because
the number was distinct cards. That is a label written to route around a bug.

## Decision

### Two charts, not one

`colorBalance` now carries two records, computed by `colorBalance()` in
[`packages/domain/src/color-balance.ts`](../../packages/domain/src/color-balance.ts)
over `acceptedCopies(deck)`:

- **`identity`** — one bucket per accepted copy, keyed `W U B R G M C`. What the
  deck **is**.
- **`generation`** — a count per kind of mana each accepted copy produces, keyed
  `W U B R G C`, read from `producedMana`. What the deck **makes**.

They are separate because they are separate questions and one chart was
answering neither. A Boros deck of Plains and a Boros deck of Signets have the
same identity and nothing else in common, and the reading that matters most is
the *gap* between the two — a deck two-thirds green whose generation chart is
one-third green will not cast its spells. Both are counted over the same copies
in one call, so the two are always about the same deck.

### A multicolour card goes in `M`, not in each of its colours

This is the one real design choice and it is made deliberately.

Counting a gold card once in each of its colours is more informative per card
and makes the slices sum to more than the deck holds: a hundred-card five-colour
deck would draw a pie of a hundred and sixty. The single thing a pie's area is
for is saying what share of the whole a slice is, so a pie that cannot be summed
is a bar chart wearing one.

What it costs is that you cannot see *which* colours the gold cards are. That is
paid back by the generation chart, which is not exclusive, does count per colour,
and is where "can I actually cast this" is answered. Each figure states what its
slices sum to, on screen, in its own words — identity to the deck's card count,
generation to more than the number of cards that make mana.

The `M`/`C` convention is not invented here: `IDENTITY_COLORS` in
`packages/ui/src/card/presentation.ts` has carried both since UI-01, with hues
measured in the same palette run as the five colours.

### Generation is not lands-only

Sol Ring, a Signet and a Llanowar Elves are mana sources by any reading a
builder cares about, and a lands-only chart under-reports an artifact ramp deck
by a third. The cost is that one-shot production counts too — Dark Ritual is a
black producer here — which is Scryfall's own reading of `produced_mana`. Left
as it is rather than second-guessed with a rules-text heuristic, which is the
kind of derived-taxonomy guessing doc 04 §4.2 exists to discourage.

### `pips` and `sources` are removed from the wire

This is a contract change under AGENTS.md R2 and is why this ADR exists.

`sources` is deleted because it was wrong in two ways at once and `generation`
is the corrected answer. `pips` is deleted because nothing renders it: it
counted `{W}` symbols in mana costs over distinct cards, which is a third
question, and leaving a field on the wire that no client reads is how doc 10
comes to describe a response nobody produces. It can come back, correctly
counted over copies, the day a chart wants it.

The web client's `colorBalance` reader falls back to an empty record for both
keys, so a server from between API-02 and this ADR draws the "nothing yet" line
rather than throwing on a property of `undefined`.

## Consequences

- The **"N lands" hedge is gone.** With generation counted over copies, over
  everything that makes mana, and from the right field, there is nothing left to
  hedge against; the label and the `.pie-sources` column it lived in are both
  deleted, and a comment in `styles.css` records why.
- **Colourless is on both charts**, which is what was asked for and is a real
  answer rather than a gap in either.
- The palette bargain in `PIP_CVD_NOTE` and the `ColorPie` header now covers
  seven letters instead of five. Magic's own colours still fail the categorical
  validator on lightness band, chroma floor and a 6.3 ΔE protan pair, they are
  still shipped unchanged because a player's white pips have to look white, and
  they are still paid for the same way: a letter and a count per slice, a
  `var(--ink)` stroke between wedges, and every bucket named in words in each
  figure's accessible label. Grey `C` beside pale gold `M` is exactly the pair
  that needs the letter.
- **`unknownProduction` is computed and not reported.** `Card.producedMana` is
  optional because "produces nothing" is a claim and "we never asked" is a gap.
  The domain function keeps them apart, and tests pin that it does — but
  migration 0008 added `produced_mana char(1)[] NOT NULL DEFAULT '{}'`, so a row
  written before it and a fetchland are the same bytes on disk. The API can
  therefore never detect the gap, and reports none rather than wiring a caveat
  to a branch that cannot run.

## Alternatives rejected

**One chart with two columns per row, as before.** This is what shipped and it
is what made the bug hard to see: two numbers counted over different things,
sharing a legend, with the wedges drawn from only one of them. Two figures make
the two questions visibly separate and force each to state its own total.

**Counting gold cards in every colour.** Covered above: the slices stop summing
to the deck, which is the whole content of a pie.

**Recolouring the palette to pass the validator.** Rejected once already in
`PIP_CVD_NOTE` and rejected again here for the same reason. A chart where the
white slice is not white is unreadable to the only people who will read it.

**Keeping `sources` alongside `generation` for compatibility.** There is one
client, in this repository, shipped from the same commit. A deprecated field
carrying a known-wrong number is a trap for the next agent, not a courtesy.
