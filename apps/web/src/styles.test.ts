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

  it('lets the price step aside before the name does', () => {
    // A CONTAINER query, not a media query: the rail's width comes from the
    // workspace grid and the draggable divider, so the viewport does not know
    // it. A `@media` rule would hide the price on a wide screen with a narrow
    // rail, and show it on a phone.
    expect(css).toMatch(/container-type:\s*inline-size/)
    expect(css).toMatch(
      new RegExp(
        `@container \\(max-width: ${String(price())}px\\)\\s*\\{\\s*` +
          `\\.card-row:not\\(:has\\(\\.name-cell\\)\\) \\.cash\\s*\\{\\s*display:\\s*none`,
      ),
    )
  })

  it('drops the mana cost only at a width below the price threshold', () => {
    // Order matters: the price is an estimate that goes stale in a day and is
    // repeated in the deck total, so it goes first.
    expect(mana()).toBeLessThan(price())
  })

  it('sheds each of them exactly where the name would otherwise give way', () => {
    /*
     * DERIVED, and this is the derivation. A deck row is name, mana cost, price,
     * lock and remove; the two thresholds are the widths at which the price and
     * then the mana cost stop fitting beside a name at its 5rem floor.
     *
     * These numbers used to be 320 and 250, which are neither row's. Measured in
     * Chrome before the change: at a 331px rail container — a 1600px viewport,
     * ordinary — the price was still shown and the Remove button finished 12px
     * OUTSIDE the rail, on top of the feed. The spill reached 21px at 251.
     */
    const { mana: m, price: p, lock, remove } = measured
    shedsExactlyWhenItMust(price(), needs(m, p, lock, remove))
    shedsExactlyWhenItMust(mana(), needs(m, lock, remove))
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

  it('keeps the price after both metrics have gone', () => {
    /*
     * This reverses the row's old order, and the reason is arithmetic rather
     * than taste. At the width the detail pane leaves the feed, the row is
     * already at the name's floor with no metric cells on it, so dropping the
     * price frees nowhere near what two more numbers need — the metrics have
     * to go at that width whatever else does, and taking the price as well
     * would shed more than the row asks for.
     */
    expect(impact()).toBeGreaterThan(price())
  })

  it('drops the mana cost last of the four', () => {
    // What you pay every game, against three numbers that are commentary on it.
    expect(mana()).toBeLessThan(price())
  })

  it('never keeps a number at the cost of the card’s name', () => {
    /*
     * All four thresholds are DERIVED, and this is the derivation, executable so
     * it cannot drift from the sheet. A suggestion row is the combo badge, the
     * name cell, the mana cost, the metric cells, the price, Add and Reject; each
     * threshold is the last width at which that cell has to be gone already for
     * the name to keep its 5rem.
     *
     * The two metric thresholds moved by two pixels here (489→491, 431→433) and
     * the movement is the row's border: `* { box-sizing: border-box }` means the
     * container width has to pay for `border: 1px solid transparent` on each
     * side, and the earlier derivation left it out. Measured in Chrome at a 490px
     * feed container with efficiency still shown, the name cell was 79px — one
     * pixel under its floor, which nothing could see while the floor was on an
     * element the row does not flex.
     */
    const { badge, mana: m, metric, price: p, add, reject } = measured
    shedsExactlyWhenItMust(efficiency(), needs(badge, m, metric, metric, p, add, reject))
    shedsExactlyWhenItMust(impact(), needs(badge, m, metric, p, add, reject))
    shedsExactlyWhenItMust(price(), needs(badge, m, p, add, reject))
    shedsExactlyWhenItMust(mana(), needs(badge, m, add, reject))
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
     * SPILLING — with the mana rule dead, at 230px the Remove button finished
     * 58px outside the column, on top of the feed.
     *
     * That rule fires now, and the rail's own thresholds are derived, so a spill
     * is no longer what sets this floor: a deck row that has shed its price and
     * its mana cost holds its name down to a 231px column. The floor asked for
     * here is the narrower thing — the width at which the rail can still SHOW the
     * mana cost, which is the one number on a deck row that is not repeated
     * somewhere else on the page. One pixel less and the four-column layout would
     * be paying 336px for a detail panel by taking the mana column off every row
     * behind it.
     *
     * Read off the sheet rather than written down, so retuning the rail's
     * threshold moves this with it. `.region` pads `calc(var(--step) * 2)` a
     * side, so the column is 32px wider than its query container.
     */
    const railMana = shedsAt(/\.card-row:not\(:has\(\.name-cell\)\) \.mana/)
    expect(floorPx(tracks()[0] ?? '')).toBeGreaterThanOrEqual(railMana + 1 + 32)
  })

  it('opens the column only where all four columns still fit', () => {
    /*
     * The derivation, executable so it cannot drift from the comment beside it.
     *
     * Every floor here comes from the row rather than from a `minmax`: the feed
     * is the width at which a suggestion row would drop its price, 32px of region
     * padding above that threshold; the deck rail is the track asserted above;
     * 230px for the analysis rail, which does hold its declared floor. The detail
     * column is the panel's own 21rem.
     *
     * The feed's floor used to be 400px, and 400 meant "the width below which the
     * name is crushed". It cannot mean that any more — the name is floored at
     * every width now — so the number is re-derived from the last cell the feed
     * can afford to lose rather than left standing with a reason that no longer
     * describes it.
     *
     * The scrollbar allowance is not slop. Chrome resolves a media query against
     * `innerWidth`, which on Windows includes the classic scrollbar that the
     * layout viewport does not get — measured on the running app at
     * `clientWidth` 2545 with `(min-width: 2546px)` matching.
     */
    const four = tracks()
    const feedFloor = shedsAt(/\.card-row:has\(\.name-cell\) \.cash/) + 32
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
     * click a card would be a worse experience than the overlay was.
     *
     * This is the same number the test above uses as the feed's floor, and that
     * is the point rather than an oversight: the feed's floor IS the price, and
     * the reason it is the price is this promise. The two tests fail together and
     * say different things about why, which is what a reader arriving at a red
     * threshold needs.
     *
     * The metric cells are a different matter and are not covered here. Opening
     * the pane does hide both of them — 394px of container against the 433 impact
     * alone needs — and that cost is stated where the thresholds are derived. The
     * panel draws both numbers in full for the card being decided.
     */
    const priceQuery =
      /@container \(max-width:\s*(\d+)px\)\s*\{\s*\.card-row:has\(\.name-cell\) \.cash/.exec(sheet)
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
