import { describe, expect, it } from 'vitest'
import { loadCommanderSet } from './scryfall-ingest.js'

/**
 * Which source decides commander eligibility.
 *
 * Scryfall's `is:commander` is the authority and `deriveCanBeCommander` is the
 * fallback, and they disagree about 36 cards — 31 legendary Vehicles and
 * Spacecraft the derivation refuses, and 5 meld backs it wrongly accepts. So
 * the branch that chooses is worth its own tests: picking the wrong one is
 * silent, and the symptom is a user who cannot create a Shorikai deck.
 *
 * No network (AGENTS.md §3). The pages are synthetic envelopes here rather than
 * the recorded fixtures used in `packages/clients` — what is under test is the
 * COUNT and the failure mode, not the parsing, and 1,200 recorded cards would
 * be bulk card data this repo does not commit (AGENTS.md §5).
 */

const page = (ids: readonly string[], hasMore = false): unknown => ({
  object: 'list',
  total_cards: ids.length,
  has_more: hasMore,
  data: ids.map((id) => ({ oracle_id: id })),
})

const idsOf = (n: number, offset = 0): string[] =>
  Array.from({ length: n }, (_, i) => `id-${String(i + offset)}`)

const serving = (body: unknown, status = 200): typeof fetch =>
  (() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response)) as unknown as typeof fetch

const failing = (message: string): typeof fetch =>
  (() => Promise.reject(new Error(message))) as unknown as typeof fetch

const noSleep = (): Promise<void> => Promise.resolve()

describe('loadCommanderSet', () => {
  it('uses the search when it answers plausibly', async () => {
    const result = await loadCommanderSet({
      fetchImpl: serving(page(idsOf(3411))),
      sleepImpl: noSleep,
    })

    expect(result.ids?.size).toBe(3411)
    expect(result.report).toEqual({ source: 'scryfall-search', fetched: 3411, reason: null })
  })

  it('falls back to the derivation when the search cannot be reached', async () => {
    // The ingest must still finish. A corpus with no cards at all is worse than
    // a corpus whose eligibility agrees with Scryfall on 3,380 of 3,411.
    const result = await loadCommanderSet({
      fetchImpl: failing('getaddrinfo ENOTFOUND api.scryfall.com'),
      sleepImpl: noSleep,
    })

    expect(result.ids).toBeNull()
    expect(result.report.source).toBe('derived-from-oracle-text')
    expect(result.report.fetched).toBeNull()
    expect(result.report.reason).toMatch(/ENOTFOUND/)
  })

  it('does not abort the whole ingest over one auxiliary query', async () => {
    // Not a rethrow, not a process exit. Everything else in the corpus is still
    // worth writing.
    await expect(
      loadCommanderSet({ fetchImpl: serving(null, 500), sleepImpl: noSleep }),
    ).resolves.toBeDefined()
  })

  it('refuses a complete but implausibly small answer', async () => {
    /*
     * The failure the pagination guard cannot see. If `is:commander` ever stops
     * meaning what it means, the search answers 200 with a whole, tiny, wrong
     * set — nothing about it looks truncated — and writing it would mark
     * thousands of real commanders ineligible and break deck creation for
     * everyone.
     */
    const result = await loadCommanderSet({
      fetchImpl: serving(page(idsOf(12))),
      sleepImpl: noSleep,
    })

    expect(result.ids).toBeNull()
    expect(result.report.source).toBe('derived-from-oracle-text')
    // The count is still reported: an operator needs to see what it got, not
    // just that it was rejected.
    expect(result.report.fetched).toBe(12)
    expect(result.report.reason).toMatch(/is:commander legal:commander/)
  })

  it('does not fire the tripwire on a normal answer', async () => {
    // An order of magnitude of headroom below 3,411. This must never trip
    // because Scryfall printed a set, only because the query changed meaning.
    const result = await loadCommanderSet({
      fetchImpl: serving(page(idsOf(1200))),
      sleepImpl: noSleep,
    })

    expect(result.report.source).toBe('scryfall-search')
  })
})
