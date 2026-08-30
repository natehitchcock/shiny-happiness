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
  /** Subtracted. A soft penalty that reorders; it never filters (doc 03 §3.2). */
  readonly bracketRisk: number
  /** Subtracted. */
  readonly budget: number
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  combo: 1.0,
  near: 0.4,
  synergy: 0.8,
  inclusion: 0.6,
  fill: 0.7,
  curve: 0.3,
  keywordSynergy: 0.7,
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
