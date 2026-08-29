import type { BracketFlag } from './bracket.js'
import type { CompositionDimension } from './composition.js'
import type { ComboId, OracleId } from './ids.js'
import type { Role } from './role.js'

/**
 * Candidate groups, in the fixed order of doc 05 §5.3. A card appears in exactly
 * one — the first it qualifies for — so counts sum to the pool size.
 */
export type CandidateGroupKey =
  | 'combo-3plus'
  | 'combo-2'
  | 'combo-1'
  | 'near-combo'
  | `fills-${string}`
  | `top-${string}`
  | 'high-synergy'
  | 'staple'

/**
 * Why a card was suggested (pillar P4). Rendered verbatim at zoom L3.
 *
 * Structured rather than pre-rendered strings so the UI can localise, reorder and
 * link the pieces — and so a reason can be asserted in a test.
 */
export type Reason =
  | { readonly kind: 'completes-combos'; readonly combos: readonly ComboId[] }
  | { readonly kind: 'near-combo'; readonly combos: readonly ComboId[]; readonly distance: number }
  | { readonly kind: 'edhrec-inclusion'; readonly share: number; readonly synergy: number | null }
  | {
      readonly kind: 'fills-deficit'
      readonly dimension: CompositionDimension
      readonly deficit: number
    }
  | { readonly kind: 'curve-fit'; readonly manaValue: number }
  | { readonly kind: 'top-by-type'; readonly type: string; readonly rank: number }
  | { readonly kind: 'bracket-warning'; readonly flag: BracketFlag; readonly detail: string }

/**
 * A recommendation. Never persisted as truth — always recomputed against the
 * current accepted set and dataset snapshot.
 *
 * `reasons` is a non-empty tuple by construction: a recommendation the user
 * cannot interrogate is a bug, and the type makes it unrepresentable (P4,
 * AGENTS.md §8).
 */
export interface Recommendation {
  readonly oracleId: OracleId
  readonly group: CandidateGroupKey
  /** Orders *within* a group only. There is no global ranking (P5). */
  readonly score: number
  readonly comboDegree: number
  readonly nearCombosAt1: number
  readonly completedCombos: readonly ComboId[]
  readonly edhrecSynergy: number | null
  readonly edhrecInclusion: number | null
  readonly fillsRoleDeficit: Role | null
  readonly bracketFlags: readonly BracketFlag[]
  readonly reasons: readonly [Reason, ...Reason[]]
}
