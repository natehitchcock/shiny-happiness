import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeKey } from './archetype.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import { assessArchetype, compositionTargets } from './archetype-targets.js'

const LAND = dimensionKey(roleDimension('land'))
const RAMP = dimensionKey(roleDimension('ramp'))
const DRAW = dimensionKey(roleDimension('draw'))
const REMOVAL = dimensionKey(roleDimension('spot-removal'))
const CREATURE = dimensionKey(typeDimension('creature'))

const idealsOf = (archetype: ArchetypeKey, secondary: ArchetypeKey | null = null, bracket = 3) =>
  new Map(
    compositionTargets(archetype, secondary, { bracket: bracket as 1 | 2 | 3 | 4 | 5 }).map((t) => [
      dimensionKey(t.dimension),
      t.ideal,
    ]),
  )

describe('compositionTargets', () => {
  it('covers every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const targets = compositionTargets(archetype, null, { bracket: 3 })
      expect(targets.length).toBeGreaterThan(0)
      expect(idealsOf(archetype).get(LAND)).toBeGreaterThan(0)
    }
  })

  it('gives control more draw and removal than aggro, and far fewer creatures', () => {
    const control = idealsOf('control')
    const aggro = idealsOf('aggro')
    expect(control.get(DRAW)!).toBeGreaterThan(aggro.get(DRAW)!)
    expect(control.get(REMOVAL)!).toBeGreaterThan(aggro.get(REMOVAL)!)
    expect(control.get(CREATURE)!).toBeLessThan(aggro.get(CREATURE)!)
  })

  it('gives ramp decks the most ramp and the most lands', () => {
    const ramp = idealsOf('ramp')
    for (const other of ARCHETYPES) {
      if (other === 'ramp') continue
      expect(ramp.get(RAMP)!).toBeGreaterThanOrEqual(idealsOf(other).get(RAMP)!)
    }
  })

  it('adds archetype-specific dimensions only where the archetype names them', () => {
    expect(idealsOf('tokens').has(dimensionKey(roleDimension('token-maker')))).toBe(true)
    expect(idealsOf('control').has(dimensionKey(roleDimension('token-maker')))).toBe(false)
    expect(idealsOf('voltron').has(dimensionKey(roleDimension('equipment')))).toBe(true)
    expect(idealsOf('aristocrats').has(dimensionKey(roleDimension('sac-outlet')))).toBe(true)
  })

  it('always returns a range with the ideal inside it', () => {
    for (const target of compositionTargets('midrange', null, { bracket: 3 })) {
      expect(target.min).toBeLessThanOrEqual(target.ideal)
      expect(target.ideal).toBeLessThanOrEqual(target.max)
      expect(target.min).toBeGreaterThanOrEqual(0)
    }
  })

  describe('hybrid blending', () => {
    it('blends 70/30 toward the primary and rounds to whole cards', () => {
      const combo = idealsOf('combo').get(DRAW)! // 10
      const control = idealsOf('control').get(DRAW)! // 12
      const blended = idealsOf('combo', 'control').get(DRAW)!
      expect(blended).toBe(Math.round(combo * 0.7 + control * 0.3))
      expect(Number.isInteger(blended)).toBe(true)
    })

    it('every blended ideal is a whole number', () => {
      for (const target of compositionTargets('voltron', 'aggro', { bracket: 3 })) {
        expect(Number.isInteger(target.ideal)).toBe(true)
      }
    })

    it('carries a dimension only the secondary names, at reduced weight', () => {
      const blended = idealsOf('control', 'tokens')
      const tokenMaker = blended.get(dimensionKey(roleDimension('token-maker')))
      expect(tokenMaker).toBeDefined()
      expect(tokenMaker!).toBeLessThan(idealsOf('tokens').get(dimensionKey(roleDimension('token-maker')))!)
    })

    it('is a no-op when the secondary equals the primary', () => {
      expect([...idealsOf('combo', 'combo')]).toEqual([...idealsOf('combo')])
    })
  })

  describe('modifiers apply on top of the archetype row', () => {
    it('drops a land for a low curve and adds one for a high curve', () => {
      const base = compositionTargets('midrange', null, { bracket: 3 })
      const low = compositionTargets('midrange', null, { bracket: 3, averageManaValue: 2.4 })
      const high = compositionTargets('midrange', null, { bracket: 3, averageManaValue: 3.9 })
      const land = (ts: readonly { dimension: unknown; ideal: number }[]) =>
        ts.find((t) => dimensionKey(t.dimension as never) === LAND)!.ideal
      expect(land(low)).toBe(land(base) - 1)
      expect(land(high)).toBe(land(base) + 1)
    })

    it('trades roughly one land for every two modal land-backs', () => {
      const base = idealsOf('midrange').get(LAND)!
      const withBacks = new Map(
        compositionTargets('midrange', null, { bracket: 3, modalLandBacks: 4 }).map((t) => [
          dimensionKey(t.dimension),
          t.ideal,
        ]),
      ).get(LAND)!
      expect(withBacks).toBe(base - 2)
    })

    it('raises draw and interaction at high brackets and lowers them at bracket 1', () => {
      expect(idealsOf('midrange', null, 5).get(DRAW)!).toBe(idealsOf('midrange', null, 3).get(DRAW)! + 2)
      expect(idealsOf('midrange', null, 4).get(REMOVAL)!).toBe(idealsOf('midrange', null, 3).get(REMOVAL)! + 1)
      expect(idealsOf('midrange', null, 1).get(DRAW)!).toBe(idealsOf('midrange', null, 3).get(DRAW)! - 1)
    })

    it('never produces a negative ideal', () => {
      const targets = compositionTargets('aggro', null, {
        bracket: 1,
        averageManaValue: 1.2,
        modalLandBacks: 200,
      })
      for (const t of targets) expect(t.ideal).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('assessArchetype', () => {
  const vectorFor = (archetype: ArchetypeKey): ReadonlyMap<string, number> =>
    new Map(
      compositionTargets(archetype, null, { bracket: 3 }).map((t) => [
        dimensionKey(t.dimension),
        t.ideal,
      ]),
    )

  // Every archetype row must be recognisable from its own ideal vector, or the
  // assessment is not measuring what it claims to.
  it.each(ARCHETYPES)('recognises a deck built exactly to the %s ideals', (archetype) => {
    expect(assessArchetype(vectorFor(archetype)).assessed).toBe(archetype)
  })

  it('is deterministic', () => {
    const v = vectorFor('control')
    expect(assessArchetype(v)).toEqual(assessArchetype(v))
  })

  it('reports the dimensions that drove the verdict', () => {
    const result = assessArchetype(vectorFor('tokens'))
    expect(result.drivers.length).toBeGreaterThan(0)
    expect(result.drivers.length).toBeLessThanOrEqual(3)
  })

  it('calls an aggro-shaped deck aggro even when it was declared as control', () => {
    const aggroLike = new Map([
      [LAND, 34],
      [RAMP, 9],
      [DRAW, 8],
      [REMOVAL, 7],
      [CREATURE, 32],
    ])
    expect(assessArchetype(aggroLike).assessed).toBe('aggro')
  })

  it('gives an empty deck a verdict without throwing', () => {
    const result = assessArchetype(new Map())
    expect(ARCHETYPES).toContain(result.assessed)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('keeps confidence in [0,1] for every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const { confidence } = assessArchetype(vectorFor(archetype))
      expect(confidence).toBeGreaterThanOrEqual(0)
      expect(confidence).toBeLessThanOrEqual(1)
    }
  })
})
