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

/** Always a range with an ideal marked — never a single number (doc 05 §5.4). */
export interface CompositionTarget {
  readonly dimension: CompositionDimension
  readonly min: number
  readonly ideal: number
  readonly max: number
}

/** Stable string form, for map keys and the `fills-<dimension>` group key. */
export const dimensionKey = (dimension: CompositionDimension): string =>
  dimension.kind === 'role' ? `role:${dimension.role}` : `type:${dimension.type}`

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
