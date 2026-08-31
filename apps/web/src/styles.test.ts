// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Comments are stripped first — this file's own comments quote CSS, braces and
// all, and a naive rule scan would parse them as rules.
const strip = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Both sheets, in the order the browser sees them.
 *
 * `styles.css` opens by importing `@roundtable/ui/card.css`, and an `@import`
 * is evaluated before the rules that follow it — so a `card.css` rule is EARLIER
 * in the cascade and loses every tie to this app's own rules. Reading only
 * `styles.css`, which is what this file used to do, could not see a collision
 * between the two sheets at all, and the mana symbols put a `.rt-*` class inside
 * an app-owned column for the first time.
 */
const css =
  strip(join(here, '..', '..', '..', 'packages', 'ui', 'src', 'card', 'card.css')) +
  '\n' +
  strip(join(here, 'styles.css'))

/** CSS specificity as [ids, classes/attributes/pseudo-classes, elements]. */
const specificity = (selector: string): [number, number, number] => [
  (selector.match(/#[\w-]+/g) ?? []).length,
  (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length,
  (selector.match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length,
]

const beats = (a: [number, number, number], b: [number, number, number]): boolean => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true // equal specificity: the later rule wins, and `a` is the later one
}

/**
 * Resolve one property for one element the way a browser would.
 *
 * jsdom's `getComputedStyle` does not do the cascade across a stylesheet, so
 * this walks the rules in order and keeps the most specific match — which is
 * exactly the mechanism that broke.
 */
const winner = (element: Element, property: string): { selector: string; value: string } | null => {
  let best: { selector: string; value: string; spec: [number, number, number] } | null = null
  // Rules only; the @media blocks in this sheet do not set widths.
  for (const match of css.matchAll(/([^{}@]+)\{([^}]*)\}/g)) {
    const body = match[2]!
    // Doubled backslashes: this is a template literal, where a lone `\s` is
    // just `s` and the regex would look for a literal letter.
    const declared = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)
    if (declared === null) continue
    for (const selector of match[1]!.split(',').map((s) => s.trim())) {
      if (selector === '' || selector.startsWith('@') || selector.includes('%')) continue
      let matches = false
      try {
        matches = element.matches(selector)
      } catch {
        continue
      }
      if (!matches) continue
      const spec = specificity(selector)
      if (best === null || beats(spec, best.spec)) {
        best = { selector, value: declared[1]!.trim(), spec }
      }
    }
  }
  return best === null ? null : { selector: best.selector, value: best.value }
}

describe('specificity', () => {
  it('ranks the selectors that actually collided here', () => {
    expect(specificity('input[type="text"]')).toEqual([0, 1, 1])
    expect(specificity('.basic-count')).toEqual([0, 1, 0])
    expect(specificity('.basic-row input.basic-count')).toEqual([0, 2, 1])
    // The bug in one line: the global rule out-specified the class.
    expect(beats(specificity('input[type="text"]'), specificity('.basic-count'))).toBe(true)
  })
})

describe('the basic-land row', () => {
  const row = (): HTMLElement => {
    document.body.innerHTML = `
      <div class="card-row basic-row">
        <span class="name">Snow-Covered Wastes</span>
        <button class="act step">−</button>
        <input class="basic-count" type="text" inputmode="numeric" value="0">
        <button class="act step">+</button>
      </div>`
    return document.body.querySelector('.basic-row')!
  }

  it('keeps the count box narrow, so the land name has somewhere to go', () => {
    // The regression: `input[type="text"] { width: 100% }` beat `.basic-count`,
    // the box took the whole row, and the name collapsed to zero width. The
    // row showed a stepper and a number with nothing naming what it counted.
    const input = row().querySelector('input')!
    const width = winner(input, 'width')
    expect(width).not.toBeNull()
    expect(width?.value).not.toBe('100%')
    expect(width?.value).toBe('3.2rem')
  })

  it('lets the name take the remaining space, down to a floor', () => {
    const name = row().querySelector('.name')!
    // `1 1 auto` is `flex: 1` with the basis spelled out; both mean "take what
    // is left".
    expect(winner(name, 'flex')?.value).toMatch(/^1( 1 auto)?$/)

    /*
     * This used to assert `min-width: 0`, and that assertion was the bug.
     *
     * Zero does make a flex child shrink below its content, which is what lets
     * the ellipsis work on a long land name — but it also lets the name shrink
     * to NOTHING. Measured on the running app at a 230 px deck rail: the name
     * was 0 px wide while the mana cost, price, lock and remove held 213 px
     * between them, so every row had its controls and named no card.
     *
     * A floor keeps both properties: the ellipsis still engages, and the name
     * never disappears. The controls give way instead, via the container
     * queries asserted below.
     */
    const floor = winner(name, 'min-width')?.value
    expect(floor).toBeDefined()
    expect(Number.parseFloat(floor ?? '0')).toBeGreaterThan(0)
  })
})

describe('the start screen', () => {
  const problem = (): Element => {
    document.body.innerHTML = `
      <div class="start">
        <div class="start-results"><p class="problem">Nothing found.</p></div>
      </div>`
    return document.body.querySelector('.problem')!
  }

  it('shows a search failure in the alarm colour, not the help-text grey', () => {
    // The same collision as the basic-land row, in a different place:
    // `.start p` is one class plus a type and beat the bare `.problem` class,
    // so the one line the reader has to notice rendered like the prose it sits
    // among.
    expect(winner(problem(), 'color')?.value).toBe('var(--rust)')
  })
})

describe('the mana column', () => {
  const row = (): HTMLElement => {
    document.body.innerHTML = `
      <div class="card-row">
        <span class="name">Lightning Bolt</span>
        <span class="mana"><span class="rt-mana"><span class="rt-sr">mana cost red</span
          ><span class="rt-sym"><span class="rt-sym-mark" data-half="only">R</span></span></span></span>
        <span class="cash">$1.20</span>
      </div>`
    return document.body.querySelector('.card-row')!
  }

  it('keeps the discs at their own size, not the row text size', () => {
    // `.card-row .mana` sets 0.72rem for what used to be monospace shorthand.
    // The discs are sized in `em` off `.rt-mana`, so if the row's font-size ever
    // won here every symbol in the deck list would shrink to ~8 px.
    const size = winner(row().querySelector('.rt-mana')!, 'font-size')
    expect(size?.selector).toBe('.rt-mana')
    expect(size?.value).toBe('13px')
  })

  it('does not dim the column, which would undo the contrast the discs are chosen for', () => {
    // The removed line: `.card-row .mana { opacity: 0.8 }`, which made sense for
    // a line of grey monospace and took every disc below the 3:1 floor
    // `mana.test.ts` asserts them at.
    expect(winner(row().querySelector('.mana')!, 'opacity')).toBeNull()
    expect(winner(row().querySelector('.rt-sym')!, 'opacity')).toBeNull()
  })

  it('pushes the column to its right edge without relying on text-align', () => {
    // `text-align` has nothing to align once the content is boxes.
    const column = row().querySelector('.mana')!
    expect(winner(column, 'display')?.value).toBe('flex')
    expect(winner(column, 'justify-content')?.value).toBe('flex-end')
  })
})

describe('a deck row never loses the card name', () => {
  /*
   * Measured on the running app before the fix: at a 230 px deck rail the name
   * was 0 px wide while the mana cost (74), price (54), lock (27) and remove
   * (58) held 213 px between them. The row still had every control and no
   * longer said which card they acted on.
   *
   * The name was the only flexible item — `flex: 1; min-width: 0` — so it
   * absorbed the entire deficit. The least important things on the row pushed
   * out the only one that identifies it.
   */
  const deckRow = (): HTMLElement => {
    document.body.innerHTML = `
      <section class="region">
        <div class="card-row">
          <span class="name as-link">Skirk Prospector</span>
          <span class="mana">{1}{R}</span>
          <span class="cash">$0.34</span>
          <button class="act lock">Lock</button>
          <button class="act exclude">Remove</button>
        </div>
      </section>`
    return document.querySelector('.card-row .name') as HTMLElement
  }

  it('gives the name a floor it cannot shrink below', () => {
    const value = winner(deckRow(), 'min-width')?.value
    expect(value).toBeDefined()
    // Anything but zero. `min-width: 0` is what let it vanish.
    expect(value).not.toBe('0')
    expect(Number.parseFloat(value ?? '0')).toBeGreaterThan(0)
  })

  it('lets the price step aside before the name does', () => {
    // A CONTAINER query, not a media query: the rail's width comes from the
    // workspace grid and the draggable divider, so the viewport does not know
    // it. A `@media` rule would hide the price on a wide screen with a narrow
    // rail, and show it on a phone.
    expect(css).toMatch(/container-type:\s*inline-size/)
    expect(css).toMatch(
      /@container[^{]*max-width:\s*320px[^{]*\{\s*\.card-row \.cash\s*\{\s*display:\s*none/,
    )
  })

  it('drops the mana cost only at a width below the price threshold', () => {
    // Order matters: the price is an estimate that goes stale in a day and is
    // repeated in the deck total, so it goes first.
    const cash = /@container \(max-width:\s*(\d+)px\)\s*\{\s*\.card-row \.cash/.exec(css)
    const mana = /@container \(max-width:\s*(\d+)px\)\s*\{\s*\.card-row \.mana/.exec(css)
    expect(cash).not.toBeNull()
    expect(mana).not.toBeNull()
    expect(Number(mana?.[1])).toBeLessThan(Number(cash?.[1]))
  })
})

describe('the stylesheet parses', () => {
  /*
   * A merge dropped one `}` from `.bracket-source a` and `pnpm build` failed
   * with `Unclosed block` — the whole web app was unbuildable on `main`, and
   * every other check stayed green: `tsc` does not read CSS, `eslint` does not
   * read CSS, and the test suite imports this file as TEXT rather than parsing
   * it. The build was the only thing that knew, and its output had been piped
   * away.
   *
   * Counting braces is not a CSS parser, but it catches the failure that
   * actually happened, in the suite rather than in a deploy.
   */
  const stripped = (path: string): string =>
    readFileSync(path, 'utf8')
      // Comments first: this file's own comments contain braces.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Then quoted strings, which may hold a lone brace in `content:` or a URL.
      .replace(/"[^"]*"|'[^']*'/g, '')

  const sheets = [
    join(here, 'styles.css'),
    join(here, '..', '..', '..', 'packages', 'ui', 'src', 'card', 'card.css'),
  ]

  it.each(sheets)('has balanced braces: %s', (path) => {
    const text = stripped(path)
    const open = (text.match(/\{/g) ?? []).length
    const close = (text.match(/\}/g) ?? []).length
    expect({ file: path, open, close }).toEqual({ file: path, open: close, close })
  })

  it('never leaves a rule open at the end of a section', () => {
    // The exact shape of the bug: a declaration, then a blank line, then a
    // comment banner — with no `}` in between.
    const text = stripped(join(here, 'styles.css'))
    expect(text).not.toMatch(/:[^;{}]+;\s*\n\s*\n\s*[.#@a-zA-Z][^{}\n]*\{/)
  })
})

/**
 * The preview overlays the feed on a wide screen and is a bottom sheet on a
 * narrow one, and the two must never both apply.
 *
 * Asserted against the source rather than through `winner`, because both rules
 * live inside `@media` blocks and the resolver above deliberately reads only
 * unconditional rules. What is being pinned is the BOUNDARY: the mobile sheet
 * was built deliberately and is tested in `sheet.test.tsx`, so the desktop
 * overlay has to be a disjoint range rather than something that merely happens
 * to lose the cascade.
 */
describe('the preview at each width', () => {
  const css = readFileSync(join(here, 'styles.css'), 'utf8')

  /*
   * The rail's own rule, and only it.
   *
   * This was `/\.region\.analysis\s*\{([^}]*)\}/`, which finds the first rule
   * whose selector merely ENDS with `.region.analysis` — so the moment anything
   * declared `.workspace[...] > .region.analysis` earlier in the sheet, these
   * tests started reading that rule instead and failed on a sheet that was
   * perfectly correct. Anchoring to the start of a line pins the unconditional,
   * unindented rule, which is the one being asserted about.
   */
  const railRule = (): string => /^\.region\.analysis\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''

  it('anchors to the analysis rail only above the single-column breakpoint', () => {
    const desktop = /@media \(min-width:\s*901px\)\s*\{\s*\.preview\s*\{([^}]*)\}/.exec(css)
    expect(desktop).not.toBeNull()
    // `right: 100%` is what puts it OUTSIDE the rail, over the feed. Without it
    // the panel is back inside the column it is supposed to have left.
    expect(desktop?.[1]).toMatch(/right:\s*100%/)
    expect(desktop?.[1]).toMatch(/position:\s*absolute/)
  })

  it('leaves the mobile sheet alone — the two ranges do not overlap', () => {
    // 900 and 901. `SINGLE_COLUMN` in App.tsx is `(max-width: 900px)` and both
    // bounds are integers, so no viewport can match both blocks.
    expect(css).toMatch(/@media \(max-width:\s*900px\)\s*\{\s*\.preview\.preview-sheet/)
    expect(css).toMatch(/@media \(min-width:\s*901px\)\s*\{\s*\.preview\s*\{/)
  })

  it('puts the rail above the feed it overlays, and below the masthead', () => {
    /*
     * Measured in a browser: with no z-index on the rail, the feed's rows won
     * the hit test through the middle of an open preview. `.card-row` is
     * `position: relative` and `.act` carries `z-index: 1`, and `.region` has
     * `container-type: inline-size` — layout containment, so each region is its
     * own stacking context. The preview's own `z-index: 25` cannot help: it is
     * inside the rail's context and can only order itself against the rail's
     * other children.
     *
     * Below the masthead's 10 on purpose. The rail starts under the masthead so
     * they never overlap, and a rail that could cover the deck switcher would
     * be a worse bug than the one this fixes.
     */
    const railZ = /z-index:\s*(\d+)/.exec(railRule())
    // The masthead is declared twice — a layout rule and, later, the sticky
    // rule that carries the z-index. Take the one that sets it.
    const mastheadZ = /\.masthead\s*\{[^}]*z-index:\s*(\d+)/.exec(css)
    expect(railZ).not.toBeNull()
    expect(mastheadZ).not.toBeNull()
    expect(Number(railZ?.[1])).toBeGreaterThan(0)
    expect(Number(railZ?.[1])).toBeLessThan(Number(mastheadZ?.[1]))
  })

  it('keeps the rail from clipping what is meant to hang outside it', () => {
    // `.region.analysis` was `overflow: hidden`, which clipped both the overlay
    // and the panel a curve bar opens. The scroll body still owns its own
    // scrolling, so nothing in normal flow escapes.
    expect(railRule()).toMatch(/overflow:\s*visible/)
    expect(css).toMatch(/\.analysis-scroll\s*\{[^}]*overflow-y:\s*auto/)
  })
})

/**
 * On a wide enough screen the detail pane stops covering the feed and becomes a
 * column of its own.
 *
 * The defect the overlay caused: reading a card's details hid the Add and
 * Reject buttons on the rows being read, so you could not act on what you were
 * reading. The overlay is still the right answer when there is genuinely no
 * room — these tests pin WHERE the line is and that the arithmetic behind it is
 * the arithmetic in the sheet, not a number someone liked.
 */
describe('the detail pane as a fourth column', () => {
  const sheet = strip(join(here, 'styles.css'))

  /** The body of the `@media` block whose condition contains `q`, braces matched. */
  const mediaBody = (q: string): string => {
    const opener = new RegExp(`@media[^{]*${q}[^{]*\\{`, 'g')
    const start = opener.exec(sheet)
    if (start === null) return ''
    let depth = 1
    let i = opener.lastIndex
    while (i < sheet.length && depth > 0) {
      if (sheet[i] === '{') depth += 1
      else if (sheet[i] === '}') depth -= 1
      i += 1
    }
    return sheet.slice(opener.lastIndex, i - 1)
  }

  /** The threshold this whole feature is gated on, read from the sheet. */
  const threshold = (): number => {
    const found = /@media \(min-width:\s*(\d+)px\)\s*\{\s*\.workspace\[data-detail='open'\]/.exec(
      sheet,
    )
    expect(found).not.toBeNull()
    return Number(found?.[1])
  }

  /** One declaration's value out of one rule inside the four-column block. */
  const declared = (selector: string, property: string): string | null => {
    const body = mediaBody(`min-width: ${String(threshold())}px`)
    const rule = new RegExp(
      `${selector.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    ).exec(body)?.[1]
    if (rule === undefined) return null
    return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule)?.[1]?.trim() ?? null
  }

  /** `grid-template-columns` split into tracks, respecting `minmax(...)`. */
  const tracks = (): string[] => {
    const value = declared(".workspace[data-detail='open']", 'grid-template-columns')
    expect(value).not.toBeNull()
    const out: string[] = []
    let depth = 0
    let current = ''
    for (const ch of value ?? '') {
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (ch === ' ' && depth === 0) {
        if (current !== '') out.push(current)
        current = ''
      } else current += ch
    }
    if (current !== '') out.push(current)
    return out
  }

  /** The smallest width a track can take, in px. */
  const floorPx = (track: string): number => {
    const min = /^minmax\(\s*([^,]+),/.exec(track)?.[1]?.trim() ?? track
    if (min.endsWith('rem')) return Number.parseFloat(min) * 16
    return Number.parseFloat(min)
  }

  it('gives the panel a track of its own, and puts the rail past it', () => {
    const four = tracks()
    expect(four).toHaveLength(4)
    // Third of four: beside the suggestion row it describes, and still left of
    // the rail, which the user asked to keep for composition and combos.
    expect(four[2]).toBe('21rem')
    /*
     * Three regions into four tracks auto-place into 1, 2 and 3 — the rail
     * would sit in the detail's slot and the reserved column would open at the
     * far right, behind nothing. The rail is placed rather than left to the
     * cursor.
     */
    expect(declared(".workspace[data-detail='open'] > .region.analysis", 'grid-column')).toBe('4')
  })

  it('asks the deck rail for the width it actually needs, not the one it declares', () => {
    /*
     * The grid's own floor for the side rails is 230px, and the deck rail cannot
     * hold it: measured in Chrome, at 230px the deck row's Remove button finishes
     * 58px OUTSIDE the column, on top of the feed. The spill reaches zero at
     * 310px.
     *
     * The cause is a defect in the row, not in the grid — the
     * `@container (max-width: 250px)` rule meant to drop the mana column on a
     * cramped rail never fires, because `.card-row .mana { display: flex }` is
     * declared later at equal specificity and wins the cascade. That is somebody
     * else's fix. What this pins is that the four-column layout does not build a
     * threshold on a floor the rail cannot stand on.
     */
    expect(floorPx(tracks()[0] ?? '')).toBeGreaterThanOrEqual(310)
  })

  it('opens the column only where all four columns still fit', () => {
    /*
     * The derivation, executable so it cannot drift from the comment beside it.
     *
     * Every floor here was measured on the running app rather than read off a
     * `minmax`: 400px for the feed, below which `.card-row .name` is already at
     * its 5rem minimum and the name button is wider than the cell holding it;
     * 310px for the deck rail, above; 230px for the analysis rail, which does
     * hold its declared floor. The detail column is the panel's own 21rem.
     *
     * The scrollbar allowance is not slop. Chrome resolves a media query against
     * `innerWidth`, which on Windows includes the classic scrollbar that the
     * layout viewport does not get — measured on the running app at
     * `clientWidth` 2545 with `(min-width: 2546px)` matching.
     */
    const four = tracks()
    const feedFloor = 400
    const scrollbar = 17
    const gaps = 3 // three 1px rules between four columns
    const layout = threshold() - scrollbar
    const feed =
      layout - gaps - floorPx(four[2] ?? '') - floorPx(four[0] ?? '') - floorPx(four[3] ?? '')
    expect(feed).toBeGreaterThanOrEqual(feedFloor)
  })

  it('never makes opening a card reformat the rows it describes', () => {
    /*
     * The reflow cost, bounded rather than hoped about. The feed narrows when
     * the column opens, and a feed that drops its price column the moment you
     * click a card would be a worse experience than the overlay was. So the
     * threshold has to leave the feed above the width at which the container
     * query trips, with the panel open — which is exactly why the floor above
     * is the name's 400px and not the price query's own number.
     */
    const priceQuery = /@container \(max-width:\s*(\d+)px\)\s*\{\s*\.card-row \.cash/.exec(sheet)
    expect(priceQuery).not.toBeNull()
    // `.region` pads `calc(var(--step) * 2)` a side and `--step` is 0.5rem, so
    // the query container is 32px narrower than its column.
    const columnAtWhichPriceDrops = Number(priceQuery?.[1]) + 32
    const four = tracks()
    const feed =
      threshold() -
      17 -
      3 -
      floorPx(four[2] ?? '') -
      floorPx(four[0] ?? '') -
      floorPx(four[3] ?? '')
    expect(feed).toBeGreaterThan(columnAtWhichPriceDrops)
  })

  it('fills the reserved track exactly, top to bottom, so none of it shows through', () => {
    /*
     * `.workspace` paints `--rule` and each region paints `--ink` over its own
     * track, so a reserved track has nothing in it but the grid's background —
     * and the workspace is several thousand pixels tall. Any part of the column
     * the panel does not cover is a slab of rule colour. The panel is the
     * column's background as well as its content, which is why it is stretched
     * rather than left at its content height.
     *
     * `right: calc(100% + 1px)` lands its right edge on the rule between the
     * two columns whatever the grid rounds the tracks to, because `100%` is the
     * rail's own padding box.
     */
    expect(declared(".workspace[data-detail='open'] .preview", 'width')).toBe('21rem')
    expect(declared(".workspace[data-detail='open'] .preview", 'right')).toBe('calc(100% + 1px)')
    expect(declared(".workspace[data-detail='open'] .preview", 'top')).toBe('0')
    expect(declared(".workspace[data-detail='open'] .preview", 'bottom')).toBe('0')
    // The overlay's caps would fight the stretch: `max-height` wins over
    // `bottom` when the box is over-constrained, and would leave a bare strip.
    expect(declared(".workspace[data-detail='open'] .preview", 'max-height')).toBe('none')
  })

  it('drops the shadow that said "on top of"', () => {
    // The shadow is what made an overlay read as an overlay. Beside is not on
    // top of, and a shadow on a column makes it look like it has come loose.
    expect(declared(".workspace[data-detail='open'] .preview", 'box-shadow')).toBe('none')
  })

  it('leaves the three-column grid alone when nothing is selected', () => {
    /*
     * A permanently reserved track would take 21rem from the feed at every
     * moment to hold a space for a panel that is closed most of the time, which
     * is the opposite of "when there is space". So every rule here is gated on
     * the workspace saying a panel is actually open.
     */
    const body = mediaBody(`min-width: ${String(threshold())}px`)
    const selectors = body.match(/[^{}]+(?=\{)/g) ?? []
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector).toContain("[data-detail='open']")
    }
  })

  it('is out of reach of the mobile sheet and of the overlay it replaces', () => {
    // Three disjoint regimes: sheet at ≤900, overlay from 901, column from the
    // threshold. The sheet is a `max-width` block, so a `min-width` threshold
    // above 900 can never reach it.
    expect(threshold()).toBeGreaterThan(900)
    expect(mediaBody(`min-width: ${String(threshold())}px`)).not.toContain('preview-sheet')
    // And the overlay is still there for the band below the threshold.
    expect(sheet).toMatch(/@media \(min-width:\s*901px\)\s*\{\s*\.preview\s*\{[^}]*right:\s*100%/)
  })
})
