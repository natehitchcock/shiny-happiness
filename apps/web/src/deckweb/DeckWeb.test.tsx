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
  // The 501-card case: no art on any printing. An answer, not a gap.
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

beforeEach(() => {
  // The layout settles synchronously, but the replay uses rAF; jsdom has one,
  // and the tests never depend on a frame having run.
  vi.stubGlobal('requestAnimationFrame', (() => 0) as unknown as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => undefined) as unknown as typeof cancelAnimationFrame)
})

afterEach(() => {
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
  const transform = (): string =>
    document.querySelector('.web-edges')?.parentElement?.getAttribute('transform') ?? ''

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
