// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUFFER_MS, SETTLE_MS, usePipeline } from './pipeline.js'

/**
 * The staged requery pipeline had no tests, which is how the settle came to be
 * measured from the wrong moment on one of its two paths.
 *
 * `performance.now` is faked alongside the timers: the pipeline reads elapsed
 * time from it, so advancing timers without advancing the clock would tick the
 * interval while every phase believed no time had passed.
 */
let clock = 0

beforeEach(() => {
  clock = 0
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  cleanup()
})

/**
 * Long enough for the bar to finish its 25%→50% run.
 *
 * The pipeline will not begin settling until it gets there, however fast the
 * server was, so a bar that arrived early does not jump. `ASSUMED_QUERY_MS` is
 * private to the module, so this is its budget plus slack rather than an import.
 */
const BAR_TO_HALFWAY = 500

const advance = (ms: number): void => {
  // In 16 ms steps, the way the interval actually fires — a single jump would
  // let a phase transition and its successor share one tick.
  const step = 16
  for (let moved = 0; moved < ms; moved += step) {
    const delta = Math.min(step, ms - moved)
    clock += delta
    act(() => void vi.advanceTimersByTime(delta))
  }
}

interface Harness {
  readonly applied: unknown[]
  /** Resolve the in-flight run and let its `.then` actually run. */
  readonly resolve: () => Promise<void>
}

const setup = (): { hook: ReturnType<typeof renderHook>; harness: Harness } => {
  const applied: unknown[] = []
  let release: (() => void) | null = null
  const hook = renderHook(() =>
    usePipeline<string>({
      run: () =>
        new Promise((resolveRun) => {
          release = () => resolveRun('RESULT')
        }),
      apply: (value) => applied.push(value),
    }),
  )
  return {
    hook,
    harness: {
      applied,
      resolve: async () => {
        // Fake timers do not touch the microtask queue, so advancing them is
        // not enough — the run's `.then` has to be awaited or the next tick
        // reads `resolved` as still false.
        await act(async () => {
          release?.()
          await Promise.resolve()
        })
      },
    },
  }
}

describe('the settle is measured from when the answer lands', () => {
  it('gives a slow query its full settle afterwards', async () => {
    // The bug: a query slower than the settle used to leave nothing of it, so
    // the list moved the instant the answer arrived — on exactly the queries
    // after which it moves the most.
    const { hook, harness } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(BUFFER_MS + 32)
    expect(result.current.phase).toBe('querying')

    // Eight seconds of server time — well past the three-second settle.
    advance(8_000)
    expect(result.current.phase).toBe('querying')
    expect(harness.applied).toEqual([])

    await harness.resolve()
    advance(32)
    expect(result.current.phase).toBe('settling')

    // Still nothing applied most of the way through — expressed as a fraction
    // of SETTLE_MS so changing that constant needs no edit here.
    advance(SETTLE_MS * 0.5)
    expect(harness.applied).toEqual([])
    advance(SETTLE_MS * 0.3)
    expect(harness.applied).toEqual([])
    // The whole of it, counted from the answer rather than from the request.
    advance(SETTLE_MS * 0.4)
    expect(harness.applied).toEqual(['RESULT'])
  })

  it('never runs the bar past halfway before the server answers', async () => {
    const { hook, harness } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(BUFFER_MS + 32)
    advance(5_000)
    // The bar may run out of animation, but it may not run ahead of the truth.
    expect(result.current.progress).toBeCloseTo(0.5, 2)
    expect(harness.applied).toEqual([])
  })
})

describe('refresh', () => {
  it('applies the first load without a settle', async () => {
    // Nothing is on screen yet, so there is nothing to reshuffle under anyone.
    // Holding the first paint for three seconds is lag, not courtesy.
    //
    // "Without a settle" is not "instantly": the bar still finishes its run to
    // the halfway mark before anything is applied, so it does not jump. That is
    // sub-second, against the settle's three.
    const { hook, harness } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.refresh())
    advance(32)
    await harness.resolve()
    advance(BAR_TO_HALFWAY)
    expect(harness.applied).toEqual(['RESULT'])
  })

  it('applies a later refresh without a settle too', async () => {
    // A filter run is the user ASKING for the list to change. Holding it back
    // three seconds to warn them about a change they requested made filtering
    // take about seven seconds to visibly do anything.
    //
    // The settle belongs to the accept path, where the list moves under someone
    // who did not ask for it to.
    const { hook, harness } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.refresh())
    advance(32)
    await harness.resolve()
    advance(BAR_TO_HALFWAY)
    expect(harness.applied).toHaveLength(1)

    act(() => result.current.refresh())
    advance(32)
    await harness.resolve()
    advance(BAR_TO_HALFWAY)
    expect(harness.applied).toHaveLength(2)
  })

  it('still settles an ACCEPT, which is what the settle is for', async () => {
    const { hook, harness } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(BUFFER_MS + 32)
    await harness.resolve()
    advance(BAR_TO_HALFWAY)
    expect(result.current.phase).toBe('settling')
    expect(harness.applied).toEqual([])

    advance(SETTLE_MS + 200)
    expect(harness.applied).toEqual(['RESULT'])
  })

  it('skips the click buffer, because a filter has no clicks to collect', async () => {
    const { hook } = setup()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.refresh())
    advance(32)
    expect(result.current.phase).toBe('querying')
  })
})

describe('buffering', () => {
  it('collects several clicks into one run', async () => {
    const runs: string[][] = []
    let release: (() => void) | null = null
    const hook = renderHook(() =>
      usePipeline<string>({
        run: (items) => {
          runs.push([...items])
          return new Promise((r) => {
            release = () => r('RESULT')
          })
        },
        apply: () => undefined,
      }),
    )
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(200)
    act(() => result.current.schedule('b'))
    advance(200)
    act(() => result.current.schedule('c'))
    advance(BUFFER_MS)

    // Three accepts, one round trip — the whole reason the buffer exists.
    expect(runs).toEqual([['a', 'b', 'c']])
    act(() => {
      release?.()
    })
  })
})
