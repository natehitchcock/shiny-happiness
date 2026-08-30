/**
 * Scryfall mana cost shorthand, read into symbols this project can draw.
 *
 * Pure — no DOM, no React, no fetch — because the awkward half of a mana cost is
 * the parsing, and parsing is the half worth pinning with tests. `ManaCost.tsx`
 * is the thin part that turns these into spans.
 *
 * **Why the marks are drawn rather than fetched.** Wizards' mana symbols are
 * Wizards' copyright; ADR-0009 Q4 establishes that ("including card images and
 * mana symbols") and then leaves the question of re-serving Scryfall's image
 * files explicitly OPEN, gated on `ING-04`. So nothing here is vendored,
 * hotlinked or downloaded: a symbol is a disc, a fill from the project's own
 * asserted palette, and a letter. See ADR-0015.
 *
 * Two rules the shapes below exist to keep:
 *
 *   - **Nothing is silently dropped.** A fragment this file cannot read becomes
 *     an `unknown` symbol carrying its own source text, and the component prints
 *     that text. The failure mode is "you see the shorthand", which is what we
 *     had before — never "the cost is shorter than the card's".
 *   - **Colour is never the only signal.** Every symbol carries a mark: a
 *     letter, a digit, or the Phyrexian phi. That is what makes the palette safe
 *     to tint (see `symbolFill`) and what `Badges.tsx` means by "never colour
 *     alone".
 */

import { IDENTITY_COLORS } from './presentation.js'
import type { Color } from './types.js'
import { byName, contrast } from '../tokens.js'

export type ManaSymbolKind =
  /** `{2}`, `{15}` — a number in a grey disc. */
  | 'generic'
  /** `{X}`, `{Y}`, `{Z}`. */
  | 'variable'
  /** `{W}` `{U}` `{B}` `{R}` `{G}`. */
  | 'color'
  /** `{C}` — colourless, which is not the same thing as generic. */
  | 'colorless'
  /** `{S}` — snow. */
  | 'snow'
  /** `{W/U}`, and `{C/W}`. Two ways to pay, split disc. */
  | 'hybrid'
  /** `{2/B}` — monocolour hybrid: a number OR one colour. */
  | 'monohybrid'
  /** `{G/P}`, `{P}`, `{W/U/P}` — payable with two life. */
  | 'phyrexian'
  /** Anything this parser could not read. Shown as its own text. */
  | 'unknown'

export interface ManaSymbol {
  /** Exactly the source text, braces included: `{2}`, `{W/U}`. */
  readonly raw: string
  readonly kind: ManaSymbolKind
  /**
   * Disc fills in draw order. One entry is a solid disc; two is a diagonal
   * split. `null` means the neutral grey — generic, colourless and snow are all
   * grey on a real card, and so are they here.
   */
  readonly fills: readonly (Color | null)[]
  /**
   * What is drawn ON the disc. Two marks are placed in the two halves; one is
   * centred. `marks` and `fills` are NOT required to be the same length —
   * `{G/P}` is one phi on one green disc, `{W/U/P}` is one phi on a split one.
   */
  readonly marks: readonly string[]
  /** What a screen reader is told this one symbol is. */
  readonly label: string
}

/** Stand-in for the Phyrexian mana glyph. A capital phi is its actual shape. */
export const PHYREXIAN_MARK = 'Φ'

const COLOR_WORDS: Readonly<Record<string, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
}

const isColor = (part: string): part is Color => part in COLOR_WORDS

/** One side of a `/`-separated symbol. */
interface Part {
  readonly fill: Color | null
  readonly mark: string
  readonly word: string
}

const partOf = (part: string): Part | null => {
  if (isColor(part)) return { fill: part, mark: part, word: COLOR_WORDS[part]! }
  if (/^\d+$/.test(part)) return { fill: null, mark: part, word: `${part} generic` }
  if (part === 'C') return { fill: null, mark: 'C', word: 'colourless' }
  if (part === 'S') return { fill: null, mark: 'S', word: 'snow' }
  return null
}

const unknown = (raw: string): ManaSymbol => ({
  raw,
  kind: 'unknown',
  fills: [],
  marks: [],
  // "unreadable" rather than a guess. A cost the reader cannot trust is worse
  // than one that admits it does not know.
  label: `unreadable ${raw}`,
})

const symbolFor = (raw: string, inner: string): ManaSymbol => {
  const body = inner.trim().toUpperCase()
  if (body === '') return unknown(raw)

  if (/^\d+$/.test(body)) {
    return { raw, kind: 'generic', fills: [null], marks: [body], label: `${body} generic` }
  }
  if (body === 'X' || body === 'Y' || body === 'Z') {
    return { raw, kind: 'variable', fills: [null], marks: [body], label: body }
  }
  if (isColor(body)) {
    return { raw, kind: 'color', fills: [body], marks: [body], label: COLOR_WORDS[body]! }
  }
  if (body === 'C') {
    return { raw, kind: 'colorless', fills: [null], marks: ['C'], label: 'colourless' }
  }
  if (body === 'S') {
    return { raw, kind: 'snow', fills: [null], marks: ['S'], label: 'snow' }
  }
  if (body === 'P') {
    return { raw, kind: 'phyrexian', fills: [null], marks: [PHYREXIAN_MARK], label: '2 life' }
  }

  const parts = body.split('/')

  // Phyrexian is written with `P` last: {G/P}, {W/U/P}. It is NOT a third way to
  // pay drawn as a third slice — the disc keeps the colours and the phi replaces
  // their letters, which is how the printed symbol reads.
  if (parts.length >= 2 && parts[parts.length - 1] === 'P') {
    const sides = parts.slice(0, -1).map(partOf)
    if (sides.some((side) => side === null)) return unknown(raw)
    const known = sides as Part[]
    return {
      raw,
      kind: 'phyrexian',
      fills: known.map((side) => side.fill),
      marks: [PHYREXIAN_MARK],
      label: `${known.map((side) => side.word).join(' or ')} or 2 life`,
    }
  }

  if (parts.length === 2) {
    const left = partOf(parts[0]!)
    const right = partOf(parts[1]!)
    if (left === null || right === null) return unknown(raw)
    return {
      raw,
      // {2/B} is called out separately because it is the one hybrid where a side
      // is a number, and a caller styling "two colours" would get it wrong.
      kind: /^\d+$/.test(parts[0]!) ? 'monohybrid' : 'hybrid',
      fills: [left.fill, right.fill],
      marks: [left.mark, right.mark],
      label: `${left.word} or ${right.word}`,
    }
  }

  return unknown(raw)
}

/**
 * Read a Scryfall cost string into symbols, in the order they are written.
 *
 * Total: every input produces a value, and no input throws. Text that is not a
 * `{...}` token — a stray word, an unterminated brace — is kept as an `unknown`
 * symbol rather than skipped, because a cost that quietly loses a piece is a
 * wrong cost that looks like a right one.
 */
export const parseManaCost = (cost: string | null | undefined): readonly ManaSymbol[] => {
  if (cost === null || cost === undefined) return []
  const symbols: ManaSymbol[] = []
  let loose = ''
  let at = 0

  const flush = (): void => {
    const text = loose.trim()
    loose = ''
    if (text !== '') symbols.push(unknown(text))
  }

  while (at < cost.length) {
    const open = cost.indexOf('{', at)
    if (open < 0) {
      loose += cost.slice(at)
      break
    }
    loose += cost.slice(at, open)
    const close = cost.indexOf('}', open + 1)
    if (close < 0) {
      // Unterminated. The rest is text we cannot read, and it is kept.
      loose += cost.slice(open)
      break
    }
    flush()
    symbols.push(symbolFor(cost.slice(open, close + 1), cost.slice(open + 1, close)))
    at = close + 1
  }
  flush()
  return symbols
}

/**
 * The whole cost in words — the screen reader's version of the row of discs.
 *
 * Prefixed here rather than in the component so the phrasing is testable, and so
 * "no mana cost" (a land, an unresolved import) is a stated answer rather than
 * silence.
 */
export const manaCostLabel = (symbols: readonly ManaSymbol[]): string =>
  symbols.length === 0 ? 'no mana cost' : `mana cost ${symbols.map((s) => s.label).join(', ')}`

// ---------------------------------------------------------------- painting

const INK = byName('ink').value
const PARCHMENT = byName('parchment').value

/**
 * How far a disc is lightened toward parchment.
 *
 * `IDENTITY_COLORS` are pips: saturated 8 px marks with nothing written on them,
 * tuned to be seen against ink. A mana symbol is the opposite problem — it
 * carries a letter, and blue at full strength gives that letter 3.8:1, under the
 * 4.5 floor for text. Lightening toward parchment fixes the letter and, not
 * incidentally, makes the symbol look like the printed one: a pale disc with a
 * dark glyph.
 *
 * It costs chroma, which costs CVD separation. That is affordable HERE and only
 * here because every symbol carries its own letter — the second signal
 * `tokens.ts` demands is structural, not something a future edit can forget.
 */
const TINT = 0.5

const mixToward = (hex: string, target: string, amount: number): string => {
  const channels = (value: string): readonly number[] => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
  const to = channels(target)
  const mixed = channels(hex).map((c, i) => Math.round(c + (to[i]! - c) * amount))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** The disc colour for one fill slot. `null` is the neutral — generic and snow. */
export const symbolFill = (fill: Color | null): string =>
  mixToward(IDENTITY_COLORS[fill ?? 'C'] ?? IDENTITY_COLORS.C!, PARCHMENT, TINT)

/** The CSS `background` for a symbol: solid, or split on the diagonal. */
export const symbolBackground = (symbol: ManaSymbol): string => {
  const [first, second] = symbol.fills
  if (symbol.fills.length < 2) return symbolFill(first ?? null)
  const a = symbolFill(first ?? null)
  const b = symbolFill(second ?? null)
  return `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`
}

/**
 * The mark colour on a given fill — whichever of ink and parchment reads better.
 *
 * Chosen rather than fixed so that changing a palette entry cannot silently
 * produce an unreadable glyph; the test asserts the result clears 4.5:1.
 */
export const symbolInk = (fill: Color | null): string => {
  const disc = symbolFill(fill)
  return contrast(disc, INK) >= contrast(disc, PARCHMENT) ? INK : PARCHMENT
}
