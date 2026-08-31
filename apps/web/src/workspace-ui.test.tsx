// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The workspace panels, driven through the rendered UI.
 *
 * One file rather than six, because every one of these needs the same
 * fixture — a deck, a recommendations answer, an analysis and a hydration —
 * and six copies of it is six things that drift. The describes below are the
 * feature boundaries.
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
    body: unknown
    constructor(message: string, status: number, body: unknown = null) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  },
}))

const mocked = vi.mocked(api)

/** jsdom has no ResizeObserver, and the column legend observes. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

const card = (over: Partial<api.Card> & { oracleId: string; name: string }): api.Card => ({
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'synergy',
  edhrecRank: null,
  universesBeyond: false,
  power: null,
  toughness: null,
  loyalty: null,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

export const deck: api.Deck = {
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
  entries: [],
}

const analysis: api.Analysis = {
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
}

const recs = (over: Partial<api.Recommendations> = {}): api.Recommendations => ({
  datasetSnapshotId: null,
  groups: [],
  columns: [],
  unavailable: [],
  query: { matched: 0, total: 0, errors: [] },
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(recs())
  mocked.getAnalysis.mockResolvedValue(analysis)
  // All three maps. A mock missing one loads nothing and every panel vanishes.
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['cmd', card({ oracleId: 'cmd', name: 'Krenko, Mob Boss' })]]),
    prices: new Map([['cmd', 1.5]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
  // A timed-out test never reaches its own restore, and a frozen clock leaks
  // into every test after it.
  vi.useRealTimers()
})

const typeFilter = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// -------------------------------------------------------------- auto query

describe('the auto-query setting', () => {
  const checkbox = (): HTMLInputElement =>
    screen.getByLabelText(/Auto query after/) as HTMLInputElement

  it('is off for someone who has never expressed a view', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(checkbox().checked).toBe(false)
  })

  it('keeps the choice of someone who already switched it on', async () => {
    localStorage.setItem('lw.autoQuery', 'on')
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(checkbox().checked).toBe(true)
  })

  it('names the wait it actually has, not a number left behind by an edit', async () => {
    // The label read "4 seconds" against a 2,000 ms constant.
    const { AUTO_QUERY_MS } = await import('./autoquery')
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(screen.getByLabelText(/Auto query after/).parentElement?.textContent).toContain(
      `after ${String(Math.round(AUTO_QUERY_MS / 1000))} seconds`,
    )
  })

  /*
   * Asserted through the countdown the search button advertises, not through a
   * fake clock.
   *
   * The clock version passed with the default flipped back to ON, because the
   * timer fired inside `act` and the request it caused had not been issued by
   * the time the assertion ran — a test that could not tell the two defaults
   * apart. The button's accessible name is the countdown made visible, it is
   * present the instant a wait begins, and it is the only thing on screen that
   * tells a user the setting is doing anything.
   */
  it('does not start a countdown on a fresh browser', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await typeFilter('t:creature')
    expect(screen.queryByLabelText(/runs on its own in/)).toBeNull()
  })

  it('does start one once the box is ticked — the feature still works', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await act(async () => {
      checkbox().click()
    })
    await typeFilter('t:creature')
    expect(screen.getByLabelText(/runs on its own in/)).toBeDefined()
  })
})
