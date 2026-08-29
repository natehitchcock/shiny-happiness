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
