/**
 * A pseudo-random sequence that is a pure function of a string.
 *
 * R1 forbids `Math.random()` in this package, and that rule is usually met by
 * pushing the non-determinism out to the caller. Here the caller does not want
 * to be handed a random NUMBER — it wants a random SUBSET of a corpus it does
 * not hold, and the pool it is sampling from lives on the far side of an HTTP
 * boundary. So the entropy is pushed all the way out to one `crypto.randomUUID()`
 * at the click, and everything below it — the API route, the SQL it issues, the
 * subset it returns — is a deterministic function of that one string.
 *
 * That is what makes the two entry routes testable without pinning anything.
 * A test passes the seed the click would have produced and asserts the exact
 * cards that come back; the sampler under test is the shipped sampler, not a
 * stub standing in for it.
 *
 * `xmur3` to mix the string into 32 bits, `mulberry32` to expand it. Both are
 * small, public-domain and — the property that matters here — have no state
 * outside the closure, so two callers with one seed cannot interfere.
 *
 * NOT a cryptographic generator, and nothing here should become one. It picks
 * eight tags out of forty-eight and three commanders out of three thousand; the
 * failure mode of a weak generator is a slightly lumpy shuffle, which is a
 * product problem and not a security one. `crypto.getRandomValues` is not
 * reachable from a pure module anyway.
 */

/** Mix a string into a 32-bit state. */
const hashSeed = (seed: string): number => {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/**
 * A `[0, 1)` generator seeded by a string.
 *
 * Exported because the sampler below is not the only shape a caller may want,
 * and because a test that wants to characterise the distribution needs the raw
 * stream rather than its effect on an array.
 */
export const seededRandom = (seed: string): (() => number) => {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `count` distinct members of `items`, chosen by `seed`.
 *
 * A PARTIAL Fisher–Yates: it swaps only the prefix it is going to return, so
 * drawing 3 of 3,411 costs three swaps rather than a full shuffle. The input is
 * copied first — the arrays this runs over are cached corpus reads shared
 * between requests, and shuffling one in place would reorder a cache entry
 * other callers are holding.
 *
 * Fewer items than asked for returns all of them, shuffled. That is the honest
 * answer rather than an error: a test corpus with four commanders in it should
 * still deal a hand, and the caller can compare lengths if it cares.
 */
export const sampleWithSeed = <T>(items: readonly T[], count: number, seed: string): T[] => {
  const wanted = Math.min(Math.max(count, 0), items.length)
  if (wanted === 0) return []
  const pool = [...items]
  const random = seededRandom(seed)
  for (let i = 0; i < wanted; i += 1) {
    // `i + floor(r * (n - i))` — a uniform pick from the untouched tail, which
    // is what keeps every member equally likely rather than only the ones the
    // first swap could reach.
    const j = i + Math.floor(random() * (pool.length - i))
    const here = pool[i] as T
    const there = pool[j] as T
    pool[i] = there
    pool[j] = here
  }
  return pool.slice(0, wanted)
}
