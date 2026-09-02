/**
 * Roles (doc 02 §2.4). The vocabulary for composition targets and for the
 * "fills a gap" candidate group.
 *
 * The last six were added for archetype targets — see doc 14 and ADR-0005.
 *
 * `counterspell` and `bounce` were added by ADR-0037. Both were previously
 * swallowed: a counterspell was counted as spot-removal (459 cards), and bounce
 * had no rule at all, so 164 of the 290 cards that answer a permanent by
 * returning it fell to the `synergy` catch-all.
 */
export type Role =
  | 'land'
  | 'ramp'
  | 'draw'
  | 'tutor'
  | 'spot-removal'
  | 'counterspell'
  | 'bounce'
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
 *
 * The answer block — board-wipe, graveyard-hate, counterspell, spot-removal,
 * bounce — is ordered by how completely the card answers something, and three of
 * those five positions were argued in ADR-0037:
 *
 *   - `graveyard-hate` moved ABOVE `spot-removal`. It was below, and every one
 *     of the 107 cards holding it also held spot-removal (because "exile target
 *     player's graveyard" matched `exile target`), so it had zero primaries: a
 *     role no deck could ever be shown as holding.
 *   - `counterspell` sits above `spot-removal` because a card that does both is
 *     bought for the counter (Mystic Confluence), and below `board-wipe` and
 *     `graveyard-hate` because those are the rarer, more specific jobs.
 *   - `bounce` sits BELOW `spot-removal`: bounce is the weaker answer, since the
 *     permanent comes back, so a card that does both is better described by the
 *     one that does not.
 */
export const ROLE_PRECEDENCE: readonly Role[] = [
  'land',
  'ramp',
  'sac-outlet',
  'token-maker',
  'tutor',
  'board-wipe',
  'graveyard-hate',
  'counterspell',
  'spot-removal',
  'bounce',
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
 * Is this string one of the twenty roles?
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
