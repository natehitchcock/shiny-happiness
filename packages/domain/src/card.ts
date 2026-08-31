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
  readonly priceUsd: number | null
  readonly reserved: boolean
}
