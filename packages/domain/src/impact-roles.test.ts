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

  /*
   * No exemptions. ADR-0037's `counterspell` and `bounce` were exempt for one
   * commit, because `roles` is written at ingest and the bands are generated
   * from it — so they had no cards until the operator re-ran the ingest. That
   * has happened, both roles are measured, and the self-clearing test that
   * guarded the exemption did its job and demanded its own deletion.
   *
   * Kept as a plain total assertion rather than an exemption list with nothing
   * in it: an empty list invites the next role to be added to it instead of
   * being measured.
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
