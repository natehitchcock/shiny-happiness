// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { Workspace } from './App'

/**
 * The composition rail was blind exactly where it was most useful.
 *
 * "Settled" means every card counted toward a role has been LOCKED, so there is
 * nothing left to decide there. The guard spelled that `locked >= actual &&
 * actual >= min` — and at zero cards both halves are vacuously true: nothing is
 * locked out of nothing, and a band whose floor is `max(0, ideal - width)` is 0
 * for every role with an ideal of 2 or less. So `counterspell 0/1` and
 * `graveyard-hate 0/1` read as "fully locked" and dropped out of the rail.
 *
 * Measured against a live five-colour deck at bracket 3: `GET /analysis`
 * returned 11 targets and the rail drew 9. The two missing rows were exactly
 * the two whose `min` was 0 and whose `actual` was 0 — and the suggestion feed
 * beside the rail was simultaneously heading groups "Fills gap · counterspell"
 * and "Fills gap · graveyard-hate", because the feed measures its deficit
 * against the IDEAL. The meter said nothing was wanted; the feed said two
 * things were.
 *
 * A role at zero has decided nothing. Vacuous truth is not settlement.
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
  targetOverrides: {},
  entries: [],
} as unknown as api.Deck

/**
 * One target, spelled as the wire spells it.
 *
 * `min` defaults to `max(0, ideal - 2)` because that is the domain's own band
 * for a role with a small ideal (`archetype-targets.ts`), which is what makes
 * `min: 0` the ordinary case rather than a contrived one.
 */
const target = (
  role: string,
  ideal: number,
  over: Partial<api.Analysis['targets'][number]> = {},
): api.Analysis['targets'][number] =>
  ({
    dimension: { kind: 'role', role },
    ideal,
    min: Math.max(0, ideal - 2),
    max: ideal + 2,
    locked: 0,
    actual: 0,
    source: 'archetype',
    preset: ideal,
    ...over,
  }) as unknown as api.Analysis['targets'][number]

const analysis = (targets: readonly api.Analysis['targets'][number][]): api.Analysis =>
  ({
    counts: { total: 0, byRole: {} },
    targets,
    targetOverrides: {},
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 2,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      target: [],
      preset: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [],
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
  mocked.hydrate.mockResolvedValue({
    cards: new Map(),
    prices: new Map(),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

/** The role names the rail actually drew, in order. */
const rows = async (): Promise<string[]> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByText('Adjust targets')).toBeTruthy())
  return [...document.querySelectorAll('.comp-hint .meter-label')].map((m) =>
    (m.textContent ?? '').replace(/\s+/g, ' ').trim(),
  )
}

describe('the composition rail — a role at zero is not settled', () => {
  it('draws a role whose band floor is zero and which holds no cards', async () => {
    // The exact shape from the live deck: ideal 1, band 2, so min 0.
    mocked.getAnalysis.mockResolvedValue(analysis([target('counterspell', 1)]))
    expect(await rows()).toEqual([expect.stringContaining('counterspell')])
  })

  it('draws every target the analysis sent when none of them is locked', async () => {
    // 11 in, 11 out. The live deck sent 11 and the rail drew 9.
    const targets = [
      target('land', 35, { actual: 6 }),
      target('ramp', 11, { actual: 1 }),
      target('draw', 9),
      target('spot-removal', 6),
      target('counterspell', 1),
      target('graveyard-hate', 1),
      target('bounce', 1, { actual: 1 }),
      target('board-wipe', 3),
      target('tutor', 3),
      target('protection', 4),
    ]
    mocked.getAnalysis.mockResolvedValue(analysis(targets))
    expect(await rows()).toHaveLength(targets.length)
  })

  it('still drops a role once every card counted toward it is locked', async () => {
    // The other half of "settled", and the half that was right. This is what
    // the gold locked overlay means, so a fix that lost it would be a
    // different bug wearing the same patch.
    mocked.getAnalysis.mockResolvedValue(
      analysis([target('ramp', 11, { actual: 11, locked: 11 }), target('draw', 9)]),
    )
    expect(await rows()).toEqual([expect.stringContaining('draw')])
  })

  it('keeps a role that is fully locked but still under its floor', async () => {
    // `locked >= actual` alone would settle this, and it is not settled: the
    // deck is two cards short of the band and both cards it has are committed.
    mocked.getAnalysis.mockResolvedValue(analysis([target('draw', 9, { actual: 2, locked: 2 })]))
    expect(await rows()).toEqual([expect.stringContaining('draw')])
  })

  it('drops a partly-locked role only when the checkbox asks it to', async () => {
    // The checkbox's own promise, unchanged: it hides roles that MERELY meet
    // their target. Unchecked, a role inside its band is still drawn.
    mocked.getAnalysis.mockResolvedValue(analysis([target('ramp', 11, { actual: 11, locked: 4 })]))
    expect(await rows()).toEqual([expect.stringContaining('ramp')])
  })
})
