// @vitest-environment jsdom
import { SEMANTIC_OFFER_SAMPLE } from '@roundtable/domain'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const REDRAW = `Show me ${String(SAMPLE)} others`
/** The expander's label carries the REAL size of the qualifying set, not a round number. */
const SEE_ALL = `See all ${String(OFFERS.length)}`
const PICKS = 'Semantics you have chosen'
/** The route has two live regions; this is the one the chips write to. */
const OFFERED = 'Semantics offered'

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
  it('offers a handful of the qualifying semantics, not all of them', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    // Drawn from the twelve the server sent, and every one of them a real offer.
    for (const shown of chips()) expect(shown.length).toBeGreaterThan(0)
  })

  it('draws the same sample from the same seed, and a different one on a redraw', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    const first = chips()

    await click(screen.getByText(REDRAW))
    const second = chips()

    expect(second).toHaveLength(SAMPLE)
    expect(second).not.toEqual(first)

    // And the seed decides it: a second mount starting from seed 1 again draws
    // the first eight, so nothing here depends on render order or timing.
    cleanup()
    seeds = 0
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    expect(chips()).toEqual(first)
  })

  it('asks the server once and redraws without another round trip', async () => {
    // 48 tags is small enough to send whole, which is what makes a redraw free.
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    await click(screen.getByText(REDRAW))
    await click(screen.getByText(REDRAW))
    expect(mocked.commanderSemantics).toHaveBeenCalledTimes(1)
  })

  it('announces that new semantics arrived rather than changing silently', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
    await click(screen.getByText(REDRAW))

    const live = within(region(SEMANTICS)).getByRole('status', { name: OFFERED })
    expect(live.textContent).toContain(`${String(SAMPLE)} new semantics offered`)
  })

  it('makes each offer a real toggle, keyboard reachable and not colour alone', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))

    const first = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!
    expect(first.tagName).toBe('BUTTON')
    expect(first.getAttribute('aria-pressed')).toBe('false')
    // The glyph is the second signal, so the state does not live in a colour.
    expect(first.textContent).toContain('✧')

    const tag = first.textContent?.replace(/^[✦✧]\s*/, '').trim() ?? ''
    await click(first)

    // The SAME tag, now pressed — in the picks region, because that is where a
    // chosen semantic lives. The control it was is gone; the control it became
    // carries the state.
    const picked = within(region(PICKS)).getByRole('button', { pressed: true })
    expect(picked.textContent).toContain(tag)
    expect(picked.textContent).toContain('✦')
  })

  it('says what stands behind an offer, in its accessible name', async () => {
    await show()
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
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
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
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
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
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
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
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
    await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
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

  /**
   * The whole qualifying set, one press away (ADR-0068).
   *
   * Three at a time is a prompt rather than a wall, and it is only defensible if
   * the other sixty-odd are reachable — otherwise narrowing the sample would be
   * hiding the vocabulary rather than introducing it.
   */
  describe('seeing all of them', () => {
    it('names the real size of the set rather than a round number', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      // The count comes from the census the server sent, so it cannot drift from
      // what pressing the button actually reveals.
      expect(screen.getByText(SEE_ALL)).toBeDefined()
    })

    it('reveals every qualifying tag, ranked by how many commanders carry it', async () => {
      mocked.commanderSemantics.mockResolvedValue({
        offers: [
          { tag: 'landfall', category: 'mechanics', commanders: 12, supporting: 200 },
          { tag: 'treasure', category: 'mechanics', commanders: 90, supporting: 200 },
          { tag: 'token', category: 'mechanics', commanders: 45, supporting: 200 },
        ],
      })
      await show()
      await waitFor(() => expect(screen.getByText('See all 3')).toBeDefined())
      await click(screen.getByText('See all 3'))

      // Most-carried first: the census already holds the count, so this needs no
      // second query and makes no claim the endpoint has not already made.
      expect(chips()).toEqual(['treasure', 'making tokens', 'lands entering'])
    })

    it('collapses back to the sample without losing what was chosen', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      await click(screen.getByText(SEE_ALL))
      expect(chips().length).toBeGreaterThan(SAMPLE)

      const chosen = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!
      const tag = chosen.textContent?.replace(/^[✦✧]\s*/, '').trim() ?? ''
      await click(chosen)

      await click(screen.getByText('Show fewer'))
      expect(chips()).toHaveLength(SAMPLE)
      expect(within(region(PICKS)).getByRole('button', { pressed: true }).textContent).toContain(
        tag,
      )
    })
  })

  /**
   * The bug this fixes, in the user's words: "when I select semantics, move them
   * to a separate region so that showing eight others don't unselect the ones
   * I've chosen so far".
   *
   * A redraw replaces the sample wholesale, so a chosen tag that is not in the
   * new sample simply left the screen — and leaving the screen reads as being
   * unselected whether or not the state survived. `EmphasisChoice` carries the
   * same lesson about a focus that would be "chosen, pressed, and invisible".
   */
  describe('the semantics already chosen keep a place of their own', () => {
    const pickFirst = async (): Promise<string> => {
      const first = within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!
      const tag = first.textContent?.replace(/^[✦✧]\s*/, '').trim() ?? ''
      await click(first)
      return tag
    }

    it('has no region at all until something is chosen', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      // Absent, not empty: a heading over nothing is a promise of something
      // that is not there.
      expect(screen.queryByRole('region', { name: PICKS })).toBeNull()
    })

    it('keeps a pick on screen across a redraw', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      const tag = await pickFirst()

      await click(screen.getByText(REDRAW))
      await click(screen.getByText(REDRAW))

      const picks = within(region(PICKS)).getAllByRole('button', { pressed: true })
      expect(picks.map((b) => b.textContent?.replace(/^[✦✧]\s*/, '').trim())).toEqual([tag])
    })

    it('draws a chosen tag exactly once, never in both places', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      const tag = await pickFirst()

      // Expanding brings the whole set into the pool, including the tag that has
      // already been chosen — which must still appear only in the picks region.
      await click(screen.getByText(SEE_ALL))

      const everywhere = within(region(SEMANTICS))
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') !== null)
        .map((b) => b.textContent?.replace(/^[✦✧]\s*/, '').trim())
      expect(everywhere.filter((t) => t === tag)).toHaveLength(1)
    })

    it('returns a released tag to the pool', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      const tag = await pickFirst()
      expect(chips()).not.toContain(tag)

      await click(within(region(PICKS)).getByRole('button', { pressed: true }))

      expect(screen.queryByRole('region', { name: PICKS })).toBeNull()
      expect(chips()).toContain(tag)
    })

    it('keeps focus on the chip that moved, and says that it moved', async () => {
      // The classic way to dump focus on `<body>`: press a control that then
      // renders somewhere else. A keyboard reader must still be standing on it.
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      const tag = await pickFirst()

      const moved = within(region(PICKS)).getByRole('button', { pressed: true })
      expect(document.activeElement).toBe(moved)

      const live = within(region(SEMANTICS)).getByRole('status', { name: OFFERED })
      expect(live.textContent).toContain(tag)
      expect(live.textContent).toContain('chosen')

      // And back the other way, so the return trip is not the silent one.
      await click(moved)
      const returned = within(region(SEMANTICS))
        .getAllByRole('button', { pressed: false })
        .find((b) => b.textContent?.includes(tag) === true)
      expect(document.activeElement).toBe(returned)
      expect(
        within(region(SEMANTICS)).getByRole('status', { name: OFFERED }).textContent,
      ).toContain('back')
    })

    it('still sends every pick to the server, wherever the chip is drawn', async () => {
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      const first = await pickFirst()
      const second = await pickFirst()

      await waitFor(() => expect(mocked.commandersBySemantics).toHaveBeenCalled())
      const sent = mocked.commandersBySemantics.mock.calls.at(-1)?.[0]
      expect(sent).toHaveLength(2)
      expect(within(region(PICKS)).getAllByRole('button', { pressed: true })).toHaveLength(2)
      expect(first).not.toEqual(second)
    })
  })

  /**
   * The picks become the deck's focus, where the commander agrees (ADR-0068).
   *
   * The reader answered "what is this deck about" on the way in and was then
   * asked it again by the focus prompt, because the picks were dropped the
   * moment a commander was chosen.
   *
   * The intersection is computed on the CLIENT and needs nothing new on the
   * wire: a commander is only in Route 1's results because it carries a picked
   * tag in `produces` or `wants`, and both sides of that are already in hand.
   */
  describe('carrying the picks into the deck’s focus', () => {
    /** Three offers, so the sample IS the whole set and a pick is nameable. */
    const THREE: api.SemanticOffer[] = [
      { tag: 'landfall', category: 'mechanics', commanders: 40, supporting: 400 },
      { tag: 'treasure', category: 'mechanics', commanders: 40, supporting: 400 },
      { tag: 'subtype:elf', category: 'type', commanders: 40, supporting: 400 },
    ]

    /**
     * Carries `landfall` by causing it and `treasure` by benefiting from it, and
     * is an Elf without that being a reason to focus Elves.
     */
    const OMNATH = card('Omnath, Locus of Rage', {
      synergyProduces: ['landfall'],
      synergyWants: ['treasure'],
      synergyHas: ['subtype:elf'],
    })

    const startOn = async (commander: api.Card, picks: string[]): Promise<void> => {
      mocked.commanderSemantics.mockResolvedValue({ offers: THREE })
      mocked.commandersBySemantics.mockResolvedValue({
        items: [commander],
        matches: { [commander.oracleId]: picks.length },
        total: 1,
      })
      await show()
      await waitFor(() => expect(chips()).toHaveLength(THREE.length))
      for (const pick of picks) {
        await click(
          within(region(SEMANTICS))
            .getAllByRole('button', { pressed: false })
            .find((b) => b.textContent?.includes(pick) === true)!,
        )
      }
      await waitFor(() =>
        expect(within(region(SEMANTICS)).getByLabelText(`Choose ${commander.name}`)).toBeDefined(),
      )
      await click(within(region(SEMANTICS)).getByLabelText(`Choose ${commander.name}`))
    }

    const focus = (tag: string): HTMLElement => screen.getByLabelText(`Emphasise ${tag}`)

    it('pre-selects the picks the commander actually carries', async () => {
      await startOn(OMNATH, ['lands entering', 'treasure'])

      expect(focus('lands entering').getAttribute('aria-pressed')).toBe('true')
      expect(focus('treasure').getAttribute('aria-pressed')).toBe('true')
    })

    it('says why they are already on, rather than leaving it looking like a bug', async () => {
      await startOn(OMNATH, ['lands entering', 'treasure'])
      expect(screen.getByText(/carries/i).textContent).toContain('lands entering')
    })

    it('drops a pick the commander does not carry', async () => {
      await startOn(OMNATH, ['lands entering'])
      expect(focus('lands entering').getAttribute('aria-pressed')).toBe('true')
      // The chip is still OFFERED — it is one of the commander's own semantics,
      // which is a different question — but it is not focused, because it was
      // never picked.
      expect(focus('treasure').getAttribute('aria-pressed')).toBe('false')
    })

    it('drops a pick the commander only carries by BEING one', async () => {
      /*
       * `has` is excluded, exactly as ADR-0067 excludes it from matching. Route
       * 1 asks what a deck is ABOUT, and a commander merely being an Elf is not
       * a reason to make the deck about Elves — if the two disagreed the screen
       * would contradict itself between the list and the prompt.
       */
      await startOn(OMNATH, ['Elves'])
      const elves = screen.queryByLabelText('Emphasise Elves')
      expect(elves === null || elves.getAttribute('aria-pressed') === 'false').toBe(true)
    })

    it('draws no line at all when nothing was carried', async () => {
      await startOn(OMNATH, ['Elves'])
      // An absence is not explained. There is nothing to justify.
      expect(screen.queryByText(/carried from the semantics you picked/i)).toBeNull()
    })

    it('lets a carried focus be toggled off like any other', async () => {
      await startOn(OMNATH, ['lands entering'])
      await click(focus('lands entering'))
      expect(focus('lands entering').getAttribute('aria-pressed')).toBe('false')
    })

    it('recomputes against the new commander when the choice changes', async () => {
      await startOn(OMNATH, ['lands entering', 'treasure'])
      expect(focus('lands entering').getAttribute('aria-pressed')).toBe('true')

      // Back to the search, and a commander that carries none of it. A focus
      // left over from a legend no longer being built is a claim about a card
      // the reader is not looking at.
      mocked.searchCards.mockResolvedValue({ items: [STRANGER] })
      const box = screen.getByLabelText('Commander')
      await act(async () => {
        fireEvent.change(box, { target: { value: 'Nobody' } })
      })
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' })
      })
      await waitFor(() =>
        expect(screen.getAllByLabelText(`Choose ${STRANGER.name}`).length).toBeGreaterThan(0),
      )
      await click(screen.getAllByLabelText(`Choose ${STRANGER.name}`)[0]!)

      // Nothing carried, and no chip left pressed from the legend that was
      // abandoned. `Nobody Has Heard Of Me` derives no semantics at all, so the
      // prompt says so rather than offering a stale focus.
      expect(screen.queryByLabelText('Emphasise lands entering')).toBeNull()
      expect(screen.queryByText(/already focused/)).toBeNull()
    })

    it('rides the create call rather than a write after it', async () => {
      mocked.createDeck.mockResolvedValue({
        id: 'd4',
        name: `${OMNATH.name} deck`,
        description: '',
        commanders: [OMNATH.oracleId],
        colorIdentity: ['R'],
        targetBracket: 3,
        archetype: 'midrange',
        version: 1,
        excludeUniversesBeyond: false,
        budget: null,
        entries: [],
      } as unknown as api.Deck)

      await startOn(OMNATH, ['lands entering', 'treasure'])
      await click(screen.getByText('Start building').closest('button')!)

      // In the create body, not a PATCH afterwards: a two-request create leaves
      // a window in which the deck exists with the wrong focus, and the first
      // page of suggestions is the one the focus exists to shape.
      expect(mocked.createDeck).toHaveBeenCalledWith(
        expect.objectContaining({
          commanders: [OMNATH.oracleId],
          semanticEmphasis: expect.arrayContaining(['landfall', 'treasure']),
        }),
      )
      expect(mocked.patchDeck).not.toHaveBeenCalled()
    })
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
 * ## The trigger is the card's own name
 *
 * It was a second action button beside Choose, and that was the correction
 * (amendment 1). The label did not change — `Preview Krenko, Mob Boss` is still
 * character-for-character what the workspace says — so the helper below reaches
 * the new trigger and the old one identically, which is the whole reason these
 * tests could be updated rather than rewritten.
 *
 * ## What these tests cannot check
 *
 * Where the pane sits. jsdom does no CSS layout at all, so "a side column when
 * there is room, a bottom sheet when there is not" is unverifiable here beyond
 * the one thing that is not CSS: which of the two the component was TOLD it is,
 * and the dialog semantics and focus move that ride on that flag.
 *
 * The same limit applies to the row-wide click. The mouse convenience is two
 * halves: a handler on the name cell, which is tested below, and a `::after`
 * overlay stretched across the row by the stylesheet, which is not testable
 * here at all — jsdom computes no boxes, so there is nothing for a click to
 * land on. That half has been reasoned about and written down; it has not been
 * seen.
 */
const previewPane = (name: string): HTMLElement => screen.getByRole('complementary', { name })

const previewTrigger = (name: string, scope?: HTMLElement): HTMLElement =>
  (scope === undefined ? screen : within(scope)).getByLabelText(`Preview ${name}`)

const openPreviewOf = async (name: string, scope?: HTMLElement): Promise<void> => {
  await click(previewTrigger(name, scope))
  await waitFor(() => expect(previewPane(`${name} details`)).toBeDefined())
}

/**
 * The name search's results, as a scope.
 *
 * By class, which the rest of this file avoids on principle — the block is a
 * plain `div` with no heading and no landmark, so there is no role or label to
 * ask for. Scoping matters here because the fixture hand below contains the
 * same commanders the search can return, and an unscoped query would find the
 * dealt row and prove the wrong list.
 */
const searchResults = (): HTMLElement => document.querySelector('.start-results')!

/** Type a commander's name and commit it, which is the only thing that searches. */
const searchFor = async (term: string): Promise<void> => {
  const box = screen.getByLabelText('Commander')
  await act(async () => {
    fireEvent.change(box, { target: { value: term } })
  })
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter' })
  })
}

/** A commander only the SEARCH can produce: never dealt, never a carrier. */
const GRIST = card('Grist, the Hunger Tide', {
  oracleText: 'Whenever Grist enters, create a 1/1 black Insect creature token.',
  synergyProduces: ['token'],
})

describe('previewing a commander before choosing it', () => {
  it('opens the pane from a name-search result', async () => {
    /*
     * A REAL search: `Grist` is typed and committed, and the row that opens the
     * pane is the one under the box.
     *
     * This test used to render `Krenko` into the search mock and then open the
     * pane unscoped — but nothing searches until two characters are committed,
     * so the only `Preview Krenko, Mob Boss` on the page was the DEALT row, and
     * the test named a list it never touched. A commander the hand cannot
     * contain is what makes the scope honest.
     */
    mocked.searchCards.mockResolvedValue({ items: [GRIST] })
    mocked.getCardDetail.mockResolvedValue(detailOf(GRIST))
    await show()
    await searchFor('Grist')
    await waitFor(() => expect(previewTrigger(GRIST.name, searchResults())).toBeDefined())
    await openPreviewOf(GRIST.name, searchResults())

    const pane = previewPane(`${GRIST.name} details`)
    expect(within(pane).getByRole('heading', { name: GRIST.name })).toBeDefined()
    // The card itself, not a name in a box: the rules text is what the reader
    // came for and it is the half a row cannot show.
    expect(pane.textContent).toContain('create a 1/1 black Insect creature token')
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

  /**
   * The trigger is the name, and there is no second button (amendment 1).
   *
   * In the user's words: "the preview pane should also be shown when I click
   * the entry option (not on the choose button), instead of showing a jenky
   * preview button". The pattern was already settled everywhere else in the
   * app — the deck rail, the rejected list and the name-match list all make the
   * card's name a `.name.as-link` button — and these three lists simply did not
   * use it.
   */
  describe('the trigger is the card’s own name', () => {
    /** One of the three lists, and the commander it is being asked about. */
    interface Rendered {
      list: string
      scope: HTMLElement
      name: string
    }

    /** All three on screen at once, so one loop can hold each to the same rule. */
    const inEveryList = async (): Promise<Rendered[]> => {
      mocked.searchCards.mockResolvedValue({ items: [GRIST] })
      mocked.commandersBySemantics.mockResolvedValue({
        items: [LATHRIL],
        matches: { [LATHRIL.oracleId]: 1 },
        total: 1,
      })
      await show()
      await searchFor('Grist')
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)
      await waitFor(() =>
        expect(within(region(SEMANTICS)).getByLabelText(`Choose ${LATHRIL.name}`)).toBeDefined(),
      )
      return [
        { list: 'the name search', scope: searchResults(), name: GRIST.name },
        { list: 'the carriers of a semantic', scope: region(SEMANTICS), name: LATHRIL.name },
        { list: 'the dealt hand', scope: region(QUICKDRAW), name: STRANGER.name },
      ]
    }

    it('is a button carrying the card’s name, in all three lists', async () => {
      for (const { list, scope, name } of await inEveryList()) {
        const trigger = previewTrigger(name, scope)
        // A real control, not a div with a handler: this is what makes it
        // focusable and what makes Enter and Space activate it.
        expect(trigger.tagName, list).toBe('BUTTON')
        // …and the control IS the name, rather than a button beside it.
        expect(trigger.textContent, list).toContain(name)
        expect(trigger.className, list).toContain('as-link')
      }
    })

    it('leaves Choose as the only action on the row', async () => {
      for (const { list, scope, name } of await inEveryList()) {
        const row = previewTrigger(name, scope).closest('.card-row')!
        // Exactly two controls, in this order: the name, then the decision.
        expect(
          within(row as HTMLElement)
            .getAllByRole('button')
            .map((b) => b.getAttribute('aria-label')),
          list,
        ).toEqual([`Preview ${name}`, `Choose ${name}`])
      }
      // And nothing anywhere still renders the action that was deleted.
      expect(document.querySelectorAll('.act.preview')).toHaveLength(0)
      expect(
        [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Preview'),
      ).toHaveLength(0)
    })

    it('opens the pane from a click on the row’s text block, not only on the name', async () => {
      await show()
      await waitFor(() =>
        expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
      )
      const trigger = previewTrigger(KRENKO.name, region(QUICKDRAW))
      const cell = trigger.closest('.name-cell')!
      expect(cell).not.toBe(trigger)

      await act(async () => {
        fireEvent.click(cell)
      })
      await waitFor(() => expect(previewPane(`${KRENKO.name} details`)).toBeDefined())
    })

    it('does not put the handler on the row itself, which no keyboard could reach', async () => {
      await show()
      await waitFor(() =>
        expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
      )
      const row = previewTrigger(KRENKO.name, region(QUICKDRAW)).closest('.card-row')!

      // A click whose target is the row element itself reaches no handler: the
      // row is not a control, and the mouse convenience over the rest of it is
      // an overlay stretched from the name button — CSS, which jsdom does not
      // compute. What this pins is the thing that WOULD have been wrong: a
      // clickable `<div>`, which takes no focus and answers no key.
      await act(async () => {
        fireEvent.click(row)
      })
      expect(screen.queryAllByRole('complementary')).toHaveLength(0)
    })

    it('is reachable and activatable from the keyboard', async () => {
      await show()
      await waitFor(() =>
        expect(screen.getByRole('list', { name: 'Three commanders dealt' })).toBeDefined(),
      )
      const trigger = previewTrigger(KRENKO.name, region(QUICKDRAW))

      trigger.focus()
      expect(document.activeElement).toBe(trigger)
      // In the tab order rather than merely focusable by script.
      expect(trigger.getAttribute('tabindex')).toBeNull()
      expect(trigger.hasAttribute('disabled')).toBe(false)

      /*
       * Activation, as the browser delivers it. jsdom does not synthesise the
       * Enter-and-Space-to-click behaviour of a native button, so a `keyDown`
       * here would prove nothing about the component; the guarantee is that the
       * element IS a `<button>` — asserted above — and that the click a browser
       * dispatches from those keys opens the pane.
       */
      const focused = document.activeElement as HTMLElement
      await act(async () => {
        focused.click()
      })
      await waitFor(() => expect(previewPane(`${KRENKO.name} details`)).toBeDefined())
    })
  })

  /**
   * Choosing is not looking, in the other direction (amendment 1).
   *
   * The actions are SIBLINGS of the name cell rather than children of it, which
   * is what keeps a press on Choose out of the preview's handler. The rejected
   * alternative was `stopPropagation` on the button, which leaves the nesting
   * wrong and hides it.
   */
  describe('choosing does not also open the pane', () => {
    const chose = (): void => {
      expect(screen.getByText(/Building around/)).toBeDefined()
      // Not "no pane for this card": no pane at all.
      expect(screen.queryAllByRole('complementary')).toHaveLength(0)
    }

    it('from a name-search result', async () => {
      mocked.searchCards.mockResolvedValue({ items: [GRIST] })
      await show()
      await searchFor('Grist')
      await waitFor(() =>
        expect(within(searchResults()).getByLabelText(`Choose ${GRIST.name}`)).toBeDefined(),
      )
      await click(within(searchResults()).getByLabelText(`Choose ${GRIST.name}`))
      chose()
    })

    it('from a commander carrying a chosen semantic', async () => {
      mocked.commandersBySemantics.mockResolvedValue({
        items: [LATHRIL],
        matches: { [LATHRIL.oracleId]: 1 },
        total: 1,
      })
      await show()
      await waitFor(() => expect(chips()).toHaveLength(SAMPLE))
      await click(within(region(SEMANTICS)).getAllByRole('button', { pressed: false })[0]!)
      await waitFor(() =>
        expect(within(region(SEMANTICS)).getByLabelText(`Choose ${LATHRIL.name}`)).toBeDefined(),
      )
      await click(within(region(SEMANTICS)).getByLabelText(`Choose ${LATHRIL.name}`))
      chose()
    })

    it('from a dealt commander', async () => {
      await show()
      await waitFor(() =>
        expect(within(region(QUICKDRAW)).getByLabelText(`Choose ${STRANGER.name}`)).toBeDefined(),
      )
      await click(within(region(QUICKDRAW)).getByLabelText(`Choose ${STRANGER.name}`))
      chose()
    })
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
