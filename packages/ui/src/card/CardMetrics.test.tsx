// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CardMetrics, type MetricExplainer } from './CardMetrics.js'
import { Detail } from './Detail.js'
import { IMPACT_MAX, type EfficiencyView, type ImpactRoleView, type ImpactView } from './metrics.js'
import type { CardView } from './types.js'

afterEach(cleanup)

/** `cardImpact(WRATH_OF_GOD)`, verbatim. */
const WRATH_IMPACT: ImpactView = {
  score: 6.12,
  breadth: 'unbounded',
  persistence: 'one-shot',
  stakes: 'opposing',
  symmetry: 'symmetric',
  severity: 'none',
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
  severity: 'none',
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

/**
 * `cardImpact(SOL_RING)` — 0.68, the card that makes this whole feature
 * necessary. Format-defining, and a twenty-seventh of the way up the meter.
 */
const SOL_RING_IMPACT: ImpactView = {
  score: 0.68,
  breadth: 'none',
  persistence: 'activated',
  stakes: 'own',
  symmetry: 'none',
  severity: 'none',
  scales: false,
  fragile: false,
}

/**
 * Role bands copied verbatim from `packages/domain/src/impact/by-role.data.json`.
 * Two very different shapes on purpose — a uniform pair could not detect a
 * renderer that ignored the role.
 */
const BOARD_WIPE_ROLE: ImpactRoleView = {
  role: 'board-wipe',
  n: 502,
  q1: 6.12,
  q3: 8.4,
  placement: 'middle-half',
  mostlyUnreadable: false,
  noCountableEffect: 70,
}
const RAMP_ROLE: ImpactRoleView = {
  role: 'ramp',
  n: 1401,
  q1: 0.68,
  q3: 1.4,
  placement: 'middle-half',
  mostlyUnreadable: true,
  noCountableEffect: 961,
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
    expect(fill?.getAttribute('style')).toMatch(/inline-size:\s*27\.59/)
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

describe('CardMetrics — the number is placed against its own role', () => {
  it('tells a board wipe that 6.12 is an ordinary board wipe', () => {
    render(
      <CardMetrics
        impact={WRATH_IMPACT}
        efficiency={WRATH_EFFICIENCY}
        impactRole={BOARD_WIPE_ROLE}
      />,
    )
    expect(within(metrics()).getByText(/Middle half of the 502 board-wipe cards/)).toBeDefined()
    expect(within(metrics()).getByText(/half of them score 6\.12 to 8\.4/)).toBeDefined()
  })

  it('tells a ramp rock that 0.68 is an ordinary ramp card', () => {
    // The regression in one line. 0.68 of 18.48 reads as a condemnation of Sol
    // Ring until the pane says it is the median of its role, and the number
    // that says so must be the RAMP band and not the board-wipe one.
    render(<CardMetrics impact={SOL_RING_IMPACT} impactRole={RAMP_ROLE} />)
    const panel = within(metrics())
    expect(panel.getByText(/Middle half of the 1,401 ramp cards/)).toBeDefined()
    expect(panel.queryByText(/board-wipe/)).toBeNull()
  })

  it('swaps the generic caveat for the measured one where the model is blind', () => {
    render(<CardMetrics impact={SOL_RING_IMPACT} impactRole={RAMP_ROLE} />)
    const panel = within(metrics())
    expect(panel.getByText(/961 of those 1,401 it finds nothing to count/)).toBeDefined()
    expect(panel.queryByText(/a card whose job is mana or a tax reads low here/)).toBeNull()
  })

  it('keeps the generic caveat where the model reads the role well', () => {
    render(
      <CardMetrics
        impact={WRATH_IMPACT}
        efficiency={WRATH_EFFICIENCY}
        impactRole={BOARD_WIPE_ROLE}
      />,
    )
    const panel = within(metrics())
    expect(panel.getByText(/a card whose job is mana or a tax reads low here/)).toBeDefined()
    expect(panel.queryByText(/blind spot/)).toBeNull()
  })

  it('draws the pane unchanged when no role reached it', () => {
    // Search results and half-resolved imports have no role. Silence, not a
    // band of zeroes and not a hole where a sentence should be.
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    expect(metrics().querySelector('.rt-metric-role')).toBeNull()
    expect(
      within(metrics()).getByText(/a card whose job is mana or a tax reads low here/),
    ).toBeDefined()
  })

  it('stays read-only: the placement is a sentence, not a control', () => {
    // AGENTS.md R4 governs anything interactive, and the whole point of putting
    // this inline rather than behind a disclosure is that a reader who does not
    // yet know they need it still sees it.
    render(<CardMetrics impact={SOL_RING_IMPACT} impactRole={RAMP_ROLE} />)
    expect(within(metrics()).queryAllByRole('button')).toHaveLength(0)
    expect(metrics().querySelectorAll('[tabindex], a, input, select')).toHaveLength(0)
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
  it('adds no controls of its own, because there is nothing here to operate', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    // AGENTS.md R4 governs anything interactive. These are figures, and this
    // file still contributes no control: the ONE disclosure the pane has is
    // supplied by the app through `explain`, and R4 is satisfied inside `Hint`,
    // which is already a button with a focus ring and a touch target. A control
    // added HERE later has to bring those with it, and this test is what asks.
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

/**
 * HOW THE NUMBERS ARE WORKED OUT, on request (report 5).
 *
 * The slot, not the popover. `Hint` lives in `apps/web` and this package does
 * not import from an app, so what is checked here is the contract: one
 * explainer per metric, each carrying its own label and its own lines, and a
 * pane that is byte-for-byte unchanged when no explainer is supplied.
 */
describe('CardMetrics — the explanation slot', () => {
  /** Stands in for the app's `Hint`. Renders the label and the lines flat. */
  const spy: MetricExplainer = ({ label, lines }) => (
    <span data-testid="explainer">
      <span>{label}</span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  )

  it('offers one explanation for impact and a different one for efficiency', () => {
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} explain={spy} />)
    const shown = within(metrics()).getAllByTestId('explainer')
    expect(shown).toHaveLength(2)
    expect(shown[0]?.textContent).toContain('How impact is worked out')
    expect(shown[1]?.textContent).toContain('How efficiency is worked out')
    // Two metrics, two methods. One shared explanation would be wrong for both.
    expect(shown[0]?.textContent).not.toBe(shown[1]?.textContent)
  })

  it('explains the tiers using the same three words the rows above use', () => {
    render(<CardMetrics impact={WRATH_IMPACT} explain={spy} />)
    const said = within(metrics()).getByTestId('explainer').textContent ?? ''
    for (const label of ['Reach', 'Repeats', 'Falls on']) expect(said).toContain(label)
  })

  it('names the blind spot, which is the whole reason a reader opens it', () => {
    // A builder opens this because Sol Ring reads 0.68 and they think the app
    // is wrong. The answer is that only effects are read (doc 18 §18.2).
    render(<CardMetrics impact={WRATH_IMPACT} explain={spy} />)
    expect(within(metrics()).getByTestId('explainer').textContent).toContain('Effects only')
  })

  it('leaves the pane exactly as it was when no explainer is supplied', () => {
    // The L3 `Detail` primitive has no popover to give, and must not sprout a
    // dead trigger because of it.
    render(<CardMetrics impact={WRATH_IMPACT} efficiency={WRATH_EFFICIENCY} />)
    expect(within(metrics()).queryAllByTestId('explainer')).toHaveLength(0)
    expect(within(metrics()).getByText('Impact')).toBeDefined()
  })

  it('draws no explainer for a metric that is not on the pane at all', () => {
    render(<CardMetrics impact={WRATH_IMPACT} explain={spy} />)
    expect(within(metrics()).getAllByTestId('explainer')).toHaveLength(1)
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

  it('carries the role placement through to the L3 pane too', () => {
    // ONE COMPONENT, TWO MOUNTS. `App.tsx`'s preview panel is the other one, and
    // a placement that only reached one of them would be two surfaces
    // disagreeing about the same card.
    render(
      <Detail
        card={card({
          impact: WRATH_IMPACT,
          efficiency: WRATH_EFFICIENCY,
          impactRole: BOARD_WIPE_ROLE,
        })}
      />,
    )
    expect(within(metrics()).getByText(/Middle half of the 502 board-wipe cards/)).toBeDefined()
  })

  it('leaves the pane unchanged for a card that carries no metrics', () => {
    render(<Detail card={card()} />)
    expect(screen.queryByRole('region', { name: 'Impact and efficiency' })).toBeNull()
    expect(screen.getByText('Why this is here')).toBeDefined()
  })
})
