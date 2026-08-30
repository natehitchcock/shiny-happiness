// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The column feature shipped broken: `columnsRef` was declared and never
 * assigned, so the request never carried the columns and every cell rendered
 * the "no" dot. Nothing caught it because nothing tested the wiring — the
 * server half worked and the client half never called it.
 *
 * These tests are that wiring: what does clicking "+ column" actually send, and
 * does the answer come back through to the row.
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
}))

const mocked = vi.mocked(api)

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

const recs = (columns: { query: string; matched: string[] }[]): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'g1',
        label: 'Completes 2 combos',
        rationale: 'because',
        total: 1,
        items: [
          {
            oracleId: 'o1',
            comboDegree: 2,
            nearCombosAt1: 0,
            score: 1,
            reasons: ['completes 2 combos'],
          },
        ],
      } as unknown as api.Group,
    ],
    columns,
    unavailable: [],
    query: { matched: 1, errors: [] },
  }) as unknown as api.Recommendations

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getRecommendations.mockResolvedValue(recs([]))
  // A complete Analysis, not a partial cast: the right pane reads a dozen
  // nested fields and a half-built fixture just crashes somewhere else.
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
    prices: {
      deckTotalUsd: 0,
      pricedCards: 0,
      unpricedCards: 0,
      budget: null,
    },
    unavailable: [],
  } satisfies api.Analysis)
  // Maps, not arrays: `hydrate` indexes by oracle id before returning.
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      ['o1', { oracleId: 'o1', name: 'Krenko, Mob Boss', manaCost: '{2}{R}{R}', manaValue: 4 }],
    ]),
    prices: new Map([['o1', 1.5]]),
  } as unknown as api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const typeFilter = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('promoting a query to a column', () => {
  it('sends the column to the server', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await typeFilter('mv<=3')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    // The regression. Before the fix this call carried no `columns` key at all,
    // because the ref the request read from was never assigned.
    await waitFor(() => {
      const bodies = mocked.getRecommendations.mock.calls.map((c) => c[1])
      expect(bodies.some((b) => b.columns?.includes('mv<=3') === true)).toBe(true)
    })
  })

  it('refetches when a column is added, rather than waiting for something else', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    const before = mocked.getRecommendations.mock.calls.length

    await typeFilter('mv<=3')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    // Adding a column changes what the server must compute, so it is a
    // dependency of the refresh in its own right.
    await waitFor(() => expect(mocked.getRecommendations.mock.calls.length).toBeGreaterThan(before))
  })

  it('ticks a row the server said matched, and dots one it did not', async () => {
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: ['o1'] }]))
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await typeFilter('mv<=3')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    await waitFor(() => expect(screen.getByLabelText('mv<=3: yes')).toBeDefined())

    // And the other way: the same row with an empty match list is a dot.
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: [] }]))
    cleanup()
    render(<Workspace deck={deck} />)
    await typeFilter('mv<=3')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })
    await waitFor(() => expect(screen.getByLabelText('mv<=3: no')).toBeDefined())
  })
})
