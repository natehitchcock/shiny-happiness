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
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['cmd', card({ oracleId: 'cmd', name: 'Krenko, Mob Boss' })],
        ['gob', goblin],
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)
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

  it('gives a metric column no opinion until its values exist', () => {
    // A seam, not a feature: `impact` and `efficiency` are being computed in
    // packages/domain. A column with no values must contribute NOTHING to the
    // order rather than inventing one, so the query column beside it decides.
    const out = sortByColumns(
      rows('a', 'b', 'c'),
      [{ kind: 'metric', metric: 'impact', label: 'Impact' }, query('x')],
      matches({ x: ['c'] }),
    )
    expect(out.map((r) => r.oracleId)).toEqual(['c', 'a', 'b'])
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

    await waitFor(() => expect(container.querySelectorAll('.column-chip')).toHaveLength(2))
    expect([...container.querySelectorAll('.column-rank')].map((r) => r.textContent)).toEqual([
      '1',
      '2',
    ])
    // In words as well, because a lone digit read aloud is not information.
    expect(screen.getByLabelText(/^Remove the x column . sorts first/)).toBeDefined()
    expect(screen.getByLabelText(/^Remove the y column . then by this/)).toBeDefined()
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
    await waitFor(() => expect(container.querySelectorAll('.column-chip')).toHaveLength(1))

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

  it('lists thirty Mountains once, because the bar counts them once', async () => {
    /*
     * THE MEASURED TRAP. `countComposition` iterates `acceptedSet(deck)`, which
     * is a `Set` of oracle ids — so thirty Mountains are one land as far as
     * every bar on this dashboard is concerned. A filter over the deck's
     * ENTRIES would put thirty rows under a bar reading 1.
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
          actual: 1,
          source: 'archetype',
        },
      ],
    })
    render(<Workspace deck={withDeck(thirty, [mountain])} />)
    await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/^land:/)).toBeDefined())

    const panel = await openHint(/^land:/)
    expect(panel).toMatch(/land — 1 card/)
    expect(panel.match(/Mountain/g)).toHaveLength(1)
    // And the two numbers agree, so no caveat is printed.
    expect(panel).not.toMatch(/The bar counts/)
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

// ------------------------------------------------------------- colour pie

/**
 * The mana colour pie under the composition bars.
 *
 * `analysis.colorBalance` has been on the wire since API-02 and nothing has
 * ever rendered it. The interesting assertions here are not "a pie appears" —
 * they are the ones about the SECOND ENCODING, because Magic's own five colours
 * fail a categorical-palette check and are shipped anyway, and the letters and
 * counts are the entire reason that is defensible on a decision surface.
 */
describe('the mana colour pie', () => {
  const withBalance = (
    pips: Record<string, number>,
    sources: Record<string, number> = {},
  ): void => {
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      colorBalance: {
        pips: { W: 0, U: 0, B: 0, R: 0, G: 0, ...pips },
        sources: { W: 0, U: 0, B: 0, R: 0, G: 0, ...sources },
      },
    })
  }

  it('draws a slice per colour the deck actually asks for, and none for the rest', async () => {
    withBalance({ R: 12, G: 4 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    expect(container.querySelectorAll('.pie path')).toHaveLength(2)
    // A colour with no pips is not a zero-width wedge — it is absent.
    expect([...container.querySelectorAll('.pie-letter')].map((l) => l.textContent)).toEqual([
      'R',
      'G',
    ])
  })

  it('labels every slice with its letter and its count', async () => {
    /*
     * The non-negotiable part. `IDENTITY_COLORS` fails the palette check on
     * three counts (lightness band, chroma floor, protan separation) and is
     * shipped unchanged because a player's white pips have to look white. What
     * pays for that is this: read the letters and the chart works with no
     * colour vision at all.
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
    withBalance({ U: 5, B: 5 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    for (const path of container.querySelectorAll('.pie path')) {
      expect(path.getAttribute('stroke')).toBe('var(--ink)')
    }
  })

  it('names every colour and count in the accessible label, in words', async () => {
    // `role="img"` means the wedges are not read individually, so the whole
    // figure has to say what it shows — and "W 3" read aloud is two letters.
    withBalance({ W: 3, G: 9 })
    render(<Workspace deck={deck} />)
    const figure = await screen.findByRole('img', { name: /Coloured mana symbols/ })
    expect(figure.getAttribute('aria-label')).toMatch(/white 3, green 9/)
    expect(figure.getAttribute('aria-label')).toMatch(/12 symbols in total/)
  })

  it('draws a mono-colour deck as a whole circle, not a degenerate arc', async () => {
    // An arc of exactly 2π has the same start and end point, so the path
    // command draws nothing at all — a mono-red deck would get a blank square.
    withBalance({ R: 30 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    expect(container.querySelectorAll('.pie path')).toHaveLength(0)
    expect(container.querySelectorAll('.pie circle')).toHaveLength(1)
  })

  it('says a colourless deck is colourless rather than drawing an empty circle', async () => {
    withBalance({})
    render(<Workspace deck={deck} />)
    expect(await screen.findByText(/No coloured mana symbols yet/)).toBeDefined()
  })

  it('calls the land figure what it is — distinct lands, not sources', async () => {
    /*
     * `colorBalance.sources` is counted over `acceptedSet`, a Set of oracle
     * ids, so ten Mountains are ONE land. Calling that "sources" would be a
     * wrong answer to the question a builder is actually asking about their
     * mana base; naming it precisely makes it a right answer to a narrower one.
     */
    withBalance({ R: 20 }, { R: 4 })
    const { container } = render(<Workspace deck={deck} />)
    await waitFor(() => expect(container.querySelector('.pie')).not.toBeNull())

    expect(container.querySelector('.pie-sources')?.textContent).toBe('4 lands')
    expect(screen.getByText(/A repeated basic counts once/)).toBeDefined()
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
