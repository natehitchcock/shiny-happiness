/**
 * Card names referenced inside another card's oracle text.
 *
 * ## Why this is anchored on rules templating and not on name matching
 *
 * The obvious implementation — take the 34,494 card names and look for each of
 * them in the text — was built first and measured over the whole corpus before
 * any of it was rendered. It produced **24,877 cross-card links across 34,145
 * cards with rules text, one on 46.8% of all cards**, and effectively every one
 * of them was wrong. Card names collide with the vocabulary rules text is
 * written in, because Wizards has printed cards called `When`, `X`, `Sacrifice`,
 * `Exile`, `Return`, `Flash`, `Vigilance`, `Regenerate` and `Island`. The top of
 * the frequency table was `When` (8,023 hits), `X` (4,690) and `Sacrifice`
 * (2,960). Restricting to multi-word names still left 706 links of which the
 * clear majority were ability words that happen to be card names — `Mega Flare`,
 * `Drain Life`, `Natural Recovery` — and legends matching their own short name.
 *
 * A linkifier like that does not degrade gracefully. It turns rules text into a
 * field of blue, and the reader loses the ability to tell a real reference from
 * a coincidence, which is worse than shipping no links at all.
 *
 * So this matches on the templating Magic uses when it genuinely means "the card
 * with this name": `named X`, `Partner with X`, and `meld them into X`. The
 * anchor is the evidence. Measured over the same corpus that yields **291
 * cross-card links on 0.75% of cards**, with a full manual audit of all 291
 * finding no false positives.
 *
 * The honest headline: **oracle text almost never names another card.** Anyone
 * expecting this to light up is expecting the wrong thing; the value is that on
 * the ~250 cards where it fires, the link is right.
 *
 * ## Why resolution is inverted
 *
 * Finding where a name ENDS without knowing the corpus was also measured: read
 * capitalised words forward from the anchor, allowing lowercase connectors. It
 * agreed with a real card name only 69.8% of the time, because token names
 * ("Wasteland Survival Guide", "Cordyceps Infected") and sentence boundaries
 * ("Volatile Chimera. This creature…") are indistinguishable from a card name by
 * shape alone. Guessing wrong renders a link that resolves to nothing.
 *
 * Instead `oracleReferenceCandidates` emits every prefix that COULD be a name
 * and the caller — which has the card table — says which ones are real.
 * `resolveOracleReferences` then takes the longest that is. That keeps this file
 * pure (R1) while making the answer exact rather than heuristic.
 */

/** Rules phrases after which Magic writes a literal card name. */
const ANCHORS: readonly RegExp[] = [
  /\bnamed\s+/g,
  /\bPartner with\s+/g,
  /\bmeld them into\s+/g,
]

/**
 * Separators that continue a list of names: "named A, B, and C", "named A or B".
 * Ordered longest-first so ", and " is consumed whole rather than as ", ".
 */
const LIST_SEPARATOR = /^(?:,\s+and\s+|,\s+or\s+|\s+and\s+|\s+or\s+|,\s+)/

/**
 * Lowercase words that can sit INSIDE a card name. If one of these follows a
 * match, the match is a prefix of something longer and must be rejected —
 * "Plaguebearer" inside the token name "Plaguebearer of Nurgle".
 */
const NAME_CONTINUER = /^\s+(?:of|the|from|de|van|der|di|du|and)\b/

/**
 * Basic lands never link.
 *
 * `named Island` is a true reference and the pane it would open tells the reader
 * nothing they do not already know. They are also the most-repeated capitalised
 * words in the corpus, so linking them is all cost.
 */
const BASIC_LANDS: ReadonlySet<string> = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
])

/** A card name is at most this many words. Bounds the candidate list per anchor. */
const MAX_NAME_WORDS = 9

export interface OracleReferenceSite {
  /** Index into the text where the name begins. */
  readonly start: number
  /**
   * Every span starting at `start` that could be a card name, LONGEST FIRST.
   * The caller checks these against the real card table and keeps the first hit.
   */
  readonly candidates: readonly string[]
}

export interface OracleReference {
  readonly name: string
  readonly start: number
  readonly end: number
}

export type OracleSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'name'; readonly text: string }

/**
 * Whether a name that ends at `rest` really ended there.
 *
 * Without this, a token whose name merely BEGINS with a card name links to that
 * card: `Wasteland` out of `Wasteland Survival Guide`, `Smoke` out of `Smoke
 * Blessing`, `Humble` out of `Humble Merchant`. Measured over the corpus this
 * guard removed exactly five links, all five of them that class, and cost no
 * true reference.
 */
const endsHere = (rest: string): boolean => {
  if (rest.length === 0) return true
  // A card name never spans an ability break. Without this, "Partner with Amy
  // Pond\nFirst strike" reads "First" as a continuation of the name and the
  // guard rejects a reference that is real.
  if (/^\r?\n/.test(rest)) return true
  if (/^[.,;:!?"”'’)\]]/.test(rest)) return true
  if (NAME_CONTINUER.test(rest)) return false
  const next = /^\s+(\S+)/.exec(rest)
  if (next === null) return true
  // A capitalised word after the match means the match was a prefix of a longer
  // proper name — the token-name case above.
  return !/^[A-Z]/.test(next[1]!)
}

/** Punctuation that can trail a name in a sentence but is never part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?"”'’)\]]+$/

/** Every prefix of `text` from `start` that is shaped like a card name. */
const candidatesAt = (text: string, start: number): readonly string[] => {
  // The name cannot cross a line break, so never look past one.
  const lineEnd = text.indexOf('\n', start)
  const line = text.slice(start, lineEnd === -1 ? undefined : lineEnd)
  const spans = new Set<string>()
  let words = 0
  for (let i = 0; i <= line.length; i++) {
    if (i !== line.length && line[i] !== ' ') continue
    words++
    const span = line.slice(0, i)
    if (span !== '') {
      spans.add(span)
      /*
       * The same span with its sentence punctuation removed. Word boundaries
       * alone yield "Sol Ring," and "Urza, Planeswalker." — neither of which is
       * a card name, so without this every reference followed by a comma or a
       * full stop (which is most of them) failed to resolve. Only the TAIL is
       * trimmed: "Ral, Caller of Storms" has a comma inside it that is part of
       * the name.
       */
      const trimmed = span.replace(TRAILING_PUNCTUATION, '')
      if (trimmed !== '') spans.add(trimmed)
    }
    if (words >= MAX_NAME_WORDS) break
  }
  // Longest first: "Ral, Caller of Storms" must beat "Ral" and "Ral, Caller".
  return [...spans].sort((a, b) => b.length - a.length)
}

/** Where each anchor hands over to a card name. */
const anchorStarts = (text: string): readonly number[] => {
  const starts: number[] = []
  for (const anchor of ANCHORS) {
    // Fresh lastIndex: the regexes are module-level and /g is stateful, so a
    // second call would otherwise resume mid-string and miss the first match.
    anchor.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = anchor.exec(text)) !== null) starts.push(match.index + match[0].length)
  }
  return starts.sort((a, b) => a - b)
}

/**
 * The sites in `text` where rules templating says a card name follows, each with
 * the spans that could be that name.
 *
 * Deliberately GENEROUS: it offers a site at every word from the anchor onward,
 * because a list ("named Sword of Kaldra, Shield of Kaldra") names cards that do
 * not sit at the anchor, and this function cannot know where item one ended
 * without the card table. Its only consumer is a caller asking "which of these
 * are real names?", where an extra candidate costs a longer lookup and nothing
 * else. `resolveOracleReferences` is the one that decides what actually links,
 * and it walks lists strictly.
 */
export const oracleReferenceCandidates = (text: string): readonly OracleReferenceSite[] => {
  const sites: OracleReferenceSite[] = []
  for (const start of anchorStarts(text)) {
    let at = start
    for (let item = 0; item < MAX_NAME_WORDS; item++) {
      const candidates = candidatesAt(text, at)
      if (candidates.length === 0) break
      sites.push({ start: at, candidates })
      const space = text.indexOf(' ', at)
      const nextLine = text.indexOf('\n', at)
      // Never step onto the next ability: a list of names does not span one.
      if (space === -1 || (nextLine !== -1 && nextLine < space)) break
      at = space + 1
      if (at >= text.length) break
    }
  }
  return sites.sort((a, b) => a.start - b.start)
}

/** The names a card calls ITSELF, which must never become links. */
const selfNames = (self: string): ReadonlySet<string> => {
  const out = new Set<string>()
  const add = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    out.add(trimmed)
    // Alchemy rebalances are printed "A-Sol Ring" but write "Sol Ring" in their
    // own text, so the base name is still a self-reference.
    if (trimmed.startsWith('A-')) add(trimmed.slice(2))
    // Legends refer to themselves by the part before the comma: "Nicol Bolas
    // deals 10 damage" on Nicol Bolas, God-Pharaoh.
    const comma = trimmed.indexOf(',')
    if (comma > 0) out.add(trimmed.slice(0, comma).trim())
  }
  add(self)
  if (self.includes(' // ')) for (const face of self.split(' // ')) add(face)
  return out
}

/**
 * The cards this text names, resolved against `known`.
 *
 * `known` is the set of real card names — supplied by the caller because
 * `packages/domain` may not read a database (R1). `self` is the name of the card
 * whose text this is; references to it are dropped.
 */
export const resolveOracleReferences = (
  text: string,
  known: ReadonlySet<string>,
  self: string,
): readonly OracleReference[] => {
  const mine = selfNames(self)
  const found: OracleReference[] = []
  for (const start of anchorStarts(text)) {
    let at = start
    // A name already claimed here means an earlier anchor overlapped this one.
    if (found.some((r) => at < r.end && r.start <= at)) continue
    for (let item = 0; ; item++) {
      const hit = candidatesAt(text, at).find((candidate) => {
        /*
         * `known` is what the caller considers LINKABLE. A card's own name and a
         * basic land are still names, and the walk has to be able to step over
         * them to reach the items after them in a list — "Equipment named Helm
         * of Kaldra, Sword of Kaldra, and Shield of Kaldra" begins with the card
         * itself, and a caller whose known-set is only the linkable cards would
         * stop dead on the first item and lose both real links. Recognised here
         * rather than by asking every caller to pad its set, because a caller
         * that forgets simply gets no links and no error — which is how this
         * shipped green and broke in a browser.
         */
        if (!known.has(candidate) && !mine.has(candidate) && !BASIC_LANDS.has(candidate)) return false
        if (!endsHere(text.slice(at + candidate.length))) return false
        /*
         * A continuation item must be multi-word. The anchor's FIRST item may be
         * a single word — "conjure a card named Plummet" is real — but after a
         * separator a bare word is almost always prose that the separator ran
         * into: "named Skoa, Embermage, Sacrifice two Mountains" reads
         * `Sacrifice` as a list item, and `Sacrifice` is a real card. Measured
         * over the corpus this rule removed exactly the two false positives of
         * that shape (`Sacrifice`, `X`) and cost no true list item, because
         * every genuine list in the table — the Kaldra equipment, the Urza
         * lands, Crown/Scepter/Throne of Empires — is made of multi-word names.
         */
        return item === 0 || candidate.includes(' ')
      })
      if (hit === undefined) break
      const end = at + hit.length
      // Self and basic-land references are still CONSUMED, so the walk can step
      // over them to the next item, but they never become links.
      if (!mine.has(hit) && !BASIC_LANDS.has(hit)) found.push({ name: hit, start: at, end })
      const separator = LIST_SEPARATOR.exec(text.slice(end))
      if (separator === null) break
      at = end + separator[0].length
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/**
 * `text` cut into prose and card-name segments, in order.
 *
 * The segments always rejoin to exactly the input — a renderer that drops or
 * duplicates a character has changed what the card does, so this is pinned by a
 * test rather than left to the caller.
 */
export const splitOracleText = (
  text: string,
  known: ReadonlySet<string>,
  self: string,
): readonly OracleSegment[] => {
  const refs = resolveOracleReferences(text, known, self)
  if (refs.length === 0) return [{ kind: 'text', text }]
  const out: OracleSegment[] = []
  let at = 0
  for (const ref of refs) {
    if (ref.start > at) out.push({ kind: 'text', text: text.slice(at, ref.start) })
    out.push({ kind: 'name', text: text.slice(ref.start, ref.end) })
    at = ref.end
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}
