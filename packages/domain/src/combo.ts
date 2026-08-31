import type { Color } from './card.js'
import type { ComboId, OracleId } from './ids.js'

/**
 * What a combo produces. Drives bracket assessment: a two-card combo producing
 * an infinite result is what brackets 1–3 restrict (doc 03 §3.2).
 */
export type ComboResult =
  | 'infinite-mana'
  | 'infinite-damage'
  | 'infinite-creatures'
  | 'infinite-tokens'
  | 'infinite-draw'
  | 'infinite-mill'
  | 'infinite-turns'
  | 'infinite-life'
  | 'infinite-lifeloss'
  | 'win-the-game'
  | 'lock'
  | 'value'

const INFINITE_RESULTS: ReadonlySet<ComboResult> = new Set<ComboResult>([
  'infinite-mana',
  'infinite-damage',
  'infinite-creatures',
  'infinite-tokens',
  'infinite-draw',
  'infinite-mill',
  'infinite-turns',
  'infinite-life',
  'infinite-lifeloss',
  'win-the-game',
])

/**
 * Sourced from Commander Spellbook (doc 04 §4.2).
 *
 * Three fields are OPTIONAL because a combo read for scoring does not carry
 * them (ADR-0017). `steps` and `prerequisites` are the human-readable
 * explanation of how the combo wins, and are two thirds of the table's bytes;
 * `colorIdentity` is what the scoring read FILTERS on and so never needs to
 * travel. Undefined means "not fetched", which is a different and truer claim
 * than the empty string a full-shaped cast would have to invent.
 *
 * A view that wants to show how a combo is executed reads that one combo by id.
 */
export interface Combo {
  readonly id: ComboId
  /** Every card required. Order is not meaningful. */
  readonly pieces: readonly OracleId[]
  readonly produces: readonly ComboResult[]
  readonly prerequisites?: string
  readonly steps?: readonly string[]
  readonly colorIdentity?: readonly Color[]
}

export const producesInfinite = (combo: Combo): boolean =>
  combo.produces.some((result) => INFINITE_RESULTS.has(result))

/** A two-card infinite — the shape brackets 1–3 restrict (doc 03 §3.2). */
export const isTwoCardInfinite = (combo: Combo): boolean =>
  combo.pieces.length === 2 && producesInfinite(combo)
