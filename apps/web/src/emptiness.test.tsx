// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * What an EMPTY suggestion heading is allowed to claim.
 *
 * The bug these are written against: `rowsIn(g) === 0` drove one badge reading
 * SATISFIED, and it conflated four different situations. Two of them are the
 * app confidently reporting the opposite of the truth —
 *
 *   `Fills gap · land -27` · `0` · SATISFIED   (the deck needs 27 more lands)
 *   ten of ten headings SATISFIED              (the API was down)
 *
 * — and the second is the worse one, because it is the app asserting that every
 * need is met at the exact moment it knows nothing at all.
 *
 * Every test below asserts BOTH halves: the honest badge is present AND the
 * word "satisfied" is not, because a fix that adds a second badge beside the
 * false one has not fixed anything.
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

/**
 * `total` is deliberately a separate argument from `items`.
 *
 * The domain's `CandidateGroup.total` is "matching the query, before
 * `limitPerGroup`" — so `total === 0` with a group still present means the
 * filter withheld every candidate, and `total > 0` with no rows means the rows
 * were shown and decided on. Tying the fixture's `total` to `items.length`, the
 * way the older group fixture does, cannot express either case.
 */
const group = (
  key: string,
  label: string,
  items: readonly string[],
  total = items.length,
): api.Group =>
  ({
    key,
    label,
    rationale: 'why this group exists',
    total,
    items: items.map(item),
  }) as unknown as api.Group

const recsWith = (groups: readonly api.Group[]): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups,
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
  }) as unknown as api.Recommendations

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
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

const analysisWith = (
  deficits: { dimension: { role?: string; type?: string }; delta: number }[],
): api.Analysis =>
  ({
    counts: { total: 0, byRole: {} },
    targets: [],
    cuts: [],
    deficits,
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
  }) as unknown as api.Analysis

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getAnalysis.mockResolvedValue(analysisWith([]))
  mocked.hydrate.mockResolvedValue({
    // All three maps, always. A `hydrate` mock missing one of them throws
    // inside `apply`, the whole load fails silently and every panel vanishes.
    cards: new Map([
      ['o1', card('o1', 'Krenko, Mob Boss')],
      ['o2', card('o2', 'Goblin Matron')],
    ]),
    prices: new Map([['o1', 1.5]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

/** The badge in one group's heading, found through the toggle that names it. */
const badgeFor = (key: string): HTMLElement | null =>
  screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-controls') === `group-${key}`)
    ?.closest('.group')
    ?.querySelector<HTMLElement>('.satisfied') ?? null

const runFilter = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    screen.getByLabelText(/^Run this filter/).click()
  })
}

describe('a heading emptied by the filter', () => {
  it('says the query matched nothing, not that the deck is satisfied', async () => {
    // The repro: `t:planeswalker mv<=1` matches nothing in the land group, and
    // the deck is 27 lands short the whole time. `total` is 0 because every
    // candidate was withheld by the query — which is a fact about the query.
    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-land', 'Fills gap · land -27', [], 0)]),
    )
    mocked.getAnalysis.mockResolvedValue(
      analysisWith([{ dimension: { type: 'land' }, delta: -27 }]),
    )
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Fills gap · land -27')).toBeTruthy())

    await runFilter('t:planeswalker mv<=1')

    await waitFor(() => expect(badgeFor('fills-land')?.textContent).toBe('no match'))
    expect(screen.queryByText('satisfied')).toBeNull()
    // And the still-open gap is said, not implied by a label nobody reads.
    expect(badgeFor('fills-land')?.getAttribute('title')).toContain('27 cards short')
  })
})

describe('a heading emptied by a failed request', () => {
  it('says the list is out of date, not that every need is met', async () => {
    // With the API stopped, all ten headings read SATISFIED and the only other
    // signal was a small `Request failed (502)`. The app was asserting the deck
    // was complete at the moment it held no information about the deck at all.
    mocked.getRecommendations.mockResolvedValue(
      recsWith([
        group('staple', 'Staples', ['o1']),
        group('fills-ramp', 'Fills gap · ramp -4', [], 3),
      ]),
    )
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())

    mocked.getRecommendations.mockRejectedValue(new api.ApiError('Request failed (502)', 502))
    mocked.sendCommands.mockResolvedValue({
      deck: { ...deck, version: 2 },
    } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)
    await act(async () => screen.getByLabelText('Add Krenko, Mob Boss').click())

    await waitFor(() => expect(badgeFor('fills-ramp')?.textContent).toBe('not updated'), {
      timeout: 8_000,
    })
    expect(screen.queryByText('satisfied')).toBeNull()
  }, 20_000)
})

describe('a heading whose gap is still open', () => {
  it('reports how short the deck still is', async () => {
    // No filter and no failure — the honest reading of this one is simply that
    // there is nothing left to offer and the gap has not closed.
    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-land', 'Fills gap · land -27', [], 0)]),
    )
    mocked.getAnalysis.mockResolvedValue(
      analysisWith([{ dimension: { type: 'land' }, delta: -27 }]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(badgeFor('fills-land')?.textContent).toBe('still short 27'))
    expect(screen.queryByText('satisfied')).toBeNull()
  })

  it('is not fooled by a surplus in the same dimension', async () => {
    // `delta` is positive when the deck is OVER its ideal, and a group left
    // over from a recompute that predates the surplus must read as met, not as
    // "short -3".
    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-ramp', 'Fills gap · ramp', [], 0)]),
    )
    mocked.getAnalysis.mockResolvedValue(analysisWith([{ dimension: { role: 'ramp' }, delta: 3 }]))
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(badgeFor('fills-ramp')?.textContent).toBe('satisfied'))
  })
})

describe('a heading whose rows were all rejected', () => {
  it('says so, rather than crediting the deck with a need it has not met', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-removal', 'Fills gap · removal', ['o1'], 12)]),
    )
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy())

    mocked.sendCommands.mockResolvedValue({
      deck: { ...deck, version: 2 },
    } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)
    await act(async () => screen.getByLabelText('Reject Krenko, Mob Boss').click())

    await waitFor(() => expect(badgeFor('fills-removal')?.textContent).toBe('all rejected'))
    expect(screen.queryByText('satisfied')).toBeNull()
  })
})

describe('a heading that really is satisfied', () => {
  it('keeps the badge that the other four cases were borrowing', async () => {
    // The case the badge was added for, and the only one that keeps it: no
    // filter, no failure, and no gap left to measure against this heading.
    mocked.getRecommendations.mockResolvedValue(
      recsWith([group('fills-removal', 'Fills gap · removal', [], 0)]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText('satisfied')).toBeTruthy())
    expect(badgeFor('fills-removal')?.getAttribute('data-state')).toBe('satisfied')
  })
})
