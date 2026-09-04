// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IMPACT_MAX as DOMAIN_MAX,
  cardEfficiency,
  cardImpact,
  impactRolePlacement,
  roleImpactBand,
  roleImpactIsMostlyUnreadable,
} from '@roundtable/domain'
import type {
  CardEfficiency,
  CardImpact,
  EfficiencyInput,
  RoleImpactBand,
  RoleImpactPlacement,
} from '@roundtable/domain'
import {
  IMPACT_MAX as UI_MAX,
  type EfficiencyView,
  type ImpactRoleView,
  type ImpactView,
} from '@roundtable/ui'
import * as api from './api'
import { Workspace } from './App'

/**
 * Impact and efficiency, on the pane a builder actually reads (doc 18 §18.8).
 *
 * Two things are tested here and nowhere else:
 *
 *   - the SEAM. Both metrics have been on the wire since they shipped and the
 *     client type never declared them, so nothing on screen showed either one.
 *     `packages/ui`'s own component tests would all have passed on the day the
 *     panel drew nothing, which is exactly the failure this file catches.
 *   - the CONTRACT between the domain model and the view model it is drawn
 *     through. `@roundtable/ui` deliberately does not depend on
 *     `@roundtable/domain`, so the two descriptions of a `CardImpact` are kept
 *     in step by this file and by nothing else.
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
    getCardDetail: vi.fn(),
    searchCards: vi.fn(),
  }
})

const mocked = vi.mocked(api)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

afterEach(cleanup)

/**
 * Wrath of God, with its real oracle text.
 *
 * The metrics below are NOT written down — they are computed by the domain from
 * this text, so the test asserts what the shipped model actually says rather
 * than what someone once typed. A fixture whose numbers are hand-copied passes
 * happily after the model has changed underneath it.
 */
const WRATH_TEXT = "Destroy all creatures. They can't be regenerated."

const wrath = (over: Partial<api.Card> = {}): api.Card => ({
  oracleId: 'o1',
  name: 'Wrath of God',
  manaCost: '{2}{W}{W}',
  manaValue: 4,
  typeLine: 'Sorcery',
  types: ['sorcery'],
  colors: ['W'],
  oracleText: WRATH_TEXT,
  power: null,
  toughness: null,
  loyalty: null,
  colorIdentity: ['W'],
  primaryRole: 'removal',
  edhrecRank: 100,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

/**
 * The same card as `@roundtable/domain` types it.
 *
 * Stated separately because `api.Card.types` is `string[]` and the domain's is
 * `readonly CardType[]`, so an API card does not assign to an `EfficiencyInput`
 * — worth knowing, and not this test's problem to fix.
 */
const WRATH_INPUT: EfficiencyInput = {
  name: 'Wrath of God',
  manaCost: '{2}{W}{W}',
  oracleText: WRATH_TEXT,
  typeLine: 'Sorcery',
  manaValue: 4,
  types: ['sorcery'],
  power: null,
  toughness: null,
}

const impactOf = (): CardImpact => cardImpact(WRATH_INPUT)
const efficiencyOf = (): CardEfficiency => cardEfficiency(WRATH_INPUT)

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: [],
  colorIdentity: ['W'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [{ oracleId: 'o1', zone: 'accepted', locked: false }],
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
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
      averageManaValue: 4,
      histogram: [0, 0, 0, 0, 1, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 1.25, pricedCards: 1, unpricedCards: 0, budget: null },
    unavailable: [],
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map([['o1', wrath()]]),
    prices: new Map([['o1', 1.25]]),
    images: new Map(),
  })
  mocked.basicLands.mockResolvedValue({ items: [] })
})

/** Open the deck row and wait for the preview panel to carry its detail. */
const openPreview = async (
  card: api.Card,
  detail: Partial<api.CardDetail>,
): Promise<HTMLElement> => {
  mocked.getCardDetail.mockResolvedValue({
    ...card,
    printings: [],
    combos: [],
    ...detail,
  } as api.CardDetail)
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(screen.getByText(card.name)).toBeTruthy())
  await act(async () => screen.getByText(card.name).click())
  return await screen.findByLabelText(`${card.name} details`)
}

describe('the preview panel draws both metrics', () => {
  it('shows the impact score against the scale it is measured on', async () => {
    const card = wrath()
    const panel = await openPreview(card, {
      impact: impactOf(),
      efficiency: efficiencyOf(),
    })
    const section = await within(panel).findByRole('region', { name: 'Impact and efficiency' })
    const shown = within(section)
    // 6.12 — and the point of the test is the second half: a reader who has
    // never seen this metric learns from the panel itself that the top is 18.48.
    expect(shown.getByText(String(impactOf().score))).toBeDefined()
    expect(shown.getByText(`of ${String(DOMAIN_MAX)}`)).toBeDefined()
  })

  it('explains the score with the model’s own tiers', async () => {
    const card = wrath()
    const panel = await openPreview(card, {
      impact: impactOf(),
      efficiency: efficiencyOf(),
    })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    // Why 6.12 and not 2: it hits everything, and it hits your board too. Both
    // halves are what the 0.85 symmetry discount was charged for.
    expect(shown.getByText('everything at once')).toBeDefined()
    expect(shown.getByText("an opponent's side, your board included")).toBeDefined()
  })

  it('offers the method behind each number, through the app’s own popover', async () => {
    /*
     * The wiring, end to end (doc 18 §18.14). `CardMetrics` owns the slot and
     * the copy; this app owns the disclosure, and the two only meet here — a
     * test in `@roundtable/ui` can prove the slot is called but not that
     * anything fills it, and a test of `Hint` can prove it opens but not that
     * the metrics reach for it.
     *
     * Through `Hint` rather than a `title`: it has to open on a phone, and it
     * brings the button, the accessible name and the focus ring that AGENTS.md
     * R4 asks for.
     */
    const card = wrath()
    const panel = await openPreview(card, { impact: impactOf(), efficiency: efficiencyOf() })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    const impactHelp = shown.getByRole('button', { name: 'How impact is worked out' })
    expect(shown.getByRole('button', { name: 'How efficiency is worked out' })).toBeDefined()

    // Closed until asked. The pane is unchanged for a reader who does not want
    // the method, which is the whole argument for putting it behind a control.
    expect(shown.queryByText(/multiplied together/)).toBeNull()

    await act(async () => {
      impactHelp.click()
      await Promise.resolve()
    })
    expect(await screen.findByText(/multiplied together/)).toBeDefined()
    // The blind spot is the reason a reader opens this at all. Scoped to the
    // popover, because the pane prints its own shorter "Effects only" note
    // unconditionally and this must be the explanation, not that.
    const popover = within(await screen.findByRole('tooltip'))
    expect(popover.getByText(/Effects only/)).toBeDefined()
    expect(popover.getByText(/same in every deck/)).toBeDefined()
  })

  it('shows efficiency as a rate, with its working and its caveat', async () => {
    const card = wrath()
    const panel = await openPreview(card, {
      impact: impactOf(),
      efficiency: efficiencyOf(),
    })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    expect(shown.getByText(String(efficiencyOf().score))).toBeDefined()
    expect(shown.getByText('per mana')).toBeDefined()
    expect(shown.getByText(/A rate, not a ranking/)).toBeDefined()
  })

  it('places the score against the card’s own role, not against the ceiling', async () => {
    // 6.12 of 18.48 reads as "a third of the best card in Magic" until the pane
    // says a board wipe's middle half starts at 6.12. `primaryRole` comes off
    // the detail response and the band off the baked table; nothing here is
    // typed by hand.
    const card = wrath({ primaryRole: 'board-wipe' })
    const panel = await openPreview(card, { impact: impactOf(), efficiency: efficiencyOf() })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    expect(shown.getByText(/Middle half of the .* board-wipe cards in the corpus/)).toBeDefined()
    // And the caveat stays generic. 70 of 502 board wipes name nothing this
    // model can count, which is a minority, so a "blind spot" sentence here
    // would be a false statement wearing the costume of sourcing.
    expect(shown.getByText(/a card whose job is mana or a tax reads low here/)).toBeDefined()
    expect(shown.queryByText(/blind spot/)).toBeNull()
  })

  it('tells a ramp rock its low score is the median for its role', async () => {
    // THE FAILURE THIS FEATURE EXISTS FOR. Sol Ring is 0.68 of 18.48 and
    // format-defining, and a builder shown only that number concludes the app
    // rates their whole mana base badly.
    const solRing = wrath({
      oracleId: 'o1',
      name: 'Sol Ring',
      manaCost: '{1}',
      manaValue: 1,
      typeLine: 'Artifact',
      types: ['artifact'],
      colors: [],
      oracleText: '{T}: Add {C}{C}.',
      primaryRole: 'ramp',
    })
    mocked.hydrate.mockResolvedValue({
      cards: new Map([['o1', solRing]]),
      prices: new Map([['o1', 1.25]]),
      images: new Map(),
    })
    const impact = cardImpact({
      name: 'Sol Ring',
      manaCost: '{1}',
      oracleText: '{T}: Add {C}{C}.',
      typeLine: 'Artifact',
    })
    const panel = await openPreview(solRing, { impact })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    expect(impact.score).toBeLessThan(1)
    expect(shown.getByText(/Middle half of the .* ramp cards in the corpus/)).toBeDefined()
    // And the caveat is quantified rather than generic, because for ramp the
    // blind spot IS the explanation of the number.
    expect(shown.getByText(/it finds nothing to count at all/)).toBeDefined()
  })

  it('says nothing about a role the shipped bands never measured', async () => {
    // A role a newer server invented, or one this build has never heard of. The
    // pane loses a sentence rather than gaining `undefined of undefined`.
    const card = wrath({ primaryRole: 'removal' })
    const panel = await openPreview(card, { impact: impactOf(), efficiency: efficiencyOf() })
    const shown = within(
      await within(panel).findByRole('region', { name: 'Impact and efficiency' }),
    )
    expect(shown.queryByText(/in the corpus; half of them score/)).toBeNull()
    expect(shown.getByText(/Effects only/)).toBeDefined()
  })

  it('draws nothing when the server answers without the fields', async () => {
    // A server from before doc 18 shipped. The panel must lose a section, not
    // gain a `NaN of 18.48`.
    const card = wrath()
    const panel = await openPreview(card, {})
    await waitFor(() => expect(within(panel).getByText(/est\./)).toBeTruthy())
    expect(within(panel).queryByRole('region', { name: 'Impact and efficiency' })).toBeNull()
  })
})

describe('the view model and the domain model agree', () => {
  it('quotes the same ceiling on both sides of the package boundary', () => {
    // `packages/ui` may not import `packages/domain` (see `types.ts`), so
    // `IMPACT_MAX` exists twice. This is the only thing stopping a moved tier
    // rung from silently mis-drawing every meter in the app.
    expect(UI_MAX).toBe(DOMAIN_MAX)
  })

  it('accepts a real `CardImpact` as an `ImpactView`', () => {
    // Structural, and checked at runtime as well as by `tsc`: a tier the domain
    // adds — a sixth `breadth`, say — would widen the domain union past the
    // view union and this assignment would stop compiling.
    const view: ImpactView = impactOf()
    expect(view.breadth).toBe('unbounded')
    expect(view.score).toBeLessThanOrEqual(UI_MAX)
  })

  it('accepts a real `CardEfficiency` as an `EfficiencyView`', () => {
    const view: EfficiencyView = efficiencyOf()
    expect(view.cost).toBe(5)
    expect(view.statSurplus).toBe(0)
  })

  it('accepts a real `RoleImpactBand` as the numbers half of an `ImpactRoleView`', () => {
    // Same seam as the two above, for doc 18 §18.12's baked table. A field
    // renamed in `impact-roles.ts` would stop compiling here rather than
    // silently drawing a sentence with `undefined` in it.
    const band = roleImpactBand('board-wipe') as RoleImpactBand
    const placement: RoleImpactPlacement = impactRolePlacement(cardImpact(WRATH_INPUT).score, band)
    const view: ImpactRoleView = {
      role: 'board-wipe',
      n: band.n,
      q1: band.q1,
      q3: band.q3,
      placement,
      mostlyUnreadable: roleImpactIsMostlyUnreadable(band),
      noCountableEffect: band.noCountableEffect,
    }
    expect(view.n).toBeGreaterThan(0)
    // Wrath of God is an ordinary wrath, not an outlier — it is the low end of
    // the middle half. That reading is the entire point of the feature and it
    // is asserted against the SHIPPED band, not a fixture.
    expect(view.placement).toBe('middle-half')
  })
})
