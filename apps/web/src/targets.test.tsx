// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The archetype customiser, from the panel it edits (doc 16).
 *
 * Everything here is about the three properties a naive number form would not
 * have: the preset stays visible, the totals warn without blocking, and every
 * override has a way out. The arithmetic is the domain's and is tested there.
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
  targetOverrides: {},
  entries: [],
}

const target = (
  role: string,
  ideal: number,
  over: Partial<api.Analysis['targets'][number]> = {},
): api.Analysis['targets'][number] => ({
  dimension: { role },
  ideal,
  min: ideal - 2,
  max: ideal + 2,
  locked: 0,
  // On target by default, so a test that wants a row to BECOME short has a
  // baseline where it was not — the change summary is a diff, not a snapshot.
  actual: ideal,
  source: 'archetype',
  preset: ideal,
  ...over,
})

const band = (ideal: number): { ideal: number; min: number; max: number } => ({
  ideal,
  min: ideal - 0.01,
  max: ideal + 0.01,
})

const analysis = (over: Partial<api.Analysis> = {}): api.Analysis =>
  ({
    counts: { total: 0, byRole: {} },
    // Two roles, so "only this row moved" is a claim the test can make.
    targets: [target('land', 36), target('ramp', 10)],
    targetOverrides: {},
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 3,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      // Eight equal buckets: 1/8 of 63 spells rounds to 8 in every one, which
      // makes the preset a number the test can name without arithmetic.
      target: Array.from({ length: 8 }, () => band(0.125)),
      preset: Array.from({ length: 8 }, () => band(0.125)),
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: Array.from({ length: 8 }, (_, bucket) => ({
        bucket,
        actual: 0,
        ideal: 8,
        min: 6,
        max: 10,
        delta: 6,
        withinRange: false,
      })),
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [],
    ...over,
  }) as unknown as api.Analysis

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockResolvedValue(analysis())
  // `images` is required since card art shipped; without it `hydrate`'s result
  // is not a `Hydrated` and the whole load fails, leaving `analysis` null and
  // the Composition panel — and its Adjust targets button — unrendered.
  mocked.hydrate.mockResolvedValue({
    cards: new Map(),
    prices: new Map(),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.patchDeck.mockResolvedValue(deck)
})

afterEach(cleanup)

const open = async (): Promise<void> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByText('Adjust targets')).toBeTruthy())
  await act(async () => {
    fireEvent.click(screen.getByText('Adjust targets'))
  })
}

const boxFor = (label: RegExp): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement

const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
}

describe('the archetype customiser', () => {
  it('opens from the composition panel and shows the preset behind every field', async () => {
    await open()
    // Doc 16's first requirement: the value you are overriding is the context
    // for the number you are typing. A box showing only 36 cannot tell you the
    // archetype wanted 36 either.
    expect(boxFor(/^land target/).value).toBe('36')
    expect(screen.getByLabelText(/^land target/).getAttribute('aria-label')).toMatch(
      /archetype wants 36/,
    )
  })

  it('sends only what was typed, not a copy of the preset', async () => {
    // The load-bearing property of the whole feature. A full snapshot would
    // freeze this deck against today's presets, silently and forever.
    await open()
    await type(boxFor(/^ramp target/), '14')
    await act(async () => {
      fireEvent.click(screen.getByText('Save targets'))
    })

    expect(mocked.patchDeck).toHaveBeenCalledWith('d1', {
      targetOverrides: { roles: { 'role:ramp': 14 } },
    })
  })

  it('drops a row typed back to its preset rather than pinning the same number', async () => {
    // Otherwise the deck stops inheriting revisions of a row the user never
    // meant to freeze, and nothing anywhere would say it had.
    await open()
    await type(boxFor(/^ramp target/), '14')
    await type(boxFor(/^ramp target/), '10')
    await act(async () => {
      fireEvent.click(screen.getByText('Save targets'))
    })
    expect(mocked.patchDeck).toHaveBeenCalledWith('d1', { targetOverrides: {} })
  })

  it('offers a per-row reset only once the row has changed', async () => {
    await open()
    expect(screen.queryByLabelText('Reset ramp')).toBeNull()
    await type(boxFor(/^ramp target/), '14')
    expect(screen.getByLabelText('Reset ramp')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Reset ramp'))
    })
    expect(boxFor(/^ramp target/).value).toBe('10')
    expect(screen.queryByLabelText('Reset ramp')).toBeNull()
  })

  it('clears everything at once, and the clear is a real save', async () => {
    // The way back out. An override a builder cannot get rid of is a trap.
    mocked.getAnalysis.mockResolvedValue(
      analysis({
        targetOverrides: { roles: { 'role:ramp': 14 } },
        targets: [target('land', 36), target('ramp', 14, { source: 'custom', preset: 10 })],
      }),
    )
    await open()
    await act(async () => {
      fireEvent.click(screen.getByText('Reset all'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save targets'))
    })
    expect(mocked.patchDeck).toHaveBeenCalledWith('d1', { targetOverrides: {} })
  })

  it('warns when the roles total goes over 99 without blocking the save', async () => {
    // Doc 03 §3.2's principle: a builder may knowingly aim high while cutting,
    // exactly as they may knowingly cross a bracket line.
    await open()
    await type(boxFor(/^ramp target/), '90')
    const total = screen.getByText(/Roles total/)
    expect(total.getAttribute('data-over')).toBe('true')
    expect(total.textContent).toMatch(/over/)
    expect((screen.getByText('Save targets') as HTMLButtonElement).disabled).toBe(false)
  })

  it('totals the curve against the spells a curve is a count of, not against 99', async () => {
    await open()
    // Eight buckets at the preset, which for an even shape is 8 cards each.
    expect(screen.getByText(/Curve total/).textContent).toMatch(/64 of 63 spells/)
  })

  it('marks a customised meter so the builder can see whose number it is', async () => {
    mocked.getAnalysis.mockResolvedValue(
      analysis({
        targets: [target('land', 36), target('ramp', 14, { source: 'custom', preset: 10 })],
      }),
    )
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getByText('Adjust targets')).toBeTruthy())
    /*
     * Read off the ACCESSIBLE NAME, not a `title`.
     *
     * The bar's numbers used to live in a `title` on the track. No touch
     * browser shows a `title`, so the sentence explaining whose number this is
     * was invisible on a phone. The bar is now a hint trigger — it opens the
     * cards it counts — and that trigger's name carries the same sentence,
     * which is a thing every device can reach.
     */
    const meter = screen.getByLabelText(/you set this/)
    expect(meter.getAttribute('aria-label')).toMatch(/the archetype wanted 10/)
  })

  it('closes on Escape without saving', async () => {
    await open()
    await type(boxFor(/^ramp target/), '14')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByText('Save targets')).toBeNull()
    expect(mocked.patchDeck).not.toHaveBeenCalled()
  })

  it('says what changed after a save rather than moving numbers silently', async () => {
    // "Tuning a target with no visible consequence is how a user loses trust in
    // the numbers" — doc 16. The summary is read off the analysis that comes
    // back, so it can never describe a state that did not exist.
    await open()
    await type(boxFor(/^ramp target/), '40')
    mocked.getAnalysis.mockResolvedValue(
      analysis({
        // The deck still holds ten ramp spells; the TARGET moved out from under
        // it, which is exactly the consequence the summary has to make visible.
        targets: [
          target('land', 36),
          target('ramp', 40, { source: 'custom', min: 38, actual: 10 }),
        ],
        cuts: [{ oracleId: 'x', score: 1, reasons: [{ kind: 'no-synergy' }] }],
      }) as unknown as api.Analysis,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('Save targets'))
    })

    // By text, not by role: the masthead's progress bar is a live region too,
    // and `getByRole('status')` would be ambiguous between the two.
    await waitFor(() => expect(screen.getByText(/Targets saved/)).toBeTruthy())
    const said = screen.getByText(/Targets saved/).textContent ?? ''
    expect(said).toMatch(/ramp now needs cards/)
    expect(said).toMatch(/\+1 cut hints/)
  })

  it('says whose gap a suggestion fills, not just that it fills one', async () => {
    /*
     * Pillar P4, and the reason this feature touches `recommendation.ts` at all.
     * "Fills ramp gap" and "fills the ramp target you set" are different claims,
     * and when the suggestions look wrong the second one names the thing the
     * builder can actually change.
     */
    const reasoned = (source: 'archetype' | 'custom'): api.Recommendations =>
      ({
        datasetSnapshotId: null,
        groups: [
          {
            key: 'fills-ramp',
            label: 'Fills ramp',
            rationale: 'why',
            total: 1,
            items: [
              {
                oracleId: 'o1',
                score: 1,
                comboDegree: 0,
                nearCombosAt1: 0,
                reasons: [
                  { kind: 'fills-deficit', dimension: { role: 'ramp' }, deficit: 4, source },
                ],
              },
            ],
          },
        ],
        columns: [],
        unavailable: [],
        query: { matched: 1, errors: [] },
      }) as unknown as api.Recommendations

    mocked.hydrate.mockResolvedValue({
      cards: new Map([
        [
          'o1',
          {
            oracleId: 'o1',
            name: 'Rock',
            manaCost: '{2}',
            manaValue: 2,
            typeLine: 'Artifact',
            types: ['artifact'],
            oracleText: '',
            colorIdentity: [],
            primaryRole: 'ramp',
            edhrecRank: null,
            universesBeyond: false,
            // Added to `Card` after this fixture was written.
            power: null,
            toughness: null,
            loyalty: null,
            synergyProduces: [],
            synergyWants: [],
          } as api.Card,
        ],
      ]),
      prices: new Map(),
      images: new Map(),
    } satisfies api.Hydrated)

    mocked.getRecommendations.mockResolvedValue(reasoned('archetype'))
    render(<Workspace deck={deck} />)
    await waitFor(() => expect(screen.getAllByText('fills ramp gap').length).toBeGreaterThan(0))

    cleanup()
    mocked.getRecommendations.mockResolvedValue(reasoned('custom'))
    render(<Workspace deck={deck} />)
    await waitFor(() =>
      expect(screen.getAllByText('fills the ramp target you set').length).toBeGreaterThan(0),
    )
  })

  it('is reachable and operable by keyboard alone', async () => {
    // AGENTS.md R4. Every control is a native input or button, so this is a
    // check that none of them lost their accessible name.
    await open()
    expect(screen.getByLabelText(/^ramp target/).tagName).toBe('INPUT')
    expect(screen.getByLabelText(/^Tolerance/).tagName).toBe('INPUT')
    for (const name of ['Save targets', 'Cancel', 'Reset all']) {
      expect(screen.getByText(name, { selector: 'button' }).tagName, name).toBe('BUTTON')
    }
    // Labelled rather than named by its text, because "Close" alone is not a
    // usable name for a screen reader that has three of them on the page.
    expect(screen.getByLabelText('Close targets').tagName).toBe('BUTTON')
  })
})
