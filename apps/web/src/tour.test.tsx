// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANDING_STEP, TOUR_STEPS, Tour, seek } from './Tour'

/**
 * The quick tutorial (doc 20).
 *
 * WHAT THIS FILE CANNOT DO, said once so nothing here pretends otherwise:
 * jsdom has no layout engine. Every rect is 0×0, nothing scrolls, and nothing
 * is ever clipped. So it cannot check that the spotlight lands ON the region it
 * names, that a narrow layout scrolls the region into view, or that the overlay
 * escapes `.region`'s `container-type`. Those were checked in a browser and are
 * recorded in doc 20 §20.8.
 *
 * What it CAN check is the part that is logic rather than geometry: which step
 * comes next when an anchor is missing, what the numbering says, what focus
 * does, what Escape does, and which `behavior` the scroll asks for. That last
 * one is the testable half of A2 — WHETHER it scrolls is the browser's business,
 * but the CHOICE between an instant jump and a glide is ours.
 */

/**
 * The workspace's landmarks, as the tour's selectors expect to find them.
 *
 * Every candidate anchor gets its OWN `scrollIntoView` spy rather than sharing
 * one on the prototype, so "the deck section was scrolled to" is a claim about
 * that element and not about any element.
 */
const workspace = (opts: { reasons?: boolean; detail?: boolean } = {}): void => {
  document.body.innerHTML = `
    <header class="masthead">
      <button data-tour="graph">Graph</button>
      <button data-tour="quickbuild">Quickbuild</button>
      <button data-tour="help">Help</button>
    </header>
    <div class="workspace">
      <section aria-label="Deck"><h2>Deck</h2></section>
      <section aria-label="Suggestions">
        ${opts.reasons === false ? '' : '<div class="card-row"><span class="reasons"><span class="reason">because</span></span></div>'}
      </section>
      <section aria-label="Analysis">
        ${opts.detail === false ? '' : '<aside class="preview">Card detail</aside>'}
      </section>
    </div>`
  for (const el of document.querySelectorAll('section, aside, button, .reasons')) {
    ;(el as HTMLElement).scrollIntoView = vi.fn()
  }
}

/** That element's own spy, typed. Fails loudly rather than silently passing. */
const scrollsOf = (selector: string): ReturnType<typeof vi.fn> => {
  const el = document.querySelector(selector)
  if (el === null) throw new Error(`fixture has no ${selector}`)
  return (el as HTMLElement).scrollIntoView as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  // jsdom implements neither, and the component calls both. Stubbing them here
  // rather than inside the component keeps the production path honest.
  Element.prototype.scrollIntoView = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const dialog = (): HTMLElement => screen.getByRole('dialog')
const next = (): HTMLElement => screen.getByRole('button', { name: /^(Next|Done)$/ })
const back = (): HTMLElement => screen.getByRole('button', { name: 'Back' })
const skip = (): HTMLElement => screen.getByRole('button', { name: 'Skip the tour' })
const status = (): HTMLElement => screen.getByRole('status')

const click = (el: HTMLElement): void => {
  act(() => {
    el.click()
  })
}

const press = (
  key: string,
  on: Element | Document = document.activeElement ?? document.body,
): void => {
  act(() => {
    fireEvent.keyDown(on, { key, bubbles: true })
  })
}

/* -------------------------------------------------------------- the steps */

describe('the seven steps (§20.2)', () => {
  it('is seven steps, and A3 ships all of them at once', () => {
    expect(TOUR_STEPS).toHaveLength(7)
  })

  it('anchors every step semantically, never to a position (D3)', () => {
    for (const step of TOUR_STEPS) {
      expect(step.anchor).not.toBe('')
      // The two things D3 forbids by name. `nth-child` and a bare coordinate
      // describe a layout that moves between four columns, three and one.
      expect(step.anchor).not.toMatch(/nth-child|nth-of-type/)
    }
    // The three landmarks, spelled as §20.2's table spells them.
    expect(TOUR_STEPS.map((s) => s.anchor)).toContain('section[aria-label="Deck"]')
    expect(TOUR_STEPS.map((s) => s.anchor)).toContain('section[aria-label="Suggestions"]')
    expect(TOUR_STEPS.map((s) => s.anchor)).toContain('section[aria-label="Analysis"]')
  })

  /*
   * §20.6: "the highlight is never the only signal — each step's text names the
   * region in words". A reader who cannot see the spotlight has the title and
   * nothing else, so the title has to be the region rather than "This bit".
   */
  it('names its region in words on every step, not only with the highlight', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(20)
    }
    expect(TOUR_STEPS[5]?.body).toMatch(/Graph/)
    expect(TOUR_STEPS[6]?.body).toMatch(/Quickbuild/)
  })
})

/* ------------------------------------------------- skipping absent anchors */

describe('seek: which step is next when one is not on the page (D3)', () => {
  const all = (): boolean => true
  const none = (): boolean => false

  it('starts at the first step when everything is present', () => {
    expect(seek(-1, 1, all)).toBe(0)
  })

  it('walks forward one at a time', () => {
    expect(seek(0, 1, all)).toBe(1)
    expect(seek(5, 1, all)).toBe(6)
  })

  it('returns null past the end, which is what finishes the tour', () => {
    expect(seek(6, 1, all)).toBeNull()
  })

  it('returns null before the start, so Back on the first step goes nowhere', () => {
    expect(seek(0, -1, all)).toBeNull()
  })

  /*
   * The rule D3 states: a step whose anchor does not exist is SKIPPED, not
   * pointed at emptily. On an empty workspace there is no open card detail, so
   * step 5 has nothing to point at and step 4 must lead to step 6.
   */
  it('steps over an absent anchor going forward', () => {
    const present = (s: (typeof TOUR_STEPS)[number]): boolean => s.id !== 'detail'
    expect(seek(3, 1, present)).toBe(5)
  })

  it('steps over an absent anchor going backward too', () => {
    const present = (s: (typeof TOUR_STEPS)[number]): boolean => s.id !== 'detail'
    expect(seek(5, -1, present)).toBe(3)
  })

  it('steps over a run of absent anchors rather than only one', () => {
    const present = (s: (typeof TOUR_STEPS)[number]): boolean =>
      s.id !== 'reasons' && s.id !== 'analysis' && s.id !== 'detail'
    expect(seek(1, 1, present)).toBe(5)
  })

  it('finds nothing at all when no anchor is on the page — the landing case', () => {
    expect(seek(-1, 1, none)).toBeNull()
  })
})

/* ------------------------------------------------------- running the tour */

describe('running the tour over a workspace', () => {
  // `() => workspace()`, not `workspace`: vitest hands `beforeEach` its
  // TestContext, which would arrive as the options object and quietly disable
  // every `=== false` check inside it.
  beforeEach(() => workspace())

  it('opens on step 1 as a labelled dialog', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(dialog()).toBeTruthy()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText(TOUR_STEPS[0]!.title)).toBeTruthy()
  })

  /*
   * §20.6: focus moves INTO the dialog. On the dialog itself rather than on
   * Next, so a screen reader reads the step's title and body on arrival — land
   * on the button and all it hears is "Next, button".
   */
  it('moves focus into the dialog on open', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(document.activeElement).toBe(dialog())
  })

  it('numbers each step against the canonical seven (§20.6)', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(screen.getByText('Step 1 of 7')).toBeTruthy()
    click(next())
    expect(screen.getByText('Step 2 of 7')).toBeTruthy()
  })

  it('walks forward and back through the steps', () => {
    render(<Tour onExit={vi.fn()} />)
    click(next())
    click(next())
    expect(screen.getByText(TOUR_STEPS[2]!.title)).toBeTruthy()
    click(back())
    expect(screen.getByText(TOUR_STEPS[1]!.title)).toBeTruthy()
  })

  it('has nowhere to go back to on the first step', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(back().hasAttribute('disabled')).toBe(true)
  })

  it('offers Done rather than Next on the last step, and finishing exits', () => {
    const onExit = vi.fn()
    render(<Tour onExit={onExit} />)
    for (let i = 0; i < 6; i += 1) click(next())
    expect(screen.getByText(TOUR_STEPS[6]!.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    click(screen.getByRole('button', { name: 'Done' }))
    expect(onExit).toHaveBeenCalledWith('finished')
  })

  /*
   * D3 again, but through the component rather than the helper: with no card
   * open there is no `.preview`, so step 4 leads to step 6 and the number the
   * reader sees jumps from 4 to 6. It jumps deliberately — the denominator is
   * the canonical seven, so a skipped step is visible as a gap rather than
   * renumbering the tour under the reader.
   */
  it('skips the card detail step when no card is open', () => {
    workspace({ detail: false })
    render(<Tour onExit={vi.fn()} />)
    for (let i = 0; i < 3; i += 1) click(next())
    expect(screen.getByText('Step 4 of 7')).toBeTruthy()
    click(next())
    expect(screen.getByText('Step 6 of 7')).toBeTruthy()
    expect(screen.getByText(TOUR_STEPS[5]!.title)).toBeTruthy()
  })

  it('skips the reasons step while the feed has not arrived at all', () => {
    workspace({ reasons: false })
    render(<Tour onExit={vi.fn()} />)
    click(next())
    expect(screen.getByText('Step 2 of 7')).toBeTruthy()
    click(next())
    expect(screen.getByText('Step 4 of 7')).toBeTruthy()
  })

  /*
   * D3, ADR-0033 §1, and this file's own claim: anchors are resolved AT THE
   * MOMENT YOU TRAVEL, not once when the tour opens.
   *
   * The test above used to carry this name and never made anything arrive
   * late — it built the anchor absent and left it absent, so it was a second
   * copy of its neighbour. The behaviour it claimed to cover was broken:
   * `forward` was computed during render, so a step whose anchor appeared
   * since the last commit was still skipped. §20.1 manufactures exactly this
   * window by firing the tour before the recommendation request returns.
   */
  it('picks up a step whose anchor arrives while the reader is on the one before', () => {
    workspace({ reasons: false })
    render(<Tour onExit={vi.fn()} />)
    click(next())
    expect(screen.getByText('Step 2 of 7')).toBeTruthy()

    // The feed lands, with no React render of the tour behind it.
    const row = document.createElement('div')
    row.className = 'card-row'
    row.innerHTML = '<span class="reasons"><span class="reason">because</span></span>'
    document.querySelector('section[aria-label="Suggestions"]')!.appendChild(row)

    click(next())
    expect(screen.getByText('Step 3 of 7')).toBeTruthy()
    expect(screen.getByText(TOUR_STEPS[2]!.title)).toBeTruthy()
  })

  /*
   * Doc 17's Graph is a MODE: it hides `.workspace` with the `hidden`
   * attribute rather than unmounting it, so that leaving the graph does not
   * re-run the whole pipeline. `querySelector` matches inside a hidden
   * subtree, so pressing Help from the graph reported all five workspace
   * anchors present and measured every one at 0×0 — a 12×12 ring in the corner
   * of a fully dimmed page.
   */
  it('treats an anchor inside a hidden subtree as absent', () => {
    workspace()
    document.querySelector('.workspace')!.setAttribute('hidden', '')
    render(<Tour onExit={vi.fn()} />)
    // Only the masthead buttons are left, so the tour opens on step 6 rather
    // than ringing a hidden region.
    expect(screen.getByText('Step 6 of 7')).toBeTruthy()
    expect(screen.getByText(TOUR_STEPS[5]!.title)).toBeTruthy()
  })
})

/* --------------------------------------------------------- accessibility */

describe('§20.6, which is binding', () => {
  // `() => workspace()`, not `workspace`: vitest hands `beforeEach` its
  // TestContext, which would arrive as the options object and quietly disable
  // every `=== false` check inside it.
  beforeEach(() => workspace())

  it('announces each step change to a live region', () => {
    render(<Tour onExit={vi.fn()} />)
    // Mounted EMPTY on the first render and filled after: a live region only
    // announces text that changes inside an already-present region, so one that
    // appears with its message is routinely missed. Same reasoning as the
    // masthead's announcement in `App.tsx`.
    expect(status().getAttribute('aria-live')).toBe('polite')
    click(next())
    click(next())
    expect(status().textContent).toBe(`Step 3 of 7: ${TOUR_STEPS[2]!.title}`)
  })

  it('closes on Escape at any step, and says it was escaped', () => {
    const onExit = vi.fn()
    render(<Tour onExit={onExit} />)
    click(next())
    click(next())
    press('Escape', document)
    expect(onExit).toHaveBeenCalledWith('escaped')
  })

  /*
   * D2: "Skip the tour" is a visible control on every step, the SAME size and
   * prominence as Next — not a small × in a corner. Pinned as sharing Next's
   * class, because that is what "same prominence" is made of here; a separate
   * `.tour-dismiss` would be free to drift into a corner.
   */
  it('gives Skip the same prominence as Next on every step (D2)', () => {
    render(<Tour onExit={vi.fn()} />)
    for (let i = 0; i < 7; i += 1) {
      expect(skip()).toBeTruthy()
      expect(skip().className).toBe(next().className)
      if (i < 6) click(next())
    }
  })

  it('exits as skipped, which is a different reason from finishing', () => {
    const onExit = vi.fn()
    render(<Tour onExit={onExit} />)
    click(skip())
    expect(onExit).toHaveBeenCalledWith('skipped')
  })

  it('keeps Tab inside the dialog, forwards and backwards', () => {
    render(<Tour onExit={vi.fn()} />)
    // Step 2, where Back is live, so the trap is exercised against all three
    // controls rather than against a list with a disabled hole in it.
    click(next())
    // Forward off the LAST control wraps to the first.
    skip().focus()
    press('Tab', skip())
    expect(document.activeElement).toBe(back())
    // Backwards off the FIRST wraps to the last.
    back().focus()
    act(() => {
      fireEvent.keyDown(back(), { key: 'Tab', shiftKey: true, bubbles: true })
    })
    expect(document.activeElement).toBe(skip())
  })

  /*
   * This used to fetch three elements BY BUTTON ROLE and then assert they were
   * buttons, which is close to a tautology, under a name that promised Escape
   * coverage it did not have. What is worth pinning is the shape of the row:
   * exactly three controls, in a known order, none of them removed from the
   * tab order, and a dialog that is focusable programmatically but not by Tab.
   */
  it('offers exactly Back, Next and Skip, all in the natural tab order', () => {
    render(<Tour onExit={vi.fn()} />)
    const controls = within(dialog()).getAllByRole('button')
    expect(controls.map((c) => c.textContent)).toEqual(['Back', 'Next', 'Skip the tour'])
    for (const control of controls) {
      // No `tabindex`, so each takes Enter and Space with no key handler of its
      // own and sits in document order.
      expect(control.getAttribute('tabindex')).toBeNull()
    }
    // Reachable for the focus move on open, but never a Tab stop of its own.
    expect(dialog().getAttribute('tabindex')).toBe('-1')
  })

  /*
   * Back is `disabled` on the first step, and a browser blurs an element that
   * becomes disabled while it holds focus — so clicking Back onto step 1 left
   * focus on `<body>`, OUTSIDE `.tour-layer`. That does not merely break the
   * wrap: the Tab trap is a handler on the layer, so a keydown from `<body>`
   * never reaches it and the next Tab walks into the dimmed page behind.
   *
   * jsdom does not blur on disable, which is why nothing here saw it. The blur
   * is simulated so the RECOVERY is what gets tested rather than jsdom's
   * behaviour: whatever drops focus, a step change must put it back.
   */
  it('takes focus back into the dialog if a step change dropped it', () => {
    render(<Tour onExit={vi.fn()} />)
    click(next())
    // Whatever the browser did with focus, it is not in the dialog any more.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(dialog().contains(document.activeElement)).toBe(false)
    click(back())
    expect(screen.getByText('Step 1 of 7')).toBeTruthy()
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  /*
   * `App.tsx` states the convention in a comment: "Consumed here so the
   * innermost open thing is the one that closes." The card preview, the target
   * sheet and a pinned hint all close on a document-level Escape registered in
   * the BUBBLE phase — and step 5's anchor is `.preview`, which exists only
   * while a card is open. Unconsumed, Escape to leave the tour also shut the
   * card the reader had open behind it.
   */
  it('consumes Escape, so leaving the tour does not close what is open behind it', () => {
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      render(<Tour onExit={vi.fn()} />)
      press('Escape', document)
      expect(behind).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })
})

/* ------------------------------------------------- the top-layer promotion */

/*
 * jsdom implements no Popover API at all, so the whole promotion branch is
 * DEAD in every other test in this file — which is precisely why the bug below
 * survived. These two install a deliberate stub that behaves the way the HTML
 * spec says a real one does, so the branch gets exercised.
 */
describe('promoting the overlay into the top layer', () => {
  beforeEach(() => workspace())

  /** A `showPopover` that throws on a second call, as the spec requires. */
  const installSpecPopover = (): { shows: number; hides: number } => {
    const counts = { shows: 0, hides: 0 }
    const showing = new WeakSet<Element>()
    Object.assign(HTMLElement.prototype, {
      showPopover(this: HTMLElement) {
        if (showing.has(this)) throw new DOMException('already showing', 'InvalidStateError')
        showing.add(this)
        counts.shows += 1
      },
      hidePopover(this: HTMLElement) {
        showing.delete(this)
        counts.hides += 1
      },
    })
    return counts
  }

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
    delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover
  })

  it('claims the popover attribute only alongside a call that can honour it', () => {
    installSpecPopover()
    render(<Tour onExit={vi.fn()} />)
    // Declaring `popover` in JSX where the API is missing leaves the element
    // `display: none` forever, which is worse than the clipping it replaces.
    expect(document.querySelector('.tour-layer')?.getAttribute('popover')).toBe('manual')
  })

  /*
   * `main.tsx` wraps the app in `<StrictMode>`, which runs every layout effect
   * twice on mount — setup, cleanup, setup — on the SAME DOM node. Without a
   * cleanup that hides it, the second setup calls `showPopover()` on an
   * already-showing popover, which the spec says throws `InvalidStateError`.
   * `Tour` is not inside a `<Boundary>`, so that takes the workspace down.
   *
   * Chrome happens to make the second call a no-op, which is the only reason
   * this ever worked in the browser and is not something to rely on.
   */
  it('survives StrictMode running its layout effect twice on the same node', () => {
    const counts = installSpecPopover()
    expect(() =>
      render(
        <StrictMode>
          <Tour onExit={vi.fn()} />
        </StrictMode>,
      ),
    ).not.toThrow()
    /*
     * `querySelector`, not `getByRole`. jsdom ships the UA's `[popover] {
     * display: none }` rule without the API behind it, so the moment this stub
     * makes the promotion branch run, the layer is display:none and Testing
     * Library's role queries correctly refuse to see it. That is the same trap
     * `Hint.tsx` documents; here it is the price of exercising the branch at
     * all, and the assertion is about the effect not throwing.
     */
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // Shown twice and hidden once in between, rather than shown twice running.
    expect(counts.shows).toBe(2)
    expect(counts.hides).toBe(1)
  })
})

/* ------------------------------------------- A2: scrolling, and its motion */

describe('A2: each step brings its own region into view', () => {
  beforeEach(() => workspace())

  it('scrolls THIS step’s region into view, and not the others', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(scrollsOf('section[aria-label="Deck"]')).toHaveBeenCalled()
    expect(scrollsOf('section[aria-label="Suggestions"]')).not.toHaveBeenCalled()
    expect(scrollsOf('section[aria-label="Analysis"]')).not.toHaveBeenCalled()
  })

  it('scrolls the next region into view when the step changes', () => {
    render(<Tour onExit={vi.fn()} />)
    click(next())
    expect(scrollsOf('section[aria-label="Suggestions"]')).toHaveBeenCalled()
  })

  it('centres the region rather than jamming it under the sticky masthead', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(scrollsOf('section[aria-label="Deck"]')).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    )
  })

  it('glides by default', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(scrollsOf('section[aria-label="Deck"]')).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    )
  })

  /*
   * A2, the half that is easy to forget: `prefers-reduced-motion` applies to
   * the SCROLL as much as to the highlight. An instant jump, not a glide, for a
   * reader who asked for none.
   */
  it('jumps instantly for a reader who asked for no motion', () => {
    render(<Tour onExit={vi.fn()} reducedMotion />)
    expect(scrollsOf('section[aria-label="Deck"]')).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    )
    expect(scrollsOf('section[aria-label="Deck"]')).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    )
  })

  it('takes the preference from the media query when it is not told', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia
    render(<Tour onExit={vi.fn()} />)
    expect(scrollsOf('section[aria-label="Deck"]')).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    )
  })

  /*
   * The glide is a nicety; being on screen is the contract.
   *
   * A programmatic smooth scroll is the one kind that does not always happen:
   * Chrome drives it from the compositor, so it is suspended while the
   * document is not presented and CANCELLED outright if the user touches the
   * wheel while it runs — which, on a tour that has just told someone to look
   * at something, is not a rare thing for them to do. When it does not arrive
   * the step dims the page and rings a region thousands of pixels below the
   * fold, and the reader sees a darkened screen with no spotlight anywhere on
   * it: D3's "pointed at emptily" reached from the other side.
   *
   * jsdom has no layout, so every rect is 0×0 and `inViewport` is always false
   * here — which is exactly the condition being tested: the fallback must fire
   * when the region did not arrive.
   */
  it('jumps instantly when the glide did not put the region on screen', () => {
    vi.useFakeTimers()
    try {
      render(<Tour onExit={vi.fn()} />)
      const deck = scrollsOf('section[aria-label="Deck"]')
      expect(deck).toHaveBeenCalledTimes(1)
      expect(deck).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }))
      act(() => {
        vi.advanceTimersByTime(700)
      })
      expect(deck).toHaveBeenCalledTimes(2)
      expect(deck).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not leave the deadline running once the step has moved on', () => {
    vi.useFakeTimers()
    try {
      render(<Tour onExit={vi.fn()} />)
      const deck = scrollsOf('section[aria-label="Deck"]')
      act(() => {
        next().click()
      })
      // Step 2 now owns the scrolling. A deadline left over from step 1 would
      // yank the page back to the deck rail while the reader is on the feed.
      act(() => {
        vi.advanceTimersByTime(700)
      })
      expect(deck).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

/* ------------------------------------------------------- the landing page */

describe('the landing page, where there is no workspace to tour (D5)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<header class="start-masthead"><button data-tour="help">Help</button></header>`
  })

  it('shows the how-to-start step instead of pointing at regions that do not exist', () => {
    render(<Tour onExit={vi.fn()} />)
    // By role: on the landing step the title is also the whole announcement,
    // so a bare text query matches the heading and the live region both.
    expect(screen.getByRole('heading', { name: LANDING_STEP.title })).toBeTruthy()
    expect(screen.queryByText(TOUR_STEPS[0]!.title)).toBeNull()
  })

  // Asserted on what is RENDERED. It used to assert on the exported constant
  // after rendering, which would have passed with the component deleted.
  it('tells the reader how to start, and that the rest follows a commander', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(screen.getByText(LANDING_STEP.body)).toBeTruthy()
    expect(dialog().textContent).toMatch(/commander/i)
  })

  it('does not claim to be step 1 of 7 when six of them are not there', () => {
    render(<Tour onExit={vi.fn()} />)
    expect(screen.queryByText(/of 7/)).toBeNull()
  })

  it('still closes on Escape and still offers Skip', () => {
    const onExit = vi.fn()
    render(<Tour onExit={onExit} />)
    expect(skip()).toBeTruthy()
    press('Escape', document)
    expect(onExit).toHaveBeenCalledWith('escaped')
  })
})
