import { useEffect, useRef, useState } from 'react'

/**
 * Run the filter on its own if the user stops adjusting it.
 *
 * The filter box stopped querying per keystroke when the magnifying glass
 * arrived — a query is expensive and firing one per character was worse. That
 * left a real cost though: you can type a filter, look at the screen, and see
 * nothing happen, with no indication that anything is waiting on you. This is
 * the middle setting. You still get to finish typing; you do not have to know
 * that a button exists.
 *
 * Two seconds. Long enough to keep typing a card name through, short enough
 * that waiting it out is never a decision — at ten it plainly was, and people
 * sat watching a ring instead of working.
 *
 * Still not a debounce: a debounce fires ~400 ms after the last keystroke and
 * would defeat the point of having made querying explicit. This is a safety net
 * for someone who did not notice the button.
 */
export const AUTO_QUERY_MS = 2_000

export interface AutoQueryState {
  readonly enabled: boolean
  /** What is in the box right now. */
  readonly draft: string
  /** What the last query actually ran with. */
  readonly committed: string
}

/**
 * Whether a countdown should be running.
 *
 * Compares trimmed, because a trailing space is not an adjustment worth a
 * query — and because the run button trims too, so a countdown that fired on
 * `"t:creature "` would commit `"t:creature"` and then believe there was still
 * something pending.
 */
export const shouldWait = ({ enabled, draft, committed }: AutoQueryState): boolean =>
  enabled && draft.trim() !== committed.trim()

/** Whole seconds still to wait, for the label a screen reader reads. */
export const secondsLeft = (elapsedMs: number): number =>
  Math.max(0, Math.ceil((AUTO_QUERY_MS - elapsedMs) / 1000))

export interface AutoQuery {
  /** True while a countdown is running. */
  readonly active: boolean
  /** Whole seconds remaining, or null when nothing is pending. */
  readonly remaining: number | null
}

/**
 * The countdown itself.
 *
 * The ring is drawn by CSS from `active` and a `key`, not by this hook ticking
 * at 60 fps — a ten-second animation redrawn from JavaScript is a lot of wasted
 * frames for one circle. What the interval here is for is the *label*: once a
 * second, so the accessible name says how long is left. Ten updates, not six
 * hundred.
 */
export const useAutoQuery = (state: AutoQueryState, onFire: () => void): AutoQuery => {
  const active = shouldWait(state)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Kept in a ref so a new `onFire` identity on every render does not restart
  // the countdown — which would mean it never finished.
  const fire = useRef(onFire)
  fire.current = onFire

  useEffect(() => {
    if (!active) {
      setRemaining(null)
      return
    }
    const startedAt = Date.now()
    setRemaining(secondsLeft(0))

    const tick = setInterval(() => setRemaining(secondsLeft(Date.now() - startedAt)), 1_000)
    const timeout = setTimeout(() => {
      clearInterval(tick)
      setRemaining(null)
      fire.current()
    }, AUTO_QUERY_MS)

    return () => {
      clearInterval(tick)
      clearTimeout(timeout)
    }
    // `draft` is a dependency in its own right: editing the box restarts the
    // wait, which is the whole "if they don't make any adjustments" rule.
  }, [active, state.draft])

  return { active, remaining }
}
