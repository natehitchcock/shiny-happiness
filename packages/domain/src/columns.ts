/**
 * The columns a deck is judged in (doc 18 §18.7).
 *
 * > "any added or removed column should be saved along with the deck - the
 * > filters are basically part of the deck"
 *
 * Columns lived in `useState` and died with the page. They are deck state.
 *
 * A column does NOT filter and does NOT reorder: it evaluates something per row
 * and shows the answer beside the card, so the list is exactly the list it would
 * have been. That is what separates a column from the query, and it is why the
 * two metrics in `impact.ts` and `efficiency.ts` are columns rather than scoring
 * terms — they are facts about a card, not opinions about a deck.
 */

/**
 * A named, card-intrinsic number a column can draw.
 *
 * A closed union rather than an open string. The set is small, every member
 * needs a renderer and a formatter, and an unknown metric arriving from an older
 * or newer build has to be dropped rather than rendered as a blank cell nobody
 * can explain.
 */
export type ColumnMetric = 'impact' | 'efficiency'

export const COLUMN_METRICS: readonly ColumnMetric[] = ['impact', 'efficiency']

/**
 * Either a user query string or a named metric.
 *
 * A DISCRIMINATED UNION, not a bare string with magic values. Encoding the
 * metrics as reserved query strings — `"impact"` parsed specially — works right
 * up until a builder types `impact` as an actual oracle search, at which point
 * their column silently becomes something else. The union makes that
 * unrepresentable, which is AGENTS.md §7's standing preference anyway.
 *
 * The two kinds are equal citizens: both can be added, removed, reordered and
 * sorted by. A metric is not a privileged always-present cell — see
 * `DEFAULT_COLUMNS`.
 */
export type DeckColumn =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'metric'; readonly metric: ColumnMetric }

/**
 * What a deck shows before anyone has said otherwise.
 *
 * The two metrics ship as ORDINARY COLUMNS, present by default until removed.
 * The rejected alternative was a fixed pair of cells outside the column
 * machinery, with no add, no remove and no sort: a builder who does not care
 * about efficiency would then have no way to get rid of it, which is a worse
 * version of the problem this whole feature exists to fix.
 *
 * A constant, so adding a third metric to the defaults later is a one-line
 * change rather than a data migration — which is only true because the stored
 * value distinguishes "never set" from "deliberately empty". See `Deck.columns`.
 */
export const DEFAULT_COLUMNS: readonly DeckColumn[] = Object.freeze([
  Object.freeze({ kind: 'metric', metric: 'impact' }),
  Object.freeze({ kind: 'metric', metric: 'efficiency' }),
] as const)

/** A deck that has removed every column. Distinct from never having set any. */
export const NO_COLUMNS: readonly DeckColumn[] = Object.freeze([])

/**
 * The columns to draw for a deck.
 *
 * `undefined`/`null` is "never set" and gets the defaults; `[]` is "removed them
 * all" and gets none. Every reader must go through this rather than testing
 * `length === 0`, or a builder who cleared their columns gets them back on the
 * next page load.
 */
export const columnsFor = (
  columns: readonly DeckColumn[] | null | undefined,
): readonly DeckColumn[] => (columns === null || columns === undefined ? DEFAULT_COLUMNS : columns)

/** The identity a UI can key a column by, and the value a duplicate check compares. */
export const columnKey = (column: DeckColumn): string =>
  column.kind === 'metric' ? `metric:${column.metric}` : `query:${column.query}`

/** How many columns one deck may hold. */
const MAX_COLUMNS = 12

/** The longest query a column may carry — the same bound `q` takes on the wire. */
const MAX_QUERY_LENGTH = 500

const isMetric = (value: unknown): value is ColumnMetric =>
  typeof value === 'string' && (COLUMN_METRICS as readonly string[]).includes(value)

/**
 * Read columns out of untrusted JSON.
 *
 * `null` for absent, `DeckColumn[]` for present — INCLUDING the empty array,
 * which is a real state and must survive the round trip. Anything else parses to
 * `null`, meaning "not set", so a corrupt value returns the deck to its defaults
 * rather than to no columns at all; the defaults are the state the deck would
 * have been in had the value never been written.
 *
 * Parsing rather than casting, the discipline `parseTargetOverrides` and
 * `parseSemanticEmphasis` established. An entry it cannot read costs that entry
 * and nothing else: a metric this build does not know would otherwise reach the
 * renderer as a blank cell with no explanation, and throwing would make one bad
 * entry a deck that will not open.
 *
 * Duplicates are dropped, keeping the FIRST occurrence, because a column is
 * identified by what it shows: two columns of `t:creature` are one column drawn
 * twice, and the sort would have no way to say which was clicked.
 *
 * Pure and total.
 */
export const parseDeckColumns = (value: unknown): readonly DeckColumn[] | null => {
  if (!Array.isArray(value)) return null
  const kept: DeckColumn[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (kept.length >= MAX_COLUMNS) break
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    let column: DeckColumn
    if (record['kind'] === 'metric' && isMetric(record['metric'])) {
      column = { kind: 'metric', metric: record['metric'] }
    } else if (
      record['kind'] === 'query' &&
      typeof record['query'] === 'string' &&
      record['query'].trim() !== '' &&
      record['query'].length <= MAX_QUERY_LENGTH
    ) {
      // Trimmed on the way in, so `"t:creature"` and `"t:creature "` cannot both
      // be stored as distinct columns that render identically.
      column = { kind: 'query', query: record['query'].trim() }
    } else {
      continue
    }
    const key = columnKey(column)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(column)
  }
  return kept
}

/** The query strings among a deck's columns — what the recommendations endpoint takes. */
export const queryColumns = (columns: readonly DeckColumn[]): readonly string[] =>
  columns.flatMap((c) => (c.kind === 'query' ? [c.query] : []))
