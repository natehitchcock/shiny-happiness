// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Accepting and rejecting from the keyboard (AGENTS.md R4, pillar P1).
 *
 * The defect: focus the filter box, Tab to an "Add" button, press Enter. The
 * card is added — and `document.activeElement` becomes `<body>`, because the
 * button the user was standing on was replaced by a spinner and nothing caught
 * the focus it dropped. The next Tab therefore restarts at the top of the
 * document, so working through 98 suggestions costs seven tabs per card and the
 * feed is effectively mouse-only. Nothing was announced either: the sole
 * `aria-live` region on the page was the progress bar, and it read "Preparing…"
 * while the pipeline sat idle.
 *
 * The pattern was already in `App.tsx` — the preview stores `previewOpener` and
 * hands focus back on close — it had simply never been applied here.
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
  entries: [],
}

const item = (oracleId: string): api.Recommendation =>
  ({
    oracleId,
    comboDegree: 0,
    nearCombosAt1: 0,
    score: 1,
    combos: [],
    reasons: [{ kind: 'staple' }],
  }) as unknown as api.Recommendation

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  colors: ['R'],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const NAMES: [string, string][] = [
  ['o1', 'Krenko, Mob Boss'],
  ['o2', 'Goblin Matron'],
  ['o3', 'Skirk Prospector'],
]

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'staple',
        label: 'Staples',
        rationale: 'widely played',
        total: 3,
        items: NAMES.map(([id]) => item(id)),
      },
    ],
    columns: [],
    unavailable: [],
    query: { matched: 3, total: 3, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 0, byRole: {} },
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
  // All three maps. A `hydrate` mock that omits one makes the whole load throw
  // inside `apply`, and every panel disappears with no error anywhere.
  mocked.hydrate.mockResolvedValue({
    cards: new Map(NAMES.map(([id, name]) => [id, card(id, name)])),
    prices: new Map(NAMES.map(([id]) => [id, 1])),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.sendCommands.mockResolvedValue({
    deck: { ...deck, version: 2 },
  } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)
})

afterEach(cleanup)

const showFeed = async (): Promise<void> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByLabelText('Add Krenko, Mob Boss')).toBeTruthy())
}

/** Focus a control and activate it, the way pressing Enter on it would. */
const pressFrom = async (label: string): Promise<void> => {
  const button = screen.getByLabelText(label)
  button.focus()
  expect(document.activeElement).toBe(button)
  await act(async () => button.click())
}

describe('accepting a suggestion with the keyboard', () => {
  it('moves focus to the row that takes its place, never to the body', async () => {
    await showFeed()
    await pressFrom('Add Krenko, Mob Boss')

    // The regression, stated as the thing that was actually observed.
    expect(document.activeElement).not.toBe(document.body)
    // Forward, not back: the control pressed is gone and its row is now a
    // spinner, so the useful destination is the next card's own Add.
    expect(document.activeElement).toBe(screen.getByLabelText('Add Goblin Matron'))
  })

  it('confirms the add in a live region', async () => {
    await showFeed()
    await pressFrom('Add Krenko, Mob Boss')

    const live = document.querySelector('p[aria-live="polite"][role="status"]')
    expect(live?.textContent).toContain('Krenko, Mob Boss added')
    // The count is what makes a second identical add audible at all: a live
    // region does not re-announce text it is already showing.
    expect(live?.textContent).toContain('1 card in the deck')
  })

  it('keeps moving forward through consecutive adds', async () => {
    // The whole point. Three cards accepted should cost three keystrokes, not
    // three keystrokes and fourteen tabs.
    await showFeed()
    await pressFrom('Add Krenko, Mob Boss')
    await act(async () => (document.activeElement as HTMLElement).click())
    expect(document.activeElement).toBe(screen.getByLabelText('Add Skirk Prospector'))
  })

  it('falls back to the row above when the last row is taken', async () => {
    await showFeed()
    await pressFrom('Add Skirk Prospector')
    expect(document.activeElement).toBe(screen.getByLabelText('Add Goblin Matron'))
  })
})

describe('rejecting a suggestion with the keyboard', () => {
  it('moves focus on even though the whole row vanishes', async () => {
    // Reject is the harder case: accept leaves the row in place with a spinner
    // in it, reject removes the row from the feed entirely.
    await showFeed()
    await pressFrom('Reject Krenko, Mob Boss')

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(screen.getByLabelText('Add Goblin Matron'))
  })

  it('says what it did, and does not claim the card was added', async () => {
    await showFeed()
    await pressFrom('Reject Krenko, Mob Boss')
    const live = document.querySelector('p[aria-live="polite"][role="status"]')
    expect(live?.textContent).toContain('Krenko, Mob Boss rejected')
    expect(live?.textContent).not.toContain('added')
  })
})

describe('focus the user has moved themselves', () => {
  it('is left alone', async () => {
    // Someone who clicks Add and immediately goes back to the filter box must
    // not be dragged into the feed by an effect that fires a tick later.
    await showFeed()
    const add = screen.getByLabelText('Add Krenko, Mob Boss')
    add.focus()
    await act(async () => {
      add.click()
      screen.getByLabelText('Filter suggestions').focus()
    })
    expect(document.activeElement).toBe(screen.getByLabelText('Filter suggestions'))
  })
})

describe('the progress bar as a live region', () => {
  it('says nothing while nothing is happening', async () => {
    // It used to read "Preparing…" forever: the label callback returned that
    // string whenever no commands were queued, which is the idle state and the
    // whole of every filter recompute. A live region that lies is worse than
    // no live region.
    await showFeed()
    await waitFor(() =>
      expect(document.querySelector('.progress')?.getAttribute('data-active')).toBe('false'),
    )
    expect(document.querySelector('.progress-label')?.textContent).toBe('')
  })

  it('says what is being done once something is', async () => {
    await showFeed()
    await pressFrom('Add Krenko, Mob Boss')
    expect(document.querySelector('.progress-label')?.textContent).toBe('Adding 1 card…')
  })
})
