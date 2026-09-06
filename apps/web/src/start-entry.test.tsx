// @vitest-environment jsdom
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

const KRENKO = card('Krenko, Mob Boss')
const LATHRIL = card('Lathril, Blade of the Elves')
const STRANGER = card('Nobody Has Heard Of Me')

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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SEMANTICS = 'Or start from what the deck is about'
const QUICKDRAW = 'Or deal three at random'

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
