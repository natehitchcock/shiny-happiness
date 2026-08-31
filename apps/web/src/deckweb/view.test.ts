import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, canvasPoint, canvasVector, pinchTo, zoomBy } from './view'

/**
 * The view transform, on its own.
 *
 * These are the sums behind "zoom where I am pointing". They are here rather
 * than only in DeckWeb.test.tsx because the component test can only ask whether
 * the transform attribute changed; this can ask whether the point under the
 * cursor actually held still, which is the whole property.
 *
 * Every fixture below is deliberately ASYMMETRIC — an off-centre anchor, a
 * non-square canvas, a pane that is offset from the page origin and letterboxed
 * on one axis. A zoom anchored at the exact centre of a square viewport is
 * arithmetically indistinguishable from one anchored at the origin, so a
 * symmetric fixture would pass against the bug this file exists to pin.
 */

/** A pane inset from the page origin, in a browser that is not a square. */
const RECT = { left: 137, top: 89, width: 800, height: 400 }

/**
 * A canvas wider than the pane's proportions, so `xMidYMid meet` has something
 * to letterbox: 800/3200 = 0.25 against 400/1400 = 0.2857, so the fit is 0.25,
 * the drawing is 350 tall inside 400, and 25 units of empty band sit above and
 * below it. A canvas that matched the pane exactly would let a missing
 * letterbox term pass unnoticed.
 */
const CANVAS = { width: 3200, height: 1400 }

/** Where a canvas point lands on screen under a given view. */
const screenX = (view: { x: number; scale: number }, at: number): number => view.x + at * view.scale
const screenY = (view: { y: number; scale: number }, at: number): number => view.y + at * view.scale

describe('mapping a client point into the canvas (the bit that is easy to get wrong)', () => {
  it('accounts for the pane’s offset from the page origin', () => {
    // The top-left of the DRAWING: the pane's own corner, plus the 25-unit
    // letterbox band that `meet` puts above it.
    expect(canvasPoint({ x: 137, y: 89 + 25 }, RECT, CANVAS)).toEqual({ x: 0, y: 0 })
  })

  it('accounts for the letterbox and the viewBox scale together', () => {
    const far = canvasPoint({ x: 137 + 800, y: 89 + 25 + 350 }, RECT, CANVAS)
    expect(far.x).toBeCloseTo(3200, 6)
    expect(far.y).toBeCloseTo(1400, 6)
  })

  it('is not a pixel count: a client pixel is four canvas units here', () => {
    // 200 px right of the pane's left edge is 800 canvas units in, because the
    // canvas is 3200 wide in an 800 px pane. Treating client pixels as canvas
    // units is the same class of mistake as forgetting the offset, and it is
    // the one that survives a pane which happens to fill the window.
    const p = canvasPoint({ x: 137 + 200, y: 89 + 25 + 100 }, RECT, CANVAS)
    expect(p.x).toBeCloseTo(800, 6)
    expect(p.y).toBeCloseTo(400, 6)
  })

  it('falls back to the canvas centre when the pane cannot be measured', () => {
    // jsdom, and a pane that has not been laid out yet. "No measurement" is not
    // "a pane of no size", and a zoom still has to do something sensible — the
    // centre is what the buttons use anyway.
    expect(
      canvasPoint({ x: 400, y: 300 }, { left: 0, top: 0, width: 0, height: 0 }, CANVAS),
    ).toEqual({ x: 1600, y: 700 })
  })

  it('converts a drag distance without the offset, because a distance has none', () => {
    expect(canvasVector({ x: 200, y: 100 }, RECT, CANVAS)).toEqual({ x: 800, y: 400 })
  })

  it('leaves a drag distance alone when the pane cannot be measured', () => {
    // One unit per pixel is the only honest guess with nothing to scale by.
    expect(
      canvasVector({ x: 40, y: 30 }, { left: 0, top: 0, width: 0, height: 0 }, CANVAS),
    ).toEqual({ x: 40, y: 30 })
  })
})

describe('zooming about a point', () => {
  const view = { x: -311, y: 57, scale: 1.4 }
  const anchor = { x: 1234, y: 301 }

  it('holds the anchored point still while zooming in', () => {
    const next = zoomBy(view, 1.25, anchor)
    // The canvas point that was under the anchor before...
    const at = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale }
    // ...is under it after.
    expect(screenX(next, at.x)).toBeCloseTo(anchor.x, 6)
    expect(screenY(next, at.y)).toBeCloseTo(anchor.y, 6)
    expect(next.scale).toBeCloseTo(1.75, 6)
  })

  it('holds the anchored point still while zooming out', () => {
    const next = zoomBy(view, 0.8, anchor)
    const at = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale }
    expect(screenX(next, at.x)).toBeCloseTo(anchor.x, 6)
    expect(screenY(next, at.y)).toBeCloseTo(anchor.y, 6)
  })

  it('moves the translate at all — the bug was that it did not', () => {
    const next = zoomBy(view, 1.25, anchor)
    expect(next.x).not.toBeCloseTo(view.x, 6)
    expect(next.y).not.toBeCloseTo(view.y, 6)
  })

  it('anchors on the point it was given, not on the canvas origin', () => {
    // Two different anchors must give two different translates. Anchoring at
    // the origin (the bug) gives the same answer for both.
    const a = zoomBy(view, 1.25, { x: 100, y: 900 })
    const b = zoomBy(view, 1.25, { x: 2400, y: 120 })
    expect(a.x).not.toBeCloseTo(b.x, 6)
    expect(a.y).not.toBeCloseTo(b.y, 6)
  })
})

describe('the limits, where a drifting view is the classic bug', () => {
  it('goes no further in than the maximum', () => {
    expect(zoomBy({ x: 10, y: 20, scale: MAX_SCALE }, 1.25, { x: 900, y: 400 }).scale).toBe(
      MAX_SCALE,
    )
  })

  it('goes no further out than the minimum', () => {
    expect(zoomBy({ x: 10, y: 20, scale: MIN_SCALE }, 0.8, { x: 900, y: 400 }).scale).toBe(
      MIN_SCALE,
    )
  })

  it('does not creep when the wheel keeps turning at the maximum', () => {
    // The failure this pins: computing the translate from the REQUESTED ratio
    // rather than the clamped one. The scale stops, so the view looks locked,
    // but every further notch slides the graph a little further off. Ten
    // notches is enough to see it and small enough to read.
    const at = { x: 2900, y: 130 }
    let view = { x: -640, y: 210, scale: MAX_SCALE }
    for (let i = 0; i < 10; i += 1) view = zoomBy(view, 1.1, at)
    expect(view).toEqual({ x: -640, y: 210, scale: MAX_SCALE })
  })

  it('does not creep when the wheel keeps turning at the minimum', () => {
    const at = { x: 2900, y: 130 }
    let view = { x: -640, y: 210, scale: MIN_SCALE }
    for (let i = 0; i < 10; i += 1) view = zoomBy(view, 0.9, at)
    expect(view).toEqual({ x: -640, y: 210, scale: MIN_SCALE })
  })

  it('holds the anchor still on the notch that is PARTLY clamped', () => {
    // 3.8 × 1.25 asks for 4.75 and gets 4. The step is real but smaller than
    // the one requested, and the translate has to match the step that actually
    // happened or the graph jumps on the last notch before the limit.
    const view = { x: -311, y: 57, scale: 3.8 }
    const anchor = { x: 1234, y: 301 }
    const next = zoomBy(view, 1.25, anchor)
    expect(next.scale).toBe(MAX_SCALE)
    const at = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale }
    expect(screenX(next, at.x)).toBeCloseTo(anchor.x, 6)
    expect(screenY(next, at.y)).toBeCloseTo(anchor.y, 6)
  })
})

describe('pinch, which zooms and pans at once', () => {
  it('keeps the card under the fingers under the fingers as they move and spread', () => {
    const view = { x: -311, y: 57, scale: 1.4 }
    const from = { x: 900, y: 500 }
    const to = { x: 1150, y: 380 }
    const at = { x: (from.x - view.x) / view.scale, y: (from.y - view.y) / view.scale }
    const next = pinchTo(view, 2.1, from, to)
    expect(next.scale).toBe(2.1)
    expect(screenX(next, at.x)).toBeCloseTo(to.x, 6)
    expect(screenY(next, at.y)).toBeCloseTo(to.y, 6)
  })

  it('pans on two fingers that move without spreading', () => {
    const view = { x: -311, y: 57, scale: 1.4 }
    const next = pinchTo(view, 1.4, { x: 900, y: 500 }, { x: 1150, y: 380 })
    expect(next).toEqual({ x: -311 + 250, y: 57 - 120, scale: 1.4 })
  })

  it('clamps the target scale like every other way in', () => {
    const view = { x: -311, y: 57, scale: 1.4 }
    const at = { x: 900, y: 500 }
    expect(pinchTo(view, 99, at, at).scale).toBe(MAX_SCALE)
    expect(pinchTo(view, 0.01, at, at).scale).toBe(MIN_SCALE)
  })

  it('does not creep when the fingers keep spreading at the maximum', () => {
    let view = { x: -640, y: 210, scale: MAX_SCALE }
    const at = { x: 2900, y: 130 }
    for (let i = 0; i < 10; i += 1) view = pinchTo(view, MAX_SCALE * 1.5, at, at)
    expect(view).toEqual({ x: -640, y: 210, scale: MAX_SCALE })
  })
})
