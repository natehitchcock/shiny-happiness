// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hint, placeHint } from './Hint'

/**
 * The hint panel escapes its scroll container.
 *
 * The defect: `.hint-pop` was `position: absolute` inside its trigger, and an
 * absolutely-positioned box is clipped by any ancestor that scrolls. The card
 * detail pane is one (`.analysis-scroll`, `overflow-y: auto`), so a tag hint
 * near the pane's edge was sliced off. `z-index` cannot fix that — clipping is
 * not stacking — and the codebase had accumulated one bespoke CSS workaround
 * per container to dodge it.
 *
 * The fix puts the panel in the TOP LAYER via the native `popover` attribute,
 * where no ancestor's overflow, transform, containment or stacking context
 * reaches it, and positions it from the trigger's rect in JavaScript.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom has no layout engine and no top layer: it
 * does not clip, it returns a zero rect for everything, and it does not
 * implement `showPopover`. So these tests pin the MECHANISM — that we ask for
 * the top layer, that the geometry function flips correctly, that dismissal
 * survives the move — and the clipping itself was verified in a real browser.
 */

const domRect = (r: Partial<DOMRect>): DOMRect =>
  ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...r,
  }) as DOMRect

/**
 * Give jsdom a layout, by class name.
 *
 * Every element in jsdom measures 0×0 at the origin, which would make every
 * placement assertion vacuously true. This stubs the rects the placement code
 * actually reads: the `.hint` root it anchors to, and the `.hint-pop` it is
 * moving. Returns the undo.
 */
const withLayout = (sizes: Record<string, Partial<DOMRect>>): (() => void) => {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    for (const [cls, r] of Object.entries(sizes)) {
      if (this.classList.contains(cls)) return domRect(r)
    }
    return original.call(this)
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

/** jsdom has no Popover API at all, so the component's capability check would
 *  take the fallback branch and never ask for the top layer. This installs a
 *  spy so the promotion can be observed. */
const withPopoverApi = (): { show: ReturnType<typeof vi.fn>; undo: () => void } => {
  const show = vi.fn()
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto['showPopover'] = show
  return {
    show,
    undo: () => {
      delete proto['showPopover']
    },
  }
}

const undos: (() => void)[] = []
afterEach(() => {
  cleanup()
  while (undos.length > 0) undos.pop()?.()
})

// -------------------------------------------------------------- geometry

describe('placeHint', () => {
  const viewport = { width: 1000, height: 800 }
  const box = { width: 320, height: 120 }

  it('opens upward, which is where the panel has always opened', () => {
    // The absolute version was `bottom: calc(100% + 6px)`. Same default, so a
    // hint in open space does not move when this lands.
    const p = placeHint({ top: 400, bottom: 420, left: 100, right: 160 }, box, viewport)
    expect(p.side).toBe('above')
    expect(p.top).toBe(400 - 6 - 120)
    expect(p.left).toBe(100)
  })

  it('flips below rather than opening off the top of the screen', () => {
    // The composition rail starts at the top of the pane, which is why that
    // container needed its own `top: 100%` override before this existed.
    const p = placeHint({ top: 40, bottom: 60, left: 100, right: 160 }, box, viewport)
    expect(p.side).toBe('below')
    expect(p.top).toBe(60 + 6)
  })

  it('flips to right-alignment rather than running off the right edge', () => {
    // The tag hints live in a narrow right-hand pane. A left-anchored 320px
    // panel on a trigger at x=900 would put half of it past the viewport.
    const p = placeHint({ top: 400, bottom: 420, left: 900, right: 960 }, box, viewport)
    expect(p.left).toBe(960 - 320)
    expect(p.left + box.width).toBeLessThanOrEqual(viewport.width)
  })

  it('clamps to the left edge rather than flipping the panel off the other side', () => {
    // A 320px viewport — iPhone SE, and the width AGENTS.md §3 asks UI to be
    // checked at — with a panel at its `max-width: 20rem`, which is also 320px.
    // A chip near the LEFT edge still trips the right-overflow test, so the
    // flip fires and right-alignment puts `left` at 30 - 320 = -290. Without
    // the clamp the panel is off-screen in the opposite direction, which is
    // the flip making things worse rather than better.
    const p = placeHint(
      { top: 400, bottom: 420, left: 10, right: 30 },
      { width: 320, height: 120 },
      { width: 320, height: 800 },
    )
    expect(p.left).toBeGreaterThanOrEqual(0)
  })

  it('picks the roomier side when the panel fits on neither', () => {
    // 120px tall panel, 60px above and 40px below. Neither fits; above loses
    // less of the panel, so above wins.
    const p = placeHint(
      { top: 60, bottom: 70, left: 100, right: 160 },
      { width: 320, height: 400 },
      { width: 1000, height: 130 },
    )
    expect(p.side).toBe('above')
    expect(p.top).toBeGreaterThanOrEqual(0)
  })

  it('never places the panel above the top of the viewport', () => {
    const p = placeHint(
      { top: 10, bottom: 20, left: 100, right: 160 },
      { width: 320, height: 700 },
      viewport,
    )
    expect(p.top).toBeGreaterThanOrEqual(0)
  })
})

// ------------------------------------------------------------- top layer

describe('the hint panel is promoted to the top layer', () => {
  it('carries popover="manual" and is shown through the Popover API', async () => {
    const api = withPopoverApi()
    undos.push(api.undo)

    render(<Hint content="the explanation">chip</Hint>)
    await act(async () => {
      screen.getByRole('button').focus()
    })

    const pop = document.querySelector('.hint-pop')
    expect(pop).not.toBeNull()
    // `manual`, not `auto`: an `auto` popover light-dismisses and closes on
    // Escape in the UA, behind React's back, so `pinned` would desync — and
    // `auto` popovers force each other closed, which would break opening a
    // second hint while the first is pinned.
    expect(pop?.getAttribute('popover')).toBe('manual')
    expect(api.show).toHaveBeenCalled()
  })

  it('stays a DOM descendant of its trigger, which is what keeps dismissal honest', () => {
    // The rejected alternative — a React portal to `document.body` — moves the
    // panel out of this subtree, and every `contains()` check in the component
    // then reads a click inside the panel as a click outside it. The top layer
    // is a RENDERING concept: the node does not move.
    const api = withPopoverApi()
    undos.push(api.undo)

    render(<Hint content="the explanation">chip</Hint>)
    act(() => {
      screen.getByRole('button').focus()
    })

    const root = document.querySelector('.hint')
    const pop = document.querySelector('.hint-pop')
    expect(root).not.toBeNull()
    expect(pop).not.toBeNull()
    expect(root?.contains(pop as Node)).toBe(true)
  })
})

// ------------------------------------------------------------- dismissal

describe('a pinned hint dismisses on the right pointerdowns and no others', () => {
  const openPinned = (): HTMLElement => {
    render(<Hint content={<span className="hint-line">selectable explanation</span>}>chip</Hint>)
    act(() => {
      screen.getByRole('button').click()
    })
    const pop = document.querySelector('.hint-pop')
    expect(pop).not.toBeNull()
    return pop as HTMLElement
  }

  it('survives a pointerdown INSIDE the panel', () => {
    // The trap this fix introduces if done carelessly. Selecting the text in a
    // hint starts with a pointerdown on the hint, and if that reads as
    // "outside" the panel vanishes under the cursor mid-drag.
    const api = withPopoverApi()
    undos.push(api.undo)
    const pop = openPinned()

    act(() => {
      pop
        .querySelector('.hint-line')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    })

    // `aria-expanded` reads `pinned` itself. Asserting only that a `.hint-pop`
    // is still in the document can pass for the wrong reason — if the panel
    // were moved out of React's subtree, React could no longer remove it and
    // the node would linger after the state had already closed.
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.hint-pop')).not.toBeNull()
  })

  it('closes on a pointerdown outside both the trigger and the panel', () => {
    const api = withPopoverApi()
    undos.push(api.undo)
    openPinned()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(document.querySelector('.hint-pop')).toBeNull()
  })

  it('closes on Escape, from the keyboard, with focus on the trigger (R4)', () => {
    const api = withPopoverApi()
    undos.push(api.undo)
    openPinned()

    act(() => {
      screen.getByRole('button').blur()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(document.querySelector('.hint-pop')).toBeNull()
  })
})

// ------------------------------------------------- scrolling and resizing

describe('an open panel tracks the trigger it belongs to', () => {
  it('repositions when an ancestor scrolls', () => {
    const api = withPopoverApi()
    undos.push(api.undo)
    undos.push(
      withLayout({
        hint: { top: 400, bottom: 420, left: 100, right: 160 },
        'hint-pop': { width: 200, height: 100 },
        pane: { top: 0, bottom: 700, left: 0, right: 900 },
      }),
    )

    render(
      <div style={{ overflow: 'auto' }} className="pane" data-testid="pane">
        <Hint content="the explanation">chip</Hint>
      </div>,
    )
    act(() => {
      screen.getByRole('button').click()
    })
    const pop = document.querySelector('.hint-pop') as HTMLElement
    expect(pop.style.top).toBe(`${400 - 6 - 100}px`)

    // The pane scrolls by 100px; the trigger rises with it.
    undos.push(
      withLayout({
        hint: { top: 300, bottom: 320, left: 100, right: 160 },
        'hint-pop': { width: 200, height: 100 },
        pane: { top: 0, bottom: 700, left: 0, right: 900 },
      }),
    )
    act(() => {
      // `scroll` does not bubble, so the listener has to be in the capture
      // phase on the document — a listener on `window` would never fire for a
      // scrolling `.analysis-scroll`.
      screen.getByTestId('pane').dispatchEvent(new Event('scroll'))
    })

    expect(pop.style.top).toBe(`${300 - 6 - 100}px`)
  })

  it('closes when the trigger scrolls out of its clipping ancestor', () => {
    // Repositioning is only honest while there is something to point at. A
    // panel still hanging in the top layer over a trigger that has scrolled
    // under the pane's edge is the "silently detached" failure.
    const api = withPopoverApi()
    undos.push(api.undo)
    undos.push(
      withLayout({
        hint: { top: 400, bottom: 420, left: 100, right: 160 },
        'hint-pop': { width: 200, height: 100 },
        pane: { top: 100, bottom: 700, left: 0, right: 900 },
      }),
    )

    render(
      <div style={{ overflow: 'auto' }} className="pane" data-testid="pane">
        <Hint content="the explanation">chip</Hint>
      </div>,
    )
    act(() => {
      screen.getByRole('button').click()
    })
    expect(document.querySelector('.hint-pop')).not.toBeNull()

    // Scrolled clean above the pane's top edge.
    undos.push(
      withLayout({
        hint: { top: 20, bottom: 40, left: 100, right: 160 },
        'hint-pop': { width: 200, height: 100 },
        pane: { top: 100, bottom: 700, left: 0, right: 900 },
      }),
    )
    act(() => {
      screen.getByTestId('pane').dispatchEvent(new Event('scroll'))
    })

    expect(document.querySelector('.hint-pop')).toBeNull()
  })
})
