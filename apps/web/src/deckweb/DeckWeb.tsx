/**
 * The deck web (doc 17) — one deck as a picture.
 *
 * A mode, not a panel: it replaces everything below the masthead and is entered
 * and left at `#web`, the same hash mechanism the gallery uses. The workspace's
 * three columns answer "what should I add next"; this answers the question they
 * cannot — what is actually holding the deck together, and what is just sitting
 * in it.
 *
 * SVG rather than canvas, per doc 17 §17.8. 100 nodes and at most 400 edges is
 * well inside what SVG handles, and focus, `Tab` and hit-testing come with it —
 * all three of which §17.6's keyboard table would otherwise have to be
 * reimplemented on a canvas, which is how a graph ends up drag-only.
 *
 * The deck is NOT editable here (doc 17 §17.9). Accept, reject and lock stay in
 * the workspace, deliberately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { CardFace, ART_CROP_ASPECT, imageFor, levelSpec } from '@roundtable/ui'
import type { CardView } from '@roundtable/ui'
import { buildDeckWeb, edgesAt, otherEnd, strokeWidth } from './model'
import type { WebEdge, WebNode } from './model'
import { layout } from './layout'
import { canvasPoint, canvasVector, pinchTo, zoomBy } from './view'
import type { Point } from './view'

/**
 * The node box, from the shared level spec rather than a number typed here.
 *
 * L1's `minWidth` and not its nominal 72: doc 17 §17.2's argument for drawing
 * the art crop is that the art is "the part that is still recognisable at
 * 64 px", and 64 is the bottom of L1's band for exactly that reason.
 */
const NODE_W = levelSpec(1).minWidth
const NODE_H = Math.round(NODE_W * ART_CROP_ASPECT)

/**
 * How much room the layout gets, in viewBox units — NOT a pixel size.
 *
 * Deliberately about four times the area of the element it is drawn into, which
 * is the one honest answer to the arithmetic: a hundred 64 × 47 nodes is
 * 300,000 square units of card, and a laptop-sized graph pane is around
 * 720,000. Two fifths of the surface covered in cards cannot be laid out
 * without overlap, so a canvas that matched the pane would have to draw the
 * deck as a pile. Making the canvas bigger and letting the SVG fit it means the
 * deck opens at around a third size — a shape you can read as a shape — and the
 * zoom §17.6 already specifies is how you get back to the art. Measured on the
 * real 99-card aristocrats deck: nearest-neighbour median 71 units against a
 * 64-unit node, where a pane-sized canvas gave 26.
 */
const CANVAS_AREA = 2600 * 1700
const DEFAULT_ASPECT = 2600 / 1700

/**
 * One arrow-key nudge, in canvas units.
 *
 * Outside the scale in the transform, so it is a fixed step across the drawing
 * rather than a step that shrinks as the reader zooms in. Deliberate: at 4× a
 * scaled step would crawl.
 */
const PAN_STEP = 60

/**
 * The canvas takes the PANE's proportions, at a fixed area.
 *
 * A fixed 3:2 viewBox drawn into a wide pane is letterboxed, and the graph
 * loses whichever axis does not match — measured in a browser, a 99-card deck
 * drew into 216 px of a 470 px pane. Matching the aspect means
 * `preserveAspectRatio` has nothing to letterbox. The area is held constant so
 * the node-size trade-off above does not move with the window.
 *
 * Quantised and clamped, because the aspect is an input to the layout: without
 * it, dragging a window edge would re-run the simulation on every animation
 * frame and reshuffle the deck under the reader's cursor. A tenth is the step,
 * not a quarter — a quarter rounded a 1.11 pane down to a square canvas and
 * then letterboxed 10% of the width away again, which is the exact waste this
 * hook exists to remove.
 */
const useCanvas = (ref: RefObject<HTMLDivElement | null>): { width: number; height: number } => {
  const [aspect, setAspect] = useState(DEFAULT_ASPECT)
  useEffect(() => {
    const measure = (): void => {
      const box = ref.current?.getBoundingClientRect()
      // jsdom reports zeros, and so does a pane that has not been laid out yet.
      // Both mean "no measurement", not "a pane of no size".
      if (box === undefined || box.width < 1 || box.height < 1) return
      const next = Math.round(Math.min(4, Math.max(0.8, box.width / box.height)) * 10) / 10
      setAspect((current) => (current === next ? current : next))
    }
    measure()
    /*
     * A ResizeObserver, not just a window `resize` listener.
     *
     * Measuring once in an effect catches whatever the pane happened to be at
     * that instant, and in the browser that instant is before the layout has
     * settled: the first reading came back square for a pane that ends up
     * 1.11:1, which quantised to a square canvas and letterboxed a tenth of the
     * width away for the rest of the session. The observer fires again when the
     * pane reaches its real size, and covers the cases a window resize does not
     * — a font loading, the analysis banner appearing, a devtools split.
     */
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null
    if (observer !== null && ref.current !== null) observer.observe(ref.current)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return {
    width: Math.round(Math.sqrt(CANVAS_AREA * aspect)),
    height: Math.round(Math.sqrt(CANVAS_AREA / aspect)),
  }
}

/**
 * One card's art, as the wire sends it and this view reads it.
 *
 * Named rather than written out at each of its four use sites because it grew a
 * third member: `back` is the other PHYSICAL face of a double-faced card
 * (ADR-0027), and its ABSENCE — not a pair of nulls inside it — is what means
 * "this card has one face". The details popover draws through `CardFace`, which
 * offers a flip control exactly when the key is present, so dropping it here
 * would make a transform card in the deck web the one place in the app that
 * denies having another side.
 */
type WebImages = {
  artCrop: string | null
  normal: string | null
  back?: WebImages
}

export interface DeckWebProps {
  readonly deckId: string
  readonly deckName: string
  /** Oracle ids in the order the deck rail lists them. Doc 17 §17.6. */
  readonly order: readonly string[]
  readonly accepted: readonly string[]
  readonly commanders: readonly string[]
  readonly cards: ReadonlyMap<string, DeckWebCard>
  readonly combos: readonly { comboId: string; pieces: string[]; produces: string[] }[]
  /** Art, beside the cards and never on them (ADR-0021). */
  readonly images: ReadonlyMap<string, WebImages>
  readonly onLeave: () => void
}

export interface DeckWebCard {
  readonly oracleId: string
  readonly name: string
  readonly manaCost: string | null
  readonly manaValue: number
  readonly typeLine: string
  readonly oracleText: string
  readonly oracleTextFaces?: string[] | undefined
  readonly colorIdentity: string[]
  readonly primaryRole: string
  readonly synergyProduces: string[]
  readonly synergyWants: string[]
}

const IDENTITY = new Set(['W', 'U', 'B', 'R', 'G'])

const toView = (card: DeckWebCard, images: WebImages | undefined): CardView => ({
  oracleId: card.oracleId,
  name: card.name,
  manaCost: card.manaCost,
  manaValue: card.manaValue,
  colorIdentity: card.colorIdentity.filter((c): c is 'W' | 'U' | 'B' | 'R' | 'G' =>
    IDENTITY.has(c),
  ),
  typeLine: card.typeLine,
  oracleText: card.oracleText,
  oracleTextFaces: card.oracleTextFaces,
  primaryRole: card.primaryRole,
  // Null-to-undefined, not cosmetic: `<img src={null}>` resolves against the
  // page URL and draws a broken image exactly where the no-art fallback was
  // meant to draw a name. Same conversion the workspace does.
  imageUris:
    images === undefined || (images.artCrop === null && images.normal === null)
      ? undefined
      : {
          ...(images.artCrop === null ? {} : { artCrop: images.artCrop }),
          ...(images.normal === null ? {} : { normal: images.normal }),
        },
  // The KEY carries the claim and the URLs only its content, so a present
  // `back` becomes a present object even with nothing usable in it — that is
  // "two faces, no picture", which is a different answer from "one face" and
  // the one the flip control has to be able to read (ADR-0027).
  backImageUris:
    images?.back === undefined
      ? undefined
      : {
          ...(images.back.artCrop === null ? {} : { artCrop: images.back.artCrop }),
          ...(images.back.normal === null ? {} : { normal: images.back.normal }),
        },
})

const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

const KIND_WORDS: Readonly<Record<WebEdge['kind'], string>> = {
  combo: 'Combo',
  benefits: 'Benefits',
}

/**
 * What the caller asked for, as a string — the model's dependency.
 *
 * The three list props arrive as `.map`, `.filter` and `?? []` results, so they
 * are new arrays holding the same ids on every render of the component above.
 * Keyed on identity, the model was rebuilt and the 300-tick simulation re-run
 * whenever anything at all moved in the workspace behind the graph, and the
 * settle animation went back to frame 0 with it. Measured in Chrome on the real
 * 99-card deck, eight seconds of unrelated re-renders gave 31 restarts of an
 * animation that takes 0.7 s and 515 replayed frames where 39 were wanted.
 *
 * `App` no longer churns them (see `deckWebAccepted` there), which is the fix
 * for the cost; this is what makes the promise the component's own rather than
 * a convention every future caller has to know about. Joining a hundred short
 * strings is microseconds against the 15 ms simulation it guards.
 *
 * A ref holding the replay across renders was the other candidate and is worse:
 * it would leave the model and the layout still recomputing, which is the
 * expensive half, and would only hide the flicker they cause.
 *
 * `cards` is deliberately absent. It is a hydration map whose identity changes
 * only when its contents do, so it stays a dependency in its own right —
 * hashing every card's name and tags on every render would be real work bought
 * with nothing.
 *
 * The lists are separated rather than concatenated so that moving an id from
 * one of them to another is a different key: the whole point is to notice a
 * real change, and `[a] + [b]` and `[a, b] + []` are the same deck only if you
 * do not look at which list they are in.
 */
const deckContentKey = (input: {
  readonly order: readonly string[]
  readonly accepted: readonly string[]
  readonly commanders: readonly string[]
  readonly combos: readonly { comboId: string; pieces: string[] }[]
}): string =>
  [
    input.order.join(','),
    input.accepted.join(','),
    input.commanders.join(','),
    input.combos.map((c) => [c.comboId, ...c.pieces].join('+')).join(','),
  ].join('|')

export const DeckWeb = ({
  deckId,
  deckName,
  order,
  accepted,
  commanders,
  cards,
  combos,
  images,
  onLeave,
}: DeckWebProps): JSX.Element => {
  const reduced = useReducedMotion()
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [focused, setFocused] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null)
  /*
   * Doc 08's mobile answer for this view, and doc 17 §17.11 asked for one
   * rather than a guess. A hundred 64 px nodes on a 375 px screen is a hairball
   * at 20% zoom, so a narrow viewport opens on the TABLE — the same data, in
   * the one form that survives the width. The graph is still there and still
   * pannable; it just is not what the reader is handed first.
   */
  const [showTable, setShowTable] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const [announcement, setAnnouncement] = useState('')
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvas = useCanvas(frameRef)

  // Rebuilt when the DECK changes, not when the props do. See `deckContentKey`.
  const deckKey = deckContentKey({ order, accepted, commanders, combos })
  const model = useMemo(
    () => buildDeckWeb({ order, accepted, commanders, cards, combos }),
    // The lists are read through the key, which is why they are not listed
    // here — with them, the memo would be exactly the identity check the key
    // exists to replace.
    [deckKey, cards],
  )

  /**
   * The settled layout, and the frames that get there.
   *
   * Frames are only recorded when motion is allowed. Under
   * `prefers-reduced-motion` the converged positions are painted directly —
   * doc 17 §17.5: the graph is the point, watching it wobble is not — and
   * recording 40 snapshots nobody will look at would be pure cost.
   *
   * The canvas is a DEPENDENCY and not just a value read inside. It was only
   * read, and the effect of that was a graph fitted to a canvas nobody draws:
   * `useCanvas` starts at the placeholder 3:2 aspect and the `ResizeObserver`
   * reports the pane's real proportions a frame later, so the layout kept the
   * placeholder's 2574 × 1716 while the viewBox became the pane's 3257 × 1357.
   * Measured in Chrome on the real 99-card deck, that drew 8 of 99 nodes below
   * the bottom edge of the drawing and left a third of its width empty. The
   * aspect is quantised to a tenth precisely so this can be a dependency
   * without a window drag re-running the simulation every frame — see
   * `useCanvas`.
   */
  const settled = useMemo(
    () =>
      layout(
        model.nodes.map((n) => ({ oracleId: n.oracleId, commander: n.commander })),
        model.edges,
        {
          seed: deckId,
          width: canvas.width,
          height: canvas.height,
          ...(reduced ? {} : { frames: 40 }),
        },
      ),
    [model, deckId, reduced, canvas.width, canvas.height],
  )

  /*
   * Replay of the recorded settle, then stop. Never a live simulation: doc 17
   * §17.5 forbids a permanently drifting canvas, and a replay cannot drift
   * because it runs out of frames.
   */
  const [frame, setFrame] = useState<number | null>(null)
  useEffect(() => {
    if (reduced || settled.frames.length === 0) {
      setFrame(null)
      return
    }
    let raf = 0
    let index = 0
    setFrame(0)
    const step = (): void => {
      index += 1
      if (index >= settled.frames.length) {
        setFrame(null)
        return
      }
      setFrame(index)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      setFrame(null)
    }
  }, [settled, reduced])

  const positions = useMemo(() => {
    if (frame === null) return settled.positions
    const values = settled.frames[frame]
    if (values === undefined) return settled.positions
    const map = new Map<string, { x: number; y: number }>()
    model.nodes.forEach((node, i) => {
      map.set(node.oracleId, { x: values[i * 2] ?? 0, y: values[i * 2 + 1] ?? 0 })
    })
    return map
  }, [frame, settled, model.nodes])

  const focusedEdges = useMemo(
    () => (focused === null ? [] : edgesAt(model.edges, focused)),
    [model.edges, focused],
  )
  const selectedEdge = edgeIndex === null ? null : (focusedEdges[edgeIndex] ?? null)

  const focusNode = useCallback((oracleId: string): void => {
    setFocused(oracleId)
    setEdgeIndex(null)
    // The DOM node, not a ref map: `Tab` order is DOM order here (nodes are
    // rendered in deck order), so moving focus means moving the browser's own
    // focus rather than tracking a parallel one.
    const element = document.getElementById(`web-node-${oracleId}`)
    element?.focus()
  }, [])

  const reset = useCallback((): void => {
    setView({ x: 0, y: 0, scale: 1 })
    setAnnouncement('View reset.')
  }, [])

  /**
   * The zoom with no cursor behind it: the buttons and `+`/`−`.
   *
   * Anchored at the middle of the drawing. The middle is the only point a
   * keypress can be said to be about — anchoring it at the last known mouse
   * position was considered and rejected, because it makes a keyboard zoom
   * lurch towards wherever the pointer happens to be resting, which is a place
   * the reader is by definition not looking. `preserveAspectRatio` centres the
   * whole viewBox in the pane, so the middle of the canvas is the middle of
   * what is on screen without measuring anything.
   */
  const zoomFromCentre = useCallback(
    (factor: number): void => {
      setView((v) => zoomBy(v, factor, { x: canvas.width / 2, y: canvas.height / 2 }))
    },
    [canvas.width, canvas.height],
  )

  /**
   * Where a client point falls on the canvas, and how far a client drag moves
   * it.
   *
   * Both go through the SVG's own box rather than the window: the graph sits
   * inside a padded section and the viewBox is thousands of units wide inside a
   * pane of a few hundred pixels, so `clientX` is neither an offset into the
   * drawing nor a count of canvas units. See `view.ts`.
   */
  const onCanvas = (element: SVGSVGElement, client: Point): Point =>
    canvasPoint(client, element.getBoundingClientRect(), canvas)

  const describe = (oracleId: string): string => {
    const node = model.nodes.find((n) => n.oracleId === oracleId)
    const count = edgesAt(model.edges, oracleId).length
    return `${node?.name ?? oracleId}: ${String(count)} connection${count === 1 ? '' : 's'}.`
  }

  /*
   * Every pointer action in §17.6's table, with its keyboard equal beside it.
   * AGENTS.md R4 makes that binding, and a graph is the easiest place to break
   * it — so the two are written next to each other rather than in two files.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowLeft':
        setView((v) => ({ ...v, x: v.x + PAN_STEP }))
        break
      case 'ArrowRight':
        setView((v) => ({ ...v, x: v.x - PAN_STEP }))
        break
      case 'ArrowUp':
        setView((v) => ({ ...v, y: v.y + PAN_STEP }))
        break
      case 'ArrowDown':
        setView((v) => ({ ...v, y: v.y - PAN_STEP }))
        break
      case '+':
      case '=':
        zoomFromCentre(1.25)
        break
      case '-':
        zoomFromCentre(0.8)
        break
      case '0':
        reset()
        break
      case '[':
      case ']': {
        if (focused === null || focusedEdges.length === 0) return
        const step = event.key === ']' ? 1 : -1
        const next =
          edgeIndex === null
            ? event.key === ']'
              ? 0
              : focusedEdges.length - 1
            : (edgeIndex + step + focusedEdges.length) % focusedEdges.length
        setEdgeIndex(next)
        const edge = focusedEdges[next]
        if (edge !== undefined) {
          setAnnouncement(
            `Connection ${String(next + 1)} of ${String(focusedEdges.length)}. ${edge.why}`,
          )
        }
        break
      }
      // Space as well as Enter: a node claims `role="button"`, and a button
      // that ignores Space is a broken button to anyone who knows the
      // convention. `preventDefault` below is what stops it scrolling the page.
      case ' ':
      case 'Enter': {
        if (focused === null) return
        if (selectedEdge === null) {
          // No edge picked yet: Enter is "tell me about this card", which is
          // what hover does with a pointer.
          setAnnouncement(describe(focused))
          return
        }
        const far = otherEnd(selectedEdge, focused)
        focusNode(far)
        setAnnouncement(`Moved to ${cards.get(far)?.name ?? far}.`)
        break
      }
      default:
        return
    }
    event.preventDefault()
  }

  // --- pointer pan and pinch, one code path for mouse and touch -----------
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  /** `at` is the last midpoint, on the canvas — see `onPointerMove`. */
  const pinch = useRef<{ distance: number; scale: number; at: Point } | null>(null)
  const dragging = useRef<{ x: number; y: number; view: { x: number; y: number } } | null>(null)

  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      if (a !== undefined && b !== undefined) {
        pinch.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: view.scale,
          at: onCanvas(event.currentTarget, midpoint(a, b)),
        }
      }
      dragging.current = null
      return
    }
    dragging.current = { x: event.clientX, y: event.clientY, view: { x: view.x, y: view.y } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = pinch.current
    if (pointers.current.size >= 2 && gesture !== null) {
      const [a, b] = [...pointers.current.values()]
      if (a === undefined || b === undefined) return
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const ratio = distance / Math.max(1, gesture.distance)
      /*
       * The scale comes from the gap between the fingers and the position from
       * where that gap sits, so two fingers moving together pan and two fingers
       * spreading zoom about the point between them. Scaling alone — which is
       * what this did — grew the graph out of the canvas corner while the
       * fingers were somewhere else entirely, and made a two-finger drag do
       * nothing at all.
       */
      const at = onCanvas(event.currentTarget, midpoint(a, b))
      setView((v) => pinchTo(v, gesture.scale * ratio, gesture.at, at))
      pinch.current = { ...gesture, at }
      return
    }
    const drag = dragging.current
    if (drag === null) return
    // The travel in CANVAS units, not client pixels. Adding pixels to a
    // translate measured in canvas units made the graph lag the cursor by
    // whatever the viewBox happened to be scaled by — measured at 1.30 on a
    // 2510 px pane, so the graph covered 77% of the distance the mouse did,
    // and worse on a narrower pane where the canvas is scaled down further.
    const moved = canvasVector(
      { x: event.clientX - drag.x, y: event.clientY - drag.y },
      event.currentTarget.getBoundingClientRect(),
      canvas,
    )
    setView((v) => ({ ...v, x: drag.view.x + moved.x, y: drag.view.y + moved.y }))
  }

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) dragging.current = null
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    // Anchored at the cursor: the card under the pointer is the one the reader
    // is asking to see more of, and it is the only fixed point that does not
    // require them to chase the graph back after every notch.
    const at = onCanvas(event.currentTarget, { x: event.clientX, y: event.clientY })
    setView((v) => zoomBy(v, event.deltaY < 0 ? 1.1 : 0.9, at))
  }

  useEffect(() => {
    // Focus lands in the graph on entry so the arrow keys work without a hunt
    // for the right element. `tabIndex={-1}` keeps it out of the tab ORDER, so
    // Tab still walks the nodes and nothing else.
    frameRef.current?.focus()
  }, [])

  const dimmed = focused !== null

  // "graph" in the label, matching the masthead control that opens this. The
  // class, the module and the `#web` route keep their names — this string is
  // what the user is told the thing is called, and that has to be one word.
  return (
    <section className="deck-web" aria-label={`Deck graph for ${deckName}`}>
      <div className="web-bar">
        <button className="act" onClick={onLeave}>
          Back to the list
        </button>

        {/* Doc 17 §17.3: colour is never the only encoding. The legend names
            each kind, and every kind also differs in line form. */}
        <ul className="web-legend">
          <li>
            <svg width="34" height="10" aria-hidden="true">
              <line className="web-edge" data-kind="combo" x1="1" y1="5" x2="33" y2="5" />
            </svg>
            Combo — both are pieces of the same complete combo
          </li>
          <li>
            <svg width="34" height="10" aria-hidden="true">
              <line
                className="web-edge"
                data-kind="benefits"
                x1="1"
                y1="5"
                x2="27"
                y2="5"
                markerEnd="url(#web-arrow)"
              />
            </svg>
            Benefits — the arrow points at the card that gains
          </li>
        </ul>

        <span className="meta web-count">
          {model.totalEdges > model.edges.length
            ? `Showing ${String(model.edges.length)} of ${String(model.totalEdges)} connections`
            : `${String(model.edges.length)} connections`}
          {' · '}
          {String(model.nodes.length)} cards
          {model.isolated.length > 0
            ? ` · ${String(model.isolated.length)} connected to nothing`
            : ''}
        </span>

        <button className="act" onClick={() => zoomFromCentre(0.8)} aria-label="Zoom out">
          −
        </button>
        <button className="act" onClick={() => zoomFromCentre(1.25)} aria-label="Zoom in">
          +
        </button>
        <button className="act" onClick={reset}>
          Reset view
        </button>
        <button className="act" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
          Table view
        </button>
      </div>

      <p className="note web-help">
        Tab walks the cards in deck order. <kbd>[</kbd> and <kbd>]</kbd> step through the focused
        card&rsquo;s connections, <kbd>Enter</kbd> follows one. Arrow keys pan, <kbd>+</kbd>/
        <kbd>−</kbd> zoom, <kbd>0</kbd> resets.
      </p>

      <div
        className="web-frame"
        ref={frameRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-settled={settled.converged}
      >
        <svg
          className="web-svg"
          viewBox={`0 0 ${String(canvas.width)} ${String(canvas.height)}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          aria-hidden={showTable}
        >
          <defs>
            <marker
              id="web-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="web-arrowhead" d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>

          <g
            transform={`translate(${String(view.x)} ${String(view.y)}) scale(${String(view.scale)})`}
          >
            <g className="web-edges">
              {model.edges.map((edge) => {
                const a = positions.get(edge.from)
                const b = positions.get(edge.to)
                if (a === undefined || b === undefined) return null
                const touchesFocus =
                  focused !== null && (edge.from === focused || edge.to === focused)
                return (
                  <line
                    key={`${edge.kind}-${edge.from}-${edge.to}`}
                    className="web-edge"
                    data-kind={edge.kind}
                    data-dim={dimmed && !touchesFocus}
                    data-selected={selectedEdge === edge}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeWidth={strokeWidth(edge)}
                    {...(edge.kind === 'benefits' ? { markerEnd: 'url(#web-arrow)' } : {})}
                    {...(edge.kind === 'benefits' && edge.mutual
                      ? { markerStart: 'url(#web-arrow)' }
                      : {})}
                  >
                    <title>{edge.why}</title>
                  </line>
                )
              })}
            </g>

            {/* Nodes are emitted in DECK order, so the browser's own tab order
                is deck order and §17.6 needs no roving-tabindex machinery. */}
            <g className="web-nodes">
              {model.nodes.map((node) => (
                <Node
                  key={node.oracleId}
                  node={node}
                  at={positions.get(node.oracleId) ?? { x: 0, y: 0 }}
                  card={cards.get(node.oracleId)}
                  images={images.get(node.oracleId)}
                  focused={focused === node.oracleId}
                  // Out of the tab order while the table is showing the same
                  // data. The drawing is `aria-hidden` then, and focusable
                  // controls inside an aria-hidden subtree are how a keyboard
                  // user ends up on something a screen reader will not announce.
                  reachable={!showTable}
                  dim={dimmed && focused !== node.oracleId && !touches(focusedEdges, node.oracleId)}
                  onFocus={() => {
                    setFocused(node.oracleId)
                    setEdgeIndex(null)
                  }}
                  onHover={setHovered}
                />
              ))}
            </g>
          </g>
        </svg>

        <p className="web-live" role="status" aria-live="polite">
          {announcement}
        </p>

        <Details
          card={cards.get(focused ?? hovered ?? '')}
          images={images.get(focused ?? hovered ?? '')}
          node={model.nodes.find((n) => n.oracleId === (focused ?? hovered))}
          edges={focused === null ? [] : focusedEdges}
        />
      </div>

      {showTable ? <EdgeTable edges={model.edges} cards={cards} model={model} /> : null}
    </section>
  )
}

const touches = (edges: readonly WebEdge[], oracleId: string): boolean =>
  edges.some((e) => e.from === oracleId || e.to === oracleId)

const Node = ({
  node,
  at,
  card,
  images,
  focused,
  reachable,
  dim,
  onFocus,
  onHover,
}: {
  node: WebNode
  at: { x: number; y: number }
  card: DeckWebCard | undefined
  images: WebImages | undefined
  focused: boolean
  reachable: boolean
  dim: boolean
  onFocus: () => void
  onHover: (oracleId: string | null) => void
}): JSX.Element => {
  const art = card === undefined ? null : imageFor(toView(card, images), 1)
  const w = node.commander ? NODE_W * 1.3 : NODE_W
  const h = node.commander ? NODE_H * 1.3 : NODE_H
  const label =
    `${node.name}${node.copies > 1 ? `, ${String(node.copies)} copies` : ''}` +
    `${node.commander ? ', commander' : ''}`

  return (
    <g
      id={`web-node-${node.oracleId}`}
      className="web-node"
      data-commander={node.commander}
      data-focused={focused}
      data-dim={dim}
      data-noart={art === null}
      transform={`translate(${String(at.x - w / 2)} ${String(at.y - h / 2)})`}
      tabIndex={reachable ? 0 : -1}
      role="button"
      aria-label={label}
      onFocus={onFocus}
      onClick={onFocus}
      onMouseEnter={() => onHover(node.oracleId)}
      onMouseLeave={() => onHover(null)}
    >
      <title>{label}</title>
      {art === null ? (
        /*
         * The answer to doc 17 §17.10 question 2.
         *
         * A node whose printing has no resolved art. The worry in the scope
         * note was that a text tile among ninety-nine pictures would be the
         * ONLY readable node and would therefore read as emphasis.
         *
         * When that note was written the path was common — 501 cards had no
         * art, giving a 100-card deck roughly a 78% chance of hitting it. It is
         * now rare rather than gone: the 501 were a mapper defect on
         * double-faced layouts and coverage is 34,492 of 34,492 (doc 17 §17.2),
         * but an unresolved printing is still something the API can send and
         * the answer below is what keeps it from looking like a mistake. It is answered by levelling the others up rather
         * than this one down: every node carries its name in `aria-label`, in a
         * `<title>`, and in the details panel on hover or focus, so the arted
         * cards are labelled too and this one is not the exception. Drawn in
         * the same box, on a plain raised surface, with no accent of its own.
         */
        <>
          <rect className="web-noart" width={w} height={h} rx={2} />
          <text className="web-noart-name" x={w / 2} y={h / 2} textAnchor="middle">
            {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
          </text>
        </>
      ) : (
        /*
         * `loading="lazy"` and `decoding="async"` are absent here and present
         * everywhere else art is drawn (ADR-0021). SVG's `<image>` carries
         * neither attribute, and there is nothing to defer: the whole graph is
         * inside the viewBox on entry, so every node is on screen and a lazy
         * image would load immediately anyway.
         */
        <image href={art} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
      )}
      <rect className="web-frame-line" width={w} height={h} rx={2} fill="none" />
      {node.copies > 1 ? (
        <text className="web-copies" x={w - 3} y={h - 3} textAnchor="end">
          ×{node.copies}
        </text>
      ) : null}
      {node.commander ? (
        <text className="web-commander-name" x={w / 2} y={h + 10} textAnchor="middle">
          {node.name}
        </text>
      ) : null}
    </g>
  )
}

/**
 * What the focused or hovered card is, and what it is connected to.
 *
 * `CardFace` rather than a second card renderer: it already draws the art, the
 * badges and the no-art fallback, and all three are tested there.
 */
const Details = ({
  card,
  images,
  node,
  edges,
}: {
  card: DeckWebCard | undefined
  images: WebImages | undefined
  node: WebNode | undefined
  edges: readonly WebEdge[]
}): JSX.Element | null => {
  if (card === undefined || node === undefined) return null
  return (
    <aside className="web-details" aria-label="Card details">
      <CardFace card={toView(card, images)} width={150} />
      <p className="note">
        {node.commander ? 'Commander · ' : ''}
        {edges.length === 0
          ? 'Nothing in the deck connects to this card.'
          : `${String(edges.length)} connection${edges.length === 1 ? '' : 's'}`}
      </p>
      <ul className="web-details-edges">
        {edges.slice(0, 8).map((edge) => (
          <li key={`${edge.from}-${edge.to}-${edge.kind}`}>{edge.why}</li>
        ))}
      </ul>
    </aside>
  )
}

/**
 * The same data as a table (doc 17 §17.7).
 *
 * Not an accessibility box-tick. It is the only view that can be searched with
 * the browser's own find, copied into a text box, and read aloud in order — and
 * the graph is a summary of it rather than the other way round.
 */
const EdgeTable = ({
  edges,
  cards,
  model,
}: {
  edges: readonly WebEdge[]
  cards: ReadonlyMap<string, DeckWebCard>
  model: { totalEdges: number; isolated: readonly string[] }
}): JSX.Element => (
  <div className="web-table">
    <table>
      <caption>
        Every connection the graph draws
        {model.totalEdges > edges.length
          ? ` — ${String(edges.length)} of ${String(model.totalEdges)}, the rest below the drawing limit`
          : ''}
      </caption>
      <thead>
        <tr>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">Kind</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        {edges.map((edge) => (
          <tr key={`${edge.kind}-${edge.from}-${edge.to}`}>
            <td>{cards.get(edge.from)?.name ?? edge.from}</td>
            <td>{cards.get(edge.to)?.name ?? edge.to}</td>
            <td>{KIND_WORDS[edge.kind]}</td>
            <td>{edge.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {model.isolated.length > 0 ? (
      <p className="note">
        {model.isolated.length} card{model.isolated.length === 1 ? '' : 's'} are connected to
        nothing: {model.isolated.map((id) => cards.get(id)?.name ?? id).join(', ')}
      </p>
    ) : null}
  </div>
)
