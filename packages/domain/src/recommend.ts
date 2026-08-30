import { assertNever } from './assert-never.js'
import type { BracketFlag } from './bracket.js'
import type { Card, Color } from './card.js'
import { annotateCombos, type ComboIndex } from './combo-index.js'
import { dimensionKey, type CompositionDimension, type CompositionTarget } from './composition.js'
import type { CompositionCounts, Deficit } from './composition-analysis.js'
import { findDeficits, shortfalls } from './composition-analysis.js'
import type { OracleId } from './ids.js'
import { matchesQuery, type AnnotatedCandidate } from './query/evaluate.js'
import type { QueryNode } from './query/ast.js'
import type { CandidateGroupKey, Reason, Recommendation } from './recommendation.js'
import type { Role } from './role.js'
import type { ScoringWeights } from './scoring.js'

/**
 * Candidate generation (doc 05, DOM-05).
 *
 *   eligibility → query filter → annotate → ASSIGN GROUP → score within group
 *
 * Grouping happens BEFORE scoring, and scoring only orders inside a group. There
 * is no global "top card" ranking anywhere in this product (pillar P5).
 *
 * Deterministic: the same deck and the same dataset produce the same output,
 * always. Ties break by Scryfall's `edhrecRank` then by name, so ordering is total and the
 * list never reshuffles between renders.
 */

export interface CardStats {
  /** Share of decks for this commander that play the card, 0..1. */
  readonly inclusion: number
  readonly synergy: number | null
}

export interface PoolCard {
  readonly card: Card
  readonly roles: readonly Role[]
  readonly bracketFlags: readonly BracketFlag[]
  readonly priceUsd: number | null
  readonly rarity: string | null
  readonly setCode: string | null
  readonly power: number | null
  readonly toughness: number | null
  readonly reserved: boolean
}

export interface RecommendInput {
  readonly pool: readonly PoolCard[]
  readonly comboIndex: ComboIndex
  readonly accepted: ReadonlySet<OracleId>
  readonly excluded: ReadonlySet<OracleId>
  readonly colorIdentity: readonly Color[]
  readonly targets: readonly CompositionTarget[]
  readonly counts: CompositionCounts
  readonly weights: ScoringWeights
  readonly query: QueryNode | null
  /** Absent = the statistics source is unavailable; groups 6–7 are then omitted. */
  readonly stats: ReadonlyMap<OracleId, CardStats> | null
  readonly limitPerGroup?: number
  readonly maxBudgetUsd?: number | null
}

export interface CandidateGroup {
  readonly key: CandidateGroupKey
  readonly label: string
  readonly rationale: string
  /** Matching the query, before `limitPerGroup`. */
  readonly total: number
  /** Excluded by the query but otherwise in this group (doc 13 §13.1). */
  readonly withheldByFilter: number
  readonly items: readonly Recommendation[]
}

export interface RecommendResult {
  readonly groups: readonly CandidateGroup[]
  /** A group that could not be computed is REPORTED, never silently omitted. */
  readonly unavailable: readonly { readonly key: string; readonly reason: string }[]
  readonly query: {
    readonly matched: number
    readonly total: number
  }
}

const SYNERGY_THRESHOLD = 0.15
const STAPLE_INCLUSION = 0.25
const TOP_BY_TYPE_LIMIT = 10

interface Scratch {
  readonly pooled: PoolCard
  readonly degree: number
  readonly nearAt1: number
  readonly completed: readonly string[]
  readonly stats: CardStats | null
  readonly deficit: Deficit | null
  readonly matchesFilter: boolean
  group: CandidateGroupKey | null
  score: number
  reasons: Reason[]
}

/** Doc 05 §5.2. Basic lands never appear — the mana base is its own tool. */
const isEligible = (
  pooled: PoolCard,
  input: RecommendInput,
  identity: ReadonlySet<Color>,
): boolean => {
  const { card } = pooled
  if (card.legalities.commander !== 'legal') return false
  if (input.accepted.has(card.oracleId)) return false
  if (input.excluded.has(card.oracleId)) return false
  if (/\bBasic\b.*\bLand\b/.test(card.typeLine)) return false
  return card.colorIdentity.every((color) => identity.has(color))
}

const toAnnotated = (s: Scratch): AnnotatedCandidate => ({
  card: s.pooled.card,
  comboDegree: s.degree,
  nearCombosAt1: s.nearAt1,
  roles: s.pooled.roles,
  bracketFlags: s.pooled.bracketFlags,
  priceUsd: s.pooled.priceUsd,
  rarity: s.pooled.rarity,
  setCode: s.pooled.setCode,
  power: s.pooled.power,
  toughness: s.pooled.toughness,
  reserved: s.pooled.reserved,
  group: null,
})

const dimensionLabel = (dimension: CompositionDimension): string =>
  dimension.kind === 'role' ? dimension.role : dimension.type

/** Cards at mana values where the deck is thin score slightly better. */
const curveFit = (manaValue: number, counts: CompositionCounts): number => {
  const bucket = Math.min(7, Math.max(0, Math.floor(manaValue)))
  const total = counts.manaCurve.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const share = (counts.manaCurve[bucket] ?? 0) / total
  return Math.max(0, 0.25 - share) * 4
}

export const recommend = (input: RecommendInput): RecommendResult => {
  const identity = new Set(input.colorIdentity)
  const limit = input.limitPerGroup ?? 60
  const deficits = shortfalls(findDeficits(input.counts, input.targets))
  const deficitByRole = new Map<Role, Deficit>()
  for (const deficit of deficits) {
    if (deficit.dimension.kind === 'role') deficitByRole.set(deficit.dimension.role, deficit)
  }

  // ---- eligibility + annotation ----
  const scratch: Scratch[] = []
  for (const pooled of input.pool) {
    if (!isEligible(pooled, input, identity)) continue
    const annotation = annotateCombos(input.comboIndex, input.accepted, pooled.card.oracleId)
    const primary = pooled.roles[0] ?? pooled.card.primaryRole
    const s: Scratch = {
      pooled,
      degree: annotation.degree,
      nearAt1: annotation.near.get(1)?.length ?? 0,
      completed: annotation.completed,
      stats: input.stats?.get(pooled.card.oracleId) ?? null,
      deficit: deficitByRole.get(primary) ?? null,
      matchesFilter: true,
      group: null,
      score: 0,
      reasons: [],
    }
    scratch.push({ ...s, matchesFilter: matchesQuery(input.query, toAnnotated(s)) })
  }

  // ---- group assignment (doc 05 §5.3): first group a card qualifies for ----
  const statsAvailable = input.stats !== null
  const topByType = new Map<string, Set<OracleId>>()
  if (statsAvailable) {
    const byType = new Map<string, Scratch[]>()
    for (const s of scratch) {
      const type = s.pooled.card.types[0]
      if (type === undefined) continue
      const bucket = byType.get(type)
      if (bucket === undefined) byType.set(type, [s])
      else bucket.push(s)
    }
    for (const [type, cards] of byType) {
      const ranked = [...cards]
        .filter((s) => s.stats !== null)
        .sort((a, b) => (b.stats?.inclusion ?? 0) - (a.stats?.inclusion ?? 0))
        .slice(0, TOP_BY_TYPE_LIMIT)
      topByType.set(type, new Set(ranked.map((s) => s.pooled.card.oracleId)))
    }
  }

  for (const s of scratch) {
    const id = s.pooled.card.oracleId
    const primary = s.pooled.roles[0] ?? s.pooled.card.primaryRole
    if (s.degree >= 3) s.group = 'combo-3plus'
    else if (s.degree === 2) s.group = 'combo-2'
    else if (s.degree === 1) s.group = 'combo-1'
    else if (s.nearAt1 >= 2) s.group = 'near-combo'
    else if (s.deficit !== null) s.group = `fills-${primary}`
    else if (statsAvailable && topByType.get(s.pooled.card.types[0] ?? '')?.has(id) === true) {
      s.group = `top-${s.pooled.card.types[0] ?? 'card'}`
    } else if (statsAvailable && (s.stats?.synergy ?? 0) >= SYNERGY_THRESHOLD)
      s.group = 'high-synergy'
    else if (statsAvailable && (s.stats?.inclusion ?? 0) >= STAPLE_INCLUSION) s.group = 'staple'
    else if (!statsAvailable) s.group = 'staple'
  }

  // ---- score and reasons ----
  const w = input.weights
  const synergies = scratch.map((s) => s.stats?.synergy ?? 0)
  const maxSynergy = Math.max(1e-6, ...synergies.map(Math.abs))

  for (const s of scratch) {
    if (s.group === null) continue
    const { card } = s.pooled
    const reasons: Reason[] = []

    if (s.degree > 0) {
      reasons.push({ kind: 'completes-combos', combos: s.completed as never })
    }
    if (s.nearAt1 > 0 && s.degree === 0) {
      reasons.push({ kind: 'near-combo', combos: [], distance: 1 })
    }
    if (s.stats !== null) {
      reasons.push({ kind: 'corpus-inclusion', share: s.stats.inclusion, synergy: s.stats.synergy })
    }
    if (s.deficit !== null) {
      reasons.push({
        kind: 'fills-deficit',
        dimension: s.deficit.dimension,
        deficit: Math.abs(s.deficit.delta),
      })
    }
    for (const flag of s.pooled.bracketFlags) {
      reasons.push({ kind: 'bracket-warning', flag, detail: `flagged as ${flag}` })
    }
    if (reasons.length === 0) {
      // Every recommendation must explain itself (P4). A card that reaches here
      // has nothing to say for itself beyond its curve, so that is the reason.
      reasons.push({ kind: 'curve-fit', manaValue: card.manaValue })
    }
    s.reasons = reasons

    const budgetOverrun =
      input.maxBudgetUsd !== null &&
      input.maxBudgetUsd !== undefined &&
      s.pooled.priceUsd !== null &&
      s.pooled.priceUsd > input.maxBudgetUsd
        ? (s.pooled.priceUsd - input.maxBudgetUsd) / Math.max(1, input.maxBudgetUsd)
        : 0

    s.score =
      w.combo * Math.log2(1 + s.degree) +
      w.near * Math.log2(1 + s.nearAt1) +
      w.synergy * ((s.stats?.synergy ?? 0) / maxSynergy) +
      w.inclusion * (s.stats?.inclusion ?? 0) +
      w.fill * (s.deficit === null ? 0 : Math.min(1, Math.abs(s.deficit.delta) / 5)) +
      w.curve * curveFit(card.manaValue, input.counts) -
      w.bracketRisk * s.pooled.bracketFlags.length -
      w.budget * budgetOverrun
  }

  // ---- assemble, honouring the fixed group order ----
  const byGroup = new Map<CandidateGroupKey, Scratch[]>()
  const withheld = new Map<CandidateGroupKey, number>()
  for (const s of scratch) {
    if (s.group === null) continue
    if (!s.matchesFilter) {
      withheld.set(s.group, (withheld.get(s.group) ?? 0) + 1)
      continue
    }
    const bucket = byGroup.get(s.group)
    if (bucket === undefined) byGroup.set(s.group, [s])
    else bucket.push(s)
  }

  const order = (key: CandidateGroupKey): number => {
    if (key === 'combo-3plus') return 0
    if (key === 'combo-2') return 1
    if (key === 'combo-1') return 2
    if (key === 'near-combo') return 3
    if (key.startsWith('fills-')) return 4
    if (key.startsWith('top-')) return 5
    if (key === 'high-synergy') return 6
    return 7
  }

  const groups: CandidateGroup[] = []
  const keys = new Set<CandidateGroupKey>([...byGroup.keys(), ...withheld.keys()])
  for (const key of [...keys].sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))) {
    const members = byGroup.get(key) ?? []
    members.sort(
      (a, b) =>
        b.score - a.score ||
        (a.pooled.card.edhrecRank ?? Number.MAX_SAFE_INTEGER) -
          (b.pooled.card.edhrecRank ?? Number.MAX_SAFE_INTEGER) ||
        (a.pooled.card.name < b.pooled.card.name ? -1 : 1),
    )
    groups.push({
      key,
      label: labelFor(key, deficits),
      rationale: rationaleFor(key),
      total: members.length,
      withheldByFilter: withheld.get(key) ?? 0,
      items: members.slice(0, limit).map(toRecommendation),
    })
  }

  const unavailable = statsAvailable
    ? []
    : [
        { key: 'top-<type>', reason: 'statistics source unavailable' },
        { key: 'high-synergy', reason: 'statistics source unavailable' },
      ]

  return {
    groups,
    unavailable,
    query: {
      matched: scratch.filter((s) => s.matchesFilter && s.group !== null).length,
      total: scratch.filter((s) => s.group !== null).length,
    },
  }
}

const toRecommendation = (s: Scratch): Recommendation => {
  const [first, ...rest] = s.reasons
  if (first === undefined) {
    // Unreachable: scoring guarantees at least one reason. Kept as a throw rather
    // than a silent empty array, because an unexplained recommendation is a bug
    // (P4) and should fail loudly in development.
    throw new Error(`recommendation for ${s.pooled.card.name} has no reasons`)
  }
  return {
    oracleId: s.pooled.card.oracleId,
    group: s.group ?? 'staple',
    score: s.score,
    comboDegree: s.degree,
    nearCombosAt1: s.nearAt1,
    completedCombos: s.completed as never,
    synergyScore: s.stats?.synergy ?? null,
    inclusionShare: s.stats?.inclusion ?? null,
    fillsRoleDeficit:
      s.deficit !== null && s.deficit.dimension.kind === 'role' ? s.deficit.dimension.role : null,
    bracketFlags: s.pooled.bracketFlags,
    reasons: [first, ...rest],
  }
}

const labelFor = (key: CandidateGroupKey, deficits: readonly Deficit[]): string => {
  switch (key) {
    case 'combo-3plus':
      return 'Completes 3+ combos'
    case 'combo-2':
      return 'Completes 2 combos'
    case 'combo-1':
      return 'Completes 1 combo'
    case 'near-combo':
      return 'One card away'
    case 'high-synergy':
      return 'High synergy'
    case 'staple':
      return 'Staples'
    default: {
      if (key.startsWith('fills-')) {
        const role = key.slice('fills-'.length)
        const deficit = deficits.find((d) => dimensionLabel(d.dimension) === role)
        return deficit === undefined ? `Fills gap: ${role}` : `Fills gap · ${role} ${deficit.delta}`
      }
      if (key.startsWith('top-')) return `Top ${key.slice('top-'.length)}s`
      return assertNever(key as never, 'labelFor')
    }
  }
}

const rationaleFor = (key: CandidateGroupKey): string => {
  if (key === 'combo-3plus')
    return 'Adding one of these finishes three or more combos using only cards already in your deck.'
  if (key === 'combo-2')
    return 'Two distinct combos — counted separately even when they share a piece.'
  if (key === 'combo-1') return 'Finishes one combo with cards you have accepted.'
  if (key === 'near-combo')
    return 'One card away from a combo, more than once — these are pairs worth adding together.'
  if (key.startsWith('fills-')) return 'Directly closes a gap against your composition targets.'
  if (key.startsWith('top-')) return 'Most played for this commander, by card type.'
  if (key === 'high-synergy') return 'Played far more in this commander than in decks generally.'
  return 'Widely played and legal in your colours.'
}

export const dimensionKeyOf = dimensionKey
