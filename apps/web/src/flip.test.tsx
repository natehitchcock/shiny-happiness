// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace, artFromPrintings } from './App'

/**
 * The flip control, from the wire to the screen (ADR-0027).
 *
 * The component tests in `@roundtable/ui` already cover how the control draws
 * and what it announces; every one of them would have passed on a day when the
 * app never handed a `backImageUris` to a primitive at all — which is exactly
 * the state the wire types were left in, declared and undrawn. These are the
 * wiring tests, and they are written around the three states ADR-0027 keeps
 * apart, because a fixture set of only double-faced cards cannot detect the
 * first and one of only resolved art cannot detect the third.
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
 * The real URLs for Delver of Secrets, as the local corpus holds them. They
 * differ by exactly one path segment — `/front/` against `/back/` — which is
 * what makes "the picture changed" and "the picture is the OTHER side" two
 * different assertions rather than one.
 */
const FRONT = 'https://cards.scryfall.io/normal/front/6/9/6904ea20.jpg?1783908173'
const BACK = 'https://cards.scryfall.io/normal/back/6/9/6904ea20.jpg?1783908173'
const FRONT_ART = 'https://cards.scryfall.io/art_crop/front/6/9/6904ea20.jpg?1783908173'
const BACK_ART = 'https://cards.scryfall.io/art_crop/back/6/9/6904ea20.jpg?1783908173'

const DELVER_TEXT = 'At the beginning of your upkeep, look at the top card of your library.'

const card = (over: Partial<api.Card> = {}): api.Card => ({
  oracleId: 'o1',
  name: 'Delver of Secrets // Insectile Aberration',
  manaCost: '{U}',
  manaValue: 1,
  typeLine: 'Creature — Human Wizard',
  types: ['creature'],
  colors: ['U'],
  oracleText: `${DELVER_TEXT}\nFlying`,
  oracleTextFaces: [DELVER_TEXT, 'Flying'],
  power: '1',
  toughness: '1',
  loyalty: null,
  colorIdentity: ['U'],
  primaryRole: 'wincon',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

/**
 * State one, as a whole card rather than as an override.
 *
 * Written out instead of `card({ oracleTextFaces: undefined })` because under
 * `exactOptionalPropertyTypes` an explicit `undefined` is a different type from
 * an absent key — and an absent key is what a single-faced card actually sends.
 */
const solRing = (): api.Card => ({
  oracleId: 'o2',
  name: 'Sol Ring',
  manaCost: '{1}',
  manaValue: 1,
  typeLine: 'Artifact',
  types: ['artifact'],
  colors: [],
  oracleText: '{T}: Add {C}{C}.',
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: [],
  primaryRole: 'ramp',
  edhrecRank: 1,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: [],
  colorIdentity: ['U'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [
    { oracleId: 'o1', zone: 'accepted', locked: false },
    { oracleId: 'o2', zone: 'accepted', locked: false },
  ],
}

/** State two: two physical faces, and we have both pictures. */
const twoFacesResolved: api.ImageUris = {
  artCrop: FRONT_ART,
  normal: FRONT,
  back: { artCrop: BACK_ART, normal: BACK },
}

/** State three: two physical faces, no picture of the back. */
const twoFacesUnresolvedBack: api.ImageUris = {
  artCrop: FRONT_ART,
  normal: FRONT,
  back: { artCrop: null, normal: null },
}

/** State three at its worst: a second side, and no picture of either face. */
const twoFacesNoArtAtAll: api.ImageUris = {
  artCrop: null,
  normal: null,
  back: { artCrop: null, normal: null },
}

/** State one: one physical face. No `back` key at all — absence is the answer. */
const oneFace: api.ImageUris = { artCrop: FRONT_ART, normal: FRONT }

const hydrated = (images: Map<string, api.ImageUris>): api.Hydrated => ({
  cards: new Map([
    ['o1', card()],
    ['o2', solRing()],
  ]),
  prices: new Map([
    ['o1', 1.25],
    ['o2', 2.5],
  ]),
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
    prices: { deckTotalUsd: 3.75, pricedCards: 2, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue(
    hydrated(
      new Map([
        ['o1', twoFacesResolved],
        ['o2', oneFace],
      ]),
    ),
  )
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...card(),
    printings: [{ printingId: 'p1', setCode: 'tst', setName: 'Test', rarity: 'rare', priceUsd: 1 }],
    combos: [],
  } as unknown as api.CardDetail)
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const openPreview = async (name: string): Promise<HTMLElement> => {
  await waitFor(() => expect(screen.getByLabelText(`Preview ${name}`)).toBeTruthy())
  await act(async () => screen.getByLabelText(`Preview ${name}`).click())
  return await screen.findByLabelText(`${name} details`)
}

const flip = (within: HTMLElement): void => {
  const button = within.querySelector<HTMLButtonElement>('.rt-flip')
  if (button === null) throw new Error('no flip control on screen')
  fireEvent.click(button)
}

describe('the preview pane — state one: one physical face', () => {
  it('offers no flip control for an ordinary card', async () => {
    // Sol Ring has one side. A control asking about a second would be the app
    // claiming something about the card that is not true.
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Sol Ring')
    expect(preview.querySelector('.rt-flip')).toBeNull()
  })
})

describe('the preview pane — state two: a back face, with art', () => {
  it('draws the front first, because the front is the card', async () => {
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(FRONT)
  })

  it('shows the back face, at a URL that is genuinely the other side', async () => {
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    flip(preview)
    const src = preview.querySelector('img')?.getAttribute('src')
    expect(src).toBe(BACK)
    expect(src).not.toBe(FRONT)
    expect(src).toContain('/back/')
  })

  it('names the face it will show, so the control is not a bare glyph (R4)', async () => {
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.querySelector('.rt-flip')?.getAttribute('aria-label')).toBe(
      'Show the back face: Insectile Aberration',
    )
    flip(preview)
    expect(preview.querySelector('.rt-flip')?.getAttribute('aria-label')).toBe(
      'Show the front face: Delver of Secrets',
    )
  })

  it('names the face on screen in the image alt text', async () => {
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.querySelector('img')?.getAttribute('alt')).toBe('Delver of Secrets')
    flip(preview)
    expect(preview.querySelector('img')?.getAttribute('alt')).toBe('Insectile Aberration')
  })

  it('leaves both faces of the rules text on screen either way', async () => {
    // `OracleText` already draws both faces with the boundary marked. The
    // picture flips because an <img> holds one face; the text has no such
    // limit, and hiding half of it on flip would take information away.
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    const before = preview.querySelectorAll('.rt-oracle-ability').length
    expect(before).toBe(2)
    expect(preview.querySelector('.rt-oracle-facebreak')).not.toBeNull()
    flip(preview)
    expect(preview.querySelectorAll('.rt-oracle-ability')).toHaveLength(before)
    expect(preview.querySelector('.rt-oracle-facebreak')).not.toBeNull()
  })

  it('goes back to the front when the pane moves to another card', async () => {
    // A card left flipped while you browse to another is a bug, not a feature.
    // The pane's own heading names the front, and "flipped" cannot be a stable
    // mode when nine cards in ten have no back to hold it.
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    flip(preview)
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(BACK)

    await openPreview('Sol Ring')
    const back = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(back.querySelector('img')?.getAttribute('src')).toBe(FRONT)
  })
})

describe('the preview pane — state three: a back face, and no picture of it', () => {
  it('still offers the control, because the card really does have another side', async () => {
    // The collapse this guards against: spelling "no picture" the same way as
    // "no second face" would make a transform card whose art failed to resolve
    // indistinguishable from Sol Ring.
    mocked.hydrate.mockResolvedValue(
      hydrated(
        new Map([
          ['o1', twoFacesUnresolvedBack],
          ['o2', oneFace],
        ]),
      ),
    )
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.querySelector('.rt-flip')).not.toBeNull()
  })

  it('shows an honest panel rather than a broken image', async () => {
    mocked.hydrate.mockResolvedValue(
      hydrated(
        new Map([
          ['o1', twoFacesUnresolvedBack],
          ['o2', oneFace],
        ]),
      ),
    )
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    flip(preview)
    expect(preview.querySelector('img')).toBeNull()
    expect(preview.textContent).toContain('No picture of this face.')
    expect(preview.textContent).toContain('Insectile Aberration')
  })

  it('offers the control even when neither face has a picture', async () => {
    /*
     * The regression that shipped with the wire types: the pane drew its card
     * face only `if (view.imageUris !== undefined)`, and `viewImageUris`
     * collapses a pair of nulls to undefined. A two-faced card with no resolved
     * art therefore lost its second side along with its picture — the third
     * state silently becoming the first, in the one surface that was supposed
     * to tell them apart.
     */
    mocked.hydrate.mockResolvedValue(
      hydrated(
        new Map([
          ['o1', twoFacesNoArtAtAll],
          ['o2', oneFace],
        ]),
      ),
    )
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.querySelector('.rt-flip')).not.toBeNull()
    expect(preview.textContent).toContain('Delver of Secrets')
    flip(preview)
    expect(preview.textContent).toContain('Insectile Aberration')
    expect(preview.querySelector('img')).toBeNull()
  })

  it('keeps the price on screen when the picture is a fallback panel', async () => {
    // ADR-0009 Q7. The number rides in the card face's badge row when a face is
    // drawn, and the face IS drawn here — over a fallback panel — so the note
    // must not print it a second time.
    mocked.hydrate.mockResolvedValue(
      hydrated(
        new Map([
          ['o1', twoFacesNoArtAtAll],
          ['o2', oneFace],
        ]),
      ),
    )
    render(<Workspace deck={deck} />)
    const preview = await openPreview('Delver of Secrets // Insectile Aberration')
    expect(preview.textContent).toContain('est.')
    expect(preview.textContent?.match(/\$1\.25/g) ?? []).toHaveLength(1)
  })
})

describe('artFromPrintings — a card the hydration maps never covered', () => {
  it('carries the back face beside the front', async () => {
    // The route that shows cards which are NOT candidates — "Cards named
    // like…" — has no hydration entry, so the pane reads the detail's
    // printings instead. A back face dropped on that path would be a flip
    // control that appears for a deck card and vanishes for a search result.
    expect(
      artFromPrintings([
        {
          imageUris: { artCrop: FRONT_ART, normal: FRONT },
          backImageUris: { artCrop: BACK_ART, normal: BACK },
        },
      ]),
    ).toEqual({
      artCrop: FRONT_ART,
      normal: FRONT,
      back: { artCrop: BACK_ART, normal: BACK },
    })
  })

  it('says there is a back with no picture, rather than saying there is none', async () => {
    expect(
      artFromPrintings([
        {
          imageUris: { artCrop: FRONT_ART, normal: FRONT },
          backImageUris: { artCrop: '', normal: '' },
        },
      ]),
    ).toEqual({
      artCrop: FRONT_ART,
      normal: FRONT,
      back: { artCrop: null, normal: null },
    })
  })

  it('adds no back key at all for a single-faced printing', async () => {
    const art = artFromPrintings([{ imageUris: { artCrop: FRONT_ART, normal: FRONT } }])
    expect(art).toEqual({ artCrop: FRONT_ART, normal: FRONT })
    expect(art !== undefined && 'back' in art).toBe(false)
  })
})
