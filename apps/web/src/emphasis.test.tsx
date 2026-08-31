// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App, Workspace } from './App'

/**
 * Semantic emphasis, driven through the interface.
 *
 * The storage, the scoring and the endpoints shipped without a single `.tsx`
 * referencing any of it, so a builder could not add a focus at all. These tests
 * are the four halves of the request — click a semantic, be asked at commander
 * selection, see it above the commander, take it off again — asserted through
 * the controls a person actually uses rather than through the wire types.
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

const card = (over: Partial<api.Card> & { oracleId: string; name: string }): api.Card => ({
  manaCost: '{2}{B}',
  manaValue: 3,
  typeLine: 'Legendary Creature — Human',
  types: ['creature'],
  oracleText: '',
  colorIdentity: ['B'],
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

/** Tergrid, near enough: she causes opponents sacrificing and wants discard. */
const commander = card({
  oracleId: 'cmd',
  name: 'Tergrid, God of Fright',
  synergyProduces: ['opponent-sacrifice'],
  synergyWants: ['opponent-discard'],
})

const deck = (over: Partial<api.Deck> = {}): api.Deck => ({
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['cmd'],
  colorIdentity: ['B'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
  ...over,
})

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
 * A recommendations answer.
 *
 * `emphasis` is spelled out on the default rather than left to a spread,
 * because a fixture without it is the thing that broke a merge this week: the
 * field is required on the wire and every panel that reads it would then be
 * reading `undefined`.
 */
const recs = (over: Partial<api.Recommendations> = {}): api.Recommendations => ({
  datasetSnapshotId: null,
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
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['cmd', commander]]),
    prices: new Map([['cmd', 1.5]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...commander,
    printings: [],
    combos: [],
  } as unknown as api.CardDetail)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const focusPanel = (): HTMLElement => screen.getByRole('region', { name: 'Semantic focus' })

/**
 * Render and wait until the first recompute has been APPLIED.
 *
 * Not merely until the request went out: the emphasis report and the commander's
 * own semantics both arrive with that answer, and asserting before it lands
 * tests the loading state by accident.
 */
const mount = async (d: api.Deck = deck()): Promise<void> => {
  render(<Workspace deck={d} />)
  await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getAllByText('Tergrid, God of Fright').length).toBeGreaterThan(0),
  )
}

// ------------------------------------------------- the prompt at the start

describe('choosing a commander asks what the deck is about', () => {
  const type = async (text: string): Promise<void> => {
    const box = screen.getByLabelText('Commander') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const choose = async (c: api.Card = commander): Promise<void> => {
    mocked.searchCards.mockResolvedValue({ items: [c] })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Tergrid')
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await waitFor(() => expect(screen.getByText('Choose')).toBeDefined())
    await act(async () => {
      screen.getByText('Choose').click()
    })
  }

  it('does not ask before a commander is picked — there is nothing to offer yet', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    expect(screen.queryByText(/What is this deck about/i)).toBeNull()
  })

  it('offers the commander’s own semantics, both directions', async () => {
    await choose()
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
    expect(screen.getByLabelText('Emphasise opponents sacrificing')).toBeDefined()
    expect(screen.getByLabelText('Emphasise opponents discarding')).toBeDefined()
  })

  it('is a prompt and not a wall — creating with nothing chosen sends no emphasis', async () => {
    mocked.createDeck.mockResolvedValue(deck())
    await choose()
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())

    const start = screen.getByText('Start building') as HTMLButtonElement
    expect(start.disabled).toBe(false)
    await act(async () => {
      start.click()
    })
    await waitFor(() => expect(mocked.createDeck).toHaveBeenCalled())
    expect(mocked.createDeck.mock.calls[0]?.[0].semanticEmphasis).toBeUndefined()
  })

  it('sends what was picked with the create, so the first suggestions already know', async () => {
    mocked.createDeck.mockResolvedValue(deck({ semanticEmphasis: ['opponent-discard'] }))
    await choose()
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
    await act(async () => {
      screen.getByLabelText('Emphasise opponents discarding').click()
    })
    expect(
      screen.getByLabelText('Emphasise opponents discarding').getAttribute('aria-pressed'),
    ).toBe('true')

    await act(async () => {
      screen.getByText('Start building').click()
    })
    await waitFor(() => expect(mocked.createDeck).toHaveBeenCalled())
    expect(mocked.createDeck.mock.calls[0]?.[0].semanticEmphasis).toEqual(['opponent-discard'])
  })

  it('says so rather than showing an empty prompt for a commander with no tags', async () => {
    await choose(card({ oracleId: 'bare', name: 'Plain Legend' }))
    await waitFor(() => expect(screen.getByText(/No semantics derived/i)).toBeDefined())
  })

  it('drops the picks when the commander is changed — they were about that commander', async () => {
    await choose()
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
    await act(async () => {
      screen.getByLabelText('Emphasise opponents discarding').click()
    })

    // Typing a new name clears the choice, which puts the search results back.
    await type('Krenko')
    await waitFor(() => expect(screen.queryByText(/What is this deck about/i)).toBeNull())

    // Coming back to the SAME commander must find the prompt unanswered.
    // Asserting only that the prompt disappeared would pass even if the picks
    // had been kept, since the prompt is hidden while no commander is chosen.
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await waitFor(() => expect(screen.getByText('Choose')).toBeDefined())
    await act(async () => {
      screen.getByText('Choose').click()
    })
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
    expect(
      screen.getByLabelText('Emphasise opponents discarding').getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

// -------------------------------------------- the display above the commander

describe('the focus above the commander', () => {
  it('names each emphasised tag and how much of the pool supports it', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 42 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))

    const panel = focusPanel()
    expect(within(panel).getByText(/opponents discarding/)).toBeDefined()
    expect(within(panel).getByText(/42 cards support this/)).toBeDefined()
  })

  it('sits above the commander, which is what was asked for', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 3 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))

    const heading = screen.getByText('Commander')
    // DOCUMENT_POSITION_FOLLOWING (4) — the commander section comes after.
    expect(focusPanel().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('says in words that nothing supports a tag, rather than miming it', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'landfall', supporting: 0 }] }),
    )
    await mount(deck({ semanticEmphasis: ['landfall'] }))

    const panel = focusPanel()
    expect(within(panel).getByText(/Nothing in your colours supports this/i)).toBeDefined()
    // Not an error and not a failure: the suggestions are unchanged, not broken.
    expect(within(panel).queryByRole('alert')).toBeNull()
    expect(panel.querySelector('.problem')).toBeNull()
  })

  it('never claims to filter — emphasis reorders and hides nothing', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 9 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    expect(focusPanel().textContent).toMatch(/never hides|nothing is hidden|hides nothing/i)
  })

  it('has something to say to a deck with no focus, and a way in', async () => {
    await mount()
    const panel = focusPanel()
    expect(within(panel).getByText(/No focus yet/i)).toBeDefined()
    expect(within(panel).getByRole('button', { name: /Add a focus/i })).toBeDefined()
  })
})

// --------------------------------------------------------- de-emphasising

describe('taking a focus off again', () => {
  it('sends the same list one shorter, which is the whole protocol', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({
        emphasis: [
          { tag: 'opponent-discard', supporting: 42 },
          { tag: 'opponent-sacrifice', supporting: 7 },
        ],
      }),
    )
    mocked.patchDeck.mockResolvedValue(
      deck({ semanticEmphasis: ['opponent-sacrifice'], version: 2 }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard', 'opponent-sacrifice'] }))

    await act(async () => {
      within(focusPanel())
        .getByRole('button', { name: /Remove opponents discarding/i })
        .click()
    })

    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]).toEqual([
      'd1',
      { semanticEmphasis: ['opponent-sacrifice'] },
    ])
  })

  it('clears the focus entirely when the last tag comes off', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 42 }] }),
    )
    mocked.patchDeck.mockResolvedValue(deck({ semanticEmphasis: [], version: 2 }))
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))

    await act(async () => {
      within(focusPanel())
        .getByRole('button', { name: /Remove opponents discarding/i })
        .click()
    })

    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]?.[1]).toEqual({ semanticEmphasis: [] })
    await waitFor(() => expect(within(focusPanel()).getByText(/No focus yet/i)).toBeDefined())
  })
})

// ------------------------------------------------------------- reopening it

describe('the prompt can be reopened from the deck', () => {
  it('offers the commander’s semantics again to someone who skipped it', async () => {
    mocked.patchDeck.mockResolvedValue(deck({ semanticEmphasis: ['opponent-discard'], version: 2 }))
    await mount()

    await act(async () => {
      within(focusPanel())
        .getByRole('button', { name: /Add a focus/i })
        .click()
    })
    const panel = focusPanel()
    expect(within(panel).getByLabelText('Emphasise opponents discarding')).toBeDefined()

    await act(async () => {
      within(panel).getByLabelText('Emphasise opponents discarding').click()
    })
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]).toEqual([
      'd1',
      { semanticEmphasis: ['opponent-discard'] },
    ])
  })
})

// ---------------------------------------------------- clicking a tag chip

describe('a semantic in the card preview', () => {
  const openPreview = async (): Promise<void> => {
    await waitFor(() =>
      expect(screen.getByLabelText('Preview Tergrid, God of Fright')).toBeTruthy(),
    )
    await act(async () => screen.getByLabelText('Preview Tergrid, God of Fright').click())
    await waitFor(() => expect(screen.getByText('Semantics')).toBeTruthy())
  }

  it('does not steal the chip’s own click, which opens its explanation', async () => {
    await mount()
    await openPreview()

    const chip = screen.getByText('opponent discard')
    await act(async () => (chip.closest('button') as HTMLButtonElement).click())
    // The hint still opens, and no PATCH was sent by opening it.
    expect(screen.getByRole('tooltip').textContent).toContain('wants:opponent-discard')
    expect(mocked.patchDeck).not.toHaveBeenCalled()
  })

  it('emphasises from its own button beside the chip', async () => {
    mocked.patchDeck.mockResolvedValue(deck({ semanticEmphasis: ['opponent-discard'], version: 2 }))
    await mount()
    await openPreview()

    const pane = screen.getByRole('complementary')
    await act(async () => {
      within(pane).getByLabelText('Emphasise opponents discarding').click()
    })
    await waitFor(() => expect(mocked.patchDeck).toHaveBeenCalled())
    expect(mocked.patchDeck.mock.calls[0]).toEqual([
      'd1',
      { semanticEmphasis: ['opponent-discard'] },
    ])
  })

  it('is a real button with a pressed state, so a keyboard can work it (R4)', async () => {
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    await openPreview()

    const pane = screen.getByRole('complementary')
    const button = within(pane).getByLabelText('Emphasise opponents discarding')
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    const other = within(pane).getByLabelText('Emphasise opponents sacrificing')
    expect(other.getAttribute('aria-pressed')).toBe('false')
  })
})

// ------------------------------------------------------- when the save fails

describe('a save the server refuses', () => {
  it('leaves no chip claiming a focus the server does not have', async () => {
    mocked.patchDeck.mockRejectedValue(new Error('Request failed (500)'))
    await mount()

    await act(async () => {
      within(focusPanel())
        .getByRole('button', { name: /Add a focus/i })
        .click()
    })
    await act(async () => {
      within(focusPanel()).getByLabelText('Emphasise opponents discarding').click()
    })

    await waitFor(() => expect(screen.getByText(/Could not save/i)).toBeDefined())
    // The deck still has no focus, so the panel still says so.
    expect(within(focusPanel()).getByText(/No focus yet/i)).toBeDefined()
    expect(
      within(focusPanel())
        .getByLabelText('Emphasise opponents discarding')
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

// ------------------------------------------------ the reason says which claim

describe('a suggestion that rose because of the emphasis', () => {
  const withReason = (emphasised: boolean): api.Recommendations =>
    recs({
      emphasis: [{ tag: 'opponent-discard', supporting: 4 }],
      groups: [
        {
          key: 'high-synergy',
          label: 'High synergy',
          rationale: 'These work with what you have',
          total: 1,
          items: [
            {
              oracleId: 'x1',
              score: 0.9,
              comboDegree: 0,
              nearCombosAt1: 0,
              completedCombos: [],
              combos: [],
              reasons: [
                {
                  kind: 'keyword-synergy',
                  direction: 'payoff',
                  tag: 'opponent-discard',
                  ...(emphasised ? { emphasised: true } : {}),
                },
              ],
            },
          ],
        },
      ],
    })

  beforeEach(() => {
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['cmd', commander],
        ['x1', card({ oracleId: 'x1', name: 'Waste Not' })],
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)
  })

  it('says the emphasised claim, not the ordinary one', async () => {
    mocked.getRecommendations.mockResolvedValue(withReason(true))
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    await waitFor(() =>
      expect(screen.getByText('benefits from your emphasised opponent discard')).toBeDefined(),
    )
  })

  it('still says the ordinary one when the emphasis had nothing to do with it', async () => {
    mocked.getRecommendations.mockResolvedValue(withReason(false))
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    await waitFor(() =>
      expect(screen.getByText('benefits from your opponent discard')).toBeDefined(),
    )
  })
})

// ------------------------------------------- the guarantee has to reach the screen

/**
 * The focus guarantee, as far as the browser (ADR-0026).
 *
 * A guarantee the server keeps and the client then truncates away is not a
 * guarantee, and this client truncates twice: the workspace asks for
 * `limitPerGroup: 8` rather than the domain's default 60, and the three
 * `combo-N` groups are merged into one heading whose rows are then HALVED for
 * density. The first is fine — the domain applies the guarantee at whatever
 * limit it is given. The second is not, and is what these pin.
 */
describe('the focus guarantee on screen', () => {
  const comboItem = (oracleId: string, score: number, guaranteed: boolean) => ({
    oracleId,
    score,
    comboDegree: 1,
    nearCombosAt1: 0,
    completedCombos: [],
    combos: [],
    reasons: [
      {
        kind: 'keyword-synergy',
        direction: 'payoff' as const,
        tag: 'opponent-discard',
        emphasised: true,
        ...(guaranteed ? { guaranteed: true } : {}),
      },
    ],
  })

  /**
   * Six combo rows, the last of them there only because of the focus.
   *
   * Six is chosen so the halving BITES: `Math.ceil(6 / 2)` keeps three, and the
   * guaranteed row — lowest score, so last in the merged sort — is in the half
   * that would be thrown away. A fixture of two rows could not tell a fixed
   * merge from a broken one.
   */
  const merged = (): api.Recommendations =>
    recs({
      emphasis: [{ tag: 'opponent-discard', supporting: 196 }],
      groups: [
        {
          key: 'combo-1',
          label: 'Completes 1 combo',
          rationale: 'Finishes one combo',
          total: 6,
          items: [
            comboItem('c1', 0.9, false),
            comboItem('c2', 0.8, false),
            comboItem('c3', 0.7, false),
            comboItem('c4', 0.6, false),
            comboItem('c5', 0.5, false),
            comboItem('guaranteed', 0.1, true),
          ],
        },
      ],
    } as unknown as Partial<api.Recommendations>)

  beforeEach(() => {
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['cmd', commander],
        ...['c1', 'c2', 'c3', 'c4', 'c5'].map((id): [string, api.Card] => [
          id,
          card({ oracleId: id, name: `Filler ${id}` }),
        ]),
        ['guaranteed', card({ oracleId: 'guaranteed', name: 'Syphon Mind' })],
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)
  })

  it('survives the combo merge, which halves every other row away', async () => {
    mocked.getRecommendations.mockResolvedValue(merged())
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    // The halving still happens — this is a density decision about the merged
    // heading and the guarantee is not an excuse to undo it.
    await waitFor(() => expect(screen.queryByText('Filler c5')).toBeNull())
    // But the row the server promised the builder is still on the page.
    expect(screen.getByText('Syphon Mind')).toBeDefined()
  })

  it('says why it is there, rather than sitting at the bottom unexplained', async () => {
    mocked.getRecommendations.mockResolvedValue(merged())
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    await waitFor(() =>
      expect(screen.getByText(/top 3 here for your emphasised opponent discard/i)).toBeDefined(),
    )
  })
})

// ------------------------------------------------------ what the copy promises

describe('what the interface promises about a focus', () => {
  /*
   * The copy said emphasis "only reorders". It now also KEEPS the top three
   * supporters in every category, which is an addition rather than a
   * reordering, so the sentence had to change or it would be a promise the
   * server no longer keeps. What did NOT change is the half that matters:
   * nothing is ever hidden.
   */
  it('no longer claims a focus does nothing but reorder', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 196 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    expect(focusPanel().textContent).not.toMatch(/only reorders|reorders your suggestions/i)
  })

  it('says the top few supporters are kept in every category', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-discard', supporting: 196 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-discard'] }))
    expect(focusPanel().textContent).toMatch(/top three|top 3/i)
    expect(focusPanel().textContent).toMatch(/categor/i)
  })
})
