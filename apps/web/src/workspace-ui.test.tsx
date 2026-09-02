// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { rejectionNotice, sortByColumns, Workspace, type Column } from './App'

/**
 * The workspace panels, driven through the rendered UI.
 *
 * One file rather than six, because every one of these needs the same
 * fixture — a deck, a recommendations answer, an analysis and a hydration —
 * and six copies of it is six things that drift. The describes below are the
 * feature boundaries.
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

const card = (over: Partial<api.Card> & { oracleId: string; name: string }): api.Card => ({
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  colorIdentity: ['R'],
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

export const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['cmd'],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
}

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

const recs = (over: Partial<api.Recommendations> = {}): api.Recommendations => ({
  datasetSnapshotId: null,
  // Required since semantic emphasis shipped: the deck's emphasised tags and
  // how many candidates support each. Empty here — these tests are about the
  // workspace UI, not about focus.
  emphasis: [],
  groups: [],
  columns: [],
  unavailable: [],
  query: { matched: 0, total: 0, errors: [] },
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(recs())
  mocked.getAnalysis.mockResolvedValue(analysis)
  // All three maps. A mock missing one loads nothing and every panel vanishes.
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['cmd', card({ oracleId: 'cmd', name: 'Krenko, Mob Boss' })]]),
    prices: new Map([['cmd', 1.5]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  /*
   * `patchDeck` returns a PROMISE, and a bare `vi.fn()` returns undefined.
   *
   * It never mattered while nothing in these tests patched the deck. It does
   * now: adding or removing a column saves the list to the deck (doc 18 §18.7),
   * so every promote-to-column click goes through here, and a mock that answers
   * with the wrong SHAPE throws inside the component rather than failing an
   * assertion — which is an uncaught exception attributed to whichever test
   * happened to be running.
   */
  mocked.patchDeck.mockResolvedValue({ ...deck, version: deck.version + 1 })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
  // A timed-out test never reaches its own restore, and a frozen clock leaks
  // into every test after it.
  vi.useRealTimers()
})

const typeFilter = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Type a filter and commit it, which is the only way a filter ever runs. */
const runFilter = async (text: string): Promise<void> => {
  await typeFilter(text)
  await act(async () => {
    screen.getByLabelText(/^Run this filter/).click()
  })
}

// -------------------------------------------------------------- auto query

describe('the auto-query setting', () => {
  const checkbox = (): HTMLInputElement =>
    screen.getByLabelText(/Auto query after/) as HTMLInputElement

  it('is off for someone who has never expressed a view', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(checkbox().checked).toBe(false)
  })

  it('keeps the choice of someone who already switched it on', async () => {
    localStorage.setItem('lw.autoQuery', 'on')
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(checkbox().checked).toBe(true)
  })

  it('names the wait it actually has, not a number left behind by an edit', async () => {
    // The label read "4 seconds" against a 2,000 ms constant.
    const { AUTO_QUERY_MS } = await import('./autoquery')
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(screen.getByLabelText(/Auto query after/).parentElement?.textContent).toContain(
      `after ${String(Math.round(AUTO_QUERY_MS / 1000))} seconds`,
    )
  })

  /*
   * Asserted through the countdown the search button advertises, not through a
   * fake clock.
   *
   * The clock version passed with the default flipped back to ON, because the
   * timer fired inside `act` and the request it caused had not been issued by
   * the time the assertion ran — a test that could not tell the two defaults
   * apart. The button's accessible name is the countdown made visible, it is
   * present the instant a wait begins, and it is the only thing on screen that
   * tells a user the setting is doing anything.
   */
  it('does not start a countdown on a fresh browser', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await typeFilter('t:creature')
    expect(screen.queryByLabelText(/runs on its own in/)).toBeNull()
  })

  it('does start one once the box is ticked — the feature still works', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await act(async () => {
      checkbox().click()
    })
    await typeFilter('t:creature')
    expect(screen.getByLabelText(/runs on its own in/)).toBeDefined()
  })
})

// ----------------------------------------------------------- name matches

/**
 * "Cards named like…" — the one list in the app that deliberately shows cards
 * which are NOT candidates for this deck.
 *
 * It used to be a `<ul>` of text buttons that could only open a preview, so
 * finding the card you were looking for left you with nowhere to go. These
 * assert that the rows can now act, and — the harder half — that a row which
 * cannot act says so instead of offering a button that silently fails.
 */
describe('the name-match rows', () => {
  const goblin = card({ oracleId: 'gob', name: 'Goblin Matron', colorIdentity: ['R'] })
  /** Legal as a card, illegal in a mono-red deck. */
  const offColour = card({
    oracleId: 'thief',
    name: 'Thieving Skydiver',
    colorIdentity: ['U'],
    typeLine: 'Creature — Merfolk Rogue',
  })

  const search = (items: api.Card[]): void => {
    mocked.searchCards.mockResolvedValue({ items })
  }

  const sentCommands = (): string[] => {
    const call = mocked.sendCommands.mock.calls.at(-1)
    return (call?.[1] ?? []).map((c) => c.type)
  }

  it('offers Add on a card that could go in the deck', async () => {
    search([goblin])
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')

    await waitFor(() => expect(screen.getByLabelText('Add Goblin Matron')).toBeDefined())
  })

  it('sends the accept when that Add is pressed', async () => {
    search([goblin])
    mocked.sendCommands.mockResolvedValue({
      deck: {
        ...deck,
        version: 2,
        entries: [{ oracleId: 'gob', zone: 'accepted', locked: false }],
      },
      applied: [],
      rejected: [],
    })
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')
    await waitFor(() => expect(screen.getByLabelText('Add Goblin Matron')).toBeDefined())

    await act(async () => {
      screen.getByLabelText('Add Goblin Matron').click()
    })

    await waitFor(() => expect(mocked.sendCommands).toHaveBeenCalled())
    expect(sentCommands()).toEqual(['accept'])
  })

  it('refuses to offer Add on a card outside the colour identity, and says why', async () => {
    // The honest edge: this card is real, it is in the corpus, and the server
    // WILL reject an accept for it. A plain Add would show it landing in the
    // deck and then take it away again with nothing said.
    search([offColour])
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Thieving Skydiver')

    await waitFor(() => expect(screen.getByText('Thieving Skydiver')).toBeDefined())
    expect(screen.queryByLabelText('Add Thieving Skydiver')).toBeNull()
    // The offending letter, not just the verdict.
    expect(screen.getByText(/outside your colour identity \(U\)/)).toBeDefined()
  })

  it('says a card is already in the deck rather than offering a second copy', async () => {
    search([goblin])
    render(
      <Workspace
        deck={{ ...deck, entries: [{ oracleId: 'gob', zone: 'accepted', locked: false }] }}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')

    await waitFor(() => expect(screen.getByText('Goblin Matron')).toBeDefined())
    expect(screen.queryByLabelText('Add Goblin Matron')).toBeNull()
    expect(screen.getByText('already in your deck')).toBeDefined()
  })

  it('restores a rejected card rather than sending a bare accept', async () => {
    // A bare `accept` on an excluded card is refused for `previously-excluded`.
    // The Rejected list has always sent restore-then-accept in one batch; this
    // row has to do the same or its button is a button that cannot work.
    search([goblin])
    mocked.sendCommands.mockResolvedValue({
      deck: { ...deck, version: 2 },
      applied: [],
      rejected: [],
    })
    render(
      <Workspace
        deck={{ ...deck, entries: [{ oracleId: 'gob', zone: 'excluded', locked: false }] }}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')
    await waitFor(() => expect(screen.getByLabelText(/Add Goblin Matron back/)).toBeDefined())

    await act(async () => {
      screen.getByLabelText(/Add Goblin Matron back/).click()
    })

    await waitFor(() => expect(mocked.sendCommands).toHaveBeenCalled())
    expect(sentCommands()).toEqual(['restore', 'accept'])
  })

  it('reports a rejection the server sends back, instead of losing the card in silence', async () => {
    /*
     * The failure mode this exists to remove: the optimistic overlay shows the
     * card in the deck, the server refuses it, `setPending([])` sweeps the
     * overlay away, and the card is simply gone. The client held the reason in
     * `CommandResult.rejected` the whole time and threw it away.
     */
    search([goblin])
    mocked.sendCommands.mockResolvedValue({
      deck: { ...deck, version: 2 },
      applied: [],
      rejected: [{ command: { type: 'accept', oracleId: 'gob' }, reason: { kind: 'banned' } }],
    })
    /*
     * The hydration deliberately does NOT hold the goblin.
     *
     * Measured in a browser: adding Black Lotus from "Cards named like…" said
     * "THAT CARD was not added — it is banned in Commander". `hydrated.cards`
     * only ever holds the deck and the suggestion feed; a card that came from
     * `searchCards` is in neither, and a REFUSED card never joins the deck — so
     * the one route that reaches a rejection on purpose was the one route with
     * no name to print. The name-match results are now in the lookup too.
     */
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')
    await waitFor(() => expect(screen.getByLabelText('Add Goblin Matron')).toBeDefined())

    await act(async () => {
      screen.getByLabelText('Add Goblin Matron').click()
    })

    // Named, and with the rule it broke — not a uuid and not a bare kind.
    await waitFor(
      () => expect(screen.getByText(/Goblin Matron was not added — it is banned/)).toBeDefined(),
      { timeout: 8_000 },
    )
  }, 20_000)

  /*
   * `rejectionNotice` is the ONE reader of `rejected`, tested directly.
   *
   * The component-level version of this could not fail: everything visible had
   * already been set by the time the unguarded `.length` threw, so the only
   * symptom was an uncaught exception on a timer — which vitest reports as an
   * unattributed error rather than as a failing assertion. Testing the reader
   * makes the guard something a mutation can break.
   */
  it('says nothing about refusals when the server sent no `rejected` field', () => {
    // The shape a run with no commands produces, and the shape a server from
    // before this field sends.
    expect(rejectionNotice(undefined, new Map())).toBeNull()
    expect(rejectionNotice([], new Map())).toBeNull()
  })

  it('names the card and the rule, and counts the rest', () => {
    const cards = new Map([['gob', goblin]])
    expect(
      rejectionNotice(
        [{ command: { type: 'accept', oracleId: 'gob' }, reason: { kind: 'color-identity' } }],
        cards,
      ),
    ).toBe("Goblin Matron was not added — it is outside your commander's colour identity.")

    // A whole import can be refused; forty sentences is a banner nobody reads.
    expect(
      rejectionNotice(
        [
          { command: { type: 'accept', oracleId: 'gob' }, reason: { kind: 'banned' } },
          { command: { type: 'accept', oracleId: 'other' }, reason: { kind: 'banned' } },
        ],
        cards,
      ),
    ).toBe('Goblin Matron was not added — it is banned in Commander. (1 other card too.)')
  })

  it('degrades a rejection kind this build has never heard of to readable English', () => {
    // A newer server may refuse for a reason not in this switch. It must not
    // print a bare kind, and it must still name the card.
    expect(
      rejectionNotice(
        [{ command: { type: 'accept', oracleId: 'gob' }, reason: { kind: 'moon-phase-wrong' } }],
        new Map([['gob', goblin]]),
      ),
    ).toBe('Goblin Matron: the server refused that (moon phase wrong).')
  })

  it('no longer claims three reasons a card might be missing when the real one is none of them', async () => {
    // The explainer under an empty search listed "already in it, excluded, or
    // outside your colour identity" as though that were the whole list. The
    // usual reason is that nothing ranked the card into a group at all.
    search([goblin])
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await runFilter('Goblin Matron')

    const line = await screen.findByText(/nothing ranked them into a group/)
    expect(line.textContent).not.toMatch(/being already in it, excluded, or outside/)
  })
})

// ------------------------------------------------------------ column sort

/**
 * Promoting a query to a column SORTS by it, and columns compose.
 *
 * The pure half is tested directly, because the composition rule is the part
 * that is easy to get subtly wrong and hard to read off a rendered list: with
 * three columns there are eight match combinations and only one correct order.
 */
describe('sortByColumns', () => {
  const query = (q: string): Column => ({ kind: 'query', query: q })
  const rows = (...ids: string[]): { oracleId: string }[] => ids.map((oracleId) => ({ oracleId }))
  const matches = (m: Record<string, string[]>): Map<string, Set<string>> =>
    new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]))

  it('leaves the score order alone when there are no columns', () => {
    const items = rows('a', 'b', 'c')
    // The same array, not a copy: nothing to do is nothing to allocate.
    expect(sortByColumns(items, [], new Map())).toBe(items)
  })

  it('brings the matches to the front and leaves the rest in score order', () => {
    const out = sortByColumns(rows('a', 'b', 'c', 'd'), [query('x')], matches({ x: ['b', 'd'] }))
    expect(out.map((r) => r.oracleId)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('breaks the first column’s ties with the second, never the other way round', () => {
    /*
     * The whole feature in one case. `x` splits the four rows into two pairs;
     * `y` orders within each pair and must not lift a row out of its pair.
     *
     *   a  x yes, y no        c  x no,  y yes
     *   b  x yes, y yes       d  x no,  y no
     *
     * Correct: b (both), a (x only), c (y only), d (neither).
     * A single-key sort on `y` would give b, c, a, d — c above a, which puts a
     * row the PRIMARY column rejected above one it accepted.
     */
    const out = sortByColumns(
      rows('a', 'b', 'c', 'd'),
      [query('x'), query('y')],
      matches({ x: ['a', 'b'], y: ['b', 'c'] }),
    )
    expect(out.map((r) => r.oracleId)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('falls back to the order the server sent, which is score', () => {
    // Every row agrees on every column, so nothing may move.
    const out = sortByColumns(
      rows('a', 'b', 'c'),
      [query('x'), query('y')],
      matches({ x: ['a', 'b', 'c'], y: [] }),
    )
    expect(out.map((r) => r.oracleId)).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic — the same input twice is the same output', () => {
    const items = rows('a', 'b', 'c', 'd', 'e')
    const cols = [query('x'), query('y')]
    const m = matches({ x: ['c'], y: ['a', 'd'] })
    const first = sortByColumns(items, cols, m).map((r) => r.oracleId)
    const second = sortByColumns(items, cols, m).map((r) => r.oracleId)
    expect(first).toEqual(second)
    expect(first).toEqual(['c', 'a', 'd', 'b', 'e'])
  })

  it('gives a metric column no opinion about the order, values or not', () => {
    /*
     * `ordersRows`, in one case. A metric column DRAWS a number and does not
     * rank by it, so the query column beside it decides — even though this
     * metric's values are right here on the rows and would have ordered them
     * b, a, c if it had been allowed an opinion.
     *
     * Not a seam any more: the values arrive on every recommendation item. The
     * reason is that both metrics are present by DEFAULT, so ranking by them
     * would re-order every feed by a card-intrinsic figure nobody asked about
     * and would push a query the builder just promoted below two columns they
     * never chose.
     */
    const withImpact = [
      { oracleId: 'a', impact: { score: 2 } },
      { oracleId: 'b', impact: { score: 9 } },
      { oracleId: 'c', impact: { score: 5 } },
    ]
    const out = sortByColumns(
      withImpact,
      [{ kind: 'metric', metric: 'impact' }, query('x')],
      matches({ x: ['c'] }),
    )
    expect(out.map((r) => r.oracleId)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the score order alone when every column is a metric', () => {
    // The ordinary case now, not an edge: a deck on `DEFAULT_COLUMNS` has two
    // columns and no sorting to do, and must get back the array it passed in
    // rather than a re-sorted copy of it.
    const items = rows('a', 'b', 'c')
    expect(
      sortByColumns(
        items,
        [
          { kind: 'metric', metric: 'impact' },
          { kind: 'metric', metric: 'efficiency' },
        ],
        new Map(),
      ),
    ).toBe(items)
  })
})

describe('a column sorts the suggestion feed', () => {
  const group = (key: string, label: string, ids: string[]): api.Group =>
    ({
      key,
      label,
      rationale: 'because',
      total: ids.length,
      items: ids.map((oracleId) => ({
        oracleId,
        score: 1,
        comboDegree: 0,
        nearCombosAt1: 0,
        completedCombos: [],
        combos: [],
        reasons: [],
      })),
    }) as api.Group

  /** The card names under one heading, in the order they are rendered. */
  const names = (container: HTMLElement, groupKey: string): string[] => {
    const groups = [...container.querySelectorAll('.group')]
    const wanted = groups.find((g) => g.querySelector(`[aria-controls="group-${groupKey}"]`))
    return [...(wanted?.querySelectorAll('.card-row .name') ?? [])].map((n) =>
      (n.firstChild?.textContent ?? '').trim(),
    )
  }

  const hydrated = (ids: string[]): api.Hydrated => ({
    cards: new Map([
      ['cmd', card({ oracleId: 'cmd', name: 'Krenko, Mob Boss' })],
      ...ids.map((id): [string, api.Card] => [id, card({ oracleId: id, name: id.toUpperCase() })]),
    ]),
    prices: new Map(),
    images: new Map(),
  })

  it('sorts the matches to the top of their group, and only within it', async () => {
    /*
     * Group order is doc 05 §5.3 and pillar P5: the groups are the app's
     * argument about what this deck needs, so a sort may reorder rows inside a
     * heading and may never move one between headings — nor reorder the
     * headings themselves.
     */
    mocked.getRecommendations.mockResolvedValue(
      recs({
        groups: [group('g1', 'First', ['a', 'b']), group('g2', 'Second', ['c', 'd'])],
        columns: [{ query: 'x', matched: ['b', 'd'] }],
      }),
    )
    mocked.hydrate.mockResolvedValue(hydrated(['a', 'b', 'c', 'd']))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await typeFilter('x')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })

    await waitFor(() => expect(names(container, 'g1')).toEqual(['B', 'A']))
    // The second group sorted too, and nothing crossed between them.
    expect(names(container, 'g2')).toEqual(['D', 'C'])
    // And the headings kept their own order.
    expect([...container.querySelectorAll('.group h3')].map((h) => h.textContent)).toEqual([
      'First',
      'Second',
    ])
  })

  it('numbers the chips so the reader can see which column wins', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({
        groups: [group('g1', 'First', ['a', 'b'])],
        columns: [
          { query: 'x', matched: ['b'] },
          { query: 'y', matched: ['a'] },
        ],
      }),
    )
    mocked.hydrate.mockResolvedValue(hydrated(['a', 'b']))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    for (const q of ['x', 'y']) {
      await typeFilter(q)
      await act(async () => {
        screen.getByLabelText(/Show this query as a column/).click()
      })
    }

    /*
     * Four chips — the two metric columns every deck starts with, plus these
     * two — and TWO rank badges. Only the columns that sort are numbered
     * (`ordersRows`), so `x` is still "sorts first" with the metrics on screen
     * beside it. Numbering all four would tell the builder that two columns
     * they never chose outrank the question they just asked.
     */
    await waitFor(() => expect(container.querySelectorAll('.column-chip')).toHaveLength(4))
    expect([...container.querySelectorAll('.column-rank')].map((r) => r.textContent)).toEqual([
      '1',
      '2',
    ])
    // In words as well, because a lone digit read aloud is not information.
    expect(screen.getByLabelText(/^Remove the x column . sorts first/)).toBeDefined()
    expect(screen.getByLabelText(/^Remove the y column . then by this/)).toBeDefined()
    // And a metric chip makes no claim about the order at all.
    expect(screen.getByLabelText(/^Remove the Impact column . a number on every row/)).toBeDefined()
  })

  it('refuses the same query twice — that would be two answers to "what sorts first"', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ groups: [group('g1', 'First', ['a'])], columns: [{ query: 'x', matched: [] }] }),
    )
    mocked.hydrate.mockResolvedValue(hydrated(['a']))
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await typeFilter('x')
    await act(async () => {
      screen.getByLabelText(/Show this query as a column/).click()
    })
    // Three: the two default metric columns, and the `x` just promoted.
    await waitFor(() => expect(container.querySelectorAll('.column-chip')).toHaveLength(3))

    await typeFilter('x')
    expect(
      (screen.getByLabelText(/Show this query as a column/) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

// --------------------------------------------------------- bar breakdowns

/**
 * Hovering a curve bar or a composition bar shows the cards it counts.
 *
 * The trap, and the only reason these are not trivial: the count in the bar and
 * the list under the cursor must agree. Two ways they can be made to disagree,
 * both of them the obvious implementation.
 */
describe('what is behind a bar', () => {
  const mountain = card({
    oracleId: 'mtn',
    name: 'Mountain',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Basic Land — Mountain',
    types: ['land'],
    primaryRole: 'land',
    colorIdentity: [],
  })
  /** A creature that ramps, so it counts under BOTH `role:ramp` and `type:creature`. */
  const ramper = card({
    oracleId: 'ram',
    name: 'Llanowar Elves',
    manaValue: 1,
    typeLine: 'Creature — Elf Druid',
    types: ['creature'],
    primaryRole: 'ramp',
  })
  const bolt = card({
    oracleId: 'bolt',
    name: 'Lightning Bolt',
    manaValue: 1,
    typeLine: 'Instant',
    types: ['instant'],
    primaryRole: 'removal',
  })

  const withDeck = (
    entries: { oracleId: string; zone: 'accepted' | 'excluded'; locked: boolean }[],
    all: api.Card[],
  ): api.Deck => {
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['cmd', card({ oracleId: 'cmd', name: 'Krenko, Mob Boss', manaValue: 4 })],
        ...all.map((c): [string, api.Card] => [c.oracleId, c]),
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)
    return { ...deck, entries }
  }

  /**
   * Open a hint by its trigger's accessible name and read ITS panel.
   *
   * Scoped to the trigger's own `.hint`, not the first `.hint-pop` in the
   * document: a click PINS the panel open, so opening a second one while the
   * first is still pinned leaves two on screen and a document-wide query
   * silently returns the wrong one.
   */
  const openHint = async (name: RegExp): Promise<string> => {
    const trigger = screen.getByLabelText(name)
    await act(async () => {
      trigger.click()
    })
    return trigger.closest('.hint')?.querySelector('.hint-pop')?.textContent ?? ''
  }

  it('counts thirty Mountains as thirty, because the bar counts copies', async () => {
    /*
     * THE MEASURED TRAP, INVERTED (ADR-0034).
     *
     * This test used to assert `land — 1 card` and a single Mountain, and it
     * was a faithful description of the app: `countComposition` iterated
     * `acceptedSet`, a `Set` of oracle ids, so thirty basics were one land on
     * every bar. That was the reported defect — "basic lands need to count
     * towards your land count" — so the OLD expectation was wrong about what
     * the product should do, not about what it did.
     *
     * The count is now copies at both ends. The commander is in it too, and is
     * a creature rather than a land, so the land bar reads exactly thirty.
     */
    const thirty = Array.from({ length: 30 }, () => ({
      oracleId: 'mtn',
      zone: 'accepted' as const,
      locked: false,
    }))
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [
        {
          dimension: { role: 'land' },
          ideal: 36,
          min: 34,
          max: 38,
          locked: 0,
          actual: 30,
          source: 'archetype',
        },
      ],
    })
    render(<Workspace deck={withDeck(thirty, [mountain])} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^land:/)).toBeDefined())

    const panel = await openHint(/^land:/)
    expect(panel).toMatch(/land — 30 cards/)
    // Grouped for display, so the panel is one line rather than thirty — but
    // the line says how many, and the heading above it counts all thirty.
    expect(panel).toMatch(/Mountain ×30/)
    expect(panel.match(/Mountain/g)).toHaveLength(1)
    // And the two numbers agree, so no caveat is printed. Before the grouping
    // landed this is where the regression would show: a bar of 30 over a list
    // of 1 prints "The bar counts 30", blaming cards that are fully loaded.
    expect(panel).not.toMatch(/The bar counts/)
  })

  it('names a single copy without a multiplier', async () => {
    // The ×N suffix is for repeats only; "Mountain ×1" would be noise on the
    // ninety-odd singleton rows that make up the rest of every Commander deck.
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [
        {
          dimension: { role: 'land' },
          ideal: 36,
          min: 34,
          max: 38,
          locked: 0,
          actual: 1,
          source: 'archetype',
        },
      ],
    })
    render(
      <Workspace
        deck={withDeck([{ oracleId: 'mtn', zone: 'accepted', locked: false }], [mountain])}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^land:/)).toBeDefined())

    const panel = await openHint(/^land:/)
    expect(panel).toMatch(/land — 1 card/)
    expect(panel).not.toMatch(/×/)
  })

  it('counts a creature that ramps under both its role and its type', async () => {
    // `dimensionKeysOf` yields a role key AND a type key per card, which is
    // exactly why it is imported from the domain rather than reimplemented.
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [
        {
          dimension: { role: 'ramp' },
          ideal: 10,
          min: 8,
          max: 12,
          locked: 0,
          actual: 1,
          source: 'archetype',
        },
        {
          dimension: { type: 'creature' },
          ideal: 30,
          min: 25,
          max: 35,
          locked: 0,
          actual: 1,
          source: 'archetype',
        },
      ],
    })
    render(
      <Workspace
        deck={withDeck([{ oracleId: 'ram', zone: 'accepted', locked: false }], [ramper])}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^ramp:/)).toBeDefined())

    expect(await openHint(/^ramp:/)).toMatch(/Llanowar Elves/)
    expect(await openHint(/^creature:/)).toMatch(/Llanowar Elves/)
  })

  it('shows the cards at a mana value, and never a land', async () => {
    // The curve is a count of SPELLS. A deck's lands would otherwise be the
    // tallest bar on it, at mana value 0.
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      curve: {
        ...analysis.curve,
        deltas: [
          {
            bucket: 1,
            actual: 2,
            ideal: 8,
            min: 6,
            max: 10,
            delta: 6,
            withinRange: false,
          },
          {
            bucket: 0,
            actual: 0,
            ideal: 2,
            min: 0,
            max: 4,
            delta: 2,
            withinRange: true,
          },
        ],
        target: [],
      },
    })
    render(
      <Workspace
        deck={withDeck(
          [
            { oracleId: 'ram', zone: 'accepted', locked: false },
            { oracleId: 'bolt', zone: 'accepted', locked: false },
            { oracleId: 'mtn', zone: 'accepted', locked: false },
          ],
          [ramper, bolt, mountain],
        )}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^Mana value 1:/)).toBeDefined())

    const one = await openHint(/^Mana value 1:/)
    expect(one).toMatch(/Mana value 1 — 2 cards/)
    expect(one).toMatch(/Lightning Bolt/)
    expect(one).toMatch(/Llanowar Elves/)

    const zero = await openHint(/^Mana value 0:/)
    // The Mountain is at mana value 0 and is a land, so it is in neither bar.
    expect(zero).not.toMatch(/Mountain/)
    expect(zero).toMatch(/Nothing here yet/)
  })

  it('says so, rather than lying, when the list and the bar cannot be made to agree', async () => {
    /*
     * The bar is the last analysis the SERVER computed; the list is the deck on
     * screen now. Between an accept and the recompute that follows, and for any
     * card this page has not hydrated, those are different numbers. The heading
     * always counts the list — the thing being looked at — and the caveat names
     * the other number and why it differs.
     */
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [
        {
          dimension: { role: 'land' },
          ideal: 36,
          min: 34,
          max: 38,
          locked: 0,
          // The server counted five; the client holds one.
          actual: 5,
          source: 'archetype',
        },
      ],
    })
    render(
      <Workspace
        deck={withDeck([{ oracleId: 'mtn', zone: 'accepted', locked: false }], [mountain])}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^land:/)).toBeDefined())

    const panel = await openHint(/^land:/)
    // The heading counts what is actually listed…
    expect(panel).toMatch(/land — 1 card/)
    // …and the difference is stated rather than hidden.
    expect(panel).toMatch(/The bar counts 5/)
  })

  it('is reachable by keyboard, and closes on Escape', async () => {
    // R4. The trigger is a real button, so focus opens the panel and Escape
    // dismisses a pinned one — the behaviour `Hint` already had for tag chips.
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [
        {
          dimension: { role: 'land' },
          ideal: 36,
          min: 34,
          max: 38,
          locked: 0,
          actual: 1,
          source: 'archetype',
        },
      ],
    })
    render(
      <Workspace
        deck={withDeck([{ oracleId: 'mtn', zone: 'accepted', locked: false }], [mountain])}
      />,
    )
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^land:/)).toBeDefined())
    const trigger = screen.getByLabelText(/^land:/) as HTMLButtonElement
    expect(trigger.tagName).toBe('BUTTON')

    await act(async () => {
      trigger.focus()
    })
    expect(document.querySelector('.hint-pop')).not.toBeNull()

    // Pinned by a click, then dismissed with Escape.
    await act(async () => {
      trigger.click()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      trigger.blur()
    })
    expect(document.querySelector('.hint-pop')).toBeNull()
  })
})

// ------------------------------------------------------------ colour pies

/**
 * The two mana colour pies under the composition bars.
 *
 * They answer different questions over the same accepted copies: what the deck
 * IS (colour identity, one bucket per card) and what it MAKES (produced mana,
 * one count per kind a card makes). The interesting assertions here are not "a
 * pie appears" — they are the ones about the SECOND ENCODING, because Magic's
 * own colours fail a categorical-palette check and are shipped anyway, and the
 * letters and counts are the entire reason that is defensible on a decision
 * surface; and the ones about each figure SAYING WHAT ITS SLICES SUM TO, which
 * is the difference between a pie and a decoration.
 */
describe('the mana colour pies', () => {
  const withBalance = (
    identity: Record<string, number>,
    generation: Record<string, number> = {},
    extra: { cards?: number; producers?: number } = {},
  ): void => {
    const full = { W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0, ...identity }
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      colorBalance: {
        identity: full,
        generation: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...generation },
        cards: extra.cards ?? Object.values(full).reduce((a, b) => a + b, 0),
        producers: extra.producers ?? 0,
      },
    })
  }

  const figures = (container: HTMLElement): Element[] => [
    ...container.querySelectorAll('.pie-figure'),
  ]

  it('draws two charts, titled for the two different questions', async () => {
    withBalance({ R: 12, C: 4 }, { R: 20, C: 2 }, { producers: 22 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    expect(figures(container)).toHaveLength(2)
    expect([...container.querySelectorAll('.pie-title')].map((t) => t.textContent)).toEqual([
      'Identity',
      'Generation',
    ])
  })

  it('gives colourless cards a slice in BOTH charts', async () => {
    /*
     * The reported bug, from both ends. The old pie had no `C` bucket at all —
     * its pip regex was `[WUBRG]` — so Sol Ring and Wastes were in the deck and
     * in neither figure.
     */
    withBalance({ R: 30, C: 20 }, { R: 12, C: 9 }, { producers: 21 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    const letters = figures(container).map((f) =>
      [...f.querySelectorAll('.pie-letter')].map((l) => l.textContent),
    )
    expect(letters[0]).toEqual(['R', 'C'])
    expect(letters[1]).toEqual(['R', 'C'])
  })

  it('draws a slice per bucket the deck actually has, and none for the rest', async () => {
    withBalance({ R: 12, G: 4 }, { R: 20 }, { producers: 20 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    // A bucket with no cards is not a zero-width wedge — it is absent.
    expect(figures(container)[0]?.querySelectorAll('path')).toHaveLength(2)
  })

  it('gives a multicolour card its own M slice rather than one per colour', async () => {
    /*
     * The design decision the whole identity chart rests on. Counting a gold
     * card once in each of its colours makes the slices total more than the
     * deck holds, and a pie whose area is not a share is a bar chart wearing
     * one. What it costs is stated on screen, in the caption below.
     */
    withBalance({ R: 40, M: 12, C: 20 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    const rows = [...(figures(container)[0]?.querySelectorAll('.pie-key li') ?? [])].map(
      (li) => li.textContent ?? '',
    )
    expect(rows).toEqual(['R40', 'M12', 'C20'])
    expect(screen.getByText(/is in/)).toBeDefined()
  })

  it('labels every slice with its letter and its count', async () => {
    /*
     * The non-negotiable part. `IDENTITY_COLORS` fails the palette check on
     * three counts (lightness band, chroma floor, protan separation) and is
     * shipped unchanged because a player's white pips have to look white. What
     * pays for that is this: read the letters and the chart works with no
     * colour vision at all — including the grey `C` against the pale gold `M`.
     */
    withBalance({ W: 3, U: 7 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    const rows = [...container.querySelectorAll('.pie-key li')].map((li) => li.textContent ?? '')
    expect(rows[0]).toMatch(/^W3/)
    expect(rows[1]).toMatch(/^U7/)
    expect(container.querySelectorAll('.pie-letter')).toHaveLength(2)
    expect(container.querySelectorAll('.pie-count')).toHaveLength(2)
  })

  it('separates adjacent wedges with an edge, not only a hue change', async () => {
    // The other half of the secondary encoding, and the one a protan reader
    // needs between #a274ae and #2f74c8 (measured ΔE 6.3).
    withBalance({ U: 5, B: 5 }, { U: 5, C: 5 }, { producers: 8 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    const paths = container.querySelectorAll('.pie path')
    expect(paths).toHaveLength(4)
    for (const path of paths) expect(path.getAttribute('stroke')).toBe('var(--ink)')
  })

  it('names every bucket and count in each accessible label, in words', async () => {
    // `role="img"` means the wedges are not read individually, so each figure
    // has to say what it shows — and "W 3" read aloud is two letters, while a
    // lone "C" is a letter that happens to be a whole category.
    withBalance({ W: 3, G: 9, C: 4 }, { G: 6, C: 5 }, { producers: 9 })
    render(<Workspace deck={deck} />)

    const identity = await screen.findByRole('img', { name: /Colour identity/ })
    expect(identity.getAttribute('aria-label')).toMatch(/white 3, green 9, colourless 4/)
    expect(identity.getAttribute('aria-label')).toMatch(/exactly one, 16 cards in total/)

    const generation = screen.getByRole('img', { name: /kind of mana/ })
    expect(generation.getAttribute('aria-label')).toMatch(/green 6, colourless 5/)
    expect(generation.getAttribute('aria-label')).toMatch(/over 9 cards/)
  })

  it('says what each chart sums to, and that the two totals are not the same', async () => {
    /*
     * Identity slices sum to the deck; generation slices sum to MORE, because
     * a dual is in two of them. A reader told neither would assume the second
     * number is a card count, which is the misreading that made "N lands" a
     * necessary hedge on the old chart.
     */
    withBalance({ R: 30, C: 10 }, { R: 20, U: 6, C: 4 }, { producers: 24 })
    render(<Workspace deck={deck} />)
    await screen.findByRole('img', { name: /Colour identity/ })

    expect(screen.getByText(/these add up to your 40 cards/)).toBeDefined()
    expect(screen.getByText(/these total 30 across 24 cards/)).toBeDefined()
  })

  it('says "1 card" and not "1" for a deck that is only its commander', async () => {
    // A real state — a commander chosen and nothing accepted yet — and the one
    // the bare number reads wrong in.
    withBalance({ M: 1 })
    render(<Workspace deck={deck} />)
    await screen.findByRole('img', { name: /Colour identity/ })

    expect(screen.getByText(/these add up to your 1 card\./)).toBeDefined()
  })

  it('draws a single-bucket chart as a whole circle, not a degenerate arc', async () => {
    // An arc of exactly 2π has the same start and end point, so the path
    // command draws nothing at all — a mono-red deck would get a blank square.
    withBalance({ R: 30 }, { R: 30 }, { producers: 30 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    expect(container.querySelectorAll('.pie path')).toHaveLength(0)
    expect(container.querySelectorAll('.pie circle')).toHaveLength(2)
  })

  it('says an empty deck is empty rather than drawing an empty circle', async () => {
    withBalance({}, {})
    render(<Workspace deck={deck} />)
    expect(await screen.findByText(/no colour identity to show/)).toBeDefined()
    expect(screen.getByText(/Nothing in the deck makes mana yet/)).toBeDefined()
  })

  it('draws a deck whose cards mostly make no mana without implying they are missing', async () => {
    /*
     * Most of a deck is spells, and a generation chart covering a quarter of the
     * cards is the normal case rather than an incomplete one. Its base is
     * `producers`, said out loud, so the reader is never left to assume the
     * chart is over the whole deck and that the rest went astray.
     */
    withBalance({ R: 30 }, { R: 8 }, { producers: 8 })
    render(<Workspace deck={deck} />)
    await screen.findByRole('img', { name: /Colour identity/ })

    expect(screen.getByText(/these total 8 across 8 cards/)).toBeDefined()
    expect(screen.queryByText(/missing/)).toBeNull()
  })

  it('renders nothing at all against a server that does not send the field', async () => {
    // The wire is not the type. A server from before API-02 sends no
    // `colorBalance`, and the panel must be absent rather than empty.
    mocked.getAnalysis.mockResolvedValue(analysis)
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    expect(container.querySelector('.pie')).toBeNull()
    expect(screen.queryByText('Mana colours')).toBeNull()
  })
})
