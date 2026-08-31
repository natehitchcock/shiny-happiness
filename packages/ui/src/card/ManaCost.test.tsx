// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ManaCost } from './ManaCost.js'
import { PHYREXIAN_MARK, symbolFill, symbolInk } from './mana.js'

afterEach(cleanup)

/** jsdom normalises an inline colour to `rgb(...)`; the palette speaks hex. */
const rgb = (hex: string): string => {
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16)
  return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`
}

const draw = (cost: string | null | undefined): HTMLElement => {
  const { container } = render(<ManaCost cost={cost} />)
  return container.querySelector('.rt-mana')!
}

describe('ManaCost — what is drawn', () => {
  it('draws one disc per symbol', () => {
    expect(draw('{2}{R}').querySelectorAll('.rt-sym')).toHaveLength(2)
    expect(draw('{X}{G}{G}').querySelectorAll('.rt-sym')).toHaveLength(3)
  })

  it('draws both halves of a hybrid, letters included', () => {
    const marks = [...draw('{W/U}').querySelectorAll('.rt-sym-mark')]
    expect(marks.map((m) => m.textContent)).toEqual(['W', 'U'])
    expect(marks.map((m) => m.getAttribute('data-half'))).toEqual(['a', 'b'])
    // Each half's letter takes its contrast from the half it sits ON, not from
    // the symbol as a whole — {2/B} is the case where those differ.
    const halves = [...draw('{2/B}').querySelectorAll('.rt-sym-mark')] as HTMLElement[]
    expect(halves[0]?.style.color).toBe(rgb(symbolInk(null)))
    expect(halves[1]?.style.color).toBe(rgb(symbolInk('B')))
  })

  it('draws one phi over a Phyrexian symbol, on its colour', () => {
    const symbol = draw('{G/P}').querySelector('.rt-sym')!
    expect(symbol.querySelectorAll('.rt-sym-mark')).toHaveLength(1)
    expect(symbol.textContent).toBe(PHYREXIAN_MARK)
    expect((symbol as HTMLElement).style.background).toBe(rgb(symbolFill('G')))
  })

  it('flags a wide mark, because two characters do not fit a disc sized for one', () => {
    const mark = draw('{15}').querySelector('.rt-sym-mark')!
    expect(mark.textContent).toBe('15')
    expect(mark.getAttribute('data-wide')).toBe('true')
    expect(draw('{2}').querySelector('.rt-sym-mark')?.getAttribute('data-wide')).toBe('false')
  })

  it('prints a fragment it cannot read instead of dropping it', () => {
    // The regression this guards: a cost SHORTER than the card's, which looks
    // correct. Falling back to the shorthand is the acceptable failure.
    const mana = draw('{2}{ZZZ9}{R}')
    expect(mana.querySelectorAll('.rt-sym')).toHaveLength(2)
    expect(mana.querySelector('.rt-sym-raw')?.textContent).toBe('{ZZZ9}')
  })

  it('draws the // of a split cost as text, and not as a flagged unknown', () => {
    const mana = draw('{1}{R} // {1}{U}')

    expect(mana.querySelectorAll('.rt-sym')).toHaveLength(4)
    expect(mana.querySelector('.rt-sym-sep')?.textContent).toBe('//')
    // Not `.rt-sym-raw`. That box is drawn in the alarm colour and means the
    // app met a symbol it does not know — it knows this one. And not a disc
    // either: no card prints the separator in a circle.
    expect(mana.querySelectorAll('.rt-sym-raw')).toHaveLength(0)
  })

  it('draws nothing for a land', () => {
    expect(draw(null).querySelectorAll('.rt-sym')).toHaveLength(0)
  })
})

describe('ManaCost — the screen-reader path', () => {
  it('states the whole cost in words', () => {
    render(<ManaCost cost="{2}{R}" />)
    expect(screen.getByText('mana cost 2 generic, red')).toBeDefined()
  })

  it('says a land has no cost rather than saying nothing', () => {
    render(<ManaCost cost={null} />)
    expect(screen.getByText('no mana cost')).toBeDefined()
  })

  it('hides the discs, so the cost is announced once and not twice', () => {
    // A row of unlabelled marks would be the regression; a row of marks read
    // out beside the sentence that already says the same thing is the other.
    const mana = draw('{W/U}{R}')
    for (const node of mana.querySelectorAll('.rt-sym, .rt-sym-raw, .rt-sym-sep')) {
      expect(node.getAttribute('aria-hidden')).toBe('true')
    }
    expect(mana.querySelector('.rt-sr')?.textContent).toBe('mana cost white or blue, red')
  })

  it('states a split cost as two costs, not as an unreadable one', () => {
    // The playtest defect: `Fire // Ice` announced its separator as
    // "unreadable //", which is the one thing the parser says when it has lost
    // the reader's trust — and it said it about every split card.
    const mana = draw('{1}{R} // {1}{U}')

    expect(mana.querySelector('.rt-sr')?.textContent).toBe(
      'mana cost 1 generic, red or 1 generic, blue',
    )
    expect(mana.querySelector('.rt-sym-sep')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the shorthand available on hover for a sighted reader', () => {
    expect(draw('{2}{R}').getAttribute('title')).toBe('{2}{R}')
  })
})
