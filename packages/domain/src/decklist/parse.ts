/**
 * Decklist parsing (doc 15 §15.2, DOM-07).
 *
 * One parser, format-sniffed. Asking someone which site their clipboard came
 * from is asking them to do the computer's job.
 *
 * Section headers are READ, NOT TRUSTED: a `SORCERY (12)` header tells us
 * nothing our own type data does not, and a user's own Moxfield categories are
 * *their* taxonomy. They are preserved as tags on the entry, never mapped onto
 * our `Role` union (doc 15 §15.2).
 */

export interface ParsedEntry {
  /** 1-based, for pointing at the offending line in the UI. */
  readonly line: number
  readonly raw: string
  readonly quantity: number
  readonly name: string
  readonly setCode: string | null
  readonly collectorNumber: string | null
  /** Section headers in force when this line was read. */
  readonly tags: readonly string[]
  readonly isCommander: boolean
  readonly section: 'main' | 'commander' | 'sideboard' | 'maybeboard'
}

export interface ParsedLineProblem {
  readonly line: number
  readonly raw: string
  readonly reason: string
}

export interface ParsedDecklist {
  readonly entries: readonly ParsedEntry[]
  readonly problems: readonly ParsedLineProblem[]
}

const COMMANDER_MARKERS = /\*(CMDR|COMMANDER)\*/i
/** `SORCERY (12)`, `Ramp (11)`, `Creatures` — a header, not a card. */
const CATEGORY_HEADER = /^([A-Za-z][A-Za-z '/-]*)\s*(\(\d+\))?\s*$/
const SECTION_WORDS: ReadonlyMap<string, ParsedEntry['section']> = new Map([
  ['commander', 'commander'],
  ['commanders', 'commander'],
  ['sideboard', 'sideboard'],
  ['maybeboard', 'maybeboard'],
  ['considering', 'maybeboard'],
  ['deck', 'main'],
  ['mainboard', 'main'],
  ['main', 'main'],
])

/** `1 Name`, `1x Name`, `1 Name (SET) 123`. Quantity is optional; absent means 1. */
const LINE = /^\s*(?:(\d+)\s*[xX]?\s+)?(.+?)\s*$/

export const parseDecklist = (text: string): ParsedDecklist => {
  const entries: ParsedEntry[] = []
  const problems: ParsedLineProblem[] = []

  let section: ParsedEntry['section'] = 'main'
  let category: string | null = null

  // Split on either line ending — a Windows clipboard is not an error.
  const lines = text.split(/\r\n|\r|\n/)

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1
    const trimmed = rawLine.trim()
    if (trimmed === '') continue

    // Comments and section markers: `// Maybeboard`, `# Ramp`.
    const commentMatch = /^(?:\/\/|#)\s*(.*)$/.exec(trimmed)
    if (commentMatch !== null) {
      const word = (commentMatch[1] ?? '').trim().toLowerCase()
      const asSection = SECTION_WORDS.get(word)
      if (asSection !== undefined) {
        section = asSection
        category = null
      } else if (word !== '') {
        category = (commentMatch[1] ?? '').trim()
      }
      continue
    }

    const match = LINE.exec(trimmed)
    if (match === null) {
      problems.push({ line: lineNumber, raw: rawLine, reason: 'could not read this line' })
      continue
    }

    const quantityText = match[1]
    let body = (match[2] ?? '').trim()

    // A bare word with no quantity is a header, not a one-of. `Sol Ring` alone is
    // ambiguous, but `Commander` or `SORCERY (12)` is not.
    if (quantityText === undefined) {
      const header = CATEGORY_HEADER.exec(body)
      if (header !== null) {
        const word = (header[1] ?? '').trim().toLowerCase()
        const asSection = SECTION_WORDS.get(word)
        if (asSection !== undefined) {
          section = asSection
          category = null
        } else {
          category = (header[1] ?? '').trim()
        }
        continue
      }
    }

    const isCommander = COMMANDER_MARKERS.test(body)
    body = body.replace(COMMANDER_MARKERS, '').trim()

    // Trailing `(SET) 123` or `(SET)`.
    let setCode: string | null = null
    let collectorNumber: string | null = null
    const printing = /\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-]+)?\s*$/.exec(body)
    if (printing !== null) {
      setCode = (printing[1] ?? '').toUpperCase()
      collectorNumber = printing[2] ?? null
      body = body.slice(0, printing.index).trim()
    }

    // Trailing category annotations some exporters add: `Sol Ring [Ramp]`.
    const bracket = /\[([^\]]+)\]\s*$/.exec(body)
    let bracketTag: string | null = null
    if (bracket !== null) {
      bracketTag = (bracket[1] ?? '').trim()
      body = body.slice(0, bracket.index).trim()
    }

    if (body === '') {
      problems.push({ line: lineNumber, raw: rawLine, reason: 'no card name on this line' })
      continue
    }

    const quantity = quantityText === undefined ? 1 : Number.parseInt(quantityText, 10)
    if (!Number.isFinite(quantity) || quantity < 1) {
      problems.push({
        line: lineNumber,
        raw: rawLine,
        reason: `invalid quantity "${quantityText}"`,
      })
      continue
    }

    const tags = [category, bracketTag].filter((t): t is string => t !== null && t !== '')

    entries.push({
      line: lineNumber,
      raw: rawLine,
      quantity,
      name: body,
      setCode,
      collectorNumber,
      tags,
      isCommander: isCommander || section === 'commander',
      section: section === 'commander' ? 'commander' : section,
    })
  }

  return { entries, problems }
}
