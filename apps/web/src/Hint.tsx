import { useEffect, useId, useRef, useState } from 'react'
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
 */

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
  const id = useId()
  const open = hovered || pinned

  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent): void => {
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
        <span className="hint-pop" id={id} role="tooltip" data-pinned={pinned}>
          {content}
        </span>
      ) : null}
    </span>
  )
}
