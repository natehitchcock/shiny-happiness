// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardView } from '@roundtable/ui'
import type { QuickbuildGap, QuickbuildPlan } from '@roundtable/domain'
import { Quickbuild, combinedQuery, type QuickbuildCandidate } from './Quickbuild'

afterEach(cleanup)

/**
 * The three option cards.
 *
 * Qualified by name: `Detail` renders each card's `reasons` as its own list, so
 * an unqualified `listitem` query returns nine elements, three of which are the
 * options and six of which are reason bullets.
 */
const options = (): HTMLElement[] => screen.getAllByRole('listitem', { name: /^Option \d/ })

/** Activate a control the way a click or Enter on it would. */
const press = async (button: HTMLElement): Promise<void> => {
  await act(async () => {
    button.click()
  })
}

const view = (name: string): CardView => ({
  oracleId: name,
  name,
  manaCost: '{1}{G}',
  manaValue: 2,
  colorIdentity: ['G'],
  typeLine: 'Artifact',
  oracleText: 'Add one mana.',
  primaryRole: 'ramp',
  priceUsd: 1,
  // Already sentences: `CardView.reasons` is `string[]`, because the workspace
  // owns the wording (`reasonText`) and every surface must phrase a reason the
  // same way. The panel never formats one itself.
  reasons: ['fills a ramp gap of 4'],
})

const candidate = (name: string, groupLabel = 'Fills gap · ramp'): QuickbuildCandidate => ({
  oracleId: name,
  view: view(name),
  groupLabel,
})

const rampGap: QuickbuildGap = {
  kind: 'composition',
  key: 'role:ramp',
  label: 'ramp',
  short: 4,
  dimension: { kind: 'role', role: 'ramp' },
}
const curveGap: QuickbuildGap = {
  kind: 'curve',
  key: 'mv:2',
  label: 'mana value 2',
  short: 3,
  bucket: 2,
}

const plan = (over: Partial<QuickbuildPlan> = {}): QuickbuildPlan => ({
  gaps: [rampGap, curveGap],
  ordering: 'largest-first',
  overFull: [],
  ...over,
})

const setup = (
  over: Partial<Parameters<typeof Quickbuild>[0]> = {},
  found: readonly QuickbuildCandidate[] = [candidate('Ai'), candidate('Bo'), candidate('Cy')],
) => {
  const fetchCandidates = vi.fn().mockResolvedValue(found)
  const onAdd = vi.fn()
  const onReject = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <Quickbuild
      plan={plan()}
      filter=""
      fetchCandidates={fetchCandidates}
      onAdd={onAdd}
      onReject={onReject}
      onClose={onClose}
      cutCount={0}
      {...over}
    />,
  )
  return { fetchCandidates, onAdd, onReject, onClose, ...utils }
}

describe('the gap becomes an ordinary query (D2, Q1 option c)', () => {
  it('asks the role gap’s own group for the role gap', async () => {
    const { fetchCandidates } = setup()
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('role:ramp', ['fills-ramp'])
  })

  /*
   * A curve gap has no group anywhere in the product, so it is asked of every
   * group and the answer is taken in the order the server emitted them. Pinned
   * because passing a group key here would silently return nothing.
   */
  it('asks every group for a curve gap, which has no group of its own', async () => {
    const { fetchCandidates } = setup({ plan: plan({ gaps: [curveGap] }) })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('mv=2', null)
  })
})

describe('an active filter (Q3)', () => {
  it('keeps the builder’s filter in force alongside the gap', () => {
    expect(combinedQuery('t:artifact', rampGap)).toBe('t:artifact role:ramp')
  })

  it('sends both to the server', async () => {
    const { fetchCandidates } = setup({ filter: 't:artifact' })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('t:artifact role:ramp', ['fills-ramp'])
  })

  /*
   * The panel SAYS the filter is narrowing it. This is the whole mitigation for
   * the risk Q3 names — a filter set an hour ago leaves a gap with no
   * candidates, and "nothing fills this gap" and "nothing matching your filter
   * fills this gap" are different sentences that must not render the same.
   */
  it('says so in words whenever a filter is in force', async () => {
    setup({ filter: 't:artifact' })
    await screen.findByText(/is also in force/i)
    expect(screen.getByText('t:artifact')).toBeTruthy()
  })

  it('says nothing about a filter when there is none', async () => {
    setup({ filter: '' })
    await screen.findByText(/Option 1 of 3/)
    expect(screen.queryByText(/is also in force/i)).toBeNull()
  })

  it('blames the filter, not the colours, when a filtered gap comes back empty', async () => {
    setup({ filter: 't:artifact' }, [])
    await screen.findByText(/Nothing matching your filter fills this gap/i)
  })

  it('blames the colours when an unfiltered gap comes back empty', async () => {
    setup({ filter: '' }, [])
    await screen.findByText(/Nothing in your colours fills this gap/i)
  })
})

describe('skip is a pass, not a rejection (D5)', () => {
  it('shows three different candidates and sends nothing', async () => {
    const six = ['Ai', 'Bo', 'Cy', 'Di', 'Ed', 'Fi'].map((n) => candidate(n))
    const { onReject, onAdd } = setup({}, six)
    await screen.findByText('Ai')
    await press(screen.getByRole('button', { name: /Skip these three/i }))
    await screen.findByText('Di')
    /*
     * ALL THREE are replaced, not just the first. Asserting only that `Ai` had
     * gone was too weak — advancing the window by one instead of three passes
     * that, and the mutation check found it: the builder would be shown two of
     * the same cards again and told they were different.
     */
    for (const gone of ['Ai', 'Bo', 'Cy']) expect(screen.queryByText(gone)).toBeNull()
    for (const shown of ['Di', 'Ed', 'Fi']) expect(screen.getByText(shown)).toBeTruthy()
    // And skipping is not a decision about a card at all.
    expect(onReject).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('reject is its own explicit action on the card it names', async () => {
    const { onReject } = setup()
    await screen.findByText('Ai')
    const first = options()[0]!
    await press(within(first).getByRole('button', { name: 'Reject' }))
    expect(onReject).toHaveBeenCalledWith('Ai')
  })

  it('adding goes through the ordinary accept (D4)', async () => {
    const { onAdd } = setup()
    await screen.findByText('Ai')
    const first = options()[0]!
    await press(within(first).getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith('Ai')
  })
})

describe('Quickbuild only adds, and says so (Q5)', () => {
  it('names the over-full bucket it cannot help with', async () => {
    setup({ plan: plan({ overFull: [{ bucket: 2, excess: 4 }] }), cutCount: 7 })
    await screen.findByText(/only adds cards/i)
    expect(screen.getByText(/4 too many at mana value 2/i)).toBeTruthy()
  })

  it('points at the cut indicator by name', async () => {
    setup({ plan: plan({ overFull: [{ bucket: 2, excess: 4 }] }), cutCount: 7 })
    await screen.findByText(/cut indicator names 7 cards/i)
  })

  it('stays quiet when nothing is over-full', async () => {
    setup({ plan: plan({ overFull: [] }) })
    await screen.findByText(/Option 1 of 3/)
    expect(screen.queryByText(/only adds cards/i)).toBeNull()
  })
})

describe('accessibility (§19.5) — driven with real keys', () => {
  it('is a dialog that takes focus on open', async () => {
    setup()
    const dialog = await screen.findByRole('dialog', { name: 'Quickbuild' })
    expect(document.activeElement).toBe(dialog)
  })

  it('closes on Escape', async () => {
    const { onClose } = setup()
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  /*
   * Focus RETURNS to whatever opened the panel. Driven by actually focusing a
   * button before mounting, because the claim is about `document.activeElement`
   * at unmount and an assertion about the code would not have caught the first
   * version of this, which returned focus to `document.body`.
   */
  it('returns focus to the opener on close', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Quickbuild'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(
      <Quickbuild
        plan={plan()}
        filter=""
        fetchCandidates={vi.fn().mockResolvedValue([candidate('Ai')])}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onClose={vi.fn()}
        cutCount={0}
      />,
    )
    await screen.findByRole('dialog')
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  /*
   * The focus trap, driven by real Tab keydown events on the real controls.
   *
   * WHAT THIS DOES AND DOES NOT PROVE, stated plainly because the difference
   * matters. jsdom does not implement Tab: it never moves focus by itself, so
   * no test in this environment can show that the browser's own focus order is
   * contained. What it CAN show is the thing this component actually
   * implements — that Tab on the last control wraps to the first and
   * Shift+Tab on the first wraps to the last, rather than leaving the panel.
   * The rest is verified in a browser and written up in the report.
   */
  const controls = (dialog: HTMLElement): HTMLElement[] =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    )

  it('wraps Tab from the last control back to the first', async () => {
    setup()
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Option 1 of 3')
    const focusable = controls(dialog)
    expect(focusable.length).toBeGreaterThan(1)
    const last = focusable[focusable.length - 1]!
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('wraps Shift+Tab from the first control back to the last', async () => {
    setup()
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Option 1 of 3')
    const focusable = controls(dialog)
    const first = focusable[0]!
    first.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusable[focusable.length - 1])
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('leaves Tab alone in the middle, so the natural order still works', async () => {
    setup()
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Option 1 of 3')
    const focusable = controls(dialog)
    const middle = focusable[1]!
    middle.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    // Not intercepted: focus is where the browser would have left it.
    expect(document.activeElement).toBe(middle)
  })

  it('announces each recompute to a live region', async () => {
    setup()
    const live = await screen.findByRole('status')
    expect(live.getAttribute('aria-live')).toBe('polite')
    await waitFor(() => expect(live.textContent).toMatch(/Ai, Bo, Cy/))
  })

  /*
   * The live region exists BEFORE it has anything to say. A region mounted at
   * the moment of its first message is usually not announced, because the
   * screen reader was not watching that node.
   */
  it('mounts the live region empty rather than creating it on first use', () => {
    render(
      <Quickbuild
        plan={plan()}
        filter=""
        fetchCandidates={() => new Promise(() => {})}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onClose={vi.fn()}
        cutCount={0}
      />,
    )
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('presents the three options as a list', async () => {
    setup()
    await screen.findByRole('list', { name: /three candidates/i })
    expect(options()).toHaveLength(3)
  })

  /*
   * Q4 — the panel always says which of the three is in view, so that at a
   * width where only one is drawn it is still asking "which of these three"
   * rather than "yes or no to this one".
   */
  it('says which of the three it is on', async () => {
    setup()
    await screen.findByText('Option 1 of 3')
  })

  it('moves the marker as focus moves between options, by keyboard', async () => {
    setup()
    await screen.findByText('Option 1 of 3')
    const second = options()[1]!
    const add = within(second).getByRole('button', { name: 'Add' })
    // A real focus, which is what Tab produces in a browser; the option marker
    // follows focus rather than hover, because §19.5 says moving between the
    // three is a keyboard operation.
    act(() => add.focus())
    fireEvent.focus(add)
    await screen.findByText('Option 2 of 3')
  })

  it('reports a failed load rather than showing an empty panel', async () => {
    const fetchCandidates = vi.fn().mockRejectedValue(new Error('down'))
    render(
      <Quickbuild
        plan={plan()}
        filter=""
        fetchCandidates={fetchCandidates}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onClose={vi.fn()}
        cutCount={0}
      />,
    )
    await screen.findByText(/Could not load candidates/i)
  })
})

describe('grouping stays the product’s opinion (P5)', () => {
  it('names the group each card was filed under', async () => {
    setup({}, [candidate('Ai', 'Completes 1 combo'), candidate('Bo')])
    await screen.findByText(/Offered under Completes 1 combo/i)
  })
})

describe('nothing to do', () => {
  it('says the deck is inside every band rather than showing an empty panel', async () => {
    setup({ plan: plan({ gaps: [] }) })
    await screen.findByText(/inside its band/i)
  })
})
