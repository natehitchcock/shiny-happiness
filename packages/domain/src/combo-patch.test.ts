import { describe, expect, it } from 'vitest'
import type { Combo } from './combo.js'
import { buildComboIndex } from './combo-index.js'
import { computeDegrees, patchDegrees, type DegreeMap } from './combo-patch.js'
import { comboId, oracleId } from './ids.js'
import type { OracleId } from './ids.js'

const card = (n: string): OracleId => oracleId(n)

const combo = (id: string, pieces: readonly string[]): Combo => ({
  id: comboId(id),
  pieces: pieces.map(card),
  prerequisites: '',
  steps: [],
  produces: ['value'],
  colorIdentity: [],
})

/** Seeded so a failure is reproducible. R1 forbids Math.random in domain code. */
const rng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sorted = (m: DegreeMap) => [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))

describe('patchDegrees', () => {
  const index = buildComboIndex([
    combo('c1', ['X', 'A']),
    combo('c2', ['X', 'A', 'B']),
    combo('c3', ['Y', 'B']),
    combo('c4', ['Z', 'P', 'Q']),
  ])
  const pool = new Set([card('X'), card('Y'), card('Z')])

  it('raises the degree of a candidate when its partner is accepted', () => {
    const before = new Set<OracleId>()
    const start = computeDegrees(index, before, pool)
    expect(start.get(card('X'))).toBe(0)

    const after = new Set([card('A')])
    const patch = patchDegrees(index, after, pool, start, [card('A')])
    expect(patch.degrees.get(card('X'))).toBe(1)
    expect(patch.changed).toEqual(new Set([card('X')]))
  })

  it('drops a candidate that has just been accepted', () => {
    const start = computeDegrees(index, new Set([card('A')]), pool)
    const after = new Set([card('A'), card('X')])
    const patch = patchDegrees(index, after, pool, start, [card('X')])
    expect(patch.degrees.has(card('X'))).toBe(false)
    expect(patch.changed.has(card('X'))).toBe(true)
  })

  it('restores a candidate that has left the accepted set', () => {
    const accepted = new Set([card('A'), card('X')])
    const start = computeDegrees(index, accepted, pool)
    expect(start.has(card('X'))).toBe(true)
    expect(start.get(card('X'))).toBe(0) // accepted cards are not candidates

    const after = new Set([card('A')])
    const patch = patchDegrees(index, after, pool, start, [card('X')])
    expect(patch.degrees.get(card('X'))).toBe(1)
  })

  it('leaves unrelated candidates untouched and does not recompute them', () => {
    const start = computeDegrees(index, new Set(), pool)
    const patch = patchDegrees(index, new Set([card('A')]), pool, start, [card('A')])
    expect(patch.changed.has(card('Y'))).toBe(false)
    expect(patch.changed.has(card('Z'))).toBe(false)
    // Only X shares a combo with A.
    expect(patch.recomputed).toBeLessThanOrEqual(2)
  })

  it('handles a batch change — a whole core package applied at once', () => {
    const start = computeDegrees(index, new Set(), pool)
    const after = new Set([card('A'), card('B')])
    const patch = patchDegrees(index, after, pool, start, [card('A'), card('B')])
    expect(patch.degrees.get(card('X'))).toBe(2)
    expect(patch.degrees.get(card('Y'))).toBe(1)
  })

  it('is a no-op when nothing changed', () => {
    const accepted = new Set([card('A')])
    const start = computeDegrees(index, accepted, pool)
    const patch = patchDegrees(index, accepted, pool, start, [])
    expect(sorted(patch.degrees)).toEqual(sorted(start))
    expect(patch.changed.size).toBe(0)
  })
})

describe('patchDegrees ≡ computeDegrees (property)', () => {
  // The equivalence DOM-03 exists to guarantee. A fast answer that drifts from
  // the true one is worse than a slow answer.
  const CARDS = 'ABCDEFGHIJKLMNOP'.split('')

  const randomIndex = (seed: number) => {
    const r = rng(seed)
    const combos: Combo[] = []
    for (let i = 0; i < 24; i++) {
      const size = 2 + Math.floor(r() * 3)
      const pieces = new Set<string>()
      while (pieces.size < size) pieces.add(CARDS[Math.floor(r() * CARDS.length)]!)
      combos.push(combo(`c${i}`, [...pieces]))
    }
    return buildComboIndex(combos)
  }

  it.each([1, 2, 3, 7, 11, 42, 1337])('holds over a random sequence (seed %i)', (seed) => {
    const r = rng(seed)
    const index = randomIndex(seed)
    const pool = new Set(CARDS.map(card))
    const accepted = new Set<OracleId>()
    let degrees = computeDegrees(index, accepted, pool)

    for (let step = 0; step < 60; step++) {
      const target = card(CARDS[Math.floor(r() * CARDS.length)]!)
      if (accepted.has(target)) accepted.delete(target)
      else accepted.add(target)

      degrees = patchDegrees(index, accepted, pool, degrees, [target]).degrees

      const truth = computeDegrees(index, accepted, pool)
      // Accepted cards are not candidates; compare only the candidate view.
      const expected = new Map([...truth].filter(([id]) => !accepted.has(id)))
      const actual = new Map([...degrees].filter(([id]) => !accepted.has(id)))
      expect(sorted(actual)).toEqual(sorted(expected))
    }
  })
})
