import { describe, expect, it } from 'vitest'
import {
  QUICKDRAW_FAMILIAR,
  QUICKDRAW_FAMILIAR_RANK,
  SEMANTIC_OFFER_SAMPLE,
  SEMANTIC_OFFER_THRESHOLDS,
  drawSemanticOffers,
  qualifyingSemantics,
  quickdraw,
  rankBySemanticMatches,
  semanticMatchCount,
  type SemanticCensusEntry,
} from './commander-entry.js'
import { oracleId, printingId } from './ids.js'
import type { Card, OracleId } from './index.js'
import type { SynergyTag } from './synergy.js'

/**
 * The two entry routes' deterministic core (ADR-0067).
 *
 * The corpus figures quoted in the names below — 48 qualifying tags, 3,411
 * commanders, 791 under rank 5000, 307 with no semantic at all — are measured
 * facts about the live corpus and are asserted end to end by the database
 * suites, not here. What is asserted here is the RULE that produces them, over
 * fixtures small enough to read.
 */

let counter = 0
const nextUuid = (): string => {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

const card = (name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: oracleId(nextUuid()),
  name,
  manaCost: '{2}{G}',
  manaValue: 3,
  colorIdentity: ['G'],
  colors: ['G'],
  typeLine: 'Legendary Creature — Elf Druid',
  types: ['creature'],
  oracleText: '',
  power: '2',
  toughness: '2',
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  canBeCommander: true,
  edhrecRank: null,
  defaultPrinting: printingId(nextUuid()),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  gameChanger: false,
  ...opts,
})

const census = (tag: string, commanders: number, supporting: number): SemanticCensusEntry => ({
  tag: tag as SynergyTag,
  commanders,
  supporting,
})

describe('qualifyingSemantics', () => {
  it('keeps a tag that clears both floors', () => {
    expect(qualifyingSemantics([census('landfall', 20, 150)]).map((o) => o.tag)).toEqual(['landfall'])
  })

  it('drops a deck nobody can lead — plenty of cards, too few commanders', () => {
    expect(qualifyingSemantics([census('landfall', 19, 4000)])).toEqual([])
  })

  it('drops a deck nobody can fill — plenty of commanders, too few cards', () => {
    expect(qualifyingSemantics([census('landfall', 400, 149)])).toEqual([])
  })

  it('states the thresholds as 20 and 150', () => {
    expect(SEMANTIC_OFFER_THRESHOLDS).toEqual({ minCommanders: 20, minSupporting: 150 })
  })

  it('is a plateau and not a cliff', () => {
    /*
     * The evidence the numbers are not overfitted. These 49 fixtures stand in
     * for the corpus's real distribution around the floor: moving the commander
     * threshold from 15 to 30 moves the offer by a handful either way rather
     * than falling off a cliff, which is the shape ADR-0067 §4 measured on the
     * live corpus (49 / 48 / 47 / 42 at 15 / 20 / 25 / 30).
     */
    const shelf = Array.from({ length: 49 }, (_, i) => census(`tag-${String(i)}`, 14 + i, 200))
    const at = (minCommanders: number): number =>
      qualifyingSemantics(shelf, { minCommanders, minSupporting: 150 }).length
    expect([at(15), at(20), at(25), at(30)]).toEqual([48, 43, 38, 33])
    // No step bigger than the change in the threshold itself.
    expect(at(15) - at(20)).toBeLessThanOrEqual(5)
  })

  it('files each tag under the domain’s own category', () => {
    const offers = qualifyingSemantics([
      census('subtype:elf', 50, 500),
      census('ability:flying', 50, 500),
      census('landfall', 50, 500),
    ])
    expect(offers.map((o) => [o.tag, o.category])).toEqual([
      ['landfall', 'mechanics'],
      ['ability:flying', 'keyword'],
      ['subtype:elf', 'type'],
    ])
  })

  it('orders mechanics, then keywords, then types, alphabetically within each', () => {
    const offers = qualifyingSemantics([
      census('subtype:zombie', 50, 500),
      census('subtype:elf', 50, 500),
      census('treasure', 50, 500),
      census('landfall', 50, 500),
      census('ability:flying', 50, 500),
    ])
    expect(offers.map((o) => o.tag)).toEqual([
      'landfall',
      'treasure',
      'ability:flying',
      'subtype:elf',
      'subtype:zombie',
    ])
  })

  it('carries the counts through, so the offer can say what stands behind it', () => {
    const [offer] = qualifyingSemantics([census('landfall', 137, 2914)])
    expect(offer).toMatchObject({ commanders: 137, supporting: 2914 })
  })
})

describe('drawSemanticOffers', () => {
  const shelf = qualifyingSemantics(
    Array.from({ length: 48 }, (_, i) => census(`tag-${String(i).padStart(2, '0')}`, 40, 400)),
  )

  it('draws eight by default', () => {
    expect(drawSemanticOffers(shelf, 'seed')).toHaveLength(SEMANTIC_OFFER_SAMPLE)
    expect(SEMANTIC_OFFER_SAMPLE).toBe(8)
  })

  it('draws the same eight for the same seed', () => {
    expect(drawSemanticOffers(shelf, 'abc').map((o) => o.tag)).toEqual(
      drawSemanticOffers(shelf, 'abc').map((o) => o.tag),
    )
  })

  it('draws a different eight when the builder redraws', () => {
    expect(drawSemanticOffers(shelf, 'abc').map((o) => o.tag)).not.toEqual(
      drawSemanticOffers(shelf, 'def').map((o) => o.tag),
    )
  })

  it('never offers the same tag twice in one draw', () => {
    for (let i = 0; i < 100; i += 1) {
      const drawn = drawSemanticOffers(shelf, `draw-${String(i)}`)
      expect(new Set(drawn.map((o) => o.tag)).size).toBe(8)
    }
  })

  it('keeps the drawn eight in category order, not draw order', () => {
    const drawn = drawSemanticOffers(
      qualifyingSemantics([
        census('subtype:elf', 40, 400),
        census('landfall', 40, 400),
        census('ability:flying', 40, 400),
      ]),
      'any',
      3,
    )
    expect(drawn.map((o) => o.category)).toEqual(['mechanics', 'keyword', 'type'])
  })

  it('offers everything it has when there is less than eight', () => {
    expect(drawSemanticOffers(shelf.slice(0, 3), 'seed')).toHaveLength(3)
  })
})

describe('semanticMatchCount', () => {
  it('counts a pick the commander produces', () => {
    const c = card('Sac Outlet', { synergyProduces: ['creature-death'] as SynergyTag[] })
    expect(semanticMatchCount(c, ['creature-death'] as SynergyTag[])).toBe(1)
  })

  it('counts a pick the commander wants', () => {
    const c = card('Death Trigger', { synergyWants: ['creature-death'] as SynergyTag[] })
    expect(semanticMatchCount(c, ['creature-death'] as SynergyTag[])).toBe(1)
  })

  it('counts a tag carried in both directions once', () => {
    const c = card('Both', {
      synergyProduces: ['token'] as SynergyTag[],
      synergyWants: ['token'] as SynergyTag[],
    })
    expect(semanticMatchCount(c, ['token'] as SynergyTag[])).toBe(1)
  })

  it('IGNORES membership — a commander that merely IS an Elf matches nothing', () => {
    /*
     * The refusal ADR-0067 §3 is written for, asserted at the level it would
     * actually go wrong. `synergyHas` is derived from the type line, so every
     * Elf commander carries `subtype:elf` whether or not the deck is about
     * Elves. Counting it would put every Elf ahead of the Elf lord.
     */
    const isAnElf = card('Just An Elf', { synergyHas: ['subtype:elf'] as SynergyTag[] })
    const caresAboutElves = card('Elf Lord', { synergyWants: ['subtype:elf'] as SynergyTag[] })
    expect(semanticMatchCount(isAnElf, ['subtype:elf'] as SynergyTag[])).toBe(0)
    expect(semanticMatchCount(caresAboutElves, ['subtype:elf'] as SynergyTag[])).toBe(1)
  })

  it('counts two of two', () => {
    const c = card('Both Picks', {
      synergyProduces: ['token'] as SynergyTag[],
      synergyWants: ['creature-death'] as SynergyTag[],
    })
    expect(semanticMatchCount(c, ['token', 'creature-death'] as SynergyTag[])).toBe(2)
  })

  it('is zero when nothing was picked', () => {
    expect(semanticMatchCount(card('Anything'), [])).toBe(0)
  })

  it('does not double-count a pick the builder somehow sent twice', () => {
    const c = card('One', { synergyProduces: ['token'] as SynergyTag[] })
    expect(semanticMatchCount(c, ['token', 'token'] as SynergyTag[])).toBe(1)
  })
})

describe('rankBySemanticMatches', () => {
  const picks = ['token', 'creature-death'] as SynergyTag[]

  const two = card('Bravo', {
    synergyProduces: ['token'] as SynergyTag[],
    synergyWants: ['creature-death'] as SynergyTag[],
  })
  const oneA = card('Alpha', { synergyProduces: ['token'] as SynergyTag[] })
  const oneZ = card('Zulu', { synergyWants: ['creature-death'] as SynergyTag[] })
  const none = card('Nothing At All')

  it('puts two-of-two ahead of one-of-two', () => {
    expect(rankBySemanticMatches([oneA, two, oneZ], picks).map((r) => r.card.name)).toEqual([
      'Bravo',
      'Alpha',
      'Zulu',
    ])
  })

  it('reports how many each one matched', () => {
    expect(rankBySemanticMatches([oneA, two], picks).map((r) => r.matched)).toEqual([2, 1])
  })

  it('breaks ties by name and not by popularity', () => {
    /*
     * Route 1 refuses `edhrecRank` (ADR-0067 §5). The obscure card sorts first
     * here purely because "Alpha" precedes "Zulu" — a rank-aware tiebreak would
     * invert this, and would be answering "what is popular" inside a list whose
     * heading says "what is this about".
     */
    const popular = card('Zulu', {
      synergyProduces: ['token'] as SynergyTag[],
      edhrecRank: 1,
    })
    const obscure = card('Alpha', {
      synergyProduces: ['token'] as SynergyTag[],
      edhrecRank: 30000,
    })
    expect(rankBySemanticMatches([popular, obscure], picks).map((r) => r.card.name)).toEqual([
      'Alpha',
      'Zulu',
    ])
  })

  it('drops a commander that matches nothing rather than ranking it last', () => {
    // The 307 with no `produces`/`wants` semantic at all must never surface.
    expect(rankBySemanticMatches([none, oneA], picks).map((r) => r.card.name)).toEqual(['Alpha'])
  })

  it('returns nothing when nothing was picked', () => {
    expect(rankBySemanticMatches([two, oneA], [])).toEqual([])
  })
})

describe('quickdraw', () => {
  const id = (n: number): OracleId =>
    oracleId(`00000000-0000-4000-9000-${String(n).padStart(12, '0')}`)
  const familiar = Array.from({ length: 791 }, (_, i) => id(i))
  const all = Array.from({ length: 3411 }, (_, i) => id(i))
  const pools = { familiar, all }

  it('deals two familiar and one wildcard', () => {
    const hand = quickdraw(pools, 'seed')
    expect(hand.familiar).toHaveLength(QUICKDRAW_FAMILIAR)
    expect(hand.wildcard).not.toBeNull()
  })

  it('draws the familiar pair from the familiar pool', () => {
    for (let i = 0; i < 50; i += 1) {
      for (const drawn of quickdraw(pools, `f${String(i)}`).familiar) {
        expect(familiar).toContain(drawn)
      }
    }
  })

  it('never deals the same commander twice', () => {
    // The wildcard pool overlaps the familiar pool by construction, so this is
    // a real collision and not a theoretical one.
    for (let i = 0; i < 300; i += 1) {
      const hand = quickdraw(pools, `dup-${String(i)}`)
      const dealt = [...hand.familiar, ...(hand.wildcard === null ? [] : [hand.wildcard])]
      expect(new Set(dealt).size).toBe(dealt.length)
    }
  })

  it('lets the wildcard come from anywhere, including the familiar pool', () => {
    // Deliberate: excluding the popular 791 would make the wildcard slot
    // systematically obscure rather than uniformly random.
    const familiarSet = new Set(familiar)
    let reachedBeyond = 0
    let reachedInside = 0
    for (let i = 0; i < 200; i += 1) {
      const { wildcard } = quickdraw(pools, `w${String(i)}`)
      if (wildcard === null) continue
      if (familiarSet.has(wildcard)) reachedInside += 1
      else reachedBeyond += 1
    }
    expect(reachedBeyond).toBeGreaterThan(0)
    expect(reachedInside).toBeGreaterThan(0)
  })

  it('deals the same hand for the same seed and a different one on reroll', () => {
    expect(quickdraw(pools, 'x')).toEqual(quickdraw(pools, 'x'))
    expect(quickdraw(pools, 'x')).not.toEqual(quickdraw(pools, 'y'))
  })

  it('draws the wildcard independently of the familiar pair', () => {
    /*
     * The two draws are seeded separately (`:familiar` / `:wildcard`). Without
     * that they share one stream, and the wildcard becomes a function of which
     * two familiar cards came out — visible as the same wildcard appearing
     * whenever the pair repeats.
     */
    const wildcards = new Set(
      Array.from({ length: 100 }, (_, i) => quickdraw(pools, `i${String(i)}`).wildcard),
    )
    expect(wildcards.size).toBeGreaterThan(90)
  })

  it('states the familiar cut as rank 5000', () => {
    expect(QUICKDRAW_FAMILIAR_RANK).toBe(5000)
  })

  it('deals what it can from a pool too small to fill a hand', () => {
    const tiny = { familiar: [id(1)], all: [id(1)] }
    const hand = quickdraw(tiny, 'seed')
    expect(hand.familiar).toEqual([id(1)])
    // Null rather than a second copy of the one card there is: the wildcard is
    // marked on screen, and a marked duplicate would be a label that lies.
    expect(hand.wildcard).toBeNull()
  })

  it('deals no familiar cards when nothing is popular enough, but still a wildcard', () => {
    const hand = quickdraw({ familiar: [], all: [id(7)] }, 'seed')
    expect(hand.familiar).toEqual([])
    expect(hand.wildcard).toBe(id(7))
  })

  it('leaves the pools it was given untouched', () => {
    const before = [...familiar]
    quickdraw(pools, 'seed')
    expect(familiar).toEqual(before)
  })
})
