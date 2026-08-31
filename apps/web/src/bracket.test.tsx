// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The bracket surface (doc 03 §3.2, ADR-0018).
 *
 * Every test here is about the same property, from a different side: the
 * interface may state the one thing Wizards publishes a rule for, and may not
 * turn it into a verdict on the deck. One barometer of five is not a bracket.
 *
 * The arithmetic itself belongs to `packages/domain/src/bracket-rules.ts` and
 * is tested there. What is tested here is what the reader is told.
 */

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof api>('./api')
  return {
    ...actual,
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
  }
})

const mocked = vi.mocked(api)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

const TOMB = '23467047-6dba-4498-b783-1ebc4f74b8c2'
const MOX = 'ec3d4466-547c-4e02-b1b5-a156ec4637e9'
const MONOLITH = '229d6627-1292-4ae1-8849-b0f956fa6540'
const VAULT = '736892cb-a34b-4bb9-b56c-e26e3db207a2'

/** Real oracle ids and real Game Changers, so the fixture is the live shape. */
const NAMES: Record<string, string> = {
  [TOMB]: 'Ancient Tomb',
  [MOX]: 'Chrome Mox',
  [MONOLITH]: 'Grim Monolith',
  [VAULT]: 'Mana Vault',
}

const deck = (over: Partial<api.Deck> = {}): api.Deck => ({
  id: 'd1',
  name: 'Bracket probe',
  description: '',
  commanders: [],
  colorIdentity: ['U'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  targetOverrides: {},
  entries: Object.keys(NAMES).map((oracleId) => ({
    oracleId,
    zone: 'accepted' as const,
    locked: false,
  })),
  ...over,
})

/** The published Bracket 3 entry, byte-for-byte as the API sends it. */
const published = (
  over: Partial<NonNullable<api.BracketReport['rules']>['targetBracket']> = {},
): NonNullable<NonNullable<api.BracketReport['rules']>['targetBracket']> => ({
  bracket: 3,
  name: 'Upgraded',
  gameChangersAllowed: 3,
  // The four that ADR-0018 leaves null. `null` is "the format publishes no rule
  // here", which is a different claim from 'allowed'.
  massLandDenial: null,
  extraTurnChaining: null,
  twoCardInfinites: null,
  tutorDensity: null,
  ...over,
})

const ASSESSMENT_REASON =
  'only the Game Changers allowance is checked. Wizards withdrew the tutor ' +
  'restriction and publishes no current per-bracket value for mass land denial, ' +
  'extra turns or two-card infinites, so no bracket is assessed'

/*
 * Two held against an allowance of three, deliberately unequal.
 *
 * A fixture holding exactly its allowance renders "allows 3; this deck holds 3"
 * — and a panel that printed the count where the allowance belongs would say
 * the same thing. The numbers have to differ for the sentence to be a claim.
 */
const bracket = (over: Partial<api.BracketReport> = {}): api.BracketReport => ({
  target: 3,
  assessed: null,
  violations: [],
  gameChangers: [TOMB, MOX],
  rules: {
    sourceUrl: 'https://magic.wizards.com/en/formats/commander',
    retrievedAt: '2026-08-30',
    targetBracket: published(),
  },
  ...over,
})

/** The deck over its allowance, exactly as the running API answered it. */
const overBracket = (): api.BracketReport =>
  bracket({
    gameChangers: [TOMB, MOX, MONOLITH, VAULT],
    violations: [
      {
        flag: 'game-changer',
        bracket: 3,
        allowed: 3,
        actual: 4,
        cards: [TOMB, MOX, MONOLITH, VAULT],
        message: 'Bracket 3 (Upgraded) allows 3 Game Changers; this deck has 4.',
      },
    ],
  })

const band = (ideal: number): { ideal: number; min: number; max: number } => ({
  ideal,
  min: ideal - 0.01,
  max: ideal + 0.01,
})

const analysis = (over: Partial<api.Analysis> = {}): api.Analysis =>
  ({
    counts: { total: 4, byRole: {} },
    targets: [],
    targetOverrides: {},
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      target: Array.from({ length: 8 }, () => band(0.125)),
      preset: Array.from({ length: 8 }, () => band(0.125)),
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    bracket: bracket(),
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [{ key: 'bracket-assessment', reason: ASSESSMENT_REASON }],
    ...over,
  }) as unknown as api.Analysis

const card = (oracleId: string): api.Card =>
  ({
    oracleId,
    name: NAMES[oracleId] ?? oracleId,
    manaCost: null,
    manaValue: 2,
    typeLine: 'Artifact',
    types: ['artifact'],
    oracleText: '',
    power: null,
    toughness: null,
    loyalty: null,
    colorIdentity: [],
    primaryRole: 'ramp',
    edhrecRank: null,
    universesBeyond: false,
    synergyProduces: [],
    synergyWants: [],
  }) as unknown as api.Card

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, total: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue(analysis())
  // All three members, or the result is not a `Hydrated`, the whole load fails
  // and `analysis` stays null — which silently unrenders everything below.
  mocked.hydrate.mockResolvedValue({
    cards: new Map(Object.keys(NAMES).map((id) => [id, card(id)])),
    prices: new Map(),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getCardDetail.mockResolvedValue({
    ...card(TOMB),
    printings: [],
    combos: [],
  } as unknown as api.CardDetail)
})

afterEach(cleanup)

const show = async (
  report?: api.BracketReport,
  rest: Partial<api.Analysis> = {},
): Promise<void> => {
  if (report !== undefined)
    mocked.getAnalysis.mockResolvedValue(analysis({ bracket: report, ...rest }))
  else if (Object.keys(rest).length > 0) mocked.getAnalysis.mockResolvedValue(analysis(rest))
  render(<Workspace deck={deck()} />)
  await waitFor(() => expect(screen.getByText('Bracket check')).toBeTruthy())
}

const panel = (): HTMLElement => screen.getByText('Bracket check').closest('.bracket-check')!

describe('the masthead bracket chip', () => {
  it('carries the overage, not just the bracket number', async () => {
    // Doc 03 §3.2: `Bracket 3 · 4/3 Game Changers`. The masthead used to print
    // a bare `BRACKET 3` connected to nothing checkable.
    await show(overBracket())
    const chip = screen.getByLabelText(
      'Bracket 3: 4 Game Changers of 3 allowed. Open the bracket check.',
    )
    expect(chip.textContent).toContain('4/3 GAME CHANGERS')
    expect(chip.getAttribute('data-over')).toBe('true')
  })

  it('still shows the count when the deck is inside its allowance', async () => {
    // A chip that appeared only on a failure would make its own ABSENCE read as
    // a pass — the verdict ADR-0018 says cannot be given.
    await show()
    const chip = screen.getByLabelText(
      'Bracket 3: 2 Game Changers of 3 allowed. Open the bracket check.',
    )
    expect(chip.textContent).toContain('2/3 GAME CHANGERS')
    expect(chip.getAttribute('data-over')).toBe('false')
  })

  it('says "no limit" at a bracket that sets none, rather than a denominator', async () => {
    await show(
      bracket({
        target: 4,
        gameChangers: [TOMB, MOX, MONOLITH, VAULT],
        rules: {
          sourceUrl: 'https://magic.wizards.com/en/formats/commander',
          retrievedAt: '2026-08-30',
          targetBracket: published({
            bracket: 4,
            name: 'Optimized',
            gameChangersAllowed: 'unlimited',
          }),
        },
      }),
    )
    const chip = screen.getByLabelText(/^Bracket 4:/)
    expect(chip.textContent).toContain('NO LIMIT')
    expect(chip.textContent).not.toContain('/')
  })

  it('opens the panel and moves focus onto it', async () => {
    // P4: a claim the reader cannot open is not a reason. The chip is the way
    // in, and focus has to travel with the scroll or a keyboard user is left
    // at the top of the document.
    await show()
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/^Bracket 3:/))
    })
    expect(document.activeElement).toBe(screen.getByText('Bracket check'))
    expect(screen.getByRole('button', { name: '2 Game Changers in this deck' })).toBeTruthy()
  })
})

describe('the bracket check panel', () => {
  it('never renders a verdict on the deck', async () => {
    // The whole point. `assessed` is null and stays null, so no tick, no
    // "passes", no "meets" may appear anywhere in this panel.
    await show()
    const text = panel().textContent ?? ''
    expect(text).not.toContain('✓')
    expect(text).not.toMatch(/\bpass(es|ed)?\b|\bmeets\b|\blegal\b/i)
    expect(text).toContain('No bracket assessed')
  })

  it('states the allowance and the count as the source publishes them', async () => {
    await show()
    expect(panel().textContent).toContain(
      'Bracket 3 (Upgraded) allows 3 Game Changers; this deck holds 2.',
    )
  })

  it('shows the server’s own sentence when the deck breaks the allowance', async () => {
    // Not re-derived here: the arithmetic lives in one place, and a second copy
    // is how the panel comes to disagree with the API it is rendering.
    await show(overBracket())
    expect(panel().textContent).toContain(
      'Bracket 3 (Upgraded) allows 3 Game Changers; this deck has 4.',
    )
  })

  it('names the four barometers it cannot check, instead of omitting them', async () => {
    // Rendering only the checkable fifth would leave a reader believing the
    // Game Changers count WAS the bracket check.
    await show()
    for (const label of ['Two-card infinites', 'Extra turns', 'Mass land denial', 'Tutors']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getAllByText('no published rule')).toHaveLength(4)
  })

  it('does not report a published barometer as though the deck were measured against it', async () => {
    // The subtle failure: the day Wizards publishes a mass-land-denial rule,
    // this app still has no check for it. Showing the rule alone would imply
    // the deck had been held against it.
    await show(
      bracket({
        rules: {
          sourceUrl: 'https://magic.wizards.com/en/formats/commander',
          retrievedAt: '2026-08-30',
          targetBracket: published({ massLandDenial: 'discouraged' }),
        },
      }),
    )
    expect(screen.getByText('discouraged, not checked here')).toBeTruthy()
    expect(screen.getAllByText('no published rule')).toHaveLength(3)
  })

  it('quotes the server for what is missing rather than keeping its own copy', async () => {
    await show()
    expect(panel().textContent).toContain(ASSESSMENT_REASON)
  })

  it('says where the allowance came from and when it was read', async () => {
    await show()
    const link = screen.getByRole('link', { name: 'magic.wizards.com' })
    expect(link.getAttribute('href')).toBe('https://magic.wizards.com/en/formats/commander')
    expect(panel().textContent).toContain('on 2026-08-30')
  })

  it('states the count alone when the server sent provenance but no allowance', async () => {
    // A server from before the published entry was carried. There is no table
    // of allowances in the client to fall back on — that is a rejected PR
    // (AGENTS.md §8) — so the panel says what it knows and stops.
    await show(
      bracket({
        rules: {
          sourceUrl: 'https://magic.wizards.com/en/formats/commander',
          retrievedAt: '2026-08-30',
        },
      }),
    )
    expect(panel().textContent).toContain('This deck holds 2 Game Changers.')
    expect(panel().textContent).not.toMatch(/allows \d/)
    expect(screen.getByLabelText(/^Bracket 3:/).textContent).toContain('2 GAME CHANGERS')
    expect(screen.getByLabelText(/^Bracket 3:/).textContent).not.toContain('/')
    // And the four barometers are not claimed to be unpublished on the strength
    // of having received nothing about them.
    expect(screen.queryByText('no published rule')).toBeNull()
  })

  it('checks nothing, and says so, when the rules could not be loaded', async () => {
    // Migration 0011 defaults every row to `game_changer = false`, so between
    // it and the next ingest the corpus reports no Game Changers at all. An
    // empty set satisfies every allowance vacuously, so the loader refuses.
    await show(bracket({ gameChangers: [], rules: null }), {
      unavailable: [
        {
          key: 'bracket-assessment',
          reason: 'no card in the corpus carries the Game Changers flag',
        },
      ],
    })
    expect(panel().textContent).toContain('could not be read, so nothing is checked')
    expect(panel().textContent).toContain('no card in the corpus carries the Game Changers flag')
    // No allowance may be invented from an unloaded ruleset.
    expect(panel().textContent).not.toMatch(/allows \d/)
    expect(screen.queryByText('no published rule')).toBeNull()
  })
})

/*
 * Every card in this fixture is also a row in the deck rail, so a bare
 * `getByText('Ancient Tomb')` finds two elements. Scoping to the panel is what
 * makes "the panel names them" a claim about the panel.
 */
describe('naming the Game Changers', () => {
  it('expands the count into which cards they are', async () => {
    // "3 Game Changers" that cannot be opened into WHICH three is exactly the
    // unopenable claim P4 forbids.
    await show()
    const inPanel = within(panel())
    expect(inPanel.queryByText('Ancient Tomb')).toBeNull()
    await act(async () => {
      fireEvent.click(inPanel.getByRole('button', { name: '2 Game Changers in this deck' }))
    })
    for (const name of ['Ancient Tomb', 'Chrome Mox']) {
      expect(within(panel()).getByText(name)).toBeTruthy()
    }
    // Mana Vault is in the deck but not on this report's list, and the panel
    // lists what the server named — not every card it can see.
    expect(within(panel()).queryByText('Mana Vault')).toBeNull()
  })

  it('arrives already open when the deck is over, so the complaint carries its evidence', async () => {
    await show(overBracket())
    const inPanel = within(panel())
    expect(inPanel.getByText('Mana Vault')).toBeTruthy()
    expect(
      inPanel
        .getByRole('button', { name: '4 Game Changers in this deck' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('opens the card from its name', async () => {
    await show(overBracket())
    await act(async () => {
      fireEvent.click(within(panel()).getByText('Ancient Tomb'))
    })
    expect(mocked.getCardDetail).toHaveBeenCalledWith(TOMB)
  })

  it('closes on Escape and puts focus back on the toggle (R4)', async () => {
    await show(overBracket())
    const toggle = within(panel()).getByRole('button', { name: '4 Game Changers in this deck' })
    const name = within(panel()).getByText('Ancient Tomb')
    await act(async () => {
      name.focus()
      fireEvent.keyDown(name, { key: 'Escape' })
    })
    expect(within(panel()).queryByText('Ancient Tomb')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })
})
