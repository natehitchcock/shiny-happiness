import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { Combo } from '@roundtable/domain'
import { comboId } from '@roundtable/domain'
import {
  cachedCombosInIdentity,
  cachedEligibleCards,
  cachedPrintingFacts,
  clearCorpusCache,
} from './corpus-cache.js'

/**
 * The cache that keeps a warm instance from re-reading the combo table.
 *
 * `allCombos` moved 72 MB per recommendation request against the real corpus,
 * and every filter change, every accept and every auto-query fires one. On a
 * metered database that exhausted a 5 GB monthly transfer quota in about sixty
 * requests and took the deployment down, so "how many times does this read"
 * is the behaviour under test, not an implementation detail.
 */
vi.mock('@roundtable/db', () => ({
  combosInIdentity: vi.fn(),
  findEligibleCards: vi.fn(),
  printingFactsForAll: vi.fn(),
}))
const { combosInIdentity, findEligibleCards, printingFactsForAll } = await import('@roundtable/db')
const fetchCombos = vi.mocked(combosInIdentity)
const fetchCards = vi.mocked(findEligibleCards)
const fetchFacts = vi.mocked(printingFactsForAll)

const pool = {} as Pool

const combo = (id: string): Combo => ({
  id: comboId(id),
  pieces: [],
  prerequisites: '',
  steps: [],
  produces: [],
  colorIdentity: ['R'],
})

beforeEach(() => {
  clearCorpusCache()
  fetchCombos.mockReset()
  fetchCards.mockReset()
  fetchFacts.mockReset()
  fetchCombos.mockResolvedValue([combo('c1')])
  fetchCards.mockResolvedValue([])
  fetchFacts.mockResolvedValue(new Map())
})

describe('reading the combo set', () => {
  it('reads once and serves the rest from memory', async () => {
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')

    expect(fetchCombos).toHaveBeenCalledTimes(1)
  })

  it('returns the same combos on a hit as on the read', async () => {
    const first = await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    const second = await cachedCombosInIdentity(pool, ['R'], 'snap-1')

    expect(second).toEqual(first)
    expect(second.map((c) => c.id)).toEqual(['c1'])
  })

  it('does not care what order the colours arrive in', async () => {
    // `{R,W}` and `{W,R}` are one identity, and treating them as two would
    // halve the hit rate for every multicolour deck.
    await cachedCombosInIdentity(pool, ['R', 'W'], 'snap-1')
    await cachedCombosInIdentity(pool, ['W', 'R'], 'snap-1')

    expect(fetchCombos).toHaveBeenCalledTimes(1)
  })
})

describe('what invalidates it', () => {
  it('re-reads when the ingest has written a new snapshot', async () => {
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    fetchCombos.mockResolvedValue([combo('c2')])

    const after = await cachedCombosInIdentity(pool, ['R'], 'snap-2')

    expect(fetchCombos).toHaveBeenCalledTimes(2)
    // The point of keying on the snapshot: fresh data is served the request
    // after the ingest lands, with no interval to wait out.
    expect(after.map((c) => c.id)).toEqual(['c2'])
  })

  it('drops every identity on a new snapshot, not just the one asked for', async () => {
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['U'], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(2)

    // Every held set describes the old corpus, so every one of them is stale.
    await cachedCombosInIdentity(pool, ['R'], 'snap-2')
    await cachedCombosInIdentity(pool, ['U'], 'snap-2')
    expect(fetchCombos).toHaveBeenCalledTimes(4)
  })

  it('re-reads for a different colour identity', async () => {
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['U'], 'snap-1')

    expect(fetchCombos).toHaveBeenCalledTimes(2)
  })

  it('keeps several identities at once, so two decks do not evict each other', async () => {
    // The failure this prevents: one user on mono-red and one on Azorius
    // sharing an instance and each re-reading on every request because the
    // other had just used the single slot.
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['U'], 'snap-1')
    await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    await cachedCombosInIdentity(pool, ['U'], 'snap-1')

    expect(fetchCombos).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used once it is full', async () => {
    // Bounded on purpose: memory that tracks an instance's popularity fails in
    // a way that is very hard to see coming.
    for (const id of [['W'], ['U'], ['B'], ['R']] as const)
      await cachedCombosInIdentity(pool, id, 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(4)

    // Touch W so it is no longer the oldest, then overflow with a fifth.
    await cachedCombosInIdentity(pool, ['W'], 'snap-1')
    await cachedCombosInIdentity(pool, ['G'], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(5)

    // U was the least recently used, so it is the one that went.
    await cachedCombosInIdentity(pool, ['W'], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(5)
    await cachedCombosInIdentity(pool, ['U'], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(6)
  })

  it('reads once for a whole session of operations on one deck', async () => {
    // What the cache is actually for: a user adding, rejecting and filtering
    // fires a recommendation request each time, and a deck's colour identity is
    // fixed by its commanders, so none of them can miss.
    for (let i = 0; i < 40; i += 1) await cachedCombosInIdentity(pool, ['R', 'W'], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(1)
  })

  it('treats colourless as its own identity rather than a missing key', async () => {
    await cachedCombosInIdentity(pool, [], 'snap-1')
    await cachedCombosInIdentity(pool, [], 'snap-1')
    expect(fetchCombos).toHaveBeenCalledTimes(1)
  })

  it('never caches against an unknown snapshot', async () => {
    // No snapshot means the corpus has never been ingested. Caching there would
    // be caching "we do not know when this changes".
    await cachedCombosInIdentity(pool, ['R'], null)
    await cachedCombosInIdentity(pool, ['R'], null)

    expect(fetchCombos).toHaveBeenCalledTimes(2)
  })

  it('does not serve a null-snapshot read to a later real snapshot', async () => {
    await cachedCombosInIdentity(pool, ['R'], null)
    fetchCombos.mockResolvedValue([combo('c2')])

    const after = await cachedCombosInIdentity(pool, ['R'], 'snap-1')

    expect(after.map((c) => c.id)).toEqual(['c2'])
  })
})

describe('the candidate pool', () => {
  it('reads once for a whole session on one deck', async () => {
    for (let i = 0; i < 40; i += 1) await cachedEligibleCards(pool, ['R'], false, 'snap-1')
    expect(fetchCards).toHaveBeenCalledTimes(1)
  })

  it('holds a separate pool per Universes Beyond setting', async () => {
    // Unlike colour identity, this one IS a deck option the user can toggle
    // mid-session (ADR-0011), and the two pools genuinely differ — serving one
    // for the other would show cards the user asked not to see.
    await cachedEligibleCards(pool, ['R'], false, 'snap-1')
    await cachedEligibleCards(pool, ['R'], true, 'snap-1')
    expect(fetchCards).toHaveBeenCalledTimes(2)

    await cachedEligibleCards(pool, ['R'], false, 'snap-1')
    await cachedEligibleCards(pool, ['R'], true, 'snap-1')
    expect(fetchCards).toHaveBeenCalledTimes(2)
  })

  it('passes the setting through to the query', async () => {
    await cachedEligibleCards(pool, ['R', 'W'], true, 'snap-1')
    expect(fetchCards).toHaveBeenCalledWith(pool, ['R', 'W'], { excludeUniversesBeyond: true })
  })

  it("does not hand out the combo cache's rows", async () => {
    // Three caches, one implementation. The failure this rules out is the cheap
    // version of that — one shared Map — where an identity key that had already
    // been used for combos would serve combos to the pool. Asserted on the DATA
    // rather than on call counts, because call counts pass either way when the
    // two happen to use different key shapes.
    fetchCards.mockResolvedValue([{ oracleId: 'card-1' } as never])

    const first = await cachedCombosInIdentity(pool, ['R'], 'snap-1')
    const second = await cachedEligibleCards(pool, ['R'], false, 'snap-1')

    expect(first.map((c) => c.id)).toEqual(['c1'])
    expect(second).toEqual([{ oracleId: 'card-1' }])
  })
})

describe('printing facts', () => {
  it('reads once however many times it is asked', async () => {
    // The most frequent of the three: the deck context needs it, and so does
    // `/cards/batch`, which the client calls to hydrate after every recompute.
    for (let i = 0; i < 20; i += 1) await cachedPrintingFacts(pool, 'snap-1')
    expect(fetchFacts).toHaveBeenCalledTimes(1)
  })

  it('re-reads once the ingest has written', async () => {
    await cachedPrintingFacts(pool, 'snap-1')
    await cachedPrintingFacts(pool, 'snap-2')
    expect(fetchFacts).toHaveBeenCalledTimes(2)
  })

  it('never caches against an unknown snapshot', async () => {
    await cachedPrintingFacts(pool, null)
    await cachedPrintingFacts(pool, null)
    expect(fetchFacts).toHaveBeenCalledTimes(2)
  })
})
