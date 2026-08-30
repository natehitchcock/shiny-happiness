/**
 * L1 — the tile. ~72 px art crop, the working level for scanning a group.
 *
 * What it draws, from doc 07 §7.1: art crop, name on a bottom strip, mana value,
 * role dot, and the combo badge when non-zero. What it does NOT draw: oracle
 * text, price, bracket flags. At 72 px those are illegible, and a tile that
 * tries to show them shows nothing.
 *
 * The tile is 72 px but its hit area is padded to 44 px minimum in both axes
 * (doc 08 §8.3) — at this size the width already clears it and the height does
 * too, but the padding rule is applied rather than assumed, because the same
 * component is used at `mobileWidth` and at any override a caller passes.
 */

import type { JSX, KeyboardEvent } from 'react'
import { ART_CROP_ASPECT, HIT_TARGET_MIN, levelSpec } from './presentation.js'
import { ComboBadge, IdentityStrip, ManaValue, RoleDot } from './Badges.js'
import type { CardView } from './types.js'

export interface TileProps {
  readonly card: CardView
  /** Override the level's nominal width — mobile columns, or a dense group. */
  readonly width?: number
  readonly selected?: boolean
  readonly onActivate?: (oracleId: string) => void
}

export const Tile = ({ card, width, selected = false, onActivate }: TileProps): JSX.Element => {
  const spec = levelSpec(1)
  const w = width ?? spec.width
  const artHeight = Math.round(w * ART_CROP_ASPECT)
  const art = card.imageUris?.artCrop

  const activate = (): void => onActivate?.(card.oracleId)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // R4 and doc 08 §8.2: every pointer path has a keyboard equal. Enter and
    // Space are both bound because a div with role=button is expected to answer
    // to both, and only one of them is the browser default for a real button.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <div
      className="rt-tile"
      role="button"
      tabIndex={0}
      aria-label={tileLabel(card)}
      aria-pressed={selected}
      data-selected={selected}
      onClick={activate}
      onKeyDown={onKeyDown}
      style={{ width: w, minWidth: HIT_TARGET_MIN, minHeight: HIT_TARGET_MIN }}
    >
      <div className="rt-tile-art" style={{ height: artHeight }}>
        {art === undefined ? (
          // No art yet (ING-04 has not resolved this card, or it is an import
          // that never will). The name still has to be readable, so the strip
          // below is the fallback rather than a broken-image icon.
          <span className="rt-tile-noart" aria-hidden="true" />
        ) : (
          <img src={art} alt="" loading="lazy" width={w} height={artHeight} />
        )}
        <ComboBadge degree={card.comboDegree ?? 0} near={card.nearCombosAt1 ?? 0} />
        {/* Over the art, not below the strip: a fourth row at 72 px would cost
            more height than the dot is worth, and the strip has no room for it
            beside a name that is already truncating. */}
        {card.primaryRole === undefined ? null : <RoleDot role={card.primaryRole} />}
      </div>
      <div className="rt-tile-strip">
        <IdentityStrip colorIdentity={card.colorIdentity ?? []} />
        <span className="rt-tile-name">{card.name}</span>
        <ManaValue manaValue={card.manaValue ?? 0} />
      </div>
    </div>
  )
}

/**
 * The tile's accessible name.
 *
 * The `<img>` carries `alt=""` and this carries everything, rather than the
 * other way round: a screen reader reaching a tile should hear one sentence, not
 * an image name followed by the same name in text.
 */
export const tileLabel = (card: CardView): string => {
  const parts = [card.name, `mana value ${String(card.manaValue ?? 0)}`]
  if (card.primaryRole !== undefined) parts.push(card.primaryRole)
  const degree = card.comboDegree ?? 0
  if (degree > 0) parts.push(`completes ${String(degree)} combo${degree === 1 ? '' : 's'}`)
  return parts.join(', ')
}
