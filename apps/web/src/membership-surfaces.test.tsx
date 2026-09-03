// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App, Workspace } from './App'

/**
 * The four surfaces that never learned to read `synergyHas` (ADR-0048).
 *
 * The third direction reached the scorer and half the product. Membership is a
 * way of SUPPLYING a tag, so every surface that pairs a supply against a want —
 * or that merely lists what a card is about — has to read three arrays and not
 * two. Each `describe` below is one of the places that read two, and each was
 * reproduced in a browser against the real corpus before it was written down:
 *
 *  - the commander prompt said "No semantics derived" for Morophon, the
 *    Boundless, whose whole card is `has: subtype:shapeshifter,
 *    ability:changeling`, and offered Lathril six chips while dropping
 *    `subtype:noble` and `ability:menace`;
 *  - "Synergises with" on Elvish Archdruid, in a deck holding fifty-nine
 *    Elves, listed two Elves — both token MAKERS, because an ordinary Elf
 *    supplies its Elf-ness through `has` and could never be a partner;
 *  - the reason chip printed `enables your emphasised subtype:elf`, the wire
 *    spelling, in the one file that already imports `readable()`;
 *  - the filter printed `unknown synergy tag "subtype:elff"` and dropped the
 *    ranked near-miss list ADR-0046 shipped in the same response.
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

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

const card = (over: Partial<api.Card> & Pick<api.Card, 'oracleId' | 'name'>): api.Card => ({
  manaCost: '{1}{G}',
  manaValue: 2,
  typeLine: 'Creature — Elf Druid',
  types: ['creature'],
  oracleText: '',
  power: '1',
  toughness: '1',
  loyalty: null,
  colorIdentity: ['G'],
  primaryRole: 'ramp',
  edhrecRank: null,
  universesBeyond: false,
  canBeCommander: true,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

/**
 * Morophon's real shape: a commander whose every semantic is membership.
 * 302 commander-legal cards are in this position, which is why the prompt's
 * "no semantics" branch was reachable at all.
 */
const morophon = card({
  oracleId: 'morophon',
  name: 'Morophon, the Boundless',
  typeLine: 'Legendary Creature — Shapeshifter',
  synergyProduces: [],
  synergyWants: [],
  synergyHas: ['subtype:shapeshifter', 'ability:changeling'],
})

/** Lathril's real shape, from the corpus. */
const lathril = card({
  oracleId: 'lathril',
  name: 'Lathril, Blade of the Elves',
  typeLine: 'Legendary Creature — Elf Noble',
  synergyProduces: ['sacrifice-fodder', 'subtype:elf'],
  synergyWants: ['attack-trigger', 'subtype:elf'],
  synergyHas: ['subtype:elf', 'subtype:noble', 'ability:menace'],
})

/** The lord: wants the tribe and is not a token maker. */
const archdruid = card({
  oracleId: 'archdruid',
  name: 'Elvish Archdruid',
  synergyProduces: [],
  synergyWants: ['subtype:elf', 'untap'],
  synergyHas: ['subtype:elf', 'subtype:druid'],
})

/** An ordinary Elf: supplies the tribe through `has` and nothing else. */
const mystic = card({
  oracleId: 'mystic',
  name: 'Elvish Mystic',
  synergyProduces: [],
  synergyWants: [],
  synergyHas: ['subtype:elf'],
})

/** A second ordinary Elf, so the tribal claim has more than one maker. */
const llanowar = card({
  oracleId: 'llanowar',
  name: 'Llanowar Elves',
  synergyProduces: [],
  synergyWants: [],
  synergyHas: ['subtype:elf'],
})

/** The one card in the deck making a claim nobody else makes. */
const quirion = card({
  oracleId: 'quirion',
  name: 'Quirion Ranger',
  synergyProduces: ['untap'],
  synergyWants: [],
  synergyHas: ['subtype:elf'],
})

const deck: api.Deck = {
  id: 'd1',
  name: 'Elf tribal',
  description: '',
  commanders: ['lathril'],
  colorIdentity: ['B', 'G'],
  targetBracket: 3,
  archetype: 'aggro',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [
    { oracleId: 'lathril', zone: 'accepted', locked: false },
    { oracleId: 'archdruid', zone: 'accepted', locked: false },
    { oracleId: 'mystic', zone: 'accepted', locked: false },
    { oracleId: 'llanowar', zone: 'accepted', locked: false },
    // Last in accepted order on purpose: without the diversity sort it is the
    // last row, and it is the one row worth reading.
    { oracleId: 'quirion', zone: 'accepted', locked: false },
  ],
}

const hydrated = new Map([
  ['lathril', lathril],
  ['archdruid', archdruid],
  ['mystic', mystic],
  ['llanowar', llanowar],
  ['quirion', quirion],
])

const recommendations = (over: Partial<api.Recommendations> = {}): api.Recommendations =>
  ({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
    ...over,
  }) as unknown as api.Recommendations

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.getRecommendations.mockResolvedValue(recommendations())
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 3, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'aggro', assessed: 'aggro', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 3, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 1, pricedCards: 3, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: hydrated,
    prices: new Map(),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...archdruid,
    printings: [],
    combos: [],
  } as unknown as api.CardDetail)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const typeCommander = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Commander') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    screen.getByLabelText(/^Run this search/).click()
  })
}

const chooseCommander = async (name: string, found: api.Card): Promise<void> => {
  mocked.searchCards.mockResolvedValue({ items: [found] })
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
  await typeCommander(name)
  await waitFor(() => expect(screen.getByText('Choose')).toBeDefined())
  await act(async () => {
    screen.getByText('Choose').click()
  })
  await waitFor(() => expect(screen.getByText('What is this deck about?')).toBeDefined())
}

describe('the commander prompt reads all three directions', () => {
  it('offers a commander whose only semantics are membership', async () => {
    await chooseCommander('Morophon', morophon)

    // Both of Morophon's tags, in words. Before ADR-0048's third direction
    // reached this list, `commanderTags` was `produces ∪ wants` and this
    // commander — with 301 others — got the empty-state paragraph instead.
    expect(screen.getByLabelText('Emphasise Shapeshifters')).toBeDefined()
    expect(screen.getByLabelText('Emphasise changeling')).toBeDefined()
    expect(screen.queryByText(/No semantics derived for this card/)).toBeNull()
  })

  it('offers the membership a commander shares with its engine tags', async () => {
    await chooseCommander('Lathril', lathril)

    // The six the prompt already offered.
    expect(screen.getByLabelText('Emphasise expendable bodies')).toBeDefined()
    expect(screen.getByLabelText('Emphasise Elves')).toBeDefined()
    // The two it silently dropped. Both come off the type line and the
    // keywords, and both are real focuses — a Noble deck and a menace deck are
    // things someone builds.
    expect(screen.getByLabelText('Emphasise Nobles')).toBeDefined()
    expect(screen.getByLabelText('Emphasise menace')).toBeDefined()
  })

  it('offers membership in the workspace panel as well as at the start', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Add a focus')).toBeDefined())
    await act(async () => {
      screen.getByText('Add a focus').click()
    })

    // The same question at a second moment must offer the same list, or
    // someone who skipped the prompt meets a different vocabulary later.
    await waitFor(() => expect(screen.getByLabelText('Emphasise Nobles')).toBeDefined())
    expect(screen.getByLabelText('Emphasise menace')).toBeDefined()
  })

  it('does not tell the reader that every other semantic comes from rules text', async () => {
    await chooseCommander('Lathril', lathril)
    await act(async () => {
      screen.getByText('Show all semantics').click()
    })

    await waitFor(() => expect(screen.getByText('Every other semantic')).toBeDefined())
    // 586 of the 608 tags in that list are subtypes and keywords, which are read
    // off the type line and the `keywords` array — `semanticMembership` never
    // looks at `oracle_text`. A note claiming rules text for all of them is
    // false about most of them.
    const note = screen.getByText(/whether or not it relates to your focus/)
    expect(note.textContent).toMatch(/type line/i)
    expect(note.textContent).not.toMatch(/^Everything else we derive from rules text,/)
  })
})

describe('"Synergises with" pairs a want against membership', () => {
  const openArchdruid = async (): Promise<void> => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Preview Elvish Archdruid')).toBeTruthy())
    await act(async () => screen.getByLabelText('Preview Elvish Archdruid').click())
    await waitFor(() => expect(screen.getByText('Works with your deck')).toBeTruthy())
  }

  it('lists a deck card that supplies the tag by being it', async () => {
    await openArchdruid()

    // Elvish Mystic causes nothing and wants nothing. It is an Elf, which is
    // exactly what Elvish Archdruid pays off, and `has ↔ wants` is the pairing
    // ADR-0048 scores. It could never appear here while both sides read
    // `produces` and `wants` alone.
    const partners = screen.getByText('Synergises with').parentElement
    expect(partners?.textContent).toContain('Elvish Mystic')
  })

  it('says the membership claim rather than calling an Elf a cause of Elves', async () => {
    await openArchdruid()

    const partners = screen.getByText('Synergises with').parentElement
    // "Elvish Mystic — causes Elves" would be false: a token maker CAUSES an
    // Elf and is not one, and that distinction is the reason `has` exists.
    expect(partners?.textContent).not.toMatch(/Elvish Mystic — causes/)
    expect(partners?.textContent).toMatch(/Elvish Mystic — one of your Elves/)
  })

  it('counts what the previewed card IS as something a partner can pay off', async () => {
    await openArchdruid()

    /*
     * The other half of the pairing, and the half a test that only looked at
     * Elvish Mystic could not see. Elvish Archdruid CAUSES nothing; it is an
     * Elf. Lathril wants Elves, so she pays off what the Archdruid is, and the
     * line has to say "benefits from" — read the supply side as `produces`
     * alone and the only pairing left is Lathril's Elf TOKENS, which would
     * make the same row read "causes Elves" about the wrong relation.
     */
    const partners = screen.getByText('Synergises with').parentElement
    expect(partners?.textContent).toMatch(/Lathril, Blade of the Elves — benefits from Elves/)
  })

  it('names the tag in words, not in its wire spelling', async () => {
    await openArchdruid()

    const partners = screen.getByText('Synergises with').parentElement
    // ADR-0046: `readable()` is imported in this file and used four lines from
    // here. The hyphen-stripper leaves a namespaced tag exactly as it was.
    expect(partners?.textContent).not.toContain('subtype:elf')
  })

  it('leads with the claim the fewest partners make', async () => {
    /*
     * Without this the eight-row cut fills with eight copies of one sentence.
     * Fifty-nine Elves all say "one of your Elves" and arrive in accepted
     * order, so the untapper and the token maker fall off the end — the
     * panel's own version of the hairball ADR-0053 refuses in the graph.
     *
     * Here three partners say "Elves" and only Quirion Ranger says
     * "untapping", so Quirion leads — even though it is last in accepted
     * order, which is where the sort left it before.
     */
    await openArchdruid()

    const partners = screen.getByText('Synergises with').parentElement
    const text = partners?.textContent ?? ''
    expect(text).toContain('Quirion Ranger')
    expect(text.indexOf('Quirion Ranger')).toBeLessThan(text.indexOf('Elvish Mystic'))
  })
})

describe('a reason chip names the tag in words', () => {
  it('does not print the wire spelling of a namespaced tag', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recommendations({
        groups: [
          {
            key: 'high-synergy',
            label: 'High synergy',
            rationale: 'Pairs with what the deck already does',
            total: 1,
            items: [
              {
                oracleId: 'mystic',
                score: 1,
                comboDegree: 0,
                nearCombosAt1: 0,
                completedCombos: [],
                combos: [],
                reasons: [
                  {
                    kind: 'keyword-synergy',
                    tag: 'subtype:elf',
                    direction: 'enables',
                    emphasised: true,
                  },
                ],
              } as unknown as api.Recommendation,
            ],
          },
        ],
      }),
    )

    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText(/enables your emphasised/)).toBeDefined())
    expect(screen.getByText('enables your emphasised Elves')).toBeDefined()
    expect(screen.queryByText(/subtype:elf/)).toBeNull()
  })
})

describe('the filter error carries the near-miss list', () => {
  it('shows the suggestion the API already sent', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recommendations({
        query: {
          matched: 0,
          total: 0,
          errors: [
            {
              position: 4,
              length: 12,
              message: 'unknown synergy tag "subtype:elff"',
              suggestion: 'did you mean: subtype:elf, subtype:eldrazi, subtype:elemental',
            },
          ],
        } as unknown as api.Recommendations['query'],
      }),
    )

    render(<Workspace deck={deck} />)

    // ADR-0046 shipped this list deliberately, ranked so a transposition still
    // finds its target. With 608 tags, an error that names the typo and offers
    // nothing turns the filter into a guessing game.
    await waitFor(() => expect(screen.getByText(/unknown synergy tag/)).toBeDefined())
    expect(screen.getByText(/did you mean: subtype:elf, subtype:eldrazi/)).toBeDefined()
  })

  it('shows nothing extra when the API sent no suggestion', async () => {
    mocked.getRecommendations.mockResolvedValue(
      recommendations({
        query: {
          matched: 0,
          total: 0,
          errors: [{ position: 0, length: 3, message: 'unknown role "xyz"', suggestion: null }],
        } as unknown as api.Recommendations['query'],
      }),
    )

    render(<Workspace deck={deck} />)

    await waitFor(() => expect(screen.getByText('unknown role "xyz"')).toBeDefined())
    expect(screen.queryByText(/did you mean/)).toBeNull()
    // Nothing AT ALL follows the message, not an empty paragraph. `null` is the
    // parser's real answer for an error it has nothing to add to — a bad colour
    // letter is fully explained by its own message — and a hint that hints at
    // nothing is a second thing on screen saying there is more to know.
    expect(screen.getByText('unknown role "xyz"').nextElementSibling).toBeNull()
  })
})
