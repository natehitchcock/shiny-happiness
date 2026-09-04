// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import {
  DEFAULT_SORT,
  SORT_KEYS,
  type Column,
  type Sort,
  type SortFacts,
  type SortableRow,
  Workspace,
  compareBySort,
  initialDirectionFor,
  sortByColumns,
  sortValue,
} from './App'

/**
 * The sort control (ADR-0028).
 *
 * "A sort filter that doesn't change the lists, just makes them sort asc or
 * desc." The defining constraint is in the user's own words, so it is the one
 * asserted hardest here: every key and every direction must return the SAME SET
 * of rows it was given, in every group. A sort that quietly dropped the tail —
 * or that a filter crept into later — would still look plausible on screen, so
 * membership is asserted per key rather than once.
 */

/* -------------------------------------------------------------- fixtures */

/**
 * Five rows, deliberately in NO key's order.
 *
 * A sort test whose fixture already arrives sorted cannot fail, and a fixture
 * whose keys agree with each other cannot tell one key from another. So:
 *
 *   - the array order (a, b, c, d, e) is not any key's order in either
 *     direction, and is not descending `score` either — which is what the real
 *     server sends and what the tie-break falls back to;
 *   - `b` and `e` TIE on efficiency, at the top, so stability is observable and
 *     an implementation that merely reversed the array is caught;
 *   - `d` has no metrics at all and `c` has no price, which are the two shapes
 *     of "we do not know" this app actually meets;
 *   - mana value and name disagree, so a test for one cannot pass on the other.
 */
const ROWS: readonly SortableRow[] = [
  { oracleId: 'a', score: 50, efficiency: { score: 0.8 }, impact: { score: 3 } },
  { oracleId: 'b', score: 90, efficiency: { score: 2.4 }, impact: { score: 9 } },
  { oracleId: 'c', score: 70, efficiency: { score: 1.1 }, impact: { score: 12 } },
  // No `impact`, no `efficiency`: a build that did not send them, or a row from
  // a server older than the metrics.
  { oracleId: 'd', score: 30 },
  { oracleId: 'e', score: 10, efficiency: { score: 2.4 }, impact: { score: 1 } },
]

const FACTS: SortFacts = {
  cards: new Map([
    ['a', { name: 'Delta', manaValue: 4 }],
    ['b', { name: 'Alpha', manaValue: 1 }],
    ['c', { name: 'Echo', manaValue: 6 }],
    ['d', { name: 'Bravo', manaValue: 5 }],
    ['e', { name: 'Charlie', manaValue: 3 }],
  ]),
  prices: new Map([
    ['a', 2],
    ['b', 10],
    // Present and null: an UNPRICED card, unknown in a different way from a
    // card with no entry at all, and it must land in the same place.
    ['c', null],
    ['d', 0.5],
    ['e', 5],
  ]),
}

const NO_MATCHES = new Map<string, Set<string>>()

const idsOf = (rows: readonly SortableRow[]): string[] => rows.map((r) => r.oracleId)

const sorted = (sort: Sort, columns: readonly Column[] = []): string[] =>
  idsOf([...sortByColumns(ROWS, columns, NO_MATCHES, sort, FACTS)])

/* ------------------------------------------------------------ the ordering */

describe('sorting the rows on a chosen key', () => {
  it('puts the most efficient first, descending', () => {
    // b and e both score 2.4; b came first, so b stays first. d knows nothing.
    expect(sorted({ key: 'efficiency', direction: 'desc' })).toEqual(['b', 'e', 'c', 'a', 'd'])
  })

  it('puts the least efficient first, ascending — and is not the reverse of descending', () => {
    /*
     * The assertion that catches a one-line `.reverse()`.
     *
     * Reversing the descending answer gives d, a, c, e, b: the unknown would
     * lead the list and the two tied rows would swap. Neither is what this
     * does, and both differences are deliberate.
     */
    expect(sorted({ key: 'efficiency', direction: 'asc' })).toEqual(['a', 'c', 'b', 'e', 'd'])
  })

  it('orders by impact the same way', () => {
    expect(sorted({ key: 'impact', direction: 'desc' })).toEqual(['c', 'b', 'a', 'e', 'd'])
    expect(sorted({ key: 'impact', direction: 'asc' })).toEqual(['e', 'a', 'b', 'c', 'd'])
  })

  it('orders by the server score, both ways', () => {
    expect(sorted({ key: 'score', direction: 'desc' })).toEqual(['b', 'c', 'a', 'd', 'e'])
    expect(sorted({ key: 'score', direction: 'asc' })).toEqual(['e', 'd', 'a', 'c', 'b'])
  })

  it('orders by mana value, read off the hydrated card', () => {
    expect(sorted({ key: 'manaValue', direction: 'asc' })).toEqual(['b', 'e', 'a', 'd', 'c'])
    expect(sorted({ key: 'manaValue', direction: 'desc' })).toEqual(['c', 'd', 'a', 'e', 'b'])
  })

  it('orders by price, and an unpriced card is not free', () => {
    // `c` is `null` in the price map. Ascending — "cheapest first" — it must not
    // lead: an unpriced card is unknown, not $0.
    expect(sorted({ key: 'price', direction: 'asc' })).toEqual(['d', 'a', 'e', 'b', 'c'])
    expect(sorted({ key: 'price', direction: 'desc' })).toEqual(['b', 'e', 'a', 'd', 'c'])
  })

  it('orders by name alphabetically, not by any number', () => {
    // Alpha, Bravo, Charlie, Delta, Echo — a DIFFERENT order from mana value,
    // so this cannot be passing on the wrong key.
    expect(sorted({ key: 'name', direction: 'asc' })).toEqual(['b', 'd', 'e', 'a', 'c'])
    expect(sorted({ key: 'name', direction: 'desc' })).toEqual(['c', 'a', 'e', 'd', 'b'])
  })

  it('leaves the rows exactly as the server sent them on the default', () => {
    expect(sorted(DEFAULT_SORT)).toEqual(['a', 'b', 'c', 'd', 'e'])
    // The identity, not a copy: no columns and no key means there is nothing to
    // do, and the memo above this depends on that staying cheap.
    expect(sortByColumns(ROWS, [], NO_MATCHES, DEFAULT_SORT, FACTS)).toBe(ROWS)
  })
})

/* --------------------------------------------------- the defining constraint */

describe('a sort never changes which cards are in the list', () => {
  const everySort: Sort[] = SORT_KEYS.flatMap((k) => [
    { key: k.key, direction: 'asc' as const },
    { key: k.key, direction: 'desc' as const },
  ])

  it.each(everySort)('returns exactly the rows it was given: $key $direction', (sort) => {
    const out = sortByColumns(ROWS, [], NO_MATCHES, sort, FACTS)
    // Length AND membership, separately. A sort that dropped one row and
    // duplicated another would satisfy either assertion on its own.
    expect(out).toHaveLength(ROWS.length)
    expect([...idsOf([...out])].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps every row when a column is active as well', () => {
    const columns: Column[] = [{ kind: 'query', query: 't:creature' }]
    const matches = new Map([['t:creature', new Set(['c', 'e'])]])
    const out = sortByColumns(
      ROWS,
      columns,
      matches,
      { key: 'efficiency', direction: 'desc' },
      FACTS,
    )
    expect([...idsOf([...out])].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

/* ------------------------------------------------- composing with the columns */

describe('the chosen key breaks what the columns tie, and does not outrank them', () => {
  const columns: Column[] = [{ kind: 'query', query: 't:creature' }]
  const matches = new Map([['t:creature', new Set(['c', 'e'])]])

  it('orders inside the matched block and inside the unmatched block', () => {
    /*
     * Matched first (c, e), then the rest — that is what promoting a query to a
     * column promises, and a sort key must not cancel it. Within each block the
     * key decides: e (2.4) before c (1.1); then b (2.4), a (0.8), d (unknown).
     *
     * If the key outranked the column the answer would be b, e, c, a, d — the
     * order with no column at all — so this distinguishes the two designs
     * rather than merely exercising one.
     */
    const out = sortByColumns(
      ROWS,
      columns,
      matches,
      { key: 'efficiency', direction: 'desc' },
      FACTS,
    )
    expect(idsOf([...out])).toEqual(['e', 'c', 'b', 'a', 'd'])
  })

  it('still falls back to the order the server sent when the key ties too', () => {
    // `default` is no key at all, so this is the pre-existing behaviour and it
    // must be untouched: matched first, server order within each block.
    const out = sortByColumns(ROWS, columns, matches, DEFAULT_SORT, FACTS)
    expect(idsOf([...out])).toEqual(['c', 'e', 'a', 'b', 'd'])
  })
})

/* ------------------------------------------------------------ missing values */

describe('a row with no value for the key', () => {
  it('is not read as a zero', () => {
    expect(sortValue('efficiency', { oracleId: 'd' })).toBeNull()
    expect(sortValue('impact', { oracleId: 'd' })).toBeNull()
    // And a real zero still is one. A land measures 0 efficiency; it does not
    // fail to measure. It sorts as 0 — bottom of "highest first", but ABOVE the
    // rows nothing is known about.
    expect(sortValue('efficiency', { oracleId: 'z', efficiency: { score: 0 } })).toBe(0)
  })

  it('sinks to the bottom in BOTH directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      expect(sorted({ key: 'efficiency', direction }).at(-1)).toBe('d')
      expect(sorted({ key: 'impact', direction }).at(-1)).toBe('d')
      expect(sorted({ key: 'price', direction }).at(-1)).toBe('c')
    }
  })

  it('ranks a known zero above an unknown, so measuring nothing is not a score', () => {
    const rows: SortableRow[] = [
      { oracleId: 'unknown' },
      { oracleId: 'land', efficiency: { score: 0 } },
    ]
    const out = sortByColumns(rows, [], NO_MATCHES, { key: 'efficiency', direction: 'asc' })
    expect(idsOf([...out])).toEqual(['land', 'unknown'])
  })

  it('keeps unknowns in the order they arrived rather than shuffling them', () => {
    const rows: SortableRow[] = [{ oracleId: 'p' }, { oracleId: 'q' }, { oracleId: 'r' }]
    for (const direction of ['asc', 'desc'] as const) {
      const out = sortByColumns(rows, [], NO_MATCHES, { key: 'efficiency', direction })
      expect(idsOf([...out])).toEqual(['p', 'q', 'r'])
    }
  })

  it('says nothing about a card that has not hydrated yet', () => {
    // No entry in `cards`, so no name and no mana value — the state the feed is
    // genuinely in for the first moments after a result lands.
    expect(sortValue('name', { oracleId: 'nope' }, FACTS)).toBeNull()
    expect(sortValue('manaValue', { oracleId: 'nope' }, FACTS)).toBeNull()
  })
})

/* ------------------------------------------------------- the focus guarantee */

describe('a row the focus guarantee put on the page (ADR-0026)', () => {
  /*
   * Guaranteed rows arrive LAST, because they are on the page precisely for
   * having sorted below their group's cut. Under a user's key they take the
   * place their own number earns: the guarantee is about being PRESENT, not
   * about sitting at a particular end, and pinning them would be the app
   * re-asserting its ordering after the user had overridden it.
   */
  const rows: SortableRow[] = [
    { oracleId: 'hi', score: 90, efficiency: { score: 3 } },
    { oracleId: 'mid', score: 60, efficiency: { score: 1 } },
    { oracleId: 'gtd', score: 5, efficiency: { score: 5 } },
  ]

  it('sorts with everything else rather than staying pinned at the end', () => {
    const out = sortByColumns(rows, [], NO_MATCHES, { key: 'efficiency', direction: 'desc' })
    expect(idsOf([...out])).toEqual(['gtd', 'hi', 'mid'])
  })

  it('is still last when nobody has asked for an order', () => {
    const out = sortByColumns(rows, [], NO_MATCHES, DEFAULT_SORT)
    expect(idsOf([...out])).toEqual(['hi', 'mid', 'gtd'])
  })

  it('is never dropped, whichever way the sort runs', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const out = sortByColumns(rows, [], NO_MATCHES, { key: 'efficiency', direction })
      expect([...idsOf([...out])].sort()).toEqual(['gtd', 'hi', 'mid'])
    }
  })
})

/* ------------------------------------------------------------- the direction */

describe('which way round a key starts', () => {
  it('opens numbers at the top of the scale and names at A', () => {
    // "Sort by efficiency" asked as a question means "which is the most
    // efficient" far more often than the reverse; Z–A is nobody's alphabet.
    expect(initialDirectionFor('efficiency')).toBe('desc')
    expect(initialDirectionFor('impact')).toBe('desc')
    expect(initialDirectionFor('price')).toBe('desc')
    expect(initialDirectionFor('name')).toBe('asc')
  })

  it('has a direction word for every key it offers', () => {
    // The control renders `asc`/`desc` as the button's visible label and half
    // its accessible name, so a key added without them would ship a blank
    // button that says nothing to anyone.
    for (const k of SORT_KEYS) {
      expect(k.asc.length).toBeGreaterThan(0)
      expect(k.desc.length).toBeGreaterThan(0)
      expect(k.label.length).toBeGreaterThan(0)
    }
  })

  it('has no opinion at all under the default key', () => {
    const a: SortableRow = { oracleId: 'a', efficiency: { score: 9 } }
    const b: SortableRow = { oracleId: 'b', efficiency: { score: 1 } }
    expect(compareBySort(a, b, DEFAULT_SORT)).toBe(0)
    expect(sortValue('default', a)).toBeNull()
  })
})

/* ------------------------------------------------------------- the interface */

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

/** jsdom has no ResizeObserver, and the column legend observes. */
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

const card = (oracleId: string, name: string, manaValue: number): api.Card => ({
  oracleId,
  name,
  manaCost: '{R}',
  manaValue,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  colors: ['R'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  power: null,
  toughness: null,
  loyalty: null,
  synergyProduces: [],
  synergyWants: [],
})

const item = (
  oracleId: string,
  score: number,
  efficiency: number,
  impact: number,
  guaranteed = false,
): api.Recommendation =>
  ({
    oracleId,
    score,
    comboDegree: 0,
    nearCombosAt1: 0,
    completedCombos: [],
    combos: [],
    reasons: [
      guaranteed ? { kind: 'supports-focus', guaranteed: true } : { kind: 'fills-deficit' },
    ],
    efficiency: { score: efficiency },
    impact: { score: impact },
  }) as unknown as api.Recommendation

const analysis: api.Analysis = {
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
  prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
  unavailable: [],
}

/**
 * Two groups, neither of them in efficiency order.
 *
 * `top-creature` deliberately holds the most efficient card in the whole
 * response (`o5`, 9.0). If a sort ever reached across the headings that row
 * would climb into the first group, and the per-group membership these tests
 * read back is what catches it (pillar P5).
 */
const recs = (): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'fills-ramp',
        label: 'Fills gap · ramp',
        rationale: 'because ramp',
        total: 3,
        items: [item('o1', 90, 1.2, 4), item('o2', 70, 5.5, 2), item('o3', 50, 0.4, 8)],
      },
      {
        key: 'top-creature',
        label: 'Top creatures',
        rationale: 'because creatures',
        total: 2,
        items: [item('o4', 80, 2.1, 3), item('o5', 40, 9, 1)],
      },
    ],
    columns: [],
    unavailable: [],
    emphasis: [],
    query: { matched: 5, total: 5, withheldByGroup: {}, errors: [] },
  }) as unknown as api.Recommendations

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue(recs())
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map<string, api.Card>([
      ['o1', card('o1', 'Krenko', 4)],
      ['o2', card('o2', 'Bolt', 1)],
      ['o3', card('o3', 'Anger', 5)],
      ['o4', card('o4', 'Ritual', 1)],
      ['o5', card('o5', 'Zealot', 2)],
      ['o6', card('o6', 'Goblin', 3)],
    ]),
    prices: new Map([
      ['o1', 1.5],
      ['o2', 2],
      ['o3', 3],
      ['o4', 4],
      ['o5', 5],
      ['o6', 6],
    ]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

/**
 * Every suggestion heading and the oracle ids under it, in drawn order.
 *
 * Ids, not names: `data-row-id` is what the app itself walks to move focus
 * after an accept, so it is the identity the DOM already carries, and reading
 * it cannot be confused by a name that is still loading.
 */
const groupsOnScreen = (container: HTMLElement): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const group of container.querySelectorAll('.group')) {
    const heading = group.querySelector('h3')?.textContent ?? '?'
    out[heading] = [...group.querySelectorAll('.card-row')].map(
      (row) => row.getAttribute('data-row-id') ?? '?',
    )
  }
  return out
}

const sortSelect = (): HTMLSelectElement => screen.getByLabelText('Sort') as HTMLSelectElement

const chooseSort = async (key: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(sortSelect(), { target: { value: key } })
  })
}

const drawn = async (container: HTMLElement): Promise<void> => {
  await waitFor(() =>
    expect(container.querySelectorAll('.group .card-row').length).toBeGreaterThan(0),
  )
}

describe('the sort control', () => {
  it('reorders the rows inside each heading without changing who is under it', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const before = groupsOnScreen(container)
    expect(before['Fills gap · ramp']).toEqual(['o1', 'o2', 'o3'])
    expect(before['Top creatures']).toEqual(['o4', 'o5'])

    await chooseSort('efficiency')

    const after = groupsOnScreen(container)
    // 5.5, 1.2, 0.4 — and 9.0, 2.1.
    expect(after['Fills gap · ramp']).toEqual(['o2', 'o1', 'o3'])
    expect(after['Top creatures']).toEqual(['o5', 'o4'])
    // The same cards, heading for heading. `o5` is the most efficient row in
    // the whole response and must NOT have climbed into the first group.
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const heading of Object.keys(before)) {
      expect([...(after[heading] ?? [])].sort()).toEqual([...(before[heading] ?? [])].sort())
    }
  })

  it('reverses on the direction button without losing a row', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    await chooseSort('efficiency')

    await act(async () => {
      screen.getByLabelText(/Efficiency: highest first/).click()
    })

    const after = groupsOnScreen(container)
    expect(after['Fills gap · ramp']).toEqual(['o3', 'o1', 'o2'])
    expect(after['Top creatures']).toEqual(['o4', 'o5'])
    expect(container.querySelectorAll('.group .card-row')).toHaveLength(5)
  })

  it('keeps the group counts the headings print', async () => {
    // `total` is the server's count of what matched before its own cut, and a
    // client-side reorder has nothing to say about it. If sorting ever started
    // filtering, this is the number that would disagree with the rows.
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const counts = (): string[] =>
      [...container.querySelectorAll('.group .count')].map((c) => c.textContent ?? '')
    const before = counts()
    expect(before).toEqual(['3', '2'])

    await chooseSort('efficiency')
    expect(counts()).toEqual(before)
    expect(groupsOnScreen(container)['Fills gap · ramp']).toHaveLength(3)
    expect(groupsOnScreen(container)['Top creatures']).toHaveLength(2)
  })

  it('says the direction in words, not with an arrow', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(sortSelect()).toBeDefined())
    await chooseSort('efficiency')

    const button = screen.getByLabelText(/Efficiency: highest first/)
    // The visible label is the state; the accessible name adds what a click
    // would do. Neither is a glyph.
    expect(button.textContent).toBe('Highest first')
    expect(button.getAttribute('aria-label')).toContain('Activate to sort lowest first')
    expect(button.textContent).not.toMatch(/[▲▼↑↓⇅]/)
  })

  it('announces whose ordering is on screen, and stops claiming a recommendation', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(sortSelect()).toBeDefined())

    const state = (): string => container.querySelector('.sort-state')?.textContent ?? ''
    // Present from the start: a live region mounted at the same moment its text
    // appears is not reliably announced.
    expect(container.querySelector('.sort-state')?.getAttribute('role')).toBe('status')
    expect(state()).toMatch(/Recommended order/)

    await chooseSort('efficiency')
    expect(state()).toMatch(/Your order: efficiency, highest first/)
    expect(state()).not.toMatch(/Recommended order/)
    // The honest scope: it orders what is on screen, not the corpus.
    expect(state()).toMatch(/not the whole card pool/)
  })

  it('gets back to the recommended order in one click', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const before = groupsOnScreen(container)

    await chooseSort('efficiency')
    expect(groupsOnScreen(container)).not.toEqual(before)

    await act(async () => {
      screen.getByRole('button', { name: 'Recommended order' }).click()
    })
    expect(groupsOnScreen(container)).toEqual(before)
    expect(sortSelect().value).toBe('default')
    // And the way back is gone again, because there is nothing to go back from.
    expect(screen.queryByRole('button', { name: 'Recommended order' })).toBeNull()
  })

  it('offers no direction or reset while the default is in force', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(sortSelect()).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Recommended order' })).toBeNull()
    expect(screen.queryByLabelText(/Activate to sort/)).toBeNull()
  })

  it('does not ask the server for anything when the order changes', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const before = mocked.getRecommendations.mock.calls.length

    await chooseSort('efficiency')
    await chooseSort('impact')

    // A reorder of rows already on the page. A round trip would make it feel
    // like a query, and would let the server's cut move under the user.
    expect(mocked.getRecommendations.mock.calls.length).toBe(before)
  })

  it('is reachable and operable from the keyboard', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(sortSelect()).toBeDefined())
    // A native select and native buttons: focusable in source order with no
    // tabindex of our own, which is the point of not building a custom menu.
    expect(sortSelect().tagName).toBe('SELECT')
    expect(sortSelect().hasAttribute('disabled')).toBe(false)

    await chooseSort('efficiency')
    expect(screen.getByLabelText(/Efficiency: highest first/).tagName).toBe('BUTTON')
    expect(screen.getByRole('button', { name: 'Recommended order' }).tagName).toBe('BUTTON')
  })

  it('offers every key the sort understands, with the default first', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(sortSelect()).toBeDefined())
    const options = [...sortSelect().options]
    expect(options.map((o) => o.value)).toEqual(SORT_KEYS.map((k) => k.key))
    expect(options[0]?.value).toBe('default')
    expect(options[0]?.textContent).toBe('Recommended')
  })
})

describe('the sort and the merged combo heading', () => {
  /**
   * The three combo groups are merged and HALVED for density, except for the
   * rows the focus guarantee rescued (ADR-0026). All of that happens before the
   * sort runs, and this pins that the order of the two is not the other way
   * round — a sort that ran first, or that the halving was applied after, would
   * throw away a row the server promised the builder.
   *
   * Four rows in, two kept by the halving plus the guaranteed one rescued from
   * the discarded half: three on screen, whatever the sort does.
   */
  const comboRecs = (): api.Recommendations =>
    ({
      datasetSnapshotId: null,
      groups: [
        {
          key: 'combo-2',
          label: 'Completes 2 combos',
          rationale: 'because',
          total: 4,
          items: [
            { ...item('o1', 90, 1.2, 4), comboDegree: 2 },
            { ...item('o2', 70, 5.5, 2), comboDegree: 2 },
            { ...item('o3', 50, 0.4, 8), comboDegree: 2 },
            // Below the cut on score, and on the page only because of the
            // guarantee — and the most efficient of the four.
            { ...item('o6', 5, 7.7, 1, true), comboDegree: 2 },
          ],
        },
      ],
      columns: [],
      unavailable: [],
      emphasis: [],
      query: { matched: 4, total: 4, withheldByGroup: {}, errors: [] },
    }) as unknown as api.Recommendations

  it('keeps the guaranteed row through every sort, and lets it sort on the key', async () => {
    mocked.getRecommendations.mockResolvedValue(comboRecs())
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)

    // The halving first: o1 and o2 kept, o3 dropped, o6 rescued.
    expect(groupsOnScreen(container)['Completes combos']).toEqual(['o1', 'o2', 'o6'])

    await chooseSort('efficiency')
    // 7.7, 5.5, 1.2 — the rescued row leads on its own number rather than
    // staying pinned to the end it was appended at.
    expect(groupsOnScreen(container)['Completes combos']).toEqual(['o6', 'o2', 'o1'])

    await act(async () => {
      screen.getByLabelText(/Efficiency: highest first/).click()
    })
    expect(groupsOnScreen(container)['Completes combos']).toEqual(['o1', 'o2', 'o6'])

    // Never fewer, never more, and never the row the halving discarded.
    for (const key of ['efficiency', 'impact', 'score', 'name', 'price', 'manaValue']) {
      await chooseSort(key)
      const rows = groupsOnScreen(container)['Completes combos'] ?? []
      expect([...rows].sort()).toEqual(['o1', 'o2', 'o6'])
    }
  })
})
