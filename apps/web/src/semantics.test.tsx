// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The Semantics block in the preview pane, and what a tag's tooltip says.
 *
 * Two things are asserted here because both were wrong. The headings said
 * "Causes" and "Pays off" — jargon for the same relation "benefits from" states
 * plainly, and the odd one out once every other surface had been reworded. And
 * a tag is a FILTER FIELD as well as a label, which nothing on screen said.
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
  description: '',
  commanders: [],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
}

const sculptor: api.Card = {
  oracleId: 'o1',
  name: 'Etherium Sculptor',
  manaCost: '{1}{U}',
  manaValue: 2,
  typeLine: 'Artifact Creature — Vedalken Artificer',
  types: ['artifact', 'creature'],
  oracleText: 'Artifact spells you cast cost {1} less to cast.',
  power: '1',
  toughness: '2',
  loyalty: null,
  colorIdentity: ['U'],
  primaryRole: 'ramp',
  edhrecRank: 900,
  universesBeyond: false,
  synergyProduces: ['treasure'],
  synergyWants: ['artifact-etb'],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 1, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 1, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 1, pricedCards: 1, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['o1', sculptor]]),
    prices: new Map([['o1', 1]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...sculptor,
    printings: [],
    combos: [],
  } as unknown as api.CardDetail)
})

afterEach(cleanup)

const openPreview = async (): Promise<void> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByLabelText('Preview Etherium Sculptor')).toBeTruthy())
  await act(async () => screen.getByLabelText('Preview Etherium Sculptor').click())
  await waitFor(() => expect(screen.getByText('Semantics')).toBeTruthy())
}

describe('the two directions are named in plain words', () => {
  it('says "Causes" and "Benefits from"', async () => {
    await openPreview()
    expect(screen.getByText('Causes')).toBeTruthy()
    expect(screen.getByText('Benefits from')).toBeTruthy()
    // "Pays off" is Magic jargon for exactly the relation the other heading
    // states plainly, so it should not appear anywhere.
    expect(screen.queryByText(/pays off/i)).toBeNull()
  })
})

describe('a tag tooltip says how to filter by it', () => {
  it('gives the one-sided field and the either-side one', async () => {
    await openPreview()

    // The chip under "Benefits from" — the tag this card wants.
    const chip = screen.getByText('artifact etb')
    await act(async () => (chip.closest('button') as HTMLButtonElement).click())

    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('wants:artifact-etb')
    expect(tip.textContent).toContain('tag:artifact-etb')
  })

  it('names the produces side for a tag the card causes', async () => {
    await openPreview()

    const chip = screen.getByText('treasure')
    await act(async () => (chip.closest('button') as HTMLButtonElement).click())

    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('produces:treasure')
    expect(tip.textContent).toContain('tag:treasure')
  })
})
