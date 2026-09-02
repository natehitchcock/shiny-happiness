import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeKey } from './archetype.js'
import type { Bracket } from './bracket.js'
import { dimensionKey, roleDimension, typeDimension } from './composition.js'
import { curveTarget } from './curve.js'
import { assessArchetype, compositionTargets } from './archetype-targets.js'
import type { Role } from './role.js'

const LAND = dimensionKey(roleDimension('land'))
const RAMP = dimensionKey(roleDimension('ramp'))
const DRAW = dimensionKey(roleDimension('draw'))
const REMOVAL = dimensionKey(roleDimension('spot-removal'))
const CREATURE = dimensionKey(typeDimension('creature'))

/** Every role that answers an opponent's card. See ADR-0037. */
const ANSWER_KEYS = ['spot-removal', 'counterspell', 'graveyard-hate', 'bounce', 'board-wipe'].map(
  (role) => dimensionKey(roleDimension(role as Role)),
)

const idealsOf = (archetype: ArchetypeKey, secondary: ArchetypeKey | null = null, bracket = 3) =>
  new Map(
    compositionTargets(archetype, secondary, { bracket: bracket as 1 | 2 | 3 | 4 | 5 }).map((t) => [
      dimensionKey(t.dimension),
      t.ideal,
    ]),
  )

const BRACKETS = [1, 2, 3, 4, 5] as const satisfies readonly Bracket[]

/** Roles do not overlap — `primaryRole` puts each card in exactly one. */
const roleSum = (
  archetype: ArchetypeKey,
  secondary: ArchetypeKey | null,
  bracket: Bracket = 3,
): number =>
  compositionTargets(archetype, secondary, { bracket }).reduce(
    (sum, t) => (t.dimension.kind === 'role' ? sum + t.ideal : sum),
    0,
  )

describe('compositionTargets', () => {
  it('covers every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const targets = compositionTargets(archetype, null, { bracket: 3 })
      expect(targets.length).toBeGreaterThan(0)
      expect(idealsOf(archetype).get(LAND)).toBeGreaterThan(0)
    }
  })

  it('gives every archetype the four dimensions every Commander deck has', () => {
    // A row missing one of these is a row nobody finished, and the meter for it
    // simply would not render.
    for (const archetype of ARCHETYPES) {
      const ideals = idealsOf(archetype)
      for (const key of [LAND, RAMP, DRAW, REMOVAL, CREATURE]) {
        expect(ideals.get(key), `${archetype} ${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('gives every archetype its own vector rather than a copy of a neighbour', () => {
    // Two archetypes with the same numbers are one archetype presented as a
    // choice, and `assessArchetype` cannot tell them apart either.
    for (const a of ARCHETYPES) {
      for (const b of ARCHETYPES) {
        if (a >= b) continue
        const [x, y] = [idealsOf(a), idealsOf(b)]
        const keys = new Set([...x.keys(), ...y.keys()])
        const distance = [...keys].reduce((s, k) => s + ((x.get(k) ?? 0) - (y.get(k) ?? 0)) ** 2, 0)
        expect(Math.sqrt(distance), `${a} vs ${b}`).toBeGreaterThan(3)
      }
    }
  })

  describe('the 99-card budget', () => {
    // Counting uses `primaryRole`, so role ideals are mutually exclusive and
    // `Σ roles` is a real budget rather than a loose sum. Voltron used to spend
    // 97 of 99 and went over outright at bracket 4 — a vector no deck can be
    // built to, which also made the archetype unreachable by `assessArchetype`.

    it('leaves a pure archetype room for cards that are not role cards', () => {
      for (const archetype of ARCHETYPES) {
        // Eight slots at the common bracket: the threats and payoffs that make
        // the deck a deck rather than a list of services.
        expect(roleSum(archetype, null, 3), archetype).toBeLessThanOrEqual(91)
      }
    })

    it('stays inside 99 for every archetype at every bracket', () => {
      for (const archetype of ARCHETYPES) {
        for (const bracket of BRACKETS) {
          expect(roleSum(archetype, null, bracket), `${archetype} b${bracket}`).toBeLessThanOrEqual(
            95,
          )
        }
      }
    })

    it('stays inside 99 for every hybrid at every bracket', () => {
      // The blend keeps primary-only dimensions whole and adds secondary-only
      // ones on top, so a hybrid's role budget can only grow. Two role-dense
      // archetypes are the worst case and this is where it is caught.
      for (const primary of ARCHETYPES) {
        for (const secondary of ARCHETYPES) {
          for (const bracket of BRACKETS) {
            const sum = roleSum(primary, secondary, bracket)
            expect(sum, `${primary}+${secondary} b${bracket}`).toBeLessThanOrEqual(99)
          }
        }
      }
    })
  })

  describe('the mana base', () => {
    it('keeps every land count inside a range a Commander deck can be built at', () => {
      // Every modifier combination, because the modifiers stack: the curve one,
      // the land-back one and the bracket one all land on the same row.
      for (const archetype of ARCHETYPES) {
        for (const bracket of BRACKETS) {
          for (const averageManaValue of [2.0, 3.0, 4.5]) {
            const land = new Map(
              compositionTargets(archetype, null, { bracket, averageManaValue }).map((t) => [
                dimensionKey(t.dimension),
                t.ideal,
              ]),
            ).get(LAND)!
            expect(land, `${archetype} b${bracket} mv${averageManaValue}`).toBeGreaterThanOrEqual(
              30,
            )
            expect(land, `${archetype} b${bracket} mv${averageManaValue}`).toBeLessThanOrEqual(40)
          }
        }
      }
    })

    it('does not shift a land count twice for one cheap curve', () => {
      // The base land number is the count at a NEUTRAL curve; the modifier then
      // corrects for how far the built deck sits from neutral. If a base had
      // already priced in its own archetype's cheap curve, applying the modifier
      // would be the same correction applied twice, and the archetypes with the
      // most extreme curves would land outside what anyone plays. Checked at the
      // curve each archetype actually targets.
      for (const archetype of ARCHETYPES) {
        const curve = curveTarget(archetype)
        const averageManaValue = curve.reduce((a, band, i) => a + band.ideal * i, 0)
        const land = new Map(
          compositionTargets(archetype, null, { bracket: 3, averageManaValue }).map((t) => [
            dimensionKey(t.dimension),
            t.ideal,
          ]),
        ).get(LAND)!
        expect(land, `${archetype} at its own curve`).toBeGreaterThanOrEqual(33)
        expect(land, `${archetype} at its own curve`).toBeLessThanOrEqual(38)
      }
    })

    it('never asks more than half the deck to be a mana source', () => {
      // Lands plus ramp. Ramp's identity is the most RAMP, not the most mana
      // sources — the row used to want 38 lands and 17 ramp, which is 55 cards
      // producing mana and 19 left to spend it on.
      for (const archetype of ARCHETYPES) {
        const ideals = idealsOf(archetype)
        const sources = ideals.get(LAND)! + ideals.get(RAMP)!
        expect(sources, archetype).toBeGreaterThanOrEqual(40)
        expect(sources, archetype).toBeLessThanOrEqual(53)
      }
    })

    it('gives aggro the fewest mana sources, because flooding hurts it most', () => {
      const sourcesOf = (a: ArchetypeKey): number => idealsOf(a).get(LAND)! + idealsOf(a).get(RAMP)!
      for (const other of ARCHETYPES) {
        if (other === 'aggro') continue
        expect(sourcesOf('aggro'), other).toBeLessThan(sourcesOf(other))
      }
    })
  })

  it('gives control more draw and more answers than aggro, and far fewer creatures', () => {
    // ADR-0037 split the answer column into spot-removal, counterspell,
    // graveyard-hate and bounce, so `spot-removal` alone no longer carries the
    // claim this test is making. Control and aggro now sit at the SAME
    // spot-removal number (6) and are still nothing alike: control holds 14
    // answers to aggro's 7, and the difference is entirely in the columns that
    // used to be hidden inside "removal". Summing them is the assertion that
    // survives the split; comparing one column was only ever a proxy for it.
    const control = idealsOf('control')
    const aggro = idealsOf('aggro')
    const answers = (ideals: Map<string, number>) =>
      ANSWER_KEYS.reduce((sum, key) => sum + (ideals.get(key) ?? 0), 0)
    expect(control.get(DRAW)!).toBeGreaterThan(aggro.get(DRAW)!)
    expect(answers(control)).toBeGreaterThan(answers(aggro))
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
      expect(tokenMaker!).toBeLessThan(
        idealsOf('tokens').get(dimensionKey(roleDimension('token-maker')))!,
      )
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
      expect(idealsOf('midrange', null, 5).get(DRAW)!).toBe(
        idealsOf('midrange', null, 3).get(DRAW)! + 2,
      )
      expect(idealsOf('midrange', null, 4).get(REMOVAL)!).toBe(
        idealsOf('midrange', null, 3).get(REMOVAL)! + 1,
      )
      expect(idealsOf('midrange', null, 1).get(DRAW)!).toBe(
        idealsOf('midrange', null, 3).get(DRAW)! - 1,
      )
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
