import { describe, expect, it } from 'vitest'
import type { CurveTarget } from './curve.js'
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
      const sum = curveTarget(archetype).reduce((a, b) => a + b.ideal, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('gives aggro a lower curve than control', () => {
    const aggro = curveTarget('aggro')
    const control = curveTarget('control')

    // Weighted mean bucket: aggro should want cheaper cards.
    const mean = (t: CurveTarget): number => t.reduce((a, b, i) => a + b.ideal * i, 0)
    expect(mean(aggro)).toBeLessThan(mean(control))
  })

  it('blends a secondary archetype 70/30, like the role targets do', () => {
    const pure = curveTarget('aggro')
    const blended = curveTarget('aggro', 'control')
    const control = curveTarget('control')

    // Every bucket lands between the two, and nearer the primary.
    const meanOf = (t: CurveTarget): number => t.reduce((a, b, i) => a + b.ideal * i, 0)
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

  it('is exactly zero when the deck already sits inside the band', () => {
    const total = 100
    const curve = curveTarget('midrange').map((band) => Math.round(band.ideal * total))

    for (let mv = 0; mv < CURVE_BUCKETS; mv += 1) {
      expect(curveFit(mv, curve, target)).toBe(0)
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

describe('curve ranges give wiggle room, and the room varies by archetype', () => {
  it('says nothing about a bucket that is merely a little off', () => {
    const target = curveTarget('midrange')
    const total = 100
    const curve = target.map((band) => Math.round(band.ideal * total))
    // One card off at three drops. Inside the band, so the curve stays silent
    // and other signals decide — without this every bucket is permanently a
    // little bit wrong and the ordering churns after each accept.
    curve[3] = (curve[3] ?? 0) + 1

    expect(curveFit(3, curve, target)).toBe(0)
    expect(curveDeltas(curve, target)[3]?.withinRange).toBe(true)
    expect(curveDeltas(curve, target)[3]?.delta).toBe(0)
  })

  it('still pushes back once a bucket leaves its band', () => {
    const target = curveTarget('midrange')
    const curve = flat(6)
    curve[2] = 60

    expect(curveFit(2, curve, target)).toBeLessThan(0)
    expect(curveDeltas(curve, target)[2]?.withinRange).toBe(false)
  })

  it('holds aggro to a tighter curve than control', () => {
    // Aggro lives or dies on its early drops; control deliberately spreads.
    const width = (t: CurveTarget, bucket: number): number =>
      (t[bucket]?.max ?? 0) - (t[bucket]?.min ?? 0)

    expect(width(curveTarget('aggro'), 2)).toBeLessThan(width(curveTarget('control'), 2))
  })

  it('gives a hybrid the looser of its two tolerances', () => {
    // Being asked to satisfy two shapes at once, it should not also be held to
    // the stricter of them.
    const width = (t: CurveTarget, bucket: number): number =>
      (t[bucket]?.max ?? 0) - (t[bucket]?.min ?? 0)

    expect(width(curveTarget('aggro', 'control'), 3)).toBeGreaterThan(
      width(curveTarget('aggro'), 3),
    )
  })

  it('never gives a tiny-target bucket a band of nothing', () => {
    // 7+ wants ~2%; a purely proportional band would be a hair wide and every
    // deck would read as wrong there.
    const band = curveTarget('aggro')[7]

    expect((band?.max ?? 0) - (band?.min ?? 0)).toBeGreaterThan(0.02)
  })

  it('reports the band edges so the panel can draw them', () => {
    const deltas = curveDeltas(flat(10), curveTarget('midrange'))

    for (const d of deltas) {
      expect(d.min).toBeLessThanOrEqual(d.ideal)
      expect(d.max).toBeGreaterThanOrEqual(d.ideal)
    }
  })
})
