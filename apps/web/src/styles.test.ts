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

  it('lets the name take the remaining space', () => {
    const name = row().querySelector('.name')!
    expect(winner(name, 'flex')?.value).toBe('1')
    // Without this a flex child will not shrink below its content, which is
    // what makes the ellipsis on long land names do nothing.
    expect(winner(name, 'min-width')?.value).toBe('0')
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
