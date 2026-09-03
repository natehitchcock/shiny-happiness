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
 * Composition counting needs exactly one role per card or the totals
 * double-count (Cultivate is ramp *and* land-fetch; Beast Within is
 * spot-removal *and* makes a token). Filtering still sees the full role set —
 * only counting uses this. ADR-0031 makes counting and OFFERING the same
 * question, so this list also decides which `fills-<role>` heading a card is
 * shown under, and therefore what the product claims a card will do for a deck.
 *
 * THE PRINCIPLE (ADR-0054). *If this card were cut, which of its jobs would the
 * deck have to go and replace?* That is one question with one answer per pair,
 * and it is what a composition target means: the meter says "you are four short
 * of removal", so the card offered to close it has to be one that answers
 * something.
 *
 * The list used to open `land, ramp, sac-outlet, token-maker, tutor` and only
 * then reach the answers, and the top of it had never been argued — the comment
 * this replaces made its case entirely about the answer block. Read against the
 * question above, three of those four positions are wrong, and 345
 * commander-legal cards were counted under a job their deck was not short of:
 *
 *   - A card that ANSWERS something and also leaves a body, a Treasure or a
 *     land behind is bought for the answer. The rider is compensation the card
 *     pays for its own effect: Pongify is removal that leaves an Ape, Deadly
 *     Derision is removal that leaves a Treasure, Kayla's Command is a modal
 *     spell whose "search for a basic Plains" mode is not why it is in a deck.
 *     So `token-maker` (210 cards), `ramp` (99) and `tutor` (12) move BELOW the
 *     answer block. `role.ts` already named Beast Within as "spot-removal *and*
 *     makes a token" and then ordered it the other way round.
 *
 *   - `sac-outlet` does NOT move, and the difference is the whole reason this
 *     is a judgement rather than a sort. Its removal is not a rider — it is the
 *     outlet. Goblin Bombardment, Blasting Station, Attrition and Stronghold
 *     Assassin spend one of your own creatures to kill something, so the two
 *     roles are one ability, and the job with no substitute is the outlet: a
 *     deck has many ways to kill a creature and few repeatable ways to make one
 *     of its own die on demand. 54 cards stay where they are.
 *
 *   - `ramp` falls below `sac-outlet` as a consequence, and that is a
 *     correction rather than a side effect: Ashnod's Altar, Phyrexian Altar,
 *     Krark-Clan Ironworks and Skirk Prospector were all counted as RAMP. 26
 *     cards, every one of them named for the outlet.
 *
 * `land` still wins outright, and it is barely a precedence question —
 * `deriveRoles` short-circuits every land before this list is consulted — but
 * it leads because the land count is the number people check first.
 *
 * The answer block — board-wipe, graveyard-hate, counterspell, spot-removal,
 * bounce — moved as a block and its INTERNAL order is untouched. It is ordered
 * by how completely the card answers something, and three of those five
 * positions were argued in ADR-0037:
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
 *
 * `stax` closes the answer band, where it already sat relative to `bounce`.
 * Below the band the order is unchanged: ramp, then the engines it feeds, then
 * the roles that describe a card's shape rather than its job.
 */
export const ROLE_PRECEDENCE: readonly Role[] = [
  'land',
  'sac-outlet',
  'board-wipe',
  'graveyard-hate',
  'counterspell',
  'spot-removal',
  'bounce',
  'stax',
  'ramp',
  'token-maker',
  'tutor',
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
