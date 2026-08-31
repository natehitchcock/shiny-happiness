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
  // Re-read after a 409, to find the version we should have used.
  getDeck: vi.fn(),
  // The real class, not a stub: the retry path distinguishes a 409 from any
  // other failure with `instanceof`, so a fake would defeat the test.
  ApiError: class ApiError extends Error {
    status: number
    // The 409 body, which is where `since` arrives (API-06). A stub without it
    // could not tell the rebase path from the blind-resend fallback.
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
  description: '',
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
  // `clearAllMocks` clears CALLS but leaves implementations in place, so a
  // never-resolving stub from one test stayed in force for the next.
  vi.resetAllMocks()
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
          // Added to `Card` after this fixture was written, and invisible
          // until `apps/web` joined the typecheck.
          power: null,
          toughness: null,
          loyalty: null,
          synergyProduces: [],
          synergyWants: [],
        },
      ],
    ]),
    prices: new Map([['o1', 1.5]]),
    // Empty, not absent: the real endpoint returns an entry per requested id
    // and the workspace holds this in state, so a mock without the map is a
    // shape the client never actually meets.
    images: new Map(),
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
      // The name now carries the column's SORT PRIORITY as well, because a
      // column decides the order of the rows and a stack of chips does not say
      // which one wins. Matched on the prefix so the wording of the second half
      // can change without breaking the thing under test, which is removal.
      screen.getByLabelText(/^Remove the mv<=3 column/).click()
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
    // does not hold the screen up. While it is in flight the row shows a
    // spinner in place of the diamond, so a saved lock is distinguishable from
    // one still being retried; the confirmed state arrives with the response.
    let release: ((v: Awaited<ReturnType<typeof api.sendCommands>>) => void) | null = null
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
    expect(screen.getAllByLabelText(/^Saving lock for/).length).toBeGreaterThan(0)

    await act(async () => {
      release?.({
        deck: { ...lockedDeck, entries: [{ oracleId: 'o1', zone: 'accepted', locked: true }] },
        applied: [],
        rejected: [],
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getAllByLabelText(/^Unlock /).length).toBeGreaterThan(0))
  })

  it('reconciles against the server when the lock will not save', async () => {
    // The old version restored the deck it had captured before the click, which
    // is only right if nothing else changed meanwhile — and an accept batch may
    // well have landed during the retries. Re-reading gives the real state.
    mocked.sendCommands.mockRejectedValue(new api.ApiError('nope', 400))
    mocked.getDeck.mockResolvedValue(lockedDeck)

    render(<Workspace deck={lockedDeck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })
    await waitFor(() => expect(screen.getByText(/lock did not save/)).toBeDefined())
    expect(mocked.getDeck).toHaveBeenCalled()
    expect(screen.queryAllByLabelText(/^Unlock /)).toHaveLength(0)
  })

  it('keeps a lock set while a recompute was in flight', async () => {
    // The regression: a requery reads the deck when it STARTS and writes it
    // back when it lands, so a lock set in between was silently overwritten
    // and the icon sprang back open.
    // The lock is CONFIRMED before the recompute is held open, so what is under
    // test is the recompute overwriting a settled lock — not the pending
    // overlay, which is covered separately.
    mocked.sendCommands.mockResolvedValue({
      deck: {
        ...lockedDeck,
        version: 2,
        entries: [{ oracleId: 'o1', zone: 'accepted', locked: true }],
      },
      results: [],
    } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)
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

    // Locked while the recompute is in flight, and confirmed — the spinner
    // clears when the server answers, which it does immediately here.
    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getAllByLabelText(/^Unlock /).length).toBeGreaterThan(0))

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

describe('adding cards while a settle is running', () => {
  // The deck holds a DIFFERENT card from the suggestion, so the suggestion row
  // still offers Add. A card already accepted is not offered again (P6).
  const withEntries: api.Deck = {
    ...deck,
    entries: [{ oracleId: 'other', zone: 'accepted', locked: false }],
  }

  it('sends the version the SERVER confirmed, not the one on screen', async () => {
    // The reported bug: a batch applies and the server moves to v2, but the
    // settle holds the result back so the UI still says v1. Adding another card
    // in that window — which is exactly what the settle exists to allow — sent
    // v1 and got a 409.
    const versions: number[] = []
    let n = 1
    mocked.sendCommands.mockImplementation((_id: string, _cmds: unknown, baseVersion: number) => {
      versions.push(baseVersion)
      n += 1
      return Promise.resolve({
        deck: { ...withEntries, version: n },
        applied: [],
        rejected: [],
      }) as ReturnType<typeof api.sendCommands>
    })

    // TWO suggestions: after the first Add its row becomes a spinner, so the
    // second click has to land on a different card.
    const two = recs([])
    ;(two.groups[0] as { items: unknown[] }).items = [
      { oracleId: 'o1', comboDegree: 2, nearCombosAt1: 0, score: 1, reasons: [], combos: [] },
      { oracleId: 'o2', comboDegree: 1, nearCombosAt1: 0, score: 1, reasons: [], combos: [] },
    ]
    mocked.getRecommendations.mockResolvedValue(two)

    render(<Workspace deck={{ ...withEntries, version: 1 }} />)
    // Wait for the first load to be APPLIED, not merely requested — the
    // pipeline holds a result until the bar reaches its halfway mark.
    await waitFor(() => expect(screen.getAllByText('Add').length).toBeGreaterThan(1), {
      timeout: 5_000,
    })

    // Two accepts, separated so the second lands after the first has been sent
    // but before its result is applied.
    await act(async () => {
      screen.getAllByText('Add')[0]?.click()
    })
    await new Promise((r) => setTimeout(r, 1_500))
    await act(async () => {
      screen.getAllByText('Add')[0]?.click()
    })
    await new Promise((r) => setTimeout(r, 1_500))

    await waitFor(() => expect(versions.length).toBeGreaterThanOrEqual(2))
    // The second send must not repeat the first's base version.
    expect(versions[1]).toBeGreaterThan(versions[0]!)
  }, 20_000)

  it('recovers from a 409 instead of dropping the clicks', async () => {
    // If a conflict does happen, the commands are still valid — only our view
    // of the version was stale. Re-read and resend rather than making the user
    // click it all again.
    let attempts = 0
    mocked.sendCommands.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(
          new api.ApiError('Deck was modified by another request', 409),
        ) as ReturnType<typeof api.sendCommands>
      }
      return Promise.resolve({
        deck: { ...withEntries, version: 9 },
        applied: [],
        rejected: [],
      }) as ReturnType<typeof api.sendCommands>
    })
    mocked.getDeck.mockResolvedValue({ ...withEntries, version: 8 })

    render(<Workspace deck={{ ...withEntries, version: 1 }} />)
    await waitFor(() => expect(screen.getAllByText('Add').length).toBeGreaterThan(0), {
      timeout: 5_000,
    })
    await act(async () => {
      screen.getAllByText('Add')[0]?.click()
    })
    await new Promise((r) => setTimeout(r, 2_500))

    await waitFor(() => expect(attempts).toBe(2))
    // It re-read the deck to find the version it should have used.
    expect(mocked.getDeck).toHaveBeenCalled()
  }, 20_000)

  /*
   * API-06. The 409 above carries no `since` — that is a server from before
   * this shipped, and the fallback is the old blind re-send. This is the other
   * half: when the server CAN say what changed, the client stops re-sending
   * work another client already did.
   */
  it('does not re-send a rejection another client already made (API-06)', async () => {
    let attempts = 0
    mocked.sendCommands.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(
          new api.ApiError('Deck was modified by another request', 409, {
            deck: { ...withEntries, version: 8 },
            // The other client rejected the same card while we were behind.
            since: [{ type: 'exclude', oracleId: 'o1' }],
            sinceBatches: [
              {
                version: 8,
                appliedAt: '2026-08-30T12:00:00.000Z',
                commands: [{ type: 'exclude', oracleId: 'o1' }],
              },
            ],
            sinceComplete: true,
          }),
        ) as ReturnType<typeof api.sendCommands>
      }
      return Promise.resolve({
        deck: { ...withEntries, version: 9 },
        applied: [],
        rejected: [],
      }) as ReturnType<typeof api.sendCommands>
    })
    mocked.getDeck.mockResolvedValue({ ...withEntries, version: 8 })

    render(<Workspace deck={{ ...withEntries, version: 1 }} />)
    await waitFor(() => expect(screen.getByLabelText(/^Reject /)).toBeDefined(), {
      timeout: 5_000,
    })
    await act(async () => {
      screen.getByLabelText(/^Reject /).click()
    })
    await new Promise((r) => setTimeout(r, 2_500))

    // ONE send. The card is already rejected, so re-sending could only earn an
    // `already-excluded` refusal that reads as "your click failed".
    expect(attempts).toBe(1)
    expect(mocked.getDeck).toHaveBeenCalled()
  }, 20_000)

  it('still re-sends when the server cannot account for the whole gap', async () => {
    // `sinceComplete: false` — the log does not reach back to our version, so
    // `since` is a partial account and dropping a command on the strength of it
    // would drop work the user did.
    let attempts = 0
    mocked.sendCommands.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(
          new api.ApiError('Deck was modified by another request', 409, {
            deck: { ...withEntries, version: 8 },
            since: [{ type: 'exclude', oracleId: 'o1' }],
            sinceComplete: false,
          }),
        ) as ReturnType<typeof api.sendCommands>
      }
      return Promise.resolve({
        deck: { ...withEntries, version: 9 },
        applied: [],
        rejected: [],
      }) as ReturnType<typeof api.sendCommands>
    })
    mocked.getDeck.mockResolvedValue({ ...withEntries, version: 8 })

    render(<Workspace deck={{ ...withEntries, version: 1 }} />)
    await waitFor(() => expect(screen.getByLabelText(/^Reject /)).toBeDefined(), {
      timeout: 5_000,
    })
    await act(async () => {
      screen.getByLabelText(/^Reject /).click()
    })
    await new Promise((r) => setTimeout(r, 2_500))

    await waitFor(() => expect(attempts).toBe(2))
  }, 20_000)
})

describe('deck options survive the query that follows them', () => {
  it('does not undo a setting when the refresh lands', async () => {
    // The regression: ticking "Exclude Universes Beyond" patched the deck, then
    // the refresh that follows returned the deck as the client last knew it —
    // from BEFORE the patch — and applying that wrote the old flag back.
    const patched: api.Deck = { ...deck, excludeUniversesBeyond: true, version: 2 }
    mocked.patchDeck.mockResolvedValue(patched)

    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    const box = screen.getByLabelText(/Exclude Universes Beyond/) as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => {
      box.click()
    })
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())

    // Let the refresh it triggers run all the way through and be applied.
    await new Promise((r) => setTimeout(r, 2_000))
    expect((screen.getByLabelText(/Exclude Universes Beyond/) as HTMLInputElement).checked).toBe(
      true,
    )
  }, 20_000)
})

describe('locking a card clears its cut hint at once', () => {
  it('drops the hint on the click, not on the next recompute', async () => {
    // The server omits locked cards from `analysis.cuts`, but that analysis is
    // only as fresh as the last recompute — and locking deliberately no longer
    // triggers one. So the hint used to sit there after the click meant to
    // dismiss it, which is exactly what the lock is for.
    const withCard: api.Deck = {
      ...deck,
      entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
    }
    mocked.getAnalysis.mockResolvedValue({
      ...(await mocked.getAnalysis.getMockImplementation()?.('')),
      counts: { total: 1, byRole: {} },
      targets: [],
      // Two faults, because the deck pane's threshold defaults to two — this
      // test is about the lock dismissing a hint, not about how many faults
      // earn one.
      cuts: [
        { oracleId: 'o1', score: 0.5, reasons: [{ kind: 'no-synergy' }, { kind: 'over-curve' }] },
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
    mocked.sendCommands.mockReturnValue(
      new Promise(() => undefined) as ReturnType<typeof api.sendCommands>,
    )

    render(<Workspace deck={withCard} />)
    await waitFor(() => expect(screen.getByText('no synergy')).toBeDefined(), { timeout: 5_000 })

    await act(async () => {
      screen.getAllByLabelText(/^Lock /)[0]?.click()
    })
    // Immediately — the send is still in flight and will never resolve.
    expect(screen.queryByText('no synergy')).toBeNull()
  }, 20_000)
})

describe('rejecting a card', () => {
  it('says "Rejecting", not "Adding"', async () => {
    // The default label counted commands without reading them, so clicking
    // Reject announced "Adding 1 card" — the opposite of what was clicked.
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getAllByText('Reject').length).toBeGreaterThan(0), {
      timeout: 5_000,
    })

    await act(async () => {
      screen.getAllByText('Reject')[0]?.click()
    })
    await waitFor(() => expect(screen.getByText(/Rejecting 1 card/)).toBeDefined())
  })

  it('takes the card out of the suggestions on the click', async () => {
    // P6: an excluded card is never suggested again. The groups come from the
    // server and are only as fresh as the last recompute, so the card used to
    // sit there for seconds while the app went on offering what was refused.
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeDefined(), {
      timeout: 5_000,
    })

    const { container } = { container: document.body }
    await act(async () => {
      screen.getAllByText('Reject')[0]?.click()
    })
    // Scoped to the SUGGESTIONS. The card is still on screen — it has moved to
    // the Rejected list, where it keeps a preview button — so an unscoped
    // query finds it there and proves nothing.
    expect(container.querySelectorAll('.group .card-row')).toHaveLength(0)
    expect(
      [...container.querySelectorAll('.group')].some((g) =>
        (g.textContent ?? '').includes('Krenko, Mob Boss'),
      ),
    ).toBe(false)
  })

  it('still calls it a rejection, not a removal, in the label', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getAllByText('Reject').length).toBeGreaterThan(0), {
      timeout: 5_000,
    })
    expect(screen.getAllByLabelText(/^Reject /).length).toBeGreaterThan(0)
    expect(screen.queryAllByLabelText(/^Never suggest/)).toHaveLength(0)
  })
})

describe('the impact and efficiency filter fields (doc 18 §18.8)', () => {
  /*
   * The two metrics were display-only and unaskable. These cover the client
   * half of making them queries: that a query naming a metric really does reach
   * the server as a column, and that a builder can find out the fields exist
   * without reading `docs/13-candidate-query.md`.
   */
  it('sends a query that names a metric to the server as an ordinary column', async () => {
    // The seam that had to be re-argued: `queryColumnsOf` strips METRIC columns
    // and must not strip a QUERY that happens to name a metric.
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    await typeFilter('impact>=6 -t:land')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    await waitFor(() => {
      const bodies = mocked.getRecommendations.mock.calls.map((c) => c[1])
      expect(bodies.some((b) => b.columns?.includes('impact>=6 -t:land') === true)).toBe(true)
    })
  })

  it('documents both fields with a copyable example, reachable by keyboard', async () => {
    // R4: the reference opens from the keyboard, not from hover alone. `Hint`'s
    // trigger is a real button that opens on focus, which is what this asserts —
    // a `title` attribute would satisfy neither this nor a touch device.
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())

    const trigger = screen.getByLabelText('What can I type in the filter?')
    expect(trigger.tagName).toBe('BUTTON')

    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    const help = screen.getByRole('tooltip')

    /*
     * The EXACT text of each `<code>`, not a substring of the whole panel.
     *
     * Found by mutation: replacing the `eff>=1.5` row in the field list with
     * `price>=1.5` left `toContain('eff>=1.5')` green, because the worked
     * example lower down still says `eff>=1.5 mv<=3`. A substring match on a
     * panel that mentions a field twice cannot tell the list from the prose.
     */
    const snippets = [...help.querySelectorAll('code')].map((c) => c.textContent)
    expect(snippets).toContain('impact>=6')
    expect(snippets).toContain('eff>=1.5')

    // And a worked example that composes one of them with another field, which
    // is the thing a builder actually needs to see to believe it composes.
    expect(snippets).toContain('impact>=6 -t:land')
  })
})
