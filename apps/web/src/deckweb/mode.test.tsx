// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { Workspace } from '../App'

/**
 * The `#web` mode switch (doc 17 §17.1).
 *
 * The deck web replaces everything below the masthead and is reached from a
 * control in it. What these pin is the two halves that are easy to get wrong:
 * that the masthead survives the switch, because it is how you get back — and
 * that the workspace is HIDDEN rather than unmounted, because unmounting it
 * re-runs the whole recommendation pipeline every time somebody toggles a view
 * of data already in memory.
 */

vi.mock('../api', () => ({
  getRecommendations: vi.fn(),
  getAnalysis: vi.fn(),
  hydrate: vi.fn(),
  basicLands: vi.fn(),
  sendCommands: vi.fn(),
  patchDeck: vi.fn(),
  importPreview: vi.fn(),
  getCardDetail: vi.fn(),
  searchCards: vi.fn(),
  createDeck: vi.fn(),
  getDeck: vi.fn(),
  listDecks: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

const mocked = vi.mocked(api)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

const card = (over: Partial<api.Card> & { oracleId: string; name: string }): api.Card => ({
  manaCost: '{1}{B}',
  manaValue: 2,
  typeLine: 'Creature — Human',
  types: ['creature'],
  oracleText: 'Sacrifice a creature: draw a card.',
  power: '1',
  toughness: '1',
  loyalty: null,
  colorIdentity: ['B'],
  primaryRole: 'engine',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

const CARDS = [
  card({ oracleId: 'outlet', name: 'Viscera Seer', synergyProduces: ['creature-death'] }),
  card({ oracleId: 'drain', name: 'Blood Artist', synergyWants: ['creature-death'] }),
  // A land, so the rail has two sections and "deck order" is a real order
  // rather than one alphabetical list.
  card({
    oracleId: 'swamp',
    name: 'Swamp',
    typeLine: 'Basic Land — Swamp',
    types: ['land'],
    oracleText: '{T}: Add {B}.',
    primaryRole: 'land',
  }),
]

const deck: api.Deck = {
  id: 'd1',
  name: 'Aristocrats',
  description: '',
  commanders: [],
  colorIdentity: ['B'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [
    { oracleId: 'outlet', zone: 'accepted', locked: false },
    { oracleId: 'drain', zone: 'accepted', locked: false },
    { oracleId: 'swamp', zone: 'accepted', locked: false },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  window.location.hash = ''
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 2, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 2, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 2, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  /*
   * All THREE maps. `hydrate` returns `images` beside `cards` and `prices`
   * since ADR-0021, and a mock that returns only two makes the whole load
   * fail with no error anyone can see.
   */
  mocked.hydrate.mockResolvedValue({
    cards: new Map(CARDS.map((c) => [c.oracleId, c])),
    prices: new Map([
      ['outlet', 0.5],
      ['drain', 3.5],
    ]),
    images: new Map([
      ['outlet', { artCrop: null, normal: null }],
      ['drain', { artCrop: null, normal: null }],
    ]),
  })
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const enterWeb = async (): Promise<void> => {
  await act(async () => screen.getByRole('button', { name: 'Web' }).click())
  await waitFor(() => expect(screen.getByLabelText(/Deck web for/)).toBeTruthy())
}

describe('entering and leaving the mode', () => {
  it('swaps the workspace for the web, and keeps the masthead', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    await enterWeb()

    // The masthead is how you get back, so it survives the switch.
    expect(screen.getByText(/Lotus/)).toBeTruthy()
    expect(screen.getByLabelText('Deck web for Aristocrats')).toBeTruthy()
    // Doc 17 §17.1: the web replaces everything below the masthead.
    expect(document.querySelector('.workspace')?.hasAttribute('hidden')).toBe(true)
  })

  it('puts the mode in the URL, so it can be linked and reloaded into', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    await enterWeb()
    expect(window.location.hash).toBe('#web')
  })

  it('comes back to the workspace without re-running the pipeline', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    const callsBefore = mocked.getRecommendations.mock.calls.length
    await enterWeb()
    await act(async () => screen.getByRole('button', { name: 'Back to the list' }).click())
    await waitFor(() =>
      expect(document.querySelector('.workspace')?.hasAttribute('hidden')).toBe(false),
    )
    // The whole reason the workspace is hidden rather than unmounted.
    expect(mocked.getRecommendations.mock.calls.length).toBe(callsBefore)
    expect(window.location.hash).toBe('')
  })

  it('marks the masthead control as pressed while the mode is on', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Web' }).getAttribute('aria-pressed')).toBe('false')
    await enterWeb()
    expect(screen.getByRole('button', { name: 'Web' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('what the web is drawn from', () => {
  it('uses the cards and the art the workspace already hydrated', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    const hydrations = mocked.hydrate.mock.calls.length
    await enterWeb()
    // Doc 17 §17.2's argument against a `/decks/:id/web` endpoint, as a test:
    // everything the picture needs is already in memory.
    expect(mocked.hydrate.mock.calls.length).toBe(hydrations)
    expect(screen.getByRole('button', { name: /Viscera Seer/ })).toBeTruthy()
  })

  it('draws the connection the two cards actually have', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    await enterWeb()
    expect(screen.getByText(/1 connections · 3 cards/)).toBeTruthy()
  })

  it('walks the nodes in the order the rail lists them, section by section', async () => {
    /*
     * Doc 17 §17.6, and the reason the order is passed in from the workspace
     * rather than re-derived in the web module: "the order the user already
     * knows from the list" is only true if it IS the list's order. Read off
     * both surfaces here so the two cannot drift — the rail groups by card type
     * and sorts by name inside a group, which is not alphabetical overall.
     */
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Viscera Seer')).toBeTruthy())
    const rail = [...document.querySelectorAll('.workspace .card-row .name')].map(
      (n) => n.textContent,
    )
    expect(rail).toEqual(['Blood Artist', 'Viscera Seer', 'Swamp'])

    await enterWeb()
    const web = [...document.querySelectorAll('.web-node')].map(
      (g) => g.querySelector('title')?.textContent,
    )
    expect(web).toEqual(rail)
  })
})
