/**
 * The control that turns a double-faced card over, and what it shows when there
 * is a second side but no picture of it (ADR-0027).
 *
 * ## Why this is three small pieces and not one `<CardArt>`
 *
 * Two surfaces draw card detail: the L3 `Detail` primitive, visible at
 * `#gallery`, and the workspace's `Preview`, which draws its picture through
 * `CardFace`. The metrics work put ONE shared component in both rather than two
 * implementations, and that precedent is what is followed here — but the seam
 * is not the same one. `CardMetrics` owns a whole block of layout; the picture
 * does not, because the two surfaces box it differently on purpose:
 * `.rt-face-image` is a fixed frame that reserves the art's exact box before it
 * loads, and `.rt-detail-image` is `max-width: 100%; height: auto` so a 21rem
 * panel can be narrower than the nominal L3 width. A component that owned the
 * box would have had to be told which of those to be.
 *
 * So what is shared is the part that would otherwise be duplicated and drift:
 * the state machine (`useCardSide`), the control and its accessible name
 * (`FlipButton`), and the honest panel for the third state (`FaceNoArt`). Each
 * surface keeps its own box and drops these in — three lines each.
 *
 * ## What flipping does NOT do
 *
 * It does not touch the rules text. `OracleText` already draws both faces at
 * once with the boundary marked, and it announces "Other face:" in place for a
 * screen reader — the text half has been right since before this control
 * existed. Flipping it too would REMOVE information the reader has today and
 * turn a viewer into a filter: someone comparing what Delver of Secrets does
 * with what Insectile Aberration does would have to press a button between the
 * two halves of one comparison. The picture flips because an `<img>` can only
 * hold one face at a time; the text does not, because it has no such limit.
 */

import { useState, type JSX } from 'react'
import { faceName, flipLabel, flipTo, hasBackFace, shownFaceLabel } from './flip.js'
import { HIT_TARGET_MIN } from './presentation.js'
import type { CardSide, CardView } from './types.js'

export interface CardSideState {
  /** The physical face on screen. Always `'front'` for a single-faced card. */
  readonly side: CardSide
  /** Whether the user has pressed the control for THIS card. See `FlipButton`. */
  readonly touched: boolean
  readonly hasBack: boolean
  readonly flip: () => void
}

/**
 * Which face is showing, reset when the surface moves to a different card.
 *
 * THE RESET IS DELIBERATE. A card left flipped while you browse to another is a
 * bug rather than a feature, for three reasons that all point the same way:
 * the front IS the card (ADR-0027 §1) and is what the panel's own header names,
 * so a picture of the back under a heading naming the front is a panel
 * disagreeing with itself; and "flipped" cannot be a stable preference anyway,
 * because nine cards in ten have no back to hold it — the mode would evaporate
 * silently on the next single-faced card and reappear on the one after.
 *
 * Adjusted DURING render rather than in an effect. An effect would paint the
 * new card's back face for one frame before correcting itself, which is the
 * flash this pattern exists to avoid; React's own answer to state that depends
 * on a prop is a render-phase `setState`, which it re-runs immediately without
 * ever committing the stale output.
 *
 * The `setState` is the load-bearing half, and it is the one easy to leave out.
 * Without it the stale entry survives untouched and reappears the moment its
 * own card does, so browsing away and back returns to a card still showing its
 * back — the exact bug the reset exists to prevent, by a longer route. It takes
 * THREE renders to see, which is why the tests that pin it open a second card
 * in between; a one-step rerender cannot tell the two versions apart.
 *
 * `current` is belt and braces, and deliberately so even though no test can
 * distinguish it: React discards the render that triggered the update, so
 * reading `state` directly would also be correct — by React's re-render
 * guarantee rather than by anything this function does. `useCardSide` is
 * exported, and a hook whose return value agrees with its own argument is a
 * contract worth keeping locally true rather than borrowing from the
 * scheduler's behaviour.
 */
export const useCardSide = (card: CardView): CardSideState => {
  const [state, setState] = useState<{ id: string; side: CardSide; touched: boolean }>({
    id: card.oracleId,
    side: 'front',
    touched: false,
  })
  const fresh = { id: card.oracleId, side: 'front' as CardSide, touched: false }
  const stale = state.id !== card.oracleId
  if (stale) setState(fresh)
  const current = stale ? fresh : state
  return {
    side: current.side,
    touched: current.touched,
    hasBack: hasBackFace(card),
    flip: () => setState({ id: card.oracleId, side: flipTo(current.side), touched: true }),
  }
}

export interface FlipButtonProps {
  readonly card: CardView
  /** The face on screen now. The button names the OTHER one. */
  readonly side: CardSide
  /** From `useCardSide`. Gates the live region — see below. */
  readonly touched: boolean
  readonly onFlip: () => void
}

/**
 * A real `<button>`, and that is the accessibility answer rather than a detail.
 *
 * `Tile` has to hand-roll `role="button"` and an `onKeyDown` because the target
 * is the whole tile. Nothing forces that here, and a control that CAN be a
 * button should be: Enter and Space, the focus ring, the disabled semantics and
 * the announcement as a button all come from the element, and every hand-rolled
 * version of that list eventually drops one of them.
 *
 * The visible text is the destination face's NAME and the accessible name is
 * the whole sentence that contains it — "Show the back face: Insectile
 * Aberration". Two constraints meet there: R4 wants a name that says which face
 * you are going to, and WCAG 2.5.3 wants the visible words to be a substring of
 * the accessible name so speech control can hit the control by reading it.
 *
 * The live region is empty until `touched`, because a `role="status"` that
 * already has content when it is inserted is announced on insertion by some
 * screen readers — which would greet every double-faced card with a sentence
 * nobody asked for. After a press it carries the face that is now on screen,
 * because the thing that actually changed is the picture and a picture
 * announces nothing.
 */
export const FlipButton = ({ card, side, touched, onFlip }: FlipButtonProps): JSX.Element => (
  <>
    <button
      type="button"
      className="rt-flip"
      aria-label={flipLabel(card, side)}
      onClick={onFlip}
      // doc 08 §8.3. Inline, from the constant, rather than a `44px` in the
      // stylesheet that no test could tie back to the rule it comes from.
      style={{ minHeight: HIT_TARGET_MIN }}
    >
      {/* Decoration. The name beside it is what the control is called, and a
          screen reader reading "left right arrow Insectile Aberration" would be
          reading punctuation aloud. */}
      <span className="rt-flip-glyph" aria-hidden="true">
        ⇄
      </span>
      <span className="rt-flip-name">{faceName(card, flipTo(side))}</span>
    </button>
    <span className="rt-sr" role="status" aria-live="polite">
      {touched ? shownFaceLabel(card, side) : ''}
    </span>
  </>
)

/**
 * Two faces, no picture of this one — the third state of ADR-0027.
 *
 * Not a broken image and not nothing. `<img src="">` re-requests the page and
 * draws it broken, and rendering nothing would make this card look exactly like
 * a card with one face, which is the collapse the whole encoding exists to
 * prevent. So the panel says which face you are on and that there is no picture
 * of it — the same shape as `CardFace`'s no-art fallback, which is a readable
 * card-shaped panel rather than a placeholder graphic.
 *
 * The face's own rules text was the rejected addition. Both surfaces that mount
 * this already print the full oracle text, both faces, a few lines below; a
 * copy of half of it inside the picture's box would be the same words twice in
 * one small panel.
 */
export const FaceNoArt = ({ card, side }: { card: CardView; side: CardSide }): JSX.Element => (
  <div className="rt-noart">
    <span className="rt-noart-name">{faceName(card, side)}</span>
    <span className="rt-noart-say">No picture of this face.</span>
  </div>
)
