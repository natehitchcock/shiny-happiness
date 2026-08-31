// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { rejectionNotice, Workspace } from './App'

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
