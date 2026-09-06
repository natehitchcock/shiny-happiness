// @vitest-environment jsdom
import { SEMANTIC_OFFER_SAMPLE } from '@roundtable/domain'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App } from './App'

/**
 * The two ways into a deck that are not typing a name (ADR-0067).
 *
 * The start screen had one door and it only opens for someone who already knows
 * the answer: a search box that matches a commander's name. These are the other
 * two — start from what the deck is ABOUT, or take three at random — and this
 * file is about both of them BESIDE the search, never instead of it.
 *
 * ## How a test of a random feature is deterministic
 *
 * By pinning the entropy, not the sampler. Both routes take exactly one piece
 * of randomness — a `crypto.randomUUID()` at the click — and everything after it
 * is a pure function of that string. So these tests replace `randomUUID` with a
 * counter and then run the REAL seeded sampler over the REAL offers: a fixed
 * seed gives a fixed eight, and the next seed gives a different eight, and
 * neither fact is arranged by a stub standing in for the code under test.
 *
 * `ORDER BY random()` on the server could not be tested this way, which is why
 * it is not what was built.
 */
vi.mock('./api', () => ({
  searchCards: vi.fn(),
  commanderSemantics: vi.fn(),
  commandersBySemantics: vi.fn(),
  quickdrawCommanders: vi.fn(),
  createDeck: vi.fn(),
  getDeck: vi.fn(),
  listDecks: vi.fn(),
  getRecommendations: vi.fn(),
  getAnalysis: vi.fn(),
  hydrate: vi.fn(),
  basicLands: vi.fn(),
  sendCommands: vi.fn(),
  patchDeck: vi.fn(),
  importPreview: vi.fn(),
  getCardDetail: vi.fn(),
}))

const mocked = vi.mocked(api)

/**
 * The one source of randomness in either route, made countable.
 *
 * NOT a stub of the sampler. The sampler is the domain's `sampleWithSeed` and
 * runs for real below; this only decides which seeds it is handed, which is
 * exactly what a click decides in production.
 */
let seeds = 0
const nextSeed = (): `${string}-${string}-${string}-${string}-${string}` => {
  seeds += 1
  return `00000000-0000-4000-8000-${String(seeds).padStart(12, '0')}`
}

const card = (name: string, over: Partial<api.Card> = {}): api.Card => ({
  oracleId: `o-${name}`,
  name,
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Legendary Creature — Goblin',
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
  ...over,
})

const offer = (
  tag: string,
  category: api.SemanticOffer['category'] = 'mechanics',
): api.SemanticOffer => ({ tag, category, commanders: 40, supporting: 400 })

/**
 * Twelve offers, so a draw of eight is a real subset and a redraw has somewhere
 * to move to.
 */
const OFFERS: api.SemanticOffer[] = [
  offer('landfall'),
  offer('treasure'),
  offer('token'),
  offer('creature-death'),
  offer('sacrifice-fodder'),
  offer('lifegain'),
  offer('card-draw'),
  offer('graveyard-creature'),
  offer('opponent-discard'),
  offer('counter-plus'),
  offer('subtype:elf', 'type'),
  offer('ability:flying', 'keyword'),
]

const KRENKO = card('Krenko, Mob Boss', {
  oracleText: '{T}: Create X 1/1 red Goblin creature tokens.',
  synergyProduces: ['token'],
})
const LATHRIL = card('Lathril, Blade of the Elves', {
  synergyProduces: ['token'],
  synergyWants: ['creature-death'],
})
const STRANGER = card('Nobody Has Heard Of Me')

/**
 * A card's detail, as the preview asks for it.
 *
 * `combos` defaults to a TWO-CARD combo on purpose. That is the shape that
 * makes `Works` speak with an empty deck — a combo missing exactly one piece
 * is the "one card away" branch — and the empty-deck test below is the reason
 * this fixture is not the convenient empty one.
 */
const detailOf = (c: api.Card, over: Partial<api.CardDetail> = {}): api.CardDetail => ({
  ...c,
  printings: [
    {
      printingId: `p-${c.oracleId}`,
      setCode: 'cmr',
      setName: 'Commander Legends',
      rarity: 'rare',
      priceUsd: 1.5,
    },
  ],
  combos: [
    {
      id: `combo-${c.oracleId}`,
      pieces: [
        { oracleId: c.oracleId, name: c.name },
        { oracleId: 'o-Thornbite Staff', name: 'Thornbite Staff' },
      ],
      produces: ['infinite tokens'],
    },
  ],
  references: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  seeds = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(nextSeed)

  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.commanderSemantics.mockResolvedValue({ offers: OFFERS })
  mocked.commandersBySemantics.mockResolvedValue({ items: [], matches: {}, total: 0 })
  mocked.quickdrawCommanders.mockResolvedValue({
    items: [KRENKO, LATHRIL, STRANGER],
    wildcard: STRANGER.oracleId,
    seed: 'x',
  })
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockRejectedValue(new Error('not needed here'))
  mocked.hydrate.mockResolvedValue({ cards: new Map(), prices: new Map(), images: new Map() })
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockImplementation((oracleId: string) => {
    const known = [KRENKO, LATHRIL, STRANGER].find((c) => c.oracleId === oracleId)
    return Promise.resolve(detailOf(known ?? card(oracleId)))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SEMANTICS = 'Or start from what the deck is about'
const QUICKDRAW = 'Or deal three at random'

/**
 * How many the route offers at once, from the domain rather than from a literal.
 *
 * The number is a product decision that has already moved once (eight, then
 * three), and a test file that spells it out is a second place to change it —
 * which is how a suite comes to assert the old number in one file and the new
 * one in another.
 */
const SAMPLE = SEMANTIC_OFFER_SAMPLE

const show = async (): Promise<void> => {
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
}

const region = (name: string): HTMLElement => screen.getByRole('region', { name })

/** The offered chips, by the words on them, in the order they are rendered. */
const chips = (): string[] =>
  within(region(SEMANTICS))
    .getAllByRole('button', { pressed: false })
    .map((b) => b.textContent?.replace(/^[✦✧]\s*/, '').trim() ?? '')

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => {
    element.click()
  })
}

describe('both routes sit beside the commander search, not instead of it', () => {
  it('still offers the name search that was the only way in', async () => {
    await show()
    expect(screen.getByLabelText('Commander')).toBeDefined()
    expect(screen.getByPlaceholderText(/Search cards that can lead a deck/)).toBeDefined()
  })

  it('offers all three ways at once, with the search first', async () => {
    await show()
    const html = document.body.innerHTML
    expect(html.indexOf('Commander')).toBeLessThan(html.indexOf(SEMANTICS))
    expect(html.indexOf(SEMANTICS)).toBeLessThan(html.indexOf(QUICKDRAW))
  })

  it('puts both routes away once a commander is settled', async () => {
    // The question they answer has been answered. Leaving them up would offer
    // to replace a choice the screen below is already explaining.
    mocked.searchCards.mockResolvedValue({ items: [KRENKO] })
    await show()
    await click(screen.getByLabelText('Choose Krenko, Mob Boss'))

    expect(screen.queryByRole('region', { name: SEMANTICS })).toBeNull()
    expect(screen.queryByRole('region', { name: QUICKDRAW })).toBeNull()
    expect(screen.getByText(/Building around/)).toBeDefined()
  })
})

describe('route 1 — start from what the deck is about', () => {
  it('offers eight of the qualifying semantics, not all of them', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    // Drawn from the twelve the server sent, and every one of them a real offer.
    for (const shown of chips()) expect(shown.length).toBeGreaterThan(0)
  })

  it('draws the same eight from the same seed, and different eight on a redraw', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    const first = chips()

    await click(screen.getByText('Show me eight others'))
    const second = chips()

    expect(second).toHaveLength(8)
    expect(second).not.toEqual(first)

    // And the seed decides it: a second mount starting from seed 1 again draws
    // the first eight, so nothing here depends on render order or timing.
    cleanup()
    seeds = 0
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    expect(chips()).toEqual(first)
  })

  it('asks the server once and redraws without another round trip', async () => {
    // 48 tags is small enough to send whole, which is what makes a redraw free.
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    await click(screen.getByText('Show me eight others'))
    await click(screen.getByText('Show me eight others'))
    expect(mocked.commanderSemantics).toHaveBeenCalledTimes(1)
  })

  it('announces that new semantics arrived rather than changing silently', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    await click(screen.getByText('Show me eight others'))

    const live = within(region(SEMANTICS)).getByRole('status')
    expect(live.textContent).toContain('8 new semantics offered')
  })

  it('makes each offer a real toggle, keyboard reachable and not colour alone', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))

    const first = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!
    expect(first.tagName).toBe('BUTTON')
    expect(first.getAttribute('aria-pressed')).toBe('false')
    // The glyph is the second signal, so the state does not live in a colour.
    expect(first.textContent).toContain('✧')

    await click(first)
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(first.textContent).toContain('✦')
  })

  it('says what stands behind an offer, in its accessible name', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    const first = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!
    expect(first.getAttribute('aria-label')).toContain('40 commanders')
    expect(first.getAttribute('aria-label')).toContain('400 cards')
  })

  it('shows the commanders carrying a pick, as a real list', async () => {
    mocked.commandersBySemantics.mockResolvedValue({
      items: [KRENKO, LATHRIL],
      matches: { [KRENKO.oracleId]: 1, [LATHRIL.oracleId]: 1 },
      total: 2,
    })
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)

    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Commanders carrying the chosen semantics' }),
      ).toBeDefined(),
    )
    const list = screen.getByRole('list', { name: 'Commanders carrying the chosen semantics' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('sends every pick, and ranks two-of-two ahead of one-of-two', async () => {
    mocked.commandersBySemantics.mockResolvedValue({
      items: [LATHRIL, KRENKO],
      matches: { [LATHRIL.oracleId]: 2, [KRENKO.oracleId]: 1 },
      total: 2,
    })
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    const buttons = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })
    await click(buttons[0]!)
    await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)

    await waitFor(() => expect(mocked.commandersBySemantics).toHaveBeenCalled())
    const sent = mocked.commandersBySemantics.mock.calls.at(-1)?.[0]
    expect(sent).toHaveLength(2)

    const list = screen.getByRole('list', { name: 'Commanders carrying the chosen semantics' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('Lathril, Blade of the Elves')
    // The count is readable rather than only drawn, so "two of two leads one of
    // two" is available to somebody who cannot see the order.
    expect(items[0]?.textContent).toContain('Matches 2 of 2')
    expect(items[1]?.textContent).toContain('Matches 1 of 2')
  })

  it('says so when nothing carries every pick, rather than showing an empty list', async () => {
    mocked.commandersBySemantics.mockResolvedValue({ items: [], matches: {}, total: 0 })
    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)

    await waitFor(() =>
      expect(screen.getByText(/No commander carries all of those together/)).toBeDefined(),
    )
  })

  it('starts the deck from a commander chosen here, exactly as the search does', async () => {
    mocked.commandersBySemantics.mockResolvedValue({
      items: [LATHRIL],
      matches: { [LATHRIL.oracleId]: 1 },
      total: 1,
    })
    mocked.createDeck.mockResolvedValue({
      id: 'd1',
      name: 'Lathril, Blade of the Elves deck',
      description: '',
      commanders: [LATHRIL.oracleId],
      colorIdentity: ['B'],
      targetBracket: 3,
      archetype: 'midrange',
      version: 1,
      excludeUniversesBeyond: false,
      budget: null,
      entries: [],
    } as unknown as api.Deck)

    await show()
    await waitFor(() => expect(chips()).toHaveLength(8))
    await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)
    // Scoped to this route: the same commander is in the quickdraw hand below,
    // and choosing it from there would prove a different thing.
    await waitFor(() =>
      expect(
        within(region(SEMANTICS)).getByLabelText('Choose Lathril, Blade of the Elves'),
      ).toBeDefined(),
    )
    await click(within(region(SEMANTICS)).getByLabelText('Choose Lathril, Blade of the Elves'))

    // The same screen the name search lands on: the card, the focus prompt and
    // an enabled button. This route adds a way in, not a second way to build.
    expect(screen.getByText(/Building around/)).toBeDefined()
    const button = screen.getByText('Start building').closest('button')!
    expect(button.disabled).toBe(false)

    await click(button)
    expect(mocked.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({ commanders: [LATHRIL.oracleId] }),
    )
  })

  it('says the route is unavailable rather than rendering an empty offer', async () => {
    mocked.commanderSemantics.mockRejectedValue(new Error('Request failed (500)'))
    await show()
    await waitFor(() => expect(screen.getByText(/The semantics are not answering/)).toBeDefined())
    // …and the door that still works is named in the same sentence.
    expect(screen.getByText(/commander search above still works/)).toBeDefined()
  })
})

describe('route 2 — quickdraw', () => {
  it('deals three commanders, as a real list', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    const hand = screen.getByRole('list', { name: 'Three commanders dealt' })
    expect(within(hand).getAllByRole('listitem')).toHaveLength(3)
  })

  it('marks the wildcard in words, not by colour and not by position alone', async () => {
    await show()
    const hand = await screen.findByRole('list', { name: 'Three commanders dealt' })
    const items = within(hand).getAllByRole('listitem')

    const marked = items.filter((li) => li.textContent?.includes('Wildcard') === true)
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain(STRANGER.name)
    expect(marked[0]?.textContent).toContain('drawn from every legal commander')
    // The other two carry no mark at all, so the word is a distinction rather
    // than decoration on every row.
    expect(items.filter((li) => li.textContent?.includes('Wildcard') === true)).toHaveLength(1)
  })

  it('deals with a fresh seed on a reroll, and the same one never twice', async () => {
    await show()
    await waitFor(() => expect(mocked.quickdrawCommanders).toHaveBeenCalled())
    await click(screen.getByText('Deal three more'))
    await waitFor(() => expect(mocked.quickdrawCommanders).toHaveBeenCalledTimes(2))

    const used = mocked.quickdrawCommanders.mock.calls.map((c) => c[0])
    expect(new Set(used).size).toBe(used.length)
  })

  it('announces that new cards arrived rather than changing silently', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await click(screen.getByText('Deal three more'))

    const live = within(region(QUICKDRAW)).getByRole('status')
    expect(live.textContent).toContain('Three new commanders dealt')
  })

  it('starts the deck from a dealt commander', async () => {
    mocked.createDeck.mockResolvedValue({
      id: 'd2',
      name: 'Nobody Has Heard Of Me deck',
      description: '',
      commanders: [STRANGER.oracleId],
      colorIdentity: ['R'],
      targetBracket: 3,
      archetype: 'midrange',
      version: 1,
      excludeUniversesBeyond: false,
      budget: null,
      entries: [],
    } as unknown as api.Deck)

    await show()
    await waitFor(() =>
      expect(screen.getByLabelText('Choose Nobody Has Heard Of Me')).toBeDefined(),
    )
    await click(screen.getByLabelText('Choose Nobody Has Heard Of Me'))

    const button = screen.getByText('Start building').closest('button')!
    expect(button.disabled).toBe(false)
    await click(button)
    expect(mocked.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({ commanders: [STRANGER.oracleId] }),
    )
  })

  it('deals a short hand honestly rather than labelling a third familiar card', async () => {
    // A corpus too small to deal a distinct wildcard. Two cards and no mark is
    // the truth; three with one relabelled would be a claim about where a card
    // came from that is not true.
    mocked.quickdrawCommanders.mockResolvedValue({
      items: [KRENKO, LATHRIL],
      wildcard: null,
      seed: 'x',
    })
    await show()
    const hand = await screen.findByRole('list', { name: 'Three commanders dealt' })
    expect(within(hand).getAllByRole('listitem')).toHaveLength(2)
    expect(hand.textContent).not.toContain('Wildcard')
  })

  it('says the route is unavailable rather than showing an empty hand', async () => {
    mocked.quickdrawCommanders.mockRejectedValue(new Error('Request failed (500)'))
    await show()
    await waitFor(() => expect(screen.getByText(/The draw is not answering/)).toBeDefined())
  })
})

/**
 * Looking at a commander before committing to one (ADR-0068).
 *
 * Every one of the three doors offered a Choose and nothing else, so the only
 * way to find out what a legend does was to build a deck around it. These tests
 * are about the pane that answers that — the WORKSPACE's pane, reused, which is
 * why several of them are about what it must NOT say here.
 *
 * ## What these tests cannot check
 *
 * Where the pane sits. jsdom does no CSS layout at all, so "a side column when
 * there is room, a bottom sheet when there is not" is unverifiable here beyond
 * the one thing that is not CSS: which of the two the component was TOLD it is,
 * and the dialog semantics and focus move that ride on that flag.
 */
const previewPane = (name: string): HTMLElement => screen.getByRole('complementary', { name })

const openPreviewOf = async (name: string, scope?: HTMLElement): Promise<void> => {
  const trigger = (scope === undefined ? screen : within(scope)).getByLabelText(`Preview ${name}`)
  await click(trigger)
  await waitFor(() => expect(previewPane(`${name} details`)).toBeDefined())
}

describe('previewing a commander before choosing it', () => {
  it('opens the pane from a name-search result', async () => {
    mocked.searchCards.mockResolvedValue({ items: [KRENKO] })
    await show()
    await openPreviewOf('Krenko, Mob Boss')

    const pane = previewPane('Krenko, Mob Boss details')
    expect(within(pane).getByRole('heading', { name: 'Krenko, Mob Boss' })).toBeDefined()
    // The card itself, not a name in a box: the rules text is what the reader
    // came for and it is the half a row cannot show.
    expect(pane.textContent).toContain('Create X 1/1 red Goblin creature tokens')
  })

  it('opens the pane from a commander carrying a chosen semantic', async () => {
    mocked.commandersBySemantics.mockResolvedValue({
      items: [LATHRIL],
      matches: { [LATHRIL.oracleId]: 1 },
      total: 1,
    })
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)
    await waitFor(() =>
      expect(
        within(region(SEMANTICS)).getByLabelText('Preview Lathril, Blade of the Elves'),
      ).toBeDefined(),
    )

    await openPreviewOf('Lathril, Blade of the Elves', region(SEMANTICS))
    expect(previewPane('Lathril, Blade of the Elves details')).toBeDefined()
  })

  it('opens the pane from a dealt commander', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Nobody Has Heard Of Me', region(QUICKDRAW))
    expect(previewPane('Nobody Has Heard Of Me details')).toBeDefined()
  })

  it('shows the card that was asked for, and swaps wholly to the next one', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))
    expect(
      screen.queryByRole('complementary', { name: 'Lathril, Blade of the Elves details' }),
    ).toBeNull()

    await openPreviewOf('Lathril, Blade of the Elves', region(QUICKDRAW))
    // One pane, showing one card. A second pane, or the first card's text left
    // under the second card's name, is the failure this pins.
    expect(screen.getAllByRole('complementary')).toHaveLength(1)
    expect(screen.queryByRole('complementary', { name: 'Krenko, Mob Boss details' })).toBeNull()
  })

  it('announces the card the pane opened on, and each swap after it', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )

    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))
    expect(screen.getByRole('status', { name: 'Card preview' }).textContent).toContain(
      'Krenko, Mob Boss',
    )

    // A sighted reader sees the pane change; without this a screen-reader user
    // is told nothing at all happened.
    await openPreviewOf('Lathril, Blade of the Elves', region(QUICKDRAW))
    expect(screen.getByRole('status', { name: 'Card preview' }).textContent).toContain(
      'Lathril, Blade of the Elves',
    )
  })

  it('carries the Choose action, and it reaches createDeck with that commander', async () => {
    mocked.createDeck.mockResolvedValue({
      id: 'd3',
      name: 'Lathril, Blade of the Elves deck',
      description: '',
      commanders: [LATHRIL.oracleId],
      colorIdentity: ['B'],
      targetBracket: 3,
      archetype: 'midrange',
      version: 1,
      excludeUniversesBeyond: false,
      budget: null,
      entries: [],
    } as unknown as api.Deck)

    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Lathril, Blade of the Elves', region(QUICKDRAW))

    const pane = previewPane('Lathril, Blade of the Elves details')
    const choose = within(pane).getByLabelText('Choose Lathril, Blade of the Elves')
    expect(choose.tagName).toBe('BUTTON')
    await click(choose)

    // The same landing the rows reach, through the same `choose`.
    expect(screen.getByText(/Building around/)).toBeDefined()
    await click(screen.getByText('Start building').closest('button')!)
    expect(mocked.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({ commanders: [LATHRIL.oracleId] }),
    )
  })

  it('closes on Escape and puts focus back on the control that opened it', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    const trigger = within(region(QUICKDRAW)).getByLabelText('Preview Krenko, Mob Boss')
    trigger.focus()
    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(screen.queryByRole('complementary', { name: 'Krenko, Mob Boss details' })).toBeNull()
    // Not `<body>`. A keyboard reader who dismisses the pane has to be returned
    // to the row they were on, not to the top of the page.
    expect(document.activeElement).toBe(
      within(region(QUICKDRAW)).getByLabelText('Preview Krenko, Mob Boss'),
    )
  })

  it('offers no emphasise control on this screen, because there is no deck to focus', async () => {
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))

    const pane = previewPane('Krenko, Mob Boss details')
    // The chip is still there — it is a label, and the semantics are a fact
    // about the card. What is absent is the control that would write a focus
    // to a deck that does not exist.
    expect(within(pane).getByText('making tokens')).toBeDefined()
    expect(within(pane).queryByLabelText(/^Emphasise /)).toBeNull()
  })

  it('makes no claim about a deck, because there is no deck', async () => {
    // `Works` is NOT silent on an empty accepted set: a two-card combo leaves
    // exactly one piece missing, which is its "one card away" branch, so an
    // empty deck would have produced the heading "Works with your deck" and a
    // line reading "No combo assembled yet — these need one more card".
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))

    const pane = previewPane('Krenko, Mob Boss details')
    expect(pane.textContent).not.toContain('Works with your deck')
    expect(pane.textContent).not.toContain('need one more card')
    expect(pane.textContent).not.toContain('Synergises with')
    // What IS a fact about the card survives: it is in a combo, and that is
    // true of the cardboard rather than of any deck.
    expect(pane.textContent).toContain('In 1 combo')
  })

  it('is the rail panel on a wide screen and the sheet on a narrow one', async () => {
    // The one half of the placement that is not CSS: what the component is told
    // it is, and the dialog role and focus move that follow from it.
    await show()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
    )
    await openPreviewOf('Krenko, Mob Boss', region(QUICKDRAW))

    const pane = previewPane('Krenko, Mob Boss details')
    expect(pane.className).not.toContain('preview-sheet')
    expect(pane.getAttribute('role')).toBeNull()
  })
})
