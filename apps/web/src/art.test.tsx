// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App, Workspace } from './App'

/**
 * Card art, where it is drawn and where it deliberately is not (ADR-0021).
 *
 * The app shipped for four sessions with no card imagery at all: the URLs were
 * ingested, the primitives read them, and the API never sent them. These tests
 * are the wiring between those three — the component tests in `@roundtable/ui`
 * already cover how a card face draws, and they would all have passed on the
 * day nothing on screen had a picture on it.
 *
 * The "not" half is as deliberate as the "where". A deck rail is a hundred rows
 * scanned by name and section; art there makes the list three times longer to
 * scroll and answers no question anyone asks of it. Those tests exist so that
 * decision is visible rather than an omission somebody quietly fills in.
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

/** Scryfall's own CDN, which is the only host ADR-0021 permits. */
const ART = 'https://cards.scryfall.io/art_crop/front/1/2/krenko.jpg?1783903215'
const NORMAL = 'https://cards.scryfall.io/normal/front/1/2/krenko.jpg?1783903215'

const KRENKO_TEXT = 'Tap: Create X 1/1 red Goblin creature tokens.'

const card = (over: Partial<api.Card> = {}): api.Card => ({
  oracleId: 'o1',
  name: 'Krenko, Mob Boss',
  manaCost: '{2}{R}{R}',
  manaValue: 4,
  typeLine: 'Legendary Creature — Goblin Warrior',
  types: ['creature'],
  oracleText: KRENKO_TEXT,
  power: '3',
  toughness: '3',
  loyalty: null,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
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
  entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
}

const withArt = new Map<string, api.ImageUris>([['o1', { artCrop: ART, normal: NORMAL }]])
/** The 501-card case: no art on any printing, which is an answer, not a gap. */
const withoutArt = new Map<string, api.ImageUris>([['o1', { artCrop: null, normal: null }]])

const hydrated = (images: Map<string, api.ImageUris>): api.Hydrated => ({
  cards: new Map([['o1', card()]]),
  prices: new Map([['o1', 1.25]]),
  images,
})

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
    counts: { total: 1, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 4,
      histogram: [0, 0, 0, 0, 1, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 1.25, pricedCards: 1, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue(hydrated(withArt))
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...card(),
    printings: [{ printingId: 'p1', setCode: 'tst', setName: 'Test', rarity: 'rare', priceUsd: 1 }],
    combos: [],
  } as unknown as api.CardDetail)
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const openPreview = async (): Promise<HTMLElement> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByLabelText('Preview Krenko, Mob Boss')).toBeTruthy())
  await act(async () => screen.getByLabelText('Preview Krenko, Mob Boss').click())
  return await screen.findByLabelText('Krenko, Mob Boss details')
}

describe('the preview pane draws the card', () => {
  it('shows the full card image, at the URL the API sent', async () => {
    const preview = await openPreview()
    const image = preview.querySelector('img')
    expect(image?.getAttribute('src')).toBe(NORMAL)
    // `normal`, not `art_crop`: this is the level that shows a whole card.
    expect(image?.getAttribute('src')).not.toBe(ART)
  })

  it('lazily loads it and decodes it off the main thread', async () => {
    const preview = await openPreview()
    const image = preview.querySelector('img')
    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.getAttribute('decoding')).toBe('async')
  })

  it('reserves the box, so the rules text below does not jump when the art lands', async () => {
    const preview = await openPreview()
    const frame = preview.querySelector<HTMLElement>('.rt-face-image')
    expect(frame?.style.width).not.toBe('')
    expect(frame?.style.height).not.toBe('')
  })

  it('does not put a control in the tab order that opens nothing', async () => {
    // The details are already open around the card; a frame announcing itself
    // as "Open details" here would be a button that does nothing when pressed.
    const preview = await openPreview()
    expect(preview.querySelector('.rt-face-image')?.getAttribute('role')).toBeNull()
  })
})

describe('the preview pane with a card that has no art', () => {
  beforeEach(() => {
    mocked.hydrate.mockResolvedValue(hydrated(withoutArt))
  })

  it('draws no image at all, rather than an empty or broken one', async () => {
    const preview = await openPreview()
    expect(preview.querySelector('img')).toBeNull()
  })

  it('does not repeat the card in a fallback panel the pane already is', async () => {
    /*
     * `CardFace`'s no-art fallback is a card-shaped panel carrying the name, the
     * cost, the type line and the rules text. That is exactly right in a grid,
     * where nothing else says them, and exactly wrong here — the pane around it
     * says all four already, and rendering both printed the rules text twice.
     */
    const preview = await openPreview()
    const abilities = preview.querySelectorAll('.rt-oracle-ability')
    expect(abilities).toHaveLength(1)
  })

  it('states the price in words rather than losing it with the card face', async () => {
    // The price normally rides in the face's badge row. With no face there is no
    // badge row, and the one number in this pane that costs money must not be
    // the thing that silently disappears.
    const preview = await openPreview()
    expect(preview.textContent).toContain('$1.25')
    // ADR-0009 Q7: never a price without the word that says it is an estimate.
    expect(preview.textContent).toContain('est.')
  })
})

/**
 * The one route in the app that shows a card the deck has never hydrated.
 *
 * "Cards named like…" exists precisely to answer "is this card here" for a card
 * that is NOT a suggestion and NOT in the deck — so `images` and `prices` have
 * no entry for it, and the preview drew no art and a bare em dash directly
 * under a line reading "est. cheapest of 53 printings". The panel was counting
 * the printings and reading nothing else out of them.
 */
describe('a card opened from the name matches', () => {
  const STRANGER = 'o9'
  const P_ART = 'https://cards.scryfall.io/art_crop/front/9/9/shivan.jpg?1'
  const P_NORMAL = 'https://cards.scryfall.io/normal/front/9/9/shivan.jpg?1'

  const shivan = card({ oracleId: STRANGER, name: 'Shivan Dragon', oracleText: 'Flying.' })

  const openStranger = async (detail: Partial<api.CardDetail>): Promise<HTMLElement> => {
    mocked.searchCards.mockResolvedValue({ items: [shivan] })
    mocked.getCardDetail.mockResolvedValue({ ...shivan, combos: [], ...detail } as api.CardDetail)
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Filter suggestions')).toBeTruthy())

    const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, 'Shivan Dragon')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // The name-match list follows the COMMITTED query, not the draft — typing
    // no longer fires a recompute on its own.
    await act(async () => screen.getByLabelText(/^Run this filter/).click())
    await waitFor(() => expect(screen.getByText('Shivan Dragon')).toBeTruthy())
    await act(async () => screen.getByText('Shivan Dragon').click())
    return await screen.findByLabelText('Shivan Dragon details')
  }

  it('draws the art its printings carry, having none of its own hydrated', async () => {
    const preview = await openStranger({
      printings: [
        {
          printingId: 'p1',
          setCode: 'lea',
          setName: 'Limited Edition Alpha',
          rarity: 'rare',
          priceUsd: 1200,
          imageUris: { artCrop: P_ART, normal: P_NORMAL },
        },
      ],
    })
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(P_NORMAL)
  })

  it('prices it from the cheapest printing, not with an em dash', async () => {
    const preview = await openStranger({
      printings: [
        {
          printingId: 'p1',
          setCode: 'lea',
          setName: 'Alpha',
          rarity: 'rare',
          priceUsd: 1200,
          imageUris: { artCrop: '', normal: '' },
        },
        {
          printingId: 'p2',
          setCode: 'm10',
          setName: 'Magic 2010',
          rarity: 'rare',
          priceUsd: 0.45,
          imageUris: { artCrop: '', normal: '' },
        },
        {
          printingId: 'p3',
          setCode: 'unp',
          setName: 'Unpriced',
          rarity: 'rare',
          priceUsd: null,
          imageUris: { artCrop: '', normal: '' },
        },
      ],
    })
    // Cheapest, and `null` is skipped rather than sorting below everything.
    expect(preview.textContent).toContain('$0.45')
    expect(preview.textContent).toContain('cheapest of 3 printings')
  })

  it('treats an empty image string as no art, not as a URL', async () => {
    // `packages/db` writes '' for a printing with no cached image, and
    // `<img src="">` re-requests the page itself.
    const preview = await openStranger({
      printings: [
        {
          printingId: 'p1',
          setCode: 'lea',
          setName: 'Alpha',
          rarity: 'rare',
          priceUsd: 3,
          imageUris: { artCrop: '', normal: '' },
        },
      ],
    })
    expect(preview.querySelector('img')).toBeNull()
    // With no face to carry the badge, the price comes back into the note.
    expect(preview.textContent).toContain('$3.00')
  })

  it('survives a server whose printings carry no images key at all', async () => {
    const preview = await openStranger({
      printings: [
        { printingId: 'p1', setCode: 'lea', setName: 'Alpha', rarity: 'rare', priceUsd: 3 },
      ],
    })
    expect(preview.querySelector('img')).toBeNull()
    expect(preview.textContent).toContain('Shivan Dragon')
  })
})

describe('a card the deck HAS hydrated', () => {
  it('keeps the hydrated art and price, so its detail landing changes nothing', async () => {
    /*
     * The hydration maps stay the first source on purpose. `images` is the
     * DEFAULT printing (ADR-0021) and `prices` is the server's own cheapest; if
     * the printings won, a card would swap its picture and its price a moment
     * after opening, for no reason the reader could see.
     */
    mocked.getCardDetail.mockResolvedValue({
      ...card(),
      printings: [
        {
          printingId: 'p1',
          setCode: 'other',
          setName: 'Other',
          rarity: 'rare',
          priceUsd: 99,
          imageUris: {
            artCrop: 'https://cards.scryfall.io/art_crop/front/0/0/other.jpg?1',
            normal: 'https://cards.scryfall.io/normal/front/0/0/other.jpg?1',
          },
        },
      ],
      combos: [],
    } as unknown as api.CardDetail)
    const preview = await openPreview()

    expect(preview.querySelector('img')?.getAttribute('src')).toBe(NORMAL)
    expect(preview.textContent).not.toContain('$99.00')
  })
})

describe('where art is deliberately absent', () => {
  it('leaves the deck rail as text', async () => {
    /*
     * A deck is around a hundred rows and the rail is how you find a card you
     * already own, by name, under its section heading. A thumbnail per row
     * triples the scroll length to answer a question nobody asks of that list.
     * If this fails because art was added there on purpose, the decision in
     * ADR-0021 is what needs revising — not this test, quietly.
     */
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Krenko, Mob Boss')).toBeTruthy())
    const rail = screen.getByLabelText('Preview Krenko, Mob Boss').closest('.card-row')
    expect(rail?.querySelector('img')).toBeNull()
  })
})

describe('the start screen confirms the commander with its card', () => {
  const type = async (text: string): Promise<void> => {
    const box = screen.getByLabelText('Commander') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const chooseKrenko = async (images: Record<string, api.ImageUris>): Promise<void> => {
    mocked.searchCards.mockResolvedValue({ items: [card()], images })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await waitFor(() => expect(screen.getByLabelText('Choose Krenko, Mob Boss')).toBeDefined())
    await act(async () => {
      screen.getByLabelText('Choose Krenko, Mob Boss').click()
    })
  }

  it('shows the chosen commander as a card, not only as a name in a text box', async () => {
    // "Krenko" is four different legends. Every screen after this one assumes
    // the right one was picked.
    await chooseKrenko({ o1: { artCrop: ART, normal: NORMAL } })

    await waitFor(() => expect(screen.getByAltText('Krenko, Mob Boss')).toBeDefined())
    expect(screen.getByAltText('Krenko, Mob Boss').getAttribute('src')).toBe(NORMAL)
  })

  it('keeps the search results themselves as text', async () => {
    // Eight art crops to choose between candidates the reader distinguished by
    // typing a name is eight requests for nothing. Art earns its space at the
    // moment the choice is made, not while it is being made.
    mocked.searchCards.mockResolvedValue({
      items: [card()],
      images: { o1: { artCrop: ART, normal: NORMAL } },
    })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })

    await waitFor(() => expect(screen.getByLabelText('Choose Krenko, Mob Boss')).toBeDefined())
    expect(document.querySelector('.start-results img')).toBeNull()
  })

  it('still names the commander when it has no art', async () => {
    // Here the fallback panel IS wanted — unlike the preview pane, nothing else
    // on this screen says what the chosen card is.
    await chooseKrenko({ o1: { artCrop: null, normal: null } })

    await waitFor(() => expect(document.querySelector('.start-chosen')).not.toBeNull())
    expect(document.querySelector('.start-chosen img')).toBeNull()
    expect(document.querySelector('.rt-face-text')?.textContent).toContain('Krenko, Mob Boss')
  })

  it('survives a server that does not send art at all', async () => {
    // A deployment running an API from before ADR-0021 answers with no `images`
    // key. The page must show a card with no picture, not fail to render.
    mocked.searchCards.mockResolvedValue({ items: [card()] })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')
    await act(async () => {
      screen.getByLabelText(/^Run this search/).click()
    })
    await waitFor(() => expect(screen.getByLabelText('Choose Krenko, Mob Boss')).toBeDefined())
    await act(async () => {
      screen.getByLabelText('Choose Krenko, Mob Boss').click()
    })

    await waitFor(() => expect(document.querySelector('.start-chosen')).not.toBeNull())
    expect(document.querySelector('.start-chosen img')).toBeNull()
  })
})
