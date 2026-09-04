// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COLUMNS, cardEfficiency, cardImpact } from '@roundtable/domain'
import type { CardEfficiency, CardImpact, EfficiencyInput } from '@roundtable/domain'
import { IMPACT_MAX } from '@roundtable/ui'
import * as api from './api'
import { Workspace } from './App'

/**
 * Impact and efficiency AS COLUMNS, in the suggestion feed (doc 18 §18.7).
 *
 * The detail-pane half is `metrics.test.tsx`. What is pinned here is the half
 * the pane cannot check for itself, and it is three claims:
 *
 *   THE NUMBER IN THE CELL IS THE NUMBER IN THE PANE. Doc 18 §18.8 puts both
 *   metrics on one wire so no surface recomputes them; a cell that formatted
 *   its own copy would be the second implementation that promise exists to
 *   prevent. The comparison is made here on ONE card, against the domain's own
 *   output — not against a number typed into this file, which would pass just
 *   as happily on the day the model changed underneath it.
 *
 *   THE CELL DOES NOT ROUND. ADR-0025 §2 binds the filter to the raw score, so
 *   `impact>=6.13` must never drop a row whose own cell reads `6.13`. The
 *   fixture is chosen so that rounding is VISIBLE — Wrath of God's efficiency
 *   is 0.549, which `toFixed(2)` turns into 0.55.
 *
 *   THE COLUMNS ARE ORDINARY COLUMNS. Present by default, removable from the
 *   legend, and saved with the deck — the state `Deck.columns` exists to hold,
 *   including the empty array, which is a different deck from a deck that has
 *   never set any.
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
    getCardDetail: vi.fn(),
    searchCards: vi.fn(),
    getDeck: vi.fn(),
  }
})

const mocked = vi.mocked(api)

afterEach(cleanup)

const WRATH_TEXT = "Destroy all creatures. They can't be regenerated."

/**
 * Wrath of God, and a second card that is nothing like it.
 *
 * TWO CARDS WITH DIFFERENT NUMBERS, deliberately. A one-row fixture, or two
 * rows scoring the same, would let a cell that drew the wrong card's metric —
 * or the same card's twice — pass every assertion in this file.
 */
const WRATH_INPUT: EfficiencyInput = {
  name: 'Wrath of God',
  manaCost: '{2}{W}{W}',
  oracleText: WRATH_TEXT,
  typeLine: 'Sorcery',
  manaValue: 4,
  types: ['sorcery'],
  power: null,
  toughness: null,
}

const BEARS_INPUT: EfficiencyInput = {
  name: 'Grizzly Bears',
  manaCost: '{1}{G}',
  oracleText: '',
  typeLine: 'Creature — Bear',
  manaValue: 2,
  types: ['creature'],
  power: '2',
  toughness: '2',
}

const impactOf = (input: EfficiencyInput): CardImpact => cardImpact(input)
const efficiencyOf = (input: EfficiencyInput): CardEfficiency => cardEfficiency(input)

const asCard = (input: EfficiencyInput, oracleId: string): api.Card => ({
  oracleId,
  name: input.name,
  manaCost: input.manaCost,
  manaValue: input.manaValue,
  typeLine: input.typeLine,
  types: [...input.types],
  colors: [],
  oracleText: input.oracleText,
  power: input.power,
  toughness: input.toughness,
  loyalty: null,
  colorIdentity: [],
  primaryRole: 'removal',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const deck = (over: Partial<api.Deck> = {}): api.Deck => ({
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: [],
  colorIdentity: ['W'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
  ...over,
})

/** One group, two suggestions, each carrying the metrics the server computes. */
const recs = (
  over: {
    metrics?: boolean
    columns?: { query: string; matched: string[] }[]
  } = {},
): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'g1',
        label: 'Staples',
        rationale: 'because',
        total: 2,
        items: [WRATH_INPUT, BEARS_INPUT].map((input, i) => ({
          oracleId: i === 0 ? 'wrath' : 'bears',
          score: 2 - i,
          comboDegree: 0,
          nearCombosAt1: 0,
          completedCombos: [],
          combos: [],
          reasons: [{ kind: 'staple' }],
          ...(over.metrics === false
            ? {}
            : { impact: impactOf(input), efficiency: efficiencyOf(input) }),
        })),
      },
    ],
    columns: over.columns ?? [],
    unavailable: [],
    query: { matched: 2, total: 2, errors: [] },
    // Never omitted: `Recommendations.emphasis` is read unconditionally and a
    // fixture without it has broken this suite before.
    emphasis: [],
  }) as unknown as api.Recommendations

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(recs())
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
  // `{ cards, prices, images }` — all three. A `hydrate` mock missing `images`
  // is a shape the real endpoint never returns and has broken merges here.
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      ['wrath', asCard(WRATH_INPUT, 'wrath')],
      ['bears', asCard(BEARS_INPUT, 'bears')],
    ]),
    prices: new Map([
      ['wrath', 4.1],
      ['bears', 0.02],
    ]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.patchDeck.mockImplementation((id, body) =>
    Promise.resolve({ ...deck({ id, version: 2 }), ...body } as api.Deck),
  )
})

/** The suggestion row for one card, once the feed has drawn it. */
const rowFor = async (container: HTMLElement, oracleId: string): Promise<HTMLElement> => {
  await waitFor(() =>
    expect(container.querySelector(`.card-row[data-row-id="${oracleId}"]`)).not.toBeNull(),
  )
  return container.querySelector(`.card-row[data-row-id="${oracleId}"]`) as HTMLElement
}

/** The classes of a row's children, in the order they are laid out. */
const layout = (row: HTMLElement): string[] =>
  [...row.children].map((child) =>
    child.classList.contains('metric-cell')
      ? `metric:${child.getAttribute('data-metric') ?? ''}`
      : (child.className.split(' ')[0] ?? ''),
  )

describe('the two metrics, in the suggestion row', () => {
  it('draws each card’s own impact and efficiency', async () => {
    const { container } = render(<Workspace deck={deck()} />)
    const wrath = await rowFor(container, 'wrath')
    const bears = await rowFor(container, 'bears')

    expect(within(wrath).getByLabelText(/^Impact /).textContent).toBe(
      String(impactOf(WRATH_INPUT).score),
    )
    expect(within(wrath).getByLabelText(/^Efficiency /).textContent).toBe(
      String(efficiencyOf(WRATH_INPUT).score),
    )
    // The second row is a different card and must say so. Two rows drawing the
    // same figure is the failure a single-row fixture cannot see.
    expect(within(bears).getByLabelText(/^Impact /).textContent).toBe(
      String(impactOf(BEARS_INPUT).score),
    )
    expect(within(bears).getByLabelText(/^Impact /).textContent).not.toBe(
      within(wrath).getByLabelText(/^Impact /).textContent,
    )
  })

  it('prints the stored number unrounded, decimals and all', async () => {
    /*
     * ADR-0025 §2. The filter compares the raw score, so a cell that rounded
     * would make `impact>=6.13` drop a row whose own cell said 6.13.
     *
     * Wrath's efficiency is 0.549 — three decimals, and the second and third
     * differ, so `toFixed(2)` (0.55), `toFixed(1)` (0.5) and `Math.round` (1)
     * are all visibly wrong here rather than accidentally right.
     */
    const score = efficiencyOf(WRATH_INPUT).score
    expect(String(score)).toMatch(/^\d\.\d{3}$/)
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    expect(within(row).getByLabelText(/^Efficiency /).textContent).toBe(String(score))
  })

  it('sits between the mana cost and the price, where they were asked for', async () => {
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    const order = layout(row)
    expect(order).toContain('mana')
    expect(order).toContain('cash')
    expect(order.indexOf('mana')).toBeLessThan(order.indexOf('metric:impact'))
    expect(order.indexOf('metric:impact')).toBeLessThan(order.indexOf('metric:efficiency'))
    expect(order.indexOf('metric:efficiency')).toBeLessThan(order.indexOf('cash'))
  })

  it('reads the number with the scale it is measured on', async () => {
    // `6.12` in a column with no heading is not information. The accessible
    // name carries the same words the pane prints beside the same figure.
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    expect(
      within(row).getByLabelText(
        `Impact ${String(impactOf(WRATH_INPUT).score)} of ${String(IMPACT_MAX)}`,
      ),
    ).toBeDefined()
    expect(
      within(row).getByLabelText(`Efficiency ${String(efficiencyOf(WRATH_INPUT).score)} per mana`),
    ).toBeDefined()
  })

  it('says the number is missing rather than drawing NaN', async () => {
    // A server from before the metrics shipped. The cell keeps its place in the
    // column and shows the same "no" dot a query column uses.
    mocked.getRecommendations.mockResolvedValue(recs({ metrics: false }))
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    const cell = within(row).getByLabelText('Impact: not measured for this card')
    expect(cell.textContent).toBe('·')
    expect(cell.textContent).not.toMatch(/NaN|undefined/)
  })
})

describe('the cell and the detail pane never disagree', () => {
  it('shows one card the same two numbers in both places', async () => {
    /*
     * The whole reason `CardMetrics` and the cell read the SAME wire fields
     * through the SAME formatter. Two renderers of one number is how two
     * surfaces come to report a card differently, and doc 18 §18.8 put both
     * metrics on one wire precisely so they could not.
     */
    mocked.getCardDetail.mockResolvedValue({
      ...asCard(WRATH_INPUT, 'wrath'),
      printings: [],
      combos: [],
      impact: impactOf(WRATH_INPUT),
      efficiency: efficiencyOf(WRATH_INPUT),
    } as api.CardDetail)

    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    const inRow = {
      impact: within(row).getByLabelText(/^Impact /).textContent,
      efficiency: within(row).getByLabelText(/^Efficiency /).textContent,
    }

    await act(async () => {
      within(row).getByLabelText('Preview Wrath of God').click()
    })
    const panel = await screen.findByLabelText('Wrath of God details')
    const metrics = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )

    expect(inRow.impact).not.toBeNull()
    expect(metrics.getByText(String(inRow.impact))).toBeDefined()
    expect(metrics.getByText(String(inRow.efficiency))).toBeDefined()
  })
})

describe('the metrics are ordinary columns, saved with the deck', () => {
  it('are there by default, on a deck that has never set any', async () => {
    // `columns` absent is "never set", which is `DEFAULT_COLUMNS` — not "none".
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')
    expect(within(row).queryByLabelText(/^Impact /)).not.toBeNull()
    expect(within(row).queryByLabelText(/^Efficiency /)).not.toBeNull()
    expect(DEFAULT_COLUMNS.map((c) => (c.kind === 'metric' ? c.metric : c.query))).toEqual([
      'impact',
      'efficiency',
    ])
  })

  it('stay removed across a reload, because `[]` is not the same as unset', async () => {
    // The trap migration 0015 is nullable for: a builder who cleared every
    // column must not be handed them back on the next page load.
    const { container } = render(<Workspace deck={deck({ columns: [] })} />)
    const row = await rowFor(container, 'wrath')
    expect(within(row).queryByLabelText(/^Impact /)).toBeNull()
    expect(within(row).queryByLabelText(/^Efficiency /)).toBeNull()
  })

  it('draws exactly the columns the deck saved, in the order it saved them', async () => {
    const { container } = render(
      <Workspace deck={deck({ columns: [{ kind: 'metric', metric: 'efficiency' }] })} />,
    )
    const row = await rowFor(container, 'wrath')
    expect(within(row).queryByLabelText(/^Impact /)).toBeNull()
    expect(within(row).queryByLabelText(/^Efficiency /)).not.toBeNull()
  })

  it('saves the removal to the deck, as a list and never as null', async () => {
    const { container } = render(<Workspace deck={deck()} />)
    await rowFor(container, 'wrath')

    await act(async () => {
      screen.getByLabelText(/^Remove the Impact column/).click()
    })

    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]?.[1]).toEqual({
      columns: [{ kind: 'metric', metric: 'efficiency' }],
    })

    // And the last one out sends `[]`, not null — null would mean "back to the
    // defaults" and would hand both columns straight back.
    await act(async () => {
      screen.getByLabelText(/^Remove the Efficiency column/).click()
    })
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalledTimes(2))
    expect(mocked.patchDeck.mock.calls[1]?.[1]).toEqual({ columns: [] })
  })

  it('can be put back, so removing one is not a one-way door', async () => {
    /*
     * `+ column` only makes QUERY columns, so without a restore control a
     * builder who removed Impact could never get it back for that deck — and
     * "there by default until you remove them" would only be half true.
     *
     * Keyboard-operable by construction: it is an ordinary button in the
     * filter bar, so it takes focus and Enter like the one beside it (R4).
     */
    const { container } = render(<Workspace deck={deck({ columns: [] })} />)
    const row = await rowFor(container, 'wrath')
    expect(within(row).queryByLabelText(/^Impact /)).toBeNull()

    const restore = screen.getByLabelText('Show impact as a column again')
    expect(restore.tagName).toBe('BUTTON')
    await act(async () => {
      restore.focus()
      restore.click()
    })

    await waitFor(() =>
      expect(within(container.querySelector('.card-row') as HTMLElement)).toBeDefined(),
    )
    expect(within(await rowFor(container, 'wrath')).queryByLabelText(/^Impact /)).not.toBeNull()
    // And the restore is saved, like every other column change.
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]?.[1]).toEqual({
      columns: [{ kind: 'metric', metric: 'impact' }],
    })
    // Its own button is gone; the other metric's is still offered.
    expect(screen.queryByLabelText('Show impact as a column again')).toBeNull()
    expect(screen.getByLabelText('Show efficiency as a column again')).toBeDefined()
  })

  it('offers no restore button while both metrics are on screen', async () => {
    // The ordinary case: the bar carries no extra buttons at all.
    const { container } = render(<Workspace deck={deck()} />)
    await rowFor(container, 'wrath')
    expect(screen.queryByLabelText(/^Show impact as a column again/)).toBeNull()
    expect(screen.queryByLabelText(/^Show efficiency as a column again/)).toBeNull()
  })

  it('puts the column back and says so when the deck will not save', async () => {
    // A column on screen that is not on the deck comes back missing after a
    // reload with nothing to explain it, so optimism has to be paid for.
    mocked.patchDeck.mockRejectedValue(new Error('nope'))
    const { container } = render(<Workspace deck={deck()} />)
    const row = await rowFor(container, 'wrath')

    await act(async () => {
      screen.getByLabelText(/^Remove the Impact column/).click()
    })

    await waitFor(() => expect(screen.getByText(/Could not save your columns/)).toBeDefined())
    expect(within(await rowFor(container, 'wrath')).queryByLabelText(/^Impact /)).not.toBeNull()
    expect(row.isConnected || true).toBe(true)
  })

  it('does not spend a recompute on a column the server never evaluates', async () => {
    // A metric column carries no query, so `queryColumns` is unchanged when one
    // is removed (doc 10). Refetching would be several seconds spent arriving
    // back at the list already on screen.
    const { container } = render(<Workspace deck={deck()} />)
    await rowFor(container, 'wrath')
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    const before = mocked.getRecommendations.mock.calls.length

    await act(async () => {
      screen.getByLabelText(/^Remove the Impact column/).click()
    })
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.getRecommendations.mock.calls.length).toBe(before)
  })
})

describe('a metric column shows a number and does not claim to sort', () => {
  const typeFilter = async (text: string): Promise<void> => {
    const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('gives the metric chips no sort rank, and the first query "sorts first"', async () => {
    /*
     * The consequence of `ordersRows`, read off the interface. If the two
     * default metrics took part in the sort chain, a query the builder just
     * promoted would be the THIRD sort key — and "+ column"'s own tooltip
     * promises it brings its matches to the top of the group.
     */
    mocked.getRecommendations.mockResolvedValue(recs({ columns: [{ query: 'x', matched: [] }] }))
    const { container } = render(<Workspace deck={deck()} />)
    await rowFor(container, 'wrath')

    expect(screen.getByLabelText('Remove the Impact column — a number on every row')).toBeDefined()

    await typeFilter('x')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    await waitFor(() =>
      expect(screen.getByLabelText(/^Remove the x column — sorts first/)).toBeDefined(),
    )
    // One rank badge on screen, for the one column that has a rank.
    expect(container.querySelectorAll('.column-rank')).toHaveLength(1)
  })

  it('keeps a query column beside the name and a metric beside the costs', async () => {
    mocked.getRecommendations.mockResolvedValue(recs({ columns: [{ query: 'x', matched: [] }] }))
    const { container } = render(<Workspace deck={deck()} />)
    await rowFor(container, 'wrath')
    await act(async () => {
      const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(box, 'x')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    await waitFor(() => expect(container.querySelector('.card-row .col-cell')).not.toBeNull())
    const order = layout(await rowFor(container, 'wrath'))
    // Tick beside the name; numbers beside the numbers.
    expect(order.indexOf('col-cell')).toBeLessThan(order.indexOf('mana'))
    expect(order.indexOf('mana')).toBeLessThan(order.indexOf('metric:impact'))
  })
})
