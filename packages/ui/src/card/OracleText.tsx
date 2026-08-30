import type { JSX } from 'react'
import { parseManaCost } from './mana.js'
import { ManaSymbolMark } from './ManaCost.js'

/**
 * Rules text with its symbols drawn.
 *
 * `ManaCost` handles the cost line, where the whole string is symbols. Rules
 * text is the other half of the problem: mostly prose, with symbols embedded in
 * it — "{T}: Add {C}{C}." — and that half had been left as literal braces.
 *
 * Newlines are meaningful in oracle text: they separate abilities. They are
 * preserved as-is and the caller's CSS wraps them (`white-space: pre-wrap`), so
 * a card with three abilities still reads as three lines.
 *
 * Accessibility differs from `ManaCost` on purpose. A cost is one short phrase,
 * so it gets one hidden sentence and hides the discs. Rules text is prose, and
 * one hidden copy of a paragraph would double every card's text for a screen
 * reader. Each symbol instead carries its own hidden word IN PLACE, so the
 * sentence reads in order: "tap: Add colourless colourless."
 */

export interface OracleTextProps {
  readonly text: string
  /** Shown when the card has no rules text at all, rather than an empty box. */
  readonly empty?: string
}

/** Split on `{...}` while KEEPING the delimiters — the symbols are the point. */
const TOKEN = /(\{[^}]*\})/g

export const OracleText = ({ text, empty = 'No rules text.' }: OracleTextProps): JSX.Element => {
  if (text === '') return <>{empty}</>

  const parts = text.split(TOKEN)
  return (
    <>
      {parts.map((part, index) => {
        if (part === '') return null
        if (!part.startsWith('{')) return <span key={index}>{part}</span>

        const symbol = parseManaCost(part)[0]
        // An unreadable token keeps its braces and is shown as written. A symbol
        // silently dropped from rules text changes what the card does.
        if (symbol === undefined || symbol.kind === 'unknown')
          return <span key={index}>{part}</span>

        return (
          <span className="rt-inline-sym" key={index}>
            <ManaSymbolMark symbol={symbol} />
            <span className="rt-sr">{symbol.label}</span>
          </span>
        )
      })}
    </>
  )
}
