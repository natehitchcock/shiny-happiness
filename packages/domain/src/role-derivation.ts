import type { Card } from './card.js'
import type { OracleId } from './ids.js'
import { primaryRole, type Role } from './role.js'

/**
 * Role derivation (doc 02 §2.4, DOM-04).
 *
 * Precedence, highest first:
 *   1. The user's per-deck override — always wins, handled by the caller.
 *   2. The curated override table — cards the heuristics get wrong.
 *   3. Oracle-text heuristics.
 *
 * Rule 3 is wrong often enough to matter, and that is expected rather than a
 * defect to be engineered away: "does this card ramp" is a judgement about how a
 * card plays, not a property of its text. The curated table is therefore a
 * first-class, growing artifact, and the UI exposes a one-tap correction that
 * both fixes the deck and files a data issue.
 */

/** A heuristic: if `test` matches the card, it holds `role`. */
interface Heuristic {
  readonly role: Role
  readonly test: RegExp
  /** Applied to the type line rather than the oracle text. */
  readonly onTypeLine?: boolean
}

/**
 * Patterns are written against Scryfall oracle text conventions: `~` is not used
 * (Scryfall spells the card's own name out), reminder text is present, and
 * ability words are capitalised.
 */
const HEURISTICS: readonly Heuristic[] = [
  { role: 'land', test: /\bLand\b/, onTypeLine: true },

  // Ramp: produces mana, or fetches lands onto the battlefield.
  { role: 'ramp', test: /^\s*(\{[^}]*\}: )?Add \{/m },
  {
    role: 'ramp',
    test: /\bAdd (\{[WUBRGC0-9X/]+\}|one mana|two mana|.{0,20}mana of any colour|.{0,20}mana of any color)/,
  },
  {
    role: 'ramp',
    test: /search your library for (a|up to \w+) basic land card[^.]*onto the battlefield/i,
  },
  { role: 'ramp', test: /\bTreasure token/ },

  // Card advantage.
  { role: 'draw', test: /\bdraws? (a|two|three|four|X|that many) cards?\b/i },
  { role: 'draw', test: /\bdraw a card\b/i },

  {
    role: 'tutor',
    test: /search your library for (a|any) (?!basic land)[^.]*(card|creature|artifact|enchantment|instant|sorcery)[^.]*(your hand|the top of your library)/i,
  },

  { role: 'board-wipe', test: /destroy all\b/i },
  { role: 'board-wipe', test: /exile all\b/i },
  { role: 'board-wipe', test: /all creatures get -\d+\/-\d+/i },
  { role: 'board-wipe', test: /each (player|opponent) sacrifices (all|\w+) creatures?/i },

  { role: 'spot-removal', test: /destroy target\b/i },
  { role: 'spot-removal', test: /exile target\b/i },
  { role: 'spot-removal', test: /counter target\b/i },
  { role: 'spot-removal', test: /deals? \d+ damage to (target|any target)/i },
  { role: 'spot-removal', test: /target (player|opponent) sacrifices a creature/i },

  {
    role: 'graveyard-hate',
    test: /exile (all cards from|target player's graveyard|target card from a graveyard)/i,
  },
  { role: 'graveyard-hate', test: /graveyards? .{0,30}exiled instead/i },

  { role: 'protection', test: /\b(hexproof|shroud|indestructible|protection from)\b/i },
  { role: 'protection', test: /gains? (hexproof|indestructible|protection)/i },
  { role: 'protection', test: /counter target spell that targets/i },

  { role: 'recursion', test: /return .{0,40}from your graveyard to (your hand|the battlefield)/i },

  { role: 'sac-outlet', test: /sacrifice (a|another) (creature|permanent|artifact)[^.]*:/i },
  { role: 'sac-outlet', test: /\bSacrifice a creature:/i },

  {
    role: 'token-maker',
    test: /creates? (a|an|two|three|X|that many|\w+) .{0,60}creature tokens?/i,
  },
  { role: 'token-maker', test: /creates? .{0,40}token that's a copy/i },

  { role: 'anthem', test: /creatures you control get \+\d+\/\+\d+/i },
  { role: 'anthem', test: /other .{0,30}creatures you control get \+\d+\/\+\d+/i },

  { role: 'equipment', test: /\bEquipment\b/, onTypeLine: true },
  { role: 'aura', test: /\bAura\b/, onTypeLine: true },

  { role: 'evasion', test: /\b(flying|menace|trample|shadow|fear|intimidate|horsemanship)\b/i },
  { role: 'evasion', test: /can't be blocked\b/i },
  { role: 'evasion', test: /gains? (flying|menace|trample)/i },

  { role: 'stax', test: /\b(spells? cost|abilities? cost) \{\d+\} more to (cast|activate)/i },
  { role: 'stax', test: /don't untap during (their|your) untap step/i },
  { role: 'stax', test: /players can't\b/i },
  { role: 'stax', test: /each player can('t| not) cast/i },

  { role: 'wincon', test: /wins? the game\b/i },
  { role: 'wincon', test: /loses? the game\b/i },
]

export type RoleOverrides = ReadonlyMap<OracleId, readonly Role[]>

/**
 * Cards the heuristics get wrong, keyed by oracle id.
 *
 * Empty until real card data exists (DATA-01, ING-01) — populating it from
 * remembered oracle ids would be inventing data. Task `DOM-04` owns growing it
 * once the ingest lands, and the UI's "this role is wrong" correction feeds it.
 */
export const CURATED_OVERRIDES: RoleOverrides = new Map()

export interface DerivedRoles {
  readonly roles: readonly Role[]
  readonly primary: Role
  readonly source: 'override' | 'curated' | 'heuristic'
}

/** Roles for a card. `userOverride` is the per-deck `DeckEntry.roleOverride`. */
export const deriveRoles = (
  card: Pick<Card, 'oracleId' | 'typeLine' | 'oracleText'>,
  options: {
    readonly userOverride?: readonly Role[] | null
    readonly curated?: RoleOverrides
  } = {},
): DerivedRoles => {
  const userOverride = options.userOverride
  if (userOverride !== null && userOverride !== undefined && userOverride.length > 0) {
    return { roles: userOverride, primary: primaryRole(userOverride), source: 'override' }
  }

  const curated = (options.curated ?? CURATED_OVERRIDES).get(card.oracleId)
  if (curated !== undefined && curated.length > 0) {
    return { roles: curated, primary: primaryRole(curated), source: 'curated' }
  }

  const roles = new Set<Role>()
  for (const heuristic of HEURISTICS) {
    const subject = heuristic.onTypeLine === true ? card.typeLine : card.oracleText
    if (heuristic.test.test(subject)) roles.add(heuristic.role)
  }

  // A land is a land. Without this, a manland or a land that draws a card gets
  // counted under `draw` and the land count — the number people check first —
  // silently comes up short.
  if (/\bLand\b/.test(card.typeLine)) {
    const list: readonly Role[] = ['land']
    return { roles: list, primary: 'land', source: 'heuristic' }
  }

  // Nothing matched. `synergy` is the honest catch-all: it means "this card does
  // something for the deck we could not classify", not "this card does nothing".
  const list = roles.size === 0 ? (['synergy'] as const) : ([...roles] as const)
  return { roles: list, primary: primaryRole(list), source: 'heuristic' }
}
