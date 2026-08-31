// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Rules text in the preview pane, which is where a card is actually read.
 *
 * Two defects, both about the text being one undifferentiated run. Abilities
 * were separated by a newline and nothing else, so three abilities read as
 * three touching lines; and the faces of a double-faced card were joined with
 * that SAME newline, so the back face's text continued the front's sentence
 * with nothing to mark the change of side.
 *
 * The component tests in `@roundtable/ui` cover the rendering. This one covers
 * the wiring: the preview has to hand the component the faces, and it is the
 * only place that can — the boundary cannot be recovered from `oracleText`.
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

/*
 * Fire // Ice is the card that proves the point: Fire has one ability, Ice has
 * two, and `oracleText` separates all three with the same newline. Anything
 * that split the joined string would rule its line in the wrong place.
 */
const FIRE = 'Fire deals 2 damage divided as you choose among one or two targets.'
const ICE = 'Tap target permanent.\nDraw a card.'

const fireIce: api.Card = {
  oracleId: 'o1',
  name: 'Fire // Ice',
  manaCost: '{1}{R}',
  manaValue: 4,
  typeLine: 'Instant // Instant',
  types: ['instant'],
  oracleText: `${FIRE}\n${ICE}`,
  oracleTextFaces: [FIRE, ICE],
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: ['U', 'R'],
  primaryRole: 'removal',
  edhrecRank: 900,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
}

beforeEach(() => {
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
      histogram: [0, 0, 1, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 1, pricedCards: 1, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['o1', fireIce]]),
    prices: new Map([['o1', 1]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...fireIce,
    printings: [],
    combos: [],
  } as unknown as api.CardDetail)
})

afterEach(cleanup)

const openPreview = async (): Promise<HTMLElement> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByLabelText('Preview Fire // Ice')).toBeTruthy())
  await act(async () => screen.getByLabelText('Preview Fire // Ice').click())
  return await screen.findByLabelText('Fire // Ice details')
}

describe('the preview pane spaces the rules text out', () => {
  it('gives each ability its own block', async () => {
    const preview = await openPreview()
    expect(preview.querySelectorAll('.rt-oracle-ability')).toHaveLength(3)
  })

  it('rules one line between the faces, at the face boundary', async () => {
    const preview = await openPreview()
    const blocks = [...preview.querySelectorAll('.rt-oracle-ability, .rt-oracle-facebreak')]
    // One rule, and it sits after the FIRST ability, not after every newline.
    expect(blocks.map((b) => b.className)).toEqual([
      'rt-oracle-ability',
      'rt-oracle-facebreak',
      'rt-oracle-ability',
      'rt-oracle-ability',
    ])
  })

  it('says the face changed for a screen reader as well', async () => {
    const preview = await openPreview()
    expect(preview.textContent).toContain('Other face:')
  })
})
