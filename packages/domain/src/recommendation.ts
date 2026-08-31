import type { BracketFlag } from './bracket.js'
import type { CompositionDimension, TargetSource } from './composition.js'
import type { ComboId, OracleId } from './ids.js'
import type { SynergyTag } from './synergy.js'
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
  /**
   * How often the deck corpus plays this card with this commander.
   *
   * Named for the statistic, not its supplier: EDHREC is not queried (ADR-0008),
   * and the corpus is the project's own imported decks. `null` synergy means the
   * corpus is too small to say, which the UI must show as absence rather than as
   * zero.
   */
  | { readonly kind: 'corpus-inclusion'; readonly share: number; readonly synergy: number | null }
  | {
      readonly kind: 'fills-deficit'
      readonly dimension: CompositionDimension
      readonly deficit: number
      /**
       * Whose target this gap is measured against (doc 16).
       *
       * "Fills a ramp gap" and "fills the ramp target you set" are different
       * claims, and pillar P4 says a recommendation must make the one that is
       * true: a card suggested because the builder typed 14 ramp is being
       * suggested on the builder's own authority, not the archetype's, and a
       * reason that hides that is a reason the user cannot audit. Optional, so
       * a reader that predates doc 16 renders exactly what it did before
       * (AGENTS.md R2); absent reads as `archetype`.
       */
      readonly source?: TargetSource
    }
  /**
   * What this land taps for, relative to the deck's colours.
   *
   * A new member rather than a change to an existing one, so readers that do
   * not know it simply do not render it (AGENTS.md R2). It exists because
   * `fills-deficit` says "you need lands" for all 436 of them and cannot say
   * why THIS one — which for a land is the only interesting question.
   */
  | {
      readonly kind: 'mana-fixing'
      /** How many of the deck's colours it produces. Zero means colourless only. */
      readonly coloursCovered: number
      /** The deck's colour count, so the reason reads "2 of 3". */
      readonly of: number
    }
  | {
      readonly kind: 'curve-fit'
      readonly manaValue: number
      /** Optional, so this is not a contract break (AGENTS.md R2). */
      readonly direction?: 'short' | 'over' | 'balanced'
      /** Cards short at this mana value; negative means over-full. */
      readonly delta?: number
    }
  | { readonly kind: 'top-by-type'; readonly type: string; readonly rank: number }
  | {
      readonly kind: 'keyword-synergy'
      readonly tag: SynergyTag
      /** `enables` = provides what the deck wants; `payoff` = the reverse. */
      readonly direction: 'enables' | 'payoff' | 'theme'
      /** The cards it pairs with, so the reason is interrogable (pillar P4). */
      readonly withOracleIds: readonly OracleId[]
    }
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
  /** Both null whenever no corpus statistics exist — the normal case at launch
   * (ADR-0008). Recommendations stand on combos, roles and archetype instead. */
  readonly synergyScore: number | null
  readonly inclusionShare: number | null
  readonly fillsRoleDeficit: Role | null
  readonly bracketFlags: readonly BracketFlag[]
  readonly reasons: readonly [Reason, ...Reason[]]
}
