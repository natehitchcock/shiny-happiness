import { describe, expect, it } from 'vitest'
import { SYNERGY_TAGS } from '@roundtable/domain'
import { readable } from './tags.js'

/**
 * `readable` has a fallback — it strips hyphens — which is exactly why it needs
 * a test. A tag missing from the table does not throw and does not look broken;
 * it quietly renders the wire spelling ("player damage") inside a sentence
 * written for a person, and three tags sat like that until someone noticed.
 *
 * So the assertion is against `SYNERGY_TAGS` itself rather than a list retyped
 * here: adding a tag to the domain and forgetting the words is a failing test.
 */
describe('readable', () => {
  it('has words for every tag the domain defines', () => {
    // `treasure` is the one tag whose own name is already the words a reader
    // wants, so it is indistinguishable from the fallback by inspection. Named
    // here rather than silently allowed, because the next such tag should have
    // to be named too.
    const SAME_AS_ITS_NAME = new Set<string>(['treasure'])
    const missing = SYNERGY_TAGS.filter(
      (tag) => !SAME_AS_ITS_NAME.has(tag) && readable(tag) === tag.replace(/-/g, ' '),
    )

    expect(missing).toEqual([])
  })

  it('says which damage each damage tag means (ADR-0029)', () => {
    // Two tags one word apart, and the labels are the only place a reader can
    // tell them apart. `damage` is the wider event and contains `player-damage`.
    expect(readable('damage')).toBe('dealing damage')
    expect(readable('player-damage')).toBe('damage to opponents')
  })

  it('does not call the damage tag "burn"', () => {
    // The labels slot after "causes" and "benefits from". "Causes burn" names an
    // archetype where every other label names an event. `burn` is accepted in
    // the search box instead, as a query value alias.
    expect(readable('damage')).not.toContain('burn')
  })

  it('still falls back rather than throwing on a tag it has never seen', () => {
    expect(readable('not-a-tag')).toBe('not a tag')
  })
})
