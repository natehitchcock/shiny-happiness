import { describe, expect, it } from 'vitest'
import {
  PHYREXIAN_MARK,
  manaCostLabel,
  parseManaCost,
  symbolBackground,
  symbolFill,
  symbolInk,
} from './mana.js'
import type { ManaSymbol } from './mana.js'
import { byName, contrast } from '../tokens.js'

const kinds = (cost: string): string[] => parseManaCost(cost).map((s) => s.kind)
const raws = (cost: string): string[] => parseManaCost(cost).map((s) => s.raw)
const only = (cost: string): ManaSymbol => {
  const parsed = parseManaCost(cost)
  expect(parsed).toHaveLength(1)
  return parsed[0]!
}

describe('parseManaCost — the ordinary cases', () => {
  it('keeps the symbols in the order they are written', () => {
    // Order is meaning: {2}{R} and {R}{2} are the same cost, but a reader
    // scanning a column expects the generic first because that is how it prints.
    expect(raws('{2}{R}')).toEqual(['{2}', '{R}'])
    expect(kinds('{2}{R}')).toEqual(['generic', 'color'])
  })

  it('reads all five colours', () => {
    expect(kinds('{W}{U}{B}{R}{G}')).toEqual(Array<string>(5).fill('color'))
    expect(manaCostLabel(parseManaCost('{W}{U}{B}{R}{G}'))).toBe(
      'mana cost white, blue, black, red, green',
    )
  })

  it('has nothing to say about a land', () => {
    expect(parseManaCost(null)).toEqual([])
    expect(parseManaCost(undefined)).toEqual([])
    expect(parseManaCost('')).toEqual([])
    // Stated, not silent: a row with no cost must not read as a row whose cost
    // failed to render.
    expect(manaCostLabel([])).toBe('no mana cost')
  })
})

describe('parseManaCost — the awkward ones', () => {
  it('reads a hybrid as two ways to pay, not as one colour', () => {
    const hybrid = only('{W/U}')
    expect(hybrid.kind).toBe('hybrid')
    expect(hybrid.fills).toEqual(['W', 'U'])
    // Both letters are drawn. A split disc distinguished only by its two hues
    // is exactly the colour-alone signal `tokens.ts` forbids.
    expect(hybrid.marks).toEqual(['W', 'U'])
    expect(hybrid.label).toBe('white or blue')
  })

  it('separates monocolour hybrid from ordinary hybrid', () => {
    const mono = only('{2/B}')
    // Not `hybrid`: one side is a number, and a caller styling "two colours"
    // would paint the generic half black.
    expect(mono.kind).toBe('monohybrid')
    expect(mono.fills).toEqual([null, 'B'])
    expect(mono.marks).toEqual(['2', 'B'])
    expect(mono.label).toBe('2 generic or black')
  })

  it('reads Phyrexian as its colour plus a life payment', () => {
    const phyrexian = only('{G/P}')
    expect(phyrexian.kind).toBe('phyrexian')
    expect(phyrexian.fills).toEqual(['G'])
    // One phi over one green disc — the printed symbol does not draw a G.
    expect(phyrexian.marks).toEqual([PHYREXIAN_MARK])
    expect(phyrexian.label).toBe('green or 2 life')
  })

  it('reads colourless Phyrexian, which has no colour at all', () => {
    const phyrexian = only('{P}')
    expect(phyrexian.kind).toBe('phyrexian')
    expect(phyrexian.fills).toEqual([null])
    expect(phyrexian.label).toBe('2 life')
  })

  it('reads hybrid Phyrexian, where one mark sits over two fills', () => {
    // March of the Machine printed these. It is the case that breaks any code
    // assuming `marks` and `fills` are the same length.
    const phyrexian = only('{W/U/P}')
    expect(phyrexian.kind).toBe('phyrexian')
    expect(phyrexian.fills).toEqual(['W', 'U'])
    expect(phyrexian.marks).toEqual([PHYREXIAN_MARK])
    expect(phyrexian.label).toBe('white or blue or 2 life')
  })

  it('reads X, Y and Z as variables rather than as generic', () => {
    for (const letter of ['X', 'Y', 'Z']) {
      const variable = only(`{${letter}}`)
      expect(variable.kind, letter).toBe('variable')
      expect(variable.marks, letter).toEqual([letter])
      expect(variable.label, letter).toBe(letter)
    }
  })

  it('keeps colourless apart from generic, because the game does', () => {
    // {C} can only be paid with colourless mana; {1} can be paid with anything.
    // Same grey disc, different rule, so they are different kinds.
    expect(only('{C}').kind).toBe('colorless')
    expect(only('{1}').kind).toBe('generic')
    expect(only('{C}').label).toBe('colourless')
  })

  it('reads snow', () => {
    const snow = only('{S}')
    expect(snow.kind).toBe('snow')
    expect(snow.marks).toEqual(['S'])
    expect(snow.label).toBe('snow')
  })

  it('reads a large generic cost as one symbol, not fifteen', () => {
    const generic = only('{15}')
    expect(generic.kind).toBe('generic')
    expect(generic.marks).toEqual(['15'])
    expect(generic.label).toBe('15 generic')
  })

  it('reads {0}, which is a cost and not an absent one', () => {
    expect(only('{0}').kind).toBe('generic')
    expect(manaCostLabel(parseManaCost('{0}'))).toBe('mana cost 0 generic')
  })

  it('reads a whole awkward cost in one pass', () => {
    expect(kinds('{X}{2/B}{W/U}{G/P}{S}{C}')).toEqual([
      'variable',
      'monohybrid',
      'hybrid',
      'phyrexian',
      'snow',
      'colorless',
    ])
  })
})

describe('parseManaCost — what it cannot read', () => {
  it('keeps an unrecognised token instead of dropping it', () => {
    // The rule: a cost the user cannot read is worse than shorthand, but a cost
    // that is SHORTER than the card's is worse than both — it looks correct.
    const parsed = parseManaCost('{2}{Q}{R}')
    expect(parsed.map((s) => s.kind)).toEqual(['generic', 'unknown', 'color'])
    expect(parsed[1]?.raw).toBe('{Q}')
    expect(manaCostLabel(parsed)).toBe('mana cost 2 generic, unreadable {Q}, red')
  })

  it('keeps text that is not a token at all', () => {
    const parsed = parseManaCost('{1} plus something {G}')
    expect(parsed.map((s) => s.raw)).toEqual(['{1}', 'plus something', '{G}'])
  })

  it('keeps an unterminated brace rather than swallowing the rest', () => {
    const parsed = parseManaCost('{R}{2')
    expect(parsed.map((s) => s.raw)).toEqual(['{R}', '{2'])
    expect(parsed[1]?.kind).toBe('unknown')
  })

  it('does not throw on anything', () => {
    for (const cost of ['', '{}', '{{}}', '}{', '{/}', '{W/}', '{/U}', '{W/U/V}', '{∞}', '{½}']) {
      expect(() => parseManaCost(cost), cost).not.toThrow()
    }
  })

  it('rejects a hybrid half it does not know, rather than half-drawing it', () => {
    // {W/V} would otherwise become a white disc with a phantom second half.
    expect(only('{W/V}').kind).toBe('unknown')
    expect(only('{W/V}').raw).toBe('{W/V}')
  })

  it('tolerates whitespace and lower case, which real data has both of', () => {
    expect(only('{ w/u }').kind).toBe('hybrid')
    expect(only('{r}').label).toBe('red')
  })
})

describe('the palette a symbol is painted with', () => {
  const ink = byName('ink').value

  const FILLS = [null, 'W', 'U', 'B', 'R', 'G'] as const

  it('gives every mark at least the 4.5:1 floor for text on its own disc', () => {
    // This is the whole reason `mana.ts` tints the pip palette rather than using
    // it raw: blue at full strength put a letter at 3.8:1. `symbolInk` picking
    // the better of ink and parchment is what keeps this true if a token moves.
    for (const fill of FILLS) {
      const disc = symbolFill(fill)
      expect(
        contrast(disc, symbolInk(fill)),
        `${String(fill)} disc ${disc}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps every disc visible against the table it is drawn on', () => {
    // 3:1, the floor for a non-text thing you must be able to see. A disc that
    // vanished into the ink would be a cost with a hole in it.
    for (const fill of FILLS) {
      expect(contrast(symbolFill(fill), ink), String(fill)).toBeGreaterThanOrEqual(3)
    }
  })

  it('paints a hybrid as two halves and a mono as one colour', () => {
    expect(symbolBackground(only('{R}'))).toBe(symbolFill('R'))
    const split = symbolBackground(only('{W/U}'))
    expect(split).toContain('linear-gradient')
    expect(split).toContain(symbolFill('W'))
    expect(split).toContain(symbolFill('U'))
  })

  it('paints generic, colourless and snow the same neutral, as the game prints them', () => {
    expect(symbolBackground(only('{3}'))).toBe(symbolFill(null))
    expect(symbolBackground(only('{C}'))).toBe(symbolFill(null))
    expect(symbolBackground(only('{S}'))).toBe(symbolFill(null))
  })
})
