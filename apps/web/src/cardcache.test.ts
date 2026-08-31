import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as apiTypes from './api'
import { cardDetail, clearCardCache, hydrateCards } from './cardcache'

/**
 * The client-side card cache.
 *
 * The behaviour under test is a request count, not a return value: the app was
 * re-downloading every card it already held on every accept, reject and filter
 * change, so what these assert is that the second ask does not reach the wire —
 * and that the one case where holding data would be wrong, an ingest moving the
 * dataset snapshot, drops all of it.
 */
vi.mock('./api', () => ({ hydrate: vi.fn(), getCardDetail: vi.fn() }))

const api = vi.mocked(await import('./api'))

const card = (oracleId: string): apiTypes.Card => ({
  oracleId,
  name: `Card ${oracleId}`,
  manaCost: '{1}{G}',
  manaValue: 2,
  typeLine: 'Creature — Elf Druid',
  types: ['creature'],
  oracleText: `Rules text for ${oracleId}.`,
  power: '1',
  toughness: '1',
  loyalty: null,
  colorIdentity: ['G'],
  primaryRole: 'ramp',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const detail = (oracleId: string): apiTypes.CardDetail => ({
  ...card(oracleId),
  printings: [],
  combos: [{ id: `c-${oracleId}`, pieces: [{ oracleId, name: `Card ${oracleId}` }], produces: [] }],
})

/** Every id asked for comes back, in all three maps — as the real route does. */
const answersFor = (ids: string[]): apiTypes.Hydrated => ({
  cards: new Map(ids.map((id) => [id, card(id)])),
  prices: new Map(ids.map((id) => [id, 3.5])),
  images: new Map(ids.map((id) => [id, { artCrop: `art/${id}`, normal: `full/${id}` }])),
})

/** The ids each call actually put on the wire, flattened in order. */
const requested = (): string[] => api.hydrate.mock.calls.flatMap((c) => c[0])

const SNAP = 'snapshot-a'

beforeEach(() => {
  clearCardCache()
  api.hydrate.mockReset()
  api.hydrate.mockImplementation((ids: string[]) => Promise.resolve(answersFor(ids)))
  api.getCardDetail.mockReset()
  api.getCardDetail.mockImplementation((id: string) => Promise.resolve(detail(id)))
})

// Module state outlives a test, and a cache that leaks one test's cards into
// the next is a suite that lies.
afterEach(() => clearCardCache())

describe('hydrating through the cache', () => {
  it('makes no request at all for a page it already holds', async () => {
    const page = ['o1', 'o2', 'o3']
    await hydrateCards(page, SNAP)
    expect(api.hydrate).toHaveBeenCalledTimes(1)

    // The recompute an accept causes: same deck, same suggestions, same ids.
    const second = await hydrateCards(page, SNAP)

    // Not "one small request" — none. `api.hydrate([])` short-circuits without
    // touching the network, but reaching it at all would mean the miss list was
    // computed wrong, so the assertion is on the call itself.
    expect(api.hydrate).toHaveBeenCalledTimes(1)
    // And the caller is still given everything, or the panels go blank.
    expect([...second.cards.keys()].sort()).toEqual(page)
    expect(second.cards.get('o2')?.oracleText).toBe('Rules text for o2.')
  })

  it('asks only for the ids it does not hold', async () => {
    await hydrateCards(['o1', 'o2'], SNAP)
    // A filter change: two rows carried over, two are new.
    const result = await hydrateCards(['o2', 'o3', 'o4'], SNAP)

    expect(api.hydrate).toHaveBeenCalledTimes(2)
    expect(api.hydrate.mock.calls[1]?.[0]).toEqual(['o3', 'o4'])
    // Everything held is returned, including 'o1' which this page did not ask
    // about — that is the accumulate, and it is why `App` can write the maps
    // through instead of merging.
    expect([...result.cards.keys()].sort()).toEqual(['o1', 'o2', 'o3', 'o4'])
  })

  it('serves prices and art from the cache as well as cards', async () => {
    await hydrateCards(['o1'], SNAP)
    const second = await hydrateCards(['o1'], SNAP)

    expect(api.hydrate).toHaveBeenCalledTimes(1)
    expect(second.prices.get('o1')).toBe(3.5)
    expect(second.images.get('o1')).toEqual({ artCrop: 'art/o1', normal: 'full/o1' })
  })

  it('keeps a null price and a null art distinct from an absent entry', async () => {
    // Both nulls are real answers on the wire (doc 10 §10.2) and must survive
    // the round trip, or a cached read would say "not loaded yet" where an
    // uncached one said "there is none".
    api.hydrate.mockResolvedValueOnce({
      cards: new Map([['o1', card('o1')]]),
      prices: new Map([['o1', null]]),
      images: new Map([['o1', { artCrop: null, normal: null }]]),
    })
    await hydrateCards(['o1'], SNAP)
    const second = await hydrateCards(['o1'], SNAP)

    expect(second.prices.has('o1')).toBe(true)
    expect(second.prices.get('o1')).toBeNull()
    expect(second.images.get('o1')).toEqual({ artCrop: null, normal: null })
  })

  it('does not pin an id the corpus did not answer for', async () => {
    // `api.hydrate` truncates at 500 ids, so a large page can legitimately come
    // back short. Remembering the shortfall as "this card does not exist" would
    // turn one truncated batch into a permanently blank row.
    api.hydrate.mockResolvedValueOnce({
      cards: new Map([['o1', card('o1')]]),
      prices: new Map([['o1', 1]]),
      images: new Map(),
    })
    await hydrateCards(['o1', 'o2'], SNAP)
    await hydrateCards(['o1', 'o2'], SNAP)

    expect(api.hydrate.mock.calls[1]?.[0]).toEqual(['o2'])
  })

  it('drops everything when the dataset snapshot moves', async () => {
    await hydrateCards(['o1', 'o2'], SNAP)
    // An ingest landed. Stale oracle text is worse than a refetch.
    const after = await hydrateCards(['o1'], 'snapshot-b')

    expect(api.hydrate.mock.calls[1]?.[0]).toEqual(['o1'])
    // Not merely re-fetched — 'o2' described the OLD corpus and is gone, so a
    // panel cannot render it from a map the new snapshot never confirmed.
    expect([...after.cards.keys()]).toEqual(['o1'])
  })

  it('never caches when there is no dataset snapshot', async () => {
    // Null means the corpus has never been ingested, so there is no version to
    // invalidate against — the same reason the server refuses to cache on it.
    await hydrateCards(['o1'], null)
    await hydrateCards(['o1'], null)

    expect(api.hydrate).toHaveBeenCalledTimes(2)
    expect(requested()).toEqual(['o1', 'o1'])
  })

  it('starts caching once a snapshot arrives, without treating it as a change', async () => {
    await hydrateCards(['o1'], SNAP)
    await hydrateCards(['o1'], SNAP)
    expect(api.hydrate).toHaveBeenCalledTimes(1)
  })
})

describe('the bound', () => {
  // Pinned to the documented 2,000 rather than imported, so moving the bound is
  // a deliberate edit here and not a silent one.
  const MAX = 2_000
  const ids = (from: number, count: number): string[] =>
    Array.from({ length: count }, (_, i) => `o${String(from + i)}`)

  it('evicts the least recently used once it is full', async () => {
    const full = ids(0, MAX)
    await hydrateCards(full, SNAP)
    await hydrateCards(['fresh'], SNAP)

    // One over the ceiling, so exactly one entry left.
    const held = await hydrateCards(['fresh'], SNAP)
    expect(held.cards.size).toBe(MAX)
    expect(held.cards.has('o0')).toBe(false)
    expect(held.cards.has('o1')).toBe(true)
  })

  it('protects the page on screen when the cache overflows', async () => {
    await hydrateCards(['deck-card'], SNAP)
    // A long session of filtering fills the cache, leaving 'deck-card' the
    // oldest entry and first in line to be evicted.
    await hydrateCards(ids(0, MAX - 1), SNAP)

    // But it is a card in the DECK, so the very next recompute asks for it
    // again — and that promotes it past everything the session accumulated.
    // This is the property that makes a bound safe to have: eviction reaches
    // the tail of old filters, never the page being looked at.
    const overflow = await hydrateCards(['deck-card', ...ids(MAX, 500)], SNAP)
    expect(overflow.cards.size).toBe(MAX)
    expect(overflow.cards.has('deck-card')).toBe(true)
    expect(overflow.cards.has('o0')).toBe(false)

    const calls = api.hydrate.mock.calls.length
    await hydrateCards(['deck-card'], SNAP)
    expect(api.hydrate).toHaveBeenCalledTimes(calls)
  })
})

describe('card detail', () => {
  it('fetches a card the preview has already shown only once', async () => {
    await cardDetail('o1', SNAP)
    const again = await cardDetail('o1', SNAP)

    expect(api.getCardDetail).toHaveBeenCalledTimes(1)
    // The combos with their piece names — the part that is its own request.
    expect(again.combos[0]?.pieces[0]?.name).toBe('Card o1')
  })

  it('collapses two opens of the same card that race', async () => {
    // One mouse click on a suggestion calls `open` twice — the name button and
    // the cell around it both handle it — so neither call has resolved when the
    // other starts and a value cache would miss both times.
    const [a, b] = await Promise.all([cardDetail('o1', SNAP), cardDetail('o1', SNAP)])
    expect(api.getCardDetail).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('does not remember a failure', async () => {
    api.getCardDetail.mockRejectedValueOnce(new Error('upstream blip'))
    await expect(cardDetail('o1', SNAP)).rejects.toThrow('upstream blip')
    // The preview opens from already-hydrated card text and slots the detail in
    // when it lands, so a failed fetch has to stay retryable.
    await expect(cardDetail('o1', SNAP)).resolves.toBeTruthy()
    expect(api.getCardDetail).toHaveBeenCalledTimes(2)
  })

  it('re-fetches after the snapshot moves', async () => {
    await cardDetail('o1', SNAP)
    await cardDetail('o1', 'snapshot-b')
    expect(api.getCardDetail).toHaveBeenCalledTimes(2)
  })

  it('never caches without a snapshot', async () => {
    await cardDetail('o1', null)
    await cardDetail('o1', null)
    expect(api.getCardDetail).toHaveBeenCalledTimes(2)
  })

  it('shares its invalidation with the card cache', async () => {
    // One snapshot, one corpus: a detail held past an ingest would name combo
    // pieces from a set of cards the hydrated maps no longer describe.
    await cardDetail('o1', SNAP)
    await hydrateCards(['o1'], 'snapshot-b')
    await cardDetail('o1', 'snapshot-b')
    expect(api.getCardDetail).toHaveBeenCalledTimes(2)
  })
})
