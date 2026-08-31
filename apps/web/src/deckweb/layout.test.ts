import { describe, expect, it } from 'vitest'
import { layout, MAX_TICKS } from './layout'
import type { LayoutEdge, LayoutNode } from './layout'

/**
 * The layout (doc 17 §17.5).
 *
 * Three properties, and all three are requirements rather than preferences:
 * the same deck lays out the same way twice, the simulation stops, and it stops
 * inside doc 17 §17.8's budget.
 */

const nodes = (count: number, commanders = 0): LayoutNode[] =>
  Array.from({ length: count }, (_, i) => ({
    oracleId: `c${String(i)}`,
    commander: i < commanders,
  }))

const ring = (count: number): LayoutEdge[] =>
  Array.from({ length: count }, (_, i) => ({
    from: `c${String(i)}`,
    to: `c${String((i + 1) % count)}`,
  }))

const box = { width: 1400, height: 900 }

describe('determinism', () => {
  it('lays the same deck out the same way twice', () => {
    const a = layout(nodes(40), ring(40), { seed: 'deck-1', ...box })
    const b = layout(nodes(40), ring(40), { seed: 'deck-1', ...box })
    expect([...b.positions]).toEqual([...a.positions])
  })

  it('lays a different deck out differently', () => {
    // If the seed were ignored, every deck would be the same picture and
    // "where is my ramp" would mean nothing.
    const a = layout(nodes(40), ring(40), { seed: 'deck-1', ...box })
    const b = layout(nodes(40), ring(40), { seed: 'deck-2', ...box })
    expect([...b.positions]).not.toEqual([...a.positions])
  })

  it('does not depend on anything but its arguments', () => {
    // Interleaved, so a run that leaked state into a module-level PRNG would
    // give the second `deck-1` a different answer from the first.
    const first = layout(nodes(20), ring(20), { seed: 'deck-1', ...box })
    layout(nodes(20), ring(20), { seed: 'other', ...box })
    const second = layout(nodes(20), ring(20), { seed: 'deck-1', ...box })
    expect([...second.positions]).toEqual([...first.positions])
  })
})

describe('it settles and stops', () => {
  it('never runs past the tick cap', () => {
    const result = layout(nodes(100), ring(100), { seed: 'd', ...box })
    expect(result.ticks).toBeLessThanOrEqual(MAX_TICKS)
  })

  it('stops early once nothing is moving', () => {
    // Two nodes and one edge reach equilibrium long before 300 ticks. A layout
    // that always ran the full budget would be burning a phone battery to
    // redraw the same picture.
    const result = layout(nodes(2), ring(2), { seed: 'd', ...box })
    expect(result.converged).toBe(true)
    expect(result.ticks).toBeLessThan(MAX_TICKS)
  })
})

describe('the canvas', () => {
  it('keeps every node inside it', () => {
    const result = layout(nodes(100), ring(100), { seed: 'd', ...box })
    for (const point of result.positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(box.width)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(box.height)
    }
  })

  it('produces no NaN, even for a single node with no edges', () => {
    // The repulsion divides by distance, so a degenerate deck is where a
    // divide-by-zero would first appear — as a node that vanishes.
    const result = layout(nodes(1), [], { seed: 'd', ...box })
    const point = result.positions.get('c0')!
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
  })

  it('has nothing to place for an empty deck', () => {
    expect(layout([], [], { seed: 'd', ...box }).positions.size).toBe(0)
  })

  it('handles an edge naming a card that is not in the graph', () => {
    const result = layout(nodes(2), [{ from: 'c0', to: 'ghost' }], { seed: 'd', ...box })
    expect(result.positions.size).toBe(2)
    expect(Number.isFinite(result.positions.get('c0')!.x)).toBe(true)
  })
})

describe('commanders', () => {
  it('pins them at the centre and never moves them', () => {
    // Doc 17 §17.2: the whole deck is legal only by reference to them, so they
    // are the one fixed point the reader can navigate from.
    const result = layout(nodes(30, 1), ring(30), { seed: 'd', ...box })
    expect(result.positions.get('c0')).toEqual({ x: box.width / 2, y: box.height / 2 })
  })

  it('gives two commanders two places, not one place twice', () => {
    const result = layout(nodes(30, 2), ring(30), { seed: 'd', ...box })
    expect(result.positions.get('c0')).not.toEqual(result.positions.get('c1'))
  })
})

describe('the settling animation', () => {
  it('records nothing unless asked — which is what reduced motion asks for', () => {
    expect(layout(nodes(30), ring(30), { seed: 'd', ...box }).frames).toEqual([])
  })

  it('records real frames from the simulation, ending where it ended', () => {
    const result = layout(nodes(30), ring(30), { seed: 'd', ...box, frames: 10 })
    expect(result.frames.length).toBeGreaterThan(1)
    const last = result.frames[result.frames.length - 1]!
    expect(last[0]).toBeCloseTo(result.positions.get('c0')!.x, 6)
    expect(last[1]).toBeCloseTo(result.positions.get('c0')!.y, 6)
  })

  it('starts somewhere other than where it finishes, or there is nothing to watch', () => {
    const result = layout(nodes(30), ring(30), { seed: 'd', ...box, frames: 10 })
    expect(result.frames[0]).not.toEqual(result.frames[result.frames.length - 1])
  })

  it('gives every frame two numbers per node', () => {
    const result = layout(nodes(30), ring(30), { seed: 'd', ...box, frames: 10 })
    for (const frame of result.frames) expect(frame).toHaveLength(60)
  })
})

describe('it leaves room to see a card', () => {
  const dense: LayoutEdge[] = Array.from({ length: 400 }, (_, i) => ({
    from: `c${String(i % 100)}`,
    to: `c${String((i * 7 + 3) % 100)}`,
  }))
  const canvas = { width: 2600, height: 1700 }

  const nearestNeighbours = (
    positions: ReadonlyMap<string, { x: number; y: number }>,
  ): number[] => {
    const points = [...positions.values()]
    return points
      .map((p, i) =>
        Math.min(...points.filter((_, j) => i !== j).map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
      )
      .sort((a, b) => a - b)
  }

  it('keeps the typical gap wider than most of a node, at 100 nodes and 400 edges', () => {
    /*
     * The regression this pins is a picture, not a crash. With Fruchterman–
     * Reingold's quadratic spring the same graph came out with a median gap of
     * 15 units against a 64-unit node — a hundred cards drawn on top of each
     * other — and every other test here still passed, because determinism,
     * termination and the budget were all fine. Only looking at it caught it.
     */
    const gaps = nearestNeighbours(layout(nodes(100), dense, { seed: 'd', ...canvas }).positions)
    expect(gaps[Math.floor(gaps.length / 2)]).toBeGreaterThan(48)
  })

  it('never lays two cards exactly on top of one another', () => {
    const gaps = nearestNeighbours(layout(nodes(100), dense, { seed: 'd', ...canvas }).positions)
    expect(gaps[0]).toBeGreaterThan(8)
  })

  const fill = (box: { width: number; height: number }): { x: number; y: number } => {
    const points = [...layout(nodes(100), dense, { seed: 'd', ...box }).positions.values()]
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
      x: (Math.max(...xs) - Math.min(...xs)) / box.width,
      y: (Math.max(...ys) - Math.min(...ys)) / box.height,
    }
  }

  it('fills the frame in both directions, not just the short one', () => {
    // An isotropic centring pull settles the deck into a circle, and a circle
    // in a 3:2 frame used 62% of the width. Both numbers matter: the graph is
    // scaled to fit, so an axis it does not fill is an axis whose emptiness
    // shrinks everything on the other one.
    const filled = fill(canvas)
    expect(filled.x).toBeGreaterThan(0.85)
    expect(filled.y).toBeGreaterThan(0.8)
  })

  it('fills a wide frame and a tall one just as well', () => {
    // The pane's shape follows the window, so the canvas does too.
    for (const box of [
      { width: 3200, height: 1380 },
      { width: 1990, height: 2220 },
    ]) {
      const filled = fill(box)
      expect(filled.x).toBeGreaterThan(0.85)
      expect(filled.y).toBeGreaterThan(0.8)
    }
  })
})

describe('doc 17 §17.8’s budget', () => {
  it('lays out 100 nodes and 400 edges in under 400 ms', () => {
    const dense: LayoutEdge[] = []
    for (let i = 0; i < 400; i += 1) {
      dense.push({ from: `c${String(i % 100)}`, to: `c${String((i * 7 + 3) % 100)}` })
    }
    const started = performance.now()
    layout(nodes(100), dense, { seed: 'd', ...box })
    expect(performance.now() - started).toBeLessThan(400)
  })
})
