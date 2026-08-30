import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The staged requery pipeline.
 *
 * Accepting a card has to feel instant while a recompute over ~30k candidates
 * plainly is not, so the two are decoupled. The deck changes on click; the
 * suggestions change on a schedule the user can see and outrun:
 *
 *   0%  ──▶ 25%   BUFFER   nothing has been sent yet. More clicks join this
 *                          batch, so accepting four cards is one round trip
 *                          rather than four (doc 10 §10.3 batches for exactly
 *                          this reason).
 *   25% ──▶ 50%   QUERY    commands are away and the recompute is running. The
 *                          bar HOLDS at 50% if it gets there first — it must
 *                          never suggest progress the server has not made.
 *   50% ──▶ 100%  SETTLE   the answer is in hand and deliberately not applied
 *                          for three seconds, so the list does not reshuffle
 *                          under a user who is mid-click. Anything they add in
 *                          this window restarts the cycle instead.
 *
 * The settle is three seconds measured from when the ANSWER LANDS, never from
 * when the query started. A slow recompute does not eat into it: if the server
 * takes eight seconds, the user still gets their three. Spending a shared
 * budget would mean the slowest queries — the ones after which the list moves
 * most — are exactly the ones that give no warning before it does.
 *
 * The bar is therefore honest about two different things at once: the left half
 * is work being done, the right half is time being given back.
 */

export type Phase = 'idle' | 'buffering' | 'querying' | 'settling'

/** How long clicks are collected before anything is sent. */
export const BUFFER_MS = 1_200
/** How long the answer is held so more can be added before the list moves. */
export const SETTLE_MS = 3_000
/**
 * Only used to animate 25%→50% before the server answers. A guess at a typical
 * recompute; the bar clamps at 50% regardless, so guessing low is harmless and
 * guessing high just means the bar arrives late.
 */
const ASSUMED_QUERY_MS = 700

const BUFFER_END = 0.25
const QUERY_END = 0.5

export interface Pipeline<T> {
  readonly phase: Phase
  /** 0..1, for the bar's width. */
  readonly progress: number
  /** What is happening, in words, for the line above the bar. */
  readonly label: string
  /** Queue work, joining the current buffer if one is open. */
  readonly schedule: (item: T) => void
  /** Run the pipeline with no queued work — used for filter changes. */
  readonly refresh: () => void
  readonly error: string | null
  readonly clearError: () => void
}

export interface PipelineOptions<T> {
  /**
   * Send the buffered items and fetch the new view. Whatever it resolves to is
   * held until the settle finishes and then handed to `apply`.
   */
  readonly run: (items: readonly T[]) => Promise<unknown>
  /** Commit the held result. Called once, at 100%. */
  readonly apply: (result: unknown) => void
  /**
   * Words for the buffering phase, given the items queued.
   *
   * The items, not a count: "Adding 2 cards" is wrong when one of them is a
   * rejection, and a count cannot tell the difference.
   */
  readonly describe?: (items: readonly T[]) => string
}

const now = (): number => performance.now()

export const usePipeline = <T>(options: PipelineOptions<T>): Pipeline<T> => {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<readonly T[]>([])

  // Refs, not state: the animation frame reads these every tick and must see
  // the current values without re-subscribing.
  const items = useRef<T[]>([])
  const phaseRef = useRef<Phase>('idle')
  const startedAt = useRef(0)
  const settleFrom = useRef(0)
  const result = useRef<unknown>(null)
  const resolved = useRef(false)
  /**
   * An interval, deliberately NOT requestAnimationFrame.
   *
   * rAF is paused in a background tab, so a user who switched away mid-query
   * came back to a pipeline frozen in `querying` that never applied its result
   * and never released the spinner. A state machine must not depend on the tab
   * being looked at. Chrome throttles background timers to about a second,
   * which is slow but still finishes.
   */
  const frame = useRef<ReturnType<typeof setInterval> | null>(null)
  /**
   * Zero for a filter change. The settle exists to let a user keep adding
   * before the list moves; a filter has nothing to keep adding to, and holding
   * its result back three seconds would just read as lag.
   */
  const settleMs = useRef(SETTLE_MS)
  /** Whether a result has ever been applied — see `refresh`. */
  const applied = useRef(false)
  const run = useRef(options.run)
  const apply = useRef(options.apply)
  run.current = options.run
  apply.current = options.apply

  const setPhaseBoth = (next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
  }

  const stop = useCallback((): void => {
    if (frame.current !== null) clearInterval(frame.current)
    frame.current = null
  }, [])

  const finish = useCallback((): void => {
    stop()
    setPhaseBoth('idle')
    setProgress(0)
    setQueued([])
    const held = result.current
    result.current = null
    resolved.current = false
    if (held !== null) {
      applied.current = true
      apply.current(held)
    }
  }, [stop])

  const tick = useCallback((): void => {
    const elapsed = now() - startedAt.current

    if (phaseRef.current === 'buffering') {
      const fraction = Math.min(1, elapsed / BUFFER_MS)
      setProgress(fraction * BUFFER_END)
      if (fraction >= 1) {
        // Buffer closed. Send everything collected in one batch.
        const batch = items.current
        items.current = []
        setPhaseBoth('querying')
        startedAt.current = now()
        resolved.current = false
        void run
          .current(batch)
          .then((value) => {
            result.current = value
            resolved.current = true
          })
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : 'Could not refresh suggestions')
            result.current = null
            resolved.current = true
          })
      }
    } else if (phaseRef.current === 'querying') {
      const fraction = Math.min(1, elapsed / ASSUMED_QUERY_MS)
      const value = BUFFER_END + fraction * (QUERY_END - BUFFER_END)
      // Clamped at the halfway mark until the server actually answers: the bar
      // may run out of animation but it may not run ahead of the truth.
      setProgress(Math.min(value, QUERY_END))
      // Settle starts here, and `startedAt` is reset here, which is what makes
      // the three seconds count from the answer rather than from the request.
      // The second condition is what holds a fast answer back until the bar has
      // actually reached 50%, so it does not jump.
      if (resolved.current && fraction >= 1) {
        setPhaseBoth('settling')
        startedAt.current = now()
        settleFrom.current = QUERY_END
      }
    } else if (phaseRef.current === 'settling') {
      const fraction = settleMs.current === 0 ? 1 : Math.min(1, elapsed / settleMs.current)
      setProgress(settleFrom.current + fraction * (1 - settleFrom.current))
      if (fraction >= 1) {
        finish()
        return
      }
    }
  }, [finish])

  /**
   * `skipBuffer` is for a run with nothing to batch.
   *
   * The buffer exists to collect CLICKS. An initial load or a filter change has
   * none, and making the first paint wait 1.2 s for a window that can never fill
   * leaves the deck rail reading "Loading…" for no reason at all.
   */
  const start = useCallback(
    (withSettle: boolean, skipBuffer = false): void => {
      settleMs.current = withSettle ? SETTLE_MS : 0
      stop()
      setProgress(0)
      result.current = null
      resolved.current = false
      startedAt.current = now()

      if (skipBuffer) {
        setPhaseBoth('querying')
        void run
          .current([])
          .then((value) => {
            result.current = value
            resolved.current = true
          })
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : 'Could not refresh suggestions')
            result.current = null
            resolved.current = true
          })
      } else {
        setPhaseBoth('buffering')
      }

      // ~60 fps while visible; throttled but still running when not.
      frame.current = setInterval(tick, 16)
    },
    [stop, tick],
  )

  const schedule = useCallback(
    (item: T): void => {
      items.current = [...items.current, item]
      setQueued(items.current)
      setError(null)

      // Inside the buffer this just joins the batch and the bar keeps running.
      // Anywhere later the held answer is already stale, so the cycle restarts —
      // which is what "any additional add after the halfway point re-kicks the
      // query" means, and it is equally true mid-query.
      if (phaseRef.current !== 'buffering') start(true)
    },
    [start],
  )

  /**
   * A refresh applies as soon as the answer lands. No settle.
   *
   * The settle exists for ONE reason: after an accept, the list is about to
   * reshuffle under someone who is still clicking, so they get three seconds of
   * warning and a chance to add more first. A filter run is the opposite
   * situation — the user asked for the list to change and is waiting for it.
   *
   * This was briefly the other way round, and the result was a filter that took
   * about seven seconds to visibly do anything: a real query over the pool is
   * slow enough on its own without three seconds of deliberate delay on the end
   * of it. Waiting to protect someone from a change they requested is not
   * courtesy, it is lag.
   *
   * The settle's own fix stands untouched — for an accept it is still measured
   * from when the answer lands, never from when the request left.
   */
  const refresh = useCallback((): void => {
    setQueued([])
    items.current = []
    start(false, true)
  }, [start])

  useEffect(() => stop, [stop])

  const label =
    options.describe?.(queued) ??
    (phase === 'buffering'
      ? queued.length > 0
        ? `Adding ${String(queued.length)} card${queued.length === 1 ? '' : 's'}…`
        : 'Preparing…'
      : phase === 'querying'
        ? 'Recomputing suggestions…'
        : phase === 'settling'
          ? 'Ready — add more, or wait to refresh'
          : '')

  return {
    phase,
    progress,
    label,
    schedule,
    refresh,
    error,
    clearError: () => setError(null),
  }
}
