import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from './archetype.js'
import type { CurveTarget } from './curve.js'
import {
  CURVE_BUCKETS,
  apportion,
  curveBucket,
  curveDeltas,
  curveDirection,
  curveFit,
  curveTarget,
} from './curve.js'
import { CURVE_REFERENCE_SPELLS } from './target-overrides.js'

const flat = (n: number): number[] => new Array<number>(CURVE_BUCKETS).fill(n)

/** Weighted mean bucket — "how expensive does this archetype want to be". */
const mean = (t: CurveTarget): number => t.reduce((a, b, i) => a + b.ideal * i, 0)

/** Total band width across the curve — "how much room does this archetype get". */
const totalWidth = (t: CurveTarget): number => t.reduce((a, b) => a + (b.max - b.min), 0)

const shareOf = (t: CurveTarget): number[] => t.map((b) => b.ideal)

describe('curveTarget', () => {
  it('is a distribution that sums to one', () => {
    for (const archetype of ARCHETYPES) {
      const sum = curveTarget(archetype).reduce((a, b) => a + b.ideal, 0)
      expect(sum, archetype).toBeCloseTo(1, 6)
    }
  })

  it('covers every archetype with a non-degenerate, non-negative shape', () => {
    // Catches an archetype added to the union without a row, which would come
    // back as `undefined` and NaN its way through the whole panel.
    for (const archetype of ARCHETYPES) {
      const target = curveTarget(archetype)
      expect(target, archetype).toHaveLength(CURVE_BUCKETS)
      for (const [bucket, band] of target.entries()) {
        expect(band.ideal, `${archetype} mv${bucket}`).toBeGreaterThan(0)
        expect(band.min, `${archetype} mv${bucket}`).toBeGreaterThanOrEqual(0)
        expect(band.min, `${archetype} mv${bucket}`).toBeLessThanOrEqual(band.ideal)
        expect(band.max, `${archetype} mv${bucket}`).toBeGreaterThanOrEqual(band.ideal)
      }
    }
  })

  it('gives every archetype its own shape rather than a copy of a neighbour', () => {
    // Five of the nine rows were once within a card or two of each other at
    // every bucket, which is a table that has an entry for an archetype without
    // having an opinion about it. Distance is over shares, so a row rescaled is
    // still a copy.
    for (const a of ARCHETYPES) {
      for (const b of ARCHETYPES) {
        if (a >= b) continue
        const [x, y] = [shareOf(curveTarget(a)), shareOf(curveTarget(b))]
        const distance = Math.sqrt(x.reduce((s, v, i) => s + (v - (y[i] ?? 0)) ** 2, 0))
        expect(distance, `${a} vs ${b}`).toBeGreaterThan(0.02)
      }
    }
  })

  it('keeps mana value zero small, because only 99 nonland cards live there', () => {
    // The whole commander-legal corpus holds 99 nonland cards at mana value 0,
    // most of them fast mana that brackets 1-3 do not want. A target above a few
    // percent would tell every low-bracket deck it is short of cards it cannot
    // reasonably play.
    for (const archetype of ARCHETYPES) {
      expect(curveTarget(archetype)[0]?.ideal, archetype).toBeLessThan(0.05)
    }
  })

  it('front-loads aggro against control at every bucket, not just on average', () => {
    // "Aggro is cheaper" has to hold as a shape, or the two rows differ in one
    // bucket and agree everywhere else, which is not two archetypes.
    const aggro = shareOf(curveTarget('aggro'))
    const control = shareOf(curveTarget('control'))

    for (const bucket of [1, 2, 3]) {
      expect(aggro[bucket], `mv${bucket}`).toBeGreaterThan(control[bucket]!)
    }
    for (const bucket of [4, 5, 6, 7]) {
      expect(aggro[bucket], `mv${bucket}`).toBeLessThan(control[bucket]!)
    }
    expect(mean(curveTarget('aggro'))).toBeLessThan(mean(curveTarget('control')))
  })

  it('makes ramp the only archetype that climbs again after its dip', () => {
    // Ramp deliberately skips four and five — a four-drop costs what a ramp
    // spell costs and does not advance the plan — then buys payoffs at six and
    // up. Every other row falls monotonically once past its peak.
    const climbs = (archetype: (typeof ARCHETYPES)[number]): boolean => {
      const s = shareOf(curveTarget(archetype))
      return s[6]! > s[5]!
    }
    expect(ARCHETYPES.filter(climbs)).toEqual(['ramp'])
  })

  it('gives tokens a finisher slot and aristocrats none', () => {
    // Both build a board; only one has to buy a seven-mana card to cash it in,
    // because aristocrats converts the board with a two-mana drain instead. If
    // these two ever converge, the table has stopped distinguishing them.
    const top = (archetype: 'tokens' | 'aristocrats'): number => curveTarget(archetype)[7]!.ideal
    expect(top('tokens')).toBeGreaterThan(top('aristocrats') * 2)
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

  it('holds aggro to a tighter curve than control, over the whole curve', () => {
    // Compared across all eight buckets rather than at one, because tolerance is
    // a fraction of the archetype's OWN share: aggro's two-drop bucket is so fat
    // that 25% of it can be wider in absolute terms than 40% of control's. This
    // assertion used to be made at bucket 2 alone and was passing by 0.006 —
    // true, but not for the reason it claimed.
    expect(totalWidth(curveTarget('aggro'))).toBeLessThan(totalWidth(curveTarget('control')))
  })

  it('orders the bands by how much of the plan is a schedule', () => {
    // Aggro's clock is arithmetic and an unspent turn is gone, so it gets the
    // least room of anyone. Ramp's whole plan is decoupling cost from turn, so
    // it gets the most. Midrange sits between, as the archetype defined by not
    // committing. Asserted as an ordering, since the individual widths are a
    // judgement and the ordering is the claim.
    const widths = new Map(ARCHETYPES.map((a) => [a, totalWidth(curveTarget(a))]))
    const narrowest = [...widths].sort((a, b) => a[1] - b[1])[0]
    const widest = [...widths].sort((a, b) => b[1] - a[1])[0]

    expect(narrowest?.[0]).toBe('aggro')
    expect(widest?.[0]).toBe('ramp')
    expect(widths.get('aggro')!).toBeLessThan(widths.get('midrange')!)
    expect(widths.get('midrange')!).toBeLessThan(widths.get('control')!)
  })

  it('keeps every tolerance inside a range where the band still says something', () => {
    // Below about a fifth the band is narrower than the noise of one accepted
    // card; above about a half it spans so much of the deck that `curveFit`
    // returns zero for anything a builder would plausibly do, and the feature
    // quietly switches itself off. Read back out of the output rather than from
    // the table, so it holds for whatever produced the bands.
    for (const archetype of ARCHETYPES) {
      const target = curveTarget(archetype)
      // The floor widens small buckets, so the minimum relative half-width over
      // the curve is the archetype's own tolerance.
      const relative = Math.min(...target.map((b) => (b.max - b.min) / 2 / b.ideal))
      expect(relative, archetype).toBeGreaterThanOrEqual(0.2)
      expect(relative, archetype).toBeLessThanOrEqual(0.5)
    }
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

describe('apportioning whole cards to fractional shares', () => {
  /*
   * The defect: eight shares summing to 1, each rounded on its own, do not sum
   * to the reference. Six of the nine archetypes came out at 64 against 63, so
   * the targets sheet showed "Curve total 64 of 63 spells — over" to a builder
   * who had changed nothing and could not clear it without editing a bucket.
   */
  it('always hands out exactly the total, for every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const shares = curveTarget(archetype).map((band) => band.ideal)
      const counts = apportion(shares, CURVE_REFERENCE_SPELLS)
      const sum = counts.reduce((a, b) => a + b, 0)
      expect({ archetype, sum }).toEqual({ archetype, sum: CURVE_REFERENCE_SPELLS })
    }
  })

  it('rounds each bucket to a neighbour of its exact share', () => {
    // Apportionment may not invent a number: every count is the floor or the
    // ceiling of that bucket's exact share, never further away.
    const shares = curveTarget('midrange').map((band) => band.ideal)
    const counts = apportion(shares, CURVE_REFERENCE_SPELLS)
    counts.forEach((count, bucket) => {
      const exact = (shares[bucket] ?? 0) * CURVE_REFERENCE_SPELLS
      expect(count).toBeGreaterThanOrEqual(Math.floor(exact))
      expect(count).toBeLessThanOrEqual(Math.ceil(exact))
    })
  })

  it('is deterministic when two buckets have the same remainder', () => {
    // Ties break on bucket order, so the same shape gives the same table every
    // run — doc 05's determinism rule.
    const even = [0.25, 0.25, 0.25, 0.25]
    expect(apportion(even, 10)).toEqual(apportion(even, 10))
    expect(apportion(even, 10)).toEqual([3, 3, 2, 2])
  })

  it('gives nothing away when the shares already divide exactly', () => {
    expect(apportion([0.5, 0.5], 10)).toEqual([5, 5])
    expect(apportion([1], 7)).toEqual([7])
  })

  it('survives a share list that sums a hair over one', () => {
    // Floating point: three thirds do not add to exactly 1, and handing out a
    // negative card is not a thing.
    const thirds = [1 / 3, 1 / 3, 1 / 3]
    const counts = apportion(thirds, 9)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(9)
    expect(counts.every((c) => c >= 0)).toBe(true)
  })

  it('makes the curve panel add up to the deck it describes', () => {
    // The same defect one level down: `curveDeltas`' ideals must total the
    // deck's own nonland count, or the panel contradicts itself.
    const deck = [1, 6, 12, 14, 10, 8, 5, 7]
    const spells = deck.reduce((a, b) => a + b, 0)
    const deltas = curveDeltas(deck, curveTarget('midrange'))
    expect(deltas.reduce((sum, d) => sum + d.ideal, 0)).toBe(spells)
  })
})
