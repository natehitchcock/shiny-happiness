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

describe('a superseded run cannot land', () => {
  /**
   * The bug: three quick adds, and only the first left the suggestion list.
   *
   * Every add after the buffer closes restarts the cycle, which leaves the
   * previous run still in flight. Nothing identified whose answer was whose, so
   * a slow earlier run resolving during a later one was taken for the later
   * one's answer and applied. That answer predates the newer commands, so the
   * cards added after it were still being recommended — while the optimistic
   * overlay had already been cleared, putting them back on screen.
   */
  const setupMany = (): {
    hook: ReturnType<typeof renderHook>
    applied: unknown[]
    batches: string[][]
    resolveRun: (index: number) => Promise<void>
  } => {
    const applied: unknown[] = []
    const batches: string[][] = []
    const releases: ((value: string) => void)[] = []
    const hook = renderHook(() =>
      usePipeline<string>({
        run: (queued) => {
          batches.push([...queued])
          return new Promise((r) => releases.push(r as (value: string) => void))
        },
        apply: (value) => applied.push(value),
      }),
    )
    return {
      hook,
      applied,
      batches,
      resolveRun: async (index) => {
        await act(async () => {
          releases[index]?.(`RESULT${String(index)}`)
          await Promise.resolve()
        })
      },
    }
  }

  it('ignores an earlier run that resolves during a later one', async () => {
    const { hook, applied, batches, resolveRun } = setupMany()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    // First add goes out on its own.
    act(() => result.current.schedule('a'))
    advance(BUFFER_MS + 32)
    expect(batches).toEqual([['a']])

    // Second add arrives mid-query, so the cycle restarts and run 0 is orphaned.
    act(() => result.current.schedule('b'))
    advance(BUFFER_MS + 32)
    expect(batches).toEqual([['a'], ['b']])

    // The orphan answers first. Its view of the deck is missing 'b'.
    await resolveRun(0)
    advance(BAR_TO_HALFWAY + SETTLE_MS + 32)
    expect(applied).toEqual([])
    expect(result.current.phase).toBe('querying')

    // Only the run that is actually current gets to move the list.
    await resolveRun(1)
    advance(BAR_TO_HALFWAY + SETTLE_MS + 32)
    expect(applied).toEqual(['RESULT1'])
  })

  it('ignores a run orphaned by a filter refresh', async () => {
    const { hook, applied, batches, resolveRun } = setupMany()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(BUFFER_MS + 32)
    act(() => result.current.refresh())
    expect(batches).toEqual([['a'], []])

    await resolveRun(0)
    advance(BAR_TO_HALFWAY + SETTLE_MS + 32)
    expect(applied).toEqual([])

    await resolveRun(1)
    advance(BAR_TO_HALFWAY + 32)
    expect(applied).toEqual(['RESULT1'])
  })

  it('takes the clicks still in the buffer with it when a filter refreshes', async () => {
    // A refresh used to empty the buffer and send nothing: `items.current = []`
    // followed by `launch.current([])`. Anything clicked in the 600 ms before a
    // filter committed was therefore never sent AT ALL, while the optimistic
    // overlay showed it landing until the refresh's own answer swept it away.
    // A silent drop, and the user's second report says a drop is only ever
    // acceptable when the connection is gone.
    const { hook, batches, resolveRun } = setupMany()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    advance(100) // still inside the buffer — nothing has been sent
    act(() => result.current.refresh())

    // The new question, carrying the click that had not gone out yet.
    expect(batches).toEqual([['a']])
    await resolveRun(0)
    advance(BAR_TO_HALFWAY + 32)
  })
})

/**
 * The count above the bar is "what you have done since the view last moved".
 *
 * Reported: *"I clicked add card when the loading bar was at the middle, and
 * the count of cards to add reset back to 1 (it was 2 before I clicked add).
 * When the bar resets, it should continue to count changes since the last time
 * it refreshed the view. This includes removals and adds."*
 *
 * The count was derived from the SEND BUFFER, which the tick empties the moment
 * a batch goes on the wire. Those two cards are still un-applied — the user
 * cannot see them anywhere else — so counting them as gone was wrong. The
 * buffer and the tally are now different lists, and only the tally survives a
 * new run starting.
 */
describe('the pending count', () => {
  const setupCounting = (): {
    hook: ReturnType<typeof renderHook>
    resolveRun: (index: number) => Promise<void>
  } => {
    const releases: ((value: string) => void)[] = []
    const hook = renderHook(() =>
      usePipeline<string>({
        run: () => new Promise((r) => releases.push(r as (value: string) => void)),
        apply: () => undefined,
        // The count, straight out, so the assertions do not depend on which
        // phase the bar happens to be in when they are made.
        describe: (queued) => `n=${String(queued.length)}`,
      }),
    )
    return {
      hook,
      resolveRun: async (index) => {
        await act(async () => {
          releases[index]?.(`RESULT${String(index)}`)
          await Promise.resolve()
        })
      },
    }
  }

  it('keeps counting a click made while the previous batch is in flight', async () => {
    const { hook } = setupCounting()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    act(() => result.current.schedule('b'))
    advance(100)
    expect(result.current.label).toBe('n=2')

    // The buffer closes and the batch is away. The two cards are on the wire
    // and NOT on screen yet, which is precisely why they still count.
    advance(BUFFER_MS + 32)
    expect(result.current.label).toBe('n=2')

    // The third click, made at the bar's halfway mark. The user has done three
    // things since the list last moved, so the bar says three.
    act(() => result.current.schedule('c'))
    expect(result.current.label).toBe('n=3')
  })

  it('counts removals alongside adds', async () => {
    // The report names both: "This includes removals and adds." Nothing in the
    // pipeline knows the difference — the point is that neither kind is lost
    // when a run starts — but the report is explicit, so the test is too.
    const { hook } = setupCounting()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('add-a'))
    advance(BUFFER_MS + 32)
    act(() => result.current.schedule('remove-b'))
    advance(BUFFER_MS + 32)
    act(() => result.current.schedule('add-c'))
    expect(result.current.label).toBe('n=3')
  })

  it('starts over once the view has actually refreshed', async () => {
    // The other half of the rule. "Since the last time it refreshed the view"
    // has to END somewhere, and the end is the apply — the moment the cards
    // appear in the deck under their own steam and the overlay is swept.
    const { hook, resolveRun } = setupCounting()
    const result = hook.result as { current: ReturnType<typeof usePipeline<string>> }

    act(() => result.current.schedule('a'))
    act(() => result.current.schedule('b'))
    advance(BUFFER_MS + 32)
    await resolveRun(0)
    advance(BAR_TO_HALFWAY + SETTLE_MS + 64)

    expect(result.current.phase).toBe('idle')
    expect(result.current.label).toBe('n=0')
  })
})
