/**
 * L2 — the card. Full image at ~220 px, with an overlay badge row.
 *
 * The default entry level (doc 07 §7.1), so this is the representation most
 * users see first and the one that has to be right without explanation. It shows
 * what the tile could not: price, bracket flags, and the combo badge with its
 * near-miss count.
 *
 * Oracle text is NOT rendered as text here — it is in the card image, which is
 * legible at this size. Duplicating it would double the height of every card to
 * repeat what is already on screen.
 */

import type { JSX, KeyboardEvent } from 'react'
import { CARD_ASPECT, HIT_TARGET_MIN, levelSpec } from './presentation.js'
import { ComboBadge, IdentityStrip, ManaValue, Price } from './Badges.js'
import { ManaCost } from './ManaCost.js'
import type { CardView } from './types.js'

export interface CardFaceProps {
  readonly card: CardView
  readonly width?: number
  readonly selected?: boolean
  readonly onActivate?: (oracleId: string) => void
  /** Rendered under the badge row — accept / never / lock, supplied by the app. */
  readonly actions?: JSX.Element
}

export const CardFace = ({
  card,
  width,
  selected = false,
  onActivate,
  actions,
}: CardFaceProps): JSX.Element => {
  const spec = levelSpec(2)
  const w = width ?? spec.width
  const h = Math.round(w * CARD_ASPECT)
  const image = card.imageUris?.normal

  const activate = (): void => onActivate?.(card.oracleId)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <div className="rt-face" data-selected={selected} style={{ width: w }}>
      <div
        className="rt-face-image"
        role="button"
        tabIndex={0}
        aria-label={`${card.name}. Open details.`}
        onClick={activate}
        onKeyDown={onKeyDown}
        style={{ width: w, height: h, minWidth: HIT_TARGET_MIN, minHeight: HIT_TARGET_MIN }}
      >
        {image === undefined ? (
          // No printing resolved. The fallback is a real card-shaped panel with
          // the name and type line, not a placeholder graphic — an unresolved
          // card is still a card you may want to accept.
          <div className="rt-face-text">
            <span className="rt-face-name">{card.name}</span>
            <span className="rt-face-cost">
              <ManaCost cost={card.manaCost} />
            </span>
            <span className="rt-face-type">{card.typeLine ?? ''}</span>
            <span className="rt-face-oracle">{card.oracleText ?? ''}</span>
          </div>
        ) : (
          <img src={image} alt={card.name} loading="lazy" width={w} height={h} />
        )}
      </div>

      <div className="rt-face-badges">
        <IdentityStrip colorIdentity={card.colorIdentity ?? []} />
        <ManaValue manaValue={card.manaValue ?? 0} />
        <ComboBadge degree={card.comboDegree ?? 0} near={card.nearCombosAt1 ?? 0} />
        <Price priceUsd={card.priceUsd} />
        {(card.bracketFlags ?? []).map((flag) => (
          // Flagged, never filtered (doc 03). The word is the badge; there is no
          // colour-only version of this, deliberately.
          <span className="rt-flag" key={flag} title={flag}>
            {flag}
          </span>
        ))}
      </div>

      {actions}
    </div>
  )
}
