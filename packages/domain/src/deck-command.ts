import { assertNever } from './assert-never.js'
import type { Bracket } from './bracket.js'
import type { Card, Color } from './card.js'
import type { Deck, DeckEntry, Origin } from './deck.js'
import type { OracleId } from './ids.js'
import { NO_SINGLETON_EXCEPTIONS, type SingletonExceptions } from './legality.js'
import type { Role } from './role.js'

/**
 * The batched deck command language (doc 10 §10.3).
 *
 * Lives in the domain, not in `apps/api`, because it is the shape `web` queues
 * offline and `api` applies — a parallel definition on either side is how the
 * offline queue and the server come to disagree about what a batch meant.
 *
 * Batching is not a performance trick: applying a core package is ~24 changes
 * and has to be ONE undoable unit (doc 06 §6.6).
 */
export type DeckCommand =
  | {
      readonly type: 'accept'
      readonly oracleId: OracleId
      readonly origin: Origin
      readonly lock?: boolean
    }
  /**
   * Remove ONE accepted copy and record nothing (ADR-0012).
   *
   * Distinct from `exclude`, which removes every copy and bans the card under
   * pillar P6. This is an amount, not a judgement: taking 34 Mountains to 33
   * must not delete all 34 and ban Mountain from the deck forever.
   */
  | { readonly type: 'remove'; readonly oracleId: OracleId }
  | { readonly type: 'exclude'; readonly oracleId: OracleId }
  | { readonly type: 'restore'; readonly oracleId: OracleId }
  | { readonly type: 'lock'; readonly oracleId: OracleId; readonly locked: boolean }
  | { readonly type: 'setRole'; readonly oracleId: OracleId; readonly roles: readonly Role[] }
  | { readonly type: 'applyCorePackage'; readonly bracket: Bracket }
  | { readonly type: 'removeCorePackage'; readonly bracket: Bracket }

/**
 * Why a command did not apply (doc 10 §10.3).
 *
 * Deliberately mirrors `LegalityProblem`'s vocabulary — a card rejected on
 * colour identity here and flagged on colour identity by `validateDeck` are the
 * same fact, and two spellings of it would be two things for the UI to translate.
 */
export type RejectionReason =
  | { readonly kind: 'unknown-card'; readonly oracleId: OracleId }
  | {
      readonly kind: 'color-identity'
      readonly oracleId: OracleId
      readonly offending: readonly Color[]
    }
  | { readonly kind: 'banned'; readonly oracleId: OracleId }
  | { readonly kind: 'not-legal-in-commander'; readonly oracleId: OracleId }
  | {
      readonly kind: 'not-singleton'
      readonly oracleId: OracleId
      readonly copies: number
      readonly allowed: number
    }
  /** Pillar P6: the recommender may not put back what the user threw out. */
  | { readonly kind: 'previously-excluded'; readonly oracleId: OracleId }
  | { readonly kind: 'already-excluded'; readonly oracleId: OracleId }
  | { readonly kind: 'not-excluded'; readonly oracleId: OracleId }
  | { readonly kind: 'not-in-deck'; readonly oracleId: OracleId }
  | { readonly kind: 'locked'; readonly oracleId: OracleId }
  /** Commanders are accepted by definition and cannot be excluded or re-roled. */
  | { readonly kind: 'is-commander'; readonly oracleId: OracleId }
  /**
   * `exclude` then `restore` in ONE batch. Each is valid alone, but the pair
   * deletes every accepted copy and leaves nothing behind — the client almost
   * certainly coalesced an exclude-then-undo, and undo is not what `restore`
   * means (doc 10 §10.3: excluded → absent).
   */
  | { readonly kind: 'restore-of-batch-exclusion'; readonly oracleId: OracleId }
  /** The command is in the contract but its dependency has not shipped. */
  | { readonly kind: 'unsupported'; readonly commandType: string; readonly blockedBy: string }

export interface RejectedCommand {
  readonly command: DeckCommand
  readonly reason: RejectionReason
}

export interface CommandContext {
  readonly cards: ReadonlyMap<OracleId, Card>
  /** Injected: the domain is pure and may not read the clock (AGENTS.md R1). */
  readonly now: string
  readonly exceptions?: SingletonExceptions
}

export interface CommandOutcome {
  readonly deck: Deck
  readonly applied: readonly DeckCommand[]
  readonly rejected: readonly RejectedCommand[]
}

const isBasicLand = (card: Card): boolean => /\bBasic\b.*\bLand\b/.test(card.typeLine)

/**
 * Apply a batch, folding one command at a time.
 *
 * Each command sees the state the previous one left. Validating the whole batch
 * against the stored deck instead would let "accept Sol Ring" twice in one batch
 * through — to a stateless check both copies look like the first.
 *
 * Pure: it decides, it does not persist. The caller writes the resulting deck.
 */
export const applyCommands = (
  deck: Deck,
  commands: readonly DeckCommand[],
  context: CommandContext,
): CommandOutcome => {
  const exceptions = context.exceptions ?? NO_SINGLETON_EXCEPTIONS
  const identity = new Set(deck.colorIdentity)

  let entries: readonly DeckEntry[] = deck.entries
  const applied: DeckCommand[] = []
  const rejected: RejectedCommand[] = []
  const excludedThisBatch = new Set<OracleId>()

  const excludedEntry = (id: OracleId): DeckEntry | undefined =>
    entries.find((e) => e.zone === 'excluded' && e.oracleId === id)

  const acceptedCopies = (id: OracleId): readonly DeckEntry[] =>
    entries.filter((e) => e.zone === 'accepted' && e.oracleId === id)

  /** Copies counted the way the singleton rule counts them (doc 03 §3.1). */
  const copyCount = (id: OracleId): number =>
    deck.commanders.includes(id) ? 1 : acceptedCopies(id).length

  const allowance = (card: Card): number => {
    if (isBasicLand(card) || exceptions.unlimited.has(card.oracleId)) {
      return Number.POSITIVE_INFINITY
    }
    return exceptions.limited.get(card.oracleId) ?? 1
  }

  for (const command of commands) {
    // Core packages need the generated package (ING-05) and the official bracket
    // rules (DATA-05); neither has shipped. Rejecting says so out loud rather
    // than accepting the command and quietly changing nothing (AGENTS.md §1.4).
    if (command.type === 'applyCorePackage' || command.type === 'removeCorePackage') {
      rejected.push({
        command,
        reason: {
          kind: 'unsupported',
          commandType: command.type,
          blockedBy: command.type === 'applyCorePackage' ? 'ING-05, DATA-05' : 'ING-05',
        },
      })
      continue
    }

    // A commander is accepted by definition (doc 02 §2.3) and is not an entry,
    // so the entry-based guards below cannot see it. Without this, excluding a
    // commander writes an `excluded` row for a card `acceptedSet` still returns
    // — the deck's most important card in two states at once, which is exactly
    // the invariant doc 02 §2.2 exists to hold.
    if (deck.commanders.includes(command.oracleId) && command.type !== 'accept') {
      rejected.push({ command, reason: { kind: 'is-commander', oracleId: command.oracleId } })
      continue
    }

    const card = context.cards.get(command.oracleId)

    switch (command.type) {
      case 'accept': {
        // Only `accept` needs card data — it is the only command that judges
        // legality. Requiring it for the others strands an exclusion forever
        // when an ingest swap drops the card (rebalance, un-card, rename), and
        // P6 would then suppress it permanently if it ever came back.
        if (card === undefined) {
          rejected.push({ command, reason: { kind: 'unknown-card', oracleId: command.oracleId } })
          continue
        }
        const excluded = excludedEntry(command.oracleId)
        if (excluded !== undefined && command.origin === 'recommended') {
          // Pillar P6. The user may re-add a card they threw out; the recommender
          // may not do it for them.
          rejected.push({
            command,
            reason: { kind: 'previously-excluded', oracleId: command.oracleId },
          })
          continue
        }

        if (card.legalities.commander === 'banned') {
          rejected.push({ command, reason: { kind: 'banned', oracleId: command.oracleId } })
          continue
        }
        if (card.legalities.commander !== 'legal') {
          rejected.push({
            command,
            reason: { kind: 'not-legal-in-commander', oracleId: command.oracleId },
          })
          continue
        }

        // Scryfall's colour identity already accounts for mana symbols in rules
        // text and colour indicators; do not recompute it (doc 03 §3.1).
        const offending = card.colorIdentity.filter((color) => !identity.has(color))
        if (offending.length > 0) {
          rejected.push({
            command,
            reason: { kind: 'color-identity', oracleId: command.oracleId, offending },
          })
          continue
        }

        const allowed = allowance(card)
        const next = copyCount(command.oracleId) + 1
        if (next > allowed) {
          rejected.push({
            command,
            reason: { kind: 'not-singleton', oracleId: command.oracleId, copies: next, allowed },
          })
          continue
        }

        // Accepting clears any exclusion: a card must be in exactly one state
        // (doc 02 §2.2), and leaving both rows makes every consumer disagree.
        entries = [
          ...entries.filter((e) => e !== excluded),
          {
            oracleId: command.oracleId,
            zone: 'accepted',
            origin: command.origin,
            locked: command.lock ?? false,
            roleOverride: null,
            tags: [],
            addedAt: context.now,
          },
        ]
        applied.push(command)
        continue
      }

      case 'remove': {
        const copies = acceptedCopies(command.oracleId)
        const victim = copies[copies.length - 1]
        if (victim === undefined) {
          rejected.push({ command, reason: { kind: 'not-in-deck', oracleId: command.oracleId } })
          continue
        }
        if (victim.locked) {
          rejected.push({ command, reason: { kind: 'locked', oracleId: command.oracleId } })
          continue
        }
        // The most recently added copy goes, so removing one of 34 Mountains
        // leaves the other 33 with their original `addedAt` and origins.
        entries = entries.filter((e) => e !== victim)
        applied.push(command)
        continue
      }

      case 'exclude': {
        // Excluding needs no legality judgement, but a card that is neither in
        // the corpus nor in the deck is a typo, not an exclusion worth storing.
        if (card === undefined && acceptedCopies(command.oracleId).length === 0) {
          rejected.push({ command, reason: { kind: 'unknown-card', oracleId: command.oracleId } })
          continue
        }
        if (excludedEntry(command.oracleId) !== undefined) {
          rejected.push({
            command,
            reason: { kind: 'already-excluded', oracleId: command.oracleId },
          })
          continue
        }
        const copies = acceptedCopies(command.oracleId)
        if (copies.some((e) => e.locked)) {
          rejected.push({ command, reason: { kind: 'locked', oracleId: command.oracleId } })
          continue
        }

        // Every accepted copy goes: "exclude" means the card is out, not that one
        // of its 34 copies is. The single excluded row is what pillar P6 reads.
        entries = [
          ...entries.filter((e) => e.oracleId !== command.oracleId),
          {
            oracleId: command.oracleId,
            zone: 'excluded',
            origin: copies[0]?.origin ?? 'manual',
            locked: false,
            roleOverride: null,
            tags: [],
            addedAt: context.now,
          },
        ]
        excludedThisBatch.add(command.oracleId)
        applied.push(command)
        continue
      }

      case 'restore': {
        if (excludedThisBatch.has(command.oracleId)) {
          rejected.push({
            command,
            reason: { kind: 'restore-of-batch-exclusion', oracleId: command.oracleId },
          })
          continue
        }
        const excluded = excludedEntry(command.oracleId)
        if (excluded === undefined) {
          rejected.push({ command, reason: { kind: 'not-excluded', oracleId: command.oracleId } })
          continue
        }
        // excluded -> absent, which makes it a candidate again (doc 10 §10.3).
        entries = entries.filter((e) => e !== excluded)
        applied.push(command)
        continue
      }

      case 'lock': {
        if (acceptedCopies(command.oracleId).length === 0) {
          rejected.push({ command, reason: { kind: 'not-in-deck', oracleId: command.oracleId } })
          continue
        }
        entries = entries.map((e) =>
          e.zone === 'accepted' && e.oracleId === command.oracleId
            ? { ...e, locked: command.locked }
            : e,
        )
        applied.push(command)
        continue
      }

      case 'setRole': {
        if (acceptedCopies(command.oracleId).length === 0) {
          rejected.push({ command, reason: { kind: 'not-in-deck', oracleId: command.oracleId } })
          continue
        }
        entries = entries.map((e) =>
          e.zone === 'accepted' && e.oracleId === command.oracleId
            ? { ...e, roleOverride: command.roles }
            : e,
        )
        applied.push(command)
        continue
      }

      default:
        return assertNever(command, 'applyCommands')
    }
  }

  return { deck: { ...deck, entries }, applied, rejected }
}
