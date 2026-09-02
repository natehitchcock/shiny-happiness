import { assertNever } from './assert-never.js'
import type { BracketFlag } from './bracket.js'
import type { Card, Color } from './card.js'
import { annotateCombos, type ComboIndex } from './combo-index.js'
import { fixingFor, isManaSource, NO_FIXING, type DeckLands } from './fixing.js'
import {
  dimensionKey,
  dimensionKeysOf,
  type CompositionDimension,
  type CompositionTarget,
} from './composition.js'
import type { CompositionCounts, Deficit } from './composition-analysis.js'
import { findDeficits, shortfalls } from './composition-analysis.js'
import {
  synergyMatches,
  synergyScore,
  SYNERGY_TAGS,
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
import { primaryRole, type Role } from './role.js'
import { DEFAULT_EMPHASIS_WEIGHT, type ScoringWeights } from './scoring.js'
import { stapleGroupFor, type StapleGroup } from './staples.js'

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
  /**
   * How many MORE Game Changers this deck can accept before it exceeds the
   * bracket the builder chose (ADR-0044). `'unlimited'` at brackets 4 and 5.
   *
   * Read only by the curated staples groups, and only to keep a Game Changer
   * out of them. Everywhere else bracket flags are SURFACED, never used to
   * filter (doc 03 §3.2) — the builder picked the bracket and may knowingly
   * cross their own line — and that is unchanged: a Game Changer excluded here
   * still appears in whatever group it would otherwise have had, with its
   * `bracket-warning` reason attached. The distinction is that the staples
   * phase is the product asserting "you do not have to think about this one",
   * and it must not assert that about a card that breaks the deck's own
   * bracket.
   *
   * ABSENT MEANS ZERO, and this is the one optional input here that does not
   * default to "no effect" (AGENTS.md R2). The no-effect default would be to
   * spend an allowance the caller never said the deck had. Default-deny is the
   * only direction in which forgetting to pass it is safe.
   *
   * It is a REMAINING count rather than the bracket, because `recommend` is
   * pure and has no way to load the Game Changers list — that lives in the
   * corpus (`bracket-rules.ts`), so the caller that already loaded it is the
   * only one that can do this arithmetic. Several staples may qualify against
   * a budget of one; that is deliberate, because the group is an offer and not
   * a commitment, and the number is recomputed after every accept.
   */
  readonly gameChangerBudget?: number | 'unlimited'
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
  /**
   * The basic land types the deck ALREADY holds, so a fetchland can be scored.
   *
   * A fetch makes no mana; it converts a land drop into a land of your choice,
   * and it is a blank card in a deck holding nothing it can find. That is not
   * hypothetical — Quickbuild put Evolving Wilds, Terramorphic Expanse and
   * Myriad Landscape into a deck with zero basic lands, and nothing on screen
   * said so.
   *
   * A NEW INPUT rather than something derived here, and it has to be: basics
   * are excluded from the candidate pool in SQL (`findEligibleCards`), so
   * `recommend` cannot see the deck's Islands however hard it looks. The caller
   * that loaded the deck's own cards is the only one that can answer.
   *
   * ABSENT MEANS NOTHING FETCHABLE, which is the second input here that does
   * not default to no-effect, for exactly the reason `gameChangerBudget` does
   * not: the no-effect default would spend an allowance the caller never said
   * the deck had. A caller that forgets gets fetches scored at zero, which is
   * what they scored before this existed — forgetting is a no-op regression,
   * never a new way to recommend a dead card. Build it with `deckLandsFrom`.
   */
  readonly deckLands?: DeckLands
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
  /**
   * The same count for EVERY tag, in `SYNERGY_TAGS` order — `emphasis` is this
   * list narrowed to what the deck emphasises, and reordered to match it.
   *
   * `emphasis` answers "did my focus find anything". This answers the question
   * the interface asks NEXT: having chosen a focus, which of the semantics
   * related to it are worth offering first. That is a question about tags
   * nobody has emphasised, so a report indexed by the emphasis is structurally
   * unable to answer it, and without an answer the offer falls back to
   * alphabetical — recommending, at the top, whichever tag happens to sort
   * first, including one no card in the deck's colours can support.
   *
   * Every tag appears, including at zero. Omitting the zeroes would make
   * "counted, and it was nothing" indistinguishable on the wire from "not
   * counted", and `bySupport` ranks those two differently on purpose.
   *
   * Emphasis-independent by construction: the counts run over eligible
   * candidates, and emphasis reorders without ever changing eligibility. The
   * client relies on that to hold these across a focus save instead of
   * blanking them, which is what stops the offer reshuffling under the cursor.
   */
  readonly tagSupport: readonly {
    readonly tag: SynergyTag
    readonly supporting: number
  }[]
}

const MECHANICAL_SYNERGY_THRESHOLD = 0.45
const SYNERGY_THRESHOLD = 0.15
/**
 * The old `staple` threshold, now feeding the CATCH-ALL group.
 *
 * It used to name the group `staple`, and `staple` now means the curated list
 * (`staples.ts`, ADR-0044). A statistic cannot add members to a curated list
 * without the list stopping being curated, so the destination moved and the
 * threshold did not: with statistics present the long tail below it is still
 * dropped from the response entirely, exactly as before.
 */
const HIGH_INCLUSION = 0.25
const TOP_BY_TYPE_LIMIT = 10

/**
 * How many of the focus's supporters every category must show (ADR-0026).
 *
 * Emphasis used to move the score and nothing else, so a card supporting the
 * builder's declared focus could sort below `limitPerGroup` and never appear in
 * that category at all. The builder said what the deck is about and the
 * category answered with nothing about it.
 *
 * Three, because the number has to be small enough to read as a sample and
 * large enough to be one: one card is an anecdote and cannot show a range, and
 * the client asks for `limitPerGroup: 8`, so anything much larger stops being a
 * guarantee inside a category and becomes a takeover of it.
 */
const FOCUS_GUARANTEE = 3

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
 * The role this card will be COUNTED under, which is the only role a
 * `fills-<role>` group or a `fills-deficit` reason may name (ADR-0031).
 *
 * `countComposition` counts a card under `primaryRole(roles)` — the
 * precedence-ordered choice — because composition totals need exactly one role
 * per card or they double-count. Grouping used `roles[0]` instead, which is raw
 * database array order and carries no meaning at all. Two different functions
 * of the same data, disagreeing on 8.4% of a real pool, which put 20.4% of the
 * rows under a "Fills gap · X" heading on cards that count as something else:
 * "Fills gap · draw −9" offered Shorikai, Genesis Engine, Ominous Seas and Bone
 * Miser, all of which count as `token-maker`. Accepting one moved a meter the
 * heading had not named, and P4 says a reason has to be true.
 *
 * Stated once, here, rather than at the two call sites that need it — the whole
 * defect was two places computing "this card's role" differently, so a second
 * copy is the thing to avoid.
 *
 * NOT the same question the `role:` QUERY filter answers. That matches the
 * whole role set (`roles.some(...)`), and should: a card that is both removal
 * and a token maker genuinely does match `role:token-maker`, and a filter that
 * missed it would be wrong. Filtering asks "is this card one of these?";
 * counting asks "which single bucket does this card occupy?". Only the second
 * has to agree with the meters.
 */
const countedRole = (pooled: PoolCard): Role => primaryRole(pooled.roles)

/**
 * The gap this card is offered against, or `null` (ADR-0054).
 *
 * A card counts toward SEVERAL dimensions — one role and each of its types.
 * That rule is stated once, in `dimensionKeysOf`, and the meters and the web
 * app's gold overlay already read it; grouping needs exactly one of them.
 *
 * THE ROLE GAP WINS, and the type gap is the fallback. The reason is P4's, and
 * it is the same one the emission-order note below gives for letting a combo
 * group keep a staple: the more specific claim about THIS deck wins the card.
 * "You are six short of removal and this creature is removal" tells the builder
 * something; "you are thirty-one short of creatures and this is a creature" is
 * the least informative sentence a card can be offered under, because every
 * creature in the format satisfies it equally.
 *
 * WORST-FIRST WAS WRITTEN AND MEASURED AND REJECTED. `shortfalls` already
 * orders the gaps worst first, so taking the first match was one line and it
 * matched Quickbuild's `largest-first` regime. It is also wrong in practice: a
 * type gap is ~32 on an empty deck and no role gap is ever close, so every
 * creature would be swallowed by `fills-creature` and the role headings would
 * be emptied of creatures — `fills-ramp` with no mana dorks in it, and every
 * creature that answers a permanent taken out of `fills-spot-removal`. Measured
 * on five real commanders, it moved the whole creature half of six role groups
 * into one heading that says nothing about any of them.
 *
 * `dimensionKeysOf` reads `primaryRole` — the counted role, ADR-0031 — rather
 * than the raw role array, so the heading still names a dimension the card will
 * move when it is accepted.
 */
const deficitFor = (pooled: PoolCard, deficits: readonly Deficit[]): Deficit | null => {
  const keys = new Set(
    dimensionKeysOf({ primaryRole: countedRole(pooled), types: pooled.card.types }),
  )
  const matching = deficits.filter((deficit) => keys.has(dimensionKey(deficit.dimension)))
  return (
    matching.find((deficit) => deficit.dimension.kind === 'role') ??
    // Worst first among the types, which `shortfalls` already ordered, so a
    // card that is somehow short in two type dimensions still has one answer.
    matching[0] ??
    null
  )
}

/**
 * Which staples group this card may LEAD with, if any (ADR-0044).
 *
 * The curated list decides membership (`staples.ts`); this decides whether the
 * product is willing to put the card at the very top of the page and call it a
 * pick the builder does not have to think about. Two things can withdraw that,
 * and both are settings the builder made about their own deck:
 *
 * OVER THE PER-CARD BUDGET. Everywhere else the budget is a score PENALTY —
 * `w.budget * budgetOverrun` — and that is right for a feed somebody is
 * browsing, where an expensive card should sink rather than vanish. It is wrong
 * for this phase specifically: leading a deck capped at $5 a card with a $40
 * staple is not a suggestion, it is the app ignoring the number the builder
 * typed. The card is not removed — it falls through to whichever group it would
 * have had, keeps its price and keeps the penalty.
 *
 * A GAME CHANGER WITH NO BRACKET ROOM LEFT. Same shape, same fall-through.
 * Bracket flags are surfaced and never used to filter (doc 03 §3.2), and they
 * still are not: the card is offered, with its `bracket-warning` reason. What
 * is withheld is the product's endorsement of it as an obvious pick, which is
 * the one thing this phase means. See `gameChangerBudget`.
 *
 * REJECTED: applying either check to every group. That would be filtering on a
 * bracket flag, which doc 03 forbids outright, and it would quietly hide cards
 * the builder is entitled to consider and knowingly take.
 *
 * REJECTED: dropping the staple from the response when it fails either check.
 * The user asked for staples first, not for staples only; a Sol Ring the deck
 * cannot afford is still the best ramp in the pool and still belongs in
 * `fills-ramp`.
 */
const offerableStaple = (pooled: PoolCard, input: RecommendInput): StapleGroup | null => {
  const group = stapleGroupFor(pooled.card)
  if (group === null) return null

  const cap = input.maxBudgetUsd
  if (cap !== null && cap !== undefined && pooled.priceUsd !== null && pooled.priceUsd > cap) {
    return null
  }

  if (pooled.bracketFlags.includes('game-changer')) {
    const room = input.gameChangerBudget ?? 0
    if (room !== 'unlimited' && room <= 0) return null
  }
  return group
}

/**
 * The deck's target curve, from its archetype (ADR-0011).
 *
 * Replaces a flat 25%-per-bucket comparison that could only ever reward, never
 * penalise — so an over-full mana value produced no signal to stop.
 */

/**
 * The supporters of the deck's focus that the cut would have dropped, and that
 * this group must show anyway (ADR-0026).
 *
 * "TOP 3 OF THE FOCUS AS A WHOLE", not three per emphasised tag. The rejected
 * alternative is the reason to say so: a builder with four tags would be owed
 * twelve extra rows in a category the client renders eight rows of, so the
 * guarantee would be bigger than the thing it is a guarantee about, and each
 * further tag would dilute the ordering the score just computed. It would also
 * be a second, contradictory model of what a focus IS — `emphasisScore` sums
 * every emphasised match onto ONE saturating term, so the scorer already treats
 * the focus as a single thing, and a per-tag guarantee would have the ordering
 * and the guarantee disagreeing about that. What the per-tag reading buys, and
 * what is knowingly given up: a weakly-supported tag can be shut out of its
 * three slots by a strongly-supported one, which is this same defect one level
 * down. It is bounded — `supporting` per tag is reported either way, so the
 * builder can still see that a tag reached nothing — and it is recoverable,
 * because emphasising that tag alone gives it the three slots outright.
 *
 * RANKED BY THE GROUP'S OWN ORDER, restricted to supporters, rather than by
 * `emphasisScore` alone. The score already carries the emphasis term, so the
 * leading supporters here are the ones this category would show if it showed
 * only supporters — one ordering, the one the user can already see. Ranking by
 * emphasis alone would put a card that does nothing but carry the tag above one
 * that carries the tag AND closes the gap the category is named after, and it
 * would need a second ranking that appears nowhere on screen.
 *
 * EXTENDS, NEVER DISPLACES. Returning three rows to be swapped in at the cut
 * would make emphasis remove suggestions, which is the one thing it promises
 * not to do (`semantic-emphasis.ts`, and the interface says it in three
 * places). The caller appends these.
 *
 * `members` is already past eligibility (so an excluded card cannot be here at
 * all, P6) and already past the query filter (so the search box still means
 * what it says — the query filters, emphasis does not).
 *
 * With no emphasis every `emphasised` is empty — `emphasisMatches` returns `[]`
 * before it looks at anything — so this returns `[]` and the output is
 * byte-identical to what it was before the guarantee existed. That falls out of
 * the data rather than being guarded on `emphasis.length`, deliberately: a
 * guard would be a branch no test could distinguish from its own removal.
 */
const focusGuaranteed = (members: readonly Scratch[], limit: number): readonly Scratch[] => {
  if (members.length <= limit) return []
  let held = 0
  for (const s of members.slice(0, limit)) if (s.emphasised.length > 0) held += 1
  if (held >= FOCUS_GUARANTEE) return []

  const extra: Scratch[] = []
  for (const s of members.slice(limit)) {
    if (held + extra.length >= FOCUS_GUARANTEE) break
    // Fewer than three supporters in this group means fewer than three rows.
    // Padding to three with cards that do not support the focus would answer a
    // question about the focus with cards that have nothing to do with it.
    if (s.emphasised.length > 0) extra.push(s)
  }
  return extra
}

export const recommend = (input: RecommendInput): RecommendResult => {
  const identity = new Set(input.colorIdentity)
  const curve = input.curveTarget ?? curveTarget('midrange')
  const synergy: DeckSynergy = input.deckSynergy ?? {
    produces: new Map(),
    wants: new Map(),
    has: new Map(),
  }
  const emphasis = input.emphasis ?? NO_EMPHASIS
  const limit = input.limitPerGroup ?? 60
  /*
   * The gaps, worst first — which `shortfalls` already guarantees, because
   * `findDeficits` sorts by `Math.abs(delta)` descending.
   *
   * EVERY DIMENSION, not only the roles (ADR-0054). This loop used to read
   * `if (deficit.dimension.kind === 'role')` and drop the rest on the floor, so
   * `type:creature` — the second-largest gap on an empty midrange deck, at 32
   * short — made no group, contributed no `fills-deficit` reason and never
   * reached the `w.fill` term. `quickbuild.ts` reads the same targets correctly
   * and said "25 more creature" at the same moment the feed had no creature
   * gap at all: one model, two surfaces, two different answers. Doc 19 D2 says
   * Quickbuild is a VIEW over the recommendations and never a second scorer,
   * which is what makes the feed the side that was wrong.
   */
  const deficits = shortfalls(findDeficits(input.counts, input.targets))

  // ---- eligibility + annotation ----
  const scratch: Scratch[] = []
  for (const pooled of input.pool) {
    if (!isEligible(pooled, input, identity)) continue
    const annotation = annotateCombos(input.comboIndex, input.accepted, pooled.card.oracleId)
    const profile = {
      produces: pooled.card.synergyProduces,
      wants: pooled.card.synergyWants,
      // Spread rather than `?? []`, because absent and empty are different
      // claims here (ADR-0048): a card read before migration 0017 has not been
      // asked, and `[]` would say it supplies nothing.
      ...(pooled.card.synergyHas === undefined ? {} : { has: pooled.card.synergyHas }),
    }
    const matches = synergyMatches(profile, synergy)
    const s: Scratch = {
      pooled,
      degree: annotation.degree,
      nearAt1: annotation.near.get(1)?.length ?? 0,
      completed: annotation.completed,
      stats: input.stats?.get(pooled.card.oracleId) ?? null,
      deficit: deficitFor(pooled, deficits),
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
    const staple = offerableStaple(s.pooled, input)
    if (s.degree >= 3) s.group = 'combo-3plus'
    else if (s.degree === 2) s.group = 'combo-2'
    else if (s.degree === 1) s.group = 'combo-1'
    else if (s.nearAt1 >= 2) s.group = 'near-combo'
    else if (staple !== null) s.group = staple
    // `fills-<dimension>`, which is a role name or a type name. Not
    // `dimensionKey`'s prefixed form: the group key is a wire contract the web
    // app already reads back with `dimensionName`, and only `type:creature` is
    // ever a target, so no type name collides with a role name today.
    else if (s.deficit !== null) s.group = `fills-${dimensionLabel(s.deficit.dimension)}`
    else if (statsAvailable && topByType.get(s.pooled.card.types[0] ?? '')?.has(id) === true) {
      s.group = `top-${s.pooled.card.types[0] ?? 'card'}`
    } else if (statsAvailable && (s.stats?.synergy ?? 0) >= SYNERGY_THRESHOLD)
      s.group = 'high-synergy'
    // ADR-0008 left `high-synergy` permanently empty when EDHREC went away.
    // Mechanical synergy refills it, and says WHY rather than just that.
    else if (s.synergy.length > 0 && synergyScore(s.synergy) >= MECHANICAL_SYNERGY_THRESHOLD)
      s.group = 'high-synergy'
    else if (statsAvailable && (s.stats?.inclusion ?? 0) >= HIGH_INCLUSION) s.group = 'other'
    else if (!statsAvailable) s.group = 'other'
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
    const fixing = isManaSource(card)
      ? fixingFor(card, input.colorIdentity, input.deckLands)
      : NO_FIXING
    /*
     * `reach !== 'none'` rather than `producesMana`, because a FETCHLAND makes
     * no mana and is still the most interesting thing this term has to say
     * about it. `producesMana` keeps meaning what it says; `reach` is the field
     * that answers "did the fixing term find anything", and it is the field the
     * sentence needs anyway.
     */
    if (fixing.reach !== 'none' && isManaSource(card)) {
      reasons.push({
        kind: 'mana-fixing',
        coloursCovered: fixing.coloursCovered,
        of: input.colorIdentity.length,
        reach: fixing.reach,
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

  /*
   * The fixed group order (doc 05 §5.3), with the two curated staples groups
   * added at the head (ADR-0044): staples, staple lands, combos, then the rest.
   *
   * EMISSION ORDER IS NOT MEMBERSHIP ORDER, and only for these two groups. The
   * membership chain above still asks the combo questions first, so a staple
   * that finishes a combo you already hold is filed under `combo-1` and appears
   * in the combo section — the more specific claim, about THIS deck, wins the
   * card (P4), and doc 05's headline feature keeps its best rows. These two
   * groups lead the PAGE because that is what the builder asked to see first,
   * and they hold the staples that had nothing more specific to say.
   *
   * Everything below is untouched, deliberately: P5 says grouping is the
   * product's opinion, and nothing here moves a card between two groups that
   * already existed.
   */
  const order = (key: CandidateGroupKey): number => {
    if (key === 'staple') return 0
    if (key === 'staple-land') return 1
    if (key === 'combo-3plus') return 2
    if (key === 'combo-2') return 3
    if (key === 'combo-1') return 4
    if (key === 'near-combo') return 5
    if (key.startsWith('fills-')) return 6
    if (key.startsWith('top-')) return 7
    if (key === 'high-synergy') return 8
    return 9
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
    /*
     * The cut, then the focus's supporters it would have dropped (ADR-0026).
     *
     * APPENDED, which is also their natural score position: they are here
     * precisely because they sorted below `limit`, so "at the end" and "where
     * the score put them" are the same place. Pinning them to the top was
     * rejected — a card the group scores 40th is not the first thing this
     * category has to say, and hoisting it above nine cards that beat it makes
     * a claim on the builder's attention that the app's own ranking does not
     * support. Ordering within a group is what the score is for (P5); the
     * guarantee decides what is PRESENT, not what leads.
     *
     * `items.length` can therefore exceed `limitPerGroup`, which is a change in
     * what the response means and is why this has an ADR. `total` is untouched:
     * it counts the group's members, and the guarantee did not find any new
     * ones.
     */
    const guaranteed = focusGuaranteed(members, limit)
    groups.push({
      key,
      label: labelFor(key, deficits),
      rationale: rationaleFor(key),
      total: members.length,
      withheldByFilter: withheld.get(key) ?? 0,
      items: [
        ...members.slice(0, limit).map((s) => toRecommendation(s, false)),
        ...guaranteed.map((s) => toRecommendation(s, true)),
      ],
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
  //
  // Seeded with EVERY tag rather than the emphasised ones, so the same pass
  // answers both reports. It costs nothing — the loop already visits every tag
  // on every candidate, and the only thing the narrower seed bought was a
  // `supporting.get` that returned `undefined` for tags the map deliberately
  // did not hold.
  const supporting = new Map<SynergyTag, number>(SYNERGY_TAGS.map((tag) => [tag, 0]))
  for (const s of scratch) {
    for (const tag of new Set([
      ...s.pooled.card.synergyProduces,
      ...s.pooled.card.synergyWants,
      ...(s.pooled.card.synergyHas ?? []),
    ])) {
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
    tagSupport: SYNERGY_TAGS.map((tag) => ({ tag, supporting: supporting.get(tag) ?? 0 })),
  }
}

/**
 * The reasons, with the focus guarantee named on the one that already names the
 * focus (ADR-0026, pillar P4).
 *
 * A guaranteed row ALWAYS has a `keyword-synergy` reason to mark: it is here
 * because `emphasised` is non-empty, and that is exactly the condition under
 * which the scoring pass pushes that reason with `emphasised: true`. The
 * fallback still exists because a `Reason[]` cannot express that invariant, and
 * a silent throw here would turn a reason-shaping bug into a dead page.
 *
 * Rejected: a reason kind of its own. "Shown because of your focus" and
 * "supports your emphasised untap" are the same relationship stated twice, and
 * two chips saying one thing is how a row full of reasons stops being read.
 */
const withGuarantee = (reasons: readonly Reason[]): Reason[] =>
  reasons.map((r) => (r.kind === 'keyword-synergy' ? { ...r, guaranteed: true } : r))

const toRecommendation = (s: Scratch, guaranteed: boolean): Recommendation => {
  const [first, ...rest] = guaranteed ? withGuarantee(s.reasons) : s.reasons
  if (first === undefined) {
    // Unreachable: scoring guarantees at least one reason. Kept as a throw rather
    // than a silent empty array, because an unexplained recommendation is a bug
    // (P4) and should fail loudly in development.
    throw new Error(`recommendation for ${s.pooled.card.name} has no reasons`)
  }
  return {
    oracleId: s.pooled.card.oracleId,
    // Unreachable — a scratch with no group is never emitted. `other` rather
    // than `staple`, so a bug here cannot make a card claim to be on a curated
    // list it is not on.
    group: s.group ?? 'other',
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
    case 'staple-land':
      return 'Staple lands'
    case 'other':
      return 'Everything else'
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

/**
 * The one-line explanation under each heading (P4).
 *
 * The two staples lines SAY THEY ARE AN OPINION, in the heading, rather than
 * leaving the builder to assume a number is behind them. There is no number:
 * ADR-0008 forbids querying EDHREC and `stats` is null in production, so the
 * inclusion term is zero for every card. A heading reading "widely played"
 * over a hand-written list would be a measurement claim the product cannot
 * support — which is exactly what the OLD `staple` group did, over a list that
 * was in fact every eligible card in the deck's colours.
 */
const rationaleFor = (key: CandidateGroupKey): string => {
  if (key === 'staple')
    return 'Our curated list: cards essentially every Commander deck in your colours wants. An opinion, not a statistic — edit staples.data.json.'
  if (key === 'staple-land')
    return 'The same list, filtered to lands: fixing that works in any deck, whatever your colours.'
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
  // `other`, the catch-all. It used to say "Widely played and legal in your
  // colours" under the heading "Staples", which with `stats: null` was every
  // eligible card in the deck's identity — a claim about popularity made over a
  // list that was not sorted by any (P4).
  return 'Legal in your colours, with nothing more specific to say about your deck.'
}

export const dimensionKeyOf = dimensionKey

/*
 * The fixing types a CALLER needs, re-exported from the one module that owns
 * them. `fixing.js` is not in `index.ts` on purpose — it is scoring internals —
 * but `deckLands` is now an input to `recommend`, so the shape of it and the
 * function that builds it have to be reachable from `@roundtable/domain` or the
 * API cannot fill the field it is being asked for. Re-exported here rather than
 * widening `index.ts` to the whole module, so the internals stay internal.
 */
export { deckLandsFrom } from './fixing.js'
export type { BasicLandType, DeckLands, FixingReach } from './fixing.js'
