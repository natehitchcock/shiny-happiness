import { annotateCombos, candidatesAffectedBy, type ComboIndex } from './combo-index.js'
import type { OracleId } from './ids.js'

/**
 * Incremental combo-degree patching (doc 05 §5.8, DOM-03).
 *
 * Accepting a card changes other candidates' degrees, and the candidate region
 * must re-group within a frame for the feedback loop in doc 06 §6.4 to read as
 * causation rather than as a list refresh. Recomputing the whole pool costs
 * ~200 ms server-side; the client's budget is 16 ms.
 *
 * The saving is structural: only a card sharing a combo with the changed card can
 * change degree, and that set is typically dozens, not thousands. Everything else
 * keeps its previous value untouched.
 *
 * `patchDegrees` must agree with a full recompute exactly — that equivalence is
 * property-tested, because a fast answer that drifts from the true one is worse
 * than a slow answer.
 */

export type DegreeMap = ReadonlyMap<OracleId, number>

/** Full recompute. Correct by construction; the baseline the patch is checked against. */
export const computeDegrees = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  pool: Iterable<OracleId>,
): DegreeMap => {
  const degrees = new Map<OracleId, number>()
  for (const candidate of pool) {
    degrees.set(candidate, annotateCombos(index, accepted, candidate).degree)
  }
  return degrees
}

export interface DegreePatch {
  readonly degrees: DegreeMap
  /** Candidates whose degree actually moved — what the UI animates. */
  readonly changed: ReadonlySet<OracleId>
  /** How many candidates were recomputed. For the perf budget, not for logic. */
  readonly recomputed: number
}

/**
 * Patch `previous` for a change to the accepted set.
 *
 * `changedCards` are the cards that entered or left `accepted` — an accept, an
 * exclude, a restore, or a whole core package applied at once. Pass every card
 * that moved; passing too many is merely slower, passing too few is wrong.
 *
 * The pool is the candidate set being displayed. Cards outside it are ignored,
 * and cards now in `accepted` are dropped from the result: an accepted card is
 * not a candidate.
 */
export const patchDegrees = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  pool: ReadonlySet<OracleId>,
  previous: DegreeMap,
  changedCards: Iterable<OracleId>,
): DegreePatch => {
  const degrees = new Map(previous)
  const changed = new Set<OracleId>()
  let recomputed = 0

  // A changed card is itself no longer (or newly) a candidate.
  const dirty = new Set<OracleId>()
  for (const card of changedCards) {
    dirty.add(card)
    for (const affected of candidatesAffectedBy(index, card)) dirty.add(affected)
  }

  for (const card of dirty) {
    if (accepted.has(card)) {
      // Now in the deck: not a candidate any more.
      if (degrees.delete(card)) changed.add(card)
      continue
    }
    if (!pool.has(card)) {
      if (degrees.delete(card)) changed.add(card)
      continue
    }
    recomputed += 1
    const next = annotateCombos(index, accepted, card).degree
    if (degrees.get(card) !== next) {
      degrees.set(card, next)
      changed.add(card)
    }
  }

  // A card that left the accepted set re-enters the pool with a fresh degree.
  for (const card of pool) {
    if (!degrees.has(card) && !accepted.has(card)) {
      recomputed += 1
      degrees.set(card, annotateCombos(index, accepted, card).degree)
      changed.add(card)
    }
  }

  return { degrees, changed, recomputed }
}
