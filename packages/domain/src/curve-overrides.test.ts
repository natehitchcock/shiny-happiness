import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from './archetype.js'
import { CURVE_BUCKETS, archetypeTolerance, curveDeltas, curveTarget } from './curve.js'
import { CURVE_REFERENCE_SPELLS } from './target-overrides.js'

const shares = (archetype: 'midrange' | 'aggro', overrides?: Parameters<typeof curveTarget>[2]) =>
  curveTarget(archetype, null, overrides).map((b) => b.ideal)

const widths = (archetype: 'midrange', overrides?: Parameters<typeof curveTarget>[2]) =>
  curveTarget(archetype, null, overrides).map((b) => b.max - b.min)

/**
 * Per-deck curve overrides (doc 16).
 *
 * The counts a builder types are counts of `CURVE_REFERENCE_SPELLS`, and every
 * consumer downstream still works in shares — so the tests here are mostly about
 * what happens to the seven buckets the builder did NOT touch.
 */
describe('curveTarget with overrides', () => {
  it('is byte-identical to the un-overridden call when nothing is overridden', () => {
    for (const archetype of ARCHETYPES) {
      const base = curveTarget(archetype)
      expect(curveTarget(archetype, null, {}), archetype).toEqual(base)
      expect(curveTarget(archetype, null, { curve: {} }), archetype).toEqual(base)
      // A roles-only override is not a curve override and must not touch it.
      expect(curveTarget(archetype, null, { roles: { 'role:ramp': 14 } }), archetype).toEqual(base)
    }
  })

  it('still sums to one after an override', () => {
    // Everything downstream divides by this. A vector that does not normalise
    // would make `curveFit` read every bucket as short, forever.
    const sum = shares('midrange', { curve: { 2: 20, 5: 2 } }).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('puts a pinned bucket at its count over the reference', () => {
    expect(shares('midrange', { curve: { 2: 14 } })[2]).toBeCloseTo(14 / CURVE_REFERENCE_SPELLS, 9)
  })

  it('keeps the RELATIVE shape of every bucket the builder did not pin', () => {
    // The sparse promise for the curve half: pinning the two-drops must not
    // change the archetype's opinion about how three-drops compare to fours.
    const base = shares('midrange')
    const tuned = shares('midrange', { curve: { 2: 20 } })
    for (let i = 0; i < CURVE_BUCKETS; i += 1) {
      if (i === 2 || i === 3) continue
      expect(tuned[i]! / tuned[3]!, `mv${i}`).toBeCloseTo(base[i]! / base[3]!, 9)
    }
  })

  it('takes the extra share from the untouched buckets, not from thin air', () => {
    const base = shares('midrange')
    const tuned = shares('midrange', { curve: { 2: 25 } })
    expect(tuned[2]!).toBeGreaterThan(base[2]!)
    // Every other bucket shrinks, because the deck is still one deck.
    for (let i = 0; i < CURVE_BUCKETS; i += 1) {
      if (i === 2) continue
      expect(tuned[i]!, `mv${i}`).toBeLessThan(base[i]!)
    }
  })

  it('renormalises rather than clamping when the counts run past the reference', () => {
    // Doc 03 §3.2's principle: the user may knowingly cross their own line, so
    // the domain keeps the SHAPE they asked for and the warning lives in the
    // sheet. 60 + 60 is "half and half", whatever the arithmetic says about 63.
    const tuned = shares('midrange', { curve: { 1: 60, 2: 60 } })
    expect(tuned.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(tuned[1]).toBeCloseTo(0.5, 9)
    expect(tuned[2]).toBeCloseTo(0.5, 9)
    // The untouched buckets are squeezed out entirely, which is the honest
    // reading of "120 spells at one and two in a 63-spell deck".
    expect(tuned[3]).toBe(0)
  })

  it('falls back to the archetype when every bucket is pinned to zero', () => {
    // Otherwise this is a divide by zero and eight NaN bands, and every panel
    // downstream renders blank with nothing saying why.
    const allZero = Object.fromEntries(
      Array.from({ length: CURVE_BUCKETS }, (_, i) => [i, 0]),
    ) as Record<number, number>
    expect(curveTarget('midrange', null, { curve: allZero })).toEqual(curveTarget('midrange'))
  })

  it('marks the pinned buckets custom and leaves the rest as the archetype', () => {
    const target = curveTarget('midrange', null, { curve: { 2: 14 } })
    expect(target[2]?.source).toBe('custom')
    expect(target[3]?.source).toBe('archetype')
  })

  it('lets the deck override the archetype tolerance in both directions', () => {
    const base = widths('midrange')
    const strict = widths('midrange', { tolerance: 0.05 })
    const loose = widths('midrange', { tolerance: 1 })
    for (let i = 0; i < CURVE_BUCKETS; i += 1) {
      expect(strict[i]!, `mv${i}`).toBeLessThanOrEqual(base[i]!)
      expect(loose[i]!, `mv${i}`).toBeGreaterThanOrEqual(base[i]!)
    }
    // `MIN_HALF_WIDTH` floors the ~1% buckets, so a per-bucket strict
    // inequality would be asserting the floor rather than the tolerance. Say
    // instead that the curve as a whole moved, in both directions.
    expect(strict.reduce((a, b) => a + b, 0)).toBeLessThan(base.reduce((a, b) => a + b, 0))
    expect(loose.reduce((a, b) => a + b, 0)).toBeGreaterThan(base.reduce((a, b) => a + b, 0))
  })

  it('uses the deck tolerance in place of the hybrid rule, not on top of it', () => {
    // A hybrid normally takes the LOOSER of its two archetypes. A deck that has
    // said how strict it is has outranked that, and must not be widened again.
    const tuned = curveTarget('aggro', 'ramp', { tolerance: 0.1 })
    const untuned = curveTarget('aggro', 'ramp')
    for (const [bucket, band] of tuned.entries()) {
      // Every band that is not sitting on `MIN_HALF_WIDTH` is exactly the
      // deck's own tolerance wide — 0.1 of its own share, either side.
      const relative = (band.max - band.min) / band.ideal
      if (band.ideal * 0.1 <= 0.015) continue
      expect(relative, `mv${bucket}`).toBeCloseTo(0.2, 9)
    }
    // And the deck really is tighter than the looser-of-two it would have got.
    const width = (t: typeof tuned): number => t.reduce((a, b) => a + (b.max - b.min), 0)
    expect(width(tuned)).toBeLessThan(width(untuned))
  })

  it('reaches the deltas the panel draws', () => {
    // The end-to-end claim: pinning a bucket moves the number a builder sees.
    const deck = [0, 8, 12, 12, 10, 6, 3, 2]
    const before = curveDeltas(deck, curveTarget('midrange'))
    const after = curveDeltas(deck, curveTarget('midrange', null, { curve: { 6: 12 } }))
    expect(after[6]!.ideal).toBeGreaterThan(before[6]!.ideal)
    expect(after[6]!.withinRange).toBe(false)
    expect(after[6]!.delta).toBeGreaterThan(0)
  })
})

describe('archetypeTolerance', () => {
  it('reports the table value the customiser must show as the preset', () => {
    // If this drifted from what `curveTarget` uses, the sheet would show the
    // user a preset the deck is not actually judged by.
    expect(archetypeTolerance('midrange')).toBe(0.35)
    expect(archetypeTolerance('aggro')).toBe(0.25)
  })

  it('gives a hybrid the looser of its two, as the curve does', () => {
    expect(archetypeTolerance('aggro', 'ramp')).toBe(archetypeTolerance('ramp'))
    expect(archetypeTolerance('aggro', 'aggro')).toBe(archetypeTolerance('aggro'))
  })
})
