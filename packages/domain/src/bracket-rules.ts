import type { Bracket, BracketFlag, BracketPermission, BracketRules } from './bracket.js'
import type { OracleId } from './ids.js'
import { err, ok, type Result } from './result.js'
import rawBracketData from './brackets/rules.data.json' with { type: 'json' }

/**
 * Loading bracket rules (doc 03 §3.2, DATA-05).
 *
 * The allowances and the Game Changers list are NOT in code. They are maintained
 * by Wizards, have been revised since the system launched, and are read from
 * `brackets/rules.data.json` — hardcoding either is a rejected PR (AGENTS.md §8).
 *
 * The two halves now arrive by different routes, and deliberately so.
 *
 * The Game Changers LIST comes from the corpus, not from this file: Scryfall
 * publishes a `game_changer` boolean on every card record, so the list rides the
 * nightly ingest and cannot go stale in a checked-in array that nobody
 * remembers to edit. That is why `loadBracketRules` takes the set as an
 * argument — there is nowhere in a pure package to read it from, and there
 * should not be.
 *
 * The ALLOWANCES come from the data file, and only the Game Changers allowance
 * is populated. Wizards withdrew the tutor restriction outright and replaced the
 * other three barometers with a prose turn-count expectation, so there is no
 * current per-bracket value to record for them. They stay null and the callers
 * report them as unavailable, because a bracket verdict asserted from a retired
 * ruleset is the exact failure ADR-0006 exists to prevent.
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
  /**
   * The rules loaded but the corpus supplied no Game Changers.
   *
   * Its own kind rather than folded into `not-populated`, because the two need
   * different fixes: this one is "run the ingest", not "fetch the rules". It is
   * an error at all because an empty set satisfies every allowance vacuously —
   * a deck full of Game Changers would pass Bracket 1 and the app would say so
   * confidently. Refusing to load is the only honest answer.
   */
  | { readonly kind: 'game-changers-empty'; readonly message: string }

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
}

/**
 * The checked-in bracket data.
 *
 * A static import, not a read: `packages/domain` does no IO (AGENTS.md R1), and
 * the build copies `src/brackets` into `dist/brackets` so the specifier still
 * resolves once compiled. Exported so `apps/api` uses the same bytes the domain
 * tests assert against, rather than resolving its own path to the same file.
 */
export const BRACKET_DATA = rawBracketData as unknown as RawBracketData

const PERMISSIONS: ReadonlySet<string> = new Set(['forbidden', 'discouraged', 'allowed'])
const DENSITIES: ReadonlySet<string> = new Set(['low', 'moderate', 'unrestricted'])

/** A barometer Wizards does not currently publish reads as null, not as a value. */
const permission = (value: string | null): BracketPermission | null =>
  value === null ? null : (value as BracketPermission)

export const loadBracketRules = (
  raw: RawBracketData,
  gameChangers: Iterable<OracleId>,
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
    const {
      gameChangersAllowed,
      massLandDenial,
      extraTurnChaining,
      twoCardInfinites,
      tutorDensity,
    } = entry
    // Only the Game Changers allowance is required. The other four are null in
    // the source because Wizards publishes no per-bracket value for them; see
    // the file's own `notPublished` block for the quoted wording.
    if (gameChangersAllowed === null) {
      return err({
        kind: 'not-populated',
        message: `bracket ${entry.bracket} has no Game Changers allowance — see DATA-05`,
      })
    }
    if (gameChangersAllowed !== 'unlimited') {
      if (!Number.isInteger(gameChangersAllowed) || gameChangersAllowed < 0) {
        return err({
          kind: 'malformed',
          message: `bracket ${entry.bracket} allows ${String(gameChangersAllowed)} Game Changers`,
        })
      }
    }
    if (
      (massLandDenial !== null && !PERMISSIONS.has(massLandDenial)) ||
      (extraTurnChaining !== null && !PERMISSIONS.has(extraTurnChaining)) ||
      (twoCardInfinites !== null && !PERMISSIONS.has(twoCardInfinites)) ||
      (tutorDensity !== null && !DENSITIES.has(tutorDensity))
    ) {
      return err({ kind: 'malformed', message: `bracket ${entry.bracket} has an unknown value` })
    }
    byBracket.set(entry.bracket as Bracket, {
      bracket: entry.bracket as Bracket,
      name: entry.name,
      gameChangersAllowed,
      massLandDenial: permission(massLandDenial),
      extraTurnChaining: permission(extraTurnChaining),
      twoCardInfinites: permission(twoCardInfinites),
      tutorDensity: tutorDensity as BracketRules['tutorDensity'],
    })
  }

  if (byBracket.size !== 5) {
    return err({ kind: 'malformed', message: `expected 5 brackets, got ${byBracket.size}` })
  }

  const changers = new Set(gameChangers)
  if (changers.size === 0) {
    return err({
      kind: 'game-changers-empty',
      message:
        'no card in the corpus carries the Game Changers flag. Scryfall publishes ' +
        'it as `game_changer`, so an empty set means the ingest has not run since ' +
        'migration 0011 added the column — not that no card is a Game Changer. ' +
        'Every allowance would pass vacuously, so bracket checks are unavailable.',
    })
  }

  return ok({
    sourceUrl: raw.sourceUrl,
    retrievedAt: raw.retrievedAt,
    byBracket,
    gameChangers: changers,
  })
}

/** The deck's cards that are on the Game Changers list, in the order given. */
export const deckGameChangers = (
  ruleset: BracketRuleset,
  oracleIds: Iterable<OracleId>,
): readonly OracleId[] => {
  const seen = new Set<OracleId>()
  for (const id of oracleIds) {
    if (ruleset.gameChangers.has(id)) seen.add(id)
  }
  return [...seen]
}

/**
 * A bracket rule the deck breaks.
 *
 * Surfaced, never used to filter (doc 03 §3.2): the user picked the bracket and
 * is allowed to knowingly cross their own line. The counts travel alongside the
 * message so the UI can render the arithmetic rather than parse prose.
 */
export interface BracketViolation {
  readonly flag: BracketFlag
  readonly bracket: Bracket
  readonly allowed: number
  readonly actual: number
  readonly cards: readonly OracleId[]
  readonly message: string
}

/**
 * Check a deck against the one allowance the source actually publishes.
 *
 * Deliberately narrow. There is no mass-land-denial, extra-turn or two-card-combo
 * check here because there is no current per-bracket rule to check against, and
 * a check invented to fill the gap would be indistinguishable, to the user, from
 * a real one.
 */
export const bracketViolations = (
  ruleset: BracketRuleset,
  target: Bracket,
  deckOracleIds: Iterable<OracleId>,
): readonly BracketViolation[] => {
  const rules = ruleset.byBracket.get(target)
  if (rules === undefined) return []
  const allowed = rules.gameChangersAllowed
  const found = deckGameChangers(ruleset, deckOracleIds)
  if (allowed === 'unlimited' || found.length <= allowed) return []
  return [
    {
      flag: 'game-changer',
      bracket: target,
      allowed,
      actual: found.length,
      cards: found,
      message:
        `Bracket ${target} (${rules.name}) allows ${allowed} Game Changer` +
        `${allowed === 1 ? '' : 's'}; this deck has ${found.length}.`,
    },
  ]
}
