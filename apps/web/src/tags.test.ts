import { describe, expect, it } from 'vitest'
import { EVENT_TAGS, SEMANTIC_TAGS, SYNERGY_TAGS } from '@roundtable/domain'
import { readable } from './tags.js'

/**
 * `readable` has a fallback — it strips hyphens — which is exactly why it needs
 * a test. A tag missing from the table does not throw and does not look broken;
 * it quietly renders the wire spelling ("player damage") inside a sentence
 * written for a person, and three tags sat like that until someone noticed.
 *
 * So the assertion is against the domain's own lists rather than one retyped
 * here: adding a tag to the domain and forgetting the words is a failing test.
 *
 * The assertion is against `EVENT_TAGS` rather than `SYNERGY_TAGS` since
 * ADR-0046, and the split is the point rather than a loosening. The 22 curated
 * events each need a phrase somebody wrote, because their names are jargon —
 * "artifact etb" is not a sentence. The 558 derived tags need none, because
 * their names are already the words: a subtype's phrase is the subtype and a
 * keyword's is the keyword. Both halves are still checked, one for a written
 * phrase and one for a derived one, and neither may fall through to the
 * hyphen-stripper.
 */
describe('readable', () => {
  it('has hand-written words for every CURATED event the domain defines', () => {
    // `treasure` is the one tag whose own name is already the words a reader
    // wants, so it is indistinguishable from the fallback by inspection. Named
    // here rather than silently allowed, because the next such tag should have
    // to be named too.
    const SAME_AS_ITS_NAME = new Set<string>(['treasure'])
    const missing = EVENT_TAGS.filter(
      (tag) => !SAME_AS_ITS_NAME.has(tag) && readable(tag) === tag.replace(/-/g, ' '),
    )

    expect(missing).toEqual([])
  })

  it('derives words for every semantic token without a table (ADR-0046)', () => {
    // The claim this test exists to hold: 558 tags and not one hand-written
    // phrase. A derived tag that reached the hyphen-stripping fallback would
    // render "subtype elf" in a sentence written for a person.
    const fellThrough = SEMANTIC_TAGS.filter((tag) => readable(tag) === tag.replace(/-/g, ' '))

    expect(fellThrough).toEqual([])
  })

  it('names a subtype by its plural and a keyword by its word', () => {
    // "This card benefits from Elves." / "…benefits from flying."
    expect(readable('subtype:elf')).toBe('Elves')
    expect(readable('subtype:equipment')).toBe('Equipment')
    expect(readable('ability:flying')).toBe('flying')
    expect(readable('ability:first-strike')).toBe('first strike')
  })

  it('lets a hand-written phrase win over a derived one', () => {
    // Order matters in `readable`: the curated table is consulted first, because
    // a phrase is written exactly where the derived one would read wrong. If a
    // future tag ever collides across the two families, the written one wins.
    for (const tag of EVENT_TAGS) expect(SEMANTIC_TAGS).not.toContain(tag)
  })

  it('still covers everything in SYNERGY_TAGS between the two halves', () => {
    // The union is what the rest of the app actually renders, so the split above
    // must not have left a gap between the two lists.
    expect(new Set(SYNERGY_TAGS)).toEqual(new Set([...EVENT_TAGS, ...SEMANTIC_TAGS]))
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
