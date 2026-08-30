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

/**
 * jsdom has no ResizeObserver.
 *
 * Stubbed here rather than guarded in the component: every browser this app
 * targets has it, and a `typeof ResizeObserver` branch in production code would
 * exist only to satisfy the test runner. The stub never fires, which is fine —
 * these tests assert what the legend renders, not that it re-measures.
 */
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
  // Maps, not arrays: `hydrate` indexes by oracle id before returning. And a
  // COMPLETE card — a fixture missing `types` crashed the composition overlay,
  // which is a fixture bug, but only because the real endpoint never omits it.
  mocked.hydrate.mockResolvedValue({
    cards: new Map<string, api.Card>([
      [
        'o1',
        {
          oracleId: 'o1',
          name: 'Krenko, Mob Boss',
          manaCost: '{2}{R}{R}',
          manaValue: 4,
          typeLine: 'Legendary Creature — Goblin Warrior',
          types: ['creature'],
          oracleText: '',
          colorIdentity: ['R'],
          primaryRole: 'wincon',
          edhrecRank: null,
          universesBeyond: false,
        },
      ],
    ]),
    prices: new Map([['o1', 1.5]]),
  } satisfies api.Hydrated)
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

describe('the column legend', () => {
  const addColumn = async (query: string): Promise<void> => {
    await typeFilter(query)
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })
  }

  it('names the query once, under the filter bar', async () => {
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: ['o1'] }]))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await addColumn('mv<=3')

    await waitFor(() => expect(container.querySelector('.columns code')).not.toBeNull())
    expect(container.querySelector('.columns code')?.textContent).toBe('mv<=3')
  })

  it('puts no column marker in the group header', async () => {
    // A group head ends after its rationale; a card row ends after its costs
    // and two buttons. The marker therefore sat 251 px right of the cells it
    // claimed to head — measured in a browser, not guessed. The legend aligns
    // by measuring the cells instead, so the header has nothing left to add.
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: ['o1'] }]))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await addColumn('mv<=3')

    await waitFor(() => expect(container.querySelector('.column-chip')).not.toBeNull())
    expect(container.querySelector('.col-head')).toBeNull()
  })

  it('falls back to a plain row when there are no columns on screen to measure', async () => {
    // jsdom reports every box as 0×0, so nothing is measurable here — which is
    // exactly the pre-first-result case the fallback exists for. Pinning chips
    // to a guess would be worse than not pinning them.
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: [] }]))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await addColumn('mv<=3')

    await waitFor(() => expect(container.querySelector('.columns')).not.toBeNull())
    const legend = container.querySelector('.columns')!
    expect(legend.getAttribute('data-aligned')).toBe('false')
    expect(legend.querySelector('.column-chip')?.getAttribute('style')).toBeNull()
  })

  it('still removes a column from its chip', async () => {
    mocked.getRecommendations.mockResolvedValue(recs([{ query: 'mv<=3', matched: ['o1'] }]))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await addColumn('mv<=3')

    await waitFor(() => expect(container.querySelector('.column-chip')).not.toBeNull())
    await act(async () => {
      screen.getByLabelText('Remove the mv<=3 column').click()
    })
    expect(container.querySelector('.column-chip')).toBeNull()
  })
})

describe('locking a card', () => {
  const lockedDeck: api.Deck = {
    ...deck,
    entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
  }

  it('does not run a recompute', async () => {
    // Locking changes nothing the suggestions are computed from: no card is
    // added or removed, so the pool, the counts, the curve and every score are
    // identical either side of it. The staged requery spent a round trip and up
    // to four seconds of settle to arrive at the list already on screen.
    mocked.sendCommands.mockResolvedValue({
      deck: { ...lockedDeck, version: 2, entries: [{ ...lockedDeck.entries[0]!, locked: true }] },
      results: [],
    } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)

    render(<Workspace deck={lockedDeck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    const before = mocked.getRecommendations.mock.calls.length

    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })

    expect(mocked.sendCommands).toHaveBeenCalledTimes(1)
    expect(mocked.getRecommendations.mock.calls.length).toBe(before)
  })

  it('shows the lock straight away, without waiting for the server', async () => {
    // The command still goes out — the lock has to survive a reload — but it
    // does not hold the screen up.
    let release: ((v: unknown) => void) | null = null
    mocked.sendCommands.mockReturnValue(
      new Promise((r) => {
        release = r
      }) as ReturnType<typeof api.sendCommands>,
    )

    render(<Workspace deck={lockedDeck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })
    // Already flipped, with the request still in flight.
    expect(screen.getAllByLabelText(/^Unlock /).length).toBeGreaterThan(0)
    release?.({ deck: lockedDeck, results: [] })
  })

  it('puts the lock back if the server refuses it', async () => {
    // A silently-wrong lock is worse than one that visibly did not take.
    mocked.sendCommands.mockRejectedValue(new Error('conflict'))

    render(<Workspace deck={lockedDeck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })
    await waitFor(() => expect(screen.getByText(/lock did not save/)).toBeDefined())
    expect(screen.queryAllByLabelText(/^Unlock /)).toHaveLength(0)
  })

  it('keeps a lock set while a recompute was in flight', async () => {
    // The regression: a requery reads the deck when it STARTS and writes it
    // back when it lands, so a lock set in between was silently overwritten
    // and the icon sprang back open.
    mocked.sendCommands.mockReturnValue(
      new Promise(() => undefined) as ReturnType<typeof api.sendCommands>,
    )
    render(<Workspace deck={lockedDeck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    // Hold a recompute open, started by running a filter.
    let release: ((v: api.Recommendations) => void) | null = null
    mocked.getRecommendations.mockReturnValue(
      new Promise((r) => {
        release = r as (v: api.Recommendations) => void
      }) as ReturnType<typeof api.getRecommendations>,
    )
    await typeFilter('mv<=3')
    await act(async () => {
      screen.getByLabelText(/^Run this filter/).click()
    })

    // Locked while it is in flight.
    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })
    expect(screen.getAllByLabelText(/^Unlock /).length).toBeGreaterThan(0)

    // The answer lands, carrying a deck captured before the lock. Its label
    // is distinct so the wait below cannot pass until the pipeline has
    // actually APPLIED it — which is after the settle, seconds later, and is
    // the moment the deck gets overwritten.
    const landed = recs([])
    ;(landed.groups[0] as { label: string }).label = 'RECOMPUTE LANDED'
    await act(async () => {
      release?.(landed)
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByText('RECOMPUTE LANDED')).toBeDefined(), {
      timeout: 8_000,
    })

    expect(screen.getAllByLabelText(/^Unlock /).length).toBeGreaterThan(0)
  }, 15_000)
})
