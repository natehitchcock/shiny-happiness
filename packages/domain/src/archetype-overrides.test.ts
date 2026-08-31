import { describe, expect, it } from 'vitest'
import { compositionTargets } from './archetype-targets.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import type { CompositionTarget } from './composition.js'
import { DEFAULT_ROLE_TOLERANCE } from './target-overrides.js'

const LAND = dimensionKey(roleDimension('land'))
const RAMP = dimensionKey(roleDimension('ramp'))
const DRAW = dimensionKey(roleDimension('draw'))
const STAX = dimensionKey(roleDimension('stax'))
const CREATURE = dimensionKey(typeDimension('creature'))

const byKey = (targets: readonly CompositionTarget[]): Map<string, CompositionTarget> =>
  new Map(targets.map((t) => [dimensionKey(t.dimension), t]))

const targetsFor = (
  overrides?: Parameters<typeof compositionTargets>[3],
  options: Parameters<typeof compositionTargets>[2] = { bracket: 3 },
): Map<string, CompositionTarget> => byKey(compositionTargets('midrange', null, options, overrides))

/**
 * Per-deck composition overrides (doc 16).
 *
 * The load-bearing property is SPARSENESS: a deck that overrides nothing must
 * behave exactly as it did before this existed, and a deck that overrides one
 * role must still inherit every later revision of the others.
 */
describe('compositionTargets with overrides', () => {
  it('is byte-identical to the un-overridden call when nothing is overridden', () => {
    // The whole promise of the feature to every existing deck. Checked against
    // three shapes of "nothing", because `{}` and `{ roles: {} }` and an absent
    // argument all reach different branches.
    const base = compositionTargets('control', 'ramp', { bracket: 4 })
    expect(compositionTargets('control', 'ramp', { bracket: 4 }, {})).toEqual(base)
    expect(compositionTargets('control', 'ramp', { bracket: 4 }, { roles: {} })).toEqual(base)
    expect(compositionTargets('control', 'ramp', { bracket: 4 }, { curve: { 2: 9 } })).toEqual(base)
  })

  it('moves only the dimension that was overridden', () => {
    const base = targetsFor()
    const tuned = targetsFor({ roles: { [RAMP]: 14 } })
    expect(tuned.get(RAMP)?.ideal).toBe(14)
    // Every other row still the archetype's, so a later revision of `draw`
    // still reaches this deck — the reason the override is sparse at all.
    for (const key of base.keys()) {
      if (key === RAMP) continue
      expect(tuned.get(key), key).toEqual(base.get(key))
    }
  })

  it('marks an overridden dimension as custom and leaves the rest as archetype', () => {
    // Pillar P4 reads this: a recommendation filling a gap the builder invented
    // has to say so, and this flag is where that fact enters the pipeline.
    const tuned = targetsFor({ roles: { [RAMP]: 14 } })
    expect(tuned.get(RAMP)?.source).toBe('custom')
    expect(tuned.get(DRAW)?.source).toBe('archetype')
  })

  it('adds a dimension the archetype does not name', () => {
    // A midrange deck wanting five stax pieces can say so without becoming a
    // stax deck. `preset` has nothing to show for such a row, which is why the
    // analysis reports null rather than zero for it.
    expect(targetsFor().has(STAX)).toBe(false)
    const tuned = targetsFor({ roles: { [STAX]: 5 } })
    expect(tuned.get(STAX)?.ideal).toBe(5)
    expect(tuned.get(STAX)?.source).toBe('custom')
  })

  it('lets a count of zero mean zero rather than reading as absent', () => {
    const tuned = targetsFor({ roles: { [DRAW]: 0 } })
    expect(tuned.get(DRAW)?.ideal).toBe(0)
    expect(tuned.get(DRAW)?.min).toBe(0)
    expect(tuned.get(DRAW)?.source).toBe('custom')
  })

  it('gives an overridden land count exactly, past the curve modifier', () => {
    // The divergence from doc 16 that this function documents. A cheap deck
    // gets a land subtracted from the PRESET; a builder who typed 36 while
    // looking at that same cheap deck has already accounted for it, and seeing
    // the meter read 35 is a form they cannot control.
    const cheap = { bracket: 3 as const, averageManaValue: 2.1 }
    expect(targetsFor(undefined, cheap).get(LAND)?.ideal).toBe(
      (targetsFor(undefined, { bracket: 3 }).get(LAND)?.ideal ?? 0) - 1,
    )
    expect(targetsFor({ roles: { [LAND]: 36 } }, cheap).get(LAND)?.ideal).toBe(36)
  })

  it('gives an overridden draw count exactly, past the bracket modifier', () => {
    const b5 = { bracket: 5 as const }
    // The modifier is real for a row nobody touched...
    expect(targetsFor(undefined, b5).get(DRAW)?.ideal).toBe(
      (targetsFor().get(DRAW)?.ideal ?? 0) + 2,
    )
    // ...and does not double up on the number the builder typed.
    expect(targetsFor({ roles: { [DRAW]: 11 } }, b5).get(DRAW)?.ideal).toBe(11)
    // The OTHER bracket-modified row still gets its bump, so overriding one
    // dimension has not switched the modifier off for the deck.
    const removal = dimensionKey(roleDimension('spot-removal'))
    expect(targetsFor({ roles: { [DRAW]: 11 } }, b5).get(removal)?.ideal).toBe(
      targetsFor(undefined, b5).get(removal)?.ideal,
    )
  })

  it('narrows every band when the deck is set stricter than the default', () => {
    const loose = targetsFor()
    const strict = targetsFor({ tolerance: 0.1 })
    for (const [key, band] of loose) {
      const tightened = strict.get(key)!
      expect(tightened.max - tightened.min, key).toBeLessThan(band.max - band.min)
    }
  })

  it('widens every band when the deck is set looser', () => {
    const loose = targetsFor({ tolerance: 1 })
    for (const [key, band] of targetsFor()) {
      expect(loose.get(key)!.max - loose.get(key)!.min, key).toBeGreaterThan(band.max - band.min)
    }
  })

  it('leaves the bands untouched at the default tolerance', () => {
    // The identity that makes one slider serve both halves of the sheet: 0.35
    // is the midrange row's own curve tolerance, so setting it explicitly must
    // change nothing at all.
    expect(targetsFor({ tolerance: DEFAULT_ROLE_TOLERANCE })).toEqual(
      byKey(
        compositionTargets('midrange', null, { bracket: 3 }).map((t) => ({
          ...t,
          source: 'archetype' as const,
        })),
      ),
    )
  })

  it('never collapses a band to a point, however strict the deck is set', () => {
    // A target you can only hit exactly is one every deck fails, and every
    // meter would be red forever. Same argument as `MIN_HALF_WIDTH` in curve.ts.
    for (const [key, band] of targetsFor({ tolerance: 0 })) {
      expect(band.max - band.ideal, key).toBeGreaterThanOrEqual(1)
      // `min` floors at zero, so a zero-ideal row is allowed to be one-sided.
      expect(band.max - band.min, key).toBeGreaterThanOrEqual(1)
    }
  })

  it('applies the tolerance to the creature type row as well as the roles', () => {
    // The type row is the one a role-keyed override could not have reached, and
    // is why the override map is keyed by dimension rather than by `Role`.
    const strict = targetsFor({ tolerance: 0.1, roles: { [CREATURE]: 18 } })
    expect(strict.get(CREATURE)?.ideal).toBe(18)
    expect(strict.get(CREATURE)?.max).toBeLessThan(24)
  })

  it('ignores an override key that names no dimension', () => {
    // `parseTargetOverrides` should have removed it; if something else writes
    // the column, an unnameable row must not appear in the meters.
    const tuned = compositionTargets('midrange', null, { bracket: 3 }, { roles: { nonsense: 4 } })
    expect(tuned).toEqual(compositionTargets('midrange', null, { bracket: 3 }))
  })
})
