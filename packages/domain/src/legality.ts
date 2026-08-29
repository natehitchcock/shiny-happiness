import type { Card, Color } from './card.js'
import type { Deck, PartnerRule } from './deck.js'
import type { OracleId } from './ids.js'

/**
 * Commander deck legality (doc 03 §3.1, DOM-06).
 *
 * Enforced in the domain, not the UI, so `web` and `api` agree exactly.
 */

export type LegalityProblem =
  | { readonly kind: 'wrong-card-count'; readonly actual: number; readonly expected: 100 }
  | { readonly kind: 'not-singleton'; readonly oracleId: OracleId; readonly copies: number; readonly allowed: number }
  | { readonly kind: 'banned'; readonly oracleId: OracleId }
  | { readonly kind: 'not-legal-in-commander'; readonly oracleId: OracleId }
  | { readonly kind: 'color-identity'; readonly oracleId: OracleId; readonly offending: readonly Color[] }
  | { readonly kind: 'no-commander' }
  | { readonly kind: 'too-many-commanders'; readonly count: number }
  | { readonly kind: 'invalid-commander'; readonly oracleId: OracleId; readonly reason: string }
  | { readonly kind: 'invalid-partnership'; readonly reason: string }
  | { readonly kind: 'unknown-card'; readonly oracleId: OracleId }

export interface LegalityReport {
  readonly legal: boolean
  readonly problems: readonly LegalityProblem[]
}

export interface SingletonExceptions {
  /** Cards you may run any number of (Relentless Rats and friends). */
  readonly unlimited: ReadonlySet<OracleId>
  /** Cards with a specific higher limit (e.g. Nazgûl). */
  readonly limited: ReadonlyMap<OracleId, number>
}

export const NO_SINGLETON_EXCEPTIONS: SingletonExceptions = {
  unlimited: new Set(),
  limited: new Map(),
}

/** A card that may be a commander, and under what partnership rule. */
export interface CommanderInfo {
  readonly canBeCommander: boolean
  readonly partnerRule: PartnerRule
}

const isBasicLand = (card: Card): boolean => /\bBasic\b.*\bLand\b/.test(card.typeLine)

/** Union of the commanders' colour identities — the deck's legal colour space. */
export const deckColorIdentity = (
  commanders: readonly OracleId[],
  cards: ReadonlyMap<OracleId, Card>,
): readonly Color[] => {
  const identity = new Set<Color>()
  for (const commander of commanders) {
    for (const color of cards.get(commander)?.colorIdentity ?? []) identity.add(color)
  }
  return [...identity]
}

/**
 * Whether two cards may be commanders together.
 *
 * Each partnership is its own rule with its own constraint, so they stay distinct
 * variants rather than collapsing into a boolean (doc 03 §3.1). `partner-with`
 * in particular is not symmetric-by-default: it names a specific card.
 */
export const partnershipAllowed = (
  a: { readonly oracleId: OracleId; readonly partnerRule: PartnerRule },
  b: { readonly oracleId: OracleId; readonly partnerRule: PartnerRule },
): { readonly allowed: boolean; readonly reason: string } => {
  const ra = a.partnerRule
  const rb = b.partnerRule

  if (ra.kind === 'partner-with' || rb.kind === 'partner-with') {
    const namesEachOther =
      (ra.kind === 'partner-with' && ra.partner === b.oracleId) ||
      (rb.kind === 'partner-with' && rb.partner === a.oracleId)
    return namesEachOther
      ? { allowed: true, reason: 'partner with' }
      : { allowed: false, reason: 'these cards do not name each other as partners' }
  }
  if (ra.kind === 'partner' && rb.kind === 'partner') {
    return { allowed: true, reason: 'partner' }
  }
  if (ra.kind === 'friends-forever' && rb.kind === 'friends-forever') {
    return { allowed: true, reason: 'friends forever' }
  }
  if (ra.kind === 'doctors-companion' || rb.kind === 'doctors-companion') {
    // One must be the companion, the other a Doctor — modelled by the caller
    // supplying `background`/`doctors-companion` correctly at ingest.
    return { allowed: true, reason: "doctor's companion" }
  }
  if (
    (ra.kind === 'background' && rb.kind === 'none') ||
    (rb.kind === 'background' && ra.kind === 'none')
  ) {
    return { allowed: true, reason: 'choose a background' }
  }
  return { allowed: false, reason: 'these commanders may not be paired' }
}

/**
 * Validate a deck.
 *
 * Reports EVERY problem rather than stopping at the first, because a deck with
 * four issues should show four, not make the user fix and re-run four times.
 */
export const validateDeck = (
  deck: Deck,
  cards: ReadonlyMap<OracleId, Card>,
  commanderInfo: ReadonlyMap<OracleId, CommanderInfo>,
  exceptions: SingletonExceptions = NO_SINGLETON_EXCEPTIONS,
): LegalityReport => {
  const problems: LegalityProblem[] = []

  // ---- commanders ----
  if (deck.commanders.length === 0) {
    problems.push({ kind: 'no-commander' })
  } else if (deck.commanders.length > 2) {
    problems.push({ kind: 'too-many-commanders', count: deck.commanders.length })
  } else {
    for (const oracleId of deck.commanders) {
      const info = commanderInfo.get(oracleId)
      if (info === undefined || !info.canBeCommander) {
        problems.push({ kind: 'invalid-commander', oracleId, reason: 'not legal as a commander' })
      }
    }
    if (deck.commanders.length === 2) {
      const [first, second] = deck.commanders as [OracleId, OracleId]
      const a = commanderInfo.get(first)
      const b = commanderInfo.get(second)
      if (a !== undefined && b !== undefined) {
        const verdict = partnershipAllowed(
          { oracleId: first, partnerRule: a.partnerRule },
          { oracleId: second, partnerRule: b.partnerRule },
        )
        if (!verdict.allowed) {
          problems.push({ kind: 'invalid-partnership', reason: verdict.reason })
        }
      }
    }
  }

  // ---- card count, counting copies ----
  // Counted from entries, NOT from acceptedSet: that returns a Set, which is the
  // right shape for combo lookups but collapses the duplicate copies the
  // singleton rule exists to catch.
  const copies = new Map<OracleId, number>()
  const bump = (id: OracleId) => copies.set(id, (copies.get(id) ?? 0) + 1)
  for (const id of deck.commanders) bump(id)
  for (const deckEntry of deck.entries) {
    if (deckEntry.zone === 'accepted' && !deck.commanders.includes(deckEntry.oracleId)) {
      bump(deckEntry.oracleId)
    }
  }

  let total = 0
  const identity = new Set(deck.colorIdentity)

  for (const [oracleId, count] of copies) {
    total += count
    const card = cards.get(oracleId)
    if (card === undefined) {
      problems.push({ kind: 'unknown-card', oracleId })
      continue
    }

    // ---- singleton ----
    if (count > 1 && !isBasicLand(card) && !exceptions.unlimited.has(oracleId)) {
      const allowed = exceptions.limited.get(oracleId) ?? 1
      if (count > allowed) {
        problems.push({ kind: 'not-singleton', oracleId, copies: count, allowed })
      }
    }

    // ---- format legality ----
    if (card.legalities.commander === 'banned') {
      problems.push({ kind: 'banned', oracleId })
    } else if (card.legalities.commander !== 'legal') {
      problems.push({ kind: 'not-legal-in-commander', oracleId })
    }

    // ---- colour identity ----
    // Scryfall's color_identity already accounts for mana symbols in rules text
    // and colour indicators. Do not recompute it (doc 03 §3.1).
    const offending = card.colorIdentity.filter((color) => !identity.has(color))
    if (offending.length > 0) {
      problems.push({ kind: 'color-identity', oracleId, offending })
    }
  }

  if (total !== 100) {
    problems.push({ kind: 'wrong-card-count', actual: total, expected: 100 })
  }

  return { legal: problems.length === 0, problems }
}
