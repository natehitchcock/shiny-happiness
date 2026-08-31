/**
 * The two colour pictures of a deck: what it IS, and what it MAKES.
 *
 * They are separate questions and were being answered by one chart, badly. A
 * deck's colour identity is what its cards are; its colour generation is what
 * its mana base can pay for. Neither answers the other — a Boros deck full of
 * Signets and a Boros deck full of Plains have the same identity and completely
 * different mana — which is why there are two records here and not one.
 *
 * Pure (R1). Given the same deck and the same cards it always returns the same
 * numbers, and both `web` and `api` can therefore compute it.
 */

import type { Card, Color, ManaLetter } from './card.js'
import { acceptedCopies, type Deck } from './deck.js'
import type { OracleId } from './ids.js'

/**
 * A bucket in the identity chart.
 *
 * The five colours, plus the two cases a Magic card frame itself distinguishes:
 * `M` for gold — two or more colours — and `C` for no colour identity at all.
 *
 * `M` exists so the chart is a real part-to-whole. The rejected alternative was
 * counting a gold card once in EACH of its colours, which is more informative
 * per card and makes the slices sum to more than the deck holds: a 100-card
 * five-colour deck would draw a pie of 160, and the one thing a pie's area is
 * for is saying what share of the whole a slice is. A chart that cannot be
 * summed is not a pie, it is a bar chart wearing one. What that costs — you
 * cannot see WHICH colours the gold cards are — is paid back by `generation`,
 * which does count per colour and is where "can I actually cast this" is
 * answered.
 *
 * The letters match `IDENTITY_COLORS` in `@roundtable/ui`, which is where their
 * hues live. That package is a design system with no dependency on this one by
 * design, so the two lists are separate on purpose; they are keyed by the same
 * seven letters and a change to either without the other is a bug.
 */
export type IdentityBucket = Color | 'M' | 'C'

/** Draw order for the identity chart: WUBRG, then gold, then colourless. */
export const IDENTITY_BUCKETS: readonly IdentityBucket[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C']

/** Draw order for the generation chart. Colourless is a thing mana IS. */
export const MANA_LETTERS: readonly ManaLetter[] = ['W', 'U', 'B', 'R', 'G', 'C']

/** Which slice of the identity chart a card falls in. Exactly one, always. */
export const identityBucket = (colorIdentity: readonly Color[]): IdentityBucket => {
  if (colorIdentity.length === 0) return 'C'
  if (colorIdentity.length > 1) return 'M'
  return colorIdentity[0] ?? 'C'
}

export interface ColorBalance {
  /**
   * Copies per identity bucket. Mutually exclusive, so these sum to `cards`.
   */
  readonly identity: Readonly<Record<IdentityBucket, number>>
  /**
   * Copies that can produce each kind of mana, from Scryfall's `produced_mana`.
   *
   * NOT exclusive and deliberately so: a Command Tower is in five of these
   * slices, a Steam Vents in two, and that is the fact a mana base is read for.
   * They therefore sum to more than `producers`, and any UI drawing them has to
   * say what its total means rather than implying a card count.
   */
  readonly generation: Readonly<Record<ManaLetter, number>>
  /** Accepted copies counted, commanders included. The identity total. */
  readonly cards: number
  /** Copies producing at least one kind of mana — the generation chart's base. */
  readonly producers: number
  /**
   * Copies whose production is not known, as opposed to known to be nothing.
   *
   * `Card.producedMana` is optional because "produces nothing" is a claim and
   * "we never asked" is a gap, and `[]` cannot say both. This function keeps
   * them apart so that a future `card.producedMana ?? []` written at the top of
   * the loop — which is the natural thing to write and would erase the
   * distinction for good — fails a test instead of passing quietly.
   *
   * **It is 0 for anything loaded from our own Postgres, and that is a
   * limitation of migration 0008 rather than of this function.** That migration
   * added `produced_mana char(1)[] NOT NULL DEFAULT '{}'`, so a row written
   * before it and a fetchland are the same bytes on disk and read back as the
   * same `[]`. The API therefore has no gap to report and reports none; a
   * caveat that can never appear would be worse than no caveat at all. Anything
   * that CAN express the absence — a fixture, a decklist importer, a corpus
   * read some other way — is not silently flattened here.
   */
  readonly unknownProduction: number
}

const emptyIdentity = (): Record<IdentityBucket, number> => ({
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  M: 0,
  C: 0,
})

const emptyGeneration = (): Record<ManaLetter, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

/**
 * Both charts, counted over the deck's accepted COPIES.
 *
 * Copies, not distinct cards. The mana base is the whole reason either chart is
 * on screen, and a mana base is thirty-eight lands of which twelve are the same
 * Mountain; counting the Mountain once — which is what iterating `acceptedSet`
 * did — reports the deck's most numerous red source as a single card and makes
 * a two-colour deck look evenly split when it is nine tenths one colour.
 *
 * Generation reads `producedMana`, never `colorIdentity`. They agree for Steam
 * Vents and disagree for exactly the lands that decide a mana base: Command
 * Tower's identity is empty and it taps for all five, while a fetchland's
 * identity is empty and it produces nothing at all. Reading identity here gave
 * both of them the same answer, and neither answer was right.
 *
 * Not restricted to lands, either. Sol Ring, a Signet and a Llanowar Elves are
 * mana sources by any reading a builder cares about, and a chart that omitted
 * them would under-report an artifact ramp deck by a third. The cost is that
 * one-shot production counts too — Dark Ritual is a black producer here — which
 * is Scryfall's own reading of `produced_mana` and is left as it is rather than
 * second-guessed with a rules-text heuristic.
 */
export const colorBalance = (deck: Deck, cards: ReadonlyMap<OracleId, Card>): ColorBalance => {
  const identity = emptyIdentity()
  const generation = emptyGeneration()
  let counted = 0
  let producers = 0
  let unknownProduction = 0

  for (const oracleId of acceptedCopies(deck)) {
    const card = cards.get(oracleId)
    // A copy whose card is not in the corpus is left out of both totals rather
    // than bucketed as colourless: it has no identity we know of, and `C` is an
    // answer. `legality` reports it as `unknown-card`; this is not the place.
    if (card === undefined) continue
    counted += 1
    identity[identityBucket(card.colorIdentity)] += 1

    const produced = card.producedMana
    if (produced === undefined) {
      unknownProduction += 1
      continue
    }
    if (produced.length > 0) producers += 1
    for (const letter of produced) generation[letter] += 1
  }

  return { identity, generation, cards: counted, producers, unknownProduction }
}
