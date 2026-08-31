import { describe, expect, it } from 'vitest'
import {
  CURVE_REFERENCE_SPELLS,
  DEFAULT_ROLE_TOLERANCE,
  NO_TARGET_OVERRIDES,
  hasTargetOverrides,
  parseTargetOverrides,
} from './target-overrides.js'

/**
 * The parser is the boundary between a `jsonb` column and the target functions
 * (doc 16). Everything it lets through reaches `compositionTargets` and
 * `curveTarget` as a number, so every test here is really about what a bad row
 * is allowed to do to a deck's targets — and the answer must always be
 * "nothing beyond the entry that is bad".
 */
describe('parseTargetOverrides', () => {
  it('keeps a well-formed sparse override intact', () => {
    expect(
      parseTargetOverrides({
        roles: { 'role:ramp': 12, 'type:creature': 18 },
        curve: { 2: 14 },
        tolerance: 0.2,
      }),
    ).toEqual({
      roles: { 'role:ramp': 12, 'type:creature': 18 },
      curve: { 2: 14 },
      tolerance: 0.2,
    })
  })

  it('is empty for anything that is not an object', () => {
    for (const value of [null, undefined, 3, 'x', [1, 2], true]) {
      expect(parseTargetOverrides(value)).toEqual({})
    }
  })

  it('omits a section entirely rather than emitting an empty one', () => {
    // `{ roles: {} }` and `{}` are the same deck. Emitting the first would make
    // `hasTargetOverrides` say a deck is customised when nothing is overridden,
    // and the UI would offer a reset that does nothing.
    expect(parseTargetOverrides({ roles: {}, curve: {} })).toEqual({})
  })

  it('drops a role key outside the dimension key space', () => {
    // A bare `ramp` would never match a target and would read, in the sheet, as
    // an override that silently does nothing.
    expect(parseTargetOverrides({ roles: { ramp: 12, 'role:draw': 9 } })).toEqual({
      roles: { 'role:draw': 9 },
    })
  })

  it('drops a count that is not a whole card', () => {
    expect(
      parseTargetOverrides({
        roles: { 'role:a': 'twelve', 'role:b': 3.5, 'role:c': -1, 'role:d': 100, 'role:e': 12 },
      }),
    ).toEqual({ roles: { 'role:e': 12 } })
  })

  it('drops a curve bucket outside 0..7', () => {
    // 8 is not a bucket. Kept, it would be an override the curve never applies
    // and the sheet cannot show — an edit the user made and cannot find again.
    expect(parseTargetOverrides({ curve: { '-1': 4, 8: 4, 7: 4 } })).toEqual({ curve: { 7: 4 } })
  })

  it('clamps a tolerance rather than discarding it', () => {
    // 1.4 is a legible intent ("as loose as it goes"). Dropping it would
    // silently restore the archetype's strictness, which is the opposite.
    expect(parseTargetOverrides({ tolerance: 1.4 }).tolerance).toBe(1)
    expect(parseTargetOverrides({ tolerance: -2 }).tolerance).toBe(0)
    expect(parseTargetOverrides({ tolerance: 0 }).tolerance).toBe(0)
  })

  it('drops a non-finite tolerance', () => {
    // NaN would propagate through every band half-width in the deck.
    expect(parseTargetOverrides({ tolerance: Number.NaN }).tolerance).toBeUndefined()
    expect(parseTargetOverrides({ tolerance: 'loose' }).tolerance).toBeUndefined()
  })

  it('survives a whole object of junk without losing the good parts', () => {
    expect(
      parseTargetOverrides({
        roles: [1, 2, 3],
        curve: 'nope',
        tolerance: 0.5,
        somethingElse: { deeply: { nested: true } },
      }),
    ).toEqual({ tolerance: 0.5 })
  })
})

describe('hasTargetOverrides', () => {
  it('is false for absent, empty, and empty-sectioned', () => {
    expect(hasTargetOverrides(undefined)).toBe(false)
    expect(hasTargetOverrides(NO_TARGET_OVERRIDES)).toBe(false)
    expect(hasTargetOverrides({ roles: {}, curve: {} })).toBe(false)
  })

  it('is true for any one section carrying something', () => {
    expect(hasTargetOverrides({ roles: { 'role:ramp': 1 } })).toBe(true)
    expect(hasTargetOverrides({ curve: { 0: 1 } })).toBe(true)
    // Zero is a real tolerance — the strictest one — not an absent setting.
    expect(hasTargetOverrides({ tolerance: 0 })).toBe(true)
  })
})

describe('the two constants the sheet and the domain share', () => {
  it('are the values every count in this feature is a count of', () => {
    // Pinned rather than merely documented: the web sheet converts the curve
    // preset from a share to a count with this exact number, and the domain
    // converts it back. If one moves and the other does not, a builder types 14
    // and the deck is judged against 12, with nothing anywhere saying why.
    expect(CURVE_REFERENCE_SPELLS).toBe(63)
    // The midrange row's own curve tolerance, which is what makes "leave the
    // slider alone" the identity for the role bands too.
    expect(DEFAULT_ROLE_TOLERANCE).toBe(0.35)
  })
})
