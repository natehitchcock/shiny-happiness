// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'
import { TOUR_STEPS } from './Tour'

/**
 * The tutorial's WIRING (doc 20 §20.1, A4, A5), and Import and Export's move
 * behind the overflow menu (A1).
 *
 * `tour.test.tsx` tests the tour against a hand-written fixture. What can only
 * be tested here is the part where it meets the real app: that each step's
 * selector finds the region it names in the markup `App.tsx` actually emits,
 * that the tour fires exactly once and on the right transition, that the flag
 * is written when it OPENS rather than when it completes, and that Import and
 * Export still do what they did from their new home.
 *
 * The selectors are the reason this file exists. A tour whose anchor has a typo
 * in it degrades SILENTLY — D3 says a step with no anchor is skipped, so a
 * mistyped selector does not throw, it just quietly drops the step. Nothing in
 * `tour.test.tsx` could catch that, because the fixture there is written to
 * match the selectors rather than to match the app.
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

const analysis = {
  counts: { total: 0, byRole: {} },
  targets: [],
  cuts: [],
  deficits: [],
  archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
  curve: {
    averageManaValue: 0,
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

/** One suggestion, so step 3's `.reasons` anchor has something to find. */
const recs = {
  datasetSnapshotId: null,
  groups: [
    {
      key: 'staples',
      label: 'Staples',
      items: [
        {
          oracleId: 'o1',
          reasons: [{ kind: 'staple' }],
          combos: [],
          comboDegree: 0,
          nearCombosAt1: 0,
        },
      ],
    },
  ],
  columns: [],
  unavailable: [],
  query: { matched: 1, total: 1, errors: [] },
} as unknown as api.Recommendations

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  mocked.getRecommendations.mockResolvedValue(recs)
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([
      [
        'o1',
        {
          oracleId: 'o1',
          name: 'Sol Ring',
          typeLine: 'Artifact',
          // `types` is not decoration: the deck rail groups by it, and a card
          // without it takes the whole workspace down on `card.types.includes`.
          types: ['artifact'],
          manaValue: 1,
          roles: ['ramp'],
        } as unknown as Card,
      ],
    ]),
    prices: new Map(),
    images: new Map(),
  })
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

type Card = api.Card

afterEach(cleanup)

const help = (): HTMLElement => screen.getByRole('button', { name: 'Help' })
const dialog = (): HTMLElement | null => screen.queryByRole('dialog')

const press = (el: HTMLElement): void => {
  act(() => {
    el.click()
  })
}

/* ----------------------------------------- the anchors, against real markup */

describe('every step points at something App.tsx actually renders (D3)', () => {
  /*
   * The step whose anchor is legitimately absent on an EMPTY workspace is
   * `detail`: nothing is open, so there is no `.preview`, and D1 forbids the
   * tour from opening one to have something to point at. It is skipped, and
   * that is the behaviour rather than a gap in this test.
   */
  const conditional = new Set(['detail'])

  it('finds each anchor in the live workspace', async () => {
    render(<Workspace deck={deck} />)
    // The feed has to have landed, or `reasons` is absent for a reason that has
    // nothing to do with the selector being right.
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())

    for (const step of TOUR_STEPS) {
      if (conditional.has(step.id)) continue
      expect(
        document.querySelector(step.anchor),
        `step "${step.id}" found nothing for ${step.anchor}`,
      ).not.toBeNull()
    }
  })

  it('resolves each landmark to the region the step claims, not merely to something', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())

    // The three named landmarks are the sections themselves.
    for (const [id, label] of [
      ['deck', 'Deck'],
      ['suggestions', 'Suggestions'],
      ['analysis', 'Analysis'],
    ]) {
      const step = TOUR_STEPS.find((s) => s.id === id)!
      const found = document.querySelector(step.anchor)
      expect(found?.tagName).toBe('SECTION')
      expect(found?.getAttribute('aria-label')).toBe(label)
    }

    // The reasons anchor lands inside a suggestion row, not on the "not a
    // candidate" note or the cut hints, which also carry `.reasons`.
    const reasons = document.querySelector(TOUR_STEPS.find((s) => s.id === 'reasons')!.anchor)
    expect(reasons?.closest('.card-row')).not.toBeNull()
    expect(reasons?.closest('section')?.getAttribute('aria-label')).toBe('Suggestions')

    // And the two buttons are the two buttons.
    expect(document.querySelector('[data-tour="graph"]')?.textContent).toBe('Graph')
    expect(document.querySelector('[data-tour="quickbuild"]')?.textContent).toBe('Quickbuild')
  })
})

/* --------------------------------------------------- when it fires, and once */

describe('§20.1: once, immediately after the first commander is chosen', () => {
  it('opens by itself on a freshly created deck', async () => {
    render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(screen.getByText(TOUR_STEPS[0]!.title)).toBeTruthy()
  })

  /*
   * The landing page is a commander picker: the deck rail, the feed and the
   * analysis rail do not exist until a commander is chosen, so a tour there
   * could only describe things the reader cannot see. `freshlyCreated` is what
   * separates "the workspace just appeared" from "the workspace is here" — a
   * reload restores a deck without going through the picker.
   */
  it('does not open on a workspace that was merely reloaded', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    expect(dialog()).toBeNull()
  })

  it('does not open again once this browser has seen it', async () => {
    localStorage.setItem('lw.tutorialSeen', 'yes')
    render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    expect(dialog()).toBeNull()
  })
})

describe('A4: opening the tour is what counts as seen, not finishing it', () => {
  it('writes lw.tutorialSeen the moment it opens', async () => {
    expect(localStorage.getItem('lw.tutorialSeen')).toBeNull()
    render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(dialog()).not.toBeNull())
    // On step 1, before anything has been read or pressed.
    expect(screen.getByText('Step 1 of 7')).toBeTruthy()
    expect(localStorage.getItem('lw.tutorialSeen')).toBe('yes')
  })

  /*
   * The accepted cost, pinned so nobody "improves" it into resume-on-reload.
   * A4 was decided with this stated: someone who closes the tab at step 3 does
   * not get the tour again automatically, and Help is the mitigation. A test
   * that only checked the happy path would leave that free to drift.
   */
  it('stays seen after a close partway through, so a refresh does not reopen it', async () => {
    const first = render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(dialog()).not.toBeNull())
    // Wait for the feed, so step 3's anchor is genuinely there and the walk
    // below lands on step 3 rather than skipping it — otherwise this would be
    // testing D3's skipping rule by accident instead of A4's flag.
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    press(screen.getByRole('button', { name: 'Next' }))
    press(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 3 of 7')).toBeTruthy()
    first.unmount()

    // The refresh: same browser, same localStorage, a new mount.
    render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    expect(dialog()).toBeNull()
  })

  it('keeps the flag under the key A5 names, beside lw.deviceId and lw.cutThreshold', async () => {
    render(<Workspace deck={deck} freshlyCreated />)
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(Object.keys(localStorage)).toContain('lw.tutorialSeen')
  })
})

/* ----------------------------------------------------------------- the Help */

describe('D5: Help runs the same tour on demand', () => {
  it('is on the masthead row rather than in the menu, because A4 depends on it', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(help()).toBeTruthy())
    expect(help().closest('header')).not.toBeNull()
    expect(help().closest('.overflow-menu')).toBeNull()
  })

  it('opens the same seven-step tour a first visit gets', async () => {
    localStorage.setItem('lw.tutorialSeen', 'yes')
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    expect(dialog()).toBeNull()
    press(help())
    expect(dialog()).not.toBeNull()
    expect(screen.getByText('Step 1 of 7')).toBeTruthy()
    expect(screen.getByText(TOUR_STEPS[0]!.title)).toBeTruthy()
  })

  it('hands focus back to Help when the tour is dismissed (§20.6)', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(help()).toBeTruthy())
    press(help())
    press(screen.getByRole('button', { name: 'Skip the tour' }))
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(help())
  })

  /*
   * `.workspace` is `hidden` rather than unmounted while the Graph mode is on
   * (doc 17), and in a browser `focus()` on a hidden element is a NO-OP that
   * strands focus on `<body>` — after which the next Tab restarts at the top of
   * the document, which is the defect `endTour` exists to prevent.
   *
   * jsdom implements no layout and lets a hidden element take focus perfectly
   * happily, so without the stub below the workspace would swallow the focus
   * call and the fallback would never run — the test would pass while proving
   * nothing. The stub is what a real browser does, installed deliberately.
   */
  it('never strands focus on body when the workspace cannot take it', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(help()).toBeTruthy())
    const workspace = document.querySelector('.workspace') as HTMLElement
    workspace.setAttribute('hidden', '')
    workspace.focus = () => undefined
    press(help())
    for (let i = 0; i < 7; i += 1) {
      const done = screen.queryByRole('button', { name: 'Done' })
      if (done !== null) {
        press(done)
        break
      }
      press(screen.getByRole('button', { name: 'Next' }))
    }
    expect(dialog()).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(help())
  })

  it('hands focus to the workspace when the tour is finished, not back to Help', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Sol Ring')).toBeTruthy())
    press(help())
    // Straight to the end, however many steps are present on this deck.
    for (let i = 0; i < 7; i += 1) {
      const done = screen.queryByRole('button', { name: 'Done' })
      if (done !== null) {
        press(done)
        break
      }
      press(screen.getByRole('button', { name: 'Next' }))
    }
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('.workspace'))
  })
})

/* ------------------------------------------- A1: Import and Export, relocated */

describe('A1: Import and Export moved, and still do what they did', () => {
  const menu = (): HTMLElement => screen.getByRole('button', { name: 'More tools' })

  it('opens the import dialog from inside the menu', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(menu()).toBeTruthy())
    press(menu())
    press(screen.getByRole('menuitem', { name: 'Import' }))
    expect(screen.getByRole('dialog', { name: 'Import a decklist' })).toBeTruthy()
  })

  it('still exports the deck to the clipboard from inside the menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    // A deck with a card in it, so the export has something to say and this
    // asserts the formatter ran rather than that an empty string was copied.
    const withCard: api.Deck = {
      ...deck,
      entries: [{ oracleId: 'o1', zone: 'accepted', locked: false } as api.Deck['entries'][number]],
    }
    render(<Workspace deck={withCard} />)
    // Hydration first: the formatter names cards out of the client's card
    // cache, so exporting before it lands writes "Unknown card" — which is the
    // export working and the fixture not being ready, not a regression.
    await waitFor(() => expect(screen.getAllByText('Sol Ring').length).toBeGreaterThan(0))
    press(menu())
    press(screen.getByRole('menuitem', { name: 'Export' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(String(writeText.mock.calls[0]?.[0])).toContain('Sol Ring')
    // And it tells the user it happened, which is the rest of the behaviour
    // that moving the button must not have dropped.
    await waitFor(() => expect(screen.getByText(/^Copied /)).toBeTruthy())
  })

  /*
   * The menu is the only route to them now, so it has to survive a real key
   * press rather than only a click. This is the same claim R4 makes about every
   * drag, applied to a control that was on the row a moment ago.
   */
  it('reaches both items from the keyboard alone', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(menu()).toBeTruthy())
    press(menu())
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import' }))
    act(() => {
      screen
        .getByRole('menuitem', { name: 'Import' })
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Export' }))
  })

  it('leaves the tools row at three buttons and a menu, which is what 1175px was derived for', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(menu()).toBeTruthy())
    const masthead = menu().closest('header')!
    // Every direct-child control of the masthead, in document order. The
    // derivation in `styles.css` counts NINE children; this is the half of that
    // count the markup owns.
    const tools = [...masthead.children]
      .filter((el) => el.matches('.act, .overflow-menu'))
      .map((el) => el.textContent)
    expect(tools).toEqual(['Graph', 'Quickbuild', 'Help', '⋯'])
  })
})
