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

/**
 * What one bracket permits.
 *
 * Every barometer except the Game Changers allowance is nullable, because
 * Wizards does not currently publish a per-bracket value for it. The tutor
 * restriction was withdrawn outright in the 2025-10-21 bracket update, and the
 * other three were replaced by a prose turn-count expectation that states no
 * permitted/forbidden verdict. `null` is therefore "the format has no rule to
 * check here", which is a different claim from `'allowed'` — and the only one
 * the source supports. See `brackets/rules.data.json` for the quoted wording.
 */
export interface BracketRules {
  readonly bracket: Bracket
  readonly name: string
  readonly gameChangersAllowed: number | 'unlimited'
  readonly massLandDenial: BracketPermission | null
  readonly extraTurnChaining: BracketPermission | null
  readonly twoCardInfinites: BracketPermission | null
  readonly tutorDensity: 'low' | 'moderate' | 'unrestricted' | null
}

/**
 * Flags are *surfaced*, never used to filter (doc 03 §3.2, AGENTS.md §8). The
 * user picked the bracket and is allowed to knowingly cross their own line.
 */
export type BracketFlag =
  'game-changer' | 'mass-land-denial' | 'extra-turn' | 'two-card-infinite' | 'over-budget'
