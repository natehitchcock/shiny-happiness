import { Fragment, type JSX, type ReactNode } from 'react'
import { parseManaCost } from './mana.js'
import { ManaSymbolMark } from './ManaCost.js'

/**
 * Rules text with its symbols drawn, its abilities spaced, and its faces split.
 *
 * `ManaCost` handles the cost line, where the whole string is symbols. Rules
 * text is the other half of the problem: mostly prose, with symbols embedded in
 * it — "{T}: Add {C}{C}." — and that half had been left as literal braces.
 *
 * Newlines are meaningful in oracle text: they separate abilities. They used to
 * be emitted as literal newlines and left to the caller's `white-space:
 * pre-wrap`, which two of the three call sites never set — so a card with three
 * abilities read as one run-on paragraph there, and as three tight lines in the
 * third. Each ability is now its own block, which puts real space between them
 * without asking every caller to remember a stylesheet rule.
 *
 * `faces` is separate because the boundary between two FACES cannot be found in
 * the text: `Card.oracleText` joins the faces with the same newline that
 * separates two abilities of one face. Fire // Ice is three chunks and only the
 * first boundary is a face change. Given the faces, a rule is drawn between
 * them; given nothing, the text renders as a single face, which is what a
 * card ingested before the field existed gets.
 *
 * Accessibility differs from `ManaCost` on purpose. A cost is one short phrase,
 * so it gets one hidden sentence and hides the discs. Rules text is prose, and
 * one hidden copy of a paragraph would double every card's text for a screen
 * reader. Each symbol instead carries its own hidden word IN PLACE, so the
 * sentence reads in order: "tap: Add colourless colourless."
 *
 * The face rule follows that rule rather than being hidden. It is NOT
 * `aria-hidden`: the boundary is information — the back face's text is a
 * different card side, not a continuation — and hiding it would leave a screen
 * reader running the two faces together, which is the exact defect being fixed
 * for sighted readers. It carries the words "Other face:" in place, since a
 * bare separator with no name announces nothing useful. The drawn line itself
 * is a border, which assistive technology never reads.
 */

export interface OracleTextProps {
  readonly text: string
  /**
   * Per-face rules text, when the card has more than one face. Anything shorter
   * than two entries is one face and is ignored in favour of `text`.
   */
  readonly faces?: readonly string[] | undefined
  /** Shown when the card has no rules text at all, rather than an empty box. */
  readonly empty?: string
}

/** Split on `{...}` while KEEPING the delimiters — the symbols are the point. */
const TOKEN = /(\{[^}]*\})/g

/** One ability's prose, with every `{X}` in it drawn as a symbol in place. */
const withSymbols = (ability: string): ReactNode[] =>
  ability.split(TOKEN).map((part, index) => {
    if (part === '') return null
    if (!part.startsWith('{')) return <span key={index}>{part}</span>

    const symbol = parseManaCost(part)[0]
    // An unreadable token keeps its braces and is shown as written. A symbol
    // silently dropped from rules text changes what the card does.
    if (symbol === undefined || symbol.kind === 'unknown') return <span key={index}>{part}</span>

    return (
      <span className="rt-inline-sym" key={index}>
        <ManaSymbolMark symbol={symbol} />
        <span className="rt-sr">{symbol.label}</span>
      </span>
    )
  })

export const OracleText = ({
  text,
  faces,
  empty = 'No rules text.',
}: OracleTextProps): JSX.Element => {
  /*
   * Faces, each as its list of abilities.
   *
   * Faces with nothing on them are dropped, not rendered empty: a back face
   * that is a bare land has no rules text, and a face rule drawn against
   * nothing would claim a side that has nothing to say.
   */
  const blocks = (faces === undefined || faces.length < 2 ? [text] : faces)
    .map((face) => face.split('\n').filter((ability) => ability !== ''))
    .filter((abilities) => abilities.length > 0)

  if (blocks.length === 0) return <>{empty}</>

  return (
    <>
      {blocks.map((abilities, face) => (
        <Fragment key={face}>
          {face === 0 ? null : (
            <span className="rt-oracle-facebreak">
              <span className="rt-sr">Other face:</span>
            </span>
          )}
          {abilities.map((ability, index) => (
            <span className="rt-oracle-ability" key={index}>
              {withSymbols(ability)}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  )
}
