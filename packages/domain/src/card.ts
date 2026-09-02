import type { OracleId, PrintingId } from './ids.js'
import type { Role } from './role.js'
import type { SynergyTag } from './synergy.js'

export type Color = 'W' | 'U' | 'B' | 'R' | 'G'

/**
 * A colour, or colourless.
 *
 * Separate from `Color` because colourless is not a colour in Magic's rules and
 * conflating them would let `{C}` leak into a colour-identity check, where it
 * would be wrong. It is only ever a thing a permanent PRODUCES.
 */
export type ManaLetter = Color | 'C'

export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G']

export type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted'

export type CardType =
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'battle'
  | 'land'

/**
 * A card at oracle identity (doc 02 §2.1). Deliberately carries no image URLs or
 * prices — those belong to a `Printing`, and embedding them here couples the
 * deck model to presentation.
 */
export interface Card {
  readonly oracleId: OracleId
  readonly name: string
  /** Scryfall mana cost string, e.g. `{2}{R}`. Null for lands and some backs. */
  readonly manaCost: string | null
  /** Scryfall `cmc`, renamed to the term the domain uses (AGENTS.md §7). */
  readonly manaValue: number
  /**
   * Governs deck legality. Scryfall's `color_identity` already accounts for mana
   * symbols in rules text and colour indicators — use it, do not recompute
   * (doc 03 §3.1).
   */
  readonly colorIdentity: readonly Color[]
  readonly colors: readonly Color[]
  /**
   * Which mana this card can produce — `C` included (Scryfall `produced_mana`).
   *
   * The land category was ranked entirely by rules text before this existed, so
   * cycling deserts and MDFCs with a spell side beat every real dual: a dual's
   * text is a mana ability and produces no synergy tags, so the scorer had
   * nothing to see. This is the field that says what a land is actually for.
   *
   * NOT the same as `colorIdentity`. They agree for Steam Vents and disagree
   * for exactly the lands that matter most: Command Tower has an empty identity
   * and taps for every colour, as does every fetchland.
   *
   * Optional because a card read before ING added the column has no answer, and
   * `[]` would be the wrong one — "produces nothing" is a claim, not a gap.
   */
  readonly producedMana?: readonly ManaLetter[]
  readonly typeLine: string
  readonly types: readonly CardType[]
  readonly oracleText: string
  /**
   * The rules text of each face, for a card that has more than one.
   *
   * `oracleText` joins the faces with a newline — and a newline is also what
   * Scryfall puts between two abilities of a SINGLE face, so the join is lossy.
   * Fire // Ice arrives as three newline-separated chunks of which only the
   * first boundary is a face change, and nothing downstream can tell which is
   * which. Anything that wants to draw the boundary has to be handed the
   * decomposition rather than re-derive it, because it cannot be re-derived.
   *
   * Kept beside `oracleText` rather than marked inside it with a sentinel such
   * as `\n//\n`: role derivation, synergy derivation and the `oracle:` search
   * predicate all run over `oracleText`, and a sentinel would put a line of
   * text there that no card actually has, changing what those regexes read.
   *
   * Undefined for a single-faced card, and for any card ingested before this
   * field existed — `[]` would be the wrong answer, since "one face" and "not
   * known" are different claims. Where it is set, `join('\n')` reproduces
   * `oracleText` exactly.
   */
  readonly oracleTextFaces?: readonly string[]
  /**
   * Printed power and toughness, as TEXT.
   *
   * Magic prints `*`, `1+*` and `?`. A numeric field would have to store null
   * for those, and a card whose power is `*` would then read as having no power
   * — a different and wrong claim. Null here means the card genuinely has none:
   * it is not a creature.
   */
  readonly power: string | null
  readonly toughness: string | null
  /** Starting loyalty, for planeswalkers. Text for the same reason. */
  readonly loyalty: string | null
  readonly keywords: readonly string[]
  readonly legalities: { readonly commander: Legality }
  /**
   * Whether this card may lead a deck (`deriveCanBeCommander`, doc 03 §3.1).
   *
   * Stored rather than recomputed per request for the same reason `roles` and
   * `synergyProduces` are: deck creation, the analysis endpoint and the
   * `is:commander` search predicate all ask this question, and three readings of
   * the type line would eventually be three different answers.
   *
   * True is a claim about the card ALONE. A Background may be a commander only
   * beside a `Choose a Background` card, and the pairing rules that decide that
   * live in `partnershipAllowed`, which needs a `PartnerRule` this field does
   * not carry.
   *
   * Optional because a row written before migration 0010 has no answer, and
   * `false` would be the wrong one: it would read as "this card may not lead a
   * deck", which for every legendary creature in the corpus is a lie. Callers
   * must treat absence as "not known" and say so rather than deciding.
   */
  readonly canBeCommander?: boolean
  /** Lower is more played overall. Null when Scryfall has no rank. */
  readonly edhrecRank: number | null
  /** Null until ING-04 resolves imagery for this card — see ADR-0007. */
  readonly defaultPrinting: PrintingId | null
  /** Derived, imperfect, and overridable (doc 02 §2.4). */
  readonly roles: readonly Role[]
  readonly primaryRole: Role
  /**
   * True only when EVERY printing is a Universes Beyond printing (ADR-0011).
   *
   * Printing-level `promo_types` is not enough on its own: Scryfall's oracle
   * export picked a Marvel Commander printing for Sol Ring, and trusting that
   * one printing would mark Sol Ring as Universes Beyond.
   */
  readonly universesBeyond: boolean
  /** Events this card causes (ADR-0011). Derived at ingest, like `roles`. */
  readonly synergyProduces: readonly SynergyTag[]
  /** Events this card pays off on. */
  readonly synergyWants: readonly SynergyTag[]
  /**
   * What this card IS or HAS — its subtypes and its keywords (ADR-0048).
   *
   * A third direction rather than more of `synergyProduces`, because a card
   * does not *cause* flying, it *has* it. `synergyProduces` keeps its meaning:
   * "create a 1/1 Soldier token" and "target creature gains flying" are causes,
   * and neither card IS the thing it makes.
   *
   * NOT STORED. `synergyProduces` and `synergyWants` are columns because
   * computing them means running the rule tables over `oracleText`; this is two
   * set intersections over `typeLine` and `keywords`, which every read already
   * carries. The rule ADR-0048 settles: store a derivation whose inputs the
   * read does not need, derive one whose inputs it already carries.
   *
   * So the repository fills it on every read and there is no stale-row state.
   * Optional only because a `Card` built by hand — in a test, or by a caller
   * that has no vocabulary — may legitimately not have one; every card that
   * came out of the database does.
   */
  readonly synergyHas?: readonly SynergyTag[]
  /**
   * On Wizards' Game Changers list, which the brackets reference (DATA-05).
   *
   * Read from Scryfall's `game_changer` boolean rather than a checked-in array
   * of names. The list is revised — cards were added in February 2026 and ten
   * were removed the October before — and a hand-maintained copy would be wrong
   * within months without anything failing to tell us.
   *
   * Non-optional, unlike `producedMana`, because "not on the list" is a real
   * answer rather than a gap: membership is a lookup into a finite published
   * set, and the vast majority of cards are legitimately absent from it. The
   * risk of a false `false` is handled where it matters instead — an entire
   * corpus reading `false` means the ingest predates migration 0011, and
   * `loadBracketRules` refuses to load rather than pass every deck vacuously.
   */
  readonly gameChanger: boolean
}

export interface Printing {
  readonly printingId: PrintingId
  readonly oracleId: OracleId
  readonly setCode: string
  readonly setName: string
  readonly collectorNumber: string
  readonly rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus'
  readonly imageUris: {
    readonly artCrop: string
    readonly normal: string
  }
  /**
   * The BACK face's art, for a card printed on two PHYSICAL faces.
   *
   * `imageUris` above is the front, and the front is the card — the side that
   * enters the battlefield and the side a tile, a detail panel and a deck-web
   * crop must draw. This is the other one, carried so a flip control has
   * something to show; it is never a substitute for the front.
   *
   * ABSENT means the card has one physical face. Nine cards in ten are that,
   * and an always-present pair of empty strings would make every ordinary card
   * claim to have a back with no picture.
   *
   * PRESENT means there is a back face. Its members are then `''` on the same
   * "no cached art" terms as `imageUris` — so a transform card whose back art
   * failed to resolve is `{ artCrop: '', normal: '' }`, which is a different
   * claim from absence and the one a flip control has to be able to read: it
   * still has a back, we just cannot draw it.
   *
   * Optional rather than `| null` to match `oracleTextFaces`, the existing
   * precedent for per-face data: a printing ingested before this field existed
   * has no answer, and absence is the right shape for "not known" as well as
   * for "there is none".
   */
  readonly backImageUris?: {
    readonly artCrop: string
    readonly normal: string
  }
  readonly priceUsd: number | null
  readonly reserved: boolean
}
