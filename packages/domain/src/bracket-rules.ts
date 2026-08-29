import type { Bracket, BracketPermission, BracketRules } from './bracket.js'
import type { OracleId } from './ids.js'
import { err, ok, type Result } from './result.js'

/**
 * Loading bracket rules (doc 03 §3.2, DATA-05).
 *
 * The allowances and the Game Changers list are NOT in code. They are maintained
 * by Wizards, have been revised since the system launched, and are read from
 * `brackets/rules.data.json` — hardcoding either is a rejected PR (AGENTS.md §8).
 *
 * That file is currently unpopulated, on purpose: writing plausible numbers from
 * memory is the failure ADR-0006 exists to prevent. So this loader has an honest
 * "not loaded" state, and every bracket verdict downstream is a Result that can
 * say "I don't know" rather than a boolean that quietly guesses.
 */

export interface BracketRuleset {
  readonly sourceUrl: string
  readonly retrievedAt: string
  readonly byBracket: ReadonlyMap<Bracket, BracketRules>
  readonly gameChangers: ReadonlySet<OracleId>
}

export type BracketRulesError =
  | { readonly kind: 'not-populated'; readonly message: string }
  | { readonly kind: 'malformed'; readonly message: string }

/** The shape of the JSON file, before validation. */
export interface RawBracketData {
  readonly sourceUrl: string | null
  readonly retrievedAt: string | null
  readonly brackets: readonly {
    readonly bracket: number
    readonly name: string
    readonly gameChangersAllowed: number | 'unlimited' | null
    readonly massLandDenial: string | null
    readonly extraTurnChaining: string | null
    readonly twoCardInfinites: string | null
    readonly tutorDensity: string | null
  }[]
  readonly gameChangers: readonly string[]
}

const PERMISSIONS: ReadonlySet<string> = new Set(['forbidden', 'discouraged', 'allowed'])
const DENSITIES: ReadonlySet<string> = new Set(['low', 'moderate', 'unrestricted'])

export const loadBracketRules = (
  raw: RawBracketData,
): Result<BracketRuleset, BracketRulesError> => {
  if (raw.sourceUrl === null || raw.retrievedAt === null) {
    return err({
      kind: 'not-populated',
      message:
        'brackets/rules.data.json has no sourceUrl or retrievedAt. The official ' +
        'bracket allowances and Game Changers list have not been fetched — see ' +
        'DATA-05 and ADR-0006. Bracket checks are unavailable until they are.',
    })
  }

  const byBracket = new Map<Bracket, BracketRules>()
  for (const entry of raw.brackets) {
    if (entry.bracket < 1 || entry.bracket > 5 || !Number.isInteger(entry.bracket)) {
      return err({ kind: 'malformed', message: `bracket ${entry.bracket} is not 1–5` })
    }
    const { gameChangersAllowed, massLandDenial, extraTurnChaining, twoCardInfinites, tutorDensity } = entry
    if (
      gameChangersAllowed === null ||
      massLandDenial === null ||
      extraTurnChaining === null ||
      twoCardInfinites === null ||
      tutorDensity === null
    ) {
      return err({
        kind: 'not-populated',
        message: `bracket ${entry.bracket} has unset allowances — see DATA-05`,
      })
    }
    if (
      !PERMISSIONS.has(massLandDenial) ||
      !PERMISSIONS.has(extraTurnChaining) ||
      !PERMISSIONS.has(twoCardInfinites) ||
      !DENSITIES.has(tutorDensity)
    ) {
      return err({ kind: 'malformed', message: `bracket ${entry.bracket} has an unknown value` })
    }
    byBracket.set(entry.bracket as Bracket, {
      bracket: entry.bracket as Bracket,
      name: entry.name,
      gameChangersAllowed,
      massLandDenial: massLandDenial as BracketPermission,
      extraTurnChaining: extraTurnChaining as BracketPermission,
      twoCardInfinites: twoCardInfinites as BracketPermission,
      tutorDensity: tutorDensity as BracketRules['tutorDensity'],
    })
  }

  if (byBracket.size !== 5) {
    return err({ kind: 'malformed', message: `expected 5 brackets, got ${byBracket.size}` })
  }

  return ok({
    sourceUrl: raw.sourceUrl,
    retrievedAt: raw.retrievedAt,
    byBracket,
    gameChangers: new Set(raw.gameChangers as readonly OracleId[]),
  })
}
