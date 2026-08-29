import type { OracleId } from '../ids.js'
import type { ParsedEntry } from './parse.js'

/**
 * Name resolution (doc 15 §15.6).
 *
 * Exact, then normalised, then fuzzy above a confidence floor — and BELOW that
 * floor it asks rather than guessing. A confidently wrong card is worse than an
 * unresolved line, because the user never finds out.
 */

export const CONFIDENCE_FLOOR = 0.82

/** Case, punctuation, accents, and the second half of a split card. */
export const normaliseName = (name: string): string =>
  name
    .split('//')[0]!
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const editDistance = (a: string, b: string): number => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

export const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest
}

export interface CardNameIndex {
  /** normalised name → oracle id. */
  readonly byNormalised: ReadonlyMap<string, OracleId>
  /** Every known normalised name, for fuzzy matching. */
  readonly allNormalised: readonly string[]
}

export const buildNameIndex = (
  cards: Iterable<{ readonly oracleId: OracleId; readonly name: string }>,
): CardNameIndex => {
  const byNormalised = new Map<string, OracleId>()
  for (const card of cards) byNormalised.set(normaliseName(card.name), card.oracleId)
  return { byNormalised, allNormalised: [...byNormalised.keys()] }
}

export interface Resolved {
  readonly entry: ParsedEntry
  readonly oracleId: OracleId
  readonly confidence: number
  readonly method: 'exact' | 'fuzzy'
}

export interface Unresolved {
  readonly entry: ParsedEntry
  readonly reason: string
  /** Best guesses, best first — offered, never applied (doc 15 §15.3). */
  readonly suggestions: readonly OracleId[]
}

export const resolveEntry = (entry: ParsedEntry, index: CardNameIndex): Resolved | Unresolved => {
  const normalised = normaliseName(entry.name)
  const exact = index.byNormalised.get(normalised)
  if (exact !== undefined) {
    return { entry, oracleId: exact, confidence: 1, method: 'exact' }
  }

  const scored = index.allNormalised
    .map((candidate) => ({ candidate, score: similarity(normalised, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const best = scored[0]
  if (best !== undefined && best.score >= CONFIDENCE_FLOOR) {
    return {
      entry,
      oracleId: index.byNormalised.get(best.candidate)!,
      confidence: best.score,
      method: 'fuzzy',
    }
  }

  return {
    entry,
    reason: `no card matches "${entry.name}"`,
    suggestions: scored
      .filter((s) => s.score > 0.5)
      .map((s) => index.byNormalised.get(s.candidate)!),
  }
}

export const isResolved = (r: Resolved | Unresolved): r is Resolved => 'oracleId' in r

export interface ResolvedDecklist {
  readonly resolved: readonly Resolved[]
  readonly unresolved: readonly Unresolved[]
}

/** Unresolved lines never block the import — bring in what parsed (doc 15 §15.3). */
export const resolveDecklist = (
  entries: readonly ParsedEntry[],
  index: CardNameIndex,
): ResolvedDecklist => {
  const resolved: Resolved[] = []
  const unresolved: Unresolved[] = []
  for (const entry of entries) {
    const result = resolveEntry(entry, index)
    if (isResolved(result)) resolved.push(result)
    else unresolved.push(result)
  }
  return { resolved, unresolved }
}
