// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Card names as links, from the wire to the screen.
 *
 * The matcher is tested in `@roundtable/domain` and the rendering in
 * `@roundtable/ui`; every one of those tests would pass on a day when the app
 * never handed a `references` payload to `OracleText` at all. These are the
 * wiring tests, plus the Back trail, which exists nowhere else.
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
  createDeck: vi.fn(),
  getDeck: vi.fn(),
  listDecks: vi.fn(),
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

/*
 * Real oracle text, in the exact templating the matcher is anchored on.
 *
 * `Kher Keep` creates a token named after a real card, which is the shape the
 * corpus audit found most often; `Bubbling Cauldron` names a card in a cost.
 * Both were copied from the card table rather than invented, because text that
 * "looks like" oracle text is precisely what a matcher agrees with wrongly.
 */
const KHER_KEEP_TEXT = '{T}: Add {C}.\n{3}{R}, {T}: Create a 0/1 red Kobold creature token named Kobolds of Kher Keep.'
const CAULDRON_TEXT =
  '{2}, {T}, Sacrifice a creature: You gain 4 life.\n{1}, {T}, Sacrifice a creature named Festering Newt: Each opponent loses 4 life.'

const base = (over: Partial<api.Card>): api.Card => ({
  oracleId: 'x',
  name: 'x',
  manaCost: '{1}',
  manaValue: 1,
  typeLine: 'Artifact',
  types: ['artifact'],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: [],
  primaryRole: 'ramp',
  edhrecRank: 1,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

const KHER = base({ oracleId: 'kher', name: 'Kher Keep', typeLine: 'Land', oracleText: KHER_KEEP_TEXT })
const KOBOLDS = base({
  oracleId: 'kobolds',
  name: 'Kobolds of Kher Keep',
  typeLine: 'Creature — Kobold',
  oracleText: '',
})
const CAULDRON = base({ oracleId: 'cauldron', name: 'Bubbling Cauldron', oracleText: CAULDRON_TEXT })
const NEWT = base({ oracleId: 'newt', name: 'Festering Newt', typeLine: 'Creature — Salamander' })
/**
 * A card that names ITSELF after an anchor — real text, and the only shape in
 * which self-exclusion can be observed at all.
 *
 * `Kher Keep` says "Kher Keep" only inside the longer token name "Kobolds of
 * Kher Keep", which is never at an anchor, so it cannot tell a working
 * self-check from an absent one.
 */
const SKOA = base({
  oracleId: 'skoa',
  name: 'Skoa, Embermage',
  typeLine: 'Legendary Creature — Human Wizard',
  oracleText: 'Sacrifice another card named Skoa, Embermage: Skoa deals 2 damage to any target.',
})

const deck: api.Deck = {
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
  entries: [
    { oracleId: 'kher', zone: 'accepted', locked: false },
    { oracleId: 'cauldron', zone: 'accepted', locked: false },
  ],
}

/** The same deck, holding the card that names itself. */
const skoaDeck: api.Deck = {
  ...deck,
  entries: [
    { oracleId: 'skoa', zone: 'accepted', locked: false },
    { oracleId: 'cauldron', zone: 'accepted', locked: false },
  ],
}

/** Card detail as the route now sends it, with the references it resolved. */
const detailFor = (card: api.Card, references: { name: string; oracleId: string }[]): api.CardDetail =>
  ({ ...card, printings: [], combos: [], references }) as unknown as api.CardDetail

const DETAILS: Record<string, api.CardDetail> = {
  kher: detailFor(KHER, [{ name: 'Kobolds of Kher Keep', oracleId: 'kobolds' }]),
  kobolds: detailFor(KOBOLDS, []),
  cauldron: detailFor(CAULDRON, [{ name: 'Festering Newt', oracleId: 'newt' }]),
  newt: detailFor(NEWT, []),
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 2, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 1,
      histogram: [0, 2, 0, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 2, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      ['kher', KHER],
      ['cauldron', CAULDRON],
    ]),
    prices: new Map(),
    images: new Map(),
  })
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockImplementation((id: string) =>
    Promise.resolve(DETAILS[id] ?? detailFor(base({ oracleId: id, name: id }), [])),
  )
})

afterEach(cleanup)

const openPreview = async (name: string): Promise<HTMLElement> => {
  await waitFor(() => expect(screen.getByLabelText(`Preview ${name}`)).toBeTruthy())
  await act(async () => screen.getByLabelText(`Preview ${name}`).click())
  return await screen.findByLabelText(`${name} details`)
}

/** Follow a card name inside the panel and wait for the panel to become it. */
const follow = async (name: string): Promise<HTMLElement> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }))
  })
  return await screen.findByLabelText(`${name} details`)
}

describe('a card named in oracle text', () => {
  it('is a control that says what it opens', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' })).toBeTruthy(),
    )
  })

  it('switches the detail pane to that card', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))

    const panel = await follow('Kobolds of Kher Keep')

    expect(panel).toBeTruthy()
    expect(screen.queryByLabelText('Kher Keep details')).toBeNull()
  })

  /*
   * The self-reference rule, end to end. "Kher Keep" occurs inside the token
   * name "Kobolds of Kher Keep" on this very card, and a matcher that linked it
   * would offer the reader a link back to the card they are already reading.
   */
  it('does not link the card to itself', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')

    expect(screen.queryByRole('button', { name: 'Open Kher Keep' })).toBeNull()
  })

  it('still refuses a self-reference the server wrongly sent', async () => {
    /*
     * Defence in depth, and not a redundant one.
     *
     * The route already drops self-references, so the test above passes even
     * with the client's own check removed — it passes because the name never
     * arrives, not because the panel refused it. This sends the bad payload on
     * purpose: `Kher Keep` names itself inside the token name "Kobolds of Kher
     * Keep", and a link there reopens the card the reader is already on.
     */
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['skoa', SKOA],
        ['cauldron', CAULDRON],
      ]),
      prices: new Map(),
      images: new Map(),
    })
    mocked.getCardDetail.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'skoa'
          ? detailFor(SKOA, [{ name: 'Skoa, Embermage', oracleId: 'skoa' }])
          : (DETAILS[id] ?? detailFor(base({ oracleId: id, name: id }), [])),
      ),
    )
    render(<Workspace deck={skoaDeck} />)
    const panel = await openPreview('Skoa, Embermage')

    // The text is on screen…
    expect(panel.querySelector('.oracle')?.textContent).toContain('named Skoa, Embermage')
    // …and none of it is a link back to the card being read.
    expect(screen.queryByRole('button', { name: 'Open Skoa, Embermage' })).toBeNull()
  })

  it('leaves the rules text itself intact', async () => {
    render(<Workspace deck={deck} />)
    const panel = await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))

    expect(panel.querySelector('.oracle')?.textContent).toContain(
      'Create a 0/1 red Kobold creature token named Kobolds of Kher Keep.',
    )
  })

  it('draws no links for a card whose text names nothing', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')

    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
  })
})

describe('getting back', () => {
  it('offers no way back from a card opened straight from the deck', async () => {
    // Back is not a second Close. The list that opened this card is still on
    // screen and is already the way back to it.
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')

    expect(screen.getByRole('button', { name: 'Back — nothing to go back to' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('names the card it returns to, not just "Back" (R4)', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')

    expect(screen.getByRole('button', { name: 'Back to Kher Keep' })).toBeTruthy()
  })

  it('returns to the card whose text sent the reader here', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to Kher Keep' }))
    })

    expect(await screen.findByLabelText('Kher Keep details')).toBeTruthy()
  })

  it('runs out rather than closing the panel', async () => {
    // A Back that closes the pane is a trap: the reader asked for the previous
    // card and lost the panel instead.
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to Kher Keep' }))
    })

    expect(screen.getByLabelText('Kher Keep details')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back — nothing to go back to' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('hands focus to Close before Back disables itself under the caret', async () => {
    /*
     * A control disabled while it holds focus drops focus to `<body>`, and on
     * the sheet layout the next Tab then restarts from the masthead. The tour
     * work hit this same class of bug earlier today.
     */
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')

    const back = screen.getByRole('button', { name: 'Back to Kher Keep' })
    back.focus()
    await act(async () => {
      fireEvent.click(back)
    })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preview' }))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('forgets the trail when a card is opened from a list again', async () => {
    // The trail belongs to the panel. A live Back on a freshly opened card would
    // point at something the reader was reading before they closed the last one.
    render(<Workspace deck={deck} />)
    await openPreview('Kher Keep')
    await waitFor(() => screen.getByRole('button', { name: 'Open Kobolds of Kher Keep' }))
    await follow('Kobolds of Kher Keep')

    await act(async () => screen.getByLabelText('Preview Bubbling Cauldron').click())
    await screen.findByLabelText('Bubbling Cauldron details')

    expect(screen.getByRole('button', { name: 'Back — nothing to go back to' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('walks back through a chain of references one card at a time', async () => {
    render(<Workspace deck={deck} />)
    await openPreview('Bubbling Cauldron')
    await waitFor(() => screen.getByRole('button', { name: 'Open Festering Newt' }))
    await follow('Festering Newt')

    expect(screen.getByRole('button', { name: 'Back to Bubbling Cauldron' })).toBeTruthy()
  })
})

describe('a combo piece named in a suggestion row', () => {
  /*
   * The full-row hit area is a CSS mechanism — a stretched `::after` on
   * `.name.as-link` covering the row, with sibling cells lifted to `z-index: 1`
   * so they stay clickable. jsdom has no layout and cannot hit-test a
   * pseudo-element, so whether a click on empty row space reaches the name is
   * checked in a real browser, not here.
   *
   * What IS checkable here is the part that adding controls to a row actually
   * breaks: the row's own click handler ignores anything inside a `.hint`, so a
   * combo-piece link must open ITS card and not the row's.
   */
  const withCombo = (): api.Recommendations =>
    ({
      datasetSnapshotId: null,
      columns: [],
      unavailable: [],
      query: { matched: 1, errors: [] },
      groups: [
        {
          key: 'g1',
          label: 'Suggestions',
          rationale: '',
          total: 1,
          items: [
            {
              oracleId: 'newt',
              score: 1,
              comboDegree: 1,
              nearCombosAt1: 0,
              completedCombos: ['c1'],
              combos: [{ id: 'c1', pieces: ['newt', 'cauldron'], produces: ['infinite life loss'] }],
              reasons: [{ kind: 'completes-combos', count: 1 }],
            },
          ],
        },
      ],
    }) as unknown as api.Recommendations

  beforeEach(() => {
    mocked.getRecommendations.mockResolvedValue(withCombo())
    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        ['kher', KHER],
        ['cauldron', CAULDRON],
        ['newt', NEWT],
      ]),
      prices: new Map(),
      images: new Map(),
    })
  })

  /** Pin the combo hint on the suggestion row open — its content is lazy. */
  const openComboHint = async (): Promise<HTMLElement> => {
    await waitFor(() => expect(screen.getByLabelText(/Completes 1 combos/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Completes 1 combos/))
    })
    const piece = screen
      .getAllByLabelText('Preview Bubbling Cauldron')
      .find((el) => el.closest('.hint') !== null)
    if (piece === undefined) throw new Error('no combo piece control inside the hint')
    return piece
  }

  it('is a control that says which card it previews', async () => {
    render(<Workspace deck={deck} />)

    expect(await openComboHint()).toBeTruthy()
  })

  it('opens the piece it names, not the row it sits in', async () => {
    render(<Workspace deck={deck} />)
    const piece = await openComboHint()

    await act(async () => {
      fireEvent.click(piece)
    })

    expect(await screen.findByLabelText('Bubbling Cauldron details')).toBeTruthy()
    expect(screen.queryByLabelText('Festering Newt details')).toBeNull()
  })
})
