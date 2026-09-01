// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The Quickbuild entry point in the masthead (doc 19 §19.1).
 *
 * The panel's own behaviour is tested in `quickbuild.test.tsx` against injected
 * props. What can only be tested here is the wiring: that the button exists
 * beside the other masthead controls, that it will not open a panel with
 * nothing to say, and that when it opens the panel is scoped to the suggestion
 * pane rather than the whole workspace — which is a requirement of §19.1 and
 * was wrong on the first browser run.
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

/** A deck that is genuinely short of ramp, so there is a gap to work. */
const analysis = {
  counts: { total: 4, byRole: {} },
  targets: [
    { dimension: { role: 'ramp' }, ideal: 11, min: 8, max: 14, locked: 0, actual: 1 },
    { dimension: { type: 'creature' }, ideal: 26, min: 20, max: 32, locked: 0, actual: 3 },
  ],
  cuts: [],
  deficits: [],
  archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
  curve: {
    averageManaValue: 2,
    histogram: [0, 0, 4, 0, 0, 0, 0, 0],
    target: [],
    locked: [0, 0, 0, 0, 0, 0, 0, 0],
    deltas: [{ bucket: 3, actual: 0, ideal: 4, min: 2, max: 6, delta: 2, withinRange: false }],
  },
  legality: { legal: true, problems: [] },
  deckCombos: [],
  prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
  unavailable: [],
} as unknown as api.Analysis

const recs = {
  datasetSnapshotId: null,
  groups: [],
  columns: [],
  unavailable: [],
  query: { matched: 0, total: 0, errors: [] },
} as unknown as api.Recommendations

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocked.getRecommendations.mockResolvedValue(recs)
  mocked.getAnalysis.mockResolvedValue(analysis)
  mocked.hydrate.mockResolvedValue({ cards: new Map(), prices: new Map(), images: new Map() })
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.searchCards.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const button = () => screen.getByRole('button', { name: 'Quickbuild' })

/**
 * Press it the way a click or Enter would, and let React flush.
 *
 * Waits for the button to be ENABLED first, which is not incidental: it is
 * disabled until the analysis lands, so a click sent before then does nothing
 * at all. Every test here that skipped the wait failed with a button reporting
 * `aria-pressed="false"` and no panel, which reads as a broken toggle rather
 * than as a race.
 */
const toggle = async (): Promise<void> => {
  await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false))
  const control = button()
  await act(async () => {
    control.click()
  })
}

describe('the Quickbuild button (§19.1)', () => {
  it('sits in the masthead beside Import, Export and Graph', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    const masthead = button().closest('header')
    expect(masthead).not.toBeNull()
    for (const name of ['Import', 'Export', 'Graph']) {
      expect(masthead!.querySelector(`button`)).toBeTruthy()
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('reports open and closed through aria-pressed, not two buttons', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button().getAttribute('aria-pressed')).toBe('false'))
    await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false))
    await toggle()
    await waitFor(() => expect(button().getAttribute('aria-pressed')).toBe('true'))
  })

  /*
   * A button that opens a panel with nothing in it teaches people not to press
   * it. The gaps ARE the analysis, so until it lands there is no question to
   * ask, and the disabled state says why in its title rather than being inert
   * and unexplained.
   */
  it('will not open before the analysis has landed', async () => {
    mocked.getAnalysis.mockImplementation(() => new Promise(() => {}))
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    expect(button().hasAttribute('disabled')).toBe(true)
    expect(button().getAttribute('title')).toMatch(/once the deck analysis has loaded/i)
  })

  /*
   * §19.1: the panel covers the SUGGESTION PANE and nothing else, so the deck
   * rail and the composition rail stay visible — they are the scoreboard it is
   * asking you to play against.
   *
   * This is asserted structurally, as containment, rather than by reading
   * geometry: jsdom does not lay anything out, so a position assertion here
   * would be theatre. The real failure was the panel escaping its pane because
   * the section was not a containing block, and the browser check is written up
   * in doc 19. What this pins is the half jsdom can see — that the panel is
   * inside the Suggestions region and that the region is marked to contain it.
   */
  it('opens inside the suggestion pane, not over the workspace', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    await toggle()
    const panel = await screen.findByRole('dialog', { name: 'Quickbuild' })
    const suggestions = screen.getByLabelText('Suggestions')
    expect(suggestions.contains(panel)).toBe(true)
    expect(suggestions.className).toContain('region-overlaid')
    // The other two rails are still in the document and still labelled.
    expect(screen.getByLabelText('Deck')).toBeTruthy()
    expect(screen.getByLabelText('Analysis')).toBeTruthy()
  })

  it('drops the containing-block marker again when the panel closes', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    await toggle()
    await screen.findByRole('dialog', { name: 'Quickbuild' })
    await toggle()
    await waitFor(() =>
      expect(screen.getByLabelText('Suggestions').className).not.toContain('region-overlaid'),
    )
  })

  /*
   * The panel asks the gap's narrower question through the ordinary
   * recommendations request — `limitPerGroup: 8`, never 3 (ADR-0026), and the
   * gap's own group named when it has one.
   */
  const gapCall = () =>
    mocked.getRecommendations.mock.calls.find(
      (c) => typeof c[1]?.query === 'string' && c[1].query !== '',
    )

  /*
   * The leading gap here is CREATURE, not ramp, and that is the build order
   * working rather than a quirk of the fixture: the deck holds 4 cards against
   * a largest target of 26, so it is below the handover and follows the
   * archetype's plan, in which creature (26) outranks ramp (11). Worst-first
   * would have agreed here by coincidence — creature is also the bigger gap —
   * so the ordering itself is pinned in `quickbuild.test.ts`, where the two
   * rules can be made to disagree.
   *
   * A type gap has no group of its own, so no `groups` is sent and every group
   * is asked.
   */
  it('asks the ordinary endpoint for the leading gap, eight per group', async () => {
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    await toggle()
    await waitFor(() => {
      expect(gapCall()).toBeTruthy()
      expect(gapCall()![1].query).toBe('t:creature')
      // Eight, never three — asking for three would let the focus guarantee
      // append past a three-row list and the first three would drop exactly
      // the rows ADR-0026 promised.
      expect(gapCall()![1].limitPerGroup).toBe(8)
      expect(gapCall()![1].groups).toBeUndefined()
    })
  })

  /** A role gap DOES have a group named for it, and the request says so. */
  it('names the gap’s own group when the gap is a role', async () => {
    mocked.getAnalysis.mockResolvedValue({
      ...analysis,
      targets: [{ dimension: { role: 'ramp' }, ideal: 11, min: 8, max: 14, locked: 0, actual: 1 }],
      curve: { ...analysis.curve, deltas: [] },
    } as unknown as api.Analysis)
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(button()).toBeTruthy())
    await toggle()
    await waitFor(() => {
      expect(gapCall()).toBeTruthy()
      expect(gapCall()![1].query).toBe('role:ramp')
      expect(gapCall()![1].groups).toEqual(['fills-ramp'])
    })
  })
})
