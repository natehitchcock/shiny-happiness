import { describe, expect, it } from 'vitest'
import {
  IMPACT_ROLE_BANDS,
  impactRolePlacement,
  roleImpactBand,
  roleImpactIsMostlyUnreadable,
  type RoleImpactBand,
} from './impact-roles.js'
import { ROLE_PRECEDENCE, primaryRole, type Role } from './role.js'

/**
 * FIXTURES, not the shipped file, for every test about behaviour.
 *
 * `IMPACT_ROLE_BANDS` is regenerated from the corpus and is expected to move —
 * a test pinned to today's quartiles would go red on the next regeneration for
 * no reason anyone could act on. The tests that check the SHIPPED file say so in
 * their names; everything else uses these.
 *
 * The two fixtures are deliberately NOT the same shape. A fixture set in which
 * every role had the same band could not tell "placed against its own role" from
 * "placed against a constant", which is the entire claim of this module.
 */
const WIDE: RoleImpactBand = {
  n: 500,
  q1: 6,
  median: 7,
  q3: 8,
  noCountableEffect: 10,
}
const NARROW: RoleImpactBand = {
  n: 1000,
  q1: 0.5,
  median: 0.6,
  q3: 1,
  noCountableEffect: 800,
}

describe('impactRolePlacement', () => {
  it('reads below the first quartile as the bottom quarter', () => {
    expect(impactRolePlacement(5.9, WIDE)).toBe('bottom-quarter')
  })

  it('reads between the quartiles as the middle half', () => {
    expect(impactRolePlacement(7, WIDE)).toBe('middle-half')
  })

  it('reads above the third quartile as the top quarter', () => {
    expect(impactRolePlacement(8.1, WIDE)).toBe('top-quarter')
  })

  /**
   * The boundaries belong to the band they bound.
   *
   * Wrath of God scores exactly the board-wipe q1 in the shipped corpus, and
   * calling the most recognised wrath in the format "bottom quarter" by a hair
   * would be the interface picking a fight it cannot win. A card ON a quartile
   * is inside the middle half, both ends.
   */
  it('counts a card sitting exactly on a quartile as the middle half', () => {
    expect(impactRolePlacement(6, WIDE)).toBe('middle-half')
    expect(impactRolePlacement(8, WIDE)).toBe('middle-half')
  })

  /**
   * THE WHOLE POINT: the same score is a different statement in two roles.
   *
   * 6.0 is an unremarkable board wipe and an extraordinary ramp card, and a
   * metric that said one thing about both would be the "aim for 6+" advice this
   * module exists to prevent.
   */
  it('places one score differently in two roles', () => {
    expect(impactRolePlacement(6, WIDE)).toBe('middle-half')
    expect(impactRolePlacement(6, NARROW)).toBe('top-quarter')
  })
})

describe('roleImpactIsMostlyUnreadable', () => {
  it('is true only when MORE than half the role names nothing to count', () => {
    // The threshold is a plain-language majority, not a tuned number — the copy
    // it gates says "most cards in this role" — so exactly half must be false.
    expect(roleImpactIsMostlyUnreadable({ ...WIDE, n: 100, noCountableEffect: 51 })).toBe(true)
    expect(roleImpactIsMostlyUnreadable({ ...WIDE, n: 100, noCountableEffect: 50 })).toBe(false)
    expect(roleImpactIsMostlyUnreadable({ ...WIDE, n: 100, noCountableEffect: 49 })).toBe(false)
  })

  it('separates the roles the shipped model cannot see from the ones it can', () => {
    // Against the SHIPPED bands, because the pane swaps its caveat on this and
    // a version that answered the same for every role would make that copy a
    // decoration. Lands and ramp are the cards a low score misleads about;
    // board wipes and spot removal are read in full.
    expect(roleImpactIsMostlyUnreadable(roleImpactBand('land') as RoleImpactBand)).toBe(true)
    expect(roleImpactIsMostlyUnreadable(roleImpactBand('ramp') as RoleImpactBand)).toBe(true)
    expect(roleImpactIsMostlyUnreadable(roleImpactBand('board-wipe') as RoleImpactBand)).toBe(false)
    expect(roleImpactIsMostlyUnreadable(roleImpactBand('spot-removal') as RoleImpactBand)).toBe(
      false,
    )
  })
})

describe('roleImpactBand', () => {
  it('returns the shipped band for a role the corpus measured', () => {
    const band = roleImpactBand('board-wipe')
    expect(band).not.toBeNull()
    expect(band?.n).toBeGreaterThan(0)
  })

  it('returns null for a role the shipped data has no cards for', () => {
    // Not a `Role`: the data is keyed by role name and a regeneration against a
    // corpus that never derived one must read as absent, not as zeroes.
    expect(roleImpactBand('not-a-role' as Role)).toBeNull()
  })
})

describe('the shipped bands', () => {
  /*
   * NO EXEMPTIONS, and there is a story in that.
   *
   * ADR-0037 added `counterspell` and `bounce`, which had no cards until the
   * operator re-ran the ingest — the bands are generated from `cards.roles`, so
   * regenerating early would have written zero-card entries, which
   * `impact-roles.ts` is explicit must never happen: a role with no cards has
   * to read as ABSENT, not as zeroes.
   *
   * So the exemption shipped with a test asserting the two roles really were
   * unmeasured, which failed the moment the bands were regenerated and demanded
   * its own deletion. That is exactly what happened, one commit later.
   *
   * Left as a plain total assertion rather than an emptied list: an empty
   * exemption list is an invitation to add the next role to it instead of
   * measuring it.
   */
  it('covers every role in the vocabulary', () => {
    for (const role of ROLE_PRECEDENCE) {
      expect(roleImpactBand(role), role).not.toBeNull()
    }
  })

  it('is ordered: q1 <= median <= q3', () => {
    for (const [role, band] of Object.entries(IMPACT_ROLE_BANDS)) {
      expect(band.q1, role).toBeLessThanOrEqual(band.median)
      expect(band.median, role).toBeLessThanOrEqual(band.q3)
    }
  })

  it('never reports more effect-less cards than cards', () => {
    for (const [role, band] of Object.entries(IMPACT_ROLE_BANDS)) {
      expect(band.n, role).toBeGreaterThan(0)
      expect(band.noCountableEffect, role).toBeGreaterThanOrEqual(0)
      expect(band.noCountableEffect, role).toBeLessThanOrEqual(band.n)
    }
  })

  /**
   * The bands must actually DISCRIMINATE, or the feature is decoration.
   *
   * If every role's band were the same the pane would print eighteen ways of
   * saying the corpus median, and no test above would notice — the ordering and
   * sanity checks all pass on a uniform table. This is the one that fails.
   */
  it('separates the roles the model reads well from the ones it does not', () => {
    const wipe = roleImpactBand('board-wipe')
    const ramp = roleImpactBand('ramp')
    const land = roleImpactBand('land')
    // A board wipe's WORST quartile is above a ramp card's best, so "6.0" is
    // ordinary for one and exceptional for the other.
    expect(wipe?.q1).toBeGreaterThan(ramp?.q3 as number)
    // And the model reads most lands as having nothing to count, which is what
    // makes a land's band a fact about the metric rather than about lands.
    expect((land?.noCountableEffect as number) * 2).toBeGreaterThan(land?.n as number)
    // Spot removal is the control: the model reads every one of them.
    expect(roleImpactBand('spot-removal')?.noCountableEffect).toBe(0)
  })

  /**
   * A card is always inside the population it is placed against.
   *
   * The pane shows one role — the card's `primaryRole` — and places the card
   * against the cards that hold that role. That is only sound because
   * `primaryRole` returns a member of the set it was given, so the card being
   * placed is one of the `n` it is being compared to.
   */
  it('places a card against a role that card actually holds', () => {
    const roles: readonly Role[] = ['spot-removal', 'token-maker']
    expect(roles).toContain(primaryRole(roles))
  })
})
