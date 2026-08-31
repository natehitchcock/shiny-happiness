import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

/**
 * Help that a touch device can actually read.
 *
 * A `title` attribute is a desktop-only feature wearing the costume of a
 * general one: no touch browser shows it, so every explanation in this app was
 * invisible on a phone. That is worse than having no help, because the
 * interface was designed as though the help existed.
 *
 * Three ways in, and they are the same content:
 *
 *   hover   — opens, closes on leave. The desktop habit.
 *   focus   — opens, closes on blur. Keyboard, and the reason the trigger is a
 *             real button rather than a span with a mouse handler.
 *   tap     — PINS it open. It then ignores mouse-leave and stays until you tap
 *             elsewhere or press Escape, because on a touch screen "leave" is
 *             not an event that happens.
 *
 * Pinning is what makes this usable rather than merely present: a tap that
 * opened a panel which vanished on the next stray touch would be worse than the
 * `title` it replaces.
 *
 * ---------------------------------------------------------------------------
 * THE PANEL LIVES IN THE TOP LAYER.
 *
 * It used to be `position: absolute` inside the trigger, and an absolutely
 * positioned box is clipped by any ancestor that scrolls. Half this app's hints
 * sit inside `.analysis-scroll`, an `overflow-y: auto` box, so they were sliced
 * off at its edges. `z-index` cannot fix that — clipping is not stacking — and
 * every new hint site had been buying its own CSS workaround (a `top: 100%`
 * here, a `right: 0` there) to dodge the particular edge it was nearest.
 *
 * So the panel is a native `popover`. Showing it promotes it to the browser's
 * top layer, which is painted above the whole document: no ancestor's
 * `overflow`, `transform`, `filter`, `contain` or stacking context reaches it.
 * That last point matters here specifically — `.region` carries
 * `container-type: inline-size`, which establishes a containing block for
 * fixed-position descendants, so `position: fixed` ALONE would not have
 * escaped. Only leaving the flow entirely does.
 *
 * REJECTED: a React portal to `document.body`. It escapes the container too,
 * but it moves the node out of this component's subtree, and the outside-click
 * dismissal below is a `rootRef.contains(target)` test — a portal turns every
 * pointerdown inside the panel into a pointerdown "outside" it, so selecting
 * the text in a hint would close it. The top layer is a rendering concept, not
 * a tree operation: the node stays exactly where it is in the DOM, `contains`
 * keeps working, and `aria-describedby` keeps pointing at a sibling rather than
 * across the document.
 *
 * `manual` rather than `auto`, deliberately. An `auto` popover light-dismisses
 * and closes on Escape inside the UA, behind React's back, which would leave
 * `pinned` saying open while the panel is shut; and `auto` popovers force each
 * other closed, so opening a second hint would silently kill the first one the
 * user pinned. We already own both gestures. We keep owning them.
 *
 * Placement is therefore JavaScript's job, since a top-layer element has no
 * relationship to its trigger's box. See `placeHint`.
 */

/** Gap between the trigger and the panel. Was `calc(100% + 6px)` in CSS. */
const GAP = 6
/** Keep-out margin from the viewport edges. */
const EDGE = 4

export interface HintAnchor {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface HintBox {
  readonly width: number
  readonly height: number
}

export interface HintViewport {
  readonly width: number
  readonly height: number
}

export interface HintPlacement {
  readonly left: number
  readonly top: number
  readonly side: 'above' | 'below'
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * Where the panel goes, in viewport coordinates.
 *
 * Pure, and exported, because this is the half of the fix that jsdom cannot
 * exercise through the DOM — it has no layout engine, so every rect it reports
 * is 0×0 and every placement assertion against real elements would be
 * vacuously true.
 *
 * Above and left-aligned by default, which is where the panel has always
 * opened. It FLIPS rather than overflowing, on both axes:
 *
 *   vertical   — a hint at the top of the pane (the composition rail) has no
 *                room above it and opens downward instead. That flip is what
 *                replaces `.comp-hint .hint-pop { top: 100% }`.
 *   horizontal — the tag hints live in a narrow right-hand pane close to the
 *                viewport's right edge, and a curve bar is an eighth of the
 *                rail wide. A left-anchored panel there runs off the screen, so
 *                it right-aligns to the trigger instead. That flip is what
 *                replaces `.curve-hint .hint-pop { right: 0 }`.
 *
 * When the panel fits on neither side of an axis the roomier side wins and the
 * result is clamped inside the viewport: a panel that is merely scrolled is
 * recoverable, a panel that is off-screen is not.
 */
export const placeHint = (
  anchor: HintAnchor,
  box: HintBox,
  viewport: HintViewport,
): HintPlacement => {
  const roomAbove = anchor.top - GAP - EDGE
  const roomBelow = viewport.height - anchor.bottom - GAP - EDGE
  const side: 'above' | 'below' =
    box.height <= roomAbove
      ? 'above'
      : box.height <= roomBelow
        ? 'below'
        : roomBelow > roomAbove
          ? 'below'
          : 'above'

  const wantedTop = side === 'above' ? anchor.top - GAP - box.height : anchor.bottom + GAP
  const top = clamp(wantedTop, EDGE, viewport.height - box.height - EDGE)

  const wantedLeft =
    anchor.left + box.width > viewport.width - EDGE ? anchor.right - box.width : anchor.left
  const left = clamp(wantedLeft, EDGE, viewport.width - box.width - EDGE)

  return { left, top, side }
}

/**
 * Is the trigger still visible inside everything that clips it?
 *
 * Walks the ancestors that scroll or clip and intersects their boxes with the
 * viewport. Used only while a panel is open and only on scroll/resize — never
 * on the initial placement, where jsdom's all-zero rects would report every
 * trigger as invisible.
 */
const stillVisible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()
  let top = 0
  let left = 0
  let right = window.innerWidth
  let bottom = window.innerHeight
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const s = window.getComputedStyle(p)
    // All three, because jsdom does not always expand the `overflow` shorthand
    // into its two axes the way a browser does.
    if (`${s.overflow} ${s.overflowX} ${s.overflowY}`.replace(/visible/g, '').trim() !== '') {
      const pr = p.getBoundingClientRect()
      top = Math.max(top, pr.top)
      left = Math.max(left, pr.left)
      right = Math.min(right, pr.right)
      bottom = Math.min(bottom, pr.bottom)
    }
  }
  return r.bottom > top && r.top < bottom && r.right > left && r.left < right
}

export interface HintProps {
  /** The thing being explained. Rendered inside a button. */
  readonly children: ReactNode
  /** The explanation. */
  readonly content: ReactNode
  /** Accessible name for the trigger, when the children are not words. */
  readonly label?: string
  readonly className?: string
}

export const Hint = ({ children, content, label, className }: HintProps): JSX.Element => {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const open = hovered || pinned

  const place = useCallback((): void => {
    const root = rootRef.current
    const pop = popRef.current
    if (root === null || pop === null) return
    const anchor = root.getBoundingClientRect()
    const box = pop.getBoundingClientRect()
    const at = placeHint(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    pop.style.left = `${at.left}px`
    pop.style.top = `${at.top}px`
    // Exposed so a stylesheet can point an arrow the right way if one is ever
    // wanted, and so tests can assert which way it flipped.
    pop.dataset['side'] = at.side
  }, [])

  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || pop === null) return

    /*
     * The `popover` attribute is set HERE, not in the JSX, and the two lines
     * are inseparable.
     *
     * `popover` on its own is not a feature, it is a promise: the UA stylesheet
     * hides `[popover]` until something calls `showPopover()`. Declaring it in
     * the markup of an environment that cannot promote it — an older browser,
     * or jsdom, which ships the UA rule but not the API — leaves the panel
     * permanently `display: none`, which is a worse bug than the clipping this
     * replaces. So the attribute is only ever claimed by the code that can
     * immediately honour it; anything else falls back to an ordinary
     * `position: fixed` box, correctly placed, and clipped only inside a
     * `container-type` ancestor.
     */
    if (typeof pop.showPopover === 'function') {
      pop.setAttribute('popover', 'manual')
      pop.showPopover()
    }
    // Layout effect, so the panel is placed before the browser paints it. In
    // the fallback branch it is `display: flex` from the moment it mounts, and
    // a passive effect would flash it at 0,0 first.
    place()

    /*
     * REPOSITION on scroll, rather than close.
     *
     * A top-layer element does not move with the pane behind it, so an open
     * panel would sit where the trigger USED to be. Closing on any scroll was
     * the other option and it is simpler, but the panel is pinned precisely so
     * it can be read, and a wheel nudge while reading a five-line explanation
     * would throw it away. Following the trigger costs two rect reads per
     * scroll event on one element.
     *
     * The pairing rule: it follows the trigger while the trigger is visible,
     * and closes the moment the trigger is clipped away. Repositioning onto a
     * trigger that has scrolled under the pane's edge would leave the panel
     * pointing at nothing, which is the failure both options exist to avoid.
     */
    const onViewportChange = (): void => {
      const root = rootRef.current
      if (root !== null && !stillVisible(root)) {
        setHovered(false)
        setPinned(false)
        return
      }
      place()
    }
    // Capture, because `scroll` does not bubble: a listener on `window` never
    // hears `.analysis-scroll`, which is the container that started all this.
    document.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open, place])

  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent): void => {
      // Still `rootRef`, and still correct: the panel is in the top layer but
      // it is not a portal, so it is genuinely a descendant of this span and a
      // pointerdown inside it — starting a text selection, say — is inside.
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setPinned(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPinned(false)
    }
    // `pointerdown`, not `click`: on touch the click arrives after a delay and
    // after scrolling, which makes a panel that closes on click feel unhooked
    // from the finger that closed it.
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span className={`hint${className === undefined ? '' : ` ${className}`}`} ref={rootRef}>
      <button
        type="button"
        className="hint-trigger"
        aria-describedby={open ? id : undefined}
        aria-expanded={pinned}
        {...(label === undefined ? {} : { 'aria-label': label })}
        onPointerEnter={(e) => {
          // Only a real mouse hovers. A touch fires pointerenter immediately
          // before the tap, and letting that open the panel would make the tap
          // that follows close it again.
          if (e.pointerType === 'mouse') setHovered(true)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHovered(false)
        }}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((v) => !v)}
      >
        {children}
      </button>
      {open ? (
        <span className="hint-pop" id={id} role="tooltip" data-pinned={pinned} ref={popRef}>
          {content}
        </span>
      ) : null}
    </span>
  )
}
