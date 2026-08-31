import type { ArchetypeKey } from './archetype.js'

/**
 * Scoring weights (doc 05 §5.6).
 *
 * Score orders cards WITHIN a group. It never ranks across groups — grouping is
 * the product's opinion and scoring only breaks ties inside it (pillar P5).
 */
export interface ScoringWeights {
  readonly combo: number
  readonly near: number
  readonly synergy: number
  readonly inclusion: number
  readonly fill: number
  readonly curve: number
  /** Mechanical synergy with what the deck already does (ADR-0011). */
  readonly keywordSynergy: number
  /**
   * Colour fixing, applied to lands only (see `fixing.ts`).
   *
   * Heavier than `keywordSynergy` on purpose. Within the land group these are
   * the two terms that compete, and the whole defect this fixes was rules text
   * outranking mana: a cycling desert beat every dual because cycling is a
   * synergy tag and tapping for two colours was worth nothing at all.
   */
  readonly fixing: number
  /** Subtracted. A soft penalty that reorders; it never filters (doc 03 §3.2). */
  readonly bracketRisk: number
  /** Subtracted. */
  readonly budget: number
  /**
   * The semantics this builder said the deck is about (`semantic-emphasis.ts`).
   *
   * Optional so adding it is additive (AGENTS.md R2) — a caller holding a
   * hand-built `ScoringWeights` from before this existed still compiles, and
   * gets `DEFAULT_EMPHASIS_WEIGHT` rather than a silent zero, because a caller
   * that never heard of emphasis is not a deck that asked for none.
   *
   * Heavier than `keywordSynergy` and equal to `combo`, which is the point: an
   * emphasis is the one thing in the whole scoring vector the user typed with
   * their own hands, and a term that lost to a derived heuristic would make the
   * click feel broken. It stays under `fixing` (1.2) so an emphasised cycling
   * desert still does not beat a real dual inside the land group — the defect
   * `fixing` was raised to fix is not one emphasis gets to reintroduce.
   */
  readonly emphasis?: number
}

/**
 * What `emphasis` is worth to a caller that did not name it.
 *
 * Rejected alternative: defaulting the absent case to 0. It would make the
 * feature depend on every call site remembering to pass a weight, and the first
 * one that forgot would look exactly like "emphasis does not work".
 */
export const DEFAULT_EMPHASIS_WEIGHT = 1.0

export const DEFAULT_WEIGHTS: ScoringWeights = {
  combo: 1.0,
  near: 0.4,
  synergy: 0.8,
  inclusion: 0.6,
  fill: 0.7,
  curve: 0.3,
  keywordSynergy: 0.7,
  fixing: 1.2,
  bracketRisk: 0.5,
  budget: 0.4,
}

/**
 * Archetype nudges the defaults; it never overrides a user's choice (doc 14 §14.4).
 * Only the deltas that are defensible are listed — an archetype that would not
 * meaningfully change a weight simply does not mention it.
 */
const ARCHETYPE_WEIGHTS: Partial<Record<ArchetypeKey, Partial<ScoringWeights>>> = {
  aggro: { curve: 0.6, combo: 0.7 },
  combo: { combo: 1.4, near: 0.6 },
  aristocrats: { keywordSynergy: 1.1 },
  control: { fill: 0.9, curve: 0.2 },
  ramp: { fill: 0.9 },
  stax: { fill: 0.9, combo: 0.7 },
}

export const weightsFor = (
  archetype: ArchetypeKey,
  overrides: Partial<ScoringWeights> = {},
): ScoringWeights => ({
  ...DEFAULT_WEIGHTS,
  ...(ARCHETYPE_WEIGHTS[archetype] ?? {}),
  ...overrides,
})
