/**
 * Which physical face of a card is on screen, and what to call it (ADR-0027).
 *
 * Pure, no React, for the same reason `presentation.ts` is: two surfaces draw
 * card detail — the L3 `Detail` primitive and the workspace's `Preview`, which
 * draws through `CardFace` — and the naming rules behind a control that has to
 * announce "which face you are going to" must be ONE answer that a test can
 * assert, not two components' worth of string building.
 *
 * ## The three states this file exists to keep apart
 *
 * ADR-0027 §2. `CardView.backImageUris` is:
 *
 *   - **absent** — the card has one physical face. No flip control at all.
 *   - **present with URLs** — two faces, and we have the picture of the back.
 *   - **present with nothing in it** — two faces, no picture. The control still
 *     has to be there, because the card genuinely has another side.
 *
 * `hasBackFace` therefore tests the KEY and never the URLs. A `card.
 * backImageUris?.normal !== undefined` test would have been right about every
 * card in the corpus today — all 1,393 printings with a back face have resolved
 * art — and would still be the wrong rule, because it spells the third state
 * the same way as the first. That collapse is exactly what the database's
 * `CHECK ((image_back_art_crop IS NULL) = (image_back_normal IS NULL))` and the
 * layout gate in `packages/clients` were built to prevent, and re-introducing
 * it in the renderer would undo all of it.
 */

import type { CardSide, CardView } from './types.js'

/** Whether this card is printed on two physical faces. See the docblock above. */
export const hasBackFace = (card: CardView): boolean => card.backImageUris !== undefined

export const flipTo = (side: CardSide): CardSide => (side === 'front' ? 'back' : 'front')

/**
 * The separator Scryfall prints between two face names.
 *
 * The spaces are load-bearing. `//` on its own appears inside no card name
 * today, but matching it bare would cut any future one in half, and the
 * separator Scryfall actually publishes has always had them.
 */
const FACE_SEPARATOR = ' // '

/**
 * The two halves of a printed card name — `['Delver of Secrets', 'Insectile
 * Aberration']`.
 *
 * The face names are not on the wire as separate fields, and this is why they
 * do not need to be: for every `transform` and `modal_dfc` card Scryfall's
 * `name` is exactly `front // back`. Adding two more columns and a contract
 * change to carry what the name already states was the alternative, and it
 * would have been paying the ADR-0027 cost a second time for a string split.
 *
 * `null` for the second half when there is no separator. That is the honest
 * answer for a single-faced card, and it is also the answer for the shape the
 * corpus does not contain — a card claiming a back face whose name has no
 * `//`. `faceName` turns that into a phrase rather than into an empty label.
 *
 * `indexOf` rather than `split`, so a hypothetical three-part name keeps its
 * tail on the back face instead of silently losing it.
 */
export const faceNames = (name: string): readonly [string, string | null] => {
  const at = name.indexOf(FACE_SEPARATOR)
  if (at < 0) return [name, null]
  return [name.slice(0, at), name.slice(at + FACE_SEPARATOR.length)]
}

/**
 * What to call the side currently on screen — the `alt` text, and the label.
 *
 * GATED ON `hasBackFace`, and that gate is the whole reason this is not just
 * `faceNames(card.name)[0]`. `Fire // Ice` is ONE piece of cardboard whose
 * picture shows both halves; splitting its name would put `alt="Fire"` on an
 * image of Fire and Ice, naming half of what is on screen. Only a card with two
 * PHYSICAL faces has a face to name, which is the same rule the flip control
 * itself follows — and it was caught in a browser rather than by a test, on the
 * exact card ADR-0027 §3 names as the counter-example.
 */
export const faceName = (card: CardView, side: CardSide): string => {
  if (!hasBackFace(card)) return card.name
  const [front, back] = faceNames(card.name)
  if (side === 'front') return front
  return back ?? 'the back face'
}

const article = (side: CardSide, name: string): string =>
  name === 'the back face' ? name : `the ${side} face: ${name}`

/**
 * The flip control's accessible name — R4.
 *
 * It names the face the press will REACH, not the one on screen. A bare glyph,
 * or "Flip", tells a screen-reader user nothing about what the control does,
 * and naming the current face would tell them where they already are.
 *
 * The rejected alternative was `aria-pressed` on a toggle button with a fixed
 * name ("Flip"). ARIA's own guidance is that a toggle button's name must NOT
 * change with its state — so a toggle could never satisfy "say which face you
 * are going to". This is an action button whose name changes because the action
 * changes, which is the pattern that can.
 */
export const flipLabel = (card: CardView, side: CardSide): string => {
  const to = flipTo(side)
  return `Show ${article(to, faceName(card, to))}`
}

/**
 * What the live region says after a flip.
 *
 * The button's own name changes when it is pressed, and a screen reader on the
 * focused element usually re-announces that — usually is not always, and the
 * thing that actually changed is the picture, which announces nothing. This is
 * the sentence that says so out loud.
 */
export const shownFaceLabel = (card: CardView, side: CardSide): string =>
  `Showing ${article(side, faceName(card, side))}`
