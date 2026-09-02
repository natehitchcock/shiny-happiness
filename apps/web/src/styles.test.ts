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

/**
 * The row, measured.
 *
 * Every number here is a `getBoundingClientRect().width` taken in Chrome on the
 * running app against a real 86-card deck, at a width where nothing is shed —
 * not a `min-width` read off this sheet, because several of these cells are
 * wider than their declared floor once their font renders. They were uniform
 * across all 76 suggestion rows and all 65 deck rows.
 *
 * The chrome is the row's own: `gap: var(--step)`, `padding: 6px var(--step)`,
 * and `border: 1px solid transparent`, which counts because `* { box-sizing:
 * border-box }` makes the container width include it.
 */
const measured = {
  gap: 8,
  padding: 16,
  border: 2,
  /** `.card-row .name` / `.card-row > .name-cell`, 5rem. */
  nameFloor: 80,
  /** The combo-degree hint, on a suggestion row only. */
  badge: 24.8,
  mana: 73.59,
  metric: 49.59,
  price: 54.39,
  add: 36.28,
  reject: 48.78,
  lock: 27.19,
  remove: 57.75,
} as const

/**
 * The container width at which these cells plus a floored name exactly fill a row.
 *
 * `cells.length` gaps, not `cells.length - 1`: the name is a child too, so a row
 * showing n fixed cells has n + 1 children and n gaps between them.
 */
const needs = (...cells: number[]): number =>
  cells.reduce((a, b) => a + b, 0) +
  cells.length * measured.gap +
  measured.padding +
  measured.border +
  measured.nameFloor

/**
 * The container width at which these cells alone exactly fill a row.
 *
 * `needs` above is the ONE-LINE case, and every width it returns leaves room for
 * a name at its floor. This is the SECOND line of a stacked row, which has no
 * name on it at all: n children, n - 1 gaps, and the row's own padding and
 * border. The shedding order continues down here — see the stacking block in the
 * sheet — so these thresholds are derived exactly as the one-line ones are, and
 * differ only by the name that is no longer competing for the width.
 */
const fills = (...cells: number[]): number =>
  cells.reduce((a, b) => a + b, 0) +
  (cells.length - 1) * measured.gap +
  measured.padding +
  measured.border

/**
 * The masthead, measured on the running app.
 *
 * The control set is the one doc 20 §20.4 fixes: Graph, Quickbuild, Help and an
 * overflow trigger holding Import and Export (A1). Each width is a
 * `getBoundingClientRect().width` with the row's real `.act` padding and font,
 * not a guess — the three that do not exist yet were measured by relabelling the
 * three that do. `chip` is the widest state the chip's own comment records
 * (`BRACKET 4 · 3 GAME CHANGERS · NO LIMIT`), not the narrower one this deck
 * happens to show, because the widest is the state that decides whether the row
 * fits.
 */
const masthead = {
  /** `gap: calc(var(--step) * 2)`. */
  gap: 16,
  /** `padding: … calc(var(--step) * 3)`, both sides. */
  padding: 48,
  wordmark: 135.1,
  /** The deck name's floor, the same 5rem a card name gets. */
  nameFloor: 80,
  /** `.progress { min-width: 180px }`. */
  progress: 180,
  count: 103.2,
  chip: 298,
  graph: 47.6,
  quickbuild: 73.6,
  help: 39.6,
  overflow: 25.9,
  /**
   * Chrome resolves a media query against `innerWidth`, which on Windows
   * includes the classic scrollbar the layout viewport never gets — measured on
   * the running app at `clientWidth` 2545 while `(min-width: 2546px)` matched.
   */
  scrollbar: 17,
} as const

/** A CSS length in px. `rem` is 16px here: nothing in this app rescales the root. */
const px = (length: string): number =>
  Number.parseFloat(length) * (length.trim().endsWith('rem') ? 16 : 1)

/** The `max-width` of the `@container` block whose first rule matches `selector`. */
const shedsAt = (selector: RegExp): number => {
  const found = new RegExp(
    `@container \\(max-width:\\s*(\\d+)px\\)\\s*\\{\\s*${selector.source}`,
  ).exec(css)
  expect(found).not.toBeNull()
  return Number(found?.[1])
}

/**
 * The `max-width` of the `@container` block at which a row stops fitting on one
 * line and takes two.
 *
 * Reads the same shape `shedsAt` does, and additionally insists the block it
 * found is the one that WRAPS the row. A stacking threshold that had lost its
 * `flex-wrap` would still be a number this file could assert arithmetic about,
 * and the rows behind it would be back to a crushed name on one line.
 */
const stacksAt = (selector: RegExp): number => {
  const found = new RegExp(
    `@container \\(max-width:\\s*(\\d+)px\\)\\s*\\{\\s*${selector.source}\\s*\\{([^}]*)\\}`,
  ).exec(css)
  expect(found).not.toBeNull()
  expect(found?.[2]).toMatch(/flex-wrap:\s*wrap/)
  return Number(found?.[1])
}

/** The stacking threshold of each row shape, read off the sheet. */
const stacks = {
  suggestion: (): number => stacksAt(/\.card-row:has\(\.name-cell\)/),
  deck: (): number => stacksAt(/\.card-row:not\(:has\(\.name-cell\)\)/),
}

/**
 * The threshold is the last width at which the cell must already be gone.
 *
 * Two-sided on purpose, which pins it to a single integer rather than to "not
 * obviously wrong": one pixel wider and the cell must still fit beside a floored
 * name (so nothing is shed before the row asks for it), and at the threshold
 * itself it must not (so nothing is kept at the name's expense). A test that
 * only checked the second half would pass with every cell hidden at 4000px.
 */
const shedsExactlyWhenItMust = (threshold: number, need: number): void => {
  expect(threshold + 1).toBeGreaterThanOrEqual(need)
  expect(threshold).toBeLessThan(need)
}

/**
 * The floor has to sit on whichever child the row actually flexes.
 *
 * This is the defect that outlived three passes over this sheet, because every
 * test asked `.card-row .name` for its `min-width` and that declaration was
 * right the whole time. A deck row flexes the name itself. A SUGGESTION row
 * flexes the `.name-cell` wrapping the name and its reasons, and that cell was
 * `min-width: 0` — so it collapsed under the name it holds. Measured in Chrome
 * at a 340px feed container: cell 44px, name button 80px, overflowing 36px into
 * the mana column, which paints over it because `.card-row > *:not(.name)`
 * carries `z-index: 1`. At a 321px container the cell was 25px. The name was the
 * one thing on the row that says which card the buttons act on, and it was the
 * one thing being covered up.
 *
 * So this looks the layout up the way the layout does: find the child that
 * grows, ask THAT one for its floor.
 */
describe('whichever child a row flexes is the child that carries the floor', () => {
  /** The `flex-grow` a child resolves to, defaulting to the initial `0`. */
  const grows = (child: Element): boolean => {
    const flex = winner(child, 'flex')?.value
    if (flex === undefined) return Number.parseFloat(winner(child, 'flex-grow')?.value ?? '0') > 0
    // `flex: 1` is `1 1 0%`; `flex: 0 0 auto` is itself. The first number is grow.
    return Number.parseFloat(flex.split(/\s+/)[0] ?? '0') > 0
  }

  const shapes = {
    'a deck row': `
      <div class="card-row">
        <span class="name as-link">Skirk Prospector</span>
        <span class="mana">{1}{R}</span>
        <span class="cash">$0.34</span>
        <button class="act lock">Lock</button>
        <button class="act exclude">Remove</button>
      </div>`,
    'a suggestion row': `
      <div class="card-row">
        <span class="hint degree-hint">2</span>
        <span class="name-cell"
          ><button class="name as-link">Skirk Prospector</button
          ><span class="reasons"><span class="reason">ramps</span></span></span>
        <span class="mana">{1}{R}</span>
        <span class="metric-cell" data-metric="impact">6.13</span>
        <span class="metric-cell" data-metric="efficiency">3.07</span>
        <span class="cash">$0.34</span>
        <button class="act accept">Add</button>
        <button class="act exclude">Reject</button>
      </div>`,
  }

  it.each(Object.entries(shapes))('%s floors the child it flexes', (_name, markup) => {
    document.body.innerHTML = `<section class="region">${markup}</section>`
    const row = document.querySelector('.card-row')!
    const flexible = [...row.children].filter(grows)

    // Exactly one, or the deficit is shared and the name's share is unbounded.
    expect(flexible.map((c) => c.className)).toHaveLength(1)

    const floor = winner(flexible[0]!, 'min-width')?.value
    expect(floor).toBeDefined()
    expect(floor).not.toBe('0')
    expect(Number.parseFloat(floor ?? '0')).toBeGreaterThan(0)
  })

  it('floors both shapes at the same width, so one derivation covers both', () => {
    /*
     * The shedding thresholds below are all derived from ONE number, `5rem`. If
     * the two shapes could floor at different widths, half of those thresholds
     * would be derived from a floor that is not the one being honoured — and
     * nothing would say which half.
     */
    document.body.innerHTML = `<section class="region">${shapes['a deck row']}</section>`
    const deck = winner(document.querySelector('.card-row > .name')!, 'min-width')?.value
    document.body.innerHTML = `<section class="region">${shapes['a suggestion row']}</section>`
    const feed = winner(document.querySelector('.card-row > .name-cell')!, 'min-width')?.value
    expect(deck).toBe(feed)
    // And it is the number the derivations below use.
    expect(px(deck ?? '0')).toBe(measured.nameFloor)
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

  /*
   * A deck row is `:not(:has(.name-cell))` — see the suggestion-row block below
   * for why the two shapes shed at different widths and why the selector is the
   * shape rather than the panel.
   */
  const price = (): number => shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.cash/)
  const mana = (): number => shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.mana/)

  it('takes a second line before the name gives way', () => {
    // A CONTAINER query, not a media query: the rail's width comes from the
    // workspace grid and the draggable divider, so the viewport does not know
    // it. A `@media` rule would stack the rail on a wide screen with a narrow
    // rail dragged out, and leave it crushed on a phone.
    expect(css).toMatch(/container-type:\s*inline-size/)
    /*
     * The deck row's ONE-LINE chain has exactly one link and this is it. It used
     * to have two — drop the price at 342, drop the mana cost at 280 — and the
     * measured consequence was the defect the user reported: at 286px, the deck
     * rail's container on an ordinary 1400px laptop, the row had shed its price
     * and still gave the name 85.5px. Measured against the corpus, 85.5px shows
     * a whole card name for 12% of cards.
     *
     * So the price no longer steps aside here; the row does. Both numbers move
     * to the second line, where they fit, and the chain resumes there.
     */
    expect(stacks.deck()).toBeGreaterThan(price())
    expect(stacks.deck()).toBeGreaterThan(mana())
  })

  it('drops the mana cost only at a width below the price threshold', () => {
    // Order matters, and it is the same order on the second line as it was on
    // the first: the price is an estimate that goes stale in a day and is
    // repeated in the deck total, so it goes before the cost you pay every game.
    expect(mana()).toBeLessThan(price())
  })

  it('sheds each of them exactly where the second line would otherwise overflow', () => {
    /*
     * DERIVED, and this is the derivation. A stacked deck row puts the name on a
     * line of its own and the mana cost, price, lock and remove on the next; the
     * two thresholds are the widths at which that second line stops fitting.
     *
     * There is no `nameFloor` in these, and that absence is the whole change:
     * the name is not on this line, so nothing here is being kept at its
     * expense. `fills`, not `needs`.
     *
     * These numbers used to be 342 and 280, derived the same way against a name
     * that WAS on the line. Measured in Chrome before that: at a 331px rail
     * container — a 1600px viewport, ordinary — the price was still shown and
     * the Remove button finished 12px OUTSIDE the rail, on top of the feed.
     */
    const { mana: m, price: p, lock, remove } = measured
    shedsExactlyWhenItMust(price(), fills(m, p, lock, remove))
    shedsExactlyWhenItMust(mana(), fills(m, lock, remove))
  })
})

/**
 * What a suggestion row gives up first, once it carries two more numbers.
 *
 * Order, top to bottom: efficiency, impact, price, mana cost. The name and the
 * two decision buttons never go. Each of the four is a `display: none` under a
 * `@container` query, so the whole order is readable as four thresholds and
 * that is what these assert — the alternative, rendering the row at ten widths
 * in jsdom, measures nothing, because jsdom reports every box as 0×0.
 */
describe('a suggestion row sheds its numbers in a stated order', () => {
  const efficiency = (): number => shedsAt(/\.card-row \.metric-cell\[data-metric='efficiency'\]/)
  const impact = (): number => shedsAt(/\.card-row \.metric-cell\[data-metric='impact'\]/)
  const price = (): number => shedsAt(/\.card-row:has\(\.name-cell\) \.cash/)
  const mana = (): number => shedsAt(/\.card-row:has\(\.name-cell\) \.mana/)

  it('drops efficiency first, then impact', () => {
    // The derived rate goes before the quantity it is derived from: impact is
    // the pair's primary — first default column, stated ceiling, the example
    // the filter help gives — and efficiency travels with a caveat a cell has
    // no room for.
    expect(efficiency()).toBeGreaterThan(impact())
  })

  it('stops shedding once only the price is left to lose, and stacks instead', () => {
    /*
     * The one-line chain has exactly two links: efficiency, then impact. Both
     * are printed in full, with their tier and their working, in the detail
     * pane, so losing them from a row costs a click.
     *
     * The third link used to be the price and it is gone. Not because the price
     * became precious — it is still the row's most disposable number — but
     * because measured, the shed does not buy what it is spent for. Dropping the
     * price at 375 leaves the name 141.6px, and 141.6px shows a whole card name
     * for 78% of the corpus; a row that has spent a column to arrive 23px short
     * of legible has spent it for nothing. The second line buys 324px in one
     * step, and the price comes with it.
     */
    expect(stacks.suggestion()).toBeLessThan(impact())
    expect(stacks.suggestion()).toBeGreaterThan(price())
    expect(stacks.suggestion()).toBeGreaterThan(mana())
  })

  it('drops the mana cost last of the four', () => {
    // What you pay every game, against three numbers that are commentary on it.
    // The order survives the move to the second line unchanged.
    expect(mana()).toBeLessThan(price())
  })

  it('never keeps a number at the cost of the card’s name', () => {
    /*
     * Every threshold is DERIVED, and this is the derivation, executable so it
     * cannot drift from the sheet. A suggestion row is the combo badge, the name
     * cell, the mana cost, the metric cells, the price, Add and Reject.
     *
     * The first three are ONE-LINE thresholds — the last width at which that
     * cell has to be gone already for the name to keep its 5rem — and the
     * stacking threshold is the third of them, standing where the price's used
     * to. The same arithmetic, a different remedy: at 375 the row can no longer
     * hold a floored name beside what it carries, and instead of dropping a cell
     * it takes a line.
     *
     * The last two are SECOND-LINE thresholds, and use `fills` rather than
     * `needs` because the name is no longer on the line being measured.
     *
     * The two metric thresholds moved by two pixels once (489→491, 431→433) and
     * the movement is the row's border: `* { box-sizing: border-box }` means the
     * container width has to pay for `border: 1px solid transparent` on each
     * side, and an earlier derivation left it out. Measured in Chrome at a 490px
     * feed container with efficiency still shown, the name cell was 79px — one
     * pixel under its floor, which nothing could see while the floor was on an
     * element the row does not flex.
     */
    const { badge, mana: m, metric, price: p, add, reject } = measured
    shedsExactlyWhenItMust(efficiency(), needs(badge, m, metric, metric, p, add, reject))
    shedsExactlyWhenItMust(impact(), needs(badge, m, metric, p, add, reject))
    shedsExactlyWhenItMust(stacks.suggestion(), needs(badge, m, p, add, reject))
    shedsExactlyWhenItMust(price(), fills(badge, m, p, add, reject))
    shedsExactlyWhenItMust(mana(), fills(badge, m, add, reject))
  })

  it('asks for more room than a deck row does, because it carries more', () => {
    /*
     * TWO FAMILIES OF THRESHOLD, ON PURPOSE. Both shapes are `.card-row` and both
     * have a `.cash` and a `.mana`, so for a long time both were shed by one pair
     * of numbers — 320 and 250 — which were the deck rail's, and were wrong for
     * it too. A suggestion row carries a combo badge, Add and Reject where a deck
     * row carries lock and remove: 110px against 85, plus a gap. It reaches the
     * name's floor a full 33px of container earlier, every time.
     *
     * The alternative was one shared pair at the suggestion row's numbers. It was
     * rejected on measurement: the deck rail's container is one 1fr track of
     * `minmax(230px, 1fr) minmax(0, 2.4fr) minmax(230px, 1fr)`, which puts it at
     * 286px on an ordinary 1400px laptop — above the deck row's own mana
     * threshold and below the suggestion row's, so a shared number would strip
     * the mana cost off every deck row on that screen to solve a problem the deck
     * rail does not have.
     */
    const deckPrice = shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.cash/)
    const deckMana = shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.mana/)
    expect(price()).toBeGreaterThan(deckPrice)
    expect(mana()).toBeGreaterThan(deckMana)
  })

  it('puts the shedding rules after the rules they override', () => {
    /*
     * A `@container` block adds NOTHING to specificity, so a `display: none`
     * inside one loses the tie to a later `display: flex` at equal specificity
     * and does nothing at all. The mana rule sat above its own base rule and
     * was dead the whole time — the four-column comment in this sheet recorded
     * it as a defect belonging to whoever owned the row.
     *
     * The `:has()` in the shedding selectors now wins on specificity as well, so
     * order is no longer the only thing holding this up. It is still asserted:
     * the day someone drops the `:has()` for a shared threshold again, order is
     * all that is left.
     *
     * `.cash` never had the problem: its base rule declares no `display`.
     */
    const base = css.search(/\.card-row \.mana \{[^}]*display:\s*flex/)
    const shed = css.search(/@container \(max-width:\s*\d+px\)\s*\{\s*\.card-row[^{]*\.mana/)
    expect(base).toBeGreaterThan(-1)
    expect(shed).toBeGreaterThan(base)
  })

  it('sizes the metric cell for its widest value rather than truncating it', () => {
    /*
     * ADR-0025 §2 keeps the number unrounded, so the cell has to fit `13.464`
     * — measured at 41px in this font, inside a 3.1rem floor. An ellipsis in a
     * number is not a shorter number, it is a wrong one, so there must be no
     * `text-overflow` on this cell.
     */
    const rule = /\.card-row \.metric-cell \{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    const body = rule?.[1] ?? ''
    expect(body).toMatch(/min-width:\s*3\.1rem/)
    expect(body).not.toMatch(/text-overflow/)
    // Ragged decimal counts are exactly what proportional digits ruin.
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })
})

/**
 * Where the row stops buying width by dropping cells and buys it with a line.
 *
 * READABLE, IN PIXELS, MEASURED. Every card name in the corpus — 34,442 distinct
 * names — drawn with `measureText` in `.card-row .name`'s own resolved font
 * (Karla 400 15px), and the width at which the WHOLE name fits taken as a
 * distribution: p50 116.4px, p75 138.6px, p90 164.2px, p95 182.5px. 165px is the
 * ninetieth percentile and is the number this file calls readable.
 *
 * The 5rem floor is a different number doing a different job, and the two must
 * not be confused. 80px is where a name stops DISTINGUISHING one card from
 * another: the shortest corpus-unique prefix, plus its ellipsis, is under 80px
 * for 70% of cards (p90 97.2px). 80px is therefore a defensible floor against
 * overflow and is not a readable width — at 80px a whole name is shown for 10.7%
 * of the corpus. The user's report is exactly that distinction: "the add/remove
 * buttons and mv etc… cause the name to clip beyond what is readable."
 *
 * AND THE CHAIN NEVER REACHES 165. Measured across the running app, at the best
 * pixel of each shed the name is 137.6px (efficiency), 137.2px (impact), 141.6px
 * (price) and 161.1px (mana) — and by the next threshold it is back at 80. Its
 * mean over the whole band is about 113px, at which 45% of names read whole. So
 * shedding cannot deliver a readable name at any width; it can only postpone
 * overflow. That is the finding these thresholds are built on.
 */
describe('a row stops competing for one line and takes two', () => {
  it('gives the name a line of its own', () => {
    /*
     * WHAT STACKS, AND INTO WHAT. Line one is the name; line two is everything
     * that comments on it, still in its own order and still against the row's
     * right edge, so the number columns read straight down the list exactly as
     * they did. A stacked row is this row with the name lifted out of it.
     *
     * The combo badge stays on line one, beside the name. It is the row's
     * left-edge signature — the only brass on the page — and reading it down the
     * list is why it is a column rather than a chip. Its basis is written as the
     * badge's own `min-width` plus the row's own `gap` rather than as the 32.8px
     * those come to, so it moves when they do.
     *
     * REJECTED: giving the name the full 100% and letting the badge fall to the
     * second line. It reads as a property of the controls there rather than of
     * the card, and the left column stops existing.
     *
     * REJECTED: bringing a shed metric cell back onto the second line, which at
     * a 375px container has room for exactly one. A column that REAPPEARS as the
     * window narrows cannot be read as a shedding order at all.
     */
    const feed = new RegExp(
      `@container \\(max-width: ${String(stacks.suggestion())}px\\)` +
        `[\\s\\S]*?\\.card-row:has\\(\\.name-cell\\) > \\.name-cell\\s*\\{([^}]*)\\}`,
    ).exec(css)
    expect(feed).not.toBeNull()
    // The badge's `min-width` and the row's `gap`, not the number they make.
    expect(feed?.[1]).toMatch(/flex-basis:\s*calc\(100% - 1\.55rem - var\(--step\)\)/)

    const rail = new RegExp(
      `@container \\(max-width: ${String(stacks.deck())}px\\)` +
        `[\\s\\S]*?\\.card-row:not\\(:has\\(\\.name-cell\\)\\) > \\.name\\s*\\{([^}]*)\\}`,
    ).exec(css)
    expect(rail).not.toBeNull()
    // A deck row has no badge, so its name takes the whole line.
    expect(rail?.[1]).toMatch(/flex-basis:\s*100%/)
  })

  it('stacks exactly where a shed would stop being worth its cell', () => {
    /*
     * The two thresholds are the price's old ones, unmoved, and that is the
     * point rather than a coincidence: the rule the chain follows has not
     * changed. At each threshold the row can no longer hold a floored name
     * beside what it carries. Only the remedy changes, and it changes at the
     * step where the cheap cells have run out — past the price there is nothing
     * left on either shape but the name, the cost you pay every game and the two
     * decision buttons.
     */
    const { badge, mana, price, add, reject, lock, remove } = measured
    shedsExactlyWhenItMust(stacks.suggestion(), needs(badge, mana, price, add, reject))
    shedsExactlyWhenItMust(stacks.deck(), needs(mana, price, lock, remove))
  })

  it('asks for more room than a deck row does, for the same reason it always did', () => {
    // A suggestion row carries a combo badge, Add and Reject where a deck row
    // carries lock and remove — 110px against 85, plus a gap — so it runs out of
    // one-line width 33px of container earlier, every time.
    expect(stacks.suggestion() - stacks.deck()).toBe(33)
  })

  it('keeps both numbers the one-line row would have had to drop', () => {
    /*
     * The whole case for spending a line. Stacking is not a cheaper shed, it is
     * the alternative to one: at the width where a one-line row would be down to
     * a name and two buttons, a stacked row is showing the name whole AND the
     * mana cost AND the price.
     */
    expect(shedsAt(/\.card-row:has\(\.name-cell\) \.cash/)).toBeLessThan(stacks.suggestion())
    expect(shedsAt(/\.card-row:has\(\.name-cell\) \.mana/)).toBeLessThan(stacks.suggestion())
    expect(shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.cash/)).toBeLessThan(stacks.deck())
    expect(shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.mana/)).toBeLessThan(stacks.deck())
  })

  it('is a container query, like everything else that depends on a column', () => {
    // The rails are sized by the workspace grid and by wherever the divider has
    // been dragged, so the viewport does not know their width. A `@media` rule
    // here would stack a wide screen's dragged-narrow rail's neighbours too, and
    // leave a phone's rows on one line.
    expect(css).toMatch(new RegExp(`@container \\(max-width: ${String(stacks.suggestion())}px\\)`))
    expect(css).toMatch(new RegExp(`@container \\(max-width: ${String(stacks.deck())}px\\)`))
  })
})

/**
 * The masthead is the other surface where the left and the right collide.
 *
 * A `@media` query here, not a `@container` one, and the asymmetry with the rows
 * is deliberate: the masthead spans the layout viewport by construction. Nothing
 * can drag it narrower, so the viewport does know its width.
 */
describe('the masthead stacks into two groups', () => {
  const sheet = strip(join(here, 'styles.css'))

  /** The `max-width` of the `@media` block that breaks the masthead in two. */
  const threshold = (): number => {
    const found = /@media \(max-width:\s*(\d+)px\)\s*\{[^@]*?\.masthead::after/.exec(sheet)
    expect(found).not.toBeNull()
    return Number(found?.[1])
  }

  it('keeps the tools together, on a line of their own', () => {
    /*
     * It already wrapped — `flex-wrap: wrap` has been on this rule the whole
     * time — and wrapping was never the problem. Measured on the running app
     * with doc 20 §20.4's control set, at a 1300px masthead it wrapped BETWEEN
     * Quickbuild and Help; at 500px it left the overflow trigger alone on a line
     * of its own; at 320px it produced six lines and 274px of sticky height, on
     * a screen with 568px of it to spend.
     *
     * A zero-height flex item ordered between the two groups is what makes the
     * break happen in one place. The alternative was a `<div>` around the
     * buttons in `App.tsx`, and it was rejected on ownership rather than on
     * mechanism: that file is being edited by the Quickbuild work at the same
     * spot, and a wrapper is a merge conflict where a pseudo-element is not.
     */
    const body =
      /@media \(max-width:\s*\d+px\)\s*\{(\s*\.masthead[\s\S]*?\.masthead > \.overflow-menu\s*\{[^}]*\})/.exec(
        sheet,
      )?.[1]
    expect(body).toBeDefined()
    // The break is a full-width flex item with no height of its own.
    expect(body).toMatch(/\.masthead::after\s*\{[^}]*flex-basis:\s*100%/)
    expect(body).toMatch(/\.masthead::after\s*\{[^}]*height:\s*0/)
    // Ordered between the two groups, so the tools land after it.
    expect(body).toMatch(/\.masthead::after\s*\{[^}]*order:\s*1/)
    /*
     * BOTH kinds of tool are ordered onto the second line, and the second half
     * is the one that is easy to miss. Graph, Quickbuild and Help are `.act`
     * children of the masthead; the overflow trigger (doc 20 A1) is an `.act`
     * inside a positioning wrapper, so `.masthead > .act` does not reach it.
     * Without the wrapper in this rule the menu keeps the default order of 0
     * and lands on line ONE beside the bracket chip — the tools cut in half,
     * which is the exact collision this block exists to remove.
     */
    expect(body).toMatch(/\.masthead > \.act,\s*\.masthead > \.overflow-menu\s*\{[^}]*order:\s*2/)
    /*
     * `gap` applies on both axes, so a zero-height line between two lines is
     * still a line with a gap on each side of it — measured, 32px where the
     * reader should see one gap's worth. Halving `row-gap` while the break is
     * present puts the two groups one gap apart and leaves half a gap between
     * lines within a group.
     *
     * The obvious trick — a negative `margin-block` on the break — is not here
     * because it does nothing: Chrome clamps a flex line's cross size at zero,
     * and the masthead measured 120.7px with it and 120.7px without.
     */
    expect(body).toMatch(/\.masthead\s*\{[^}]*row-gap:\s*var\(--step\)/)
    expect(body).not.toMatch(/margin-block/)
  })

  it('breaks exactly where the row can no longer be one line', () => {
    /*
     * DERIVED, and every part measured on the running app. The masthead is one
     * line while its padding, the wordmark, a floored deck name, the progress
     * bar at its own minimum, the card count, the bracket chip in its widest
     * state and the four tools all fit with eight gaps between nine children.
     *
     * The control set is doc 20 §20.4's, not the five this work was first given:
     * Import and Export moved behind an overflow trigger (A1), so the row is
     * Graph, Quickbuild, Help and a menu. Derived against five it would have
     * broken 87px of viewport earlier than it needs to.
     */
    const {
      padding,
      wordmark,
      nameFloor,
      progress,
      count,
      chip,
      graph,
      quickbuild,
      help,
      overflow,
      gap,
      scrollbar,
    } = masthead
    /*
     * Rounded to the tenth, which is the precision every measurement above was
     * taken at. Unrounded these sum to 1159.0000000000002 in binary floating
     * point, and the derivation would ask for a masthead one ten-trillionth of a
     * pixel wider than the one that fits — the threshold would come out a pixel
     * early for a reason nothing on screen could show.
     */
    const oneLine =
      Math.round(
        (padding +
          wordmark +
          nameFloor +
          progress +
          count +
          chip +
          graph +
          quickbuild +
          help +
          overflow +
          8 * gap) *
          10,
      ) / 10

    /*
     * Two-sided, so this pins a single integer. A media query matches on
     * `innerWidth` and the masthead gets `clientWidth`, so the scrollbar sits
     * between the number in the sheet and the number being derived.
     */
    expect(threshold() + 1 - scrollbar).toBeGreaterThanOrEqual(oneLine)
    expect(threshold() - scrollbar).toBeLessThan(oneLine)
  })

  it('lets the deck name yield with an ellipsis instead of breaking the line', () => {
    /*
     * Without this the threshold above is not a threshold at all: the deck's
     * name is user text of unbounded length, and while it could push the line
     * over on its own the masthead would wrap raggedly at a width no arithmetic
     * could name. Measured: this deck's name is 374.6px and wrapped the masthead
     * at 1330px, 155px above where the fixed furniture says it should.
     *
     * So the deck name gets the SAME 5rem floor a card name gets, and yields the
     * same way. One number, two surfaces — which is also why the floor is
     * asserted here against the row's rather than written down again.
     */
    const rule = /\.deck-menu \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(rule).toMatch(/min-width:\s*5rem/)
    const cardName = /\.card-row > \.name,\s*\.card-row > \.name-cell \{([^}]*)\}/.exec(sheet)?.[1]
    expect(cardName).toBeDefined()
    expect(px(/min-width:\s*([^;]+)/.exec(rule)?.[1] ?? '0')).toBe(
      px(/min-width:\s*([^;]+)/.exec(cardName ?? '')?.[1] ?? '-1'),
    )
    // And it has to be able to clip, or the floor only makes it overflow.
    const label = /\.deck-handle > \.meta \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(label).toMatch(/overflow:\s*hidden/)
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
    expect(label).toMatch(/white-space:\s*nowrap/)
  })

  it('leaves the overflow trigger the bare .act the threshold was derived against', () => {
    /*
     * 25.9px is the smallest term in the derivation above and the easiest one
     * to inflate by accident. It is a bare `.act` — 2px/7px of padding, a 1px
     * border, one ⋯ at 0.72rem — and a `min-width`, a little breathing room or
     * a bigger glyph would each move the threshold while leaving the comment
     * that explains it standing.
     *
     * So the trigger is pinned to declare NOTHING that changes its box. This
     * is not a ban: it is a tripwire. If the button genuinely needs a width,
     * `masthead.overflow` above moves with it and the threshold is re-derived.
     */
    /*
     * The POSITIVE half first, because the negative half alone was worthless:
     * there is no `.overflow-trigger` rule in this sheet at all, so a regex
     * looking for one yielded `''` and every `not.toMatch` below passed
     * against an empty string. It would have passed just as happily against
     * `.act.overflow-trigger { padding: 1rem }`.
     *
     * 25.9px IS a `.act`'s box — its padding, its border and its font around a
     * single ⋯ — so those are what the threshold actually rests on, and moving
     * any of them moves it.
     */
    const act = /(?:^|\n)\.act \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(act).toMatch(/padding:\s*2px 7px/)
    expect(act).toMatch(/font-size:\s*0\.72rem/)
    expect(act).toMatch(/border:\s*1px solid/)

    /*
     * And now the tripwire, over EVERY rule whose selector mentions the
     * trigger rather than over one regex's idea of the rule — grouped
     * selectors, descendant selectors and `.act.overflow-trigger` all count.
     */
    const boxy = /(?:^|;)\s*(?:width|min-width|padding|font-size|border-width|border)\s*:/
    const offenders: string[] = []
    for (const rule of sheet.matchAll(/([^{}@]+)\{([^}]*)\}/g)) {
      if (!rule[1]!.includes('.overflow-trigger')) continue
      if (boxy.test(rule[2]!)) offenders.push(rule[1]!.trim())
    }
    expect(offenders).toEqual([])
    // Nor does the wrapper the trigger sits in, which is the masthead's actual
    // flex item and so the box the wrap calculation sees.
    // Anchored to the start of a line, or this matches the `.masthead >
    // .overflow-menu` ordering rule in the media query instead — which is a
    // real rule about a different question, and it would have passed the
    // "declares no width" half vacuously.
    const wrapper = /(?:^|\n)\.overflow-menu \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(wrapper).toMatch(/flex:\s*0 0 auto/)
    for (const property of ['width', 'min-width', 'padding']) {
      expect(wrapper).not.toMatch(new RegExp(`(?:^|;)\\s*${property}\\s*:`))
    }
  })
})

/**
 * The tour's overlay, which must not clip (doc 20 §20.6).
 *
 * The lesson this repo already paid for once: `.region` carries
 * `container-type: inline-size`, which makes it a containing block for
 * fixed-position descendants, and `.analysis-scroll` is `overflow-y: auto`. No
 * `z-index` defeats either — clipping is not stacking. The hints were moved
 * into the top layer for exactly this, and the tour uses the same mechanism.
 *
 * jsdom cannot see a clip, so what is pinned here is the half that IS in the
 * sheet: that the layer undoes the UA's `[popover]` box instead of inheriting
 * a centred, bordered, opaque one. The clipping itself was checked in a browser
 * and is recorded in doc 20 §20.8.
 */
describe('the tour overlay', () => {
  const sheet = strip(join(here, 'styles.css'))
  const layer = /\.tour-layer \{([^}]*)\}/.exec(sheet)?.[1] ?? ''

  it('covers the viewport rather than being centred as a fit-content box', () => {
    // The UA sheet gives `[popover]` `inset: 0; width: fit-content; margin:
    // auto`, which would draw the whole tour as a small box in the middle.
    expect(layer).toMatch(/position:\s*fixed/)
    expect(layer).toMatch(/inset:\s*0/)
    expect(layer).toMatch(/width:\s*100%/)
    expect(layer).toMatch(/height:\s*100%/)
    expect(layer).toMatch(/margin:\s*0/)
  })

  it('undoes the UA popover chrome, which would otherwise draw over the page', () => {
    expect(layer).toMatch(/border:\s*0/)
    expect(layer).toMatch(/padding:\s*0/)
    // `background: canvas` is opaque, and would hide the very regions the tour
    // exists to point at.
    expect(layer).toMatch(/background:\s*none/)
    // `overflow: auto` on the layer would clip the spotlight at its own edge,
    // which is the bug being avoided, reintroduced one level up.
    expect(layer).toMatch(/overflow:\s*visible/)
  })

  it('clears the masthead and the deck menu on the no-popover fallback path', () => {
    const z = Number(/z-index:\s*(\d+)/.exec(layer)?.[1])
    const mastheadZ = Number(/\.masthead\s*\{[^}]*z-index:\s*(\d+)/.exec(sheet)?.[1])
    const deckPopZ = Number(/\.deck-pop \{[^}]*z-index:\s*(\d+)/.exec(sheet)?.[1])
    expect(z).toBeGreaterThan(mastheadZ)
    expect(z).toBeGreaterThan(deckPopZ)
  })

  /*
   * The collision this whole file exists for, in a new place.
   *
   * "Step 3 of 7" is a `<p>` inside `.tour-card`, so a bare `.tour-progress`
   * (0-1-0) loses to `.tour-card p` (0-1-1) on specificity AND on order — the
   * micro-label was silently rendering at the body's 0.86rem with a full
   * paragraph's bottom margin, keeping only the colour, tracking and caps that
   * `.tour-card p` does not set. Resolved through the same cascade walker that
   * caught the basic-land row, rather than by reading the rule and trusting it.
   */
  it('lets the step counter keep its own type size against .tour-card p', () => {
    document.body.innerHTML = `
      <div class="tour-card">
        <p class="tour-progress">Step 3 of 7</p>
        <h2>The scoreboard</h2>
        <p>Composition, curve, combos and bracket.</p>
      </div>`
    const label = document.querySelector('.tour-progress')!
    expect(winner(label, 'font-size')?.value).toBe('0.72rem')
    expect(winner(label, 'margin')?.value).toBe('0 0 calc(var(--step) / 2)')
    // And the body paragraph beside it is untouched.
    const body = document.querySelectorAll('.tour-card p')[1]!
    expect(winner(body, 'font-size')?.value).toBe('0.86rem')
  })

  it('draws the dim and the hole as one box, so they cannot drift apart', () => {
    const spot = /\.tour-spot \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    // One enormous spread shadow IS the scrim. A second element for the dim
    // would have to be kept in register with this one through every scroll.
    expect(spot).toMatch(/box-shadow:\s*0 0 0 100vmax/)
    expect(spot).toMatch(/border:\s*2px solid var\(--brass\)/)
  })

  it('does not animate the spotlight, which is what keeps it on its region', () => {
    /*
     * A tripwire, and the reason is a mechanism rather than a measurement.
     *
     * The spotlight had a 180ms transition on left/top/width/height.
     * `Tour.tsx` repositions the box on every `scroll` event — a top-layer
     * element does not move with the page behind it — and every step begins
     * with a smooth scroll that fires one per frame. Each of those restarts
     * the transition from wherever it had got to, so the ring trails the page
     * for the whole scroll and settles 180ms after it stops. The animation
     * fights the listener that exists to keep the ring ON its region.
     *
     * What was seen in a browser, with its cause, since the cause is not the
     * ordinary one: at a 1320px viewport step 7's ring was still drawn as the
     * deck rail's 10,805px column while the inline style already read 85.6 ×
     * 35.3, and `transition: none` snapped it to 86 × 35 in the same frame —
     * in a window that turned out to be occluded, where transitions are
     * suspended altogether.
     *
     * `prefers-reduced-motion` is honoured in `Tour.tsx` instead, on the scroll
     * itself, which is where A2 puts it and the only motion the tour has left.
     */
    const spot = /\.tour-spot \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(spot).not.toMatch(/(?:^|;)\s*transition\s*:/)
    expect(spot).not.toMatch(/(?:^|;)\s*animation\s*:/)
    // And nothing sneaks one back in from a media block either.
    for (const block of sheet.matchAll(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g,
    )) {
      expect(block[1]).not.toContain('.tour-spot')
    }
  })
})

describe('a hint panel is prose wherever its trigger lives', () => {
  /*
   * THE REGRESSION, found in a browser and not by any test. `text-transform`
   * and `letter-spacing` inherit, and the top layer does not stop them — the
   * panel is painted above everything but is still a DOM descendant of its
   * trigger. The metric explainers (doc 18 §18.14) put a trigger inside
   * `.rt-metric-label`, which is `text-transform: uppercase` with tracking, and
   * seven lines of explanation rendered SHOUTING IN CAPS WITH GAPPED LETTERS.
   *
   * Pinned here rather than at the call site because the next hint anchored in
   * a heading, a label or a badge would hit exactly the same thing.
   */
  const body = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`)
    expect(at).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('resets the two properties that inherit into it from a label', () => {
    expect(body('.hint-pop')).toMatch(/text-transform:\s*none/)
    expect(body('.hint-pop')).toMatch(/letter-spacing:\s*normal/)
  })

  it('is anchored in something that really does transform its text', () => {
    // The control. If `.rt-metric-label` ever stops shouting, the reset above
    // is still harmless but this test should be the thing that says so rather
    // than leaving a rule nobody can explain.
    expect(body('.rt-metric-label')).toMatch(/text-transform:\s*uppercase/)
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
     * The grid's own floor for the side rails is 230px, and the deck rail asks
     * for more. It used to ask for 310 because that was where the row stopped
     * SPILLING; then for 313, the width at which the rail could still SHOW the
     * mana cost on one line.
     *
     * Neither reason survives the row stacking. A stacked deck row keeps BOTH
     * its numbers on its second line down to a 255px container and the mana cost
     * alone down to 193, so the mana cost is no longer what is at stake at any
     * width this grid can produce. What the track has to clear now is the
     * SECOND line's price threshold: 254 + 1 + 32 = 287px of column, below which
     * the four-column layout would be paying for a detail panel with the price
     * off every row behind it.
     *
     * TWO-SIDED, because a floor asserted only from below is satisfied by any
     * number large enough to starve the feed. The upper bound is the feed's own:
     * whatever this track takes, the feed must still be left more than the
     * column at which IT stops fitting on one line. 313 sits inside [287, 326],
     * and it is left where it is deliberately — moving it would move the 1320px
     * threshold below, which is another decision's number and not this one's.
     *
     * Read off the sheet rather than written down, so retuning either row's
     * thresholds moves this with them. `.region` pads `calc(var(--step) * 2)` a
     * side, so a column is 32px wider than its query container.
     */
    const railSecondLine = shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.cash/)
    const rail = floorPx(tracks()[0] ?? '')
    expect(rail).toBeGreaterThanOrEqual(railSecondLine + 1 + 32)

    const four = tracks()
    const feedFloor = stacks.suggestion() + 1 + 32
    const layout = threshold() - 17 - 3
    expect(rail).toBeLessThanOrEqual(
      layout - feedFloor - floorPx(four[2] ?? '') - floorPx(four[3] ?? ''),
    )
  })

  it('opens the column only where all four columns still fit', () => {
    /*
     * The derivation, executable so it cannot drift from the comment beside it.
     *
     * Every floor here comes from the row rather than from a `minmax`: the feed
     * is the width at which a suggestion row stops fitting on one line, 32px of
     * region padding above that threshold; the deck rail is the track asserted
     * above; 230px for the analysis rail, which does hold its declared floor.
     * The detail column is the panel's own 21rem.
     *
     * The feed's floor is the SAME PIXEL it has been through two re-derivations
     * and means something different again. It was 400 — "the width below which
     * the name is crushed" — then 407, the price's threshold plus the region's
     * padding. 407 is now the stacking threshold plus the same padding: the
     * price no longer leaves a suggestion row at 375, the row takes a second
     * line there instead, and the price rides down with it. The number did not
     * move because the arithmetic that produced it did not: 375 is still the
     * width at which the row can no longer hold a floored name beside its cells.
     * Only what the row DOES about it changed.
     *
     * The scrollbar allowance is not slop. Chrome resolves a media query against
     * `innerWidth`, which on Windows includes the classic scrollbar that the
     * layout viewport does not get — measured on the running app at
     * `clientWidth` 2545 with `(min-width: 2546px)` matching.
     */
    const four = tracks()
    const feedFloor = stacks.suggestion() + 32
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
     * the column opens, and a feed that RESTACKED every row the moment you click
     * one would be a far worse experience than the overlay was — the whole list
     * would change shape under the cursor that clicked it.
     *
     * THIS PROMISE WAS NOT RENEGOTIATED WHEN THE ROW LEARNED TO STACK, and it
     * did not need to be. It is the same assertion against the same number: the
     * feed at the threshold must be wider than the column at which a suggestion
     * row stops fitting on one line. What changed is that the number now bounds
     * something bigger. It used to promise the price survives an open; it now
     * promises the row's SHAPE survives one, and the price with it, because the
     * price rides down onto the second line rather than leaving.
     *
     * Measured on the running app, with the four-column grid forced so it could
     * be reproduced at this machine's fixed viewport: at a 1303px layout
     * viewport — 1320 innerWidth less a 17px classic scrollbar — the feed's query
     * container is 389px against the 375 at which it would stack. Fourteen
     * pixels. It would take a 31px scrollbar to close that, and Windows' classic
     * scrollbar is 15 to 17.
     *
     * The metric cells are a different matter and are not covered here. Opening
     * the pane does hide both of them — 389px of container against the 433
     * impact alone needs — and that cost is stated where the thresholds are
     * derived. The panel draws both numbers in full for the card being decided.
     */
    const columnAtWhichItStacks = stacks.suggestion() + 32
    const four = tracks()
    const feed =
      threshold() -
      17 -
      3 -
      floorPx(four[2] ?? '') -
      floorPx(four[0] ?? '') -
      floorPx(four[3] ?? '')
    expect(feed).toBeGreaterThan(columnAtWhichItStacks)
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

/*
 * The report: "the quickbuild detail pane borders are weirdly not filling their
 * parent pane, and each one is different dimensions so it looks very
 * disorganized".
 *
 * It was two boxes deep. `Detail` draws its own framed card — `.rt-detail`
 * carries a border, a radius, a background and 12px of padding, because in the
 * detail column that frame IS the panel — and Quickbuild mounts three of them
 * inside three `<li>` boxes that carry a frame of their own. Six frames for
 * three cards. The outer three are grid items and stretch to the tallest of the
 * row; the inner three are ordinary blocks sized to their own text, so a card
 * with four lines of oracle text and a vanilla creature drew two visibly
 * different rectangles floating inside two identical ones.
 *
 * Nothing about Q4's responsive rule was wrong: `repeat(auto-fit, minmax(15rem,
 * 1fr))` collapses its empty tracks, so three options always take three equal
 * full-width columns however wide the pane is. The raggedness was entirely
 * inside them.
 */
describe('the three Quickbuild options are one box each, not a box in a box', () => {
  const trio = (): HTMLElement => {
    document.body.innerHTML = `
      <ul class="quickbuild-options">
        <li class="quickbuild-option is-focused">
          <div class="rt-detail">
            <div class="rt-detail-head"><h3 class="rt-detail-name">Short</h3></div>
            <div class="rt-detail-body"><p class="rt-detail-oracle">One line.</p></div>
          </div>
          <p class="quickbuild-group">Offered under Fills gap · ramp</p>
        </li>
        <li class="quickbuild-option">
          <div class="rt-detail">
            <div class="rt-detail-head"><h3 class="rt-detail-name">Long</h3></div>
            <div class="rt-detail-body"><p class="rt-detail-oracle">Four lines of it.</p></div>
          </div>
          <p class="quickbuild-group">Offered under Fills gap · ramp</p>
        </li>
      </ul>`
    return document.body.querySelector('.quickbuild-options')!
  }

  const outer = (): Element => trio().querySelector('.quickbuild-option')!
  const inner = (): Element => trio().querySelector('.quickbuild-option > .rt-detail')!

  it('gives the inner card no frame of its own', () => {
    // `card.css` sets all four; each one has to lose to this app's sheet, and
    // the app's rule is later AND more specific, so it does.
    expect(winner(inner(), 'border')?.value).toBe('0')
    expect(winner(inner(), 'background')?.value).toBe('none')
    expect(winner(inner(), 'padding')?.value).toBe('0')
    expect(winner(inner(), 'border-radius')?.value).toBe('0')
  })

  it('keeps the frame on the option itself, where the focus rule lives', () => {
    // Not "delete both borders": the left rule is how the focused option is
    // marked without relying on colour (§19.5), so the outer box must keep one.
    expect(winner(outer(), 'border')?.value).toContain('var(--rule)')
    expect(winner(outer(), 'border-left')?.value).toContain('var(--rule)')
    document.body.innerHTML = `<li class="quickbuild-option is-focused"></li>`
    const focused = document.body.querySelector('.quickbuild-option')!
    expect(winner(focused, 'border-left-color')?.value).toBe('var(--brass)')
  })

  /*
   * The half a stylesheet cannot win by specificity, and the half that was
   * actually visible: `Detail` renders `style={{ width: w }}` with `w`
   * defaulting to `levelSpec(3).width`, so every option carried a hard inline
   * `width: 340px`. Measured in the running app at 1600 px: 340 px of card
   * inside a 446 px box, three times, leaving a 106 px strip of empty pane down
   * the right of each. Inline beats a stylesheet, so this is `!important` for
   * the same reason `.preview-art .rt-face` is.
   */
  it('overrides the width Detail sets inline, which no selector can outrank', () => {
    const declared = /\.quickbuild-option > \.rt-detail\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(declared).toMatch(/width:\s*100%\s*!important/)
  })

  it('lets the inner card fill the box the grid gave the option', () => {
    // A grid item stretches; a block inside it does not. The option has to be a
    // flex column before anything in it can take the height.
    expect(winner(outer(), 'display')?.value).toBe('flex')
    expect(winner(outer(), 'flex-direction')?.value).toBe('column')
    expect(winner(inner(), 'flex')?.value).toBe('1 1 auto')
    /*
     * And `min-height: 0`, or the flex item refuses to shrink below its own
     * content and `.rt-detail-body`'s `overflow-y: auto` never engages — every
     * box would then be as tall as the wordiest card rather than the row's
     * height. Equal, but equal in the wrong direction.
     */
    expect(winner(inner(), 'min-height')?.value).toBe('0')
  })

  /*
   * The ending puts two buttons in this row where the loop puts one, and
   * measured in a browser they take 184px and 134px against a 326px row at the
   * 360px pane. They fit there, with both labels already on two lines — but
   * `nowrap` would crush rather than stack them at anything narrower or at a
   * larger text size, and neither is the primary action.
   */
  it('lets the ending’s two buttons stack rather than crush', () => {
    document.body.innerHTML = `<div class="quickbuild-actions"></div>`
    const actions = document.body.querySelector('.quickbuild-actions')!
    expect(winner(actions, 'display')?.value).toBe('flex')
    expect(winner(actions, 'flex-wrap')?.value).toBe('wrap')
  })

  it('gives every option the same width and the same height', () => {
    // `1fr` tracks are equal by construction, and `auto-fit` collapses the
    // empty ones so three options always take the full width of the pane.
    expect(winner(trio(), 'grid-template-columns')?.value).toBe(
      'repeat(auto-fit, minmax(15rem, 1fr))',
    )
    expect(winner(trio(), 'align-items')?.value).toBe('stretch')
  })
})
