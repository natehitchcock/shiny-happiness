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
 *
 * ---------------------------------------------------------------------------
 *
 * `equipment` MOVES ABOVE THE ANSWER BLOCK AND `aura` DOES NOT (ADR-0060 §4).
 *
 * ADR-0054 argued `ramp`, `token-maker` and `tutor` down past the answers and
 * never looked at the two roles left sitting below `protection`. Read against
 * its own question, 193 of the corpus's 620 Equipment were counted as something
 * else — Batterskull as `token-maker`, Sword of the Animist as `ramp`, Kaldra
 * Compleat and Lightning Greaves and Sword of Feast and Famine as `protection`.
 * A playtest asked Quickbuild for "5 more ramp" in a mono-white deck and was
 * offered Orcrist, Bitterthorn and Sword of Wealth and Power: the whole
 * `fills-ramp` group held eight Equipment and one Aura, no rocks and no lands.
 *
 * Cut Sword of the Animist and the deck replaces an Equipment. The Landfall
 * trigger is compensation the card pays for costing a card and three mana, in
 * exactly the sense Pongify's Ape is — which is the sentence ADR-0054 already
 * wrote, applied one role over.
 *
 * THE TWO ARE NOT ORDERED TOGETHER, and the corpus is why. 81 cards hold one of
 * these type roles AND an answer role, and the question "which job would the
 * deck replace?" has one answer for the Equipment and two for the Auras:
 *
 *   - THE 39 EQUIPMENT ARE UNANIMOUS. Every one is a pinger or a package
 *     stapled to a creature: Viridian Longbow, Heartseeker, Mortarpod, Arc
 *     Spitter, Heavy Arbalest, Thornbite Staff, Sword of Fire and Ice, Blazing
 *     Torch, Argentum Armor. Nobody plays a Longbow as their removal; it is an
 *     Equipment whose removal needs a creature, an equip cost and a turn. Cut
 *     it and the deck replaces an Equipment.
 *
 *   - THE 42 AURAS SPLIT ROUGHLY IN HALF, and the half that answers is the half
 *     that matters. Chained to the Rocks, Ossification, On Thin Ice, Faith
 *     Unbroken, Sheltered by Ghosts, Buried in the Garden and Dimensional Exile
 *     are Oblivion Ring wearing a different type line — the card's whole
 *     function is that a permanent is gone. Against them sit the pinger Auras
 *     (Hermetic Study, Quicksilver Dagger, Fire Whip, Lavamancer's Skill),
 *     which read like the Equipment. One order cannot describe both, and where
 *     a list cannot be right it should keep the SCARCER, MORE SPECIFIC claim —
 *     ADR-0037's reason for putting `graveyard-hate` above `spot-removal`, and
 *     the reason blue's answers had to be found at all: mono-blue holds 84
 *     spot-removal primaries against mono-red's 960, so an Aura is where blue
 *     keeps its removal and `aura` above the block would hide it again.
 *
 * Measured directly: `aura` above the answer block moves Frogify,
 * Ichthyomorphosis, Kasmina's Transmutation, Song of the Dryads and 66 more
 * OUT of `spot-removal`, which is the defect this same ADR is fixing.
 *
 * `sac-outlet` still leads both, untouched, for ADR-0054's stated reason:
 * Rakdos Riteknife and Junk Jet are outlets whose body happens to be an
 * Equipment, and a deck has few repeatable ways to make its own creature die.
 *
 * 356 commander-legal cards change primary role. By class:
 * token-maker→equipment 93, protection→aura 59, token-maker→aura 54,
 * spot-removal→equipment 40, protection→equipment 39, recursion→aura 26,
 * ramp→aura 22, ramp→equipment 14, recursion→equipment 3, board-wipe→equipment
 * 2 (Worldslayer, Mjölnir), stax→equipment 2 (Conqueror's Flail, Godsend),
 * tutor→aura 1.
 *
 * Below the band the order is unchanged: ramp, then the engines it feeds, then
 * the roles that describe a card's shape rather than its job.
 */
export const ROLE_PRECEDENCE: readonly Role[] = [
  'land',
  'sac-outlet',
  'equipment',
  'board-wipe',
  'graveyard-hate',
  'counterspell',
  'spot-removal',
  'bounce',
  'stax',
  'aura',
  'ramp',
  'token-maker',
  'tutor',
  'recursion',
  'protection',
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
