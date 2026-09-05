// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App, Workspace } from './App'

/**
 * The qualifier, on the chip the reader is choosing from (ADR-0062).
 *
 * ADR-0057 derived the restriction and put it in the suggestion's reason, and
 * that was the ONLY place it was ever rendered: a parenthetical inside a
 * sentence about a card the builder has not chosen yet. Picking a focus is the
 * moment the restriction matters — "casting spells" and "casting spells
 * (instant or sorcery)" are different decks — and nothing on the focus prompt
 * said the difference existed.
 *
 * The agreement rule is asserted here as well as in the domain, because the two
 * are different questions: the domain owns whether a set of wanters agrees, and
 * this owns whether the screen actually asks it before printing.
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
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Legendary Creature — Minotaur Shaman',
  types: ['creature'],
  colors: ['R'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'synergy',
  edhrecRank: null,
  universesBeyond: false,
  power: '3',
  toughness: '3',
  loyalty: null,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

/** Zaffai's shape: one want, one restriction, stated on the trigger. */
const zaffai = card({
  oracleId: 'zaffai',
  name: 'Zaffai, Thunder Conductor',
  oracleText:
    'Whenever you cast an instant or sorcery spell, ' +
    'scry X, where X is the amount of mana spent to cast it.',
  synergyWants: ['spell-cast'],
})

/** Guttersnipe's: the same want, and no restriction on it at all. */
const guttersnipe = card({
  oracleId: 'snipe',
  name: 'Guttersnipe',
  oracleText: 'Whenever you cast a spell, Guttersnipe deals 2 damage to each opponent.',
  synergyWants: ['spell-cast'],
})

/** A partner who wants the same tag on DIFFERENT terms. */
const veyran = card({
  oracleId: 'veyran',
  name: 'Veyran, Voice of Duality',
  oracleText: 'Whenever you cast a noncreature spell, put a +1/+1 counter on Veyran.',
  synergyWants: ['spell-cast'],
})

const deck = (over: Partial<api.Deck> = {}): api.Deck => ({
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['zaffai'],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
  ...over,
})

const analysis = {
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
} as unknown as api.Analysis

const recs = {
  datasetSnapshotId: null,
  emphasis: [],
  tagSupport: [],
  groups: [],
  columns: [],
  unavailable: [],
  query: { matched: 0, total: 0, errors: [] },
} as unknown as api.Recommendations

/** Every card the test names, hydrated and detailed from one place. */
const serve = (...cards: readonly api.Card[]): void => {
  mocked.hydrate.mockResolvedValue({
    cards: new Map(cards.map((c) => [c.oracleId, c])),
    prices: new Map(cards.map((c) => [c.oracleId, 1])),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.getCardDetail.mockImplementation((id: string) =>
    Promise.resolve({
      ...(cards.find((c) => c.oracleId === id) ?? cards[0]!),
      printings: [],
      combos: [],
    } as unknown as api.CardDetail),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(recs)
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
  serve(zaffai)
})

afterEach(cleanup)

// ------------------------------------------------ the prompt at the start

/** Pick a commander on the start screen, exactly as a person does. */
const choose = async (commander: api.Card): Promise<void> => {
  serve(commander)
  mocked.searchCards.mockResolvedValue({ items: [commander] })
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
  const box = screen.getByLabelText('Commander') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, commander.name)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    screen.getByLabelText(/^Run this search/).click()
  })
  await waitFor(() => expect(screen.getByText('Choose')).toBeDefined())
  await act(async () => {
    screen.getByText('Choose').click()
  })
  await waitFor(() => expect(screen.getByText(/What is this deck about/i)).toBeDefined())
}

describe('the commander’s own semantic carries its qualifier', () => {
  it('says which spells count, on the chip being offered', async () => {
    await choose(zaffai)
    // The tag's words, then the restriction — the same shape the suggestion
    // reason prints, so the two surfaces read as one claim.
    expect(screen.getByText('casting spells (instant or sorcery)')).toBeDefined()
  })

  it('leaves an unrestricted want exactly as it was', async () => {
    // Guttersnipe takes any spell. A parenthesis here would be an invention,
    // and the absence of one is the honest wider claim.
    await choose(guttersnipe)
    expect(screen.getByText('casting spells')).toBeDefined()
    expect(screen.queryByText(/casting spells \(/)).toBeNull()
  })
})

// ------------------------------------------------- two commanders, one tag

/**
 * Open the workspace's own copy of the offer — the disclosure under Focus.
 *
 * Waits for the commanders to HYDRATE before pressing, not merely for the
 * button to exist: the offered vocabulary is built from the hydrated cards, so
 * a press before they land opens an empty disclosure and the assertion below
 * would be testing the loading state by accident.
 */
const openAddFocus = async (d: api.Deck, lastCommander: string): Promise<void> => {
  render(<Workspace deck={d} />)
  await waitFor(() => expect(screen.getAllByText(lastCommander).length).toBeGreaterThan(0))
  await act(async () => {
    screen.getByText('Add a focus').click()
  })
}

describe('partners have to agree before a restriction is printed', () => {
  it('drops it when the two commanders want the tag on different terms', async () => {
    // "instant or sorcery" and "noncreature" are two restrictions and not one.
    // Printing either would be a claim about the card the reader is not
    // looking at, so the pair keeps the wider true sentence.
    serve(zaffai, veyran)
    await openAddFocus(deck({ commanders: ['zaffai', 'veyran'] }), 'Veyran, Voice of Duality')
    expect(screen.getByText('casting spells')).toBeDefined()
    expect(screen.queryByText(/casting spells \(/)).toBeNull()
  })

  it('drops it when one partner wants the tag unrestricted', async () => {
    // The pair genuinely wants any spell, because Guttersnipe takes any spell.
    // An unqualified wanter counts toward the total and never toward the
    // covered weight, so the qualified partner cannot speak for both.
    serve(zaffai, guttersnipe)
    await openAddFocus(deck({ commanders: ['zaffai', 'snipe'] }), 'Guttersnipe')
    expect(screen.getByText('casting spells')).toBeDefined()
    expect(screen.queryByText(/casting spells \(/)).toBeNull()
  })

  it('keeps it when the only commander is the restricted one', async () => {
    serve(zaffai)
    await openAddFocus(deck({ commanders: ['zaffai'] }), 'Zaffai, Thunder Conductor')
    expect(screen.getByText('casting spells (instant or sorcery)')).toBeDefined()
  })
})

// ------------------------------------------------------- the card panel

describe('the card panel reads the restriction off the card in front of you', () => {
  /*
   * Bonus Round, which is on BOTH sides of one tag.
   *
   * It is a sorcery, so it produces `spell-cast` by its type line, and its
   * trigger wants `spell-cast` restricted to instants and sorceries. That is
   * what makes the direction guard below testable at all: with the tag on one
   * row only, a chip that ignored the direction would render identically.
   */
  const previewed = card({
    oracleId: 'o1',
    name: 'Bonus Round',
    typeLine: 'Sorcery',
    types: ['sorcery'],
    manaCost: '{2}{R}',
    power: null,
    toughness: null,
    oracleText:
      'Until end of turn, whenever a player casts an instant or sorcery spell, ' +
      'that player copies it. They may choose new targets for the copy.',
    synergyWants: ['spell-cast'],
    synergyProduces: ['spell-cast'],
  })

  const openPreview = async (): Promise<void> => {
    serve(previewed)
    render(
      <Workspace
        deck={deck({
          commanders: [],
          entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
        })}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText('Preview Bonus Round')).toBeTruthy())
    await act(async () => screen.getByLabelText('Preview Bonus Round').click())
    await waitFor(() => expect(screen.getByText('Semantics')).toBeTruthy())
  }

  it('shows the restriction on the "Benefits from" chip of any card, not just a commander', async () => {
    await openPreview()
    expect(screen.getByText('casting spells (instant or sorcery)')).toBeDefined()
  })

  it('explains in the tooltip which cards count', async () => {
    await openPreview()
    const chip = screen.getByText('casting spells (instant or sorcery)')
    await act(async () => (chip.closest('button') as HTMLButtonElement).click())
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Only instant or sorcery cards count')
  })

  it('never puts a want qualifier on a "Causes" chip', async () => {
    // `produces` is the SUPPLY side and the qualifier says nothing about it —
    // it constrains which cards can cause the event for the wanter, which is a
    // claim about the other half of the pair. Bonus Round carries the same tag
    // on both rows, so the two chips have to read differently.
    await openPreview()
    expect(screen.getByText('casting spells')).toBeDefined()
    expect(screen.getByText('casting spells (instant or sorcery)')).toBeDefined()
  })
})

/*
 * And NOT on the suggestion row, which is where it used to be the only place.
 *
 * ADR-0057 printed "enables your casting spells (instant or sorcery)" on every
 * matching row. The restriction is true, but the row is a RESULT: the card in
 * front of the reader was already tested against the qualifier, so satisfying
 * it is what being in this list means. Saying so again on the densest surface
 * in the app restates what the row's presence already claims.
 *
 * Pinned rather than merely removed, because the wire still carries
 * `reason.qualifier` and the next person to read that field will be tempted to
 * render it.
 */
describe('the suggestion row does not repeat the qualifier', () => {
  const suggestion = (reason: Record<string, unknown>): api.Recommendations =>
    ({
      ...recs,
      groups: [
        {
          key: 'high-synergy',
          label: 'High synergy',
          rationale: 'Pairs with what the deck already does',
          total: 1,
          items: [
            {
              oracleId: 'snipe',
              score: 1,
              comboDegree: 0,
              nearCombosAt1: 0,
              completedCombos: [],
              combos: [],
              reasons: [reason],
            } as unknown as api.Recommendation,
          ],
        },
      ],
    }) as unknown as api.Recommendations

  it('states the semantic bare, even when the wire carries a restriction', async () => {
    serve(zaffai, guttersnipe)
    mocked.getRecommendations.mockResolvedValue(
      suggestion({
        kind: 'keyword-synergy',
        tag: 'spell-cast',
        direction: 'enables',
        qualifier: 'instant or sorcery',
      }),
    )

    render(<Workspace deck={deck()} />)

    await waitFor(() => expect(screen.getByText(/enables your casting spells/)).toBeDefined())
    expect(screen.getByText('enables your casting spells')).toBeDefined()
    expect(screen.queryByText(/instant or sorcery/)).toBeNull()
  })

  it('still says when the focus is the builder’s own emphasis', async () => {
    // The word that DID earn its place on the row. Removing the qualifier must
    // not take the emphasis with it — they were built into one sentence.
    serve(zaffai, guttersnipe)
    mocked.getRecommendations.mockResolvedValue(
      suggestion({
        kind: 'keyword-synergy',
        tag: 'spell-cast',
        direction: 'enables',
        emphasised: true,
        qualifier: 'instant or sorcery',
      }),
    )

    render(<Workspace deck={deck()} />)

    await waitFor(() =>
      expect(screen.getByText('enables your emphasised casting spells')).toBeDefined(),
    )
    expect(screen.queryByText(/instant or sorcery/)).toBeNull()
  })
})
