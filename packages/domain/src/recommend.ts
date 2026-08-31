import { assertNever } from './assert-never.js'
import type { BracketFlag } from './bracket.js'
import type { Card, Color } from './card.js'
import { annotateCombos, type ComboIndex } from './combo-index.js'
import { fixingFor, isManaSource, NO_FIXING } from './fixing.js'
import { dimensionKey, type CompositionDimension, type CompositionTarget } from './composition.js'
import type { CompositionCounts, Deficit } from './composition-analysis.js'
import { findDeficits, shortfalls } from './composition-analysis.js'
import {
  synergyMatches,
  synergyScore,
  type DeckSynergy,
  type SynergyMatch,
  type SynergyTag,
} from './synergy.js'
import {
  emphasisMatches,
  emphasisScore,
  NO_EMPHASIS,
  type SemanticEmphasis,
} from './semantic-emphasis.js'
import {
  curveBucket,
  curveDeltas,
  curveDirection,
  curveFit,
  curveTarget,
  type CurveTarget,
} from './curve.js'
import { cardEfficiency } from './efficiency.js'
import type { OracleId } from './ids.js'
import { cardImpact } from './impact.js'
import { matchesQuery, type AnnotatedCandidate } from './query/evaluate.js'
import type { QueryNode } from './query/ast.js'
import type { CandidateGroupKey, Reason, Recommendation } from './recommendation.js'
import type { Role } from './role.js'
import { DEFAULT_EMPHASIS_WEIGHT, type ScoringWeights } from './scoring.js'

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
  /** From the deck's archetype. Defaults to midrange when absent. */
  readonly curveTarget?: CurveTarget
  /**
   * What the deck already does and wants (ADR-0011). Absent means synergy does
   * not contribute — every card scores the same on it, so nothing is skewed.
   */
  readonly deckSynergy?: DeckSynergy
  /**
   * The semantics the builder said this deck is about (`semantic-emphasis.ts`).
   *
   * Absent or empty means no emphasis, and then the emphasis term is zero for
   * every candidate — so nothing is skewed and the ordering is byte-identical
   * to what it was before this input existed.
   */
  readonly emphasis?: SemanticEmphasis
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
  /**
   * How much of the pool each emphasised tag actually reaches. Empty when the
   * deck emphasises nothing.
   *
   * Emphasis never filters, so a tag nothing supports still returns a full list
   * of suggestions — which, on its own, is indistinguishable from an emphasis
   * that worked. This is what makes the difference visible: `supporting: 0` lets
   * the client say "nothing in your colours produces or wants landfall" instead
   * of leaving the builder to wonder why their click did nothing. Same
   * discipline as `unavailable` — a degraded answer is named, not disguised
   * (doc 05 §5.3).
   *
   * Counted over eligible candidates BEFORE the query filter, because the
   * question is about the deck's colours and the corpus, not about whatever the
   * search box currently holds.
   */
  readonly emphasis: readonly {
    readonly tag: SynergyTag
    /** Eligible candidates that produce or want it. */
    readonly supporting: number
  }[]
}

const MECHANICAL_SYNERGY_THRESHOLD = 0.45
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
  matchesFilter: boolean
  /** Mechanical synergy with the deck, strongest first (ADR-0011). */
  readonly synergy: readonly SynergyMatch[]
  /** The subset of that relating to a tag the builder emphasised. */
  readonly emphasised: readonly SynergyMatch[]
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
  /*
   * The same two calls the emitted item makes, so `impact>=6` keeps exactly the
   * rows whose impact cell reads 6 or more.
   *
   * Computed here rather than threaded down from `Scratch` because the filter
   * runs over the WHOLE eligible pool while the emitted items are only the
   * sliced group members — there is no shared point earlier that has both. Both
   * functions are pure and total, so the two calls cannot disagree; the cost is
   * one extra classifier pass over the pool, and only when a query names one of
   * these fields is the filter run at all.
   */
  impact: cardImpact(s.pooled.card).score,
  efficiency: cardEfficiency(s.pooled.card).score,
})

const dimensionLabel = (dimension: CompositionDimension): string =>
  dimension.kind === 'role' ? dimension.role : dimension.type

/**
 * The deck's target curve, from its archetype (ADR-0011).
 *
 * Replaces a flat 25%-per-bucket comparison that could only ever reward, never
 * penalise — so an over-full mana value produced no signal to stop.
 */

export const recommend = (input: RecommendInput): RecommendResult => {
  const identity = new Set(input.colorIdentity)
  const curve = input.curveTarget ?? curveTarget('midrange')
  const synergy: DeckSynergy = input.deckSynergy ?? { produces: new Map(), wants: new Map() }
  const emphasis = input.emphasis ?? NO_EMPHASIS
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
    const profile = {
      produces: pooled.card.synergyProduces,
      wants: pooled.card.synergyWants,
    }
    const matches = synergyMatches(profile, synergy)
    const s: Scratch = {
      pooled,
      degree: annotation.degree,
      nearAt1: annotation.near.get(1)?.length ?? 0,
      completed: annotation.completed,
      stats: input.stats?.get(pooled.card.oracleId) ?? null,
      deficit: deficitByRole.get(primary) ?? null,
      matchesFilter: true,
      synergy: matches,
      emphasised: emphasisMatches(profile, matches, emphasis),
      group: null,
      score: 0,
      reasons: [],
    }
    /*
     * No query, no annotation.
     *
     * `matchesQuery(null, …)` is true for everything, so the annotation was
     * always thrown away on the unfiltered path — free when it was a dozen
     * field copies, not free now that it runs the impact classifier twice per
     * card over a pool that is the whole colour identity. The unfiltered path
     * is the common one and this makes it cheaper than it was.
     *
     * The filtered path pays roughly 6 µs a card whether or not the query names
     * a metric. Rejected: walking the AST first and only computing the metrics
     * when `impact` or `efficiency` appear in it. It would save that on most
     * queries and it would leave a zero sitting in a field that reads as a real
     * score, which is one refactor away from a card being filtered against a
     * number nobody computed.
     */
    scratch.push({
      ...s,
      matchesFilter: input.query === null || matchesQuery(input.query, toAnnotated(s)),
    })
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
    // ADR-0008 left `high-synergy` permanently empty when EDHREC went away.
    // Mechanical synergy refills it, and says WHY rather than just that.
    else if (s.synergy.length > 0 && synergyScore(s.synergy) >= MECHANICAL_SYNERGY_THRESHOLD)
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
    /*
     * An emphasised match OUTRANKS a stronger unemphasised one here (P4).
     *
     * The reason has to name the thing that moved the card. When the builder
     * has emphasised `opponent-discard`, a discard payoff is in this list
     * because of the emphasis term below — and reporting its incidental
     * `creature-death` synergy instead, merely because that tag scored higher
     * on the mechanical curve, would be a true sentence about the wrong card.
     * `emphasised: true` is what separates "benefits from your sacrifice
     * fodder" from "benefits from your EMPHASISED sacrifice fodder".
     */
    const topEmphasis = s.emphasised[0]
    const topMatch = topEmphasis ?? s.synergy[0]
    if (topMatch !== undefined) {
      reasons.push({
        kind: 'keyword-synergy',
        tag: topMatch.tag,
        direction: topMatch.direction,
        // The cards it pairs with, so the reason can be interrogated (P4).
        withOracleIds: [],
        ...(topEmphasis !== undefined ? { emphasised: true } : {}),
      })
    }
    // Said before the deficit, because for a land it is the more specific
    // claim: "taps for two of your colours" is why THIS land rather than the
    // 435 others that also fill the same gap.
    const fixing = isManaSource(card) ? fixingFor(card, input.colorIdentity) : NO_FIXING
    if (fixing.producesMana && isManaSource(card)) {
      reasons.push({
        kind: 'mana-fixing',
        coloursCovered: fixing.coloursCovered,
        of: input.colorIdentity.length,
      })
    }
    if (s.deficit !== null) {
      reasons.push({
        kind: 'fills-deficit',
        dimension: s.deficit.dimension,
        deficit: Math.abs(s.deficit.delta),
        // Carried from the target the gap was measured against, so the reason
        // says whose number this card is being suggested against (P4, doc 16).
        // No new input to `recommend` was needed: `Deficit` already holds the
        // whole `CompositionTarget`, which is where the source rides.
        source: s.deficit.target.source ?? 'archetype',
      })
    }
    for (const flag of s.pooled.bracketFlags) {
      reasons.push({ kind: 'bracket-warning', flag, detail: `flagged as ${flag}` })
    }
    if (reasons.length === 0) {
      // Every recommendation must explain itself (P4). A card that reaches here
      // has nothing to say for itself beyond its curve, so that is the reason.
      // `delta` and `direction` let the UI say "you are 4 short at 2" instead of
      // showing a bare score (pillar P4).
      const fit = curveFit(card.manaValue, input.counts.manaCurve, curve)
      const bucket = curveBucket(card.manaValue)
      reasons.push({
        kind: 'curve-fit',
        manaValue: card.manaValue,
        direction: curveDirection(fit),
        delta: curveDeltas(input.counts.manaCurve, curve)[bucket]?.delta ?? 0,
      })
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
      w.curve * curveFit(card.manaValue, input.counts.manaCurve, curve) +
      w.keywordSynergy * synergyScore(s.synergy) +
      /*
       * The emphasis term (`semantic-emphasis.ts`).
       *
       * ADDITIVE AND SEPARATE, not a multiplier folded into `synergyScore`.
       * `synergyScore` is read twice — here, and by the
       * `MECHANICAL_SYNERGY_THRESHOLD` that decides whether a card is put in the
       * `high-synergy` GROUP. Scaling it would let a user preference change
       * which group a card lands in, and pillar P5 is explicit that grouping is
       * the product's opinion and score only orders inside it. Rejected for the
       * same reason: raising `THEME_WEIGHT` for emphasised tags, which is both
       * inside `synergyScore` and reaches only one of the three directions — an
       * emphasised tag matched as `enables` would get nothing at all.
       *
       * It is also why emphasis cannot quietly eat the archetype's composition
       * targets (doc 16): those decide `s.deficit` and therefore the
       * `fills-<role>` groups, upstream of every line in this sum. A deck can be
       * eighteen creatures AND about opponent-discard; this term reorders within
       * whatever the targets decided, and never against them.
       */
      (w.emphasis ?? DEFAULT_EMPHASIS_WEIGHT) * emphasisScore(s.emphasised) +
      w.fixing * fixing.value -
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

  // Counted over every eligible candidate, including ones the query filtered
  // out and ones that fell into no group: the claim is "your colours contain
  // nothing that does this", which the search box has no bearing on.
  const supporting = new Map<SynergyTag, number>(emphasis.map((tag) => [tag, 0]))
  for (const s of scratch) {
    for (const tag of new Set([...s.pooled.card.synergyProduces, ...s.pooled.card.synergyWants])) {
      const held = supporting.get(tag)
      if (held !== undefined) supporting.set(tag, held + 1)
    }
  }

  return {
    groups,
    unavailable,
    query: {
      matched: scratch.filter((s) => s.matchesFilter && s.group !== null).length,
      total: scratch.filter((s) => s.group !== null).length,
    },
    // In `emphasis` order, which `parseSemanticEmphasis` already made canonical.
    emphasis: emphasis.map((tag) => ({ tag, supporting: supporting.get(tag) ?? 0 })),
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
    /*
     * Computed here rather than by each surface, so the column, the card
     * detail panel and the search results cannot disagree about a card (doc 18
     * §18.8). Only for the items that actually ship — this runs on the sliced
     * group members, not on the whole pool, so it costs a few hundred calls per
     * request rather than thirty thousand.
     */
    efficiency: cardEfficiency(s.pooled.card),
    impact: cardImpact(s.pooled.card),
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
