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

/**
 * HOW the card reaches those colours, so the reason can say something true.
 *
 * Pillar P4. Every cost-gated land rendered "taps for 5 of your 5 colours",
 * and it is false on all of them: Baldur's Gate taps for {C} and wants {2} and
 * a board of Gates, The Grey Havens reads colours off legendary creatures in
 * your GRAVEYARD, Gemstone Caverns needs a luck counter it can only have from
 * an opening hand, Mirrex works only on the turn it entered. Fixing the score
 * and leaving the sentence would have left the product lying more quietly.
 *
 * A discriminator rather than a rendered string, because `packages/domain` does
 * not write copy — the web app phrases it, and the API contract carries the
 * fact (`recommendation.ts`).
 */
export type FixingReach =
  /** No mana and nothing to find. */
  | 'none'
  /** Mana, but none of the deck's colours. */
  | 'colourless'
  /** Tapping it is enough. City of Brass, Steam Vents, Command Tower. */
  | 'taps'
  /** The colours are there; the mana may only be spent on certain spells. */
  | 'restricted'
  /** Reaching them costs mana, a permanent, or a board state the deck may lack. */
  | 'gated'
  /** It makes no mana at all; it searches up a land that does. */
  | 'fetches'

/** 0 for a land that does nothing for this deck, 1 for one that fixes it fully. */
export interface Fixing {
  /** How many of the deck's own colours this card can actually reach. */
  readonly coloursCovered: number
  /** Produces mana of some kind, even if only colourless. */
  readonly producesMana: boolean
  /** Unconditionally enters tapped, as far as its rules text says. */
  readonly entersTapped: boolean
  /** Every coloured mana ability it has is spend-restricted. */
  readonly restricted: boolean
  /** Not a land drop: it has a mana cost and must be cast before it is a land. */
  readonly mustBeCast: boolean
  /** What the reason is allowed to claim about those colours. */
  readonly reach: FixingReach
  /** 0..1, the value used for ordering. */
  readonly value: number
}

export const NO_FIXING: Fixing = {
  coloursCovered: 0,
  producesMana: false,
  entersTapped: false,
  restricted: false,
  mustBeCast: false,
  reach: 'none',
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
 * rather than a heuristic. It is read PER ABILITY and the card is only flagged
 * when EVERY coloured ability is restricted — Plaza of Heroes has a restricted
 * any-colour ability and an unrestricted one, and a deck that can still reach
 * its colours has not been sold anything false. Checked against the whole land
 * corpus: no premium fixer is flagged, including every filter land, every
 * shockland, every Triome, City of Brass and Command Tower.
 *
 * `COLOURED_ADD` NOW MATCHES "in any combination of colors", and that is a
 * measured bug fix rather than tidying. The old alternation wanted a `{W}`-style
 * symbol or the words "any color"/"any type", and three legal lands say neither
 * while carrying the exact restriction template in their very next sentence:
 * Great Hall of the Citadel, Crucible of the Spirit Dragon and The Mystical
 * Archive. Great Hall scored 2.250, ranked 19th of 677 on a five-colour deck,
 * and Quickbuild put it in the deck. ADR-0035's "zero false positives" claim
 * survives untouched; this is a false NEGATIVE it did not measure.
 *
 * The flag is REPORTED but no longer multiplied into `value` on its own. The
 * discount moved into `openness` below, where it is read per ability, so a card
 * with one restricted and one open ability is priced on the open one instead of
 * being discounted as a whole. Multiplying in both places would charge Cavern
 * of Souls twice for the same sentence.
 */
const RESTRICTED = /spend this mana only/i
const COLOURED_ADD = /\{[WUBRG]\}|any colou?r|any type|mana of any|combination of colou?rs/i

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
 * other ways the corpus overstates a land, and they keep discriminating after
 * coverage has maxed out, which no reshaping of `coloursCovered /
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

/**
 * What it costs to ACTIVATE the ability, as opposed to what the mana buys.
 *
 * ADR-0035 priced three whole-card faults and left the one it could not reach,
 * saying so: "a coloured ability gated behind a mana cost is not detected …
 * fixing it properly needs per-ability colour attribution, which the data shape
 * does not carry." That was true of `producedMana`, which is a flat array. It
 * is not true of the oracle text, where an ability states its own cost on its
 * own line, and reading it there is what these three numbers are.
 *
 * Measured on a five-colour Najeela deck, `fills-land`, 677 candidates: the
 * head of the list was a THIRTY-THREE-WAY TIE at 2.250. `sqrt(covered / n)`
 * cannot order a group in which every card reaches five of five, and every one
 * of those thirty-three did — City of Brass and Reflecting Pool tied with
 * Baldur's Gate, The Grey Havens, Gemstone Caverns, Mirrex and Study Hall. The
 * tie is not noise to be broken with a nudge; it is the term reporting, truly,
 * that it has run out of things to say. The question it never asked is what
 * reaching those five colours costs, and these ask it.
 *
 *   - CONVERSION (0.30) — the ability produces no more mana than it consumes.
 *     `{1}, {T}: Add one mana of any color` adds NOTHING to your pool: it turns
 *     one generic into one coloured, so it is two lands doing one land's work
 *     (× 0.5) and it does nothing at all until the second land is there, which
 *     is the delay `TAPPED_PENALTY` already prices (× 0.6). Both costs are real
 *     and they are different costs, so they compose.
 *
 *     THIS IS WHY FILTER LANDS SURVIVE. Cascade Bluffs pays a hybrid symbol and
 *     gets TWO mana back, so it nets one exactly as a plain land does and is
 *     not a converter at all. ADR-0035 refused to demote the filter cycle to
 *     catch Baxter Building and had to phrase it as an exception; net mana
 *     separates them without one, and it catches Baxter Building ({4} for four)
 *     and Crystal Quarry ({5} for five) as the same defect at a larger number.
 *
 *   - CONDITIONAL (0.25) — the colours come from a game state, not from the
 *     land. RESTRICTED squared, and the square is the argument: a
 *     spend-restriction limits what the mana may buy, and this limits that AND
 *     whether there is any mana at all. The Grey Havens taps for five colours
 *     only if the right legendary creatures are in your graveyard; a
 *     five-colour deck starts with an empty one.
 *
 *   - MIRRORED (0.5) — the colours come from a LAND you control. Held at the
 *     restriction penalty rather than the conditional one, and this is the
 *     counter-example that forced the split: Reflecting Pool and Exotic Orchard
 *     are cards people play, and a deck the product is at this moment computing
 *     a LAND deficit for is not a deck that will control no lands. What they
 *     genuinely cannot be is your FIRST source of a colour — they copy a mana
 *     base rather than build one — and a limit that applies every turn is
 *     exactly what RESTRICTED prices.
 *
 *   - ONE SHOT (0.15) — the cost eats a permanent or a counter, so the ability
 *     works once and the card is a colourless land for the rest of the game.
 *     Set EQUAL to `COLOURLESS_ONLY` on purpose: that is not a coincidence to
 *     be tidied away but the whole claim. Lazotep Quarry ranked 2nd of 677 on
 *     `{T}, Sacrifice a creature: Add one mana of any color`, and on every turn
 *     but one it is a land that taps for {C}. Scoring it above a land that taps
 *     for {C} would be claiming otherwise.
 *
 * WHAT IS DELIBERATELY NOT A GATE: LIFE. `{T}, Pay 1 life` and "this land deals
 * 1 damage to you" are the price of the best fixing in the format — City of
 * Brass, Mana Confluence, Grand Coliseum, every painland, every shockland,
 * every fetchland. A rule that reads "this land hurts you" as a condition
 * demotes the entire class it was written to promote, which is the trade this
 * file has now refused twice. Life is a price you pay out of a resource you
 * always have; mana, cards, counters and board states are prerequisites you may
 * not have at all, and that is the whole distinction.
 *
 * Rejected: a single flat "gated" discount. It moves the thirty-three tied
 * cards down together and leaves them tied, which answers the symptom and not
 * the report. Rejected also: grading CONVERSION by the size of the cost
 * (`1/(1+n)`), which is defensible arithmetic and buys nothing — net mana
 * already separates the cases that differ, and {1}-for-one and {4}-for-four are
 * the same card.
 */
const CONVERSION = TAPPED_PENALTY * 0.5
const CONDITIONAL_STATE = RESTRICTED_PENALTY * RESTRICTED_PENALTY
const MIRRORED = RESTRICTED_PENALTY
const ONE_SHOT = COLOURLESS_ONLY

/**
 * The colours a fixed choice leaves you, which is one, not five.
 *
 * Twenty-two legal lands claim all five colours in `producedMana` and make one
 * or two: the Thriving cycle, the Gate cycle, Uncharted Haven, Cryptic Spires.
 * "As this land enters, choose a color" is resolved once and never again, so
 * `{T}: Add {U} or one mana of the chosen color` is a DUAL, and the reason chip
 * read "taps for 5 of your 5 colours" on it. That is a P4 violation on its own,
 * whatever the score does with it.
 *
 * Counted as an unnamed colour rather than a named one, because the builder
 * picks it: it is guaranteed to be a colour the deck wants, which is why it is
 * worth a whole colour and not a fraction of one. Cryptic Spires circles two.
 */
const CHOSEN_ONE = /of th(?:e chosen|at) colou?r/i
const CHOSEN_TWO = /of (?:either of )?the circled colou?rs/i

/**
 * An ability that can make any colour you like.
 *
 * "any one color" is here because Baldur's Gate and Azor's Gateway say it and
 * `/any colou?r/` does not match it; "different colors" because Interplanar
 * Beacon says that and nothing else does. Both were found by sweeping the
 * corpus for lands whose parsed colour count came out at zero while
 * `producedMana` claimed five, which is where a missed phrasing hides.
 */
const ANY_COLOUR =
  /any (?:one )?colou?rs?\b|any type\b|combination of colou?rs\b|different colou?rs\b|of any of the/i

/** Everything to the left of the first colon is what you pay. */
const splitAbility = (line: string): { readonly cost: string; readonly effect: string } => {
  const colon = line.indexOf(':')
  return colon < 0
    ? { cost: '', effect: line }
    : { cost: line.slice(0, colon), effect: line.slice(colon + 1) }
}

/**
 * The mana in an activation cost.
 *
 * `{T}` is not mana and neither is `{Q}` or `{E}` — untapping and energy are
 * costs, but they are not mana you had to have from somewhere else, which is
 * the only thing this number is for. `{X}` counts as one: a land that asks for
 * an unbounded amount is not being flattered by the smallest legal answer.
 */
const manaInCost = (cost: string): number => {
  let total = 0
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1] ?? ''
    if (symbol === 'T' || symbol === 'Q' || symbol === 'E') continue
    total += /^\d+$/.test(symbol) ? Number(symbol) : 1
  }
  return total
}

const WORD_COUNT: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
}

/**
 * How much mana one activation adds.
 *
 * Three phrasings and no others in the corpus: a word ("Add two mana in any
 * combination of colors"), an X ("Add X mana of any one color"), or literal
 * symbols ("Add {W}{W}, {W}{U}, or {U}{U}"). The symbol form is a CHOICE
 * between runs, so the run length is what one activation gives you — counting
 * every symbol would read a filter land as producing six.
 *
 * `X` is one, for the same reason `{X}` in a cost is one: the card does not say
 * how much, and a term that guessed high would let Baldur's Gate claim five
 * mana in a deck with two Gates.
 */
const addedMana = (sentence: string): number => {
  const word = /\badds?\s+(one|two|three|four|five|six|seven)\b/i.exec(sentence)
  if (word !== null) return WORD_COUNT[(word[1] ?? '').toLowerCase()] ?? 1
  if (/\badds?\s+X\b/i.test(sentence)) return 1
  const start = sentence.search(/\badds?\b/i)
  const runs = (start < 0 ? sentence : sentence.slice(start)).match(/(?:\{[^}]+\})+/g)
  if (runs === null) return 1
  return Math.max(...runs.map((run) => (run.match(/\{/g) ?? []).length))
}

/**
 * A condition the deck may not meet.
 *
 * Every one of these was read off the corpus rather than imagined — the mana
 * abilities of the 193 legal lands claiming three or more colours are a short,
 * enumerable list, and this is what is in it. Each pattern is anchored on the
 * words Oracle actually uses, not on a general notion of conditionality, so
 * that a dual saying "{T}: Add {U} or {R}." cannot match any of them.
 *
 * SPLIT BY SCOPE, and the split is a measured bug fix rather than tidiness. Run
 * over the whole ability, `where X is` and `equal to the number of` both fired
 * on sentences that have nothing to do with the mana: Study Hall's rider is
 * "scry X, where X is the number of times it's been cast from the command
 * zone", and Opal Palace's is "+1/+1 counters … equal to the number of times".
 * Both are ordinary `{1}, {T}` converters and both were being charged a second
 * time for a sentence about their commander. Read against the ADD SENTENCE
 * they are exact; the two that genuinely qualify the whole ability rather than
 * the mana it makes are listed separately.
 */
const MIRRORS_A_LAND =
  /that a land (?:you control|an opponent controls) could produce|you control (?:a|an|two|three) (?:basic |untapped )?(?:lands?|Plains|Island|Swamp|Mountain|Forest)\b/i

/** Read against the sentence that adds the mana, and against the cost. */
const MANA_CONDITIONS: readonly RegExp[] = [
  // "among legendary creature cards in your graveyard" (The Grey Havens),
  // "among legendary permanents you control" (Plaza of Heroes)
  /among .{0,60}?(?:you control|in your graveyard|in exile)/i,
  // "of any color that a Gate you control could produce" (Gond Gate)
  /that (?:a|an|another) .{0,30}?(?:you control|an opponent controls) could produce/i,
  // "where X is the number of other Gates you control", "where X is your life total"
  /where X is /i,
  // "equal to the number of creatures you control", "equal to your devotion to"
  /equal to (?:the number of|your devotion)/i,
  // "Add {C} for each artifact you control" (Storm the Vault)
  /\bfor each /i,
  // "If this land has a luck counter on it, instead add one mana of any color"
  /\bif .{0,40}?\bcounters? on\b/i,
  // "{T}, Tap an untapped creature you control:" (Holdout Settlement)
  /tap an untapped/i,
  // "of any of the exiled cards' colors" (Pit of Offerings)
  /of any of the exiled/i,
  // "chosen as you drafted cards named …" (Paliano, the High City)
  /chosen as you drafted/i,
  // "Add one mana of that color unless any player pays {1}" (Rhystic Cave)
  /unless any player/i,
]

/** Read against the whole ability: these qualify WHEN it may be used at all. */
const ABILITY_CONDITIONS: readonly RegExp[] = [
  // "Activate only if this land entered this turn" (Mirrex),
  // "Activate only if you control an artifact" (Spire of Industry)
  /activate only if/i,
  // "As long as you control six or more lands, lands you control have …"
  /\bas long as\b/i,
  // "Choose a color of a permanent you control. Add one mana of that color."
  // (Meteor Crater) — the choice is the condition, in a sentence of its own.
  /choose a colou?r of a/i,
  // 'Other Caves you control have "{T}, Pay 1 life: Add one mana of any color."'
  // (Forgotten Monument) — the ability is granted to OTHER permanents, and this
  // land has none of it. It read as a five-colour source of its own.
  /\byou control have\b/i,
]

/**
 * A cost that eats something and does not give it back.
 *
 * Self-sacrifice is here too, and it is not the same thing as a FETCH: six
 * lands say "{T}, Sacrifice this land: Add one mana of any color", which is one
 * activation and then the card is gone. A fetch also sacrifices itself, but it
 * leaves a LAND behind, and that is why it is read separately below.
 */
const ONE_SHOT_COST =
  /\bsacrifice (?:a|an|another|two|three|X|this)\b|\bremove (?:a|an|X|two|three|one)\b[^:]{0,40}?counters?|\bpay \{E\}/i

/**
 * A trigger that adds mana once and never again.
 *
 * Crumbling Vestige says "When this land enters, add one mana of any color" and
 * has no coloured ACTIVATED ability at all, so it read as an unrestricted
 * five-colour source. Branch of Vitu-Ghazi is the same shape on turning face
 * up. Priced with `ONE_SHOT`, because that is what it is.
 */
const TRIGGERED_ONCE = /\bwhen this (?:land|card|permanent) (?:enters|is turned face up)/i

/**
 * A land that finds a land.
 *
 * Flooded Strand has `producedMana: []` and the data is RIGHT — a fetch makes
 * no mana — so it fell straight to `NO_FIXING`, scored 0.700 on nothing but the
 * land deficit, and ranked 652nd of 677 in a five-colour deck, below every
 * `{T}: Add {C}` utility land in the format. Its whole function is fixing.
 *
 * So it is scored as what it finds. But a fetch is the one card in this file
 * whose value is not a property of the card: it is a property of the DECK, and
 * the playtest walked into exactly that trap — Quickbuild put Evolving Wilds,
 * Terramorphic Expanse and Myriad Landscape into a deck with zero basic lands,
 * where all three are blank, and nothing on screen said so.
 *
 * Hence `DeckLands`, and hence its ABSENCE MEANING NOTHING FETCHABLE rather
 * than "unknown, assume the best". This is the one input here that does not
 * default to no-effect, for the same reason `gameChangerBudget` in
 * `recommend.ts` does not: the no-effect default would spend an allowance the
 * caller never said the deck had. A caller that forgets gets a fetch scored at
 * zero, which is exactly what it scored before this existed — forgetting is a
 * no-op, not a new way to recommend a dead card.
 */
export type BasicLandType = 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest'

export interface DeckLands {
  /** Basic land types printed on lands the deck ALREADY holds. */
  readonly types: ReadonlySet<BasicLandType>
  /** Whether any of those is an actual Basic — Evolving Wilds cannot find a Triome. */
  readonly hasBasic: boolean
}

const TYPE_COLOUR: Readonly<Record<BasicLandType, Color>> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
}
const BASIC_TYPES = Object.keys(TYPE_COLOUR) as readonly BasicLandType[]

const SEARCHES_FOR_A_LAND =
  /search your library for .{0,80}?land .{0,60}?onto the battlefield|search your library for (?:a|an|up to)[^.]{0,80}\b(?:Plains|Island|Swamp|Mountain|Forest)\b[^.]{0,80}onto the battlefield/i

interface Fetch {
  readonly colours: ReadonlySet<Color>
  readonly tapped: boolean
  readonly converts: boolean
}

const fetchIn = (card: Card, deck: DeckLands | undefined): Fetch | null => {
  if (deck === undefined) return null
  for (const line of lines(card)) {
    const { cost, effect } = splitAbility(line)
    if (!/\bsacrifice this land\b/i.test(cost)) continue
    if (!SEARCHES_FOR_A_LAND.test(effect)) continue

    // Named types win over "basic land card": Flooded Strand finds a Plains or
    // an Island and nothing else, whatever else the deck is holding.
    const named = BASIC_TYPES.filter((type) => new RegExp(`\\b${type}\\b`).test(effect))
    const wanted = named.length > 0 ? named : BASIC_TYPES
    const needsBasic = /basic land/i.test(effect)
    if (needsBasic && !deck.hasBasic) return { colours: new Set(), tapped: false, converts: false }

    const colours = new Set<Color>(
      wanted.filter((type) => deck.types.has(type)).map((type) => TYPE_COLOUR[type]),
    )
    return {
      colours,
      tapped: /onto the battlefield tapped/i.test(effect),
      converts: manaInCost(cost) > 0,
    }
  }
  return null
}

/** One colour of the identity, and how freely the land can actually reach it. */
interface Slot {
  readonly openness: number
  readonly reach: FixingReach
}

const abilitySlots = (
  card: Card,
  wanted: ReadonlySet<Color>,
): { readonly slots: readonly Slot[]; readonly parsedAnyAbility: boolean } => {
  const named = new Map<Color, Slot>()
  let wildcards: { count: number; slot: Slot } = {
    count: 0,
    slot: { openness: 0, reach: 'taps' },
  }
  let parsedAnyAbility = false

  for (const line of lines(card)) {
    if (!/\badds?\b/i.test(line)) continue
    const { cost, effect } = splitAbility(line)
    parsedAnyAbility = true

    const gatedWhole = ABILITY_CONDITIONS.some((pattern) => pattern.test(line))

    // Only the sentences that ADD say what colours come out, and only they say
    // what those colours are conditioned on. "Spend this mana only to cast a
    // Sliver spell" is on the same line and names no colour, and Gemstone
    // Caverns puts its any-colour clause in a SECOND sentence after "Add {C}."
    // — so every add-sentence on the line contributes, separately.
    for (const sentence of effect.split(/(?<=[.;])\s+/)) {
      if (!/\badds?\b/i.test(sentence)) continue

      let openness = 1
      let reach: FixingReach = 'taps'
      if (RESTRICTED.test(effect)) {
        openness *= RESTRICTED_PENALTY
        reach = 'restricted'
      }
      if (ONE_SHOT_COST.test(cost) || TRIGGERED_ONCE.test(sentence)) {
        openness *= ONE_SHOT
        reach = 'gated'
      }
      const paid = manaInCost(cost)
      if (paid > 0 && addedMana(sentence) - paid < 1) {
        openness *= CONVERSION
        reach = 'gated'
      }
      if (MIRRORS_A_LAND.test(line)) {
        openness *= MIRRORED
        reach = 'gated'
      } else if (
        gatedWhole ||
        MANA_CONDITIONS.some((pattern) => pattern.test(sentence) || pattern.test(cost))
      ) {
        openness *= CONDITIONAL_STATE
        reach = 'gated'
      }
      const slot: Slot = { openness, reach }

      const explicit = new Set<Color>()
      if (ANY_COLOUR.test(sentence)) for (const colour of wanted) explicit.add(colour)
      for (const match of sentence.matchAll(/\{([^}]*[WUBRG][^}]*)\}/g)) {
        for (const letter of (match[1] ?? '').split('/')) {
          if (wanted.has(letter as Color)) explicit.add(letter as Color)
        }
      }
      for (const colour of explicit) {
        const held = named.get(colour)
        if (held === undefined || held.openness < openness) named.set(colour, slot)
      }

      const chosen = CHOSEN_TWO.test(sentence) ? 2 : CHOSEN_ONE.test(sentence) ? 1 : 0
      if (chosen * openness > wildcards.count * wildcards.slot.openness) {
        wildcards = { count: chosen, slot }
      }
    }
  }

  const slots = [...named.values()]
  // A colour the builder picks is still a colour the deck wanted, so it is
  // worth a whole one — but only for colours no ability already names, and
  // never more than the identity has.
  const room = Math.max(0, wanted.size - slots.length)
  for (let i = 0; i < Math.min(room, wildcards.count); i += 1) slots.push(wildcards.slot)
  return { slots, parsedAnyAbility }
}

export const fixingFor = (card: Card, identity: readonly Color[], deck?: DeckLands): Fixing => {
  const produced = card.producedMana ?? []
  const wanted = new Set<Color>(identity)
  const tapped = entersTapped(card)
  const restricted = restrictedFixing(card)
  const cast = mustBeCast(card)

  const fetched = produced.length === 0 ? fetchIn(card, deck) : null
  if (produced.length === 0 && fetched === null) return NO_FIXING
  if (fetched !== null && fetched.colours.size === 0) return NO_FIXING

  const availability =
    (tapped || fetched?.tapped === true ? TAPPED_PENALTY : 1) * (cast ? MUST_BE_CAST_PENALTY : 1)

  // A colourless deck wants colourless mana, so "covers none of my colours" is
  // not a criticism there — there are no colours to cover.
  if (wanted.size === 0) {
    return {
      coloursCovered: 0,
      producesMana: true,
      entersTapped: tapped,
      restricted,
      mustBeCast: cast,
      reach: 'colourless',
      value: COLOURLESS_ONLY * availability,
    }
  }

  const slots: readonly Slot[] =
    fetched !== null
      ? [...fetched.colours].map(() => ({
          openness: fetched.converts ? CONVERSION : 1,
          reach: 'fetches' as const,
        }))
      : (() => {
          const read = abilitySlots(card, wanted)
          // The corpus and the text can disagree, and where they do the corpus
          // wins on WHAT is produced while the text wins on what it costs. A
          // basic land's mana ability is granted by its type and appears in its
          // rules text only as reminder text, if at all; Dryad Arbor has no
          // mana ability written on it whatsoever.
          if (read.parsedAnyAbility) return read.slots
          return [...new Set(produced)]
            .filter((colour) => wanted.has(colour as Color))
            .map(() => ({ openness: 1, reach: 'taps' as const }))
        })()

  /*
   * Diminishing returns, expressed as a share of the identity with the first
   * colour weighted heaviest. `sqrt` rather than a linear share: the difference
   * between covering one of five colours and two of five is a real improvement
   * to a five-colour mana base, but it is not twice as good.
   *
   * KEPT, again, and the reason has changed. ADR-0035 kept it because no
   * reshaping of `covered / n` can order two lands that both cover the whole
   * identity. That is still true and it is still the point — what changed is
   * the NUMERATOR. `covered` was a count of colours the card can ever make, so
   * every any-colour land pinned it at n and the curve had nothing left to do;
   * the openness of the ability that reaches each colour is what now separates
   * them, and it is applied OUTSIDE the root.
   *
   * Outside, deliberately. `sqrt` would take a 0.5 discount folded into the
   * numerator and hand back 0.707 — the concavity that makes diminishing
   * returns work is the same concavity that softens a penalty, so a penalty
   * inside the root is not the penalty you wrote. Cavern of Souls would have
   * gone UP under this change rather than staying where ADR-0035 put it.
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
  const openness =
    slots.length === 0 ? 0 : slots.reduce((sum, slot) => sum + slot.openness, 0) / slots.length
  const coloured = openness * Math.sqrt(slots.length / wanted.size)

  /*
   * Colourless mana is a FLOOR, not a competitor.
   *
   * A land whose only coloured ability costs more than it gives is worth what a
   * land that taps for {C} is worth, and no less: Baldur's Gate really does say
   * "{T}: Add {C}" on its first line. So the value takes the larger of the two.
   *
   * The REASON does not follow the value here, and that is deliberate (P4).
   * Reporting `colourless` on Baldur's Gate scores it correctly and then tells
   * the builder something false — it is not a colourless land, it is a land
   * whose colours are behind {2} and a board of Gates, and three cards make no
   * colourless mana at all (Gemstone Mine, Meteor Crater, Rhystic Cave) where
   * "taps for colourless" would be flatly wrong. So the score takes the floor
   * and the reason keeps saying which colours are reachable and that reaching
   * them costs something. The sentence explains the score instead of repeating
   * it.
   */
  if (slots.length === 0) {
    return {
      coloursCovered: 0,
      producesMana: true,
      entersTapped: tapped,
      restricted,
      mustBeCast: cast,
      reach: 'colourless',
      value: COLOURLESS_ONLY * availability,
    }
  }

  /*
   * The WORST reach among the colours claimed, not the best.
   *
   * The reason says "N of your M colours", so it has to be true of all N. Vivid
   * Crag taps for {R} freely and needs a charge counter for the other four, and
   * reporting the free one would render "taps for 5 of your 5 colours" on a
   * card that taps for one of them. Eleven lands are shaped like that — the
   * Vivid cycle and the sacrifice-for-a-colour commons — and every one of them
   * was making the claim the report caught.
   */
  const severity: Readonly<Record<string, number>> = { taps: 0, restricted: 1, gated: 2 }
  const worst = slots.reduce((a, b) =>
    (severity[b.reach] ?? 0) > (severity[a.reach] ?? 0) ? b : a,
  )
  return {
    coloursCovered: slots.length,
    producesMana: true,
    entersTapped: tapped,
    restricted,
    mustBeCast: cast,
    reach: worst.reach,
    value: Math.max(coloured, COLOURLESS_ONLY) * availability,
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
