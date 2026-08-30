import { describe, expect, it } from 'vitest'
import {
  CURVE_BUCKETS,
  curveBucket,
  curveDeltas,
  curveDirection,
  curveFit,
  curveTarget,
} from './curve.js'

const flat = (n: number): number[] => new Array<number>(CURVE_BUCKETS).fill(n)

describe('curveTarget', () => {
  it('is a distribution that sums to one', () => {
    for (const archetype of ['aggro', 'control', 'combo', 'midrange'] as const) {
      const sum = curveTarget(archetype).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('gives aggro a lower curve than control', () => {
    const aggro = curveTarget('aggro')
    const control = curveTarget('control')

    // Weighted mean bucket: aggro should want cheaper cards.
    const mean = (t: readonly number[]): number => t.reduce((a, s, i) => a + s * i, 0)
    expect(mean(aggro)).toBeLessThan(mean(control))
  })

  it('blends a secondary archetype 70/30, like the role targets do', () => {
    const pure = curveTarget('aggro')
    const blended = curveTarget('aggro', 'control')
    const control = curveTarget('control')

    // Every bucket lands between the two, and nearer the primary.
    const meanOf = (t: readonly number[]): number => t.reduce((a, s, i) => a + s * i, 0)
    expect(meanOf(blended)).toBeGreaterThan(meanOf(pure))
    expect(meanOf(blended)).toBeLessThan(meanOf(control))
    expect(Math.abs(meanOf(blended) - meanOf(pure))).toBeLessThan(
      Math.abs(meanOf(blended) - meanOf(control)),
    )
  })

  it('ignores a secondary identical to the primary', () => {
    expect(curveTarget('combo', 'combo')).toEqual(curveTarget('combo'))
  })
})

describe('curveBucket', () => {
  it('floors fractional mana values', () => {
    expect(curveBucket(2.0)).toBe(2)
    expect(curveBucket(3.5)).toBe(3)
  })

  it('clamps everything expensive into the top bucket', () => {
    expect(curveBucket(7)).toBe(7)
    expect(curveBucket(12)).toBe(7)
  })

  it('clamps a negative mana value to zero rather than indexing off the end', () => {
    expect(curveBucket(-1)).toBe(0)
  })
})

describe('curveFit — two-sided, which the old flat-25% heuristic was not', () => {
  const target = curveTarget('midrange')

  it('rewards a mana value the deck is short of', () => {
    // Nothing at 2, and midrange wants plenty there.
    const curve = flat(10)
    curve[2] = 0

    expect(curveFit(2, curve, target)).toBeGreaterThan(0)
  })

  it('PENALISES a mana value the deck already has too much of', () => {
    // This is the case the old heuristic could not express: it clamped at 0, so
    // thirty two-drops produced no signal to stop.
    const curve = flat(2)
    curve[2] = 40

    expect(curveFit(2, curve, target)).toBeLessThan(0)
  })

  it('is near zero when the deck already matches its target', () => {
    const total = 100
    const curve = curveTarget('midrange').map((share) => Math.round(share * total))

    for (let mv = 0; mv < CURVE_BUCKETS; mv += 1) {
      expect(Math.abs(curveFit(mv, curve, target))).toBeLessThan(0.35)
    }
  })

  it('stays within -1..1 however lopsided the deck is', () => {
    const curve = flat(0)
    curve[6] = 99

    expect(curveFit(6, curve, target)).toBeGreaterThanOrEqual(-1)
    expect(curveFit(0, curve, target)).toBeLessThanOrEqual(1)
  })

  it('returns zero for an empty deck rather than dividing by zero', () => {
    expect(curveFit(3, flat(0), target)).toBe(0)
  })

  it('treats a small-target bucket proportionally, not absolutely', () => {
    // 7+ wants very little. Three cards there is a real overshoot even though
    // three cards at 2 would be nothing.
    const curve = flat(10)
    curve[7] = 20

    expect(curveFit(7, curve, target)).toBeLessThan(0)
  })
})

describe('curveDeltas', () => {
  it('reports how many cards each bucket is short or over', () => {
    const target = curveTarget('midrange')
    const curve = flat(0)
    curve[2] = 30

    const deltas = curveDeltas(curve, target)

    expect(deltas).toHaveLength(CURVE_BUCKETS)
    // The deck's only cards are at 2, so 2 is over and everything else short.
    expect(deltas[2]!.actual).toBe(30)
    expect(deltas[2]!.delta).toBeLessThan(0)
    expect(deltas[3]!.delta).toBeGreaterThan(0)
  })

  it('handles an empty curve without producing NaN', () => {
    const deltas = curveDeltas(flat(0), curveTarget('aggro'))

    for (const d of deltas) {
      expect(Number.isNaN(d.ideal)).toBe(false)
      expect(d.delta).toBe(0)
    }
  })
})

describe('curveDirection', () => {
  it('names the gap so the UI can say it in words', () => {
    expect(curveDirection(0.5)).toBe('short')
    expect(curveDirection(-0.5)).toBe('over')
    expect(curveDirection(0)).toBe('balanced')
  })
})
