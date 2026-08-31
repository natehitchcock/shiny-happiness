import { describe, expect, it } from 'vitest'
import {
  COLUMN_METRICS,
  DEFAULT_COLUMNS,
  columnKey,
  columnsFor,
  parseDeckColumns,
  queryColumns,
  type DeckColumn,
} from './columns.js'

describe('parseDeckColumns', () => {
  it('keeps a metric column', () => {
    expect(parseDeckColumns([{ kind: 'metric', metric: 'impact' }])).toEqual([
      { kind: 'metric', metric: 'impact' },
    ])
  })

  it('keeps a query column', () => {
    expect(parseDeckColumns([{ kind: 'query', query: 't:creature' }])).toEqual([
      { kind: 'query', query: 't:creature' },
    ])
  })

  it('keeps the ORDER, because the order is what the builder arranged', () => {
    const stored = [
      { kind: 'query', query: 'mv<=2' },
      { kind: 'metric', metric: 'efficiency' },
      { kind: 'metric', metric: 'impact' },
    ]
    expect(parseDeckColumns(stored)).toEqual(stored)
  })

  it('distinguishes "never set" from "deliberately none"', () => {
    // The whole reason the column is nullable. `[]` must survive the round trip
    // or a builder who cleared their columns gets them back on the next load.
    expect(parseDeckColumns(null)).toBeNull()
    expect(parseDeckColumns(undefined)).toBeNull()
    expect(parseDeckColumns([])).toEqual([])
  })

  it('reads a non-array as never set, NOT as none', () => {
    // A corrupt value returns the deck to its defaults, which is the state it
    // would have been in had the value never been written. Returning `[]` would
    // claim the builder had deliberately removed everything.
    expect(parseDeckColumns({ kind: 'metric' })).toBeNull()
    expect(parseDeckColumns('impact')).toBeNull()
    expect(parseDeckColumns(7)).toBeNull()
  })

  it('drops a metric this build does not know rather than the whole list', () => {
    // A row written by a newer build. Losing one column is recoverable.
    expect(
      parseDeckColumns([
        { kind: 'metric', metric: 'not-a-metric' },
        { kind: 'metric', metric: 'impact' },
      ]),
    ).toEqual([{ kind: 'metric', metric: 'impact' }])
  })

  it('drops entries that are not columns at all', () => {
    expect(
      parseDeckColumns([
        null,
        'impact',
        42,
        { kind: 'query' },
        { kind: 'metric', metric: 'impact' },
      ]),
    ).toEqual([{ kind: 'metric', metric: 'impact' }])
  })

  it('drops an empty or whitespace-only query', () => {
    expect(parseDeckColumns([{ kind: 'query', query: '   ' }])).toEqual([])
  })

  it('trims a query so two spellings cannot become two identical columns', () => {
    expect(parseDeckColumns([{ kind: 'query', query: ' t:creature ' }])).toEqual([
      { kind: 'query', query: 't:creature' },
    ])
  })

  it('drops a query longer than the wire bound', () => {
    expect(parseDeckColumns([{ kind: 'query', query: 'x'.repeat(501) }])).toEqual([])
  })

  it('deduplicates, keeping the first occurrence', () => {
    expect(
      parseDeckColumns([
        { kind: 'metric', metric: 'impact' },
        { kind: 'query', query: 't:creature' },
        { kind: 'metric', metric: 'impact' },
      ]),
    ).toEqual([
      { kind: 'metric', metric: 'impact' },
      { kind: 'query', query: 't:creature' },
    ])
  })

  it('caps the list rather than storing whatever arrives', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'query', query: `mv=${String(i)}` }))
    expect(parseDeckColumns(many)).toHaveLength(12)
  })
})

describe('columnsFor', () => {
  it('gives the defaults to a deck that never set any', () => {
    expect(columnsFor(null)).toEqual(DEFAULT_COLUMNS)
    expect(columnsFor(undefined)).toEqual(DEFAULT_COLUMNS)
  })

  it('gives NOTHING to a deck that removed them all', () => {
    // The failure this whole distinction exists to prevent: a customisation
    // that undoes itself on the next page load.
    expect(columnsFor([])).toEqual([])
  })

  it('gives back exactly what was set', () => {
    const set: readonly DeckColumn[] = [{ kind: 'query', query: 'mv<=2' }]
    expect(columnsFor(set)).toEqual(set)
  })
})

describe('DEFAULT_COLUMNS', () => {
  it('is the two metrics, as ordinary removable columns', () => {
    expect(DEFAULT_COLUMNS).toEqual([
      { kind: 'metric', metric: 'impact' },
      { kind: 'metric', metric: 'efficiency' },
    ])
  })

  it('names only metrics this build knows', () => {
    for (const column of DEFAULT_COLUMNS) {
      expect(column.kind).toBe('metric')
      if (column.kind === 'metric') expect(COLUMN_METRICS).toContain(column.metric)
    }
  })

  it('survives its own parser, so a default can always be stored', () => {
    expect(parseDeckColumns(DEFAULT_COLUMNS)).toEqual(DEFAULT_COLUMNS)
  })
})

describe('columnKey', () => {
  it('separates a metric from a query that happens to spell it', () => {
    // The reason a column is a tagged union rather than a bare string: a builder
    // may legitimately search for the word `impact`.
    expect(columnKey({ kind: 'metric', metric: 'impact' })).not.toBe(
      columnKey({ kind: 'query', query: 'impact' }),
    )
  })
})

describe('queryColumns', () => {
  it('returns only the query columns, in order', () => {
    // Metric columns are evaluated nowhere — the number is already on the row —
    // so this is what the recommendations request body carries.
    expect(
      queryColumns([
        { kind: 'metric', metric: 'impact' },
        { kind: 'query', query: 't:creature' },
        { kind: 'query', query: 'mv<=2' },
      ]),
    ).toEqual(['t:creature', 'mv<=2'])
  })

  it('is empty for a deck showing only metrics', () => {
    expect(queryColumns(DEFAULT_COLUMNS)).toEqual([])
  })
})
