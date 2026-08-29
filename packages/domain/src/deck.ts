import type { ArchetypeKey } from './archetype.js'
import type { Bracket } from './bracket.js'
import type { Color } from './card.js'
import type { DeckId, OracleId } from './ids.js'
import type { Role } from './role.js'

/**
 * A card is in exactly one state relative to a deck (doc 02 §2.2).
 *
 * `excluded` is not "absent": an excluded card is never suggested again for this
 * deck (pillar P6). Dragging a core card out must not let the next core-package
 * run put it straight back.
 */
export type Zone = 'accepted' | 'excluded'

export type Origin = 'core' | 'manual' | 'recommended' | 'imported'

export interface DeckEntry {
  readonly oracleId: OracleId
  readonly zone: Zone
  readonly origin: Origin
  /** User-pinned. Bulk operations may not remove it. Orthogonal to `zone`. */
  readonly locked: boolean
  /** The user disagrees with derived roles (doc 02 §2.4). Wins over everything. */
  readonly roleOverride: readonly Role[] | null
  /** Categories carried in from an import — their taxonomy, not ours (doc 15 §15.2). */
  readonly tags: readonly string[]
  readonly addedAt: string
}

/**
 * How a second commander is legal. Each rule has its own pairing constraint, so
 * they stay distinct variants rather than collapsing to a boolean (doc 03 §3.1).
 */
export type PartnerRule =
  | { readonly kind: 'none' }
  | { readonly kind: 'partner' }
  | { readonly kind: 'partner-with'; readonly partner: OracleId }
  | { readonly kind: 'background' }
  | { readonly kind: 'friends-forever' }
  | { readonly kind: 'doctors-companion' }

export interface BudgetConstraint {
  readonly maxTotalUsd: number | null
  readonly maxCardUsd: number | null
}

export interface Deck {
  readonly id: DeckId
  readonly name: string
  /** One, or two under a `PartnerRule`. */
  readonly commanders: readonly OracleId[]
  readonly targetBracket: Bracket
  readonly archetype: ArchetypeKey
  /** Hybrid deck; targets blend 70/30 toward the primary (doc 14 §14.1). */
  readonly archetypeSecondary: ArchetypeKey | null
  /** Derived from the commanders; cached. */
  readonly colorIdentity: readonly Color[]
  readonly entries: readonly DeckEntry[]
  readonly budget: BudgetConstraint | null
  readonly status: 'active' | 'archived'
  /** Monotonic; bumped server-side per accepted command batch (doc 12 §12.7). */
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastOpenedAt: string
}

/**
 * The accepted set `A` used throughout combo-degree computation — every accepted
 * entry **plus the commanders**, which are accepted by definition and are the
 * most common combo partner in the deck (doc 02 §2.3).
 */
export const acceptedSet = (deck: Deck): ReadonlySet<OracleId> => {
  const accepted = new Set<OracleId>(deck.commanders)
  for (const entry of deck.entries) {
    if (entry.zone === 'accepted') accepted.add(entry.oracleId)
  }
  return accepted
}

/** Cards the user has removed. Never re-suggest these (pillar P6). */
export const excludedSet = (deck: Deck): ReadonlySet<OracleId> => {
  const excluded = new Set<OracleId>()
  for (const entry of deck.entries) {
    if (entry.zone === 'excluded') excluded.add(entry.oracleId)
  }
  return excluded
}
