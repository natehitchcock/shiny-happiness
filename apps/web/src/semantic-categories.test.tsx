// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App, Workspace } from './App'

/**
 * The offer, in four categories (ADR-0065).
 *
 * "Every other semantic" was one flat list of 613 chips ordered by how much of
 * the deck's colours supported each, with a sentence — "nothing in your colours
 * supports this yet" — repeated under every unsupported one. Nobody reads 613
 * of anything, and the list gave a reader no way to say "I want a tribe" or "I
 * want a keyword" and skip the rest.
 *
 * These tests pin the four categories, the ORDER inside them (the words on the
 * chip, not the wire spelling of the tag), and the two things the split must not
 * break: the per-chip note has to be gone rather than merely moved, and
 * `EmphasisChoice` — the commander's OWN semantics, whose order is that
 * commander's story — has to be untouched.
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
  // The start screen's two other doors call these on mount (ADR-0067).
  commanderSemantics: vi.fn(),
  commandersBySemantics: vi.fn(),
  quickdrawCommanders: vi.fn(),
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
  colors: ['B'],
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

/** Tergrid, near enough — the same shape the emphasis suite uses. */
const commander = card({
  oracleId: 'cmd',
  name: 'Tergrid, God of Fright',
  synergyProduces: ['opponent-sacrifice'],
  synergyWants: ['opponent-discard'],
})

/**
 * A commander whose own three tags cross all three categories AND whose own
 * order is the reverse of the alphabetical one.
 *
 * `synergyHas` first, then produces, then wants, is the order `commanderTags`
 * builds — so this card renders "trample", "making tokens", "a creature dying"
 * and any sort at all would reorder it. That is what makes it a usable witness
 * for `EmphasisChoice` being left alone.
 */
const crossFamily = card({
  oracleId: 'cmd',
  name: 'Tergrid, God of Fright',
  synergyHas: ['ability:trample'],
  synergyProduces: ['token'],
  synergyWants: ['creature-death'],
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

const recs = (over: Partial<api.Recommendations> = {}): api.Recommendations => ({
  datasetSnapshotId: null,
  emphasis: [],
  tagSupport: [],
  groups: [],
  columns: [],
  unavailable: [],
  query: { matched: 0, total: 0, errors: [] },
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  /*
   * ADR-0067. The two entry routes below the commander search fetch on mount,
   * so every suite that mounts the start screen has to answer them. Empty
   * offers and an empty hand keep this file's start screen exactly as it was:
   * the routes render their headings and nothing else.
   */
  mocked.commanderSemantics.mockResolvedValue({ offers: [] })
  mocked.commandersBySemantics.mockResolvedValue({ items: [], matches: {}, total: 0 })
  mocked.quickdrawCommanders.mockResolvedValue({ items: [], wildcard: null, seed: 'test-seed' })
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

const mount = async (d: api.Deck = deck()): Promise<void> => {
  render(<Workspace deck={d} />)
  await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getAllByText('Tergrid, God of Fright').length).toBeGreaterThan(0),
  )
}

/** Open "Show all semantics" and hand back the offer it reveals. */
const everyOther = async (
  tagSupport: { tag: string; supporting: number }[] = [],
): Promise<HTMLElement> => {
  mocked.getRecommendations.mockResolvedValue(recs({ tagSupport }))
  await mount()
  const panel = focusPanel()
  await act(async () => {
    within(panel)
      .getByRole('button', { name: /Show all semantics/i })
      .click()
  })
  return within(panel).getByRole('group', { name: /Every other semantic/i })
}

const category = (offer: HTMLElement, name: string): HTMLElement =>
  within(offer).getByRole('group', { name })

/**
 * Every chip in reading order, by the words a person sees on it.
 *
 * Filtered to the emphasis toggles by their own accessible name, because the
 * disclosure buttons ("Show all semantics", "Add a focus") sit in the same
 * subtree and are not chips.
 */
const chips = (scope: HTMLElement): string[] =>
  within(scope)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Emphasise '))
    .map((label) => label.slice('Emphasise '.length))

// ------------------------------------------------------------ the four kinds

describe('the whole vocabulary, in categories', () => {
  it('files a curated behaviour under Mechanics', async () => {
    const offer = await everyOther()
    expect(
      within(category(offer, 'Mechanics')).getByLabelText('Emphasise lands entering'),
    ).toBeDefined()
  })

  it('files a keyword under Keywords', async () => {
    const offer = await everyOther()
    expect(within(category(offer, 'Keywords')).getByLabelText('Emphasise flying')).toBeDefined()
  })

  it('files a subtype under Types', async () => {
    const offer = await everyOther()
    expect(within(category(offer, 'Types')).getByLabelText('Emphasise Elves')).toBeDefined()
  })

  it('files every chip into exactly one category, and loses none of them', async () => {
    /*
     * The partition. A chip in two categories is two controls claiming one
     * focus, and a chip in none has quietly vanished from the only screen that
     * offers it — which is what a fourth generated family would do if
     * `semanticCategory` grew one and this UI did not.
     *
     * Counted rather than compared by name: `readable('treasure')` and
     * `readable('ability:treasure')` are both the word "treasure", so the
     * labels are not unique even though the tags are. That is a pre-existing
     * collision between the curated table and the derived one and it is not
     * this change's to fix, but a set of labels cannot stand in for a set of
     * tags while it holds.
     */
    const offer = await everyOther()
    const total = chips(offer).length
    const parts = ['Mechanics', 'Keywords', 'Types'].map((n) => chips(category(offer, n)).length)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    // 27 events, 317 keywords and 269 subtypes, less the two the commander
    // already offers above this list.
    expect(total).toBe(611)
  })

  it('leads with Mechanics, which is the shortest list and the most useful', async () => {
    // The category ORDER is fixed and deliberately not alphabetical: 27
    // curated behaviours are what a deck is usually about, and 586 generated
    // keywords and subtypes are the long tail behind them.
    const offer = await everyOther()
    const order = within(offer)
      .getAllByRole('heading')
      .map((h) => h.textContent)
    expect(order).toEqual(['Every other semantic', 'Mechanics', 'Keywords', 'Types'])
  })
})

// ----------------------------------------------- what your colours cannot do

describe('the semantics nothing in your colours supports', () => {
  const unsupported = [
    { tag: 'subtype:elf', supporting: 0 },
    { tag: 'ability:flying', supporting: 0 },
    { tag: 'subtype:goblin', supporting: 0 },
    { tag: 'landfall', supporting: 0 },
    { tag: 'treasure', supporting: 40 },
  ]

  it('collects them into one category, whichever family each came from', async () => {
    const offer = await everyOther(unsupported)
    const none = category(offer, 'Not available in your colours')
    expect(within(none).getByLabelText('Emphasise Elves')).toBeDefined()
    expect(within(none).getByLabelText('Emphasise flying')).toBeDefined()
    expect(within(none).getByLabelText('Emphasise lands entering')).toBeDefined()
  })

  it('takes them OUT of the category they would otherwise be in', async () => {
    // A tag in both places is the defect this replaces wearing a heading.
    const offer = await everyOther(unsupported)
    expect(within(category(offer, 'Types')).queryByLabelText('Emphasise Elves')).toBeNull()
    expect(within(category(offer, 'Keywords')).queryByLabelText('Emphasise flying')).toBeNull()
    expect(
      within(category(offer, 'Mechanics')).queryByLabelText('Emphasise lands entering'),
    ).toBeNull()
  })

  it('still offers them, because emphasis reorders and never filters', async () => {
    const offer = await everyOther(unsupported)
    const toggle = within(offer).getByLabelText('Emphasise Elves') as HTMLButtonElement
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves a tag the counts do not mention where it was — silence is not a zero', async () => {
    // ADR-0050. `treasure` was counted; `subtype:elf` was counted at zero;
    // `subtype:beast` was not counted at all, and that is the absence of a fact
    // rather than the fact that there is nothing.
    const offer = await everyOther(unsupported)
    expect(within(category(offer, 'Types')).getByLabelText('Emphasise Beasts')).toBeDefined()
    expect(within(category(offer, 'Mechanics')).getByLabelText('Emphasise treasure')).toBeDefined()
  })

  it('says it once, under the heading, instead of once under every chip', async () => {
    const offer = await everyOther(unsupported)
    // Four unsupported tags. The old markup printed this sentence four times.
    expect(within(offer).getAllByText(/nothing in your colours/i)).toHaveLength(1)
    expect(offer.querySelectorAll('.offer-unsupported')).toHaveLength(0)
  })

  it('makes no such claim where nothing has been counted', async () => {
    // The start screen: no deck exists, so no pool has been counted. Three
    // categories, and the fourth is not a claim this screen can make.
    mocked.searchCards.mockResolvedValue({ items: [commander] })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    const box = screen.getByLabelText('Commander') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, 'Tergrid')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await act(async () => {
      screen.getByText('Choose').click()
    })
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
    await act(async () => {
      screen.getByRole('button', { name: /Show all semantics/i }).click()
    })

    const offer = screen.getByRole('group', { name: /Every other semantic/i })
    expect(category(offer, 'Mechanics')).toBeDefined()
    expect(category(offer, 'Keywords')).toBeDefined()
    expect(category(offer, 'Types')).toBeDefined()
    expect(within(offer).queryByRole('group', { name: 'Not available in your colours' })).toBeNull()
  })
})

// ------------------------------------------------------------------- order

describe('the order inside a category', () => {
  it('sorts by the words on the chip, not by the wire spelling of the tag', async () => {
    /*
     * The whole reason this is asserted. `subtype:elf` reads "Elves" and has to
     * sort under E — the tag's own spelling would file every subtype under S,
     * behind every `ability:` in the mixed category, which is an order that
     * means nothing to the person reading it.
     *
     * `localeCompare` and not `<`: by code point "Goblins" (G, 71) sorts before
     * "flying" (f, 102), because every keyword is lowercased and every subtype
     * is capitalised. Three orders are distinguishable here and only one is
     * alphabetical:
     *
     *   wire spelling   flying, Elves, Goblins
     *   code point      Elves, Goblins, flying
     *   alphabetical    Elves, flying, Goblins
     */
    const offer = await everyOther([
      { tag: 'subtype:goblin', supporting: 0 },
      { tag: 'ability:flying', supporting: 0 },
      { tag: 'subtype:elf', supporting: 0 },
    ])
    expect(chips(category(offer, 'Not available in your colours'))).toEqual([
      'Elves',
      'flying',
      'Goblins',
    ])
  })

  it('sorts a content category the same way, and not by canonical tag order', async () => {
    // `SYNERGY_TAGS` order is the persisted contract and is append-only, so
    // `self-lifeloss` sits last in it and `creature-death` first. Alphabetical
    // by label reverses exactly that.
    const offer = await everyOther()
    const mechanics = chips(category(offer, 'Mechanics'))
    expect(mechanics).toEqual([...mechanics].sort((a, b) => a.localeCompare(b, 'en')))
    expect(mechanics.indexOf('a creature dying')).toBeLessThan(
      mechanics.indexOf('losing your own life'),
    )
  })
})

// ------------------------------------------------------- an empty category

describe('a category with nothing in it', () => {
  it('draws no heading, because a heading over nothing is a promise of nothing', async () => {
    /*
     * "Related to your focus" is read off `INTERACTION_PAIRS`, which is
     * event-only by construction — so that offer can only ever contain
     * mechanics, and Keywords and Types are empty there every single time.
     */
    mocked.getRecommendations.mockResolvedValue(
      recs({ emphasis: [{ tag: 'opponent-sacrifice', supporting: 5 }] }),
    )
    await mount(deck({ semanticEmphasis: ['opponent-sacrifice'] }))
    const related = within(focusPanel()).getByRole('group', { name: /Related to your focus/i })

    expect(category(related, 'Mechanics')).toBeDefined()
    expect(within(related).queryByRole('group', { name: 'Keywords' })).toBeNull()
    expect(within(related).queryByRole('group', { name: 'Types' })).toBeNull()
    expect(within(related).queryByText('Keywords')).toBeNull()
    expect(within(related).queryByText('Types')).toBeNull()
  })
})

// ------------------------------------------------------------ R4, binding

describe('a screen reader is told which category it is in', () => {
  it('names every category group from a real heading it is associated with', async () => {
    const offer = await everyOther([{ tag: 'subtype:elf', supporting: 0 }])
    for (const name of ['Mechanics', 'Keywords', 'Types', 'Not available in your colours']) {
      const group = category(offer, name)
      const heading = within(offer).getByRole('heading', { name, level: 5 })
      // The association, not merely the presence of a heading nearby: a
      // visual heading with no programmatic link is the exact failure R4
      // exists to prevent.
      expect(group.getAttribute('aria-labelledby')).toBe(heading.id)
      expect(group.contains(heading)).toBe(true)
    }
  })

  it('nests them inside the offer, so the offer’s own heading still governs', async () => {
    // Four sibling groups would leave a reader who tabs into "Elves" with no
    // way to hear that they are inside "Every other semantic" at all.
    const offer = await everyOther()
    expect(offer.getAttribute('role')).toBe('group')
    expect(within(offer).getByRole('heading', { level: 4 }).textContent).toBe(
      'Every other semantic',
    )
    expect(offer.contains(category(offer, 'Types'))).toBe(true)
  })
})

// -------------------------------------------- the commander's own semantics

describe('the commander’s own semantics are left alone', () => {
  const choose = async (c: api.Card): Promise<void> => {
    mocked.searchCards.mockResolvedValue({ items: [c] })
    mocked.hydrate.mockResolvedValue({
      cards: new Map([['cmd', c]]),
      prices: new Map([['cmd', 1.5]]),
      images: new Map(),
    } satisfies api.Hydrated)
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    const box = screen.getByLabelText('Commander') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, 'Tergrid')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await act(async () => {
      screen.getByText('Choose').click()
    })
    await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
  }

  it('keeps the commander’s own order, which is that commander’s story', async () => {
    // `synergyHas`, then produces, then wants — membership first, per ADR-0048.
    // Alphabetically this list is exactly backwards, so any sort would show.
    await choose(crossFamily)
    const prompt = screen.getByText(/What is this deck about/i).closest('section')
    expect(prompt).not.toBeNull()
    expect(chips(prompt as HTMLElement)).toEqual(['trample', 'making tokens', 'a creature dying'])
  })

  it('puts no category headings over it, though its tags span all three', async () => {
    await choose(crossFamily)
    expect(screen.queryByRole('group', { name: 'Mechanics' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Keywords' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Types' })).toBeNull()
  })
})
