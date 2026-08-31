/**
 * The deck web's view transform: where the drawing sits, and how big.
 *
 * Pulled out of DeckWeb.tsx as plain functions rather than left inline in the
 * `setView` callers, because "the card under the cursor stays under the cursor"
 * is a property of the arithmetic and can be asserted directly here. A
 * component test can only ask whether the transform attribute changed; it
 * cannot easily ask whether a point held still, which is the entire feature.
 *
 * Everything below works in CANVAS units — the SVG's own viewBox space, the
 * space `view.x`, `view.y` and the node positions are already in. That is NOT
 * client pixels: the viewBox is around 2600 units wide inside a pane that might
 * be 900 px, so a client pixel is roughly three canvas units. Mixing the two is
 * the bug this module exists to prevent, so client coordinates enter through
 * `canvasPoint`/`canvasVector` and never any other way.
 */

export interface View {
  readonly x: number
  readonly y: number
  readonly scale: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** The part of a `DOMRect` this file needs, so a test can pass a literal. */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4

const clamp = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * How many client pixels one canvas unit draws as, under
 * `preserveAspectRatio="xMidYMid meet"`.
 *
 * `meet` fits the WHOLE viewBox inside the element, so the factor is the
 * smaller of the two ratios and the surplus on the other axis becomes an even
 * band at each end. Zero when there is nothing to measure — jsdom, or a pane
 * that has not been laid out yet — which callers read as "no measurement" and
 * answer for themselves.
 */
const fit = (rect: Rect, canvas: Size): number =>
  rect.width < 1 || rect.height < 1 || canvas.width < 1 || canvas.height < 1
    ? 0
    : Math.min(rect.width / canvas.width, rect.height / canvas.height)

/**
 * A client point — a cursor, a fingertip — in canvas units.
 *
 * Three corrections, and every one of them has been shipped missing by someone:
 * the pane's offset from the page origin (the graph sits inside a padded
 * section, so `clientX` is not an offset into the drawing), the viewBox scale
 * (a client pixel is not a canvas unit), and the letterbox band `meet` leaves
 * on whichever axis has surplus (the canvas aspect is quantised to a tenth, so
 * there is nearly always a band on one axis).
 *
 * `getScreenCTM().inverse()` would do all three and was the first choice. It is
 * rejected because jsdom does not implement it, which would put the one piece
 * of arithmetic most likely to be wrong beyond the reach of every test in the
 * repository — and it is four lines of algebra that `preserveAspectRatio`
 * already pins down exactly.
 */
export const canvasPoint = (client: Point, rect: Rect, canvas: Size): Point => {
  const scale = fit(rect, canvas)
  // Nothing to measure against. The canvas centre is the honest answer: it is
  // where the buttons zoom from anyway, so an unmeasurable pane behaves like a
  // button press rather than lurching to a corner.
  if (scale === 0) return { x: canvas.width / 2, y: canvas.height / 2 }
  return {
    x: (client.x - rect.left - (rect.width - canvas.width * scale) / 2) / scale,
    y: (client.y - rect.top - (rect.height - canvas.height * scale) / 2) / scale,
  }
}

/**
 * A client DISTANCE in canvas units — a drag, a finger travelling.
 *
 * Separate from `canvasPoint` because a distance has no origin: subtracting the
 * pane's offset or the letterbox band from it would be wrong twice over. One
 * unit per pixel when the pane cannot be measured, since with no scale to apply
 * the only options are "unchanged" and "invented".
 */
export const canvasVector = (client: Point, rect: Rect, canvas: Size): Point => {
  const scale = fit(rect, canvas)
  if (scale === 0) return { x: client.x, y: client.y }
  return { x: client.x / scale, y: client.y / scale }
}

/**
 * Scale to `target`, holding `at` still.
 *
 * Under `translate(x y) scale(s)` a canvas point `c` draws at `x + c·s`, so
 * holding the point currently under `at` requires
 *
 *     x' = at − (at − x) · (s'/s)
 *
 * The ratio is taken from the CLAMPED scale, not the requested one. That is the
 * difference between a wheel that stops at the limit and one that looks stopped
 * while sliding the graph a little further off on every further notch — the
 * scale is pinned but the translate is not, and the drift is silent because
 * nothing about the number 4 changes.
 */
export const zoomTo = (view: View, target: number, at: Point): View => {
  const scale = clamp(target)
  const ratio = scale / view.scale
  return {
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
    scale,
  }
}

/** `zoomTo` for the callers that think in notches rather than absolute scale. */
export const zoomBy = (view: View, factor: number, at: Point): View =>
  zoomTo(view, view.scale * factor, at)

/**
 * A pinch: scale to `target` while the fingers travel from `from` to `to`.
 *
 * Anchoring at the OLD midpoint and then translating by the midpoint's travel,
 * rather than anchoring at the new one. Both are within a pixel per event and
 * neither is noticeable in isolation, but only this order is exact — it is what
 * makes a two-finger drag with a constant gap pan the graph and nothing else,
 * which anchoring at the live midpoint alone does not do at all.
 */
export const pinchTo = (view: View, target: number, from: Point, to: Point): View => {
  const zoomed = zoomTo(view, target, from)
  return { ...zoomed, x: zoomed.x + (to.x - from.x), y: zoomed.y + (to.y - from.y) }
}
