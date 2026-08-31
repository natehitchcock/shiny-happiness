/**
 * A deterministic, settling force layout (doc 17 §17.5).
 *
 * Pure and synchronous: same inputs, same pixels, on every visit and in every
 * browser. Doc 17 §17.5 asks for that in as many words — "a graph that
 * reshuffles on every visit cannot be learned" — and it is also what lets a
 * test assert the layout instead of asserting that a canvas was touched.
 *
 * Fruchterman–Reingold, because at 100 nodes the O(n²) repulsion is ~5,000 pair
 * evaluations a tick and a quadtree would be more code for no measurable win.
 * `layout.test.ts` holds the whole thing to doc 17 §17.8's 400 ms budget.
 */

export interface LayoutNode {
  readonly oracleId: string
  /** Pinned at the centre and never moved. Doc 17 §17.5. */
  readonly commander: boolean
}

export interface LayoutEdge {
  readonly from: string
  readonly to: string
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface LayoutOptions {
  /** The deck id. Same deck, same picture. */
  readonly seed: string
  readonly width: number
  readonly height: number
  /** Doc 17 §17.5: converge, or stop at 300. */
  readonly ticks?: number
  /**
   * How many intermediate frames to keep for the settling animation.
   *
   * Recorded from the real simulation rather than interpolated from start to
   * finish: an interpolation would show nodes sliding through each other along
   * straight lines, which is not what the layout does and would teach the
   * viewer a shape that is not the one they end up looking at. 0 records none,
   * which is what `prefers-reduced-motion` asks for.
   */
  readonly frames?: number
}

export interface LayoutResult {
  readonly positions: ReadonlyMap<string, Point>
  /** Each frame is `[x0, y0, x1, y1, …]`, parallel to the input node array. */
  readonly frames: readonly (readonly number[])[]
  readonly ticks: number
  readonly converged: boolean
}

export const MAX_TICKS = 300

/**
 * FNV-1a, then mulberry32.
 *
 * `Math.random()` is the obvious thing and is exactly what doc 17 §17.5
 * forbids; AGENTS.md R1 makes the same demand of the domain package for the
 * same reason. Seeding from the deck id means the seed travels with the deck
 * rather than with the session, so the same deck lays out the same way on a
 * second device.
 */
const seeded = (seed: string): (() => number) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Below this, as a fraction of the ideal edge length, the layout has stopped
 * moving and there is nothing left to watch.
 *
 * Relative and not a pixel count, because the simulation runs in its own space
 * and the answer is scaled to the canvas afterwards — so "0.2 px of movement"
 * would mean a different thing for every deck size.
 */
const SETTLED = 0.004

/**
 * The four constants of the simulation, and what each of them buys.
 *
 * Only their RATIOS matter: the answer is scaled to fit the canvas afterwards,
 * so doubling every distance changes nothing. They were chosen against the real
 * 99-card aristocrats deck out of the corpus — 99 nodes, 400 drawn edges, 15 of
 * them touching nothing — not against a random graph, because a random graph
 * has no clusters and would have rewarded turning the springs off altogether.
 *
 *   K_FACTOR    `k`, the ideal edge length, as a multiple of sqrt(area / n).
 *   ATTRACTION  spring stiffness. The measured trade: at 0.5 the deck's
 *               nearest-neighbour median was 15 units against a 64-unit node —
 *               cards drawn on top of each other; at 0.012 it was 51, but the
 *               springs were then so weak that the layout stopped answering
 *               "what clusters", which is the only question a force layout is
 *               good at. 0.03 keeps the clustering and gives a median of 71.
 *   GRAVITY     the pull to the centre. Without it a card with no edges — and
 *               the real deck has fifteen — drifts away under repulsion alone,
 *               and doc 17 §17.1's "what is just sitting in it" is precisely
 *               the thing that must stay on screen to be counted.
 *   DAMPING     how much of the net force one tick actually applies.
 */
const K_FACTOR = 1.0
const ATTRACTION = 0.03
const GRAVITY = 0.05
const DAMPING = 0.2

/** Half a commander node, so nothing at the extremes is clipped by the frame. */
const PADDING = 48

export const layout = (
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): LayoutResult => {
  const n = nodes.length
  const { width, height, seed } = options
  const maxTicks = options.ticks ?? MAX_TICKS
  const wantFrames = Math.max(0, options.frames ?? 0)
  const cx = width / 2
  const cy = height / 2

  if (n === 0) return { positions: new Map(), frames: [], ticks: 0, converged: true }

  const random = seeded(seed)
  const index = new Map(nodes.map((node, i) => [node.oracleId, i]))
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const pinned = nodes.map((node) => node.commander)

  /*
   * A jittered golden-angle spiral, not uniform noise.
   *
   * Uniform random starts let two nodes begin on top of each other, where the
   * repulsion divides by a distance near zero and one of them is thrown off the
   * canvas — visible as a single node parked in a corner. The spiral is evenly
   * spread by construction and the jitter (still from the seed, still
   * deterministic) is only there to break the symmetry that would otherwise
   * make the first few ticks do nothing.
   */
  const radius = Math.min(width, height) * 0.42
  for (let i = 0; i < n; i += 1) {
    if (pinned[i] === true) {
      // Commanders share the centre; spread them along a short line so two
      // commanders are two nodes rather than one node drawn twice.
      const rank = nodes.slice(0, i).filter((node) => node.commander).length
      x[i] = cx + (rank - 0.5) * 40 * (nodes.filter((node) => node.commander).length > 1 ? 1 : 0)
      y[i] = cy
      continue
    }
    const angle = i * 2.399963229728653
    const r = radius * Math.sqrt((i + 0.5) / n)
    x[i] = cx + r * Math.cos(angle) + (random() - 0.5) * 12
    y[i] = cy + r * Math.sin(angle) + (random() - 0.5) * 12
  }

  const area = width * height
  const k = Math.sqrt(area / n) * K_FACTOR
  const stretch = width / height
  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter(
      (pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined,
    )

  const frames: number[][] = []
  const frameEvery = wantFrames === 0 ? 0 : Math.max(1, Math.ceil(maxTicks / wantFrames))
  const snapshot = (): void => {
    const frame: number[] = []
    for (let i = 0; i < n; i += 1) {
      frame.push(x[i] as number, y[i] as number)
    }
    frames.push(frame)
  }
  if (frameEvery > 0) snapshot()

  let tick = 0
  let converged = false
  for (; tick < maxTicks; tick += 1) {
    dx.fill(0)
    dy.fill(0)

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let sx = (x[i] as number) - (x[j] as number)
        let sy = (y[i] as number) - (y[j] as number)
        let dist2 = sx * sx + sy * sy
        if (dist2 < 0.01) {
          // Coincident. Push apart along a fixed axis rather than a random one,
          // so the tie is broken the same way every run.
          sx = (i - j) * 0.1
          sy = 0.1
          dist2 = sx * sx + sy * sy
        }
        const dist = Math.sqrt(dist2)
        const force = (k * k) / dist
        const ux = (sx / dist) * force
        const uy = (sy / dist) * force
        dx[i] = (dx[i] as number) + ux
        dy[i] = (dy[i] as number) + uy
        dx[j] = (dx[j] as number) - ux
        dy[j] = (dy[j] as number) - uy
      }
    }

    for (const [a, b] of links) {
      const sx = (x[a] as number) - (x[b] as number)
      const sy = (y[a] as number) - (y[b] as number)
      const dist = Math.max(0.01, Math.hypot(sx, sy))
      /*
       * A linear spring with rest length `k`, NOT Fruchterman–Reingold's d²/k.
       *
       * The quadratic version was measured and is unusable here: a graph with
       * a hundred nodes and four hundred edges never settled, because the pull
       * on a node that had drifted grew with the square of how far it had
       * drifted, so it was fired back across the graph and out the other side.
       * A few nodes flung to the far edge then set the scale for the fit below,
       * and the other ninety-odd were squeezed into a median gap of 8 px — for
       * 64 px nodes, an unreadable pile. Hooke's law has a fixed stiffness and
       * a rest length, so an edge asks its two cards to sit `k` apart and stops
       * asking harder the further apart they are.
       */
      const force = (dist - k) * ATTRACTION
      const ux = (sx / dist) * force
      const uy = (sy / dist) * force
      dx[a] = (dx[a] as number) - ux
      dy[a] = (dy[a] as number) - uy
      dx[b] = (dx[b] as number) + ux
      dy[b] = (dy[b] as number) + uy
    }

    // A weak pull to the middle, so a component with no edges at all does not
    // drift to infinity under repulsion alone. Isolated cards are the point of
    // §17.1's "what is just sitting in it" and have to stay on screen to be
    // counted.
    /*
     * Stiffer in the short axis, in proportion to the canvas aspect.
     *
     * An isotropic pull gathers the deck into a circle, and a circle in a 3:2
     * frame leaves a third of the width empty — measured on the real deck, the
     * drawn graph used 1,604 of 2,600 units across. Making the trap elliptical
     * with the canvas's own proportions fills it: 95% of the width and 88% of
     * the height, and the same again at 2.3:1 and at 0.9:1.
     *
     * The exponent is 1, not 2, and that was measured too — squaring
     * overcorrected and left the SHORT axis 63% filled instead of the long one.
     *
     * It is not a distortion of the drawing: both axes are still scaled by ONE
     * number at the fit below, so an edge twice as long as another is drawn
     * twice as long whichever way it points. It changes where the simulation
     * puts things, which is the layout's own business.
     */
    for (let i = 0; i < n; i += 1) {
      dx[i] = (dx[i] as number) + (cx - (x[i] as number)) * GRAVITY
      dy[i] = (dy[i] as number) + (cy - (y[i] as number)) * GRAVITY * stretch
    }

    // Linear cooling. The cap is what makes this terminate rather than orbit.
    // Measured against `k` for the same reason `SETTLED` is.
    const temperature = k * 1.5 * (1 - tick / maxTicks)
    let moved = 0
    for (let i = 0; i < n; i += 1) {
      if (pinned[i] === true) continue
      const d = Math.hypot(dx[i] as number, dy[i] as number)
      if (d < 1e-9) continue
      /*
       * A step is a FRACTION of the net force, not the whole of it.
       *
       * Textbook Fruchterman–Reingold moves the full force each tick, capped by
       * the temperature. That never settles: past the equilibrium distance the
       * spring term grows as the square of the separation, so a node jumps
       * across the balance point and back, and the only thing that ever quiets
       * it is the cooling schedule running out. Measured, every graph with an
       * edge in it ran the full 300 ticks and the early exit below never fired.
       * Damping to a fifth makes the last few ticks a decay toward the balance
       * point instead of an oscillation around it, which is what lets the
       * simulation notice it has finished and stop — doc 17 §17.5's "settled,
       * not animated forever", and the battery cost it names.
       */
      const step = Math.min(d * DAMPING, temperature)
      moved = Math.max(moved, step)
      x[i] = (x[i] as number) + ((dx[i] as number) / d) * step
      y[i] = (y[i] as number) + ((dy[i] as number) / d) * step
    }

    if (frameEvery > 0 && (tick + 1) % frameEvery === 0) snapshot()
    if (moved < SETTLED * k) {
      converged = true
      tick += 1
      break
    }
  }

  if (frameEvery > 0) snapshot()

  /*
   * Fit to the canvas at the end rather than clamping during the simulation.
   *
   * Clamping was the first version and it is a trap: repulsion over a hundred
   * nodes is far stronger than any centring pull that still leaves the middle
   * of the graph legible, so every node ends up pressed against the frame — and
   * because clamping is not a force, several land on the same boundary pixel.
   * Measured, 100 of 100 nodes on the wall with a closest pair of 0 px, which is
   * two cards drawn exactly on top of each other. Letting the simulation run in
   * whatever space it wants and scaling the ANSWER means the absolute size of
   * the forces stops mattering, only their ratios, and nothing is ever squashed
   * into a boundary it cannot leave.
   *
   * The box is symmetric about the centre, not the bounding box of the points.
   * A bounding-box fit would move the pinned commanders off the middle of the
   * frame whenever the deck happened to sprawl to one side, and "the commander
   * is in the centre" is the one landmark doc 17 §17.5 gives the reader.
   */
  let halfX = 1
  let halfY = 1
  for (let i = 0; i < n; i += 1) {
    halfX = Math.max(halfX, Math.abs((x[i] as number) - cx))
    halfY = Math.max(halfY, Math.abs((y[i] as number) - cy))
  }
  const scale = Math.min((width / 2 - PADDING) / halfX, (height / 2 - PADDING) / halfY)
  const fit = (px: number, py: number): Point => ({
    x: cx + (px - cx) * scale,
    y: cy + (py - cy) * scale,
  })

  const positions = new Map<string, Point>()
  for (let i = 0; i < n; i += 1) {
    positions.set((nodes[i] as LayoutNode).oracleId, fit(x[i] as number, y[i] as number))
  }
  // Every frame takes the SAME transform, so the settle does not appear to zoom.
  const fitted = frames.map((frame) => {
    const out: number[] = []
    for (let i = 0; i < n; i += 1) {
      const point = fit(frame[i * 2] as number, frame[i * 2 + 1] as number)
      out.push(point.x, point.y)
    }
    return out
  })
  return { positions, frames: fitted, ticks: tick, converged }
}
