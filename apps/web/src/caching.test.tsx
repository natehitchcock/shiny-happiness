// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'
import { clearCardCache } from './cardcache'

/**
 * What a click costs, counted in cards.
 *
 * The workspace re-hydrated its ENTIRE page on every recompute — every accept,
 * every reject, every filter change, every auto-query tick — because the
 * pipeline ended in `setCards(hydrated.cards)`, a replace. A user panning
 * through a 99-card deck re-downloaded ninety-nine names, type lines, oracle
 * texts, mana costs, synergy tags, art URLs and prices to be told the same
 * thing each time.
 *
 * These assert the request, not a rendering: how many `/cards/batch` calls a
 * sequence of clicks makes and how many ids each one carries. The numbers in
 * them are the measurement — a change that quietly went back to re-asking for
 * held cards would still render correctly and would fail here.
 */
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof api>('./api')
  return {
    ...actual,
    getRecommendations: vi.fn(),
    getAnalysis: vi.fn(),
    hydrate: vi.fn(),
    basicLands: vi.fn(),
    sendCommands: vi.fn(),
    patchDeck: vi.fn(),
    importPreview: vi.fn(),
    getCardDetail: vi.fn(),
    searchCards: vi.fn(),
    getDeck: vi.fn(),
  }
})

const mocked = vi.mocked(api)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

const SNAP = 'ingest-2026-08-01'
/** A real Commander deck, minus the commander: 99 cards is the whole point. */
const DECK_SIZE = 99
/** What the server sends per heading by default (`limitPerGroup: 8`). */
const PAGE = 8

const named = (oracleId: string): api.Card =>
  ({
    oracleId,
    name: `Card ${oracleId}`,
    manaCost: '{1}{R}',
    manaValue: 2,
    typeLine: 'Creature — Goblin',
    types: ['creature'],
    oracleText: `Rules text for ${oracleId}.`,
    power: '1',
    toughness: '1',
    loyalty: null,
    colorIdentity: ['R'],
    primaryRole: 'beater',
    edhrecRank: null,
    universesBeyond: false,
    synergyProduces: [],
    synergyWants: [],
  }) as unknown as api.Card

const deckIds = Array.from({ length: DECK_SIZE }, (_, i) => `d${String(i)}`)

let deckState: api.Deck
let suggestions: string[]
let minted: number

/** Every id asked for, flattened across calls — the number that matters. */
const idsRequested = (): string[] => mocked.hydrate.mock.calls.flatMap((c) => c[0])

beforeEach(() => {
  vi.resetAllMocks()
  clearCardCache()
  minted = 0
  suggestions = Array.from({ length: PAGE }, (_, i) => `s${String(i)}`)
  deckState = {
    id: 'd1',
    name: 'Test deck',
    description: '',
    commanders: ['cmd'],
    colorIdentity: ['R'],
    targetBracket: 3,
    archetype: 'midrange',
    version: 1,
    excludeUniversesBeyond: false,
    budget: null,
    entries: deckIds.map((oracleId) => ({ oracleId, zone: 'accepted' as const, locked: false })),
  }

  mocked.getRecommendations.mockImplementation(() =>
    Promise.resolve({
      datasetSnapshotId: SNAP,
      groups: [
        {
          key: 'fills-ramp',
          label: 'Fills ramp',
          rationale: 'why',
          total: suggestions.length,
          items: suggestions.map((oracleId) => ({
            oracleId,
            score: 1,
            comboDegree: 0,
            nearCombosAt1: 0,
            completedCombos: [],
            combos: [],
            reasons: [{ kind: 'fills-deficit' }],
          })),
        },
      ],
      columns: [],
      unavailable: [],
      query: { matched: suggestions.length, total: suggestions.length, errors: [] },
    } as unknown as api.Recommendations),
  )

  mocked.getAnalysis.mockResolvedValue({
    counts: { total: DECK_SIZE, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)

  // Answers for exactly what was asked for, in all three maps — a mock that
  // omits one of them makes `load` fail silently and every panel vanish.
  mocked.hydrate.mockImplementation((ids: string[]) =>
    Promise.resolve({
      cards: new Map(ids.map((id) => [id, named(id)])),
      prices: new Map(ids.map((id) => [id, 1])),
      images: new Map(ids.map((id) => [id, { artCrop: `art/${id}`, normal: `full/${id}` }])),
    }),
  )

  // The server's half of an accept: the card joins the deck, and the heading
  // backfills with one the client has never seen. That backfill is the only
  // card a recompute can honestly need.
  mocked.sendCommands.mockImplementation((_id, commands) => {
    // Only the two the workspace sends from a row. `DeckCommand` has variants
    // with no `oracleId` at all, so the narrowing is not ceremony.
    for (const c of commands) {
      if (c.type !== 'accept' && c.type !== 'exclude') continue
      const target = String(c.oracleId)
      suggestions = suggestions.filter((s) => s !== target)
      if (c.type === 'accept') {
        minted += 1
        suggestions.push(`new${String(minted)}`)
      }
      deckState = {
        ...deckState,
        version: deckState.version + 1,
        entries: [
          ...deckState.entries,
          { oracleId: target, zone: c.type === 'accept' ? 'accepted' : 'excluded', locked: false },
        ],
      }
    }
    return Promise.resolve({ deck: deckState, applied: [], rejected: [] })
  })

  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockImplementation((oracleId: string) =>
    Promise.resolve({ ...named(oracleId), printings: [], combos: [] } as unknown as api.CardDetail),
  )
})

afterEach(() => {
  cleanup()
  clearCardCache()
})

describe('what a recompute costs', () => {
  it('asks only for the card it has never seen', async () => {
    render(<Workspace deck={deckState} />)
    await waitFor(() => expect(screen.getByLabelText('Add Card s0')).toBeTruthy())

    // First paint pays for the whole page, once: the commander, 99 deck cards
    // and eight suggestions.
    const first = 1 + DECK_SIZE + PAGE
    expect(mocked.hydrate).toHaveBeenCalledTimes(1)
    expect(mocked.hydrate.mock.calls[0]?.[0]).toHaveLength(first)

    // One at a time, waiting for the backfilled row each accept produces —
    // clicking through the buffer would batch them into a single recompute and
    // measure something easier than what a user actually does.
    for (const [i, target] of ['s0', 's1', 's2'].entries()) {
      await act(async () => screen.getByLabelText(`Add Card ${target}`).click())
      await waitFor(
        () => expect(screen.getByLabelText(`Add Card new${String(i + 1)}`)).toBeTruthy(),
        { timeout: 10_000 },
      )
    }

    /*
     * Three accepts, three backfilled suggestions, three ids on the wire.
     *
     * Before the cache each of those recomputes re-sent the whole page: three
     * accepts cost 3 × 108 = 324 ids and 108 cards' worth of oracle text, art
     * URLs and prices came back three times over. Now the deck and the seven
     * suggestions that survived each click are already held, so the only thing
     * asked for is the row that appeared.
     */
    const afterAccepts = idsRequested().slice(first)
    expect(afterAccepts).toEqual(['new1', 'new2', 'new3'])
    expect(idsRequested()).toHaveLength(first + 3)
  }, 40_000)

  it('makes no request at all when nothing new is on the page', async () => {
    render(<Workspace deck={deckState} />)
    await waitFor(() => expect(screen.getByLabelText('Add Card s0')).toBeTruthy())
    expect(mocked.hydrate).toHaveBeenCalledTimes(1)

    // A recompute over an unchanged page — what an auto-query tick or a
    // rejected filter edit produces. Every id is held, so the miss list is
    // empty and `/cards/batch` is never reached.
    await act(async () => screen.getByLabelText('Reject Card s0').click())
    await waitFor(() => expect(screen.queryByLabelText('Reject Card s0')).toBeNull(), {
      timeout: 10_000,
    })

    // A rejection takes a row away rather than adding one, so the page that
    // comes back is a strict subset of what is already held. The miss list is
    // empty and the count stays at the single call first paint made.
    expect(mocked.hydrate).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('keeps every deck card readable across a recompute', async () => {
    // The other half of the same change. `setCards` used to REPLACE, so a
    // hydrate that came back short left rows reading "Loading…" for good; the
    // cache returns everything it holds, so the rail never loses a name.
    render(<Workspace deck={deckState} />)
    await waitFor(() => expect(screen.getByLabelText('Add Card s0')).toBeTruthy())

    await act(async () => screen.getByLabelText('Add Card s0').click())
    await waitFor(() => expect(screen.getByLabelText('Add Card new1')).toBeTruthy(), {
      timeout: 10_000,
    })

    expect(screen.getAllByText('Card d0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Card d98').length).toBeGreaterThan(0)
    expect(screen.queryByText('Loading…')).toBeNull()
  }, 20_000)
})

describe('what a preview costs', () => {
  it('fetches a card detail once however often it is opened', async () => {
    render(<Workspace deck={deckState} />)
    await waitFor(() => expect(screen.getByLabelText('Add Card s0')).toBeTruthy())

    await act(async () => screen.getAllByLabelText('Preview Card s0')[0]!.click())
    await waitFor(() => expect(mocked.getCardDetail).toHaveBeenCalledTimes(1))
    await act(async () => screen.getByLabelText('Close preview').click())

    // Clicking along a row of suggestions and back is the ordinary way to read
    // them, and every trip used to re-fetch printings and combos that cannot
    // have changed.
    await act(async () => screen.getAllByLabelText('Preview Card s0')[0]!.click())
    await waitFor(() => expect(screen.getByLabelText('Close preview')).toBeTruthy())
    expect(mocked.getCardDetail).toHaveBeenCalledTimes(1)
  }, 20_000)
})
