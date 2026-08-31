// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CardMetrics } from './CardMetrics.js'
import { Detail } from './Detail.js'
import { IMPACT_MAX, type EfficiencyView, type ImpactView } from './metrics.js'
import type { CardView } from './types.js'

afterEach(cleanup)

/** `cardImpact(WRATH_OF_GOD)`, verbatim. */
const WRATH_IMPACT: ImpactView = {
  score: 6.12,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'symmetric',
  scales: false,
  fragile: false,
}

/** `cardEfficiency(WRATH_OF_GOD)`, verbatim. */
const WRATH_EFFICIENCY: EfficiencyView = {
  score: 0.549,
  statSurplus: 0,
  effectValue: 2.744,
  baseline: 6.781,
  cost: 5,
}

/** `cardImpact(FOREST)` / `cardEfficiency(FOREST)` — the degenerate pair. */
const LAND_IMPACT: ImpactView = {
  score: 0,
  breadth: 'none',
  persistence: 'one-shot',
  stakes: 'self',
  symmetry: 'none',
  scales: false,
  fragile: false,
}
const LAND_EFFICIENCY: EfficiencyView = {
  score: 0,
  statSurplus: 0,
  effectValue: 0,
  baseline: 0.541,
  cost: 1,
}

/** The section, so an assertion cannot be satisfied by text elsewhere on the page. */
const metrics = (): HTMLElement => screen.getByRole('region', { name: 'Impact and efficiency' })

describe('CardMetrics — the scale is on the screen', () => {
  it('prints the ceiling beside the score, so the number is never bare', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    // The bar this component exists to clear: "Impact 6.12" alone says nothing
    // about whether 6.12 is high.
    expect(within(metrics()).getByText('6.12')).toBeDefined()
    expect(within(metrics()).getByText(`of ${String(IMPACT_MAX)}`)).toBeDefined()
  })

  it('fills the meter to the score, not to the end of the track', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    const fill = metrics().querySelector('.rt-metric-fill')
    // A board wipe is a third of the way up this scale. If the fill ever reads
    // 100% for it, the meter has stopped dividing by anything.
    expect(fill?.getAttribute('style')).toMatch(/inline-size:\s*33\.11/)
  })

  it('labels efficiency with its unit rather than a second bare score', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    expect(within(metrics()).getByText('0.549')).toBeDefined()
    expect(within(metrics()).getByText('per mana')).toBeDefined()
  })

  it('draws no meter for efficiency, which has no ceiling to draw one against', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    // One meter on the panel, and it belongs to impact. A bar for a ratio would
    // need a maximum invented in the renderer.
    expect(metrics().querySelectorAll('.rt-metric-meter')).toHaveLength(1)
  })
})

describe('CardMetrics — the tiers are the reasons', () => {
  it('says what the card reaches, how often, and whose board', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    const panel = within(metrics())
    expect(panel.getByText('Reach')).toBeDefined()
    expect(panel.getByText('everything at once')).toBeDefined()
    expect(panel.getByText('once, then it is done')).toBeDefined()
    expect(panel.getByText("an opponent's side, your board included")).toBeDefined()
  })

  it('shows the arithmetic behind the rate', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    expect(
      within(metrics()).getByText(/No surplus body, plus 2\.744 for its text, over 5/),
    ).toBeDefined()
  })

  it('warns that a rate is not a ranking', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    expect(within(metrics()).getByText(/A rate, not a ranking/)).toBeDefined()
  })
})

describe('CardMetrics — degenerate and absent', () => {
  it('tells a land there is nothing to measure instead of leaving two zeroes', () => {
    render(<CardMetrics impact={LAND_IMPACT} efficiency={LAND_EFFICIENCY} />)
    const panel = within(metrics())
    expect(panel.getByText(/nothing here for this model to measure/)).toBeDefined()
    // And no confident tier claims about a card with no text. `stakes: 'self'`
    // on a Forest is a default, not a finding.
    expect(panel.queryByText('Reach')).toBeNull()
  })

  it('renders nothing at all when detail has not arrived', () => {
    const { container } = render(<CardMetrics />)
    // Not a heading over two blanks: detail lands after the card does, and a
    // section that flashes empty reads as a broken panel.
    expect(container.innerHTML).toBe('')
  })

  it('draws the half it has when only one metric is present', () => {
    render(<CardMetrics impact={WRATH_IMPACT} />)
    expect(within(metrics()).getByText('6.12')).toBeDefined()
    expect(within(metrics()).queryByText('per mana')).toBeNull()
  })
})

describe('CardMetrics — read-only', () => {
  it('adds no controls, because there is nothing here to operate', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    // AGENTS.md R4 governs anything interactive. These are figures. A control
    // added here later has to bring a keyboard equivalent and a focus ring with
    // it, and this test is what asks the question.
    expect(within(metrics()).queryAllByRole('button')).toHaveLength(0)
    expect(metrics().querySelectorAll('[tabindex], a, input, select')).toHaveLength(0)
  })

  it('does not make a screen reader read the same figure twice', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    // The meter restates the line above it, which is already text.
    expect(metrics().querySelector('.rt-metric-meter')?.getAttribute('aria-hidden')).toBe('true')
    expect(metrics().querySelector('[role="meter"]')).toBeNull()
  })
})

describe('Detail mounts it', () => {
  const card = (over: Partial<CardView> = {}): CardView => ({
    oracleId: 'o1',
    name: 'Wrath of God',
    manaCost: '{2}{W}{W}',
    manaValue: 4,
    typeLine: 'Sorcery',
    oracleText: "Destroy all creatures. They can't be regenerated.",
    reasons: ['Clears the board you are behind on'],
    ...over,
  })

  it('shows both metrics on the L3 detail pane', () => {
    render(<Detail card={card({ impact: WRATH_IMPACT, efficiency: WRATH_EFFICIENCY })} />)
    expect(within(metrics()).getByText('6.12')).toBeDefined()
    expect(within(metrics()).getByText('0.549')).toBeDefined()
  })

  it('puts them above "Why this is here"', () => {
    // Intrinsic before deck-relative: what the card does, then why it surfaced
    // here. `compareDocumentPosition` rather than a DOM index so a sibling
    // added between them does not break this.
    render(<Detail card={card({ impact: WRATH_IMPACT, efficiency: WRATH_EFFICIENCY })} />)
    const why = screen.getByText('Why this is here')
    expect(metrics().compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves the pane unchanged for a card that carries no metrics', () => {
    render(<Detail card={card()} />)
    expect(screen.queryByRole('region', { name: 'Impact and efficiency' })).toBeNull()
    expect(screen.getByText('Why this is here')).toBeDefined()
  })
})
