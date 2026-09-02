import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

/**
 * The masthead's overflow menu: the tools row's growth, bounded (doc 20 A1).
 *
 * The row held Import, Export and Graph. Doc 19 added Quickbuild and doc 20
 * adds Help, which would have made it five — and ADR-0032 measured what five
 * costs: the tool line holds four controls down to a 283px masthead, each
 * further one costs about 66px, and at seven the tools wrap on every phone and
 * the two-line masthead promise is gone.
 *
 * So A1 takes the two SESSION BOOKENDS off the row. Import and Export are what
 * you do at the start and the end of a sitting; Graph, Quickbuild and Help are
 * what you reach for while building. The row keeps the working tools and grows
 * by one button rather than three, and the 1175px threshold ADR-0032 derived
 * was derived against exactly this shape — nine children, an overflow trigger
 * of 25.9px among them.
 *
 * ---------------------------------------------------------------------------
 * IT IS A MENU, NOT A DISCLOSURE.
 *
 * Hiding two working controls behind a toggle is only acceptable if what hides
 * them behaves like the thing it looks like. `DeckMenu` in this same masthead
 * is the local precedent and this follows it deliberately rather than inventing
 * a second idiom: a relatively positioned root, a trigger carrying
 * `aria-haspopup="menu"` and `aria-expanded`, a `role="menu"` popup, and
 * dismissal on Escape and on a pointer-down outside.
 *
 * Two things are added that `DeckMenu` never needed, and both are consequences
 * of this menu being the ONLY route to Import and Export:
 *
 *   arrow keys  — a `role="menu"` announces to a screen reader that Up and Down
 *                 move between items. `DeckMenu`'s items are also reachable by
 *                 Tab, so its omission was survivable; here the promise the role
 *                 makes has to be kept.
 *   focus return — closing without handing focus back leaves it on `<body>`, and
 *                 the next Tab restarts at the top of the document. That is the
 *                 same defect `closePreview` in `App.tsx` exists to prevent.
 *
 * Tab CLOSES rather than trapping. This is a menu, not a dialog: the pattern
 * says Tab leaves and carries on through the page, and a trap would strand a
 * keyboard user inside a two-item popup on the masthead.
 *
 * REJECTED: a native `<details>`/`<summary>`. It gets open/closed for free and
 * nothing else — no menu semantics, no roving focus, and a `summary` cannot
 * carry `aria-haspopup` honestly. Rejected: the top layer, which `Hint` uses.
 * The masthead has no scrolling or `container-type` ancestor to escape from, so
 * an absolutely positioned popup is not clipped here and the top layer would be
 * machinery bought for a problem this surface does not have.
 */

export interface OverflowItem {
  readonly label: string
  readonly onSelect: () => void
}

export interface OverflowMenuProps {
  readonly items: readonly OverflowItem[]
}

export const OverflowMenu = ({ items }: OverflowMenuProps): JSX.Element => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  /**
   * Close, and put focus back where it came from.
   *
   * `isConnected` is checked for the same reason `closePreview` checks it: an
   * item's handler can re-render the masthead, and focusing a detached button
   * silently drops focus to nowhere, which is the defect this exists to avoid.
   */
  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    const t = triggerRef.current
    if (restoreFocus && t !== null && t.isConnected) t.focus()
  }, [])

  // Focus the first item on open. Done in an effect rather than in the click
  // handler because the items do not exist until this render has committed.
  useEffect(() => {
    if (!open) return
    itemRefs.current[0]?.focus()
  }, [open])

  /*
   * Pointer-down outside and Escape, exactly as `DeckMenu` does it.
   *
   * Escape is on `document`, not on this component's own `onKeyDown`, and the
   * difference is not theoretical: a React handler on the root only sees events
   * whose target is inside the root, so an Escape pressed while focus had
   * drifted anywhere else left the menu open. Caught in a browser, where focus
   * was moved off the menu and Escape did nothing.
   *
   * Focus is handed back to the trigger only when it was INSIDE the menu, which
   * is the case where closing destroys the node that had it. Pulling it back
   * from wherever the reader had actually got to would be stealing it.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) close(false)
    }
    /*
     * CAPTURE, AND CONSUMED. `App.tsx` states the convention in a comment:
     * "Consumed here so the innermost open thing is the one that closes."
     * Several surfaces in this app close themselves on a document-level Escape
     * — the card preview, the target sheet, a pinned hint — and all of them
     * register in the BUBBLE phase on `document`. Capture on `document` runs
     * before every one of those, so stopping propagation here is what makes an
     * open menu the innermost thing rather than merely one of several. Without
     * it, Escape to close this menu also shuts whatever was open behind it.
     */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close(rootRef.current?.contains(document.activeElement) === true)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const focusItem = (index: number): void => {
    const count = items.length
    if (count === 0) return
    // Wrapping, both ways: a two-item menu where Down on the last item does
    // nothing reads as broken rather than as bounded.
    itemRefs.current[((index % count) + count) % count]?.focus()
  }

  const current = (): number => itemRefs.current.findIndex((el) => el === document.activeElement)

  /*
   * The roving keys only. Escape lives on `document` above, because it has to
   * work wherever focus has got to; these move focus BETWEEN the items and so
   * are only meaningful when focus is already on one.
   */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(current() + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusItem(current() - 1)
        return
      case 'Home':
        e.preventDefault()
        focusItem(0)
        return
      case 'End':
        e.preventDefault()
        focusItem(items.length - 1)
        return
      case 'Tab':
        // Not prevented: the key does its ordinary job and the menu gets out of
        // the way. Focus is NOT restored to the trigger here — that would undo
        // the Tab the user just pressed.
        close(false)
        return
      default:
    }
  }

  return (
    <div className="overflow-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="act overflow-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        // "More tools", not "More": the row above it is the tools, and a button
        // named "More" beside a deck name and a bracket chip does not say more
        // of WHAT. It is also the popup's own label, so the two agree.
        aria-label="More tools"
        title="Import and export this deck"
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {/* Three dots, and `aria-hidden` because the button is named above.
            Read out, "⋯" is either silence or "horizontal ellipsis". */}
        <span aria-hidden="true">⋯</span>
      </button>

      {open ? (
        <div className="overflow-pop" role="menu" aria-label="More tools">
          {items.map((it, i) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="overflow-item"
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              onClick={() => {
                // Close FIRST, so focus is back on the trigger before the
                // handler opens a dialog of its own and moves it somewhere
                // better. The reverse order fights whatever the item did.
                close(true)
                it.onSelect()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
