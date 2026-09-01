// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckWeb } from './DeckWeb'
import type { DeckWebCard } from './DeckWeb'
import type * as ModelModule from './model'
import type * as LayoutModule from './layout'

/**
 * The settle animation survives a re-render (doc 17 §17.5).
 *
 * `App` hands this component `order`, `accepted` and `combos` as `.map`,
 * `.filter` and `?? []` results — new arrays holding the same ids on every one
 * of its renders. Keying the model on their IDENTITY meant that anything at all
 * changing in the workspace rebuilt the graph, re-ran the 300-tick simulation
 * and sent the settle animation back to frame 0. Measured in Chrome on the real
 * 99-card aristocrats deck: one unrelated re-render cost 105-158 ms of main
 * thread against 23-47 ms with the graph closed, and eight seconds of them gave
 * 31 restarts, 515 replayed frames instead of 39, and a graph still moving when
 * they stopped.
 *
 * So the fixture below re-renders with FRESH ARRAYS holding IDENTICAL CONTENT,
 * which is exactly what `App` does. A fixture that passed the same array twice
 * cannot see this bug at all — React's own identity check would hide it.
 */

/** Counts, so a test can assert the simulation ran once rather than per render. */
const ran = vi.hoisted(() => ({ model: 0, layout: 0 }))

vi.mock('./model', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelModule>()
  return {
    ...actual,
    buildDeckWeb: (input: Parameters<typeof actual.buildDeckWeb>[0]) => {
      ran.model += 1
      return actual.buildDeckWeb(input)
    },
  }
})

vi.mock('./layout', async (importOriginal) => {
  const actual = await importOriginal<typeof LayoutModule>()
  return {
    ...actual,
    layout: (...args: Parameters<typeof actual.layout>) => {
      ran.layout += 1
      return actual.layout(...args)
    },
  }
})

const card = (over: Partial<DeckWebCard> & { oracleId: string; name: string }): DeckWebCard => ({
  manaCost: '{1}{B}',
  manaValue: 2,
  typeLine: 'Creature — Human',
  oracleText: '',
  colorIdentity: ['B'],
  primaryRole: 'engine',
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

/*
 * Enough cards that the simulation has somewhere to go.
 *
 * Two cards and one edge reach equilibrium in a handful of ticks and the
 * recorded frames barely differ, so a restart would be invisible. Twelve
 * connected cards move for the whole recording.
 */
const CARDS: readonly DeckWebCard[] = [
  card({ oracleId: 'boss', name: 'Teysa Karlov', synergyProduces: ['creature-death'] }),
  ...Array.from({ length: 11 }, (_, i) =>
    card({
      oracleId: `c${String(i)}`,
      name: `Card ${String(i)}`,
      synergyProduces: i % 2 === 0 ? ['creature-death'] : ['lifeloss'],
      synergyWants: i % 3 === 0 ? ['lifeloss'] : ['creature-death'],
    }),
  ),
]

/**
 * One render's worth of props, rebuilt from scratch every call.
 *
 * Every array and every Map is a new object with the same contents — the shape
 * `App` produces, and the whole point of the fixture.
 */
const props = (): Parameters<typeof DeckWeb>[0] => ({
  deckId: 'd1',
  deckName: 'Test deck',
  order: CARDS.map((c) => c.oracleId),
  accepted: CARDS.slice(1).map((c) => c.oracleId),
  commanders: ['boss'],
  cards: new Map(CARDS.map((c) => [c.oracleId, c])),
  combos: [{ comboId: 'k1', pieces: ['c0', 'c1'], produces: ['infinite tokens'] }],
  images: new Map(),
  onLeave: () => undefined,
})

/*
 * `cards` and `images` are the two props `App` does NOT rebuild — they are
 * `useState` maps whose identity changes only when a hydration lands. The
 * component keeps them as plain dependencies for that reason, so the fixture
 * has to hold them steady the way `App` does or it would be testing a promise
 * the component never made.
 */
const STEADY = { cards: props().cards, images: props().images }
const freshProps = (): Parameters<typeof DeckWeb>[0] => ({ ...props(), ...STEADY })

/** The pending animation frame, so a test can step the replay by hand. */
let pending: (() => void) | null = null
/** Every frame the component asked for, across every replay it started. */
let scheduled = 0

const step = (times = 1): void => {
  for (let i = 0; i < times; i += 1) {
    const next = pending
    pending = null
    if (next === null) return
    act(() => next())
  }
}

/** Where every node is, which is the only thing a restart actually changes. */
const placement = (): string =>
  [...document.querySelectorAll('.web-node')]
    .map((n) => n.getAttribute('transform') ?? '')
    .join(' ')

beforeEach(() => {
  ran.model = 0
  ran.layout = 0
  pending = null
  scheduled = 0
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
    scheduled += 1
    pending = () => cb(0)
    return 1
  }) as unknown as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {
    pending = null
  }) as unknown as typeof cancelAnimationFrame)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('a re-render with the same deck', () => {
  it('leaves the settle where it had got to, rather than back at the start', () => {
    const { rerender } = render(<DeckWeb {...freshProps()} />)
    const start = placement()
    step(6)
    const partway = placement()
    // Guard the guard: if the recording did not move, the assertion below would
    // pass for the wrong reason.
    expect(partway).not.toBe(start)

    rerender(<DeckWeb {...freshProps()} />)
    expect(placement()).toBe(partway)
  })

  it('plays the settle once, not once per render', () => {
    const { rerender } = render(<DeckWeb {...freshProps()} />)
    step(4)
    for (let i = 0; i < 5; i += 1) rerender(<DeckWeb {...freshProps()} />)
    step(200) // drain whatever is still scheduled
    // `layout` is asked for 40 frames, so one replay asks the browser for at
    // most 40. Six replays ask for six times that, which is what the browser
    // measurement counted as 515 frames where 39 were wanted.
    expect(scheduled).toBeLessThanOrEqual(40)
  })

  it('does not rebuild the model or re-run the simulation', () => {
    // The expensive half. On the real 99-card deck `buildDeckWeb` is O(n²) over
    // the deck and `layout` runs 300 ticks; together they were re-running on
    // every keystroke in the workspace behind the graph.
    const { rerender } = render(<DeckWeb {...freshProps()} />)
    for (let i = 0; i < 5; i += 1) rerender(<DeckWeb {...freshProps()} />)
    expect(ran.model).toBe(1)
    expect(ran.layout).toBe(1)
  })

  it('still rebuilds when the deck itself changes', () => {
    // The other half of the bargain: content-keyed, not never-keyed. A graph
    // that ignored an added card would be a worse bug than the one being fixed.
    const { rerender } = render(<DeckWeb {...freshProps()} />)
    expect(screen.getAllByRole('button', { name: /^Card 0/ })).toHaveLength(1)
    const shorter = freshProps()
    rerender(<DeckWeb {...shorter} accepted={shorter.accepted.filter((id) => id !== 'c0')} />)
    expect(ran.model).toBe(2)
    expect(ran.layout).toBe(2)
    expect(screen.queryByRole('button', { name: /^Card 0/ })).toBeNull()
  })
})

describe('the canvas the graph is fitted to', () => {
  /**
   * A pane that changes shape after the first paint, which is the normal case.
   *
   * `useCanvas` opens at the placeholder 3:2 aspect and the `ResizeObserver`
   * reports the pane's real proportions a frame later. The layout READ the
   * canvas without depending on it, so it kept fitting the graph to the
   * placeholder: measured in Chrome on the real 99-card deck, 8 of 99 nodes
   * were drawn below the bottom edge of the drawing and a third of its width
   * was left empty.
   */
  const fire: (() => void)[] = []
  let pane = { width: 1000, height: 654 }

  const withPane = (): (() => void) => {
    const realObserver = globalThis.ResizeObserver
    const realRect = HTMLElement.prototype.getBoundingClientRect
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire.push(cb)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
      return this.classList.contains('web-frame')
        ? ({ ...pane, top: 0, left: 0, right: pane.width, bottom: pane.height } as DOMRect)
        : realRect.call(this)
    }
    return () => {
      globalThis.ResizeObserver = realObserver
      HTMLElement.prototype.getBoundingClientRect = realRect
      fire.length = 0
    }
  }

  /**
   * How much of the drawing the graph reaches, per axis, 1 being the edge.
   *
   * `layout` fits symmetrically about the canvas centre with a 48-unit margin,
   * so a graph fitted to the canvas it is DRAWN in touches one of the two
   * limits exactly and stays inside the other. A graph fitted to some other
   * canvas does neither: it overshoots one axis, undershoots the other, and is
   * centred on the wrong point.
   */
  const reach = (): { x: number; y: number } => {
    const box = (document.querySelector('.web-svg')?.getAttribute('viewBox') ?? '').split(' ')
    const width = Number(box[2])
    const height = Number(box[3])
    let halfX = 0
    let halfY = 0
    for (const n of document.querySelectorAll('.web-node')) {
      const at = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(n.getAttribute('transform') ?? '')
      // A node is translated by its top-left corner, so its own box is added
      // back — the fit is about where the CARD sits, not where its corner does.
      const outline = n.querySelector('.web-frame-line')
      if (at === null || outline === null) continue
      halfX = Math.max(
        halfX,
        Math.abs(Number(at[1]) + Number(outline.getAttribute('width')) / 2 - width / 2),
      )
      halfY = Math.max(
        halfY,
        Math.abs(Number(at[2]) + Number(outline.getAttribute('height')) / 2 - height / 2),
      )
    }
    return { x: halfX / (width / 2 - 48), y: halfY / (height / 2 - 48) }
  }

  it('re-fits when the pane turns out to be a different shape', () => {
    const restore = withPane()
    try {
      render(<DeckWeb {...freshProps()} />)
      // Frame 0 is the seeded spiral, not the answer; the fit is what the
      // settle arrives at, so the replay has to finish before it can be read.
      step(200)
      expect(Math.max(...Object.values(reach()))).toBeCloseTo(1, 2)

      pane = { width: 1000, height: 417 } // 2.4:1, a wide laptop graph pane
      act(() => {
        for (const cb of fire) cb()
      })
      step(200)
      const after = reach()
      // Nothing outside the drawing, and still filling it — rather than a graph
      // fitted to a canvas nobody is drawing, which overshoots one axis and
      // leaves the other empty.
      expect(after.x).toBeLessThanOrEqual(1.001)
      expect(after.y).toBeLessThanOrEqual(1.001)
      expect(Math.max(after.x, after.y)).toBeCloseTo(1, 2)
    } finally {
      restore()
    }
  })
})

describe('the keyboard is unaffected (AGENTS.md R4)', () => {
  it('keeps the focused card and its selected connection across a re-render', () => {
    const { rerender } = render(<DeckWeb {...freshProps()} />)
    const node = screen.getByRole('button', { name: /^Card 0/ })
    act(() => {
      node.focus()
    })
    const frame = document.querySelector('.web-frame') as HTMLElement
    fireEvent.keyDown(frame, { key: ']' })
    const announced = document.querySelector('.web-live')?.textContent ?? ''
    expect(announced).toMatch(/^Connection 1 of/)

    rerender(<DeckWeb {...freshProps()} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Card 0/ }))
    expect(document.querySelector('.web-live')?.textContent).toBe(announced)
    // And it still steps, rather than stepping a list rebuilt underneath it.
    fireEvent.keyDown(frame, { key: ']' })
    expect(document.querySelector('.web-live')?.textContent).toMatch(/^Connection 2 of/)
  })
})
