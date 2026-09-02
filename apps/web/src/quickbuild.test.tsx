// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardView } from '@roundtable/ui'
import type { QuickbuildGap, QuickbuildPlan } from '@roundtable/domain'
import { Quickbuild, combinedQuery, type QuickbuildCandidate } from './Quickbuild'

/** Mirrors the panel's own constants, so a drift between them is visible here. */
const BAR_DELAY = 150
const OPTIONS_SHOWN = 3

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

const removalGap: QuickbuildGap = {
  kind: 'composition',
  key: 'role:spot-removal',
  label: 'spot removal',
  short: 3,
  dimension: { kind: 'role', role: 'spot-removal' },
}

const plan = (over: Partial<QuickbuildPlan> = {}): QuickbuildPlan => ({
  gaps: [rampGap, curveGap],
  ordering: 'largest-first',
  overFull: [],
  reach: 'band',
  beyond: [],
  // 58 of 100, which is the deck in the report.
  held: 58,
  unallocated: 42,
  unroled: 25,
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
  const onReach = vi.fn()
  const utils = render(
    <Quickbuild
      plan={plan()}
      filter=""
      fetchCandidates={fetchCandidates}
      onAdd={onAdd}
      onReject={onReject}
      onClose={onClose}
      onReach={onReach}
      cutCount={0}
      retiredIds={new Set<string>()}
      {...over}
    />,
  )
  return { fetchCandidates, onAdd, onReject, onClose, onReach, ...utils }
}

describe('the gap becomes an ordinary query (D2, Q1 option c)', () => {
  it('asks the role gap’s own group for the role gap', async () => {
    const { fetchCandidates } = setup()
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('role:ramp', ['fills-ramp'], 8)
  })

  /*
   * A curve gap has no group anywhere in the product, so it is asked of every
   * group and the answer is taken in the order the server emitted them. Pinned
   * because passing a group key here would silently return nothing.
   */
  it('asks every group for a curve gap, which has no group of its own', async () => {
    const { fetchCandidates } = setup({ plan: plan({ gaps: [curveGap] }) })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('mv=2', null, 8)
  })
})

describe('an active filter (Q3)', () => {
  it('keeps the builder’s filter in force alongside the gap', () => {
    expect(combinedQuery('t:artifact', rampGap)).toBe('t:artifact role:ramp')
  })

  it('sends both to the server', async () => {
    const { fetchCandidates } = setup({ filter: 't:artifact' })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('t:artifact role:ramp', ['fills-ramp'], 8)
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
        onReach={vi.fn()}
        cutCount={0}
        retiredIds={new Set<string>()}
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
        onReach={vi.fn()}
        cutCount={0}
        retiredIds={new Set<string>()}
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
        onReach={vi.fn()}
        cutCount={0}
        retiredIds={new Set<string>()}
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

/**
 * The sentence the ending prints, without the live region's copy of it.
 *
 * Every string the panel says at the end is also announced (§19.5), so an
 * unscoped text query matches twice and reports an ambiguity rather than a
 * result. The visible one is what these tests are about; the announcement has
 * its own test.
 */
const ending = (): HTMLElement => screen.getByRole('group', { name: /no gaps left/i })

describe('nothing to do', () => {
  it('says the deck is inside every band rather than showing an empty panel', () => {
    setup({ plan: plan({ gaps: [] }) })
    expect(ending().textContent).toMatch(/inside its band/i)
  })
})

/**
 * The queue.
 *
 * Every test here distinguishes "served from the queue" from "fetched again and
 * happened to match" by counting `fetchCandidates` calls, not by comparing card
 * names. A test that only checked names would pass against the refetching
 * implementation this replaces, and would therefore be vacuous.
 */
describe('the queue serves the next trio without a request', () => {
  const six = ['Ai', 'Bo', 'Cy', 'Di', 'Ed', 'Fi']

  /**
   * Render, then re-render with a growing retired set, as the workspace does.
   *
   * The fixture is padded to a DEEP queue on purpose. A shallow one owes a
   * background top-up, and that top-up is a second `fetchCandidates` call — so
   * a test asserting "no further request" would be measuring the top-up rather
   * than the thing it means to measure, and would fail or pass by timing. The
   * top-up has its own tests; these isolate the queue.
   */
  const mounted = (named: readonly QuickbuildCandidate[]) => {
    const found = [...named, ...Array.from({ length: 30 }, (_, i) => candidate(`pad${i}`))]
    const fetchCandidates = vi.fn().mockResolvedValue(found)
    const props = {
      plan: plan(),
      filter: '',
      fetchCandidates,
      onAdd: vi.fn(),
      onReject: vi.fn(),
      onClose: vi.fn(),
      onReach: vi.fn(),
      cutCount: 0,
    }
    const view = render(<Quickbuild {...props} retiredIds={new Set<string>()} />)
    const retire = async (ids: readonly string[]): Promise<void> => {
      await act(async () => {
        view.rerender(<Quickbuild {...props} retiredIds={new Set(ids)} />)
      })
    }
    return { retire, fetchCandidates }
  }

  it('advances past an added card with no further request', async () => {
    const { retire, fetchCandidates } = mounted(six.map((n) => candidate(n)))
    await screen.findByText('Ai')
    const calls = fetchCandidates.mock.calls.length
    await retire(['Ai'])
    await screen.findByText('Di')
    expect(options().map((o) => o.getAttribute('aria-label')?.split(': ')[1])).toEqual([
      'Bo',
      'Cy',
      'Di',
    ])
    expect(fetchCandidates.mock.calls.length).toBe(calls)
  })

  it('advances past three adds in a row, still with no further request', async () => {
    const { retire, fetchCandidates } = mounted(six.map((n) => candidate(n)))
    await screen.findByText('Ai')
    const calls = fetchCandidates.mock.calls.length
    await retire(['Ai'])
    await retire(['Ai', 'Bo'])
    await retire(['Ai', 'Bo', 'Cy'])
    await screen.findByText('Fi')
    expect(fetchCandidates.mock.calls.length).toBe(calls)
  })

  /*
   * P6, and why `retiredIds` is applied on every render rather than at fetch
   * time: a card excluded in the FEED behind the panel must leave the queue
   * without the queue being refetched.
   */
  it('drops a card excluded elsewhere, without refetching', async () => {
    const { retire, fetchCandidates } = mounted(six.map((n) => candidate(n)))
    await screen.findByText('Bo')
    const calls = fetchCandidates.mock.calls.length
    await retire(['Bo'])
    await waitFor(() => expect(screen.queryByText('Bo')).toBeNull())
    expect(fetchCandidates.mock.calls.length).toBe(calls)
  })

  it('skips to the next trio with no request (D5 stays a pass)', async () => {
    const { fetchCandidates } = mounted(six.map((n) => candidate(n)))
    await screen.findByText('Ai')
    const calls = fetchCandidates.mock.calls.length
    await press(screen.getByRole('button', { name: /Skip these three/i }))
    await screen.findByText('Di')
    expect(fetchCandidates.mock.calls.length).toBe(calls)
  })
})

describe('the deep page is fetched in the background (the prefetch)', () => {
  it('tops up a shallow queue without ever showing a wait', async () => {
    // Four is fewer than two trios, so a top-up is owed.
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(['Ai', 'Bo', 'Cy', 'Di'].map((n) => candidate(n)))
      .mockResolvedValue(
        ['Ai', 'Bo', 'Cy', 'Di', 'Ed', 'Fi', 'Gi', 'Ha', 'Iz'].map((n) => candidate(n)),
      )
    setup({ fetchCandidates })
    await screen.findByText('Ai')
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    // It asks for the DEEP page, and it is a background fetch, so the panel
    // never says it is waiting and the trio on screen never blanks.
    expect(fetchCandidates.mock.calls[1]![2]).toBe(24)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Ai')).toBeTruthy()
  })

  it('does not top up a queue that is already deep', async () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate(`c${i}`))
    const fetchCandidates = vi.fn().mockResolvedValue(many)
    setup({ fetchCandidates })
    await screen.findByText('c0')
    // Give a top-up every chance to fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(fetchCandidates.mock.calls.length).toBe(1)
  })

  /*
   * ADR-0026, one layer up. Neither page may be three: the focus guarantee
   * appends past `limitPerGroup`, so a three-row request followed by taking
   * three from the front discards exactly the rows it promised.
   */
  it('never asks for three per group', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(['Ai', 'Bo', 'Cy', 'Di'].map((n) => candidate(n)))
      .mockResolvedValue(Array.from({ length: 20 }, (_, i) => candidate(`c${i}`)))
    setup({ fetchCandidates })
    await screen.findByText('Ai')
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    for (const call of fetchCandidates.mock.calls) {
      expect(call[2]).toBeGreaterThan(OPTIONS_SHOWN)
    }
  })
})

describe('a stale queue is discarded, never shown', () => {
  /*
   * The failure this whole change risks introducing: three cards for a gap
   * whose heading is no longer on screen.
   */
  it('does not show the old gap’s cards under a new gap', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce([candidate('RampOne'), candidate('RampTwo')])
      .mockResolvedValue([candidate('CurveOne'), candidate('CurveTwo')])
    setup({ fetchCandidates })
    await screen.findByText('RampOne')
    await press(screen.getByRole('button', { name: /Different gap/i }))
    await screen.findByText('CurveOne')
    expect(screen.queryByText('RampOne')).toBeNull()
  })

  it('refetches on a filter change and shows nothing from before it', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce([candidate('Unfiltered')])
      .mockResolvedValue([candidate('Filtered')])
    const props = {
      plan: plan(),
      fetchCandidates,
      onAdd: vi.fn(),
      onReject: vi.fn(),
      onClose: vi.fn(),
      onReach: vi.fn(),
      cutCount: 0,
      retiredIds: new Set<string>(),
    }
    const view = render(<Quickbuild {...props} filter="" />)
    await screen.findByText('Unfiltered')
    await act(async () => {
      view.rerender(<Quickbuild {...props} filter="t:artifact" />)
    })
    await screen.findByText('Filtered')
    expect(screen.queryByText('Unfiltered')).toBeNull()
  })

  /*
   * A superseded fetch cannot be cancelled, only recognised on arrival — the
   * `generation` device from `pipeline.ts`. The first gap's slow answer must
   * not overwrite the second gap's fast one.
   */
  it('drops a slow answer that arrives after the gap moved on', async () => {
    let releaseFirst: (v: readonly QuickbuildCandidate[]) => void = () => {}
    const fetchCandidates = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValue([candidate('Second')])
    setup({ fetchCandidates })
    await press(screen.getByRole('button', { name: /Different gap/i }))
    await screen.findByText('Second')
    await act(async () => {
      releaseFirst([candidate('FirstAndStale')])
      await Promise.resolve()
    })
    expect(screen.queryByText('FirstAndStale')).toBeNull()
    expect(screen.getByText('Second')).toBeTruthy()
  })
})

describe('the loading bar appears only for a real wait', () => {
  it('is not shown while a trio is in hand', async () => {
    setup()
    await screen.findByText('Ai')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  /*
   * Below the threshold nothing is drawn, so a fetch that lands quickly never
   * flashes a bar reporting a wait the builder did not have.
   */
  it('stays hidden for a fetch that lands inside the threshold', async () => {
    vi.useFakeTimers()
    try {
      let release: (v: readonly QuickbuildCandidate[]) => void = () => {}
      const fetchCandidates = vi.fn().mockImplementation(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            release = resolve
          }),
      )
      setup({ fetchCandidates })
      await act(async () => {
        vi.advanceTimersByTime(BAR_DELAY - 20)
      })
      expect(screen.queryByRole('progressbar')).toBeNull()
      await act(async () => {
        release([candidate('Ai')])
      })
      expect(screen.queryByRole('progressbar')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  /* A silent wait is worse than a visible one. */
  it('appears once the wait outlasts the threshold', async () => {
    vi.useFakeTimers()
    try {
      const fetchCandidates = vi.fn().mockImplementation(() => new Promise(() => {}))
      setup({ fetchCandidates })
      await act(async () => {
        vi.advanceTimersByTime(BAR_DELAY + 40)
      })
      expect(screen.getByRole('progressbar')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * The four tests below exist because the mutation check found the first
 * versions of the ones above passing for the wrong reasons.
 *
 * "Does not show the old gap's cards under a new gap" passed even with the
 * staleness check deleted, because the SHALLOW fixture triggered a top-up that
 * happened to fetch the new gap's cards and paper over it. "Drops a slow
 * answer" passed with the generation guard deleted, because the staleness check
 * masked it — the late answer carried the old gap's key and was filtered out
 * for a different reason than the one under test.
 *
 * Each of these isolates one mechanism so that removing it, and nothing else,
 * makes the test fail.
 */
describe('the queue is discarded on the instant the question changes', () => {
  /*
   * A DEEP first queue, so no top-up can fire and rescue the assertion, and a
   * SUSPENDED second fetch, so the only thing that can be on screen between the
   * gap changing and the new answer landing is the old gap's cards.
   *
   * That window is the whole bug: a stale trio under a live heading.
   */
  it('empties immediately when the gap changes, before any new answer lands', async () => {
    let releaseSecond: (v: readonly QuickbuildCandidate[]) => void = () => {}
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => candidate(`Ramp${i}`)))
      .mockImplementation(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            releaseSecond = resolve
          }),
      )
    setup({ fetchCandidates })
    await screen.findByText('Ramp0')

    await press(screen.getByRole('button', { name: /Different gap/i }))
    // The new gap's answer has NOT arrived. Nothing from the old gap may show.
    expect(screen.queryByText('Ramp0')).toBeNull()
    expect(screen.queryByText('Ramp1')).toBeNull()

    await act(async () => {
      releaseSecond([candidate('Curve0')])
    })
    await screen.findByText('Curve0')
  })

  /* The same, for a filter change: a deep queue and a suspended refetch. */
  it('empties immediately when the filter changes', async () => {
    let releaseSecond: (v: readonly QuickbuildCandidate[]) => void = () => {}
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => candidate(`Plain${i}`)))
      .mockImplementation(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            releaseSecond = resolve
          }),
      )
    const props = {
      plan: plan(),
      fetchCandidates,
      onAdd: vi.fn(),
      onReject: vi.fn(),
      onClose: vi.fn(),
      onReach: vi.fn(),
      cutCount: 0,
      retiredIds: new Set<string>(),
    }
    const view = render(<Quickbuild {...props} filter="" />)
    await screen.findByText('Plain0')
    await act(async () => {
      view.rerender(<Quickbuild {...props} filter="t:artifact" />)
    })
    expect(screen.queryByText('Plain0')).toBeNull()
    await act(async () => {
      releaseSecond([candidate('Narrowed')])
    })
    await screen.findByText('Narrowed')
  })

  /*
   * The generation guard on its own, with the staleness check unable to help.
   *
   * The filter goes '' → 't:artifact' → '', so by the time the FIRST fetch's
   * slow answer arrives it carries a gap key and a filter that both match the
   * current question exactly. Nothing but the generation counter can tell that
   * it is three questions out of date. Without it, that answer is applied and
   * the panel shows a list assembled before two intervening changes.
   */
  it('drops an answer whose question was asked and re-asked', async () => {
    let releaseFirst: (v: readonly QuickbuildCandidate[]) => void = () => {}
    let releaseThird: (v: readonly QuickbuildCandidate[]) => void = () => {}
    const fetchCandidates = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => candidate(`Narrow${i}`)))
      .mockImplementationOnce(
        () =>
          new Promise<readonly QuickbuildCandidate[]>((resolve) => {
            releaseThird = resolve
          }),
      )
    const props = {
      plan: plan(),
      fetchCandidates,
      onAdd: vi.fn(),
      onReject: vi.fn(),
      onClose: vi.fn(),
      onReach: vi.fn(),
      cutCount: 0,
      retiredIds: new Set<string>(),
    }
    const view = render(<Quickbuild {...props} filter="" />)
    await act(async () => {
      view.rerender(<Quickbuild {...props} filter="t:artifact" />)
    })
    await screen.findByText('Narrow0')
    await act(async () => {
      view.rerender(<Quickbuild {...props} filter="" />)
    })

    // The very first fetch finally answers. Its gap and its filter both match
    // what is on screen now, so only the generation can rule it out.
    // DEEP, so that if it were wrongly applied nothing would immediately
    // replace it: a shallow answer owes a top-up, and that top-up would
    // overwrite the very thing this test is looking for. The mutation check
    // found exactly that hiding the missing guard.
    await act(async () => {
      releaseFirst([
        candidate('ThreeQuestionsAgo'),
        ...Array.from({ length: 29 }, (_, i) => candidate(`Old${i}`)),
      ])
    })
    expect(screen.queryByText('ThreeQuestionsAgo')).toBeNull()

    // And the answer that IS current is still accepted.
    // Deep, so the queue owes no top-up: a fourth call would be answered by
    // the mock's fallback and would quietly replace what is being asserted.
    await act(async () => {
      releaseThird([
        candidate('Current'),
        ...Array.from({ length: 29 }, (_, i) => candidate(`Rest${i}`)),
      ])
    })
    await screen.findByText('Current')
  })
})

describe('a background top-up never disturbs what is on screen', () => {
  /*
   * A top-up that fails is not the builder's problem: there are three cards in
   * front of them and nothing about their situation has changed. Reporting it
   * would turn a successful panel into an error panel over work they did not
   * ask for and cannot see.
   */
  it('stays silent when the top-up fails, keeping the trio', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(['Ai', 'Bo', 'Cy', 'Di'].map((n) => candidate(n)))
      .mockRejectedValue(new Error('top-up failed'))
    setup({ fetchCandidates })
    await screen.findByText('Ai')
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    // The failure is swallowed: the cards stay and no error is claimed.
    expect(screen.getByText('Ai')).toBeTruthy()
    expect(screen.queryByText(/Could not load candidates/i)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

/*
 * The report, in full: "quickbuild ended while I was below curve on ramp and
 * spot removal, and also only at 58 of 100 cards."
 *
 * Two separate defects, and the first is the serious one — the panel really did
 * stop with gaps still on the plan. Both are cursors that walked off the end of
 * a list that got shorter underneath them, and neither needed the deck to be in
 * any unusual state: the plan is recomputed on every accept and gaps close as
 * the deck fills, so both lists shorten constantly.
 */
describe('a cursor must not walk off a plan that shrinks underneath it', () => {
  const rerenderWith = (
    view: ReturnType<typeof render>,
    props: Parameters<typeof Quickbuild>[0],
    next: QuickbuildPlan,
  ) =>
    act(async () => {
      view.rerender(<Quickbuild {...props} plan={next} />)
    })

  const props = (over: Partial<Parameters<typeof Quickbuild>[0]> = {}) => ({
    plan: plan(),
    filter: '',
    fetchCandidates: vi.fn().mockResolvedValue([candidate('Ai'), candidate('Bo'), candidate('Cy')]),
    onAdd: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
    onReach: vi.fn(),
    cutCount: 0,
    retiredIds: new Set<string>(),
    ...over,
  })

  /*
   * THE FIRST DEFECT. `gapAt` was an index into `plan.gaps` and "Different gap"
   * advanced it with a modulo taken against the length at the time of the
   * click. Two clicks on a three-gap plan left it at 2; the plan then shrank to
   * one gap as cards went in, and `plan.gaps[2]` is `undefined` — which the
   * panel rendered as "Every composition and curve goal is inside its band.
   * Nothing to fill." That is the report's "ended while gaps remained", and the
   * gaps it was hiding were the two the builder said were short.
   */
  it('keeps working the plan when it shrinks under a cursor that has moved on', async () => {
    const base = props({ plan: plan({ gaps: [rampGap, removalGap, curveGap] }) })
    const view = render(<Quickbuild {...base} />)
    await screen.findByText('Ai')
    await press(screen.getByRole('button', { name: /Different gap/i }))
    await press(screen.getByRole('button', { name: /Different gap/i }))
    // One gap left, and the cursor is past where it used to be able to point.
    await rerenderWith(view, base, plan({ gaps: [removalGap] }))
    expect(screen.queryByRole('group', { name: /no gaps left/i })).toBeNull()
    expect(screen.getByRole('heading', { name: '3 more spot removal' })).toBeTruthy()
  })

  /*
   * The gap the builder chose stays chosen while it is open, even as the plan
   * around it is recomputed and reordered on every accept.
   *
   * A wrapping index passes the test above and fails this one: it cannot go out
   * of range, but `at % length` points somewhere arbitrary the moment the
   * length changes. Measured in the browser — "Different gap" onto tutor, two
   * gaps then closed, and the panel was working a gap nobody had asked for.
   * That is the reshuffling D3 says must not happen.
   */
  it('keeps the gap the builder chose while it is still open', async () => {
    const base = props({ plan: plan({ gaps: [rampGap, removalGap, curveGap] }) })
    const view = render(<Quickbuild {...base} />)
    await screen.findByText('Ai')
    await press(screen.getByRole('button', { name: /Different gap/i }))
    expect(screen.getByRole('heading', { name: '3 more spot removal' })).toBeTruthy()
    // Ramp closes; spot removal is now second of two rather than second of three.
    await rerenderWith(view, base, plan({ gaps: [curveGap, removalGap] }))
    expect(screen.getByRole('heading', { name: '3 more spot removal' })).toBeTruthy()
  })

  it('falls back to the leading gap once the chosen one closes', async () => {
    const base = props({ plan: plan({ gaps: [rampGap, removalGap, curveGap] }) })
    const view = render(<Quickbuild {...base} />)
    await screen.findByText('Ai')
    await press(screen.getByRole('button', { name: /Different gap/i }))
    expect(screen.getByRole('heading', { name: '3 more spot removal' })).toBeTruthy()
    await rerenderWith(view, base, plan({ gaps: [rampGap, curveGap] }))
    expect(screen.getByRole('heading', { name: '4 more ramp' })).toBeTruthy()
  })

  /*
   * THE SECOND DEFECT. `passed` — the skip cursor — was a bare number with no
   * memory of which gap it belonged to. Skipping twice on one gap and then
   * having that gap close left a cursor of six pointing into the next gap's
   * fresh page, so the panel sliced past everything it had just fetched and
   * reported "No more candidates for this gap" about a gap it had never shown a
   * single card for. Ramp and spot removal, never offered.
   */
  it('starts a new gap from the top, however far the last one was skipped', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce([candidate('R1'), candidate('R2'), candidate('R3')])
      .mockResolvedValue([candidate('S1'), candidate('S2'), candidate('S3')])
    const base = props({ fetchCandidates, plan: plan({ gaps: [rampGap, curveGap] }) })
    const view = render(<Quickbuild {...base} />)
    await screen.findByText('R1')
    await press(screen.getByRole('button', { name: /Skip these three/i }))
    // The ramp gap closes; spot removal takes its place at index 0.
    await rerenderWith(view, base, plan({ gaps: [removalGap, curveGap] }))
    await screen.findByText('S1')
    expect(screen.queryByText(/No more candidates/i)).toBeNull()
    expect(options()).toHaveLength(OPTIONS_SHOWN)
  })

  /*
   * And the skip cursor still does its own job — this is the guard that the fix
   * above did not simply delete skipping. Six candidates, one skip, the second
   * three.
   */
  it('still passes over a whole trio within one gap', async () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => candidate(n))
    setup({ plan: plan({ gaps: [rampGap] }) }, six)
    await screen.findByText('A')
    await press(screen.getByRole('button', { name: /Skip these three/i }))
    await screen.findByText('D')
    expect(screen.queryByText('A')).toBeNull()
  })
})

/*
 * "Once all your curves are satisfied, it should ask you if you'd like to
 * continue quickbuilding, or go back to the suggestion list now that your deck
 * allotments are met and you just need to pick X more cards."
 *
 * The old ending was one sentence with nothing on it — "Nothing to fill." — and
 * it read as completion to a builder 42 cards short of a legal deck. The panel
 * states the arithmetic and offers both doors now, and closes on neither by
 * itself.
 */
describe('the ending is a question, not a full stop', () => {
  const met = (over: Partial<QuickbuildPlan> = {}) =>
    setup({ plan: plan({ gaps: [], beyond: [rampGap, removalGap], ...over }) })

  it('says how many cards are still to pick', async () => {
    met()
    expect(ending().textContent).toContain('58 of 100')
    expect(ending().textContent).toContain('42 more cards to pick')
  })

  /*
   * The part the ordering cannot answer. `wincon` and `synergy` are roles that
   * no archetype gives an ideal, so bombs and win conditions are never gaps and
   * Quickbuild can never lead anyone to one. Saying so is the whole mitigation
   * — a wizard that goes quiet about its own limit looks broken instead.
   */
  it('names the slots it has no opinion about at all', () => {
    met()
    expect(ending().textContent).toContain('25 slots with no target at all')
    expect(ending().textContent).toContain('threats and win conditions')
  })

  it('offers both doors', () => {
    met()
    expect(within(ending()).getByRole('button', { name: /Keep quickbuilding/i })).toBeTruthy()
    expect(
      within(ending()).getByRole('button', { name: /Back to the suggestion list/i }),
    ).toBeTruthy()
  })

  it('does not close itself', () => {
    const { onClose } = met()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reaches for the ideals when the builder says to', async () => {
    const { onReach } = met()
    await press(screen.getByRole('button', { name: /Keep quickbuilding/i }))
    expect(onReach).toHaveBeenCalledWith('ideal')
  })

  it('goes back to the suggestion list when the builder says to', async () => {
    const { onClose } = met()
    await press(screen.getByRole('button', { name: /Back to the suggestion list/i }))
    expect(onClose).toHaveBeenCalled()
  })

  /*
   * `beyond` is the plan's own answer to "would continuing find anything", so
   * the offer cannot appear over an empty loop. Without this the button would
   * be a door onto the same ending.
   */
  it('does not offer to keep going when there is nothing past the current reach', () => {
    setup({ plan: plan({ gaps: [], beyond: [], reach: 'ideal' }) })
    expect(screen.queryByRole('button', { name: /Keep quickbuilding/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Back to the suggestion list/i })).toBeTruthy()
    expect(ending().textContent).toMatch(/at its ideal/)
  })

  it('says the deck is whole when it is', () => {
    setup({ plan: plan({ gaps: [], beyond: [], held: 100, unallocated: 0 }) })
    expect(ending().textContent).toMatch(/holds 100 of 100/)
  })

  /*
   * An over-full deck reads back as exactly `DECK_SIZE` through `unallocated`,
   * which floors at zero — so the count is carried on the plan instead. Telling
   * someone holding 110 cards that they hold all 100 is a worse failure than
   * the silence this ending replaced.
   */
  it('does not tell an over-full deck that it holds a hundred cards', () => {
    setup({ plan: plan({ gaps: [], beyond: [], held: 110, unallocated: 0 }) })
    expect(ending().textContent).toMatch(/holds 110 of 100/)
  })

  /*
   * §19.5: every recompute is announced. The ending is the one moment the panel
   * stops asking questions, and a screen-reader user who hears nothing there
   * cannot learn that there is a choice waiting.
   */
  it('announces the ending to the live region', () => {
    met()
    expect(screen.getByRole('status').textContent).toContain('42 more cards to pick')
  })

  /* R4: both doors are ordinary buttons, so both are reachable by Tab. */
  it('keeps both doors keyboard-reachable', () => {
    met()
    const panel = screen.getByRole('dialog')
    const focusable = [...panel.querySelectorAll('button')].map((b) => b.textContent)
    expect(focusable.some((t) => /Keep quickbuilding/.test(t ?? ''))).toBe(true)
    expect(focusable.some((t) => /Back to the suggestion list/.test(t ?? ''))).toBe(true)
  })
})

/*
 * The third defect behind "Quickbuild ended while gaps remained", and the one
 * found by driving a real deck rather than by reading.
 *
 * The queue treated `deep` as "there is nothing further to top up". That is
 * true of the server's answer and false of the deck: a builder working one
 * large gap consumes all twenty-four held candidates, and the panel then said
 * "Nothing in your colours fills this gap" about a gap with thousands of cards
 * left. Observed in the browser at 96 of 100 on an eight-card land gap, with
 * `POST /recommendations` returning eight more for the same query at the same
 * moment.
 */
describe('a queue the builder has drained is refilled, not declared empty', () => {
  const twentyFour = Array.from({ length: 24 }, (_, i) => candidate(`A${i}`))
  const four = twentyFour.slice(0, 4)

  /*
   * A short first page forces the DEEP fetch, which is what sets `deep` and so
   * what used to close the queue for good. Starting from a full first page
   * would leave `deep` false and the ordinary deepening would refill it, which
   * would make these tests pass against the defect they exist to pin.
   */

  const drain = (fetchCandidates: Parameters<typeof Quickbuild>[0]['fetchCandidates']) => {
    const props = {
      plan: plan({ gaps: [rampGap] }),
      filter: '',
      fetchCandidates,
      onAdd: vi.fn(),
      onReject: vi.fn(),
      onClose: vi.fn(),
      onReach: vi.fn(),
      cutCount: 0,
    }
    const view = render(<Quickbuild {...props} retiredIds={new Set<string>()} />)
    const retire = async (ids: readonly string[]): Promise<void> => {
      await act(async () => {
        view.rerender(<Quickbuild {...props} retiredIds={new Set(ids)} />)
      })
    }
    return { retire }
  }

  it('asks again once every held candidate has been taken', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(four)
      .mockResolvedValueOnce(twentyFour)
      .mockResolvedValue([candidate('B0'), candidate('B1'), candidate('B2')])
    const { retire } = drain(fetchCandidates)
    await screen.findByText('A0')
    // The deep page lands, so nothing further would ever have been asked for.
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    await retire(twentyFour.map((c) => c.oracleId))
    await screen.findByText('B0')
    expect(screen.queryByText(/Nothing in your colours/i)).toBeNull()
    expect(options()).toHaveLength(OPTIONS_SHOWN)
  })

  /*
   * And it does NOT ask again while the deck has not moved, which is what stops
   * the refill being a request loop. `recommend` never offers a card the deck
   * already holds, so its answer for one gap changes exactly when the deck
   * does; asking twice about the same deck returns the same list twice.
   */
  it('does not ask again when the deck has not changed since the fetch', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue([candidate('Only')])
    render(
      <Quickbuild
        plan={plan({ gaps: [rampGap] })}
        filter=""
        fetchCandidates={fetchCandidates}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onClose={vi.fn()}
        onReach={vi.fn()}
        cutCount={0}
        retiredIds={new Set<string>()}
      />,
    )
    await screen.findByText('Only')
    // One first page, one deepening, and then nothing: a single candidate is
    // below a trio, but the deck has not moved so there is nothing new to get.
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(fetchCandidates.mock.calls.length).toBe(2)
  })

  /*
   * The gap really being empty still says so. The refill must not turn an
   * honest "nothing fills this" into a silent blank panel.
   */
  it('still says the gap is empty when the refill comes back with nothing', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(four)
      .mockResolvedValueOnce(twentyFour)
      .mockResolvedValue([])
    const { retire } = drain(fetchCandidates)
    await screen.findByText('A0')
    await waitFor(() => expect(fetchCandidates.mock.calls.length).toBe(2))
    await retire(twentyFour.map((c) => c.oracleId))
    await screen.findByText(/Nothing in your colours fills this gap/i)
  })
})

/**
 * The opening phase, in the panel (ADR-0044).
 *
 * The domain decides WHICH gaps exist and in what order; these pin what the
 * panel does once it has a `staples` gap — which group it asks for, what it
 * puts in the heading, and that it stops claiming the build order is what put
 * the card there.
 */
describe('the staples phase opens the loop', () => {
  const stapleGap: QuickbuildGap = {
    kind: 'staples',
    key: 'staple',
    label: 'staples',
    short: 11,
  }
  const stapleLandGap: QuickbuildGap = {
    kind: 'staples',
    key: 'staple-land',
    label: 'staple lands',
    short: 5,
  }
  const staplesPlan = (over: Partial<QuickbuildPlan> = {}) =>
    plan({ gaps: [stapleGap, stapleLandGap, rampGap], ordering: 'build-order', ...over })

  it('asks for the staples group and adds no query clause of its own', async () => {
    /*
     * The group key IS the filter. `recommend` has already applied the curated
     * list, the colour identity, the accepted set, the exclusions, the budget
     * cap and the bracket allowance; there is no query that could express "is
     * on the curated list", and a weaker second copy of that decision is what
     * ADR-0031 is about.
     */
    const { fetchCandidates } = setup({ plan: staplesPlan() })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('', ['staple'], 8)
  })

  it('asks for the lands group once the spells phase has closed', async () => {
    const { fetchCandidates } = setup({ plan: staplesPlan({ gaps: [stapleLandGap, rampGap] }) })
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled())
    expect(fetchCandidates).toHaveBeenCalledWith('', ['staple-land'], 8)
  })

  it('carries the builder’s own filter alone, with no trailing clause glued on', () => {
    // `t:artifact ` with a trailing space is a different query string, and the
    // panel prints the filter back to the builder verbatim (Q3).
    expect(combinedQuery('t:artifact', stapleGap)).toBe('t:artifact')
    expect(combinedQuery('', stapleGap)).toBe('')
  })

  it('says what is on offer rather than what the deck is short of', async () => {
    // There is no target behind this number. "11 more staples" would assert the
    // deck is eleven staples short of something the product never measured.
    //
    // Eleven candidates, matching the gap's `short`, so this reads the PHRASING
    // and not the arithmetic — which the tests below own.
    setup(
      { plan: staplesPlan() },
      ['Ai', 'Bo', 'Cy', 'Di', 'Ed', 'Fi', 'Gu', 'Ha', 'Iv', 'Jo', 'Ky'].map((n) =>
        candidate(n, 'Staples'),
      ),
    )
    await screen.findByRole('heading', { name: /11 staples you don’t have yet/i })
  })

  /**
   * The heading and the body have to be two readings of ONE list.
   *
   * `gap.short` is the `staple` group's `total` from the last FEED recompute
   * (App.tsx's `quickbuild` memo). The trio underneath comes from a separate,
   * later request the panel makes for the same group, and is then filtered
   * again by the optimistic deck. Two definitions of "a staple you don't have",
   * one in the heading and one an inch below it, and they drift the moment the
   * builder adds anything.
   *
   * The panel's own list is the authoritative one: it is what is actually on
   * offer HERE, it already has every accept and rejection applied, and it is
   * the list the body draws. `short` is kept only until the first response
   * lands, because before that the panel has nothing of its own to count.
   */
  it('counts the staples it is actually offering, not the feed’s stale total', async () => {
    setup({ plan: staplesPlan() }, [
      candidate('Ai', 'Staples'),
      candidate('Bo', 'Staples'),
      candidate('Cy', 'Staples'),
    ])
    // `short` says 11; the group came back with three.
    await screen.findByRole('heading', { name: /3 staples you don’t have yet/i })
  })

  it('falls to zero as the builder takes them, rather than standing at 11', async () => {
    const retired = new Set<string>()
    const { rerender } = setup({ plan: staplesPlan() }, [
      candidate('Ai', 'Staples'),
      candidate('Bo', 'Staples'),
      candidate('Cy', 'Staples'),
    ])
    await screen.findByRole('heading', { name: /3 staples you don’t have yet/i })

    retired.add('Ai')
    await act(async () => {
      rerender(
        <Quickbuild
          plan={staplesPlan()}
          filter=""
          fetchCandidates={vi
            .fn()
            .mockResolvedValue([
              candidate('Ai', 'Staples'),
              candidate('Bo', 'Staples'),
              candidate('Cy', 'Staples'),
            ])}
          onAdd={vi.fn()}
          onReject={vi.fn()}
          onClose={vi.fn()}
          onReach={vi.fn()}
          cutCount={0}
          retiredIds={retired}
        />,
      )
    })
    await screen.findByRole('heading', { name: /2 staples you don’t have yet/i })
  })

  it('does not blame the colours for a list the builder emptied themselves', async () => {
    /*
     * The playtest's exact line: "5 staple lands you don't have yet" over
     * "Nothing in your colours fills this gap" — after all five had been added.
     * The colours had nothing to do with it. `exhausted` required the builder
     * to have SKIPPED, so a builder who only ever pressed Add fell through to
     * the sentence about their colour identity.
     */
    setup({ plan: staplesPlan(), retiredIds: new Set(['Ai', 'Bo', 'Cy']) }, [
      candidate('Ai', 'Staples'),
      candidate('Bo', 'Staples'),
      candidate('Cy', 'Staples'),
    ])
    await screen.findByText(/No more candidates for this gap/i)
    expect(screen.queryByText(/Nothing in your colours fills this gap/i)).toBeNull()
  })

  it('still blames the colours when the group came back empty in the first place', async () => {
    // The distinction has to survive: a gap the server has no answer for is a
    // different fact from a gap the builder has worked through.
    setup({ plan: staplesPlan() }, [])
    await screen.findByText(/Nothing in your colours fills this gap/i)
  })

  it('names the curated list as an opinion, and drops the build-order sentence', async () => {
    setup({ plan: staplesPlan() })
    await screen.findByText(/Our opinion, not a statistic/i)
    expect(screen.queryByText(/Working your archetype’s build order/i)).toBeNull()
  })

  it('hands the sentence back to the derived order once the staples are spent', async () => {
    // The phase ends by its gaps leaving the plan, so the panel needs no
    // terminal state of its own: it renders the next gap, and the ordering rule
    // underneath is the true sentence again.
    setup({ plan: plan({ gaps: [rampGap], ordering: 'build-order' }) })
    await screen.findByText(/Working your archetype’s build order/i)
    expect(screen.queryByText(/Our opinion, not a statistic/i)).toBeNull()
  })
})

/**
 * Defect 2 — the card panel contradicting itself one inch apart.
 *
 * Every card in the panel said "completes 1 combo" under WHY THIS IS HERE and
 * "Not part of any combo we know about" under COMBOS, because `Detail` was
 * rendered with no `combos` prop and defaulted it to `[]`. Seen on true
 * near-combo cards — Vandalblast among them — where the denial was flatly
 * wrong rather than merely unsupported.
 */
describe('the card panel does not deny what its own reasons claim', () => {
  const comboReason = (name: string): QuickbuildCandidate => ({
    oracleId: name,
    view: { ...view(name), reasons: ['one card from 1 combo'] },
    groupLabel: 'Staples',
  })

  it('never asserts a card is in no combo when it was never asked', async () => {
    setup({}, [comboReason('Vandalblast')])
    await screen.findByText('one card from 1 combo')
    expect(screen.queryByText(/Not part of any combo we know about/i)).toBeNull()
  })
})
