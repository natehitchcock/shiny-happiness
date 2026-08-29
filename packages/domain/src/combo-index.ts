import type { Combo } from './combo.js'
import type { ComboId, OracleId } from './ids.js'

/**
 * Combo degree (doc 02 §2.3) — the primitive the whole product is built on.
 *
 * Definitions, implemented exactly as specified. Let `A` be the deck's accepted
 * set *including the commanders*, and `X` a candidate card not in `A`:
 *
 *   C is COMPLETED BY X   iff  X ∈ pieces(C)  and  pieces(C) \ {X} ⊆ A
 *   C is NEAR X at d      iff  X ∈ pieces(C)  and  d = |pieces(C) \ (A ∪ {X})|, d ≥ 1
 *
 *   comboDegree(X, A)   = |{ C : C completed by X }|
 *   nearCombos(X, A, d) = |{ C : C near X at distance d }|
 *
 * Counted over DISTINCT COMBOS, not distinct partner cards. A card forming one
 * combo with the commander and a separate combo with another accepted card has
 * degree 2 — and two Spellbook entries are two combos even when they share
 * pieces. That distinctness rule is the point; see the tests.
 *
 * Degree is a function of the *current* accepted set, so it is not a property of
 * a card and must be recomputed whenever the accepted set changes. Accepting a
 * card can RAISE other candidates' degrees, which is why the candidate region
 * re-groups rather than merely re-sorting (doc 06 §6.4).
 */

export interface ComboIndex {
  /** Every combo that survived validation, by id. */
  readonly byId: ReadonlyMap<ComboId, Combo>
  /** oracleId → combos containing it. The hot path (doc 05 §5.8). */
  readonly byOracleId: ReadonlyMap<OracleId, readonly Combo[]>
  /** Combos dropped at build time, with the reason. Never silently discarded. */
  readonly rejected: readonly { readonly id: ComboId; readonly reason: string }[]
}

const EMPTY: readonly Combo[] = []

/**
 * Build the lookup index.
 *
 * Malformed combos are REJECTED AND REPORTED, never silently dropped — doc 04
 * §4.2 and AGENTS.md §8. A quietly discarded combo is an invisible wrong answer.
 * Duplicate pieces within one combo are deduped (a data error we can recover
 * from) rather than rejected.
 */
export const buildComboIndex = (combos: readonly Combo[]): ComboIndex => {
  const byId = new Map<ComboId, Combo>()
  const byOracleId = new Map<OracleId, Combo[]>()
  const rejected: { id: ComboId; reason: string }[] = []

  for (const combo of combos) {
    const pieces = [...new Set(combo.pieces)]

    if (pieces.length === 0) {
      rejected.push({ id: combo.id, reason: 'combo has no pieces' })
      continue
    }
    if (byId.has(combo.id)) {
      rejected.push({ id: combo.id, reason: 'duplicate combo id' })
      continue
    }

    const normalised: Combo = pieces.length === combo.pieces.length ? combo : { ...combo, pieces }

    byId.set(normalised.id, normalised)
    for (const piece of pieces) {
      const existing = byOracleId.get(piece)
      if (existing === undefined) byOracleId.set(piece, [normalised])
      else existing.push(normalised)
    }
  }

  return { byId, byOracleId, rejected }
}

/** Combos containing this card. Empty for a card in no combo, which is normal. */
export const combosContaining = (index: ComboIndex, card: OracleId): readonly Combo[] =>
  index.byOracleId.get(card) ?? EMPTY

/** How many pieces of `combo` are missing, treating `candidate` as present. */
const missingCount = (
  combo: Combo,
  accepted: ReadonlySet<OracleId>,
  candidate: OracleId,
): number => {
  let missing = 0
  for (const piece of combo.pieces) {
    if (piece !== candidate && !accepted.has(piece)) missing += 1
  }
  return missing
}

/**
 * Everything the candidate engine needs about one card, in a single pass over
 * the combos that contain it.
 *
 * Prefer this to calling `comboDegree` and `nearCombos` separately — they would
 * walk the same list twice, and this is the hot path.
 */
export interface ComboAnnotation {
  readonly degree: number
  readonly completed: readonly ComboId[]
  /** distance → combo ids needing exactly that many more cards. */
  readonly near: ReadonlyMap<number, readonly ComboId[]>
}

const EMPTY_ANNOTATION: ComboAnnotation = {
  degree: 0,
  completed: [],
  near: new Map(),
}

export const annotateCombos = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  candidate: OracleId,
): ComboAnnotation => {
  // A card already in the deck is not a candidate, and "completed by X" is not
  // meaningful for it — its combos are either assembled or not.
  if (accepted.has(candidate)) return EMPTY_ANNOTATION

  const completed: ComboId[] = []
  const near = new Map<number, ComboId[]>()

  for (const combo of combosContaining(index, candidate)) {
    const missing = missingCount(combo, accepted, candidate)
    if (missing === 0) {
      completed.push(combo.id)
    } else {
      const bucket = near.get(missing)
      if (bucket === undefined) near.set(missing, [combo.id])
      else bucket.push(combo.id)
    }
  }

  return { degree: completed.length, completed, near }
}

/** `comboDegree(X, A)`. See the module comment for the exact definition. */
export const comboDegree = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  candidate: OracleId,
): number => annotateCombos(index, accepted, candidate).degree

/** Combos this card would complete — the input to the "why" panel (P4). */
export const completedCombos = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  candidate: OracleId,
): readonly ComboId[] => annotateCombos(index, accepted, candidate).completed

/**
 * `nearCombos(X, A, d)`. At d = 1 this identifies the *pairs* worth adding
 * together, which is a different and useful signal from degree (doc 05 §5.3).
 */
export const nearCombos = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
  candidate: OracleId,
  distance: number,
): number => {
  if (distance < 1) return 0
  return annotateCombos(index, accepted, candidate).near.get(distance)?.length ?? 0
}

/** Combos fully assembled in the deck. Shown in the header; feeds bracket checks. */
export const deckCombos = (
  index: ComboIndex,
  accepted: ReadonlySet<OracleId>,
): readonly ComboId[] => {
  const assembled: ComboId[] = []
  for (const [id, combo] of index.byId) {
    if (combo.pieces.every((piece) => accepted.has(piece))) assembled.push(id)
  }
  return assembled
}

/**
 * Candidates whose degree can change when `changed` is accepted or excluded.
 *
 * Only cards sharing a combo with the changed card can move, so an accept patches
 * a handful of candidates instead of rescanning the pool — doc 05 §5.8's 16 ms
 * incremental budget. `DOM-03` builds the patch itself on top of this.
 */
export const candidatesAffectedBy = (
  index: ComboIndex,
  changed: OracleId,
): ReadonlySet<OracleId> => {
  const affected = new Set<OracleId>()
  for (const combo of combosContaining(index, changed)) {
    for (const piece of combo.pieces) {
      if (piece !== changed) affected.add(piece)
    }
  }
  return affected
}
