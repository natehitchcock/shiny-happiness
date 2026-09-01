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
import { CARD_ASPECT, HIT_TARGET_MIN, imageFor, levelSpec } from './presentation.js'
import { faceName } from './flip.js'
import { FaceNoArt, FlipButton, useCardSide } from './FlipButton.js'
import { ComboBadge, IdentityStrip, ManaValue, Price } from './Badges.js'
import { ManaCost } from './ManaCost.js'
import { OracleText } from './OracleText.js'
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
  const { side, touched, hasBack, flip } = useCardSide(card)
  const image = imageFor(card, 2, side)

  const activate = (): void => onActivate?.(card.oracleId)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  /*
   * A button only when there is something to activate.
   *
   * The frame used to claim `role="button"`, `tabIndex={0}` and "Open details."
   * unconditionally, which is a lie in the two places this component is now
   * used to SHOW a card rather than to offer one: the preview panel, where the
   * details are already open around it, and the commander confirmation on the
   * start screen. A keyboard user tabbing into either of those landed on a
   * control announced as a button that does nothing when pressed, which is
   * worse than no control at all.
   *
   * Spreading the props rather than writing `role={...}` with an undefined is
   * deliberate: under `exactOptionalPropertyTypes` an explicit `undefined` is
   * not the same as an absent attribute, and React renders `tabindex="0"` for a
   * numeric 0 either way.
   */
  const interactive =
    onActivate === undefined
      ? {}
      : {
          role: 'button',
          tabIndex: 0,
          'aria-label': `${card.name}. Open details.`,
          onClick: activate,
          onKeyDown,
        }

  return (
    <div className="rt-face" data-selected={selected} style={{ width: w }}>
      <div
        className="rt-face-image"
        {...interactive}
        style={{ width: w, height: h, minWidth: HIT_TARGET_MIN, minHeight: HIT_TARGET_MIN }}
      >
        {image !== null ? (
          // The wrapper above already has this exact box, so the art lands into
          // a space that was reserved for it rather than pushing the badge row
          // and the actions down as it arrives.
          //
          // `alt` names the FACE, not the card: once the picture can change
          // under a fixed panel, an alt reading "Delver of Secrets // Insectile
          // Aberration" is the one part that cannot say which side is showing.
          // For the single-faced majority `faceName` returns the whole name, so
          // nothing about them moves.
          <img
            src={image}
            alt={faceName(card, side)}
            loading="lazy"
            decoding="async"
            width={w}
            height={h}
          />
        ) : hasBack ? (
          // Two physical faces and no picture of this one (ADR-0027's third
          // state). The panel below is NOT used for it: that panel is the whole
          // card — name, cost, type, both faces' rules — and it would say the
          // same thing whichever face you were on, so the control would appear
          // to do nothing. This one names the face you are looking at, which is
          // what makes the flip visible when neither side has art.
          <FaceNoArt card={card} side={side} />
        ) : (
          // No printing resolved. The fallback is a real card-shaped panel with
          // the name and type line, not a placeholder graphic — an unresolved
          // card is still a card you may want to accept.
          <div className="rt-face-text">
            <span className="rt-face-name">{card.name}</span>
            <span className="rt-face-cost">
              <ManaCost cost={card.manaCost} />
            </span>
            <span className="rt-face-type">{card.typeLine ?? ''}</span>
            <span className="rt-face-oracle">
              <OracleText text={card.oracleText ?? ''} faces={card.oracleTextFaces} empty="" />
            </span>
          </div>
        )}
      </div>

      {/*
       * OUTSIDE `.rt-face-image`, deliberately.
       *
       * That frame takes `role="button"` when the app gives this component an
       * `onActivate`, and a real `<button>` nested inside a `role="button"` is
       * two controls claiming one region: the outer handler eats the click on
       * some assistive technology, and the tab order grows a target that
       * announces itself twice. An overlay pinned to the frame's corner was the
       * other option and was rejected for that reason as much as for having to
       * hold its contrast against whatever art is behind it — in flow, above
       * the badges, it is legible over the panel's own ground at every width.
       */}
      {hasBack ? <FlipButton card={card} side={side} touched={touched} onFlip={flip} /> : null}

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
