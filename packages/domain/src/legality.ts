import type { Card, Color, Legality } from './card.js'
import type { Deck, PartnerRule } from './deck.js'
import type { OracleId } from './ids.js'

/**
 * Commander deck legality (doc 03 §3.1, DOM-06).
 *
 * Enforced in the domain, not the UI, so `web` and `api` agree exactly.
 */

export type LegalityProblem =
  | { readonly kind: 'wrong-card-count'; readonly actual: number; readonly expected: 100 }
  | {
      readonly kind: 'not-singleton'
      readonly oracleId: OracleId
      readonly copies: number
      readonly allowed: number
    }
  | { readonly kind: 'banned'; readonly oracleId: OracleId }
  | { readonly kind: 'not-legal-in-commander'; readonly oracleId: OracleId }
  | {
      readonly kind: 'color-identity'
      readonly oracleId: OracleId
      readonly offending: readonly Color[]
    }
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

/**
 * The printed front of a type line.
 *
 * Scryfall joins the faces of a two-faced card with ` // `, and the commander
 * rule is about the face you cast: Westvale Abbey's line is
 * `Land // Legendary Creature — Demon`, so a test against the whole string
 * offers a land as a commander. Ten `Invasion of …` battles have the same
 * shape. Taking the front is the only reading that gets both right.
 */
export const frontOfTypeLine = (typeLine: string): string =>
  typeLine.split(' // ')[0] ?? typeLine

/**
 * A card is a creature card everywhere except the battlefield.
 *
 * Exactly one card in the 34,492-card corpus says this — Grist, the Hunger
 * Tide — and it is why Grist leads decks despite a planeswalker type line: the
 * commander rule looks at the card in the command zone, where Grist is a
 * creature. The pattern is deliberately narrow rather than a general "is a
 * creature somewhere" reading, which would sweep in every card that animates
 * itself on the battlefield, none of which qualify.
 */
const CREATURE_OFF_BATTLEFIELD = /isn't on the battlefield, it's a[^.]*\bcreature\b/i

/** Backgrounds. `Choose a Background` says: "You can have a Background as a second commander." */
const BACKGROUND_SUBTYPE = /\bBackground\b/

/** Rowan Kenrith, Grist's fellow planeswalkers, and the Un-set oddities. */
const SELF_DECLARED = /can be your commanders?\b/i

/**
 * Whether this card may be a commander at all (doc 03 §3.1).
 *
 * Derived from the card's own text, and only from that, because the alternative
 * is a hand-maintained list of eligible cards that is wrong the day a set ships.
 * Three readings, each traceable to something printed on a card:
 *
 *   1. A legendary creature — the ordinary case, 3,334 of the corpus's 3,384
 *      eligible cards. The front face only; see `frontOfTypeLine`.
 *   2. Text that says so. Twenty-one legal cards, all planeswalkers, carry a
 *      literal "<name> can be your commander." line.
 *   3. A Background. Backgrounds do not say it themselves — the thirty-one
 *      cards with `Choose a Background` say it for them, in reminder text:
 *      "You can have a Background as a second commander."
 *
 * Plus Grist, which is clause 1 wearing a planeswalker's type line.
 *
 * Format legality gates all of it, and that is what keeps the reading honest:
 * the phrase in clause 2 also appears in `Partner with itself` reminder text
 * and on a Background whose "it" means the creature choosing it, and every one
 * of those cards is `not_legal` in Commander.
 *
 * THIS IS THE FALLBACK, not the authority. Scryfall's own `is:commander` is,
 * and the ingest fetches it (`fetchCommanderOracleIds`); this runs only when
 * that search cannot be reached.
 *
 * Measured against it over the whole 34,492-card corpus, this agrees on 3,380
 * cards and disagrees on 36 — in BOTH directions, which is the part worth
 * knowing:
 *
 *   - 31 it wrongly refuses: every legendary Vehicle and Spacecraft. Nothing in
 *     their text says they may lead a deck, and the guess about WHICH of them
 *     do was wrong as well — an earlier version of this comment reasoned that
 *     Shorikai is a real commander while Heart of Kiran is not, and Scryfall
 *     lists both, along with Parhelion II and the Titanic.
 *   - 5 it wrongly accepts: the meld backs — Brisela, Hanweir, Mishra Lost to
 *     Phyrexia, Titania Gaea Incarnate, Ragnarok. Each is a legendary creature
 *     card that Scryfall reports `legal` in Commander, and none may lead a
 *     deck, because a melded permanent is never a card you cast. What separates
 *     them is `layout: meld`, which is a Scryfall field and not a fact about
 *     Magic that the type line or the rules text carries — so this function,
 *     which reads only the card, cannot see it.
 *
 * Both directions say the same thing: a rule that is not written on the card is
 * not one to reconstruct from memory (AGENTS.md §8), it is one to go and ask
 * about. This stays as written so that an ingest which cannot reach the search
 * still produces an answer for 3,380 cards instead of none for any.
 */
export const deriveCanBeCommander = (card: {
  readonly typeLine: string
  readonly oracleText: string
  readonly legalities: { readonly commander: Legality }
}): boolean => {
  if (card.legalities.commander !== 'legal') return false
  const front = frontOfTypeLine(card.typeLine)
  if (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) return true
  if (SELF_DECLARED.test(card.oracleText)) return true
  if (BACKGROUND_SUBTYPE.test(front)) return true
  return CREATURE_OFF_BATTLEFIELD.test(card.oracleText)
}

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
