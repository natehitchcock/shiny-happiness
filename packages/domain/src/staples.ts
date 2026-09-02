import type { Card } from './card.js'
import rawStaples from './staples/staples.data.json' with { type: 'json' }

/**
 * The curated staples list (ADR-0044).
 *
 * ONE DEFINITION, TWO SURFACES. Quickbuild's opening phase and the suggestion
 * feed's leading groups both read this file and nothing else. That is the whole
 * reason it is a module rather than two lists in two places: the wizard and the
 * feed disagreeing about what a staple is would be the worst possible outcome
 * of the feature, since the builder sees both at once.
 *
 * CURATED, NOT DERIVED, AND NOT FETCHED. ADR-0008 forbids querying EDHREC, and
 * the inclusion statistic that could otherwise have defined "staple" is inert
 * in production — `stats: null`, so `w.inclusion * (s.stats?.inclusion ?? 0)`
 * contributes exactly zero to every card's score. There is no measurement of
 * "how often is this played" available to this codebase at all. A curated list
 * is honest about being an opinion; a threshold over a number nobody computed
 * would look like a measurement and be one only in appearance.
 *
 * REJECTED: deriving it from `edhrecRank`. It is on every card and it is
 * tempting, and it is a rank over the WHOLE format rather than over Commander
 * decks of these colours — it would put whatever is currently in Standard at
 * the head of a Commander build. Rejected also because it would be a second
 * silent opinion with no owner and no line to edit, which is exactly what the
 * curated file exists to avoid.
 *
 * REJECTED: deriving it from `cardImpact` or `cardEfficiency`. Both are honest
 * card-intrinsic measures and neither is a claim about how often a deck wants
 * the card: doc 18 records Sol Ring at impact 0.68 and Wrath of God at 6.12,
 * so an impact threshold would drop the most universally played card in the
 * format and keep board wipes. "Does a lot" and "every deck wants it" are
 * different questions.
 */

/** One curated entry, exactly as the file holds it. */
export interface StapleEntry {
  readonly name: string
  /** Prose for the file's owner. Read by nothing here — see the data file. */
  readonly why: string
}

/** The shape of `staples.data.json`. */
export interface RawStapleData {
  readonly $comment: readonly string[]
  readonly curatedAt: string
  readonly verifiedAgainstCorpusAt: string
  readonly owner: string
  readonly cards: readonly StapleEntry[]
}

/**
 * The checked-in list.
 *
 * A static import, not a read: `packages/domain` does no IO (AGENTS.md R1), and
 * the build copies `src/staples` into `dist/staples` the same way it does
 * `src/brackets`, so the specifier still resolves once compiled. Exported so a
 * test can assert against the same bytes the product loads rather than
 * re-reading the file by its own path.
 */
export const STAPLE_DATA = rawStaples as unknown as RawStapleData

export interface CuratedStaples {
  /** When the opinion was last revised. */
  readonly curatedAt: string
  /** When every name was last checked to resolve against the corpus. */
  readonly verifiedAgainstCorpusAt: string
  /** Who decides what is on the list. */
  readonly owner: string
  /** Exact card names. Membership is a string match and nothing looser. */
  readonly names: ReadonlySet<string>
}

export const STAPLES: CuratedStaples = {
  curatedAt: STAPLE_DATA.curatedAt,
  verifiedAgainstCorpusAt: STAPLE_DATA.verifiedAgainstCorpusAt,
  owner: STAPLE_DATA.owner,
  names: new Set(STAPLE_DATA.cards.map((entry) => entry.name)),
}

/**
 * Membership, BY EXACT NAME.
 *
 * Not case-folded, not trimmed, not fuzzy. `cards.name` is Scryfall's oracle
 * name and is the identity the whole corpus is keyed on; a looser match would
 * let "Path to Exile" also claim "Path to Exile // Something", and a list whose
 * membership rule is approximate cannot be audited. The cost of exactness is
 * that a typo resolves to nothing — which is why there is a corpus test that
 * fails when an entry stops resolving, rather than a silent fallback here.
 */
export const isStaple = (name: string): boolean => STAPLES.names.has(name)

/** Which of the two leading groups a card belongs to, if either. */
export type StapleGroup = 'staple' | 'staple-land'

/**
 * The split the user asked for — "separate staples and staple lands" — DERIVED
 * from the card rather than declared in the data file (ADR-0044).
 *
 * TWO LISTS WERE REJECTED, AND SO WAS A `type` FIELD IN ONE LIST. Both encode
 * the same fact twice: whether a card is a land is already in the corpus, on
 * `types`, put there by the ingest from Scryfall's type line. A second copy in
 * a hand-edited file is a copy that can disagree with the first, and ADR-0031
 * is this repository's own record of what that costs — grouping read
 * `roles[0]` while counting read `primaryRole`, the two disagreed on 8.4% of a
 * real pool, and a fifth of the rows ended up under a heading that was not
 * true of them. Putting `"type": "land"` beside `"name": "Command Tower"`
 * would be that defect pre-committed to disk.
 *
 * It is also the change that would age worst. Lands gain and lose faces:
 * a modal double-faced card is a land on one side, and the corpus already
 * carries both faces' types (`card.ts`, `types`). The derived split follows
 * that for free; a checked-in `type` field would have to be re-reviewed every
 * time the printing changed, by somebody who remembered to.
 *
 * What is genuinely lost: the file can no longer say "I meant this to be a
 * land staple", so a name that is not a land will silently lead the spells
 * phase rather than the lands phase. That is caught where it can actually be
 * caught — against the corpus, in the test that resolves every name — rather
 * than by a field that only records what the editor believed.
 *
 * `types` rather than a regex over `typeLine`: `isEligible` in `recommend.ts`
 * reads the type line only because it needs the word "Basic" and `types` has
 * no such entry. Here the question is exactly what `types` answers.
 */
export const stapleGroupFor = (card: Pick<Card, 'name' | 'types'>): StapleGroup | null => {
  if (!isStaple(card.name)) return null
  return card.types.includes('land') ? 'staple-land' : 'staple'
}
