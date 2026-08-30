/**
 * The small marks that appear on more than one level.
 *
 * Each one obeys the same rule: never colour alone. A combo badge is a number,
 * a role dot has a text label beside it or an accessible name, a bracket flag is
 * a word. `tokens.ts` documents why — sage and rust are not separable under
 * deuteranopia, and these are exactly the marks that would rely on them.
 */

import type { JSX } from 'react'
import { IDENTITY_COLORS, identityKey } from './presentation.js'
import type { Color } from './types.js'

export interface DegreeProps {
  readonly degree: number
  readonly near?: number
}

/**
 * Combo degree — how many combos this card completes right now.
 *
 * Renders nothing at zero. A badge showing "0" on most of the pool is noise, and
 * the whole point of the mark is that it is rare.
 */
export const ComboBadge = ({ degree, near = 0 }: DegreeProps): JSX.Element | null => {
  if (degree <= 0 && near <= 0) return null
  const label =
    degree > 0
      ? `completes ${String(degree)} combo${degree === 1 ? '' : 's'}`
      : `one piece away from ${String(near)} combo${near === 1 ? '' : 's'}`
  return (
    <span className="rt-combo" data-near={degree <= 0} title={label} aria-label={label}>
      {degree > 0 ? degree : `+${String(near)}`}
    </span>
  )
}

export interface RoleDotProps {
  readonly role: string
  /** Show the role name next to the dot. Off at L1, where there is no room. */
  readonly showLabel?: boolean
}

export const RoleDot = ({ role, showLabel = false }: RoleDotProps): JSX.Element => (
  <span className="rt-role" title={role}>
    <span className="rt-role-dot" data-role={role} aria-hidden="true" />
    {showLabel ? <span className="rt-role-name">{role}</span> : null}
    {showLabel ? null : <span className="rt-sr">{role}</span>}
  </span>
)

export interface ManaValueProps {
  readonly manaValue: number
}

export const ManaValue = ({ manaValue }: ManaValueProps): JSX.Element => (
  <span className="rt-mv" aria-label={`mana value ${String(manaValue)}`}>
    {manaValue}
  </span>
)

export interface IdentityStripProps {
  readonly colorIdentity: readonly Color[]
}

/**
 * The colour-identity swatch. Present at L1 and L2 for the same reason the pip
 * palette exists at L0 — but here it is decoration on top of a visible name, so
 * the CVD collisions that constrain L0 do not bite.
 */
export const IdentityStrip = ({ colorIdentity }: IdentityStripProps): JSX.Element => {
  const key = identityKey(colorIdentity)
  const label = colorIdentity.length === 0 ? 'colourless' : colorIdentity.join('')
  return (
    <span
      className="rt-identity"
      style={{ background: IDENTITY_COLORS[key] }}
      aria-label={`colour identity ${label}`}
      title={`colour identity ${label}`}
    />
  )
}

export interface PriceProps {
  readonly priceUsd: number | null | undefined
}

export const Price = ({ priceUsd }: PriceProps): JSX.Element => {
  // An unpriced card says so. Rendering nothing reads as "free", which is the
  // one wrong answer — several of the most expensive cards have no price on
  // their default printing.
  if (priceUsd === null || priceUsd === undefined) {
    return (
      <span className="rt-price" data-unknown="true" aria-label="price unknown">
        $—
      </span>
    )
  }
  return (
    <span className="rt-price" aria-label={`${priceUsd.toFixed(2)} dollars`}>
      ${priceUsd.toFixed(2)}
    </span>
  )
}
