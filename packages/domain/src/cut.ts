import type { Card } from './card.js'
import type { ComboIndex } from './combo-index.js'
import {
  dimensionKey,
  dimensionKeysOf,
  type CompositionDimension,
  type CompositionTarget,
} from './composition.js'
import type { CompositionCounts } from './composition-analysis.js'
import { curveBucket, curveFit, type CurveTarget } from './curve.js'
import type { Deck } from './deck.js'
import type { OracleId } from './ids.js'
import { synergyMatches, synergyScore, type DeckSynergy } from './synergy.js'

/**
 * What to cut, and why (the inverse of `recommend`).
 *
 * A hundred-card deck is built by subtraction as much as addition, and the
 * factors that make a card worth suggesting are the same ones that make it worth
 * keeping — so this reads them in reverse rather than inventing a second opinion
 * the two halves of the UI could disagree about.
 *
 * **A locked card is never a cut hint.** Locking is how the user says "this
 * stays", and the point of the feature is to stop asking about cards that have
 * already been decided. That is also why the reasons are ranked and named: a
 * hint the user cannot argue with is one they cannot act on (pillar P4).
 */

export type CutReason =
  | {
      readonly kind: 'role-over-target'
      readonly dimension: CompositionDimension
      readonly over: number
    }
  | { readonly kind: 'curve-crowded'; readonly manaValue: number }
  | { readonly kind: 'no-combos' }
  | { readonly kind: 'no-synergy' }
  /** We derived no synergy tags for this card, so we have no opinion. */
  | { readonly kind: 'unknown-synergy' }
  | { readonly kind: 'over-budget'; readonly priceUsd: number; readonly limit: number }

export interface CutHint {
  readonly oracleId: OracleId
  /** 0..1. Higher means weaker — more worth cutting. */
  readonly score: number
  /** Strongest first. Never empty: a hint with no reason is not a hint. */
  readonly reasons: readonly [CutReason, ...CutReason[]]
}

export interface CutInput {
  readonly deck: Deck
  readonly cards: ReadonlyMap<OracleId, Card>
  readonly counts: CompositionCounts
  readonly targets: readonly CompositionTarget[]
  readonly curveTarget: CurveTarget
  readonly comboIndex: ComboIndex
  readonly deckSynergy: DeckSynergy
  readonly priceOf?: (id: OracleId) => number | null
  readonly maxCardUsd?: number | null
}

/** Weights, mirroring `ScoringWeights` in spirit: a combo piece is hardest to cut. */
const W_ROLE_OVER = 0.35
const W_CURVE = 0.2
const W_NO_COMBO = 0.25
const W_NO_SYNERGY = 0.2
/**
 * A third of `W_NO_SYNERGY`.
 *
 * Not zero: a card we cannot say anything about is weaker evidence of a keeper
 * than one we can. Not the full weight either — the gap is in our ingest, and
 * charging the card for it would push out cards whose text our regexes simply
 * do not read.
 */
const W_UNKNOWN_SYNERGY = W_NO_SYNERGY / 3
const W_BUDGET = 0.4

export const suggestCuts = (input: CutInput): readonly CutHint[] => {
  const accepted = input.deck.entries.filter((e) => e.zone === 'accepted')
  const acceptedIds = new Set<OracleId>([
    ...input.deck.commanders,
    ...accepted.map((e) => e.oracleId),
  ])

  const overByDimension = new Map<string, { dimension: CompositionDimension; over: number }>()
  for (const target of input.targets) {
    const key = dimensionKey(target.dimension)
    const actual = input.counts.byDimension.get(key) ?? 0
    // Measured against the RANGE's top, not the ideal: a role one card above
    // its ideal is not over-supplied, it is within tolerance.
    if (actual > target.max) {
      overByDimension.set(key, { dimension: target.dimension, over: actual - target.max })
    }
  }

  const hints: CutHint[] = []

  for (const entry of accepted) {
    // Locked means decided. Nothing below applies.
    if (entry.locked) continue
    const card = input.cards.get(entry.oracleId)
    if (card === undefined) continue

    const reasons: CutReason[] = []
    let score = 0

    for (const role of entry.roleOverride ?? card.roles) {
      const over = overByDimension.get(dimensionKey({ kind: 'role', role }))
      if (over !== undefined) {
        reasons.push({ kind: 'role-over-target', dimension: over.dimension, over: over.over })
        score += W_ROLE_OVER
        break
      }
    }

    const fit = curveFit(card.manaValue, input.counts.manaCurve, input.curveTarget)
    if (fit < 0) {
      reasons.push({ kind: 'curve-crowded', manaValue: card.manaValue })
      score += W_CURVE * Math.abs(fit)
    }

    // A combo piece is the last thing to cut, so its ABSENCE counts against a
    // card here.
    //
    // Asked directly of the combo index rather than through `annotateCombos`,
    // which answers "what would ADDING this card do" — and for a card already
    // in the deck the answer is always nothing, so every card looked
    // combo-irrelevant. The question here is whether the deck's combos need it.
    const inCombos = input.comboIndex.byOracleId.get(entry.oracleId) ?? []
    const carries = inCombos.some((combo) => {
      const missing = combo.pieces.filter((p) => p !== entry.oracleId && !acceptedIds.has(p)).length
      // Assembled, or one card away — either way, pulling this breaks it.
      return missing <= 1
    })
    if (!carries) {
      reasons.push({ kind: 'no-combos' })
      score += W_NO_COMBO
    }

    /*
     * "No synergy" and "no synergy tags" are different claims.
     *
     * 16,684 of the 34,492 cards in the corpus derive no tags at all — the
     * regexes in `synergy.ts` are heuristics over oracle text and they miss
     * roughly half of Magic. Reporting all of those as "no synergy" was the
     * app asserting something it had not checked, on about half the deck, and
     * it made the honest findings impossible to pick out.
     *
     * `selfCounted` because this card IS in the deck the profile was built
     * from; without it every card would share a theme with itself.
     */
    const hasTags = card.synergyProduces.length > 0 || card.synergyWants.length > 0
    const synergy = synergyScore(
      synergyMatches(
        { produces: card.synergyProduces, wants: card.synergyWants },
        input.deckSynergy,
        { selfCounted: true },
      ),
    )
    if (!hasTags) {
      reasons.push({ kind: 'unknown-synergy' })
      score += W_UNKNOWN_SYNERGY
    } else if (synergy === 0) {
      reasons.push({ kind: 'no-synergy' })
      score += W_NO_SYNERGY
    }

    const price = input.priceOf?.(entry.oracleId) ?? null
    const limit = input.maxCardUsd
    if (price !== null && limit !== null && limit !== undefined && price > limit) {
      reasons.push({ kind: 'over-budget', priceUsd: price, limit })
      score += W_BUDGET
    }

    const [first, ...rest] = reasons
    // No reason, no hint. A card that is pulling its weight on every axis is
    // not a cut just because the deck is over a hundred.
    if (first === undefined) continue

    hints.push({
      oracleId: entry.oracleId,
      score: Math.min(1, score),
      reasons: [first, ...rest],
    })
  }

  return hints.sort((a, b) => b.score - a.score)
}

/**
 * Locked cards per mana-value bucket, for the curve's committed portion.
 *
 * Counted from entries rather than `acceptedSet`, because that returns a Set and
 * would collapse the duplicate copies the count is about.
 */
export const lockedCurve = (
  deck: Deck,
  cards: ReadonlyMap<OracleId, Card>,
  buckets: number,
): readonly number[] => {
  const locked = new Array<number>(buckets).fill(0)
  for (const entry of deck.entries) {
    if (entry.zone !== 'accepted' || !entry.locked) continue
    const card = cards.get(entry.oracleId)
    if (card === undefined) continue
    const bucket = curveBucket(card.manaValue)
    locked[bucket] = (locked[bucket] ?? 0) + 1
  }
  return locked
}

/** Locked cards per composition dimension, keyed by `dimensionKey`. */
/**
 * How much of each composition target is already committed.
 *
 * Counted by `dimensionKeysOf`, the same rule the bar itself uses. The first
 * version emitted `role:` keys only, so the `type:creature` meter could never
 * show gold however many creatures were locked — an overlay counted by a
 * different rule than the bar beneath it can exceed that bar or miss a
 * dimension it has, which makes it not an overlay at all.
 *
 * Commanders are excluded. They are permanently in the deck, so counting them
 * would be defensible, but the gold means "you decided this" and a commander is
 * not a decision the lock button made.
 */
export const lockedComposition = (
  deck: Deck,
  cards: ReadonlyMap<OracleId, Card>,
  roleFor?: (card: Card) => string,
): ReadonlyMap<string, number> => {
  const locked = new Map<string, number>()
  for (const entry of deck.entries) {
    if (entry.zone !== 'accepted' || !entry.locked) continue
    if (deck.commanders.includes(entry.oracleId)) continue
    const card = cards.get(entry.oracleId)
    if (card === undefined) continue
    for (const key of dimensionKeysOf({
      primaryRole: roleFor?.(card) ?? card.primaryRole,
      types: card.types,
    })) {
      locked.set(key, (locked.get(key) ?? 0) + 1)
    }
  }
  return locked
}
