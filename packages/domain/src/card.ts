import type { OracleId, PrintingId } from './ids.js'
import type { Role } from './role.js'

export type Color = 'W' | 'U' | 'B' | 'R' | 'G'

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
  readonly typeLine: string
  readonly types: readonly CardType[]
  readonly oracleText: string
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
