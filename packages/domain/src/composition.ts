import type { CardType } from './card.js'
import type { Role } from './role.js'

/**
 * What a composition target counts (doc 14 §14.2, ADR-0005).
 *
 * Both shapes are needed: "how much ramp" is a role, "how many creatures" is a
 * type. A role-only target could not express the second at all.
 */
export type CompositionDimension =
  | { readonly kind: 'role'; readonly role: Role }
  | { readonly kind: 'type'; readonly type: CardType }

export const roleDimension = (role: Role): CompositionDimension => ({ kind: 'role', role })
export const typeDimension = (type: CardType): CompositionDimension => ({ kind: 'type', type })

/** Where a target's number came from (doc 16). */
export type TargetSource = 'archetype' | 'custom'

/** Always a range with an ideal marked — never a single number (doc 05 §5.4). */
export interface CompositionTarget {
  readonly dimension: CompositionDimension
  readonly min: number
  readonly ideal: number
  readonly max: number
  /**
   * `custom` when the builder typed this ideal rather than inheriting it.
   *
   * Optional, so a caller that predates doc 16 keeps working unchanged
   * (AGENTS.md R2) and every existing `CompositionTarget` literal still
   * type-checks. It rides on the target rather than being passed alongside
   * because the two consumers that need it — the meters and the `fills-deficit`
   * reason — both already hold the target and nothing else. Pillar P4 is the
   * point: "fills a ramp gap" and "fills the ramp target you set" are different
   * claims and a recommendation must make the one that is true.
   */
  readonly source?: TargetSource
}

/** Stable string form, for map keys and the `fills-<dimension>` group key. */
export const dimensionKey = (dimension: CompositionDimension): string =>
  dimension.kind === 'role' ? `role:${dimension.role}` : `type:${dimension.type}`

/**
 * The inverse of `dimensionKey`, for a key that came back from storage.
 *
 * `null` rather than a thrown error or a fabricated dimension: the caller is a
 * per-deck override read out of `jsonb` (doc 16), and a key it cannot parse is
 * one override to drop, not a deck to refuse to open. Kept next to
 * `dimensionKey` so the two can never drift — a round-trip test holds them.
 */
export const dimensionFromKey = (key: string): CompositionDimension | null => {
  if (key.startsWith('role:')) return roleDimension(key.slice('role:'.length) as Role)
  if (key.startsWith('type:')) return typeDimension(key.slice('type:'.length) as CardType)
  return null
}

/**
 * Every dimension a card counts toward — one role, and each of its types.
 *
 * The single definition of that rule. Counting a deck, counting only its locked
 * cards, and the web app's immediate overlay all read it, because a gold overlay
 * counted by a different rule than the bar under it is not an overlay: it can
 * exceed the bar, or miss a dimension the bar has. That is exactly what happened
 * — locked counts were emitted for `role:` keys only, so the `type:creature`
 * meter could never show gold however many creatures were locked.
 *
 * Structural rather than `Card`, so a caller holding a view model with the same
 * two fields can use it without building a domain card first.
 */
export const dimensionKeysOf = (card: {
  readonly primaryRole: string
  readonly types: readonly string[]
}): readonly string[] => [
  dimensionKey(roleDimension(card.primaryRole as Role)),
  ...card.types.map((type) => dimensionKey(typeDimension(type as CardType))),
]
