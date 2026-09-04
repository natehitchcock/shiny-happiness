// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { Workspace } from '../App'
import type { DeckWebProps } from './DeckWeb'

/**
 * What the workspace hands the deck web, render after render.
 *
 * `settle.test.tsx` pins the component's side of this: it must not re-settle
 * when the props are rebuilt. This pins the other side — the workspace must not
 * rebuild them in the first place. `order` and `accepted` were `.map` and
 * `.filter` results computed inline, so every unrelated piece of workspace state
 * — a slider, a filter keystroke, the progress bar ticking at 60 Hz while a
 * recommendation query runs — produced new arrays holding exactly the same ids
 * and re-sorted the whole deck rail to produce them.
 *
 * Asserted on identity deliberately. Equal contents is what the component now
 * checks for itself; the claim here is the stronger one, that nothing was
 * rebuilt at all.
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
  getDeck: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

/** Every set of props the deck web was rendered with, in order. */
const seen = vi.hoisted(() => [] as DeckWebProps[])

vi.mock('./DeckWeb', () => ({
  DeckWeb: (props: DeckWebProps) => {
    seen.push(props)
    return <section data-testid="deck-web" />
  },
}))

const mocked = vi.mocked(api)

const card = (over: Partial<api.Card> & { oracleId: string; name: string }): api.Card => ({
  manaCost: '{2}{B}',
  manaValue: 3,
  typeLine: 'Creature — Human',
  types: ['creature'],
  colors: ['B'],
  oracleText: '',
  colorIdentity: ['B'],
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

const IDS = Array.from({ length: 12 }, (_, i) => `c${String(i)}`)

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['cmd'],
  colorIdentity: ['B'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: IDS.map((oracleId) => ({ oracleId, zone: 'accepted' as const, locked: false })),
}

const analysis: api.Analysis = {
  counts: { total: IDS.length, byRole: {} },
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

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  seen.length = 0
  window.location.hash = '#web'
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    emphasis: [],
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
  })
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([...IDS, 'cmd'].map((id) => [id, card({ oracleId: id, name: `Card ${id}` })])),
    prices: new Map(),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.patchDeck.mockResolvedValue({ ...deck, version: deck.version + 1 })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(() => {
  window.location.hash = ''
  cleanup()
})

/** Change one piece of workspace state that has nothing to do with the deck. */
const nudge = (): void => {
  const slider = document.querySelector(
    'input[aria-label^="How many faults"]',
  ) as HTMLInputElement | null
  if (slider === null) throw new Error('the cut-hint slider is not on screen')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(slider, slider.value === '2' ? '3' : '2')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the props the workspace hands the deck web', () => {
  it('keep their identity when nothing about the deck changed', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    await waitFor(() => expect(mocked.hydrate).toHaveBeenCalled())

    const before = seen[seen.length - 1]
    if (before === undefined) throw new Error('the deck web never rendered')
    nudge()
    nudge()
    const after = seen[seen.length - 1]
    if (after === undefined) throw new Error('the deck web never rendered')

    expect(after).not.toBe(before) // the nudge really did re-render it
    expect(after.order).toBe(before.order)
    expect(after.accepted).toBe(before.accepted)
    expect(after.commanders).toBe(before.commanders)
    expect(after.cards).toBe(before.cards)
    expect(after.images).toBe(before.images)
    expect(after.combos).toBe(before.combos)
  })
})
