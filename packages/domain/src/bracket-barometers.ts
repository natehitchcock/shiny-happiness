import type { Card } from './card.js'
import type { Combo } from './combo.js'
import { isTwoCardInfinite } from './combo.js'
import type { ComboId, OracleId } from './ids.js'

/**
 * The three barometers Wizards names but does not quantify (ADR-0018).
 *
 * WHAT THIS IS NOT. It is not a bracket verdict, and nothing here may become
 * one. Wizards publishes a per-bracket allowance for exactly one barometer —
 * Game Changers — and `bracket-rules.ts` checks that one. The tutor restriction
 * was withdrawn on 2025-10-21 and the other three barometers were replaced by a
 * prose turn-count expectation that states no permitted/forbidden value. So
 * `BracketRules.massLandDenial`, `.extraTurnChaining` and `.twoCardInfinites`
 * stay null, `bracket.assessed` stays null, and no number in
 * `brackets/rules.data.json` changes because of this file.
 *
 * WHAT IT IS. A count of things the deck contains, which the user asked to see:
 * "this deck has three cards that take an extra turn" is a fact about the deck,
 * not a claim about what any bracket permits. The findings are therefore
 * reported for EVERY target bracket.
 *
 *   Rejected alternative: raise the findings only for brackets 1-3, which is
 *   where the superseded articles put the hard lines. That is precisely the
 *   retired per-bracket table ADR-0018 refuses to re-create, and it would be
 *   indistinguishable to the user from a rule the format actually has.
 *
 * WHY IT IS DERIVED HERE AND NOT AT INGEST. `roles` and `synergyProduces` are
 * columns because every recommendation request ranks the whole 34k-card pool by
 * them and `role:` / `is:` search predicates index them. These three are read
 * for the ~100 cards of one deck, at one endpoint, from an `oracleText` already
 * in memory — two regex passes over a hundred short strings. A column would buy
 * nothing, would cost a re-ingest, and would freeze a heuristic that is going to
 * be tuned: fixing a false positive would then need a re-ingest before the fix
 * reached anybody. See `packages/db/migrations` — no migration was added.
 */

/**
 * A rules-text clause, as a unit of meaning.
 *
 * Splitting matters more than the patterns do. `oracle_text ILIKE
 * '%destroy%land%'` scores 307 cards and includes Ruinous Ultimatum and Void
 * Rend, which destroy NONLAND permanents — the two halves of the query match in
 * different sentences and the phrase "nonland" contains "land". Splitting first
 * and requiring both halves inside ONE clause removes that whole class.
 *
 * The colon is a separator because it divides an activated ability's cost from
 * its effect, and that division is the difference between Evolving Wilds
 * ("Sacrifice this land: search...", a cost you pay yourself) and Strip Mine
 * ("Sacrifice this land: Destroy target land", a cost plus land destruction).
 */
const clauses = (text: string): readonly string[] => text.split(/[.:;\n•]/)

/**
 * `land` as a WORD, never as a substring.
 *
 * This one regex is the single biggest source of false positives in the naive
 * versions, and `\b` is the whole fix: `nonland`, `Island`, `landfall`,
 * `Wasteland`, `Woodland` and `Grassland` all contain `land` and none of them
 * has a word boundary on both sides of it. Every clause below goes through it.
 */
const LAND = /\blands?\b/i

/**
 * Mentions of a land that are not a land being acted on.
 *
 * Stripped from a clause before the removal patterns run, because every one of
 * these puts the word "land" next to a removal verb while the land is a
 * condition, a count, or the card itself:
 *
 *   - `this land` — Blast Zone reads "Sacrifice this land: Destroy each nonland
 *     permanent ... equal to the number of charge counters on this land", and
 *     Bojuka Bog reads "When this land enters, exile target player's graveyard".
 *   - `land card` — a card in a library or graveyard, never a permanent. Paroxysm
 *     and Cruel Deceiver both read "if it's a land card, destroy that creature".
 *   - `number of lands` — Invasion of Lorwyn destroys a creature "with power X or
 *     less, where X is the number of lands you control".
 *   - an `if` condition up to its comma — Calming Verse reads "if you control an
 *     untapped land, destroy all enchantments you control". Only the condition
 *     goes; "if it was kicked, destroy target nonbasic land" keeps its land,
 *     because the land is on the far side of the comma.
 *
 * NOT applied to the forced-sacrifice clause, which needs none of it and would
 * be damaged by it: Restore Balance and Global Ruin say "chooses a number of
 * lands they control ... then sacrifices the rest", and they are exactly the
 * Balance-shaped mass land denial the barometer is about.
 */
const NOT_A_LAND_OBJECT = /\bthis lands?\b|\blands? cards?\b|\bnumber of lands?\b|\bif\b[^,]*,/gi

const landObject = (clause: string): boolean => LAND.test(clause.replace(NOT_A_LAND_OBJECT, ''))

/** Basic land types, plus the two ways a card names one without naming one. */
const BASIC_LAND_TYPE =
  /\b(?:Plains|Islands?|Swamps?|Mountains?|Forests?)\b|\b(?:basic land|chosen) type\b/i

/**
 * A card that literally says someone takes an extra turn.
 *
 * The naive `/extra turn/` scores 64 cards in the corpus and is wrong on three,
 * all in the same way and all in the direction that matters: Stranglehold,
 * Trouble in Pairs and Gerrard's Hourglass Pendant say "if a player would BEGIN
 * an extra turn, that player skips that turn instead". They are the anti-extra-
 * turn cards, and flagging them for granting extra turns would be the reverse of
 * the truth.
 *
 * Grant and denial use different verbs and always have: a grant says someone
 * TAKES a turn, a denial says someone would BEGIN one. Matching on `take` is
 * therefore both narrower and more faithful than listing the denial wordings.
 *
 * Ugin's Nexus says both, and matches, which is right — it denies extra turns to
 * everyone and then takes one itself when it dies.
 *
 * `takes?` covers "Take an extra turn" (Time Walk) and "Target player takes an
 * extra turn" (Time Warp); the optional word covers "take TWO extra turns"
 * (Time Stretch). "after this one" is deliberately NOT required: Emrakul, the
 * Promised End says only "After that turn, that player takes an extra turn".
 */
const TAKES_EXTRA_TURN = /\btakes? (?:[a-z]+ )?extra turns?\b/i

export const grantsExtraTurn = (card: Card): boolean => TAKES_EXTRA_TURN.test(card.oracleText)

/**
 * Destroying a land.
 *
 * The exclusions were found by reading all 184 clause-level matches in the
 * corpus, not guessed. Every one of them is a card that mentions destruction and
 * a land in one breath while doing the opposite:
 *
 *   - `except` / `other than` — Scourglass and Elspeth Tirel destroy all
 *     permanents EXCEPT lands, Elesh Norn's third chapter spares lands by name,
 *     and Eye of Singularity triggers on "a permanent other than a basic land".
 *   - `would be destroyed` / `would destroy` — Harmonious Emergence and Pyramids
 *     SAVE a land that would be destroyed; Equinox counters the spell that would
 *     destroy one.
 *   - `Aura attached` — Savaen Elves and Street Sweeper destroy the Aura, and
 *     the land is only where it is attached.
 *   - `indestructible` — the other half of the Emergence auras.
 *
 * Cards that destroy YOUR OWN lands are deliberately kept: Armageddon,
 * Desolation Angel and Boom // Bust are symmetrical, and "you control" appears
 * in all three.
 */
const DESTROYS = /\bdestroy(?:s|ed)?\b/i
const NOT_DESTRUCTION =
  /\bexcept\b|\bother than\b|\bwould (?:be destroyed|destroy)\b|\bAuras? attached\b|\bindestructible\b/i

/**
 * Forcing another player to sacrifice a land.
 *
 * `oracle_text ILIKE '%sacrifice%land%'` scores 631 cards and is almost entirely
 * wrong: most are utility lands sacrificing THEMSELVES for value — Evolving
 * Wilds, Warped Landscape, Mouth of Ronom — and the rest are kicker, buyback and
 * echo costs the caster pays.
 *
 * The discriminator is grammatical and exact. Magic writes a cost you pay as an
 * imperative — "Sacrifice a land" — and a cost someone ELSE pays with an
 * explicit third-person subject: "each player sacrificeS", "that player
 * sacrificeS", "its controller sacrificeS". So the trailing `s` is the whole
 * rule. All 34 corpus matches are genuine forced sacrifice (Armageddon-class
 * cards such as Pox, Death Cloud, Wildfire, Smallpox, Braids); none is a
 * self-sacrifice, and none is a "whenever a player sacrifices a land" payoff.
 */
const FORCED_SACRIFICE = /\bsacrifices\b/i

/**
 * Exiling a land.
 *
 * Narrower than destruction because exile is overwhelmingly used on cards in
 * other zones, and a card in a zone is written differently from a permanent on
 * the battlefield: Scryfall says "target land" for the permanent and "land
 * CARD" for the object in a graveyard or library. That one word separates
 * Crumble to Dust from Deathrite Shaman, Mudhole and Haunting Echoes.
 *
 *   - the land must FOLLOW a quantifier (`target`/`all`/`each`), which is how a
 *     spell names the thing it exiles. Order matters and is the guard, not mere
 *     presence: Rocco, Street Chef reads "whenever a player plays a land from
 *     exile ... put a +1/+1 counter on target creature", where the quantifier is
 *     real and belongs to something else. It also excludes "Exile this land" —
 *     the self-exile cost on Tomb Fortress and Underdark Rift.
 *   - `you control` / `you own` removes the blink effects: Ghostly Flicker,
 *     Ruin Ghost, Extraplanar Lens, Gandalf, Shadow's Foe.
 *   - `exiled with` removes the second half of every imprint and flicker card,
 *     which refers back to the exiled object.
 *
 * Keeping this clause is what catches Decree of Annihilation and Realm Razer,
 * which are as much mass land denial as Armageddon is.
 */
const EXILES = /\bexiles?\b/i
const EXILED_LAND = /\b(?:target|all|each)\b[\s\S]*?\blands?\b(?! card)/i
const NOT_YOURS = /\byou (?:control|own)\b|\bexiled with\b/i

/**
 * Returning every land to its owner's hand — Sunder, and only Sunder.
 *
 * `all` is required. Without it the clause is a tempo detector rather than a
 * denial one: Aven Fogbringer and Hoodwink bounce one land, and the self-bounce
 * engines (Trade Routes, Murasa Rootgrazer, Sea Drake) return lands you control
 * on purpose. Sunder empties every battlefield and belongs with Armageddon.
 *
 * `except` is excluded for the same reason it is under destruction: Cyclone
 * Summoner returns all permanents to hand EXCEPT lands.
 */
const MASS_BOUNCE = /\breturn\b/i
const TO_HAND = /\bhands?\b/i
const ALL = /\ball\b/i

/**
 * Overwriting what a land IS — the Blood Moon shape.
 *
 * This is the barometer's "land mutation" half, and the exclusions are what keep
 * it from being absurd. Rules text says "becomes" for a great many harmless
 * things, and three markers separate them:
 *
 *   - `in addition to` is the marker of a mutation that TAKES NOTHING AWAY.
 *     Urborg, Yavimaya, Prismatic Omen, Dryad of the Ilysian Grove and
 *     Aquitect's Will all add a type and leave every ability intact. Blood Moon,
 *     Magus of the Moon and Harbinger of the Seas do not say it, because they
 *     replace the type and strip the abilities. That is the difference between
 *     a mana fixer and land denial, and the card says which it is.
 *   - `you control` / `you own` removes the self-scoped ones: Celestial Dawn,
 *     Realmwright, Swampbenders, Grixis Illusionist.
 *   - `if`/`as long as ... land is` removes the type CHECKS, which read a type
 *     rather than set one: Akoum Hellkite, Emeria Shepherd, Guardian of Tazeem,
 *     Oran-Rief Hydra and Guul Draz Overseer all read "If that land is a
 *     Mountain/Plains/Island/Forest/Swamp, ... instead", and Goblin Caves reads
 *     "as long as enchanted land is a basic Mountain".
 *   - `becomes tapped` is a trigger, not a mutation. Roots of Life watches for
 *     "a land of the chosen type ... becomes tapped".
 *   - `token` removes Overlord of the Hauntwoods, which CREATES a land that is
 *     every basic type rather than overwriting one that exists.
 *   - `this land` removes a land describing itself — Multiversal Passage reads
 *     "This land is the chosen type".
 *
 * The land must come BEFORE the verb, because the land has to be the subject of
 * the sentence for this to be a mutation of a land at all. Song of the Dryads
 * says "Enchanted PERMANENT is a colorless Forest land" — it turns a creature
 * into a land, which is removal, not land denial — and Kormus Bell says "All
 * Swamps ARE 1/1 black creatures that are still lands". Both name a basic type
 * and a land and neither mutates one, and the word order is what says so.
 *
 * Requiring a BASIC land type is what leaves the manlands alone. Treetop
 * Village, Den of the Bugbear, Restless Bivouac and every earthbend card turn a
 * land into a creature, which is a mutation and is not denial; none of them
 * names a basic land type, so none of them matches.
 */
const LAND_BECOMES = /\blands?\b[\s\S]{0,80}?\b(?:is|are|becomes?)\b/i
const ADDITIVE = /\bin addition to\b/i
const NOT_A_MUTATION =
  /\b(?:if|as long as)\b[^,]{0,25}\blands?\b (?:is|are)\b|\bbecomes? (?:un)?tapped\b|\btokens?\b|\bthis lands?\b/i

const anyClause = (card: Card, test: (clause: string) => boolean): boolean =>
  clauses(card.oracleText).some(test)

/** Destroys, exiles, forces the sacrifice of, or mass-bounces a land. */
export const destroysLand = (card: Card): boolean =>
  anyClause(card, (clause) => {
    if (!LAND.test(clause)) return false
    // The one clause that reads the raw text: see NOT_A_LAND_OBJECT for why
    // stripping would lose Restore Balance and Global Ruin.
    if (FORCED_SACRIFICE.test(clause)) return true
    if (!landObject(clause)) return false
    if (DESTROYS.test(clause) && !NOT_DESTRUCTION.test(clause)) return true
    if (EXILES.test(clause) && EXILED_LAND.test(clause) && !NOT_YOURS.test(clause)) return true
    return (
      MASS_BOUNCE.test(clause) &&
      ALL.test(clause) &&
      TO_HAND.test(clause) &&
      !NOT_YOURS.test(clause) &&
      !NOT_DESTRUCTION.test(clause)
    )
  })

/** Overwrites a land's type, Blood Moon style. */
export const mutatesLand = (card: Card): boolean =>
  anyClause(
    card,
    (clause) =>
      LAND_BECOMES.test(clause) &&
      BASIC_LAND_TYPE.test(clause) &&
      !ADDITIVE.test(clause) &&
      !NOT_YOURS.test(clause) &&
      !NOT_A_MUTATION.test(clause),
  )

/**
 * The barometer as the user defined it: "any land destruction or land mutation".
 *
 * Deliberately literal and therefore broader than the phrase "MASS land denial"
 * suggests — a single Strip Mine matches. That is the instruction, the severity
 * is a warning rather than an error, and the finding names what it counted
 * rather than pronouncing on the deck.
 */
export const deniesLand = (card: Card): boolean => destroysLand(card) || mutatesLand(card)

/** Which of Wizards' three unquantified barometers a finding is about. */
export type Barometer = 'two-card-infinites' | 'extra-turns' | 'mass-land-denial'

/**
 * How loudly to say it. OUR reading, not the format's.
 *
 * `error` for extra turns and `warn` for the other two, as asked. The reason for
 * the split is worth keeping because it is the honest part: a two-card infinite
 * only breaks a bracket's turn-count expectation if it assembles EARLY, and
 * nothing in a decklist says when it will. An extra-turn card takes an extra
 * turn whenever it resolves.
 */
export type BarometerSeverity = 'warn' | 'error'

export interface BracketFinding {
  readonly barometer: Barometer
  readonly severity: BarometerSeverity
  readonly count: number
  /** The deck's cards behind the count — the combo pieces, for that barometer. */
  readonly cards: readonly OracleId[]
  /** The assembled combos, for the two-card-infinite barometer only. */
  readonly combos: readonly ComboId[]
  readonly message: string
}

/**
 * Said once, next to the findings, so the client never has to invent it.
 *
 * The findings are ours. This sentence is what keeps them from reading as a
 * bracket verdict, and it travels with them rather than living in a comment.
 */
export const BAROMETER_BASIS =
  "Lotus Wizard's own reading of this deck's cards, not a Wizards bracket verdict. " +
  'Wizards names two-card infinite combos, extra turns and mass land denial as bracket ' +
  'barometers but publishes no per-bracket allowance for any of them, so no bracket is ' +
  'assessed from these and they are reported the same way at every bracket.'

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export interface BracketFindingInput {
  /** Every card in the deck, commanders included, in a stable order. */
  readonly cards: readonly Card[]
  /** The combos the deck actually assembles — `deckCombos`, already computed. */
  readonly assembled: readonly Combo[]
}

/**
 * Count the three barometers over one deck.
 *
 * A barometer with nothing to report is omitted rather than returned with a zero
 * count: "this deck has 0 extra-turn cards" is a sentence nobody needs, and an
 * empty list is what lets the UI render only what is there.
 */
export const bracketFindings = (input: BracketFindingInput): readonly BracketFinding[] => {
  const findings: BracketFinding[] = []

  // Not a fourth definition of "infinite": `isTwoCardInfinite` is the one the
  // combo model already publishes, and the deck's assembled combos are the ones
  // the analysis endpoint already computed.
  const infinites = input.assembled.filter(isTwoCardInfinite)
  if (infinites.length > 0) {
    findings.push({
      barometer: 'two-card-infinites',
      severity: 'warn',
      count: infinites.length,
      cards: [...new Set(infinites.flatMap((combo) => combo.pieces))],
      combos: infinites.map((combo) => combo.id),
      message:
        `This deck assembles ${infinites.length} two-card infinite ` +
        `${plural(infinites.length, 'combo', 'combos')}. A warning rather than an error: ` +
        'what a bracket asks about is whether the game ends early, and a decklist cannot ' +
        'say how soon a combo comes together.',
    })
  }

  const extraTurns = input.cards.filter(grantsExtraTurn)
  if (extraTurns.length > 0) {
    findings.push({
      barometer: 'extra-turns',
      severity: 'error',
      count: extraTurns.length,
      cards: extraTurns.map((card) => card.oracleId),
      combos: [],
      message:
        `${extraTurns.length} ${plural(extraTurns.length, 'card', 'cards')} in this deck ` +
        `${plural(extraTurns.length, 'says it gives', 'say they give')} someone an extra turn.`,
    })
  }

  const landDenial = input.cards.filter(deniesLand)
  if (landDenial.length > 0) {
    findings.push({
      barometer: 'mass-land-denial',
      severity: 'warn',
      count: landDenial.length,
      cards: landDenial.map((card) => card.oracleId),
      combos: [],
      message:
        `${landDenial.length} ${plural(landDenial.length, 'card', 'cards')} in this deck ` +
        `${plural(landDenial.length, 'destroys', 'destroy')}, exiles, forces the sacrifice ` +
        'of, or overwrites the type of a land.',
    })
  }

  return findings
}
