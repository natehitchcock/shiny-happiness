// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { SINGLE_COLUMN, Workspace } from './App'

/**
 * The complaint this pins: on a viewport narrow enough that `.workspace`
 * collapses to one column, the analysis region — and the preview inside it —
 * sits below the whole deck and the whole suggestion feed. Tapping a card
 * rendered its details several screens down, so reading them meant scrolling to
 * the bottom of the page and then scrolling back.
 *
 * The fix makes the same element a bottom sheet at that breakpoint. These tests
 * are about the half a stylesheet cannot express: that the panel announces
 * itself as a dialog, takes focus when it opens, closes on Escape, hands focus
 * back, and does none of that on a wide screen.
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

/** jsdom has no ResizeObserver and the column legend measures with one. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

/*
 * jsdom has no `matchMedia` at all — `vitest.setup.ts` installs a stub that
 * always answers "wide", which is what every other component test wants. This
 * file replaces it with one it can steer, because the whole behaviour under
 * test is conditional on the answer.
 *
 * `setNarrow` fires the registered listeners the way a browser does on a rotate
 * or a dragged window edge, which is the only way to reach the code that
 * crosses the breakpoint with a preview already open.
 */
let narrow = false
const listeners = new Set<() => void>()

const installMatchMedia = (): void => {
  window.matchMedia = ((query: string) => ({
    get matches(): boolean {
      return query === SINGLE_COLUMN && narrow
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** Cross the breakpoint the way a rotate does: change the answer, then notify. */
const setNarrow = async (value: boolean): Promise<void> => {
  narrow = value
  await act(async () => {
    for (const listener of [...listeners]) listener()
  })
}

const deck: api.Deck = {
  id: 'd1',
  name: 'Test deck',
  description: '',
  commanders: ['c1'],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
}

const card = (oracleId: string, name: string): api.Card => ({
  oracleId,
  name,
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: 'Haste.',
  power: '2',
  toughness: '2',
  loyalty: null,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const recs: api.Recommendations = {
  datasetSnapshotId: null,
  groups: [
    {
      key: 'g1',
      label: 'Completes 2 combos',
      rationale: 'because',
      total: 2,
      items: [
        { oracleId: 'o1', comboDegree: 2, nearCombosAt1: 0, score: 2, reasons: ['a'] },
        { oracleId: 'o2', comboDegree: 1, nearCombosAt1: 0, score: 1, reasons: ['b'] },
      ],
    } as unknown as api.Group,
  ],
  columns: [],
  unavailable: [],
  query: { matched: 2, errors: [] },
} as unknown as api.Recommendations

beforeEach(() => {
  vi.resetAllMocks()
  narrow = false
  listeners.clear()
  installMatchMedia()
  mocked.getRecommendations.mockResolvedValue(recs)
  mocked.getAnalysis.mockResolvedValue({
    counts: { total: 2, byRole: {} },
    targets: [],
    cuts: [],
    deficits: [],
    archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
    curve: {
      averageManaValue: 3,
      histogram: [0, 0, 0, 0, 0, 0, 0, 0],
      target: [],
      locked: [0, 0, 0, 0, 0, 0, 0, 0],
      deltas: [],
    },
    legality: { legal: true, problems: [] },
    deckCombos: [],
    prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
    unavailable: [],
  } satisfies api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map<string, api.Card>([
      ['o1', card('o1', 'Krenko, Mob Boss')],
      ['o2', card('o2', 'Goblin Bushwhacker')],
    ]),
    prices: new Map([
      ['o1', 1.5],
      ['o2', 0.25],
    ]),
    images: new Map(),
  } satisfies api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  // The detail request is fire-and-forget in `open`; an unresolved promise here
  // would leave React warning about state set after the test ended.
  mocked.getCardDetail.mockImplementation((oracleId: string) =>
    Promise.resolve({
      ...card(oracleId, oracleId === 'o1' ? 'Krenko, Mob Boss' : 'Goblin Bushwhacker'),
      printings: [],
      combos: [],
    }),
  )
})

afterEach(cleanup)

const mount = async (): Promise<void> => {
  render(<Workspace deck={deck} />)
  await waitFor(() => expect(mocked.getRecommendations).toHaveBeenCalled())
  await screen.findByLabelText('Preview Krenko, Mob Boss')
}

const tapPreview = async (name: string): Promise<HTMLElement> => {
  const button = screen.getByLabelText(`Preview ${name}`)
  await act(async () => {
    button.focus()
    button.click()
  })
  return button
}

describe('the preview on a single-column viewport', () => {
  it('opens as a dialog and takes focus, so it is on screen rather than a scroll away', async () => {
    await setNarrow(true)
    await mount()
    await tapPreview('Krenko, Mob Boss')

    const panel = await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })
    expect(panel.className).toContain('preview-sheet')
    // The point of the whole change: the panel, not the row behind it, is where
    // the user now is.
    expect(document.activeElement).toBe(panel)
  })

  it('closes on Escape and gives focus back to the card that opened it', async () => {
    await setNarrow(true)
    await mount()
    const opener = await tapPreview('Krenko, Mob Boss')
    await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // A sheet that dumps focus on <body> makes the next Tab start again from
    // the masthead, which on a long feed is worse than the scroll it replaced.
    expect(document.activeElement).toBe(opener)
  })

  it('gives focus back when the Close button is used, not only on Escape', async () => {
    await setNarrow(true)
    await mount()
    const opener = await tapPreview('Krenko, Mob Boss')
    await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })

    await act(async () => {
      screen.getByLabelText('Close preview').click()
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('swaps to the second card when one is tapped while the sheet is open', async () => {
    await setNarrow(true)
    await mount()
    await tapPreview('Krenko, Mob Boss')
    await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })

    // The feed above the sheet stays live, so this is a real gesture and not a
    // hypothetical one — and the answer must be one sheet showing the new card,
    // never two panels or a stale one.
    await tapPreview('Goblin Bushwhacker')

    const panel = await screen.findByRole('dialog', { name: 'Goblin Bushwhacker details' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.activeElement).toBe(panel)
  })
})

describe('the preview on a wide viewport', () => {
  it('stays an ordinary rail panel and never steals focus', async () => {
    await mount()
    const opener = await tapPreview('Krenko, Mob Boss')

    await screen.findByLabelText('Krenko, Mob Boss details')
    // Wide behaviour is unchanged: no dialog semantics, and the user is still
    // on the row they clicked, free to keep walking the list.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape and hands focus back to the row that opened it', async () => {
    /*
     * This used to assert the opposite, and the opposite was right at the time:
     * the panel was a block at the TOP OF THE RAIL, it covered nothing, and
     * there was nothing for Escape to dismiss — so the key was left for whatever
     * else might be open.
     *
     * The panel is now anchored to the rail's left edge and overlays the
     * suggestion feed. A thing that covers your work has to have a keyboard way
     * out, and Escape is the key everybody already presses; the Close button is
     * a tab away from wherever the user actually is.
     *
     * Focus goes back to the opener, which is `previewOpener`'s whole job and
     * the reason Escape does not strand a keyboard user at `<body>`.
     */
    await mount()
    const opener = await tapPreview('Krenko, Mob Boss')
    await screen.findByLabelText('Krenko, Mob Boss details')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(screen.queryByLabelText('Krenko, Mob Boss details')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('overlays the feed rather than sitting inside the rail scroller', async () => {
    // The defect: as the first block in `.analysis-scroll`, opening a card
    // pushed Composition, the bracket check and the combo list off the screen —
    // the dashboard you watch while deciding vanished at the moment of the
    // decision. A sibling of the scroller costs it nothing.
    await mount()
    await tapPreview('Krenko, Mob Boss')
    const panel = await screen.findByLabelText('Krenko, Mob Boss details')

    expect(panel.closest('.analysis-scroll')).toBeNull()
    expect(panel.parentElement?.classList.contains('analysis')).toBe(true)
  })
})

describe('crossing the breakpoint with a card open', () => {
  it('turns the same element into a sheet and back, without remounting it', async () => {
    await mount()
    await tapPreview('Krenko, Mob Boss')
    const wide = await screen.findByLabelText('Krenko, Mob Boss details')

    await setNarrow(true)
    const asSheet = await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })
    // Node identity, deliberately. A second copy rendered into a portal, or a
    // panel moved in the DOM, would pass every other assertion here while
    // throwing away the in-flight detail request and reordering the page for a
    // screen reader.
    expect(asSheet).toBe(wide)

    await setNarrow(false)
    const back = await screen.findByLabelText('Krenko, Mob Boss details')
    expect(back).toBe(wide)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not move focus on a rotate, only on a tap', async () => {
    await mount()
    const opener = await tapPreview('Krenko, Mob Boss')
    await screen.findByLabelText('Krenko, Mob Boss details')

    await setNarrow(true)

    // Turning a phone sideways is not a request to be taken somewhere else.
    expect(document.activeElement).toBe(opener)
  })
})

/*
 * The grid reserves a fourth column for the panel on a wide screen, and a grid
 * is a PARENT of the panel — CSS has no way to ask whether a descendant is
 * rendered. So the workspace has to say it out loud.
 *
 * What the attribute means is the whole risk. It must track the panel and not
 * the click: one that ran ahead of the panel would open an empty 21rem column
 * and hold it open while a request was in flight, and one that lagged would
 * leave the panel overlaying a feed that had already made room for it.
 */
describe('the workspace tells the grid when a detail is open', () => {
  const workspace = (): HTMLElement => document.querySelector('.workspace') as HTMLElement
  const panel = (): HTMLElement | null => document.querySelector('.preview')
  /** The invariant, checked at every step rather than only at the ends. */
  const inStep = (): void => {
    expect(workspace().dataset['detail']).toBe(panel() === null ? 'closed' : 'open')
  }

  it('says closed with nothing selected, open with a card, and closed again', async () => {
    await mount()
    expect(workspace().dataset['detail']).toBe('closed')
    inStep()

    await tapPreview('Krenko, Mob Boss')
    await screen.findByLabelText('Krenko, Mob Boss details')
    expect(workspace().dataset['detail']).toBe('open')
    inStep()

    await act(async () => {
      screen.getByLabelText('Close preview').click()
    })
    await waitFor(() => expect(screen.queryByLabelText('Krenko, Mob Boss details')).toBeNull())
    expect(workspace().dataset['detail']).toBe('closed')
    inStep()
  })

  it('stays in step across the single-column breakpoint', async () => {
    /*
     * The attribute is inert below the breakpoint — the four-column rules are
     * in a `min-width` block the sheet's viewport cannot match — but it must not
     * LIE. A value left stale by a rotate would reserve a column the moment the
     * window was widened again, with or without a panel to put in it.
     */
    await setNarrow(true)
    await mount()
    await tapPreview('Krenko, Mob Boss')
    await screen.findByRole('dialog', { name: 'Krenko, Mob Boss details' })
    inStep()

    await setNarrow(false)
    inStep()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => expect(screen.queryByLabelText('Krenko, Mob Boss details')).toBeNull())
    inStep()
  })

  it('waits for the panel rather than opening a column on the click', async () => {
    /*
     * The one route where the click and the panel are not the same moment.
     *
     * `open` sets `inspect` and only then asks for the detail. For a card in the
     * deck or the feed that gap is invisible — the hydration maps already hold
     * it and the panel renders in the same commit. A card reached from "Cards
     * named like…" came from `searchCards`, which hydrates nothing, so it has no
     * entry in either map and previews only once `/cards/{id}` lands.
     *
     * Key the grid on `inspect` and this is a 21rem column that opens empty and
     * stays empty for the length of a round trip, on a page where every row to
     * its left has just jumped sideways to make room for nothing.
     */
    const stranger = card('o9', 'Shivan Dragon')
    mocked.searchCards.mockResolvedValue({ items: [stranger] } as unknown as Awaited<
      ReturnType<typeof api.searchCards>
    >)
    let land: (() => void) | null = null
    mocked.getCardDetail.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = () => resolve({ ...stranger, printings: [], combos: [] } as api.CardDetail)
        }),
    )

    await mount()
    const box = screen.getByLabelText('Filter suggestions') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(box, 'Shivan Dragon')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // The name-match list follows the committed query, not the draft.
    await act(async () => screen.getByLabelText(/^Run this filter/).click())

    const opener = await screen.findByLabelText('Preview Shivan Dragon')
    await act(async () => {
      opener.click()
    })

    // Clicked, requested, and nothing to show yet: the grid must not have moved.
    expect(document.querySelector('.preview')).toBeNull()
    expect(workspace().dataset['detail']).toBe('closed')
    inStep()

    await act(async () => {
      land?.()
    })
    await screen.findByLabelText('Shivan Dragon details')
    expect(workspace().dataset['detail']).toBe('open')
    inStep()
  })
})

/*
 * The stylesheet half.
 *
 * `App.tsx` moves focus into the panel whenever `matchMedia(SINGLE_COLUMN)`
 * matches, and `styles.css` is what actually puts the panel on screen. If the
 * two ever named different widths there would be a band of viewports where the
 * panel grabs focus while still sitting at the bottom of a very long page —
 * the original defect, made worse by a focus jump.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8')
  // The sheet's own comments quote selectors and widths; a naive scan would read
  // them as rules.
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** The concatenated bodies of every `@media` block whose condition contains `q`. */
const mediaBodies = (q: string): string => {
  let out = ''
  const opener = /@media([^{]*)\{/g
  for (let m = opener.exec(css); m !== null; m = opener.exec(css)) {
    let depth = 1
    let i = opener.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    if (m[1]!.includes(q)) out += css.slice(opener.lastIndex, i - 1)
  }
  return out
}

/** Everything NOT inside an `@media` block — what a wide screen gets. */
const unconditional = (): string => {
  let out = ''
  let i = 0
  const opener = /@media[^{]*\{/g
  for (let m = opener.exec(css); m !== null; m = opener.exec(css)) {
    out += css.slice(i, m.index)
    let depth = 1
    i = opener.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    opener.lastIndex = i
  }
  return out + css.slice(i)
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

describe('the sheet stylesheet', () => {
  it('pins the panel to the bottom of the viewport at the breakpoint App.tsx watches', () => {
    const narrowRules = mediaBodies(SINGLE_COLUMN)
    expect(narrowRules).toMatch(/\.preview\.preview-sheet\s*\{[^}]*position:\s*fixed/)
    expect(narrowRules).toMatch(/\.preview\.preview-sheet\s*\{[^}]*bottom:\s*0/)
  })

  it('leaves the wide layout alone', () => {
    // A `.preview-sheet` rule that escaped its media query would fix the panel
    // to the bottom of a desktop window, over the rail it is meant to sit in.
    // The `@keyframes` block is unconditional and is not a selector, hence the
    // leading dot.
    expect(unconditional()).not.toMatch(/\.preview-sheet/)
  })

  it('only animates the slide-up where motion is welcome', () => {
    // Declared inside a `no-preference` query rather than declared and then
    // cancelled: a cancelled animation still runs for the frames before the
    // override is applied, which is the motion someone asked not to see.
    expect(count(css, 'animation: preview-sheet-in')).toBe(1)
    expect(count(mediaBodies('no-preference'), 'animation: preview-sheet-in')).toBe(1)
  })
})
