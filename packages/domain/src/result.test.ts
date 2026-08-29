import { describe, expect, it } from 'vitest'
import { all, andThen, err, isErr, isOk, map, mapErr, ok, partition, unwrapOr } from './result.js'

describe('Result', () => {
  it('narrows with the type guards', () => {
    const good = ok(1)
    const bad = err('nope')
    expect(isOk(good)).toBe(true)
    expect(isErr(good)).toBe(false)
    expect(isOk(bad)).toBe(false)
    expect(isErr(bad)).toBe(true)
    if (isOk(good)) expect(good.value).toBe(1)
    if (isErr(bad)) expect(bad.error).toBe('nope')
  })

  it('maps the success side only', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6))
    expect(map(err<string>('boom'), (n: number) => n * 3)).toEqual(err('boom'))
  })

  it('maps the error side only', () => {
    expect(mapErr(err('boom'), (e) => e.length)).toEqual(err(4))
    expect(mapErr(ok(2), (e: string) => e.length)).toEqual(ok(2))
  })

  it('chains fallible operations and short-circuits', () => {
    const halve = (n: number) => (n % 2 === 0 ? ok(n / 2) : err('odd'))
    expect(andThen(ok(8), halve)).toEqual(ok(4))
    expect(andThen(ok(7), halve)).toEqual(err('odd'))
    expect(andThen(err<string>('earlier'), halve)).toEqual(err('earlier'))
  })

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5)
    expect(unwrapOr(err<string>('x') as never, 0)).toBe(0)
  })

  describe('all', () => {
    it('collects successes', () => {
      expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]))
    })

    it('returns the first error and stops', () => {
      expect(all([ok(1), err('first'), err('second')])).toEqual(err('first'))
    })

    // Degenerate input — AGENTS.md §3 requires these, not just the happy path.
    it('treats an empty list as success', () => {
      expect(all<number, string>([])).toEqual(ok([]))
    })
  })

  describe('partition', () => {
    it('keeps both sides, dropping neither', () => {
      const { values, errors } = partition([ok(1), err('a'), ok(2), err('b')])
      expect(values).toEqual([1, 2])
      expect(errors).toEqual(['a', 'b'])
    })

    it('handles an empty list', () => {
      expect(partition<number, string>([])).toEqual({ values: [], errors: [] })
    })

    it('handles all-errors and all-successes', () => {
      expect(partition([err('a'), err('b')]).values).toEqual([])
      expect(partition([ok(1), ok(2)]).errors).toEqual([])
    })
  })
})
