// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_QUERY_MS, secondsLeft, shouldWait, useAutoQuery } from './autoquery.js'

describe('shouldWait', () => {
  it('waits when the box says something the last query did not', () => {
    expect(shouldWait({ enabled: true, draft: 't:creature', committed: '' })).toBe(true)
  })

  it('does not wait when the setting is off', () => {
    expect(shouldWait({ enabled: false, draft: 't:creature', committed: '' })).toBe(false)
  })

  it('does not wait once the query has already run', () => {
    // Otherwise clicking the magnifier would immediately start a countdown to
    // run the same query again, forever.
    expect(shouldWait({ enabled: true, draft: 't:creature', committed: 't:creature' })).toBe(false)
  })

  it('does not treat a trailing space as an adjustment', () => {
    // The run button trims. A countdown that fired on 't:creature ' would commit
    // 't:creature' and then still believe something was pending.
    expect(shouldWait({ enabled: true, draft: 't:creature ', committed: 't:creature' })).toBe(false)
  })

  it('waits when the box is cleared, because clearing is a query too', () => {
    expect(shouldWait({ enabled: true, draft: '', committed: 't:creature' })).toBe(true)
  })
})

describe('secondsLeft', () => {
  it('starts at the full countdown and ends at zero', () => {
    expect(secondsLeft(0)).toBe(AUTO_QUERY_MS / 1_000)
    expect(secondsLeft(AUTO_QUERY_MS)).toBe(0)
  })

  it('rounds up, so it never shows 0 while there is still time', () => {
    // Showing "0s" for a whole second before anything happens reads as broken.
    expect(secondsLeft(AUTO_QUERY_MS - 500)).toBe(1)
    expect(secondsLeft(1)).toBe(AUTO_QUERY_MS / 1_000)
  })

  it('never goes negative if a tick lands late', () => {
    expect(secondsLeft(AUTO_QUERY_MS + 5_000)).toBe(0)
  })
})

describe('useAutoQuery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('fires once the wait elapses', () => {
    const onFire = vi.fn()
    renderHook(() => useAutoQuery({ enabled: true, draft: 'mv<=3', committed: '' }, onFire))
    expect(onFire).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS))
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('restarts the wait when the box is adjusted', () => {
    // The rule the user asked for: "if they don't make any adjustments in 10
    // seconds". Nine seconds of typing then a keystroke must not fire at ten.
    const onFire = vi.fn()
    const { rerender } = renderHook(
      ({ draft }) => useAutoQuery({ enabled: true, draft, committed: '' }, onFire),
      { initialProps: { draft: 'mv' } },
    )
    // Nearly the whole wait, twice — timings are fractions of the constant so
    // changing it needs no edit here.
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.9))
    rerender({ draft: 'mv<=3' })
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.9))
    expect(onFire).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.2))
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('does not fire at all when the setting is off', () => {
    const onFire = vi.fn()
    renderHook(() => useAutoQuery({ enabled: false, draft: 'mv<=3', committed: '' }, onFire))
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 3))
    expect(onFire).not.toHaveBeenCalled()
  })

  it('stops counting the moment the query is run by hand', () => {
    const onFire = vi.fn()
    const { rerender } = renderHook(
      ({ committed }) => useAutoQuery({ enabled: true, draft: 'mv<=3', committed }, onFire),
      { initialProps: { committed: '' } },
    )
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.5))
    // The magnifier was clicked: the draft is now what ran.
    rerender({ committed: 'mv<=3' })
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS))
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not restart the countdown just because the callback changed identity', () => {
    // An inline arrow in App.tsx is a new function every render. If that reset
    // the timer, the countdown would never reach zero on a re-rendering page.
    const onFire = vi.fn()
    const { rerender } = renderHook(
      ({ n }) => useAutoQuery({ enabled: true, draft: 'mv<=3', committed: '' }, () => onFire(n)),
      { initialProps: { n: 1 } },
    )
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.5))
    rerender({ n: 2 })
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 0.6))
    expect(onFire).toHaveBeenCalledTimes(1)
    // And it calls the LATEST callback, not the one captured at the start.
    expect(onFire).toHaveBeenCalledWith(2)
  })

  it('counts the label down and clears it when it fires', () => {
    // Modelled the way App uses it: firing calls setQuery, so the committed
    // value catches up to the draft on the next render and the ring goes away.
    let committed = ''
    const { result, rerender } = renderHook(() =>
      useAutoQuery({ enabled: true, draft: 'mv<=3', committed }, () => {
        committed = 'mv<=3'
      }),
    )
    expect(result.current.remaining).toBe(AUTO_QUERY_MS / 1_000)
    expect(result.current.active).toBe(true)

    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS - 1_000))
    expect(result.current.remaining).toBe(1)

    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS))
    expect(result.current.remaining).toBeNull()

    rerender()
    expect(result.current.active).toBe(false)
  })

  it('reports nothing pending when there is nothing to run', () => {
    const { result } = renderHook(() =>
      useAutoQuery({ enabled: true, draft: 'mv<=3', committed: 'mv<=3' }, () => undefined),
    )
    expect(result.current.active).toBe(false)
    expect(result.current.remaining).toBeNull()
  })

  it('clears its timers on unmount', () => {
    const onFire = vi.fn()
    const { unmount } = renderHook(() =>
      useAutoQuery({ enabled: true, draft: 'mv<=3', committed: '' }, onFire),
    )
    unmount()
    act(() => void vi.advanceTimersByTime(AUTO_QUERY_MS * 2))
    expect(onFire).not.toHaveBeenCalled()
  })
})
