// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckWeb } from './DeckWeb'
import type { DeckWebCard } from './DeckWeb'

/**
 * The deck web on screen (doc 17 §17.6, §17.7).
 *
 * The model tests decide whether a line SHOULD be drawn; these decide whether
 * the drawing can be operated — with a pointer, with a finger, and with a
 * keyboard alone, which AGENTS.md R4 makes binding rather than aspirational.
 */

const ART = 'https://cards.scryfall.io/art_crop/front/1/2/outlet.jpg?1783903215'
const NORMAL = 'https://cards.scryfall.io/normal/front/1/2/outlet.jpg?1783903215'

const card = (over: Partial<DeckWebCard> & { oracleId: string; name: string }): DeckWebCard => ({
  manaCost: '{1}{B}',
  manaValue: 2,
  typeLine: 'Creature — Human',
  oracleText: 'Sacrifice a creature: Draw a card.',
  colorIdentity: ['B'],
  primaryRole: 'engine',
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

const CARDS: DeckWebCard[] = [
  card({ oracleId: 'boss', name: 'Teysa Karlov', synergyProduces: ['creature-death'] }),
  card({ oracleId: 'outlet', name: 'Viscera Seer', synergyProduces: ['creature-death'] }),
  card({ oracleId: 'drain', name: 'Blood Artist', synergyWants: ['creature-death'] }),
  card({ oracleId: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp' }),
]

const IMAGES = new Map([
  ['outlet', { artCrop: ART, normal: NORMAL }],
  ['drain', { artCrop: ART, normal: NORMAL }],
  ['boss', { artCrop: ART, normal: NORMAL }],
  // A printing with no resolved art — an answer, not a gap. 501 real cards
  // took this path until the double-faced art fix (doc 17 §17.2); the wire can
  // still say it, so the graph still has to draw it.
  ['swamp', { artCrop: null, normal: null }],
])

const draw = (over: Partial<Parameters<typeof DeckWeb>[0]> = {}): ReturnType<typeof render> => {
  const cards = new Map(CARDS.map((c) => [c.oracleId, c]))
  return render(
    <DeckWeb
      deckId="d1"
      deckName="Test deck"
      order={['boss', 'outlet', 'drain', 'swamp']}
      accepted={['outlet', 'drain', 'swamp']}
      commanders={['boss']}
      cards={cards}
      combos={[]}
      images={IMAGES}
      onLeave={() => undefined}
      {...over}
    />,
  )
}

const node = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name })

const transformNow = (): string =>
  document.querySelector('.web-edges')?.parentElement?.getAttribute('transform') ?? ''

/** The view transform as numbers, so a test can do arithmetic on it. */
const viewNow = (): { x: number; y: number; scale: number } => {
  const found = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\) scale\((-?[\d.e-]+)\)/.exec(transformNow())
  if (found === null) throw new Error(`no view transform in ${transformNow()}`)
  return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) }
}

const canvasSize = (): { width: number; height: number } => {
  const box = (document.querySelector('.web-svg')?.getAttribute('viewBox') ?? '').split(' ')
  return { width: Number(box[2]), height: Number(box[3]) }
}

/**
 * Renders with a measurable pane, then hands back a way to place the SVG on the
 * page.
 *
 * jsdom measures everything as zero, and a zoom that cannot find the pane can
 * only fall back to the centre — which is exactly the answer the anchored-zoom
 * bug also gives for a centred cursor. Nothing about anchoring can be tested
 * without a pane that has a size and a position.
 */
const withPane = (): { svg: SVGSVGElement; place: (left: number, top: number) => void } => {
  const original = Element.prototype.getBoundingClientRect
  let placed: DOMRect | null = null
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.classList.contains('web-frame')) return { width: 1000, height: 500 } as DOMRect
    if (this.classList.contains('web-svg') && placed !== null) return placed
    return original.call(this)
  }
  restore.push(() => (Element.prototype.getBoundingClientRect = original))
  draw()
  const svg = document.querySelector('.web-svg') as unknown as SVGSVGElement
  return {
    svg,
    place: (left, top) => {
      // Exactly half the canvas in each axis, so one client pixel is two canvas
      // units and `meet` has no surplus to letterbox. Round numbers on purpose:
      // the arithmetic under test should be checkable by hand.
      const canvas = canvasSize()
      placed = { left, top, width: canvas.width / 2, height: canvas.height / 2 } as DOMRect
    },
  }
}

const restore: (() => void)[] = []

beforeEach(() => {
  // The layout settles synchronously, but the replay uses rAF; jsdom has one,
  // and the tests never depend on a frame having run.
  vi.stubGlobal('requestAnimationFrame', (() => 0) as unknown as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => undefined) as unknown as typeof cancelAnimationFrame)
})

afterEach(() => {
  while (restore.length > 0) restore.pop()?.()
  vi.unstubAllGlobals()
  cleanup()
})

describe('the nodes', () => {
  it('draws one per card, each of them focusable', () => {
    draw()
    expect(node('Viscera Seer')).toBeTruthy()
    expect(node(/Teysa Karlov/)).toBeTruthy()
    expect(node('Swamp').getAttribute('tabindex')).toBe('0')
  })

  it('puts them in the tab order the deck rail lists them in, not the layout order', () => {
    // Doc 17 §17.6. Layout order is a physics accident and would change what
    // Tab does when a card is accepted; the rail's order is the one the reader
    // already knows. It is DOM order here, so the browser's own tab order is it.
    draw()
    const ids = [...document.querySelectorAll('.web-node')].map((g) => g.id)
    expect(ids).toEqual(['web-node-boss', 'web-node-outlet', 'web-node-drain', 'web-node-swamp'])
  })

  it('draws the art crop, not the full card', () => {
    // Doc 07 §7.3 through `imageFor`: never load a full card image for a tile.
    draw()
    const image = node('Viscera Seer').querySelector('image')
    expect(image?.getAttribute('href')).toBe(ART)
    expect(image?.getAttribute('href')).not.toBe(NORMAL)
  })

  it('draws a named tile for a card with no art, rather than a broken image', () => {
    // Doc 17 §17.10 question 2. `src` of an empty string or null resolves
    // against the page URL and paints a broken-image icon where the name
    // belongs.
    draw()
    const swamp = node('Swamp')
    expect(swamp.querySelector('image')).toBeNull()
    expect(swamp.textContent).toContain('Swamp')
  })

  it('names every node, arted or not, so the picture-less one is not the only readable one', () => {
    draw()
    for (const name of ['Viscera Seer', 'Blood Artist', 'Swamp']) {
      expect(node(name).querySelector('title')?.textContent).toContain(name)
    }
  })

  it('marks the commander, and writes its name on the canvas', () => {
    draw()
    const boss = node(/Teysa Karlov/)
    expect(boss.getAttribute('data-commander')).toBe('true')
    expect(boss.getAttribute('aria-label')).toContain('commander')
    expect(boss.querySelector('.web-commander-name')?.textContent).toBe('Teysa Karlov')
  })

  it('says how many copies a repeated card is, rather than drawing it twice', () => {
    draw({ accepted: ['swamp', 'swamp', 'swamp', 'outlet', 'drain'] })
    expect(document.querySelectorAll('.web-node')).toHaveLength(4)
    expect(node(/Swamp/).getAttribute('aria-label')).toContain('3 copies')
  })
})

describe('the edges', () => {
  it('draws one line per connection, carrying its claim in words', () => {
    draw()
    const lines = document.querySelectorAll('.web-edges line')
    // Teysa and Viscera Seer both cause a creature dying; Blood Artist gains.
    expect(lines).toHaveLength(2)
    expect(lines[0]?.querySelector('title')?.textContent).toContain('Blood Artist benefits from it')
  })

  it('gives a benefits edge an arrowhead, so colour is not the only encoding', () => {
    draw()
    const line = document.querySelector('.web-edges line[data-kind="benefits"]')
    expect(line?.getAttribute('marker-end')).toBe('url(#web-arrow)')
  })

  it('dims every edge that does not touch the focused card', () => {
    draw({
      cards: new Map([
        ...CARDS.map((c) => [c.oracleId, c] as const),
        ['other', card({ oracleId: 'other', name: 'Zulaport Cutthroat', synergyWants: ['token'] })],
        ['maker', card({ oracleId: 'maker', name: 'Bitterblossom', synergyProduces: ['token'] })],
      ]),
      order: ['boss', 'outlet', 'drain', 'swamp', 'other', 'maker'],
      accepted: ['outlet', 'drain', 'swamp', 'other', 'maker'],
    })
    fireEvent.focus(node('Blood Artist'))
    const dimmed = [...document.querySelectorAll('.web-edges line')].filter(
      (l) => l.getAttribute('data-dim') === 'true',
    )
    // The token edge does not touch Blood Artist; the two death edges do.
    expect(dimmed).toHaveLength(1)
  })
})

describe('the keyboard, which is every pointer action’s equal (R4)', () => {
  const frame = (): HTMLElement => document.querySelector('.web-frame')!
  const transform = transformNow

  it('pans with the arrow keys', () => {
    draw()
    const before = transform()
    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    expect(transform()).not.toBe(before)
    expect(transform()).toContain('translate(-60')
  })

  it('zooms with + and -, and resets with 0', () => {
    draw()
    fireEvent.keyDown(frame(), { key: '+' })
    expect(transform()).toContain('scale(1.25)')
    fireEvent.keyDown(frame(), { key: '0' })
    expect(transform()).toContain('scale(1)')
  })

  it('zooms from the middle of the view, not from a corner and not from the cursor', () => {
    /*
     * The keyboard has no cursor, so the middle of the drawing is the only
     * anchor that means anything — and anchoring it at wherever the mouse
     * happens to be resting would make a keypress jump the graph to a place
     * the reader was not looking at.
     *
     * The default canvas is 2600 × 1700, so its middle is (1300, 850) and one
     * notch of 1.25 leaves translate(1300 − 1300×1.25, 850 − 850×1.25). The
     * two axes differ, which is the point: an anchor that has been transposed
     * or dropped gives a different pair, and the old behaviour gives (0, 0).
     */
    draw()
    fireEvent.keyDown(frame(), { key: '+' })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(1.25, 6)
    expect(view.x).toBeCloseTo(-325, 4)
    expect(view.y).toBeCloseTo(-212.5, 4)
  })

  it('comes back to where it started when zoomed in and out again', () => {
    draw()
    fireEvent.keyDown(frame(), { key: '+' })
    fireEvent.keyDown(frame(), { key: '-' })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(1, 6)
    expect(view.x).toBeCloseTo(0, 4)
    expect(view.y).toBeCloseTo(0, 4)
  })

  it('holds still at the zoom limit rather than creeping on every further press', () => {
    // The silent half of the bug: the scale stops at 4 but a translate computed
    // from the ratio that was ASKED for keeps sliding the graph off screen.
    draw()
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(frame(), { key: '+' })
    expect(viewNow().scale).toBe(4)
    const atTheLimit = transform()
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(frame(), { key: '+' })
    expect(transform()).toBe(atTheLimit)
  })

  it('resets the pan as well as the scale on 0', () => {
    draw()
    fireEvent.keyDown(frame(), { key: '+' })
    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    fireEvent.keyDown(frame(), { key: '0' })
    expect(transform()).toBe('translate(0 0) scale(1)')
  })

  it('cycles the focused card’s connections with [ and ], and says which one', () => {
    draw()
    fireEvent.focus(node('Blood Artist'))
    fireEvent.keyDown(frame(), { key: ']' })
    const live = screen.getByRole('status')
    expect(live.textContent).toContain('Connection 1 of 2')
    expect(live.textContent).toContain('benefits from it')
  })

  it('follows the selected edge to its far end on Enter', () => {
    draw()
    fireEvent.focus(node('Blood Artist'))
    fireEvent.keyDown(frame(), { key: ']' })
    fireEvent.keyDown(frame(), { key: 'Enter' })
    // Both of Blood Artist's connections come from a card that causes a
    // creature dying, so either far end is a correct landing.
    expect(screen.getByRole('status').textContent).toMatch(/Moved to (Teysa Karlov|Viscera Seer)\./)
    // Focus actually moved, not just an announcement about moving.
    expect(['web-node-boss', 'web-node-outlet']).toContain(document.activeElement?.id)
  })

  it('describes the card on Enter when no edge has been picked', () => {
    draw()
    fireEvent.focus(node('Swamp'))
    fireEvent.keyDown(frame(), { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe('Swamp: 0 connections.')
  })

  it('answers to Space as well, because a node says it is a button', () => {
    draw()
    fireEvent.focus(node('Blood Artist'))
    fireEvent.keyDown(frame(), { key: ' ' })
    expect(screen.getByRole('status').textContent).toBe('Blood Artist: 2 connections.')
  })

  it('does nothing rather than throwing when a card has no connections to cycle', () => {
    draw()
    fireEvent.focus(node('Swamp'))
    fireEvent.keyDown(frame(), { key: ']' })
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('the pointer, which the same actions answer to', () => {
  it('pans on a drag of the background', () => {
    draw()
    const svg = document.querySelector('.web-svg')!
    // `setPointerCapture` does not exist in jsdom.
    ;(svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 130 })
    expect(
      document.querySelector('.web-edges')?.parentElement?.getAttribute('transform'),
    ).toContain('translate(40 30)')
  })

  it('zooms on the wheel', () => {
    draw()
    fireEvent.wheel(document.querySelector('.web-svg')!, { deltaY: -1 })
    expect(
      document.querySelector('.web-edges')?.parentElement?.getAttribute('transform'),
    ).toContain('scale(1.1')
  })
})

describe('zooming where the reader is pointing', () => {
  /*
   * The reported bug: the graph grew and shrank out of its top-left corner
   * instead of out of the cursor, because the scale changed and the translate
   * did not.
   *
   * The fixture is deliberately awkward. The pane sits at (40, 120) rather than
   * at the page origin — the graph lives inside a padded section, and a
   * calculation that forgets the offset is correct only for a drawing that
   * fills the window. The pane is half the canvas in each axis, so a client
   * pixel is two canvas units and an implementation that treats the two as
   * interchangeable gets a different, wrong answer rather than the same one.
   * The cursor is up and to the left, nowhere near the middle, because a zoom
   * anchored at the middle of the view looks identical to a correct one when
   * the cursor happens to be in the middle.
   */
  const cursor = { clientX: 240, clientY: 220 }
  // (240 − 40) / 0.5 = 400 across, (220 − 120) / 0.5 = 200 down.
  const under = { x: 400, y: 200 }

  it('keeps the point under the cursor under the cursor, zooming in', () => {
    const { svg, place } = withPane()
    place(40, 120)
    fireEvent.wheel(svg, { deltaY: -1, ...cursor })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(1.1, 6)
    // translate = anchor − (anchor − 0) × 1.1
    expect(view.x).toBeCloseTo(-40, 4)
    expect(view.y).toBeCloseTo(-20, 4)
  })

  it('keeps the point under the cursor under the cursor, zooming out', () => {
    const { svg, place } = withPane()
    place(40, 120)
    fireEvent.wheel(svg, { deltaY: 1, ...cursor })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(0.9, 6)
    expect(view.x).toBeCloseTo(40, 4)
    expect(view.y).toBeCloseTo(20, 4)
  })

  it('keeps that same card still over a long run of notches, not just one', () => {
    // One notch can be right by luck; twenty compounds any error in the anchor
    // into something the eye would have caught in the browser.
    const { svg, place } = withPane()
    place(40, 120)
    for (let i = 0; i < 20; i += 1) fireEvent.wheel(svg, { deltaY: -1, ...cursor })
    const view = viewNow()
    expect(view.x + under.x * view.scale).toBeCloseTo(under.x, 3)
    expect(view.y + under.y * view.scale).toBeCloseTo(under.y, 3)
  })

  it('answers two different cursor positions differently', () => {
    // The one assertion the old behaviour cannot pass under any fixture.
    const { svg, place } = withPane()
    place(40, 120)
    fireEvent.wheel(svg, { deltaY: -1, clientX: 100, clientY: 160 })
    const near = viewNow()
    fireEvent.keyDown(document.querySelector('.web-frame')!, { key: '0' })
    fireEvent.wheel(svg, { deltaY: -1, clientX: 900, clientY: 480 })
    const far = viewNow()
    expect(near.scale).toBeCloseTo(far.scale, 6)
    expect(near.x).not.toBeCloseTo(far.x, 1)
    expect(near.y).not.toBeCloseTo(far.y, 1)
  })

  it('does not creep when the wheel keeps turning at the limit', () => {
    const { svg, place } = withPane()
    place(40, 120)
    for (let i = 0; i < 20; i += 1) fireEvent.wheel(svg, { deltaY: -1, ...cursor })
    expect(viewNow().scale).toBe(4)
    const atTheLimit = transformNow()
    for (let i = 0; i < 5; i += 1) fireEvent.wheel(svg, { deltaY: -1, ...cursor })
    expect(transformNow()).toBe(atTheLimit)
  })

  it('zooms the on-screen buttons from the middle, cursor or no cursor', () => {
    // Same anchor as the keyboard, and for the same reason: a button press is
    // not a statement about where the mouse is resting.
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(viewNow().x).toBeCloseTo(-325, 4)
    expect(viewNow().y).toBeCloseTo(-212.5, 4)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(viewNow().scale).toBeCloseTo(1, 6)
    expect(viewNow().x).toBeCloseTo(0, 4)
    expect(viewNow().y).toBeCloseTo(0, 4)
  })

  it('pinches about the point between the two fingers', () => {
    const { svg, place } = withPane()
    place(40, 120)
    ;(svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined
    // Two fingers 200 px apart, centred on the same off-centre point as above.
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 140, clientY: 220 })
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 340, clientY: 220 })
    // Spread to 400 px without moving the midpoint: a doubling.
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: 220 })
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 440, clientY: 220 })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(2, 6)
    expect(view.x + under.x * view.scale).toBeCloseTo(under.x, 3)
    expect(view.y + under.y * view.scale).toBeCloseTo(under.y, 3)
  })

  it('drags the graph at the speed of the cursor, not a third of it', () => {
    /*
     * The same coordinate-space mistake as the zoom, on the other gesture: the
     * drag added CLIENT PIXELS to a translate measured in canvas units, so the
     * graph followed the mouse at whatever fraction the viewBox happened to be
     * scaled by — about a third on a laptop. Invisible in jsdom, where an
     * unmeasurable pane makes the two units the same, which is why the older
     * drag test above could not see it.
     */
    const { svg, place } = withPane()
    place(40, 120)
    ;(svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 340, clientY: 330 })
    const view = viewNow()
    expect(view.x).toBeCloseTo(80, 4)
    expect(view.y).toBeCloseTo(60, 4)
  })

  it('pans on two fingers that travel together without spreading', () => {
    const { svg, place } = withPane()
    place(40, 120)
    ;(svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 140, clientY: 220 })
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 340, clientY: 220 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 190, clientY: 260 })
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 390, clientY: 260 })
    const view = viewNow()
    expect(view.scale).toBeCloseTo(1, 6)
    // 50 px right and 40 px down, at two canvas units to the pixel.
    expect(view.x).toBeCloseTo(100, 4)
    expect(view.y).toBeCloseTo(80, 4)
  })
})

describe('the table view (doc 17 §17.7)', () => {
  it('is not shown until it is asked for, on a wide screen', () => {
    draw()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists one row per edge, naming both cards, the kind, and why', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    // A header row plus one per edge.
    expect(rows).toHaveLength(3)
    expect(rows[1]?.textContent).toContain('Blood Artist')
    expect(rows[1]?.textContent).toContain('Benefits')
    expect(rows[1]?.textContent).toContain('causes a creature dying')
  })

  it('names the cards nothing connects to', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByText(/connected to nothing: Swamp/)).toBeTruthy()
  })

  it('hides the drawing from the screen reader while the table is showing it', () => {
    // Two readings of the same data in the accessibility tree is two readings
    // of the same data.
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(document.querySelector('.web-svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes the nodes out of the tab order with it', () => {
    // A focusable control inside an `aria-hidden` subtree is how a keyboard
    // user lands on something no screen reader will announce.
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const tabbable = [...document.querySelectorAll('.web-node')].filter(
      (g) => g.getAttribute('tabindex') !== '-1',
    )
    expect(tabbable).toHaveLength(0)
  })

  it('opens on the table on a narrow screen, where the graph is not legible', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 640px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    draw()
    expect(screen.queryByRole('table')).not.toBeNull()
    window.matchMedia = original
  })
})

describe('the canvas', () => {
  const viewBox = (): number[] =>
    (document.querySelector('.web-svg')?.getAttribute('viewBox') ?? '')
      .split(' ')
      .map(Number)
      .slice(2)

  it('falls back to a default when the pane cannot be measured', () => {
    // jsdom reports a zero-sized box for everything, which is the same signal
    // a pane gives before it has been laid out: "no measurement", not "no size".
    draw()
    expect(viewBox()).toEqual([2600, 1700])
  })

  it('takes the pane’s proportions once it can measure them', () => {
    /*
     * A fixed 3:2 viewBox in a 2.4:1 pane is letterboxed, and the graph is
     * scaled down to whatever the shorter axis allows — measured in a browser,
     * a 99-card deck drew into 216 px of a 470 px pane.
     */
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      return this.classList.contains('web-frame')
        ? ({ width: 1200, height: 500 } as DOMRect)
        : original.call(this)
    }
    try {
      draw()
      const [w, h] = viewBox()
      expect(w! / h!).toBeCloseTo(2.4, 1)
      // Same area, so the node-size trade-off does not move with the window.
      expect(w! * h!).toBeCloseTo(2600 * 1700, -5)
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe('the legend and the counts', () => {
  it('names both edge kinds in words', () => {
    draw()
    expect(screen.getByText(/Combo — both are pieces/)).toBeTruthy()
    expect(screen.getByText(/Benefits — the arrow points/)).toBeTruthy()
  })

  it('says how many connections there are, and how many cards touch none', () => {
    draw()
    expect(screen.getByText(/2 connections · 4 cards · 1 connected to nothing/)).toBeTruthy()
  })

  it('states what the drawing limit dropped, rather than quietly drawing fewer', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      card({
        oracleId: `c${String(i)}`,
        name: `Card ${String(i)}`,
        synergyProduces: ['token'],
        synergyWants: ['token'],
      }),
    )
    draw({
      cards: new Map(many.map((c) => [c.oracleId, c])),
      order: many.map((c) => c.oracleId),
      accepted: many.map((c) => c.oracleId),
      commanders: [],
      images: new Map(),
    })
    expect(screen.getByText(/Showing 400 of 780 connections/)).toBeTruthy()
  })
})

describe('reduced motion', () => {
  it('paints the settled layout and never schedules a frame', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    const raf = vi.fn(() => 0)
    vi.stubGlobal('requestAnimationFrame', raf as unknown as typeof requestAnimationFrame)
    draw()
    expect(raf).not.toHaveBeenCalled()
    window.matchMedia = original
  })
})

describe('leaving the mode', () => {
  it('offers a way back to the list', () => {
    const onLeave = vi.fn()
    draw({ onLeave })
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(onLeave).toHaveBeenCalled()
  })
})

describe('the details popover and a double-faced card (ADR-0027)', () => {
  /*
   * The popover draws through `CardFace`, so it inherits the flip control the
   * detail surfaces got — but only if this view forwards the back face, and
   * this view narrows the art map to its own type. The narrowing is exactly
   * where a new member gets dropped without anything failing: the popover would
   * simply show a transform card as having one side, which is the collapse
   * ADR-0027 exists to prevent, in the one surface nothing else covers.
   */
  const DFC = 'https://cards.scryfall.io/normal/back/1/2/outlet.jpg?1783903215'

  const withDfc = (back: { artCrop: string | null; normal: string | null } | undefined) =>
    draw({
      images: new Map([
        ...IMAGES,
        ['outlet', { artCrop: ART, normal: NORMAL, ...(back === undefined ? {} : { back }) }],
      ]),
    })

  it('offers no flip control for a single-faced card', () => {
    const { container } = withDfc(undefined)
    fireEvent.focus(node('Viscera Seer'))
    expect(container.querySelector('.web-details')).not.toBeNull()
    expect(container.querySelector('.web-details .rt-flip')).toBeNull()
  })

  it('shows the back face when the printing has one', () => {
    const { container } = withDfc({ artCrop: ART, normal: DFC })
    fireEvent.focus(node('Viscera Seer'))
    const flip = container.querySelector<HTMLButtonElement>('.web-details .rt-flip')
    expect(flip).not.toBeNull()
    fireEvent.click(flip!)
    expect(container.querySelector('.web-details img')?.getAttribute('src')).toBe(DFC)
  })

  it('keeps the control when there is a second side and no picture of it', () => {
    const { container } = withDfc({ artCrop: null, normal: null })
    fireEvent.focus(node('Viscera Seer'))
    expect(container.querySelector('.web-details .rt-flip')).not.toBeNull()
  })
})

describe('the deck is not editable here (doc 17 §17.9)', () => {
  it('offers no accept, reject or lock control anywhere in the view', () => {
    // Deliberate scope, and the kind of scope that gets quietly filled in.
    draw()
    const labels = screen
      .getAllByRole('button')
      .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase())
    for (const word of ['accept', 'reject', 'never', 'lock']) {
      expect(labels.some((l) => l.includes(word))).toBe(false)
    }
  })
})
