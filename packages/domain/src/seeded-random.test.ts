import { describe, expect, it } from 'vitest'
import { sampleWithSeed, seededRandom } from './seeded-random.js'

/**
 * The generator the two entry routes are built on (ADR-0067).
 *
 * The properties asserted here are the ones the routes actually rely on, and
 * each one is a bug somebody would otherwise ship:
 *
 *   determinism    a test that pins the cards a seed deals is worthless if the
 *                  seed does not decide them
 *   distinctness   a quickdraw hand with the same commander twice
 *   coverage       a "random" draw that can only ever reach the first n items
 *   no mutation    the pools are cached corpus arrays shared between requests
 */
const pool = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => i)

describe('seededRandom', () => {
  it('is a pure function of the seed', () => {
    const a = seededRandom('start')
    const b = seededRandom('start')
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()])
  })

  it('gives different streams for different seeds', () => {
    const a = seededRandom('start')
    const b = seededRandom('stark')
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
  })

  it('stays inside [0, 1)', () => {
    const next = seededRandom('bounds')
    for (let i = 0; i < 2000; i += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('does not share state between two generators on one seed', () => {
    const a = seededRandom('shared')
    a()
    a()
    const b = seededRandom('shared')
    // `b` starts over rather than continuing where `a` got to.
    expect(b()).toBe(seededRandom('shared')())
  })
})

describe('sampleWithSeed', () => {
  it('deals the same hand for the same seed', () => {
    expect(sampleWithSeed(pool(3411), 3, 'a-uuid')).toEqual(sampleWithSeed(pool(3411), 3, 'a-uuid'))
  })

  it('deals a different hand for a different seed', () => {
    // A redraw that returns the same eight tags is a redraw that looks broken.
    const draws = new Set(
      Array.from({ length: 20 }, (_, i) => sampleWithSeed(pool(48), 8, `seed-${String(i)}`).join()),
    )
    expect(draws.size).toBeGreaterThan(15)
  })

  it('never repeats a member', () => {
    for (let i = 0; i < 200; i += 1) {
      const hand = sampleWithSeed(pool(20), 5, `hand-${String(i)}`)
      expect(new Set(hand).size).toBe(5)
    }
  })

  it('can reach every member of the pool', () => {
    // The partial Fisher-Yates is the whole reason this is worth asserting: a
    // naive "shuffle the first k" only ever returns the first k.
    const seen = new Set<number>()
    for (let i = 0; i < 500; i += 1)
      for (const n of sampleWithSeed(pool(40), 3, `s${String(i)}`)) seen.add(n)
    expect(seen.size).toBe(40)
  })

  it('does not favour the head of the pool', () => {
    // 3 of 40 over 4000 draws is 300 expected appearances each. A generator
    // that only stirred the front would show a step, not noise.
    const counts = new Map<number, number>()
    for (let i = 0; i < 4000; i += 1) {
      for (const n of sampleWithSeed(pool(40), 3, `u${String(i)}`)) {
        counts.set(n, (counts.get(n) ?? 0) + 1)
      }
    }
    const tallies = [...counts.values()]
    expect(counts.size).toBe(40)
    expect(Math.min(...tallies)).toBeGreaterThan(200)
    expect(Math.max(...tallies)).toBeLessThan(420)
  })

  it('returns everything, shuffled, when asked for more than there is', () => {
    const drawn = sampleWithSeed(pool(4), 10, 'small-corpus')
    expect(drawn).toHaveLength(4)
    expect([...drawn].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })

  it('returns nothing for a count of zero, and for an empty pool', () => {
    expect(sampleWithSeed(pool(10), 0, 'none')).toEqual([])
    expect(sampleWithSeed([], 3, 'none')).toEqual([])
    expect(sampleWithSeed(pool(10), -1, 'none')).toEqual([])
  })

  it('leaves the pool it was given untouched', () => {
    // These arrays are `corpus-cache` entries shared between requests. An
    // in-place shuffle would reorder a cache entry another caller is holding.
    const original = pool(50)
    const copy = [...original]
    sampleWithSeed(original, 10, 'no-mutation')
    expect(original).toEqual(copy)
  })
})
