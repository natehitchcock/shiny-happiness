import type { ArchetypeKey } from './archetype.js'
import type { Bracket } from './bracket.js'
import type { Color } from './card.js'
import type { DeckColumn } from './columns.js'
import type { DeckId, OracleId } from './ids.js'
import type { Role } from './role.js'
import type { SemanticEmphasis } from './semantic-emphasis.js'
import type { TargetOverrides } from './target-overrides.js'

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
  /**
   * Free text the builder writes about the deck. Never parsed.
   *
   * Empty, not null, so nothing downstream has to decide what a missing
   * description means — there is only "they have not written one yet".
   */
  readonly description: string
  /** One, or two under a `PartnerRule`. */
  readonly commanders: readonly OracleId[]
  readonly targetBracket: Bracket
  readonly archetype: ArchetypeKey
  /** Hybrid deck; targets blend 70/30 toward the primary (doc 14 §14.1). */
  readonly archetypeSecondary: ArchetypeKey | null
  /**
   * The role counts, curve buckets and tolerance this builder disagrees with the
   * preset about (doc 16). Sparse; `{}` is a deck that accepts the archetype.
   *
   * Optional so that adding it is additive (AGENTS.md R2) and every existing
   * `Deck` literal — there are dozens in the tests — still type-checks. Read it
   * as `deck.targetOverrides ?? NO_TARGET_OVERRIDES`; absent and empty mean the
   * same thing and no consumer should have to tell them apart.
   *
   * NOT part of `DeckCommand`. A target is a property of the deck, not an
   * operation on its contents, and putting a slider through the command batch
   * would make "I moved a target" undoable in the same queue as "I added a
   * card" — two very different sizes of mistake sharing one Ctrl+Z.
   */
  readonly targetOverrides?: TargetOverrides
  /**
   * The commander semantics this deck is actually about (ADR-0011 tags).
   *
   * Sparse in the same sense as `targetOverrides`: `[]` is a deck that has said
   * nothing, and absent means the same. Optional so adding it is additive
   * (AGENTS.md R2) and every existing `Deck` literal still type-checks. Read it
   * as `deck.semanticEmphasis ?? NO_EMPHASIS`.
   *
   * A SEPARATE AXIS FROM `targetOverrides`, deliberately. A target says how many
   * ramp cards the deck should hold; an emphasis says which of two ramp cards to
   * offer first. Emphasis is added as its own scoring term and touches neither
   * the composition targets nor the group a card lands in, so a deck can want
   * eighteen creatures AND be about opponent-discard without either claim eating
   * the other (doc 16, doc 05 §5.3).
   *
   * NOT part of `DeckCommand`, for the same reason a target is not: it is a
   * property of the deck rather than an operation on its contents, and putting
   * a chip toggle through the command batch would make "I changed my focus"
   * undoable in the same queue as "I added a card".
   */
  readonly semanticEmphasis?: SemanticEmphasis
  /**
   * The columns this builder wants beside every suggestion (doc 18 §18.7).
   *
   * > "any added or removed column should be saved along with the deck - the
   * > filters are basically part of the deck"
   *
   * THE ONE FIELD HERE WHERE ABSENT AND EMPTY ARE DIFFERENT DECKS, and it is
   * deliberate. `targetOverrides` and `semanticEmphasis` are both `{}`/`[]` when
   * unset because "has overridden nothing" and "has not overridden anything" are
   * the same deck. Columns are not: a deck that has never been touched should
   * show `DEFAULT_COLUMNS`, and a deck whose builder has REMOVED every column
   * must show none and must not be handed them back on the next page load.
   *
   * So `null`/absent means "never set — use `DEFAULT_COLUMNS`" and `[]` means
   * "deliberately none". Read it as `columnsFor(deck.columns)`; no consumer
   * should test `length === 0` itself.
   *
   * Being nullable is also what lets `DEFAULT_COLUMNS` change later without a
   * data migration. Stored eagerly, every existing deck would be frozen holding
   * whichever default list existed the day it was created — the same failure
   * doc 16 rejected full target snapshots for.
   *
   * NOT part of `DeckCommand`, for the same reason a target is not: it is a
   * property of the deck rather than an operation on its contents, and putting
   * it through the command batch would make "I added a column" undoable in the
   * same queue as "I added a card".
   */
  readonly columns?: readonly DeckColumn[] | null
  /** Derived from the commanders; cached. */
  readonly colorIdentity: readonly Color[]
  readonly entries: readonly DeckEntry[]
  readonly budget: BudgetConstraint | null
  /**
   * Filter, not a flag (ADR-0011).
   *
   * The opposite of the bracket rule (doc 03 §3.2) and deliberately so: a
   * bracket is a social line the user may knowingly cross, while "no Warhammer
   * cards in my Magic deck" is a taste preference with no reason to keep
   * offering. Per-deck, so it survives reopening.
   */
  readonly excludeUniversesBeyond: boolean
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

/**
 * Every accepted card, **one entry per copy**, commanders first.
 *
 * `acceptedSet` deliberately is not this. A Set is the right shape for combo
 * lookups — a combo either has its pieces or it does not, and a second Mountain
 * adds nothing — and the wrong shape for anything that counts the deck, where
 * ten Mountains are ten cards. Both readings of "accepted" are real questions;
 * naming them apart is what stops a caller reaching for the wrong one, which is
 * how the colour pie came to report ten Mountains as one red source.
 *
 * A commander that ALSO has an accepted entry is counted once — the same guard
 * `validateDeck` applies when it counts copies for the singleton rule. It
 * happens: import a decklist with the commander in the hundred, then set it as
 * the commander, and the deck holds both rows.
 */
export const acceptedCopies = (deck: Deck): readonly OracleId[] => {
  const copies: OracleId[] = [...deck.commanders]
  for (const entry of deck.entries) {
    if (entry.zone === 'accepted' && !deck.commanders.includes(entry.oracleId)) {
      copies.push(entry.oracleId)
    }
  }
  return copies
}

/** Cards the user has removed. Never re-suggest these (pillar P6). */
export const excludedSet = (deck: Deck): ReadonlySet<OracleId> => {
  const excluded = new Set<OracleId>()
  for (const entry of deck.entries) {
    if (entry.zone === 'excluded') excluded.add(entry.oracleId)
  }
  return excluded
}
