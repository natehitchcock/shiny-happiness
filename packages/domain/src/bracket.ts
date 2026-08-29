/**
 * Brackets (doc 03 §3.2).
 *
 * The numeric allowances and the Game Changers list are NOT here. They are
 * maintained by Wizards, have been revised since introduction, and must be read
 * from `brackets/rules.data.json` — see AGENTS.md §8 and ADR-0006 (DATA-05).
 * Hardcoding either is a rejected PR.
 */
export type Bracket = 1 | 2 | 3 | 4 | 5

export const BRACKETS: readonly Bracket[] = [1, 2, 3, 4, 5]

export type BracketPermission = 'forbidden' | 'discouraged' | 'allowed'

export interface BracketRules {
  readonly bracket: Bracket
  readonly name: string
  readonly gameChangersAllowed: number | 'unlimited'
  readonly massLandDenial: BracketPermission
  readonly extraTurnChaining: BracketPermission
  readonly twoCardInfinites: BracketPermission
  readonly tutorDensity: 'low' | 'moderate' | 'unrestricted'
}

/**
 * Flags are *surfaced*, never used to filter (doc 03 §3.2, AGENTS.md §8). The
 * user picked the bracket and is allowed to knowingly cross their own line.
 */
export type BracketFlag =
  | 'game-changer'
  | 'mass-land-denial'
  | 'extra-turn'
  | 'two-card-infinite'
  | 'over-budget'
