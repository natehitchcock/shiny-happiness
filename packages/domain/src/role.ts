/**
 * Roles (doc 02 §2.4). The vocabulary for composition targets and for the
 * "fills a gap" candidate group.
 *
 * The last six were added for archetype targets — see doc 14 and ADR-0005.
 */
export type Role =
  | 'land'
  | 'ramp'
  | 'draw'
  | 'tutor'
  | 'spot-removal'
  | 'board-wipe'
  | 'graveyard-hate'
  | 'protection'
  | 'recursion'
  | 'wincon'
  | 'synergy'
  | 'stax'
  | 'sac-outlet'
  | 'token-maker'
  | 'anthem'
  | 'equipment'
  | 'aura'
  | 'evasion'

/**
 * Precedence for choosing a card's `primaryRole` when it holds several.
 *
 * Composition counting needs exactly one role per card or the totals double-count
 * (Cultivate is ramp *and* land-fetch; Beast Within is spot-removal *and* makes a
 * token). Filtering still sees the full role set — only counting uses this.
 *
 * Ordered most- to least-specific: a card that sacrifices creatures is better
 * described as a sac outlet than as "synergy", and `land` wins outright because
 * the land count is the number people check first.
 */
export const ROLE_PRECEDENCE: readonly Role[] = [
  'land',
  'ramp',
  'sac-outlet',
  'token-maker',
  'tutor',
  'board-wipe',
  'spot-removal',
  'graveyard-hate',
  'stax',
  'recursion',
  'protection',
  'equipment',
  'aura',
  'anthem',
  'evasion',
  'draw',
  'wincon',
  'synergy',
]

/**
 * Is this string one of the eighteen roles?
 *
 * For the client boundary. `api.Card.primaryRole` is a bare `string` on the
 * wire — it has to be, since a server one version ahead may send a role this
 * build has never heard of — and code that wants to look a role up in a table
 * would otherwise cast. A cast says "trust me"; this asks.
 *
 * Reads `ROLE_PRECEDENCE`, which is exhaustive over `Role` because `primaryRole`
 * below already depends on it being so: a role missing from that list can never
 * be chosen as a primary.
 */
const ROLE_NAMES: ReadonlySet<string> = new Set<string>(ROLE_PRECEDENCE)
export const isRole = (value: string): value is Role => ROLE_NAMES.has(value)

/**
 * The single role a card is counted under. Falls back to `synergy` — the
 * catch-all — rather than throwing, because role derivation is heuristic and an
 * unclassifiable card is a data-quality problem, not a crash.
 */
export const primaryRole = (roles: readonly Role[]): Role => {
  for (const candidate of ROLE_PRECEDENCE) {
    if (roles.includes(candidate)) return candidate
  }
  return 'synergy'
}
