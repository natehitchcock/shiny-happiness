// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverflowMenu } from './OverflowMenu'

/**
 * The masthead's overflow menu (doc 20 §20.4 / A1).
 *
 * A1 moves Import and Export off the tools row so that adding Help does not
 * make it five buttons. That only works if what replaces them is a MENU — the
 * two controls have to stay reachable by keyboard and be announced as a menu,
 * or the row got shorter by hiding two features.
 *
 * `DeckMenu` is the local precedent and this follows it rather than inventing a
 * second idiom: a relatively positioned root, a trigger carrying
 * `aria-haspopup`/`aria-expanded`, a `role="menu"` popup, and dismissal on
 * Escape and on a click outside. What it adds is the part `DeckMenu` never
 * needed — arrow-key roving between items, and focus returning to the trigger —
 * because this menu is now the ONLY route to Import and Export.
 */

afterEach(cleanup)

const pair = (onImport = vi.fn(), onExport = vi.fn()) => [
  { label: 'Import', onSelect: onImport },
  { label: 'Export', onSelect: onExport },
]

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'More tools' })
const item = (name: string): HTMLElement => screen.getByRole('menuitem', { name })

/** Open it the way a click or Enter on the trigger would, and let React flush. */
const open = (): void => {
  act(() => {
    trigger().click()
  })
}

/** A key press on whatever currently has focus, which is where a real one lands. */
const press = (key: string): void => {
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, bubbles: true })
  })
}

describe('the overflow menu trigger', () => {
  it('announces itself as a menu button, closed', () => {
    render(<OverflowMenu items={pair()} />)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps its items out of the DOM until it is opened', () => {
    render(<OverflowMenu items={pair()} />)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Import' })).toBeNull()
  })

  it('opens on a click and reports it through aria-expanded', () => {
    render(<OverflowMenu items={pair()} />)
    open()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu', { name: 'More tools' })).toBeTruthy()
  })

  it('holds Import and Export as menu items, in that order', () => {
    render(<OverflowMenu items={pair()} />)
    open()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Import', 'Export'])
  })

  /*
   * The menu-button pattern: opening moves focus INTO the menu. Without it a
   * keyboard user who pressed Enter on the trigger would have the items on
   * screen and focus still on the button behind them, and the next Tab would
   * leave the menu rather than enter it.
   */
  it('moves focus to the first item when it opens', () => {
    render(<OverflowMenu items={pair()} />)
    open()
    expect(document.activeElement).toBe(item('Import'))
  })
})

describe('moving between the items with the arrow keys', () => {
  const opened = (): void => {
    render(<OverflowMenu items={pair()} />)
    open()
  }

  it('goes down the list with ArrowDown', () => {
    opened()
    press('ArrowDown')
    expect(document.activeElement).toBe(item('Export'))
  })

  it('wraps from the last item back to the first', () => {
    opened()
    press('ArrowDown')
    press('ArrowDown')
    expect(document.activeElement).toBe(item('Import'))
  })

  it('goes back up with ArrowUp, wrapping to the last item', () => {
    opened()
    press('ArrowUp')
    expect(document.activeElement).toBe(item('Export'))
  })

  it('jumps to the ends with Home and End', () => {
    opened()
    press('End')
    expect(document.activeElement).toBe(item('Export'))
    press('Home')
    expect(document.activeElement).toBe(item('Import'))
  })
})

describe('leaving the menu', () => {
  it('closes on Escape and hands focus back to the trigger', () => {
    render(<OverflowMenu items={pair()} />)
    open()
    press('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    // The half people forget. A menu that closes leaving focus on `<body>`
    // restarts the next Tab at the top of the document.
    expect(document.activeElement).toBe(trigger())
  })

  /*
   * Found in a browser, not here. Escape was handled by this component's own
   * `onKeyDown`, and a React handler on the root only sees events whose target
   * is inside the root — so an Escape pressed after focus had drifted anywhere
   * else left the menu open, with no way out but the mouse. `DeckMenu`, the
   * precedent this follows, always listened on `document`; the comment here
   * claimed the same and the code did not.
   */
  it('closes on Escape even when focus has drifted out of the menu', () => {
    render(
      <>
        <OverflowMenu items={pair()} />
        <button>Somewhere else</button>
      </>,
    )
    open()
    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' })
    elsewhere.focus()
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('menu')).toBeNull()
    // And it does NOT drag focus back to the trigger: the reader had moved on,
    // and closing a popup is not a reason to take their place in the page away.
    expect(document.activeElement).toBe(elsewhere)
  })

  /*
   * `App.tsx` states the convention in a comment: "Consumed here so the
   * innermost open thing is the one that closes." The card preview, the target
   * sheet and a pinned hint all close on a document-level Escape registered in
   * the BUBBLE phase, so an unconsumed Escape here dismissed the menu AND
   * whatever the reader had open behind it, in one key press.
   */
  it('consumes Escape, so closing the menu does not close what is behind it', () => {
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      render(<OverflowMenu items={pair()} />)
      open()
      press('Escape')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(behind).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })

  it('runs the item and closes when one is chosen, with focus back on the trigger', () => {
    const onImport = vi.fn()
    render(<OverflowMenu items={pair(onImport)} />)
    open()
    act(() => {
      item('Import').click()
    })
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on a click outside itself', () => {
    render(
      <>
        <OverflowMenu items={pair()} />
        <button>Somewhere else</button>
      </>,
    )
    open()
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  /*
   * Tab closes rather than trapping. This is a menu, not a dialog: the ARIA
   * pattern says Tab leaves it and carries on through the page, and trapping
   * here would strand a keyboard user in a two-item popup on the masthead.
   */
  it('closes on Tab and lets focus move on through the page', () => {
    render(<OverflowMenu items={pair()} />)
    open()
    press('Tab')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
