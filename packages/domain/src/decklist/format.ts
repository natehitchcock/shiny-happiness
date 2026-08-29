import type { OracleId } from '../ids.js'
import { assertNever } from '../assert-never.js'

/**
 * Decklist formatting (doc 15 §15.4).
 *
 * Only `json` round-trips losslessly. Every text format drops exclusions, locks,
 * origins, archetype and snapshots, and the UI states that where the user can see
 * it rather than hiding it in a tooltip.
 */

export type ExportFormat = 'text' | 'moxfield' | 'mtgo' | 'csv' | 'json'

export interface ExportEntry {
  readonly oracleId: OracleId
  readonly name: string
  readonly quantity: number
  readonly isCommander: boolean
  readonly category: string | null
  readonly setCode: string | null
  readonly collectorNumber: string | null
}

export interface ExportDeck {
  readonly name: string
  readonly entries: readonly ExportEntry[]
}

/** Formats that cannot carry our extra state. Used to drive the UI notice. */
export const LOSSY_FORMATS: ReadonlySet<ExportFormat> = new Set<ExportFormat>([
  'text',
  'moxfield',
  'mtgo',
  'csv',
])

const escapeCsv = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const byCategory = (entries: readonly ExportEntry[]): Map<string, ExportEntry[]> => {
  const groups = new Map<string, ExportEntry[]>()
  for (const entry of entries) {
    const key = entry.category ?? 'Deck'
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [entry])
    else bucket.push(entry)
  }
  return groups
}

export const formatDecklist = (deck: ExportDeck, format: ExportFormat): string => {
  switch (format) {
    case 'text': {
      const commanders = deck.entries.filter((e) => e.isCommander)
      const rest = deck.entries.filter((e) => !e.isCommander)
      return [...commanders, ...rest].map((e) => `${e.quantity} ${e.name}`).join('\n')
    }

    case 'moxfield': {
      const lines: string[] = []
      for (const entry of deck.entries.filter((e) => e.isCommander)) {
        lines.push(`${entry.quantity} ${entry.name} *CMDR*`)
      }
      const rest = deck.entries.filter((e) => !e.isCommander)
      for (const [category, group] of byCategory(rest)) {
        lines.push('', `// ${category}`)
        for (const entry of group) lines.push(`${entry.quantity} ${entry.name}`)
      }
      return lines.join('\n').trim()
    }

    case 'mtgo':
      // MTGO's plain format: quantity, a space, the name. Commanders are not
      // distinguished — the format has no concept of one.
      return deck.entries.map((e) => `${e.quantity} ${e.name}`).join('\n')

    case 'csv': {
      const header = 'Count,Name,Commander,Category,Set,CollectorNumber'
      const rows = deck.entries.map((e) =>
        [
          String(e.quantity),
          escapeCsv(e.name),
          e.isCommander ? 'true' : 'false',
          escapeCsv(e.category ?? ''),
          e.setCode ?? '',
          e.collectorNumber ?? '',
        ].join(','),
      )
      return [header, ...rows].join('\n')
    }

    case 'json':
      return JSON.stringify(deck, null, 2)

    default:
      return assertNever(format, 'formatDecklist')
  }
}
