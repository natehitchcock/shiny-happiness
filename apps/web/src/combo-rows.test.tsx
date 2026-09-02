// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The two places a combo is drawn as a LIST OF ROWS, and the two ways that went
 * wrong in a playtest.
 *
 * 1. The merged "Completes combos" heading kept the full count and drew half
 *    the rows, with nothing on the page saying so. What it dropped at three
 *    cards were the two rows a combo-first tool exists to show.
 * 2. "Works with your deck" keyed its one-card-away rows by the card they need,
 *    and several combos legitimately need the same card — so React saw
 *    duplicate keys and warned that children "may be duplicated and/or
 *    omitted".
 *
 * Both are about the same discipline: a list that is not showing everything it
 * holds has to say so, and every row in it has to be its own row.
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
  createDeck: vi.fn(),
  listDecks: vi.fn(),
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

/* ------------------------------------------------------------------ fixtures */

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['cmd'],
  colorIdentity: ['U'],
  targetBracket: 3,
  archetype: 'combo',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  // `o2` is IN the deck. A combo is "one card away" only when every piece but
  // one is already accepted, so a fixture with an empty deck cannot produce a
  // multi-piece near miss at all.
  entries: [{ oracleId: 'o2', zone: 'accepted', locked: false }],
} as unknown as api.Deck

const card = (oracleId: string, name: string): api.Card =>
  ({
    oracleId,
    name,
    manaCost: '{2}',
    manaValue: 2,
    typeLine: 'Artifact',
    types: ['artifact'],
    oracleText: '',
    colorIdentity: [],
    primaryRole: 'ramp',
    edhrecRank: null,
    universesBeyond: false,
    power: null,
    toughness: null,
    loyalty: null,
    synergyProduces: [],
    synergyWants: [],
  }) as unknown as api.Card

const comboItem = (
  oracleId: string,
  degree: number,
  score: number,
  guaranteed = false,
): api.Recommendation =>
  ({
    oracleId,
    score,
    comboDegree: degree,
    nearCombosAt1: 0,
    completedCombos: [],
    combos: [],
    reasons: [
      { kind: 'completes-combos', count: degree },
      ...(guaranteed
        ? [
            {
              kind: 'keyword-synergy',
              direction: 'payoff',
              tag: 'untapping',
              emphasised: true,
              guaranteed: true,
            },
          ]
        : []),
    ],
  }) as unknown as api.Recommendation

const analysis = {
  counts: { total: 1, byRole: {} },
  targets: [],
  cuts: [],
  deficits: [],
  archetype: { declared: 'combo', assessed: 'combo', confidence: 0.5 },
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
} as unknown as api.Analysis

/**
 * The three groups the server emits, as the playtest saw them.
 *
 * SIX rows between them, so `Math.ceil(6 / 2)` keeps three and three fall past
 * the cut — one of which is there only because of the ADR-0026 focus guarantee
 * and must survive whatever the halving does. `total` is deliberately LARGER
 * than the rows sent (9 against 6): that is the real shape, where the server
 * has more members than it sent under `limitPerGroup`, and it keeps these
 * tests from passing on a footer that merely subtracts `items.length` from
 * `total`.
 */
const comboRecs = (): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'combo-3plus',
        label: 'Completes 3+ combos',
        rationale: 'three or more',
        total: 3,
        items: [comboItem('o1', 4, 0.9), comboItem('o2', 3, 0.8)],
      },
      {
        key: 'combo-2',
        label: 'Completes 2 combos',
        rationale: 'two',
        total: 4,
        items: [comboItem('o3', 2, 0.7), comboItem('o4', 2, 0.6)],
      },
      {
        key: 'combo-1',
        label: 'Completes 1 combo',
        rationale: 'one',
        total: 2,
        // `o6` scores below everything and is on the page only because the
        // focus guarantee put it there (ADR-0026 §4).
        items: [comboItem('o5', 1, 0.5), comboItem('o6', 1, 0.05, true)],
      },
    ],
    columns: [],
    unavailable: [],
    emphasis: [{ tag: 'untapping', supporting: 12 }],
    query: { matched: 6, total: 6, withheldByGroup: {}, errors: [] },
  }) as unknown as api.Recommendations

const NAMES: Record<string, string> = {
  o1: 'Basalt Monolith',
  o2: 'Rings of Brighthearth',
  o3: 'Mana Vault',
  o4: 'Mox Opal',
  o5: 'Dramatic Reversal',
  o6: 'Isochron Scepter',
  cmd: 'Tidespout Tyrant',
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(comboRecs())
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map(Object.entries(NAMES).map(([id, name]) => [id, card(id, name)])),
    prices: new Map(),
    images: new Map(),
  } as unknown as api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] } as unknown as never)
  mocked.searchCards.mockResolvedValue({ items: [] } as unknown as never)
})

afterEach(cleanup)

const comboGroup = (container: HTMLElement): HTMLElement => {
  const group = [...container.querySelectorAll('.group')].find(
    (g) => g.querySelector('h3')?.textContent === 'Completes combos',
  )
  if (group === undefined) throw new Error('no merged combo heading on the page')
  return group as HTMLElement
}

const rowIds = (group: HTMLElement): string[] =>
  [...group.querySelectorAll('.card-row')].map((r) => r.getAttribute('data-row-id') ?? '?')

const drawn = async (container: HTMLElement): Promise<void> => {
  await waitFor(() =>
    expect(container.querySelectorAll('.group .card-row').length).toBeGreaterThan(0),
  )
}

/* ------------------------------------- 1. the merged heading and its withheld rows */

describe('the merged combo heading accounts for every row it holds', () => {
  it('still halves the rows it draws, so the merge does not swamp the feed', async () => {
    // The density decision is deliberate and stays. Three of the six, plus the
    // guaranteed row rescued from the discarded half (ADR-0026 §8).
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    expect(rowIds(comboGroup(container))).toEqual(['o1', 'o2', 'o3', 'o6'])
  })

  it('says how many rows it is holding back, instead of dropping them silently', async () => {
    /*
     * doc 05 §5.3 already fixes the shape for this: a group that is not showing
     * a card it holds footers the count and offers it — "+3 more complete 3+
     * combos but don't match your filter · show". This is the same sentence for
     * the same reason, and the reason is the harder half: the two rows cut here
     * were Mana Vault and Mox Opal, and Mana Vault finishes a two-card combo
     * with a card already in the deck.
     */
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const foot = comboGroup(container).querySelector('.group-foot')
    expect(foot).not.toBeNull()
    expect(foot?.textContent).toMatch(/\+2 more/)
  })

  it('shows the withheld rows when asked, without another request', async () => {
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const calls = mocked.getRecommendations.mock.calls.length

    await act(async () => {
      screen.getByRole('button', { name: /show the 2 more/i }).click()
    })

    // Every row the server sent, and the count in the heading is no longer
    // describing a list the page is not drawing.
    expect([...rowIds(comboGroup(container))].sort()).toEqual([
      'o1',
      'o2',
      'o3',
      'o4',
      'o5',
      'o6',
    ])
    expect(comboGroup(container).querySelector('.group-foot')).toBeNull()
    // The rows were already in hand. Asking the server again would be a second
    // answer to a question already answered.
    expect(mocked.getRecommendations.mock.calls.length).toBe(calls)
  })

  it('keeps the guaranteed row out of the withheld set entirely', async () => {
    /*
     * ADR-0026 §8. The guaranteed rows are LAST in this sort by construction —
     * they are on the page because they scored below their group's cut — so a
     * naive halving throws away exactly them. They must be drawn before the
     * footer is ever used.
     */
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    expect(rowIds(comboGroup(container))).toContain('o6')
    expect(screen.getByText('Isochron Scepter')).toBeDefined()
  })

  it('counts the withheld rows without counting a row twice', async () => {
    // Six rows sent, four drawn, so exactly two are withheld — not three,
    // which is what `all.length - half` says when the rescued row is
    // double-counted.
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    const foot = comboGroup(container).querySelector('.group-foot')
    expect(foot?.textContent).not.toMatch(/\+3 more/)
  })
})

describe('asking the merged heading for more', () => {
  it('asks for the three group keys the server actually emits', async () => {
    /*
     * `combo` is a heading this client invented; the server knows `combo-1`,
     * `combo-2` and `combo-3plus` (doc 05 §5.3). The translation asked for
     * `combo-2`, `combo-3` and `combo-4` — two keys that match nothing, and
     * never `combo-1` or `combo-3plus` — so More could only ever bring back
     * more two-combo cards, and the heading's own best rows were unreachable.
     */
    const { container } = render(<Workspace deck={deck} />)
    await drawn(container)
    mocked.getRecommendations.mockClear()

    await act(async () => {
      screen.getByLabelText('Ask for more completes combos').click()
    })

    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    const asked = mocked.getRecommendations.mock.calls
      .map((c) => (c[1] as { groups?: readonly string[] } | undefined)?.groups)
      .find((g) => g !== undefined)
    expect([...(asked ?? [])].sort()).toEqual(['combo-1', 'combo-2', 'combo-3plus'])
  })
})

/* ------------------------------------------- 2. one card away, once per card */

const detailWithCombos = (
  combos: { id: string; pieces: { oracleId: string; name: string | null }[]; produces: string[] }[],
): api.CardDetail =>
  ({
    ...card('o1', 'Basalt Monolith'),
    printings: [],
    combos,
    references: [],
    synergyProduces: [],
    synergyWants: [],
  }) as unknown as api.CardDetail

describe('the one-card-away rows in “Works with your deck”', () => {
  /**
   * Three combos that all need the same missing card, and one that needs
   * another.
   *
   * This is the ordinary case, not a contrived one: a single missing piece
   * routinely completes several different lines, which is exactly why it is
   * worth naming. Keyed by the card it needs, React saw the same key three
   * times.
   */
  const combos = [
    {
      id: 'k1',
      pieces: [
        { oracleId: 'o1', name: 'Basalt Monolith' },
        { oracleId: 'need', name: 'Emiel the Blessed' },
        { oracleId: 'cmd', name: 'Tidespout Tyrant' },
      ],
      produces: ['infinite-mana'],
    },
    {
      id: 'k2',
      pieces: [
        { oracleId: 'o1', name: 'Basalt Monolith' },
        { oracleId: 'need', name: 'Emiel the Blessed' },
        { oracleId: 'o2', name: 'Rings of Brighthearth' },
      ],
      produces: ['infinite-tokens'],
    },
    {
      id: 'k3',
      pieces: [
        { oracleId: 'o1', name: 'Basalt Monolith' },
        { oracleId: 'need', name: 'Emiel the Blessed' },
      ],
      produces: ['infinite-creatures'],
    },
    {
      id: 'k4',
      pieces: [
        { oracleId: 'o1', name: 'Basalt Monolith' },
        { oracleId: 'other', name: 'Deadeye Navigator' },
      ],
      produces: ['infinite-damage'],
    },
  ]

  const openBasalt = async (): Promise<void> => {
    mocked.getCardDetail.mockResolvedValue(detailWithCombos(combos))
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Basalt Monolith')).toBeTruthy())
    await act(async () => screen.getByLabelText('Preview Basalt Monolith').click())
    await screen.findByText(/No combo assembled yet/i)
  }

  it('draws one row per card it needs, not one per combo', async () => {
    await openBasalt()
    const rows = [...document.querySelectorAll('.partners-one-away')]
    expect(rows).toHaveLength(2)
    // Four rows saying "needs Emiel the Blessed" is four answers to one
    // question. One row, naming what the card would finish, is the answer.
    const emiel = rows.filter((r) => r.textContent?.includes('Emiel the Blessed'))
    expect(emiel).toHaveLength(1)
  })

  it('names every combo that one card would finish', async () => {
    await openBasalt()
    const emiel = [...document.querySelectorAll('.partners-one-away')].find((r) =>
      r.textContent?.includes('Emiel the Blessed'),
    )
    expect(emiel?.textContent).toContain('Tidespout Tyrant')
    expect(emiel?.textContent).toContain('Rings of Brighthearth')
    // The three-piece, the four-piece AND the two-piece line, which has no
    // other partner to name and would vanish from a merge that only listed
    // partners.
    expect(emiel?.querySelectorAll('.partners-line')).toHaveLength(3)
  })

  it('logs no duplicate-key warning', async () => {
    /*
     * The reason this is a correctness test and not a tidiness one: React's own
     * message says non-unique keys "may cause children to be duplicated and/or
     * omitted — the behavior is unsupported".
     */
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    try {
      await openBasalt()
    } finally {
      spy.mockRestore()
    }
    const keyed = errors.filter((e) => e.some((a) => String(a).includes('same key')))
    expect(keyed).toEqual([])
  })
})
