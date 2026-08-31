import { describe, expect, it } from 'vitest'
import {
  EMPHASIS_FLOOR,
  emphasisMatches,
  emphasisScore,
  hasEmphasis,
  NO_EMPHASIS,
  parseSemanticEmphasis,
  type SemanticEmphasis,
} from './semantic-emphasis.js'
import { COMMANDER_WEIGHT, type SynergyMatch, type SynergyProfile } from './synergy.js'

const profile = (over: Partial<SynergyProfile> = {}): SynergyProfile => ({
  produces: over.produces ?? [],
  wants: over.wants ?? [],
})

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
