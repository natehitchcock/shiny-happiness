// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * Where focus goes when a Quickbuild option is taken (doc 19 §19.5, R4).
 *
 * THE REPORT: "on mobile, every time I select an option, I scroll down half the
 * page, and have to scroll all the way to the top to see the options again."
 *
 * THE CAUSE, and it is a focus bug rather than a layout one. Quickbuild's Add
 * is wired to the workspace's `decide`, which is the FEED's accept path, and
 * `decide` arms `focusAfterAct` with the suggestion row after the one acted on.
 * A layout effect then hands focus to that row's own Add button — a control in
 * the feed BEHIND the panel, at whatever depth the feed happens to put it — and
 * the browser scrolls its nearest scrollable ancestor to reveal it. Below 900px
 * that ancestor is the document, because `.workspace` is one column and the
 * suggestion `.region` grows with the feed, so the scroll is a page scroll.
 *
 * `focusAfterAct` is right for the feed and must keep working there: it exists
 * because Enter on a feed Add dropped focus to `<body>` and cost seven tabs per
 * card (`keyboard.test.tsx`). What it must not do is reach into the feed when
 * the click came from the panel that is COVERING the feed. The panel is a
 * dialog with its own focus trap; a destination outside it is out of the trap,
 * off screen, and not where the next decision is.
 *
 * jsdom has no layout and cannot see a scroll jump. What it CAN see, exactly,
 * is the focus destination that causes it — so that is what these tests assert.
 * The scroll itself is measured in a real browser and written up in ADR-0061.
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
  entries: [],
}

/** Short of creatures, so there is one gap and the panel has a question. */
const analysis = {
  counts: { total: 4, byRole: {} },
  targets: [{ dimension: { type: 'creature' }, ideal: 26, min: 20, max: 32, locked: 0, actual: 3 }],
  cuts: [],
  deficits: [],
  archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
  curve: {
    averageManaValue: 2,
    histogram: [0, 0, 4, 0, 0, 0, 0, 0],
    target: [],
    locked: [0, 0, 0, 0, 0, 0, 0, 0],
    deltas: [],
  },
  legality: { legal: true, problems: [] },
  deckCombos: [],
  prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
  unavailable: [],
} as unknown as api.Analysis

const item = (oracleId: string): api.Recommendation =>
  ({
    oracleId,
    comboDegree: 0,
    nearCombosAt1: 0,
    score: 1,
    combos: [],
    reasons: [{ kind: 'staple' }],
  }) as unknown as api.Recommendation

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: ['R'],
  colors: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

/**
 * Six, not three, and the overlap is the point.
 *
 * The panel offers a trio and a pick passes over all three (ADR-0056), so a
 * queue of exactly three would empty on the first click and there would be no
 * second trio to land focus in. Six gives the panel a real next trio, and the
 * feed behind it holds all six — which is what real data looks like, because
 * Quickbuild is a view over the same recommendations the feed is drawing.
 */
const NAMES: [string, string][] = [
  ['o1', 'Krenko, Mob Boss'],
  ['o2', 'Goblin Matron'],
  ['o3', 'Skirk Prospector'],
  ['o4', 'Goblin Chieftain'],
  ['o5', 'Goblin Warchief'],
  ['o6', 'Mogg War Marshal'],
]

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [
      {
        key: 'staple',
        label: 'Staples',
        rationale: 'widely played',
        total: NAMES.length,
        items: NAMES.map(([id]) => item(id)),
      },
    ],
    columns: [],
    unavailable: [],
    query: { matched: NAMES.length, total: NAMES.length, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map(NAMES.map(([id, name]) => [id, card(id, name)])),
    prices: new Map(NAMES.map(([id]) => [id, 1])),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.sendCommands.mockResolvedValue({
    deck: { ...deck, version: 2 },
  } as unknown as Awaited<ReturnType<typeof api.sendCommands>>)
})

afterEach(cleanup)

const panel = (): HTMLElement => screen.getByRole('dialog', { name: 'Quickbuild' })

/** Open the workspace and the panel over it, with a trio on screen. */
const openQuickbuild = async (): Promise<void> => {
  render(<Workspace deck={deck} />)
  const button = () => screen.getByRole('button', { name: 'Quickbuild' })
  await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false))
  await act(async () => {
    button().click()
  })
  await waitFor(() => expect(panel().querySelectorAll('.quickbuild-option').length).toBe(3))
}

/** The option cards on screen now, in order. */
const options = (): HTMLElement[] => [
  ...panel().querySelectorAll<HTMLElement>('.quickbuild-option'),
]

/** Press an option's Add the way a click or Enter would, focus included. */
const addOption = async (at: number): Promise<void> => {
  const add = options()[at]!.querySelector<HTMLElement>('button.act.primary')!
  add.focus()
  expect(document.activeElement).toBe(add)
  await act(async () => {
    add.click()
  })
}

describe('taking a Quickbuild option', () => {
  /*
   * THE BUG, stated as the thing that was observed. Focus leaving the dialog
   * for a row in the feed underneath it is what makes the browser scroll, and
   * on a phone the feed row is most of a page away.
   */
  it('does not throw focus into the suggestion feed behind the panel', async () => {
    await openQuickbuild()
    await addOption(0)

    const active = document.activeElement
    expect(active).not.toBe(document.body)
    expect(active).not.toBeNull()
    // The feed is still in the document behind the panel; focus must not be in
    // it. `.card-row` is the feed's own row class and the panel has none.
    expect(active!.closest('.card-row')).toBeNull()
    expect(panel().contains(active)).toBe(true)
  })

  /*
   * R4 and §19.5: the panel is a focus trap, so a destination outside it is not
   * merely far away, it is unreachable by the Tab wrap that is supposed to keep
   * a keyboard user inside the question.
   */
  it('leaves focus inside the dialog, where the trap can hold it', async () => {
    await openQuickbuild()
    await addOption(1)
    expect(panel().contains(document.activeElement)).toBe(true)
  })

  /*
   * The next decision is the new trio, and the top of it is where a reader has
   * to be put back. Anything lower means scrolling up to find options one and
   * two, which is the second half of the report.
   */
  it('puts focus on the first option of the trio that replaced it', async () => {
    await openQuickbuild()
    const before = options().map((o) => o.getAttribute('aria-label'))
    await addOption(0)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const after = options().map((o) => o.getAttribute('aria-label'))
    // ADR-0056: the whole trio cycles, so this really is a new question.
    expect(after).not.toEqual(before)
    expect(options()[0]!.contains(document.activeElement)).toBe(true)
  })

  /*
   * The same for a pick that empties the gap: there is no trio left, so focus
   * has to land on whatever the panel is saying instead — never on `<body>`,
   * and never out in the feed.
   */
  it('keeps focus in the dialog even when the gap runs out', async () => {
    await openQuickbuild()
    await addOption(0)
    await addOption(0)
    expect(document.activeElement).not.toBe(document.body)
    expect(panel().contains(document.activeElement)).toBe(true)
  })

  /*
   * The live region still has to say what happened. Losing the announcement to
   * fix the scroll would trade one screen-reader defect for another — §19.5
   * says every recompute is announced, and the workspace says what was added.
   */
  it('still announces the add and the new trio', async () => {
    await openQuickbuild()
    await addOption(0)

    const regions = [...document.querySelectorAll('p[aria-live="polite"][role="status"]')]
    const text = regions.map((r) => r.textContent ?? '').join(' | ')
    // The workspace's own confirmation, from `decide`.
    expect(text).toContain('Krenko, Mob Boss added')
    // And the panel's, naming what replaced it (§19.5).
    await waitFor(() => {
      const now = [...document.querySelectorAll('p[aria-live="polite"][role="status"]')]
        .map((r) => r.textContent ?? '')
        .join(' | ')
      expect(now).toContain('Goblin Chieftain')
    })
  })
})

describe('the feed’s own accept path', () => {
  /*
   * Unchanged, and pinned here as well as in `keyboard.test.tsx` because the
   * fix is in the code both paths share. A guard that stopped `focusAfterAct`
   * from running at all would pass every test above and silently undo the
   * seven-tabs-per-card fix.
   */
  it('still moves focus to the next row when the panel is closed', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByLabelText('Add Krenko, Mob Boss')).toBeTruthy())
    const add = screen.getByLabelText('Add Krenko, Mob Boss')
    add.focus()
    await act(async () => {
      add.click()
    })
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(screen.getByLabelText('Add Goblin Matron'))
  })
})
