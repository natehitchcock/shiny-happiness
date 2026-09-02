import { describe, expect, it } from 'vitest'
import {
  bySupport,
  EMPHASIS_FLOOR,
  emphasisMatches,
  emphasisScore,
  hasEmphasis,
  NO_EMPHASIS,
  parseSemanticEmphasis,
  relatedSemantics,
  remainingSemantics,
  type SemanticEmphasis,
} from './semantic-emphasis.js'
import {
  COMMANDER_WEIGHT,
  interactsWith,
  SYNERGY_TAGS,
  type SynergyMatch,
  type SynergyProfile,
  type SynergyTag,
} from './synergy.js'

const profile = (over: Partial<SynergyProfile> = {}): SynergyProfile => ({
  produces: over.produces ?? [],
  wants: over.wants ?? [],
})

/** Canonical order, so a test can state "in `SYNERGY_TAGS` order" as an assertion. */
const byTagOrder = (a: SynergyTag, b: SynergyTag): number =>
  SYNERGY_TAGS.indexOf(a) - SYNERGY_TAGS.indexOf(b)

describe('parseSemanticEmphasis', () => {
  it('keeps the tags it knows', () => {
    expect(parseSemanticEmphasis(['opponent-discard', 'untap'])).toEqual([
      'untap',
      'opponent-discard',
    ])
  })

  it('drops a tag this build does not know rather than the whole emphasis', () => {
    // A row written by a newer build. Losing one tag is recoverable; refusing to
    // open the deck is not.
    expect(parseSemanticEmphasis(['opponent-discard', 'mill-yourself'])).toEqual([
      'opponent-discard',
    ])
  })

  it('drops non-strings', () => {
    expect(parseSemanticEmphasis([1, null, { tag: 'untap' }, 'untap'])).toEqual(['untap'])
  })

  it('deduplicates', () => {
    expect(parseSemanticEmphasis(['untap', 'untap', 'untap'])).toEqual(['untap'])
  })

  it('sorts into SYNERGY_TAGS order regardless of the order clicked', () => {
    // Determinism (doc 05): the same set must serialise identically, or a round
    // trip through the database could reorder a scoring tie.
    const a = parseSemanticEmphasis(['opponent-discard', 'lifegain', 'untap'])
    const b = parseSemanticEmphasis(['untap', 'opponent-discard', 'lifegain'])
    expect(a).toEqual(b)
    expect(a).toEqual(['lifegain', 'untap', 'opponent-discard'])
  })

  it('reads every non-array as no emphasis', () => {
    for (const value of [null, undefined, {}, 'untap', 7]) {
      expect(parseSemanticEmphasis(value)).toEqual(NO_EMPHASIS)
    }
  })

  it('reads an array of nothing usable as no emphasis', () => {
    expect(parseSemanticEmphasis(['nonsense', 4])).toEqual(NO_EMPHASIS)
  })
})

describe('hasEmphasis', () => {
  it('is false for absent and for empty alike', () => {
    // A UI that called `[]` "customised" would offer a clear button that does
    // nothing.
    expect(hasEmphasis(undefined)).toBe(false)
    expect(hasEmphasis([])).toBe(false)
  })

  it('is true once a tag is emphasised', () => {
    expect(hasEmphasis(['untap'])).toBe(true)
  })
})

describe('emphasisMatches', () => {
  const emphasis: SemanticEmphasis = ['opponent-discard']

  it('is empty when nothing is emphasised', () => {
    const matches: readonly SynergyMatch[] = [
      { tag: 'opponent-discard', direction: 'enables', weight: 4 },
    ]
    expect(emphasisMatches(profile({ produces: ['opponent-discard'] }), matches, [])).toEqual([])
  })

  it('picks up an existing match on an emphasised tag, keeping its direction', () => {
    const matches: readonly SynergyMatch[] = [
      { tag: 'creature-death', direction: 'enables', weight: 6 },
      { tag: 'opponent-discard', direction: 'payoff', weight: 4 },
    ]
    expect(
      emphasisMatches(
        profile({ wants: ['opponent-discard', 'creature-death'] }),
        matches,
        emphasis,
      ),
    ).toEqual([{ tag: 'opponent-discard', direction: 'payoff', weight: 4 }])
  })

  it('ignores matches on tags that are not emphasised', () => {
    const matches: readonly SynergyMatch[] = [
      { tag: 'creature-death', direction: 'enables', weight: 9 },
    ]
    expect(emphasisMatches(profile({ produces: ['creature-death'] }), matches, emphasis)).toEqual(
      [],
    )
  })

  it('floors a tag the deck does not do yet, so the click is not inert', () => {
    // The whole point of `EMPHASIS_FLOOR`: emphasise something read off a card
    // in the feed rather than off the commander and the deck has no weight for
    // it, so a pure multiplier would multiply zero and nothing would move.
    expect(emphasisMatches(profile({ produces: ['opponent-discard'] }), [], emphasis)).toEqual([
      { tag: 'opponent-discard', direction: 'theme', weight: EMPHASIS_FLOOR },
    ])
  })

  it('floors from the wants side too', () => {
    expect(emphasisMatches(profile({ wants: ['opponent-discard'] }), [], emphasis)).toEqual([
      { tag: 'opponent-discard', direction: 'theme', weight: EMPHASIS_FLOOR },
    ])
  })

  it('gives a card no credit for an emphasised tag it does not carry', () => {
    expect(emphasisMatches(profile({ produces: ['landfall'] }), [], emphasis)).toEqual([])
  })

  it('counts a tag once even when the card both produces and wants it', () => {
    // Tergrid's own shape. Two entries would double the term for one relation.
    const matches: readonly SynergyMatch[] = [
      { tag: 'opponent-discard', direction: 'enables', weight: 4 },
      { tag: 'opponent-discard', direction: 'payoff', weight: 4 },
    ]
    expect(
      emphasisMatches(
        profile({ produces: ['opponent-discard'], wants: ['opponent-discard'] }),
        matches,
        emphasis,
      ),
    ).toHaveLength(1)
  })

  it('prefers the strongest reading of an emphasised tag', () => {
    const matches: readonly SynergyMatch[] = [
      { tag: 'opponent-discard', direction: 'theme', weight: 0.4 },
      { tag: 'opponent-discard', direction: 'enables', weight: 8 },
    ]
    expect(
      emphasisMatches(profile({ produces: ['opponent-discard'] }), matches, emphasis)[0],
    ).toEqual({ tag: 'opponent-discard', direction: 'enables', weight: 8 })
  })

  it('prefers a real match over the floor', () => {
    const matches: readonly SynergyMatch[] = [
      { tag: 'opponent-discard', direction: 'enables', weight: 4 },
    ]
    expect(emphasisMatches(profile({ produces: ['opponent-discard'] }), matches, emphasis)).toEqual(
      [{ tag: 'opponent-discard', direction: 'enables', weight: 4 }],
    )
  })

  it('orders by weight, then by tag, so the result never reshuffles', () => {
    // Determinism (doc 05). Both floored, so only the tie-break separates them,
    // and `untap` precedes `opponent-discard` in SYNERGY_TAGS.
    const both = emphasisMatches(
      profile({ produces: ['opponent-discard', 'untap'] }),
      [],
      ['untap', 'opponent-discard'],
    )
    expect(both.map((m) => m.tag)).toEqual(['untap', 'opponent-discard'])
  })
})

describe('emphasisScore', () => {
  it('is zero with no emphasised matches', () => {
    expect(emphasisScore([])).toBe(0)
  })

  it('saturates rather than growing linearly', () => {
    // The third emphasised tag a card brushes matters far less than the first.
    const one = emphasisScore([{ tag: 'untap', direction: 'enables', weight: 4 }])
    const two = emphasisScore([
      { tag: 'untap', direction: 'enables', weight: 4 },
      { tag: 'landfall', direction: 'enables', weight: 4 },
    ])
    expect(one).toBeCloseTo(4 / (4 + COMMANDER_WEIGHT))
    expect(two).toBeGreaterThan(one)
    expect(two - one).toBeLessThan(one)
  })

  it('stays below 1 however much weight is piled on', () => {
    expect(emphasisScore([{ tag: 'untap', direction: 'enables', weight: 1e6 }])).toBeLessThan(1)
  })

  it('ranks a floored match above nothing and below a commander-level match', () => {
    const floored = emphasisScore([{ tag: 'untap', direction: 'theme', weight: EMPHASIS_FLOOR }])
    const real = emphasisScore([{ tag: 'untap', direction: 'enables', weight: COMMANDER_WEIGHT }])
    expect(floored).toBeGreaterThan(0)
    expect(floored).toBeLessThan(real)
  })
})

describe('relatedSemantics', () => {
  it('offers nothing when nothing is emphasised — there is no focus to relate to', () => {
    expect(relatedSemantics(NO_EMPHASIS)).toEqual([])
  })

  it('offers the neighbours of the one emphasised tag', () => {
    // `interactsWith` owns which these are; this pins that the offer IS that
    // list, not a re-derivation of it that could drift from the table.
    expect(relatedSemantics(['treasure'])).toEqual([...interactsWith('treasure')].sort(byTagOrder))
  })

  it('never offers a tag that is already emphasised', () => {
    // `token` and `sacrifice-fodder` are neighbours of each other, so emphasising
    // both must not offer either back — a chip that toggled a focus already on
    // is the "stuck on" failure wearing an offer's clothes.
    const offered = relatedSemantics(['token', 'sacrifice-fodder'])
    expect(offered).not.toContain('token')
    expect(offered).not.toContain('sacrifice-fodder')
  })

  it('unions the neighbours of every emphasised tag', () => {
    const both = relatedSemantics(['landfall', 'treasure'])
    expect(both).toContain('untap') // landfall's
    expect(both).toContain('artifact-etb') // treasure's
  })

  it('offers a tag once even when two emphasised tags both reach it', () => {
    // `token` is a neighbour of both. A duplicate would render two toggles for
    // one tag, and the second would disagree with the first the moment it moved.
    const offered = relatedSemantics(['landfall', 'creature-etb'])
    expect(offered.filter((t) => t === 'token')).toHaveLength(1)
  })

  it('drops anything the caller is already showing, so no tag appears twice', () => {
    expect(relatedSemantics(['treasure'], ['artifact-etb'])).not.toContain('artifact-etb')
    expect(relatedSemantics(['treasure'], ['artifact-etb'])).toContain('sacrifice-fodder')
  })

  it('ignores an exclusion that is not a tag at all, rather than throwing', () => {
    expect(relatedSemantics(['treasure'], ['not-a-tag'])).toEqual(
      [...interactsWith('treasure')].sort(byTagOrder),
    )
  })

  it('is in canonical tag order, so the same focus offers the same list every time', () => {
    const offered = relatedSemantics(['creature-death'])
    expect([...offered].sort(byTagOrder)).toEqual(offered)
  })
})

describe('remainingSemantics', () => {
  it('is the whole vocabulary when nothing is on offer yet', () => {
    expect(remainingSemantics([])).toEqual(SYNERGY_TAGS)
  })

  it('leaves out what is already on screen', () => {
    const rest = remainingSemantics(['token', 'landfall'])
    expect(rest).not.toContain('token')
    expect(rest).not.toContain('landfall')
    expect(rest).toHaveLength(SYNERGY_TAGS.length - 2)
  })

  it('is empty once every semantic is on offer — the button has nothing left to show', () => {
    expect(remainingSemantics(SYNERGY_TAGS)).toEqual([])
  })

  it('is in canonical order', () => {
    expect(remainingSemantics(['token'])).toEqual(SYNERGY_TAGS.filter((t) => t !== 'token'))
  })
})

describe('bySupport', () => {
  const support = (entries: Record<string, number>): ReadonlyMap<string, number> =>
    new Map(Object.entries(entries))

  it('puts the tag more of the pool supports first', () => {
    expect(bySupport(['token', 'landfall'], support({ token: 2, landfall: 40 }))).toEqual([
      'landfall',
      'token',
    ])
  })

  it('makes no claim at all without counts — the start screen has none yet', () => {
    // Canonical order, unchanged. Sorting by a number nobody has computed would
    // be an order presented as a ranking and derived from nothing.
    expect(bySupport(['token', 'landfall'], undefined)).toEqual(['token', 'landfall'])
  })

  it('sinks a tag nothing in the deck’s colours supports, rather than hiding it', () => {
    // Emphasis never filters, so a zero-support tag is still a legal, offered
    // choice (`supportText` says so in words). It just must not LEAD.
    const ordered = bySupport(['token', 'landfall', 'untap'], support({ token: 0, landfall: 5, untap: 9 }))
    expect(ordered).toEqual(['untap', 'landfall', 'token'])
  })

  it('sorts a tag with no count of its own after one known to be zero', () => {
    // "Counting…" is weaker than "counted, and it was nothing": one is a fact
    // about the pool, the other is the absence of a fact, and a list ordered by
    // how much supports a tag cannot promote the one it cannot answer for.
    expect(bySupport(['token', 'landfall'], support({ landfall: 0 }))).toEqual([
      'landfall',
      'token',
    ])
  })

  it('breaks a tie on canonical order, so equal support never reshuffles', () => {
    expect(bySupport(['untap', 'token', 'landfall'], support({ token: 3, landfall: 3, untap: 3 }))).toEqual([
      'token',
      'landfall',
      'untap',
    ])
  })

  it('leaves the input alone', () => {
    const input: SynergyTag[] = ['token', 'landfall']
    bySupport(input, support({ landfall: 9 }))
    expect(input).toEqual(['token', 'landfall'])
  })
})
