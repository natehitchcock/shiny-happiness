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
  /** Every coloured mana ability it has is spend-restricted. */
  readonly restricted: boolean
  /** Not a land drop: it has a mana cost and must be cast before it is a land. */
  readonly mustBeCast: boolean
  /** 0..1, the value used for ordering. */
  readonly value: number
}

export const NO_FIXING: Fixing = {
  coloursCovered: 0,
  producesMana: false,
  entersTapped: false,
  restricted: false,
  mustBeCast: false,
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
 *
 * READ PER CLAUSE, NOT PER CARD. Both tests used to run over the whole of
 * `oracleText`, so any conditional word anywhere on the card cancelled an
 * unconditional tapped clause on a different line. Measured over the 1,168
 * legal lands in the corpus that is twenty cards, every one of them wrong in
 * the same direction and none of them a near miss:
 *
 *   - Dakmor Salvage — the "if you do" is inside DREDGE'S REMINDER TEXT.
 *   - Coral Atoll and the rest of the karoo cycle, Rupture Spire, Archway
 *     Commons — "sacrifice it unless you pay {1}" is a second cost, not a way
 *     to enter untapped.
 *   - Valakut, the Molten Pinnacle — "you may have this land deal 3 damage".
 *   - Rush of Inspiration // Crackling Falls and Jwari Disruption // Jwari
 *     Ruins — `oracleText` is BOTH FACES concatenated, so the spell face's
 *     "unless" was cancelling the land face's tapped clause.
 *
 * Splitting on lines fixes all twenty and moves nothing the other way: the
 * thirty hand-picked lands this rule was validated against are unchanged,
 * because a shockland, a checkland and a fastland each state the condition in
 * the SAME clause as the tapped-ness ("...you may pay 2 life. If you don't, it
 * enters tapped."), which is exactly what makes them conditional.
 */
const ENTERS_TAPPED = /enters (?:the battlefield )?tapped/i
const CONDITIONAL = /unless|you may pay|you may have|if you do|choose one/i

const lines = (card: Card): readonly string[] => card.oracleText.split('\n')

export const entersTapped = (card: Card): boolean =>
  lines(card).some((line) => ENTERS_TAPPED.test(line) && !CONDITIONAL.test(line))

/**
 * Mana the deck is not allowed to spend.
 *
 * `producedMana` is Scryfall's "colours this card can ever make", and it counts
 * a restricted ability at full value. Villainous Hideout lists all five colours
 * and gives an Izzet deck none of them: its any-colour mana may be spent only
 * on Villain spells. Thirty-four legal lands are like this, and they are the
 * tribal and faction any-colour lands — Cavern of Souls, Unclaimed Territory,
 * Secluded Courtyard, Ancient Ziggurat, Sliver Hive, Base Camp. Every one of
 * them claims five or six colours in the corpus.
 *
 * "Spend this mana only" is a fixed Oracle template, so this is an exact match
 * rather than a heuristic. It is read PER ABILITY and the card is only
 * discounted when EVERY coloured ability is restricted — Plaza of Heroes has a
 * restricted any-colour ability and an unrestricted one, and a deck that can
 * still reach its colours has not been sold anything false. Checked against the
 * whole land corpus: no premium fixer is flagged, including every filter land,
 * every shockland, every Triome, City of Brass and Command Tower.
 *
 * Rejected: also discounting mana that costs mana to activate ("{4}, {T}: Add
 * four mana in any combination of colors" — Baxter Building). It is the same
 * defect and it is real, but every rule for it that was tried also flagged the
 * entire filter-land cycle, whose activation cost is a hybrid mana symbol.
 * Demoting Mystic Gate and Cascade Bluffs to catch Baxter Building is the
 * trade this file already refused once, for shocklands.
 */
const RESTRICTED = /spend this mana only/i
const COLOURED_ADD = /\{[WUBRG]\}|any colou?r|any type|mana of any/i

const restrictedFixing = (card: Card): boolean => {
  let sawColouredAbility = false
  for (const line of lines(card)) {
    if (!/\bAdd\b/.test(line) || !COLOURED_ADD.test(line)) continue
    sawColouredAbility = true
    if (!RESTRICTED.test(line)) return false
  }
  return sawColouredAbility
}

/**
 * A "land" you have to cast first.
 *
 * A land has no mana cost, so `manaValue > 0` on a card whose types include
 * `land` is exactly and only the two-faced cards with a spell on the front —
 * fifty-six of them in the corpus, and zero single-faced lands, so this needs
 * no rules text and cannot misfire on a real land. They reach the land category
 * because `types` is the union of both faces.
 *
 * They led it. The Izzet measurement had Matzalantli, Treasure Map, Rush of
 * Inspiration and Azor's Gateway as the top four suggestions for a land gap,
 * above every dual in the format, on the strength of a `producedMana` that
 * describes the back face and a rules text that describes the front. Treasure
 * Map taps for every colour after {2}, a card, and three activations.
 *
 * Discounted rather than excluded, for the same reason a tapped dual is: these
 * are real cards real decks play, and the category is still allowed to offer
 * them. What it may not do is lead with them.
 */
const mustBeCast = (card: Card): boolean => card.manaValue > 0

/**
 * How much of its coverage a land keeps once you count what the mana costs you.
 *
 * `coloursCovered` SATURATES, and that is what these are for. In a two-colour
 * deck every land that taps for both colours scores an identical 1.0, so the
 * term orders duals above basics and then stops — at exactly the point the
 * builder still has a question. What decided the order after that was the terms
 * `fixing` exists to overrule: an incidental `card-draw` tag is worth
 * `keywordSynergy × 0.5 = 0.35`, and covering one more colour of a two-colour
 * identity is worth `fixing × (1 − √0.5) = 0.35`. One shared keyword equalled
 * one whole colour of a mana base, and there was nothing left to break the tie
 * among lands that already covered everything.
 *
 * So these are not new terms. They are the same claim `TAPPED_PENALTY` already
 * makes — mana you cannot use is worth less than mana you can — applied to the
 * two other ways the corpus overstates a land, and they keep discriminating
 * after coverage has maxed out, which no reshaping of `coloursCovered /
 * identity.length` can do.
 *
 * The numbers are ordered, not tuned, and each one is a comparison a builder
 * would recognise:
 *
 *   - TAPPED (0.6) is the existing anchor. Entering tapped costs you one turn.
 *   - RESTRICTED (0.5) sits BELOW it, because a restriction costs you every
 *     turn rather than the first. A tapped Izzet dual really is better than
 *     Cavern of Souls in a deck casting no creatures.
 *   - MUST BE CAST (0.4) sits below a real land that taps for only ONE of your
 *     two colours (√0.5 = 0.707) and above one that taps for none of them
 *     (COLOURLESS_ONLY, 0.15). A card you have to pay for is worth less than
 *     the worst land that still makes a colour you need, and more than a land
 *     that makes none.
 *
 * They MULTIPLY, so a card with two problems ranks below one with either. Sea
 * Gate Restoration is a seven-mana sorcery whose land face enters tapped.
 */
const TAPPED_PENALTY = 0.6
const RESTRICTED_PENALTY = 0.5
const MUST_BE_CAST_PENALTY = 0.4

export const fixingFor = (card: Card, identity: readonly Color[]): Fixing => {
  const produced = card.producedMana ?? []
  if (produced.length === 0) return NO_FIXING
  const tapped = entersTapped(card)
  const restricted = restrictedFixing(card)
  const cast = mustBeCast(card)
  const availability =
    (tapped ? TAPPED_PENALTY : 1) *
    (restricted ? RESTRICTED_PENALTY : 1) *
    (cast ? MUST_BE_CAST_PENALTY : 1)

  const wanted = new Set<string>(identity)
  const coloursCovered = [...new Set(produced)].filter((m) => wanted.has(m)).length

  // A colourless deck wants colourless mana, so "covers none of my colours" is
  // not a criticism there — there are no colours to cover.
  if (identity.length === 0 || coloursCovered === 0) {
    return {
      coloursCovered: 0,
      producesMana: true,
      entersTapped: tapped,
      restricted,
      mustBeCast: cast,
      value: COLOURLESS_ONLY * availability,
    }
  }

  /*
   * Diminishing returns, expressed as a share of the identity with the first
   * colour weighted heaviest. `sqrt` rather than a linear share: the difference
   * between covering one of five colours and two of five is a real improvement
   * to a five-colour mana base, but it is not twice as good.
   *
   * KEPT, deliberately, after the saturation defect above was measured. The
   * curve was the obvious suspect and it is not the culprit, for two reasons
   * that are worth writing down because the next person will suspect it too:
   *
   *   - It cannot order two lands that BOTH cover the whole identity, and that
   *     is the modal case in a two-colour deck and the one that was reported.
   *     No reshaping of `coloursCovered / identity.length` reaches it.
   *   - It cannot be made much steeper either. Any concave curve through (0,0)
   *     and (1,1) scores one of two colours at 0.5 or more, so against `sqrt`'s
   *     0.707 the most a reshape could buy is 0.2 of value — and giving up
   *     concavity means giving up diminishing returns, which is the one part of
   *     this term nobody disputes.
   *
   * The original argument for `sqrt` also warned that a linear term "would let
   * a five-colour land outrank a combo piece". That risk is REAL and it is not
   * only about linearity. Grouping runs before scoring, but not every group is
   * one kind of card: on the Izzet deck measured here, `near-combo` held 334
   * cards of which two were lands — Wandering Fumarole ranked 23rd, carrying a
   * fixing term that every spell around it scores zero on.
   *
   * That is why `w.fixing` is left at 1.2 rather than raised, which was the
   * other obvious way to make coverage decisive inside `fills-land`. It would
   * buy ordering in the one group that wants it by distorting the mixed ones,
   * and mana is not what `near-combo` is about.
   */
  return {
    coloursCovered,
    producesMana: true,
    entersTapped: tapped,
    restricted,
    mustBeCast: cast,
    value: Math.sqrt(coloursCovered / identity.length) * availability,
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
