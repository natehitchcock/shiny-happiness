// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * A retried batch must present the SAME idempotency key.
 *
 * Doc 10 §10.1 makes a batch idempotent so a retry cannot double-apply, and
 * `sendCommands` used to mint a fresh uuid inside itself — so every retry was a
 * new batch as far as the server was concerned. A 5xx that had in fact
 * committed would then be applied twice, and accepting a card twice is a real
 * change to the deck. The comment above the key asserted the very property the
 * code was breaking.
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

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  commanders: [],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
} as unknown as api.Deck

const card: api.Card = {
  oracleId: 'o1',
  name: 'Krenko, Mob Boss',
  manaCost: '{2}{R}{R}',
  manaValue: 4,
  typeLine: 'Legendary Creature — Goblin Warrior',
  types: ['creature'],
  oracleText: '',
  power: '3',
  toughness: '3',
  loyalty: null,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
} as unknown as api.Card

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'fills-ramp',
        label: 'Fills ramp',
        rationale: 'why',
        total: 1,
        items: [{ oracleId: 'o1', comboDegree: 0, nearCombosAt1: 0, score: 1, reasons: ['x'] }],
      },
    ],
    columns: [],
    unavailable: [],
    query: { matched: 1, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 0, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 0,
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
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['o1', card]]),
    prices: new Map([['o1', 1]]),
  } as unknown as api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

describe('retrying a batch', () => {
  it('presents the same idempotency key on every attempt', async () => {
    // First attempt 503, second succeeds — the shape that used to double-apply.
    mocked.sendCommands
      .mockRejectedValueOnce(new api.ApiError('upstream blip', 503))
      .mockResolvedValue({ deck: { ...deck, version: 2 } } as unknown as api.CommandResult)

    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Add Krenko, Mob Boss')).toBeTruthy())
    await act(async () => screen.getByLabelText('Add Krenko, Mob Boss').click())

    await waitFor(() => expect(mocked.sendCommands.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 8_000,
    })

    const keys = mocked.sendCommands.mock.calls.map((c) => c[3])
    expect(keys[0]).toBeTruthy()
    // The whole point: the server must be able to recognise the second attempt
    // as the same batch it may already have committed.
    expect(new Set(keys).size).toBe(1)
  }, 20_000)
})
