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

/** One run of an ability: either prose, or a card name that can be opened. */
export type OracleSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'name'; readonly text: string }

export interface OracleTextProps {
  readonly text: string
  /**
   * Per-face rules text, when the card has more than one face. Anything shorter
   * than two entries is one face and is ignored in favour of `text`.
   */
  readonly faces?: readonly string[] | undefined
  /** Shown when the card has no rules text at all, rather than an empty box. */
  readonly empty?: string
  /**
   * Cuts one ability into prose and card-name runs, so the names can be linked.
   *
   * A FUNCTION rather than a list of names to look for, for two reasons. The
   * boundary one: `@roundtable/ui` does not depend on `@roundtable/domain` (see
   * `types.ts`), and deciding which spans in rules text are really card
   * references is domain logic over the whole card table — measured, a naive
   * name match lights up 46.8% of the corpus wrongly. The correctness one: a
   * list of names would force this component to match by substring, and "Sol
   * Ring" also occurs inside the token name "Sol Ring Replica". Only the caller
   * knows WHERE the reference is, so the caller does the cutting.
   *
   * Absent — the default, and the case for every existing call site — the text
   * renders exactly as it did before.
   */
  readonly splitNames?: ((ability: string) => readonly OracleSegment[]) | undefined
  /** Called with the card name a reader chose. Required for names to be links. */
  readonly onOpenName?: ((name: string) => void) | undefined
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

/**
 * One ability, with its card names drawn as controls and the prose between them
 * still carrying its mana symbols.
 *
 * The name runs are excluded from `withSymbols` rather than passed through it: a
 * card name contains no `{...}` token, and running the splitter over it would
 * only risk cutting a name in half.
 */
const withNames = (
  ability: string,
  split: (ability: string) => readonly OracleSegment[],
  onOpen: (name: string) => void,
): ReactNode[] =>
  split(ability).map((segment, index) => {
    if (segment.kind === 'text') return <Fragment key={index}>{withSymbols(segment.text)}</Fragment>
    return (
      <button
        className="rt-oracle-ref"
        key={index}
        onClick={() => {
          onOpen(segment.text)
        }}
        /*
         * The accessible name says what the control DOES. "Sol Ring" alone
         * announces a card name with no hint that choosing it changes the panel
         * being read, which is the R4 failure this text exists to avoid.
         */
        aria-label={`Open ${segment.text}`}
        type="button"
      >
        {segment.text}
      </button>
    )
  })

export const OracleText = ({
  text,
  faces,
  empty = 'No rules text.',
  splitNames,
  onOpenName,
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
              {splitNames === undefined || onOpenName === undefined
                ? withSymbols(ability)
                : withNames(ability, splitNames, onOpenName)}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  )
}
