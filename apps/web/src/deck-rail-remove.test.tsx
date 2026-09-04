// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Taking a card out of your own deck is not a judgement about the card
 * (ADR-0051, ADR-0012).
 *
 * The rail had ONE control, labelled "Remove", and it sent `exclude` — which
 * takes every copy AND bans the card under pillar P6. A playtest took five
 * lands out of a five-colour deck, and `fills-land` then returned zero
 * candidates because the recommender may not put back what it believes the
 * user threw out. The word on the button was the mild one and the command
 * behind it was the permanent one.
 *
 * The domain has had the right verb since ADR-0012 — `remove`, "one copy, and
 * nothing recorded" — and the deck rail was the one surface that never issued
 * it. Everything here is about the two intentions being two controls.
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

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  typeLine: 'Instant',
  types: ['instant'],
  colors: ['R'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'spot-removal',
  edhrecRank: null,
  universesBeyond: false,
  power: null,
  toughness: null,
  loyalty: null,
  synergyProduces: [],
  synergyWants: [],
})

const deck = (entries: api.Deck['entries']): api.Deck =>
  ({
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
    targetOverrides: {},
    entries,
  }) as unknown as api.Deck

const oneOf = deck([{ oracleId: 'bolt', zone: 'accepted', locked: false }])

/** Two copies of one card, which is what ADR-0012's "an amount" is about. */
const twoOf = deck([
  { oracleId: 'bolt', zone: 'accepted', locked: false },
  { oracleId: 'bolt', zone: 'accepted', locked: false },
])

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 1, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
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
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['bolt', card('bolt', 'Lightning Bolt')]]),
    prices: new Map([['bolt', 1]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  // Never resolves: the assertions here are about what went ON the wire, and a
  // resolved apply would clear `pending` and take the optimistic view with it.
  mocked.sendCommands.mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.sendCommands>)
})

afterEach(cleanup)

const open = async (d: api.Deck = oneOf): Promise<void> => {
  render(<Workspace deck={d} />)
  await waitFor(() => expect(screen.getByLabelText('Preview Lightning Bolt')).toBeTruthy())
}

const press = async (label: RegExp | string): Promise<void> => {
  const button = screen.getByLabelText(label)
  await act(async () => {
    button.click()
  })
}

/**
 * Every command type the client actually put on the wire, in order.
 *
 * The wire is the point. The optimistic view removes the row either way, so a
 * DOM assertion alone cannot tell `remove` from `exclude` — and `exclude` is
 * what wrote `zone: 'excluded'` to the database and banned the card.
 */
const sentTypes = async (): Promise<string[]> => {
  await waitFor(() => expect(mocked.sendCommands).toHaveBeenCalled(), { timeout: 4000 })
  const commands = mocked.sendCommands.mock.calls[0]?.[1] as readonly { type: string }[]
  return commands.map((c) => c.type)
}

/** The Rejected section, or null when nothing is in it. */
const rejectedSection = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('.deck-section')].find((s) =>
    /^Rejected/.test(s.querySelector('h3')?.textContent ?? ''),
  ) ?? null

describe('the deck rail — remove is not reject (ADR-0051)', () => {
  it('sends `remove`, not `exclude`, when a card is taken out of the deck', async () => {
    // The defect, stated as the wire. `exclude` here is what banned five lands
    // and emptied `fills-land`.
    await open()
    await press(/^Remove Lightning Bolt/)
    expect(await sentTypes()).toEqual(['remove'])
  })

  it('leaves the card suggestible — nothing lands in the Rejected list', async () => {
    // The user-visible half of the same fact, and the one the playtest saw:
    // there was no way back because the card had been filed as a rejection.
    await open()
    await press(/^Remove Lightning Bolt/)
    expect(rejectedSection()).toBeNull()
  })

  it('takes ONE copy, so a two-copy line becomes a one-copy line', async () => {
    // ADR-0012's own example, one surface along: taking 34 Mountains to 33 must
    // not delete all 34. `exclude` took every copy.
    await open(twoOf)
    expect(screen.getByText('2×')).toBeTruthy()
    await press(/^Remove one copy of Lightning Bolt/)
    expect(screen.queryByText('2×')).toBeNull()
    expect(screen.getByLabelText('Preview Lightning Bolt')).toBeTruthy()
    expect(await sentTypes()).toEqual(['remove'])
  })

  it('offers a separate control for the permanent judgement', async () => {
    // Both actions are legitimate and they are DIFFERENT actions, so they are
    // two controls. One control cannot mean both without lying about one.
    await open()
    await press(/^Never suggest Lightning Bolt again/)
    expect(await sentTypes()).toEqual(['exclude'])
  })

  it('puts the rejected card in the Rejected list', async () => {
    await open()
    await press(/^Never suggest Lightning Bolt again/)
    const rejected = rejectedSection()
    expect(rejected).not.toBeNull()
    expect(within(rejected!).getByText('Lightning Bolt')).toBeTruthy()
  })

  it('has a way back out of the Rejected list, and it predates this change', async () => {
    // Checked before building one: the "Rejected" section already carried two
    // routes back, and they are DIFFERENT intentions — "let me see it again"
    // (`restore`) and "I was wrong, put it in" (`restore` then `accept`).
    // Nothing here is new. It is pinned because the wrongly-excluded cards
    // already in real decks can only be undone by hand, through these.
    await open(deck([{ oracleId: 'bolt', zone: 'excluded', locked: false }]))
    const rejected = rejectedSection()
    expect(rejected).not.toBeNull()
    expect(within(rejected!).getByLabelText(/^Suggest Lightning Bolt again/)).toBeTruthy()
    expect(within(rejected!).getByLabelText(/^Add Lightning Bolt to the deck/)).toBeTruthy()
  })

  it('says where a rejected card went, because the way back is below the fold', async () => {
    // A Restore path already existed and the playtest could not find it: it is
    // the last section of a rail that is a hundred rows long. Naming it at the
    // moment of the click is what makes it reachable.
    await open()
    await press(/^Never suggest Lightning Bolt again/)
    expect(screen.getByText(/Rejected list/)).toBeTruthy()
  })

  it('gives the two controls distinct names and both are real buttons (R4)', async () => {
    await open()
    const remove = screen.getByLabelText(/^Remove Lightning Bolt/)
    const reject = screen.getByLabelText(/^Never suggest Lightning Bolt again/)
    expect(remove.tagName).toBe('BUTTON')
    expect(reject.tagName).toBe('BUTTON')
    expect(remove.getAttribute('aria-label')).not.toBe(reject.getAttribute('aria-label'))
    // The visible words have to differ too: an identical label read by eye is
    // the defect this whole change is about.
    expect(remove.textContent).not.toBe(reject.textContent)
  })

  it('leaves the commander with neither control', async () => {
    // A commander is accepted by definition and the domain rejects both verbs
    // on one; offering the buttons would be offering a guaranteed refusal.
    const withCommander = deck([{ oracleId: 'bolt', zone: 'accepted', locked: false }])
    ;(withCommander as { commanders: string[] }).commanders = ['cmd']
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['bolt', card('bolt', 'Lightning Bolt')],
        ['cmd', card('cmd', 'Najeela')],
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)
    await open(withCommander)
    expect(screen.queryByLabelText(/^Remove Najeela/)).toBeNull()
    expect(screen.queryByLabelText(/^Never suggest Najeela again/)).toBeNull()
  })
})
