// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * How many faults a card needs before the deck list warns about it.
 *
 * One fault is usually not a signal: a card that completes a combo often has no
 * derived synergy, and a card with heavy synergy often completes nothing, so
 * every deck used to be covered in single-fault hints that meant nothing. The
 * threshold is the user's dial for that, defaulting to two and remembered.
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
  commanders: [],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [
    { oracleId: 'one', zone: 'accepted', locked: false },
    { oracleId: 'two', zone: 'accepted', locked: false },
  ],
}

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
  localStorage.clear()
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 2, byRole: {} },
    targets: [],
    // 'one' has a single fault; 'two' has two. Two is the default threshold,
    // so exactly one of these should be warned about on first paint.
    cuts: [
      { oracleId: 'one', score: 1, reasons: [{ kind: 'no-synergy' }] },
      { oracleId: 'two', score: 2, reasons: [{ kind: 'no-synergy' }, { kind: 'over-curve' }] },
    ],
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
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      ['one', card('one', 'Single Fault')],
      ['two', card('two', 'Double Fault')],
    ]),
    prices: new Map([
      ['one', 1],
      ['two', 1],
    ]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

/** The deck row's own button, so a suggestion row of the same name cannot match. */
const hintsOn = (name: string): number =>
  screen.getByLabelText(`Preview ${name}`).querySelectorAll('.reason.cut').length

const slider = (): HTMLInputElement => screen.getByLabelText(/How many faults/) as HTMLInputElement

const setSlider = async (value: number): Promise<void> => {
  const input = slider()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the cut-hint threshold', () => {
  it('starts at two, so a single fault is not shown', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Double Fault')).toBeTruthy())

    expect(slider().value).toBe('2')
    expect(hintsOn('Single Fault')).toBe(0)
    expect(hintsOn('Double Fault')).toBe(2)
  })

  it('shows the single fault when dragged down to one', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Double Fault')).toBeTruthy())

    await setSlider(1)
    expect(hintsOn('Single Fault')).toBe(1)
    expect(hintsOn('Double Fault')).toBe(2)
  })

  it('silences both when dragged past what either card has', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Double Fault')).toBeTruthy())

    await setSlider(3)
    expect(hintsOn('Single Fault')).toBe(0)
    expect(hintsOn('Double Fault')).toBe(0)
  })

  it('remembers the choice across a reload', async () => {
    const first = render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Double Fault')).toBeTruthy())
    await setSlider(4)
    first.unmount()

    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Double Fault')).toBeTruthy())
    expect(slider().value).toBe('4')
  })
})
