// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace, legalityText, unavailableLabel } from './App'

/**
 * The Legality section, and the "Not computed" list beside it.
 *
 * Both were rendering internal keys at people. Legality printed `{p.kind}`
 * directly, so the rail read `wrong-card-count` — and worse, a `color-identity`
 * problem told a builder there was an illegal card in the deck WITHOUT NAMING
 * IT, because the problem carries an `oracleId` and no name. The names are in
 * the hydrated `cards` map the deck list is already drawn from.
 *
 * "Not computed" leaked the domain's `top-<type>` placeholder, angle brackets
 * included, as though it were the name of a feature.
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

const KRENKO = '4c7a4a1f-9d15-4b0a-8f0a-1f5f2a3b4c5d'

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{2}{R}{R}',
  manaValue: 4,
  typeLine: 'Legendary Creature — Goblin Warrior',
  types: ['creature'],
  colors: ['R'],
  oracleText: '',
  power: '3',
  toughness: '3',
  loyalty: null,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const cards = new Map([[KRENKO, card(KRENKO, 'Krenko, Mob Boss')]])

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
  entries: [{ oracleId: KRENKO, zone: 'accepted', locked: false }],
}

/**
 * The "Not computed" list is fed from the RECOMMENDATIONS response, not the
 * analysis — both carry an `unavailable` array and only one of them reaches
 * this panel.
 */
const recsWithUnavailable = (unavailable: { key: string; reason: string }[]): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable,
    query: { matched: 0, total: 0, errors: [] },
  }) as unknown as api.Recommendations

const analysisWith = (problems: api.LegalityProblem[]): api.Analysis =>
  ({
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
    legality: { legal: problems.length === 0, problems },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 1, budget: null },
    unavailable: [],
  }) as unknown as api.Analysis

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.hydrate.mockResolvedValue({
    cards,
    prices: new Map([[KRENKO, 2]]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

describe('the Legality section', () => {
  it('never renders a bare enum key', async () => {
    mocked.getAnalysis.mockResolvedValue(
      analysisWith([{ kind: 'wrong-card-count', actual: 73, expected: 100 }]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText(/27 cards short of 100/)).toBeTruthy())
    expect(document.body.textContent).not.toContain('wrong-card-count')
  })

  it('names the illegal card, because "a card is illegal" is not actionable', async () => {
    mocked.getAnalysis.mockResolvedValue(
      analysisWith([{ kind: 'color-identity', oracleId: KRENKO, offending: ['U'] }]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() =>
      expect(screen.getByText(/Krenko, Mob Boss is outside your commander's colour identity/)),
    )
    expect(document.body.textContent).not.toContain('color-identity')
    // The offending colour is part of the answer, not decoration.
    expect(document.body.textContent).toContain('(U)')
  })

  it('says so honestly when the card is not one this view has loaded', async () => {
    // The alternative was printing a truncated uuid, which tells a person
    // holding a pile of cardboard precisely nothing.
    mocked.getAnalysis.mockResolvedValue(
      analysisWith([{ kind: 'banned', oracleId: 'ffffffff-0000-0000-0000-000000000000' }]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText(/is banned in Commander/)).toBeTruthy())
    expect(document.body.textContent).toContain('A card this view has not loaded')
    expect(document.body.textContent).not.toContain('ffffffff')
  })
})

describe('the "Not computed" list', () => {
  it('does not leak the `top-<type>` placeholder', async () => {
    mocked.getAnalysis.mockResolvedValue(analysisWith([]))
    mocked.getRecommendations.mockResolvedValue(
      recsWithUnavailable([{ key: 'top-<type>', reason: 'statistics source unavailable' }]),
    )
    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText(/Most-played, by card type/)).toBeTruthy())
    expect(document.body.textContent).not.toContain('top-<type>')
    // The server's own sentence still carries the WHY; only the name changed.
    expect(document.body.textContent).toContain('statistics source unavailable')
  })
})

describe('the wording itself', () => {
  it('covers every kind the domain declares', () => {
    // `packages/domain/src/legality.ts` — kept in step by hand, which is why
    // this list is written out rather than derived. If the domain gains a kind
    // and nobody updates `legalityText`, this test still passes and the
    // fallback below is what the user sees: readable, and not an enum key.
    const kinds = [
      'wrong-card-count',
      'not-singleton',
      'banned',
      'not-legal-in-commander',
      'color-identity',
      'no-commander',
      'too-many-commanders',
      'invalid-commander',
      'invalid-partnership',
      'unknown-card',
    ]
    for (const kind of kinds) {
      const text = legalityText({ kind, oracleId: KRENKO }, cards)
      // No hyphenated key survives into the sentence. (`banned` is a real
      // English word and is expected to appear — the test is that the KEY
      // does not, and a one-word key is indistinguishable from prose.)
      expect(text).not.toMatch(/[a-z]+-[a-z]/)
      expect(text.endsWith('.')).toBe(true)
      expect(text).toContain(' ')
    }
  })

  it('degrades a kind from a newer server to English, not to the key', () => {
    const text = legalityText({ kind: 'some-future-rule', oracleId: KRENKO }, cards)
    expect(text).toBe('Some future rule — Krenko, Mob Boss')
  })

  it('counts a deck that is over 100 as over, not as a negative shortfall', () => {
    expect(legalityText({ kind: 'wrong-card-count', actual: 104, expected: 100 }, cards)).toBe(
      '4 cards over 100 — the deck has 104.',
    )
  })

  it('humanises an unavailable key it has no name for', () => {
    expect(unavailableLabel('some-future-source')).toBe('Some future source')
    expect(unavailableLabel('top-<type>')).toBe('Most-played, by card type')
  })
})
