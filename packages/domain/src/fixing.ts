import type { Card, Color } from './card.js'

/**
 * How much a card helps cast the deck's spells.
 *
 * The land category was ranked entirely by rules text, because rules text was
 * all the scorer could see. The result was a list with no duals in it at all:
 * cycling deserts and MDFCs with a whole spell side beat Steam Vents and
 * Command Tower, because a dual's text is a mana ability and a mana ability
 * produces no synergy tags and joins no combos. Measured on an Izzet deck,
 * every one of the top 40 "fills land" suggestions scored on `keyword-synergy`
 * or `near-combo`, and the best of them were Smoldering Crater and Desert of
 * the Fervent — lands whose only merit is that they cycle.
 *
 * A land's job is mana. This is the term that says so.
 */

/** 0 for a land that does nothing for this deck, 1 for one that fixes it fully. */
export interface Fixing {
  /** How many of the deck's own colours this card can produce. */
  readonly coloursCovered: number
  /** Produces mana of some kind, even if only colourless. */
  readonly producesMana: boolean
  /** Unconditionally enters tapped, as far as its rules text says. */
  readonly entersTapped: boolean
  /** 0..1, the value used for ordering. */
  readonly value: number
}

export const NO_FIXING: Fixing = {
  coloursCovered: 0,
  producesMana: false,
  entersTapped: false,
  value: 0,
}

/**
 * Score a card's mana contribution against a deck's colour identity.
 *
 * The shape of the curve matters more than the exact numbers, so it is stated
 * rather than tuned:
 *
 *   - Covering MORE of the deck's colours is better, and the gain per colour
 *     shrinks. The step from one colour to two is the difference between a
 *     basic and a dual and is worth a lot; the step from four to five in a
 *     five-colour deck is worth much less, because by then the deck is already
 *     casting its spells.
 *   - A card that produces only colourless still beats one that produces
 *     nothing. A Wastes is a bad land and an Ancient Tomb is a fine one, but
 *     both are mana; a land with no mana ability is a spell that costs you a
 *     land drop.
 *   - A MONOCOLOUR deck is the case that needs care. Every land producing its
 *     one colour covers 100% of the identity, so the term would rank all of
 *     them identically and change nothing — which is correct. A mono-red deck
 *     does not need fixing, and the scorer should not pretend it does.
 *
 * Colourless-only production is scored as a fraction of one colour rather than
 * zero, so it orders above nothing and below any real fixing.
 */
const COLOURLESS_ONLY = 0.15

/**
 * A land that enters tapped, unconditionally.
 *
 * Read from rules text, which is a heuristic — but a checked one. The naive
 * version, `/enters tapped/`, is WRONG in the way that matters most: it flags
 * Steam Vents and every other shockland, because a shockland says "you may pay
 * 2 life. If you don't, it enters tapped", and it flags every checkland, which
 * says "unless you control a...". Demoting the best duals in the game would be
 * worse than not modelling this at all.
 *
 * So the rule is "says it enters tapped, and says nothing that makes it
 * conditional". Validated against thirty hand-picked lands chosen to be hard —
 * every shockland, checkland, fastland, painland and Commander-relevant utility
 * land — and correct on all thirty. Two of the exclusions were found that way
 * rather than guessed:
 *
 *   - Training Center reads "enters tapped unless you have two or more
 *     opponents", which in Commander is always.
 *   - Mariposa Military Base reads "You may have this land enter tapped", which
 *     is a choice, not a cost.
 *
 * `enters the battlefield tapped` is the older wording and still in print on
 * cards like Gate to Tumbledown, so both are matched.
 */
const ENTERS_TAPPED = /enters (?:the battlefield )?tapped/i
const CONDITIONAL = /unless|you may pay|you may have|if you do|choose one/i

export const entersTapped = (card: Card): boolean =>
  ENTERS_TAPPED.test(card.oracleText) && !CONDITIONAL.test(card.oracleText)

/**
 * What a tapped land keeps of its fixing value.
 *
 * Not zero. A tapped dual is a real card that real decks play, and scoring it
 * as if it produced nothing would be a worse lie than the one being fixed. It
 * is simply worse than the same land untapped, which is the whole claim.
 */
const TAPPED_PENALTY = 0.6

export const fixingFor = (card: Card, identity: readonly Color[]): Fixing => {
  const produced = card.producedMana ?? []
  if (produced.length === 0) return NO_FIXING
  const tapped = entersTapped(card)

  const wanted = new Set<string>(identity)
  const coloursCovered = [...new Set(produced)].filter((m) => wanted.has(m)).length

  // A colourless deck wants colourless mana, so "covers none of my colours" is
  // not a criticism there — there are no colours to cover.
  if (identity.length === 0 || coloursCovered === 0) {
    return {
      coloursCovered: 0,
      producesMana: true,
      entersTapped: tapped,
      value: COLOURLESS_ONLY * (tapped ? TAPPED_PENALTY : 1),
    }
  }

  /*
   * Diminishing returns, expressed as a share of the identity with the first
   * colour weighted heaviest. `sqrt` rather than a linear share: the difference
   * between covering one of five colours and two of five is a real improvement
   * to a five-colour mana base, but it is not twice as good, and a linear term
   * would let a five-colour land outrank a combo piece in a group where the
   * deck already has enough sources.
   */
  return {
    coloursCovered,
    producesMana: true,
    entersTapped: tapped,
    value: Math.sqrt(coloursCovered / identity.length) * (tapped ? TAPPED_PENALTY : 1),
  }
}

/**
 * Whether the fixing term should apply at all.
 *
 * Only to cards whose job is mana. A creature that taps for one colour is a
 * mana dork and genuinely does fix, but it is competing in a group of creatures
 * where its body and its text are the interesting part; letting fixing reorder
 * that group would be the same mistake in the other direction. Lands compete
 * only with other lands, so this is where the term belongs.
 */
export const isManaSource = (card: Card): boolean => card.types.includes('land')
