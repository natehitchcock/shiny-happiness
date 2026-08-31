/**
 * A mana cost as symbols rather than as brace shorthand.
 *
 * The parsing, the palette and the wording all live in `mana.ts`, which is pure
 * and tested; this file is only the DOM. Two things it is responsible for on its
 * own:
 *
 *   - **The accessible path is a sibling, not an attribute.** The discs are
 *     `aria-hidden` and the cost is stated once, in visually hidden text, the
 *     same way `RoleDot` does it. An `aria-label` on a bare `<span>` has no role
 *     to attach to and is not reliably announced; a row of unlabelled marks
 *     would be a regression on the shorthand this replaces.
 *   - **An unreadable fragment is printed, not dropped.** `mana.ts` hands back
 *     an `unknown` symbol carrying its source text, and it renders as that text
 *     in a flagged box. Worst case the reader sees the shorthand, which is
 *     exactly where we started.
 */

import type { JSX } from 'react'
import {
  manaCostLabel,
  parseManaCost,
  symbolBackground,
  symbolInk,
  type ManaSymbol,
} from './mana.js'

export interface ManaCostProps {
  /** Scryfall cost string, e.g. `{2}{R}`. Null or absent for a land. */
  readonly cost?: string | null | undefined
}

export const ManaCost = ({ cost }: ManaCostProps): JSX.Element => {
  const symbols = parseManaCost(cost)
  return (
    <span className="rt-mana" title={cost ?? undefined}>
      <span className="rt-sr">{manaCostLabel(symbols)}</span>
      {symbols.map((symbol, index) => (
        <ManaSymbolMark key={`${symbol.raw}-${String(index)}`} symbol={symbol} />
      ))}
    </span>
  )
}

/**
 * One drawn symbol, without any wrapper or label.
 *
 * Exported because rules text needs the same disc inline, but supplies its own
 * accessible word per symbol rather than one sentence for a whole cost.
 */
export const ManaSymbolMark = ({ symbol }: { readonly symbol: ManaSymbol }): JSX.Element => {
  if (symbol.kind === 'unknown') {
    return (
      <span className="rt-sym-raw" aria-hidden="true">
        {symbol.raw}
      </span>
    )
  }
  /*
   * The `//` of a split cost: text, like an unreadable fragment, but NOT
   * flagged like one. Its own class rather than `.rt-sym-raw` because that box
   * is drawn in the alarm colour to mean "this app met a symbol it does not
   * know", and this one it knows. Falling through to the disc below would draw
   * "//" inside a circle, which is not how any card prints it.
   */
  if (symbol.kind === 'separator') {
    return (
      <span className="rt-sym-sep" aria-hidden="true">
        {symbol.raw}
      </span>
    )
  }
  // Two marks sit in the two halves of a split disc; one is centred. `fills` is
  // indexed separately because a Phyrexian symbol has one mark over two fills.
  const split = symbol.marks.length === 2
  return (
    <span
      className="rt-sym"
      aria-hidden="true"
      data-kind={symbol.kind}
      style={{ background: symbolBackground(symbol) }}
    >
      {symbol.marks.map((mark, index) => (
        <span
          className="rt-sym-mark"
          key={`${mark}-${String(index)}`}
          data-half={split ? (index === 0 ? 'a' : 'b') : 'only'}
          data-wide={mark.length > 1}
          style={{ color: symbolInk(symbol.fills[symbol.fills.length === 2 ? index : 0] ?? null) }}
        >
          {mark}
        </span>
      ))}
    </span>
  )
}
