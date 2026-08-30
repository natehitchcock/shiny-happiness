// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Suggestion group headings: collapsing, expanding, and what happens to a
 * category the deck has already satisfied.
 *
 * The satisfied case is the one with a bug behind it. An empty group used to be
 * filtered out of the list entirely, so a category vanished at the moment it
 * was met — which reads as the app losing it, not finishing it.
 */
vi.mock('./api', () => ({
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

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  commanders: ['c1'],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
}

const item = (oracleId: string): api.Recommendation =>
  ({
    oracleId,
    comboDegree: 0,
    nearCombosAt1: 0,
    score: 1,
    reasons: ['because'],
  }) as unknown as api.Recommendation

const group = (key: string, label: string, items: readonly string[]): api.Group =>
  ({
    key,
    label,
    rationale: 'why this group exists',
    total: items.length,
    items: items.map(item),
  }) as unknown as api.Group

const recsWith = (groups: readonly api.Group[]): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups,
    columns: [],
    unavailable: [],
    query: { matched: groups.length, errors: [] },
  }) as unknown as api.Recommendations

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue(
    recsWith([
      group('fills-ramp', 'Fills ramp', ['o1']),
      group('fills-removal', 'Fills removal', []),
    ]),
  )
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 1, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 3,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [],
  } satisfies api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      ['o1', card('o1', 'Krenko, Mob Boss')],
      ['o2', card('o2', 'Goblin Matron')],
    ]),
    prices: new Map([
      ['o1', 1.5],
      ['o2', 0.5],
    ]),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const toggleFor = (key: string): HTMLElement | undefined =>
  screen.getAllByRole('button').find((b) => b.getAttribute('aria-controls') === `group-${key}`)

describe('a satisfied category', () => {
  it('keeps its heading and collapses instead of disappearing', async () => {
    render(<Workspace deck={deck} />)

    // The regression: this heading was removed from the DOM the moment the
    // deck stopped needing removal, so the user could not tell "met" from
    // "gone".
    await waitFor(() => expect(screen.getByText('Fills removal')).toBeTruthy())
    expect(screen.getByText('satisfied')).toBeTruthy()
    expect(toggleFor('fills-removal')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves a group that still has rows expanded', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())
    expect(toggleFor('fills-ramp')?.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('collapsing a group by hand', () => {
  it('hides its rows without asking the server anything', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())
    const before = mocked.getRecommendations.mock.calls.length

    await act(async () => toggleFor('fills-ramp')?.click())

    expect(screen.queryByText('Krenko, Mob Boss')).toBeNull()
    // Purely a view state. A collapse that cost a recompute would be absurd.
    expect(mocked.getRecommendations.mock.calls.length).toBe(before)
    // The heading is still there to expand again.
    expect(screen.getByText('Fills ramp')).toBeTruthy()
  })
})

describe('expanding a group', () => {
  it('asks for more of that one group only, and shows the new rows', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())

    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-ramp', 'Fills ramp', ['o1', 'o2'])]),
    )
    await act(async () =>
      screen
        .getAllByRole('button', { name: /Ask for more fills ramp/ })
        .at(0)
        ?.click(),
    )

    await waitFor(() => {
      const call = mocked.getRecommendations.mock.calls.at(-1)?.[1]
      // Narrowed to the one key rather than raising the limit for all nine
      // headings, which would quadruple a recompute nobody asked for.
      expect(call?.groups).toEqual(['fills-ramp'])
      expect(call?.limitPerGroup).toBe(32)
    })

    await waitFor(() => expect(screen.getByText('Goblin Matron')).toBeTruthy())
    // The rows already on screen are kept, not replaced.
    expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy()
  })

  it('expands a group the user had collapsed', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())

    await act(async () => toggleFor('fills-ramp')?.click())
    expect(screen.queryByText('Krenko, Mob Boss')).toBeNull()

    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-ramp', 'Fills ramp', ['o1', 'o2'])]),
    )
    await act(async () =>
      screen
        .getAllByRole('button', { name: /Ask for more fills ramp/ })
        .at(0)
        ?.click(),
    )

    // Asking for more of something you cannot see would be pointless.
    await waitFor(() => expect(screen.getByText('Goblin Matron')).toBeTruthy())
  })
})
