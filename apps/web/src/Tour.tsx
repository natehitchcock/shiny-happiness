import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { placeHint } from './Hint'

/**
 * The quick tutorial (doc 20).
 *
 * Seven steps that name each region of the workspace and say what it is FOR,
 * plus the Graph and Quickbuild buttons. It fires once, immediately after the
 * first commander is chosen (§20.1), and the Help button in the masthead runs
 * the same one on demand (D5) — one implementation rather than a tour and a
 * help page that drift apart.
 *
 * ---------------------------------------------------------------------------
 * IT HIGHLIGHTS; IT DOES NOT DRIVE (D1).
 *
 * No step adds a card, opens Quickbuild or changes the deck. A tutorial that
 * acts on your behalf leaves you holding a deck you did not choose, and this
 * product's whole claim is that every addition carries a reason you agreed
 * with. The visible consequence is below: with no card open there is no detail
 * panel, and step 5 is SKIPPED rather than opening one to have something to
 * point at.
 *
 * ---------------------------------------------------------------------------
 * THE OVERLAY LIVES IN THE TOP LAYER, for the reason `Hint` does.
 *
 * The spotlight has to sit over `.region`, which carries `container-type:
 * inline-size`. That establishes a containing block for fixed-position
 * descendants, so `position: fixed` ALONE does not escape it, and no `z-index`
 * escapes an `overflow: auto` ancestor either — clipping is not stacking. A
 * spotlight clipped at a pane's edge is worse than no spotlight, because it
 * points confidently at the wrong thing.
 *
 * So the layer is a native `popover`, promoted at runtime exactly as `Hint`
 * does it: the attribute is set by the code that can immediately call
 * `showPopover()`, never in the JSX, because `[popover]` in an environment
 * without the API is `display: none` forever. Everything else falls back to a
 * correctly placed `position: fixed` box.
 *
 * `placeHint` is reused rather than reimplemented. It is the app's one answer to
 * "put this box near that box, flipping and clamping so it stays on screen",
 * and a second one would drift.
 *
 * ---------------------------------------------------------------------------
 * ANCHORS ARE SEMANTIC (D3), AND A MISSING ONE IS SKIPPED.
 *
 * The layout genuinely moves — four columns above 1320px, three normally, one
 * below 900px — so a step pinned to a coordinate or an `nth-child` would
 * describe a layout the reader is not looking at. Every anchor here is a
 * landmark's `aria-label` or a named control.
 *
 * Two of the seven are conditional: a suggestion row's reasons do not exist
 * until the feed has loaded, and the card detail surface does not exist until a
 * card is open. `seek` steps over whichever is absent AT THE MOMENT YOU TRAVEL,
 * which is why resolution happens per step rather than once at open — the feed
 * commonly lands while the reader is still on step 1, and a list fixed at open
 * would have dropped step 3 for good.
 *
 * The DENOMINATOR STAYS SEVEN. §20.6 writes the announcement as "Step 3 of 7",
 * and the count is the tour's shape rather than a running total: renumbering
 * under the reader so that the same step is "3 of 6" on an empty deck and "3 of
 * 7" on a full one makes the number mean nothing. A skipped step shows as a gap
 * in the sequence, which is honest — see ADR-0033.
 */

export type TourExit = 'skipped' | 'finished' | 'escaped'

export interface TourStep {
  readonly id: string
  /** A CSS selector for a landmark or a named control. Never positional (D3). */
  readonly anchor: string
  /** Names the region in words, so the highlight is never the only signal. */
  readonly title: string
  readonly body: string
}

/**
 * The seven, in §20.2's order.
 *
 * Steps 6 and 7 are last on purpose: they are alternative ways to work, and
 * they only make sense once the default way has been named.
 *
 * Graph and Quickbuild carry a `data-tour` hook rather than being matched on
 * their label. There is no CSS selector for an accessible name, and the honest
 * alternatives were both worse: `header .act:nth-child(7)` is the positional
 * anchor D3 forbids by name, and matching on text would break the moment the
 * button is relabelled — which has already happened once to Graph, which used
 * to be called Web.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'deck',
    anchor: 'section[aria-label="Deck"]',
    title: 'Your deck, grouped by job',
    body: 'Everything you have accepted, gathered by the job each card does — ramp, removal, draw. The count beside each group is the deck telling you what it still needs.',
  },
  {
    id: 'suggestions',
    anchor: 'section[aria-label="Suggestions"]',
    title: 'What to add next',
    body: 'The suggestion feed. It is grouped by why a card is being offered, not by what it costs, so the headings are the deck’s open questions.',
  },
  {
    id: 'reasons',
    anchor: 'section[aria-label="Suggestions"] .card-row .reasons',
    title: 'The reasons on a row',
    body: 'The reasons are the product. A card is here because of these — it completes a combo, it fills a gap you are short of — never because it is generically “good”.',
  },
  {
    id: 'analysis',
    anchor: 'section[aria-label="Analysis"]',
    title: 'The scoreboard',
    body: 'Composition, curve, combos and bracket. These are the meters every suggestion is trying to move, and they stay visible while you decide.',
  },
  {
    id: 'detail',
    anchor: '.preview',
    title: 'One card, in full',
    body: 'Opening a card brings up its full rules — both faces, if it has two — along with what it would do to this deck and what it costs.',
  },
  {
    id: 'graph',
    anchor: '[data-tour="graph"]',
    title: 'The deck as a web',
    body: 'The Graph button redraws the same deck as a web of connections, for when the lists stop showing you its shape.',
  },
  {
    id: 'quickbuild',
    anchor: '[data-tour="quickbuild"]',
    title: 'One decision at a time',
    body: 'The Quickbuild button takes your biggest gap and offers three cards for it. One question, three answers, as many times as you like.',
  },
]

/**
 * What the tour says when there is no workspace behind it (D5).
 *
 * The landing page is a commander picker: the deck rail, the feed and the
 * analysis rail do not exist yet. A tour there could only ask the reader to
 * memorise a layout instead of recognising one, which §20.1 calls worse than no
 * tour. So Help from the landing page says what the app is and how to start,
 * and defers the region steps until there is a workspace to point at.
 */
export const LANDING_STEP: TourStep = {
  id: 'landing',
  anchor: '',
  title: 'Pick a commander to begin',
  body: 'Lotus Wizard builds a Commander deck around the combos and synergies your commander already has. Choose one and the workspace opens — and this tour will run again over it, naming each part as you go.',
}

/**
 * The next step in the direction of travel whose anchor is on the page.
 *
 * `null` means there is none that way: forward, that finishes the tour;
 * backward, that is why Back is disabled on the first step. Exported and pure
 * because it is the whole of D3's skipping rule, and it is the part of this
 * component jsdom can genuinely exercise.
 */
export const seek = (
  from: number,
  direction: 1 | -1,
  present: (step: TourStep) => boolean,
): number | null => {
  for (let i = from + direction; i >= 0 && i < TOUR_STEPS.length; i += direction) {
    const step = TOUR_STEPS[i]
    if (step !== undefined && present(step)) return i
  }
  return null
}

/** How much of the page the spotlight leaves around its region, in px. */
const HALO = 6

/**
 * How long a glide is given to actually put the region on screen.
 *
 * Chrome's own smooth scroll settles well inside this for any distance. The
 * number is a deadline for the guarantee below, not a duration to match.
 */
const GLIDE_DEADLINE_MS = 700

/** Is any part of this box inside the viewport? */
const inViewport = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

export interface TourProps {
  readonly onExit: (reason: TourExit) => void
  /**
   * Overrides the media query. The tour is opened from a button, and a test
   * that had to install a `matchMedia` to say "no motion please" would be
   * testing jsdom rather than this.
   */
  readonly reducedMotion?: boolean
}

export const Tour = ({ onExit, reducedMotion }: TourProps): JSX.Element => {
  const layerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()

  /**
   * Is this step's anchor on the page — and actually showing?
   *
   * `querySelector` alone is not enough, and the case is a real one rather than
   * a hypothetical. Doc 17's Graph is a MODE: it hides `.workspace` with the
   * `hidden` attribute instead of unmounting it, deliberately, so that leaving
   * the graph does not re-run the whole pipeline. `querySelector` happily
   * matches inside a hidden subtree, so pressing Help from the graph reported
   * all five workspace anchors present, measured every one of them at 0×0, and
   * drew a 12×12 ring in the corner of a fully dimmed page.
   *
   * The `hidden` ATTRIBUTE specifically, not `offsetParent` or
   * `checkVisibility`: jsdom implements no layout, so every element there
   * reports itself invisible and a geometric test would make every anchor
   * absent and every step skipped. This tests the mechanism the app actually
   * uses to hide a region.
   */
  const present = useCallback((step: TourStep): boolean => {
    const el = document.querySelector(step.anchor)
    return el !== null && el.closest('[hidden]') === null
  }, [])

  /*
   * Landing mode is decided ONCE, at mount, and never revisited.
   *
   * Recomputing it per render would let the tour change what it is halfway
   * through — a deck created in another tab, or a late-arriving region, would
   * swap the how-to-start card for step 1 under the reader's hands. Where the
   * tour opened is a fact about the moment it opened.
   */
  const [landing] = useState(() => seek(-1, 1, present) === null)
  const [index, setIndex] = useState(() => seek(-1, 1, present) ?? 0)
  // Empty on the first render and filled by an effect: a live region only
  // announces text that CHANGES inside an already-present region, so one that
  // appears together with its message is routinely missed. Same reasoning as
  // the masthead's announcement in `App.tsx`.
  const [announcement, setAnnouncement] = useState('')

  const step = landing ? LANDING_STEP : (TOUR_STEPS[index] ?? TOUR_STEPS[0]!)
  const forward = landing ? null : seek(index, 1, present)
  const backward = landing ? null : seek(index, -1, present)

  const reduced =
    reducedMotion ??
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  /** Put the spotlight over the anchor and the card beside it. */
  const position = useCallback((): void => {
    const card = cardRef.current
    const spot = spotRef.current
    if (card === null || spot === null) return

    const el = step.anchor === '' ? null : document.querySelector(step.anchor)
    if (el === null) {
      // Nothing to point at, so nothing is dimmed and the card sits in the
      // middle. This is the landing step, and it is also what a step whose
      // anchor vanished mid-view degrades to rather than pointing at 0,0.
      spot.hidden = true
      card.style.left = ''
      card.style.top = ''
      card.dataset['placement'] = 'centre'
      return
    }

    const r = el.getBoundingClientRect()
    spot.hidden = false
    spot.style.left = `${r.left - HALO}px`
    spot.style.top = `${r.top - HALO}px`
    spot.style.width = `${r.width + HALO * 2}px`
    spot.style.height = `${r.height + HALO * 2}px`

    const box = card.getBoundingClientRect()
    const at = placeHint(
      { top: r.top - HALO, bottom: r.bottom + HALO, left: r.left - HALO, right: r.right + HALO },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    card.dataset['placement'] = at.side
    card.style.left = `${at.left}px`
    card.style.top = `${at.top}px`
  }, [step.anchor])

  // Mount: into the top layer, then focus.
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (layer === null) return
    /*
     * The attribute is set HERE and not in the JSX, and the two lines are
     * inseparable. `popover` is a promise, not a feature: the UA stylesheet
     * hides `[popover]` until something calls `showPopover()`, so declaring it
     * where the API is missing — an older browser, or jsdom — leaves the whole
     * tour permanently `display: none`. Only the code that can honour it
     * immediately is allowed to claim it.
     *
     * THE CLEANUP IS NOT TIDINESS. `showPopover()` on an element that is
     * already showing is specified to throw `InvalidStateError`, and React's
     * StrictMode runs every layout effect twice on mount in development —
     * setup, cleanup, setup — on the same DOM node. Measured in Chrome the
     * second call is a no-op rather than a throw, which is the only reason this
     * ever worked and is not something to rely on: the spec says otherwise and
     * another engine may follow it. Hiding it in the cleanup makes the second
     * setup a first setup again, which is what StrictMode is checking for.
     */
    if (typeof layer.showPopover === 'function') {
      layer.setAttribute('popover', 'manual')
      layer.showPopover()
    }
    // After the promotion, because a `display: none` element cannot take focus.
    // The card rather than the Next button: a screen reader landing on the
    // dialog reads its title and body, and landing on a button reads "Next".
    cardRef.current?.focus()
    return () => {
      if (typeof layer.hidePopover === 'function' && layer.hasAttribute('popover')) {
        layer.hidePopover()
        layer.removeAttribute('popover')
      }
    }
  }, [])

  /*
   * PLACE IT BEFORE THE BROWSER PAINTS, AND AFTER EVERY COMMIT.
   *
   * A layout effect with no dependency list, which is deliberate on both
   * counts.
   *
   * Before the paint, because `.tour-spot` carries its scrim as a 100vmax
   * spread shadow: until it has been given a box, that shadow is a
   * full-viewport dim around a zero-sized hole. Placing it from a passive
   * effect showed exactly that for one frame — the page went dark with nothing
   * lit. `Hint.tsx` documents this same trap and reaches for `useLayoutEffect`
   * for the same reason.
   *
   * After every commit, because the anchor's box moves for reasons that fire
   * neither `scroll` nor `resize`. §20.1 opens the tour on a freshly created
   * deck BEFORE the feed and the analysis have landed; when they arrive the
   * grid reflows and the deck rail grows, and the listener below never hears
   * about it. The tour re-renders whenever the workspace does, so re-measuring
   * on every commit covers it, and re-measuring is two rect reads.
   */
  useLayoutEffect(() => {
    position()
  })

  /*
   * A2: each step brings its own region into view before highlighting it.
   *
   * Below 900px the regions stack, so the region a step names is routinely a
   * screen or two away — a spotlight drawn on an off-screen box would dim the
   * page and point at nothing. `block: 'center'` rather than `'start'` so the
   * region does not hide under the sticky masthead.
   *
   * The `behavior` is the half of A2 that is a decision rather than geometry:
   * `prefers-reduced-motion` applies to this scroll exactly as it applies to
   * the highlight, so a reader who asked for no motion gets an instant jump.
   */
  useEffect(() => {
    setAnnouncement(
      landing
        ? step.title
        : `Step ${String(index + 1)} of ${String(TOUR_STEPS.length)}: ${step.title}`,
    )

    /*
     * CATCH FOCUS IF THE STEP CHANGE DROPPED IT.
     *
     * Back is `disabled` on the first step, and a browser blurs an element that
     * becomes disabled while it holds focus. So clicking Back onto step 1 —
     * with the pointer or with Enter — leaves focus on `<body>`, which is
     * OUTSIDE `.tour-layer`. That does not merely break the wrap: the Tab trap
     * is a handler on the layer, so a keydown from `<body>` never reaches it at
     * all and the next Tab walks off into the dimmed page behind. jsdom does
     * not blur on disable, which is why no test here saw it.
     *
     * Written as "if focus has left the card, bring it back" rather than
     * "focus the card on every step" on purpose: the ordinary case is the
     * reader standing on Next pressing it repeatedly, and moving focus under
     * them would break that.
     */
    const card = cardRef.current
    if (card !== null && !card.contains(document.activeElement)) card.focus()

    const el = step.anchor === '' ? null : document.querySelector(step.anchor)
    // Guarded because jsdom does not implement it, and an unguarded call would
    // make every test in this file a test of the stub.
    if (el === null || typeof el.scrollIntoView !== 'function') {
      position()
      return
    }

    const scroll = (behavior: ScrollBehavior): void =>
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior })

    /*
     * POSITION AFTER THE JUMP, NEVER BEFORE IT.
     *
     * An instant scroll moves the page synchronously, so measuring the anchor
     * first records where it USED to be and paints the ring there. The scroll
     * listener below would normally correct that on the next `scroll` event —
     * but a `scroll` event is delivered at a rendering opportunity, and the
     * conditions that suppress a smooth scroll suppress that too, so the
     * correction is precisely the thing that cannot be relied on. Observed
     * with the anchor-before-scroll ordering: the ring sat off screen while the
     * region it named was centred at scrollY 8,928. The code that caused the
     * scroll knows the scroll happened; it does not need to be told.
     */
    const jumpNow = (): void => {
      scroll('auto')
      position()
    }

    if (reduced) {
      jumpNow()
      return
    }

    scroll('smooth')
    // Placed where the region is right now; the scroll listener follows it
    // down as the glide runs.
    position()
    /*
     * THE GLIDE IS A NICETY; BEING ON SCREEN IS THE CONTRACT.
     *
     * A programmatic smooth scroll is the one kind that does not always
     * happen. Chrome drives it from the compositor, so it is suspended
     * whenever the document is not being presented, and it is CANCELLED
     * outright if the user touches the wheel or the trackpad while it runs —
     * which, on a tour that has just told someone to look at something, is not
     * a rare thing for them to do.
     *
     * When it does not arrive, the step dims the page and rings a region
     * thousands of pixels below the fold: the reader sees a darkened screen
     * with no spotlight anywhere on it. That is D3's "pointed at emptily"
     * reached from the other side, and it is worse than the case D3 names,
     * because nothing on screen even suggests what went wrong.
     *
     * So the glide is started and then CHECKED, and a region that is still off
     * screen when the deadline passes is jumped to. When the animation does
     * work the region is already in view and this does nothing at all.
     *
     * Observed while checking this in a browser, with the cause named because
     * it is not the ordinary one: in an occluded window
     * (`document.visibilityState === 'hidden'`) `'smooth'` moved `scrollY` by
     * zero pixels where `'auto'` moved it 9,504.
     */
    const deadline = setTimeout(() => {
      if (!inViewport(el)) jumpNow()
    }, GLIDE_DEADLINE_MS)
    return () => clearTimeout(deadline)
  }, [index, landing, reduced, step.anchor, step.title, position])

  /*
   * Follow the anchor while the page moves under it.
   *
   * A top-layer element has no relationship to the box it is pointing at, so a
   * smooth scroll would leave the spotlight where the region USED to be — and
   * the scroll this component starts is itself the commonest case. Capture,
   * because `scroll` does not bubble: a listener on `window` never hears
   * `.analysis-scroll` or the deck rail.
   */
  useEffect(() => {
    const onViewportChange = (): void => position()
    document.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)

    /*
     * AND WATCH THE ANCHOR ITSELF, because it moves without either event.
     *
     * §20.1 opens the tour on a freshly created deck, deliberately, before the
     * recommendation and analysis requests have returned. When they land the
     * grid reflows and the deck rail grows by thousands of pixels — no scroll,
     * no resize, and the ring stays on the rectangle the region used to
     * occupy. The layout effect above catches the cases React commits, and
     * this catches the rest: an image finishing, a font swapping, a container
     * query firing.
     *
     * `document.documentElement` as well as the anchor, because a step whose
     * anchor is a masthead button does not itself resize when the page below
     * it does, and the button's viewport position still changes.
     */
    const el = step.anchor === '' ? null : document.querySelector(step.anchor)
    // Guarded: jsdom only has one if a test installs it, and this must not be
    // the thing that decides whether the tour renders at all.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onViewportChange) : null
    if (observer !== null) {
      if (el !== null) observer.observe(el)
      observer.observe(document.documentElement)
    }

    return () => {
      document.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      observer?.disconnect()
    }
  }, [position, step.anchor])

  /*
   * Escape on `document`, so it closes from wherever focus has got to — §20.6
   * says "at any step", and a handler on the card alone would miss the moment
   * between the promotion and the focus landing.
   *
   * IN THE CAPTURE PHASE, AND CONSUMED. This app has several surfaces that
   * close themselves on a document-level Escape — the card preview, the target
   * sheet, a pinned hint — and `App.tsx` already states the convention in a
   * comment: "Consumed here so the innermost open thing is the one that
   * closes." Without this the tour is not the innermost thing, it is merely one
   * of several: step 5's anchor is `.preview`, which exists only while a card
   * is open, so Escape to leave the tour at step 5 would ALSO shut the card the
   * reader had open behind it.
   *
   * Capture on `document` runs before every bubble-phase listener on
   * `document`, which is where the preview registers its own, so stopping
   * propagation here is what makes the tour innermost.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onExit('escaped')
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onExit])

  const go = (direction: 1 | -1): void => {
    /*
     * `seek` is called HERE, not read from the render above.
     *
     * `forward` and `backward` are computed during render, which makes them a
     * snapshot of the DOM as it was when that render ran. D3, this file's own
     * docblock and ADR-0033 §1 all promise resolution "at the moment you
     * travel", and a step whose anchor appeared since the last commit — which
     * is precisely step 3, whose feed lands while the reader is on step 1 or 2
     * — would otherwise still be skipped. Reading the DOM in the handler costs
     * seven `querySelector` calls on a click.
     */
    const to = seek(index, direction, present)
    if (to === null) {
      if (direction === 1) onExit('finished')
      return
    }
    setIndex(to)
  }

  /**
   * Tab is trapped, because this IS a dialog (§20.6).
   *
   * The opposite of `OverflowMenu`, where Tab closes: a menu is a transient
   * popup you Tab past, a modal dialog is a place you are in until you leave it
   * deliberately. Letting Tab wander into the dimmed page behind would put
   * focus on controls the reader cannot see.
   */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const card = cardRef.current
    if (card === null) return
    const focusable = [...card.querySelectorAll<HTMLElement>('button:not([disabled])')]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === card)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="tour-layer" ref={layerRef} onKeyDown={onKeyDown}>
      {/* The dim and the hole are one element: a huge spread `box-shadow` fills
          the viewport around this box, so the "spotlight" is the absence of the
          scrim rather than a second element that has to be kept in register
          with it. `aria-hidden`, because the step's text already names the
          region — the highlight is never the only signal (§20.6). */}
      <div className="tour-spot" ref={spotRef} aria-hidden="true" />

      <div
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        ref={cardRef}
      >
        {landing ? null : (
          <p className="tour-progress">
            Step {index + 1} of {TOUR_STEPS.length}
          </p>
        )}
        <h2 id={titleId}>{step.title}</h2>
        <p id={bodyId}>{step.body}</p>

        <div className="tour-actions">
          <button className="act" onClick={() => go(-1)} disabled={backward === null}>
            Back
          </button>
          <button className="act" onClick={() => go(1)}>
            {forward === null ? 'Done' : 'Next'}
          </button>
          {/* D2: as prominent as Next, and on every step. Not a small × in a
              corner — a first-time user who wants to get on with it must never
              have to work at escaping. Same class as Next, which is what "same
              prominence" is made of here. */}
          <button className="act" onClick={() => onExit('skipped')}>
            Skip the tour
          </button>
        </div>

        <p className="sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  )
}
