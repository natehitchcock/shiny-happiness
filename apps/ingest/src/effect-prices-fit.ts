/**
 * The arithmetic behind `effect-prices.data.json` (ADR-0070).
 *
 * What the format charges for each effect, measured rather than asserted. Every
 * role, every produced event, every Rate tier and the body get a marginal mana
 * price out of one least-squares fit over the whole commander-legal corpus, and
 * `efficiency.ts` sums them and subtracts what the card costs.
 *
 * THE COEFFICIENTS ARE MARGINAL, WHICH IS WHY THIS IS A FIT AND NOT A GROUP OF
 * AVERAGES. The mean mana value of every card holding `draw` already includes
 * the cards that also ramp and also remove, so summing per-effect means
 * double-counts: it predicts a mean mana value of 3.99 against an actual 3.29
 * and misses by 1.69 mana per card. The fit asks what an effect adds to a card
 * that already has the others, which is the only reading of "the average cost
 * of an effect" that survives a card having several.
 *
 * SEPARATE FROM `effect-prices.ts`, WHICH IS THE DATABASE SHELL. Everything
 * here is pure, so the part worth testing — and the part a reader has to be
 * able to reproduce — runs with no Postgres and no environment. The shell does
 * one query and one `writeFileSync`.
 *
 * It imports `cardImpact` from the domain package rather than reimplementing
 * the classifier, for the reason the baseline generator it replaces gave: Rate
 * is defined against THAT model, and two copies of it would drift the day
 * either changed.
 */
import { ROLE_PRECEDENCE, cardImpact, efficiencyBody } from '@roundtable/domain'
import type { CardType, EfficiencyInput, EffectPrices, Role, SynergyTag } from '@roundtable/domain'

/** One `cards` row, narrowed to the columns the fit reads. */
export interface Row {
  readonly name: string
  readonly mana_cost: string | null
  readonly mana_value: number
  readonly type_line: string
  readonly oracle_text: string | null
  readonly types: string[]
  readonly power_num: number | null
  readonly toughness_num: number | null
  readonly roles: string[]
  readonly synergy_produces: string[]
}

/**
 * Only the fields the metric reads.
 *
 * Selected straight from `cards` rather than loaded through the repository: the
 * fit needs all 31,782 rows and the repository's full hydration would carry
 * printing joins and semantic sets that no part of this calculation looks at.
 * `EfficiencyInput` is the narrow type that makes that safe — no cast to `Card`
 * and no dozen invented fields.
 */
export const asCard = (row: Row): EfficiencyInput => ({
  name: row.name,
  manaCost: row.mana_cost,
  manaValue: row.mana_value,
  typeLine: row.type_line,
  oracleText: row.oracle_text ?? '',
  types: row.types as CardType[],
  power: row.power_num === null ? null : String(row.power_num),
  toughness: row.toughness_num === null ? null : String(row.toughness_num),
  roles: row.roles as Role[],
  synergyProduces: row.synergy_produces as SynergyTag[],
})

/** Every card has exactly one, so these four also carry the fit's intercept. */
const RATE_TIERS = ['one-shot', 'activated', 'triggered', 'upkeep'] as const

/**
 * Produced tags that `synergy.ts` derives from the TYPE LINE, not from an
 * effect.
 *
 * `spell-cast` is set for every instant and sorcery, `enchantment-etb` for
 * every enchantment, and `artifact-etb` for every artifact — 100%, 100% and
 * 82% of the cards carrying them are simply members of that type. They live in
 * `produces` because a prowess or constellation payoff asks for them, not
 * because the card DOES anything, so pricing them makes the model a type-line
 * model in disguise: fitted with them in, `spell-cast` takes 1.13 mana and
 * every instant in the format is repriced by it. The rule ADR-0070 applies is
 * the one the brief already states for `has` — membership is not an effect.
 *
 * Dropping them costs 0.009 mana of error and is the difference between
 * coefficients a reader can check against a card and coefficients they cannot.
 */
const MEMBERSHIP_TAGS: ReadonlySet<string> = new Set([
  'spell-cast',
  'enchantment-etb',
  'artifact-etb',
])

/**
 * A produced tag needs this many cards before the fit will price it.
 *
 * BOUNDED BY CROSS-VALIDATION AND THEN CHOSEN, and the distinction matters
 * because the first draft of this comment claimed the threshold was the
 * measured optimum and it is not. Sweeping 1/10/20/50/100/300/1000, held-out
 * error reads 0.9554 / 0.9542 / 0.9533 / 0.9537 / 0.9542 / 0.9549 / 0.9560
 * mana. Both ENDS are real: pricing every one of the 326 tags fits the corpus
 * best in sample (0.9454) and predicts a held-out card worst, which is
 * overfitting drawn from life; and at 1000 real effects go unpriced. The middle
 * — 20 through 100 — is FLAT, spanning nine ten-thousandths of a mana, and
 * calling any point in it the minimum is reading noise.
 *
 * 50 is chosen inside that flat region on a reason the sweep cannot see: at 20
 * the table gains 27 more coefficients fitted from twenty-odd cards each, and
 * those are simultaneously the least trustworthy numbers in the file and the
 * ones a reader is most likely to look up and query. 54 tags survive.
 */
const MIN_PRODUCE_SUPPORT = 50

/**
 * Ridge term, added to the diagonal of `XᵀX` before it is solved.
 *
 * ONE, AGAINST 31,782 ROWS, so this is conditioning and not regularisation:
 * λ = 0 and λ = 1 agree to four decimal places on every error figure, and λ =
 * 100 is measurably worse and pulls the mean prediction off the corpus mean.
 * It is here because several features are very nearly collinear — a produced
 * tag that only ever appears beside one role, a subtype carried by eighty cards
 * — and a singular normal-equation matrix is a NaN in a data file rather than
 * an error anyone sees.
 */
const RIDGE_LAMBDA = 1

/** One row of the design matrix, sparse: the features present and their values. */
interface DesignRow {
  readonly idx: readonly number[]
  readonly val: readonly number[]
}

/**
 * Gauss-Jordan with partial pivoting. Eighty-odd features, so the cubic cost is
 * microseconds and a library would be a dependency for one function.
 *
 * IT THROWS ON A DEAD PIVOT RATHER THAN SKIPPING THE COLUMN. Skipping leaves
 * that row un-reduced and returns a β that is wrong but finite and non-zero —
 * which `assertUsablePrices` would wave through, because it is neither zeroes
 * nor NaN. A plausible-looking price table is the one failure this whole file
 * is built to prevent, so the degenerate case is loud. With `RIDGE_LAMBDA` on
 * the diagonal it should be unreachable, and that is the point: if it ever
 * fires, the ridge term is not doing what its docblock claims.
 */
const solve = (A: readonly (readonly number[])[], b: readonly number[]): number[] => {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i] ?? 0])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]?.[col] ?? 0) > Math.abs(M[pivot]?.[col] ?? 0)) pivot = r
    }
    const a = M[col]
    const p = M[pivot]
    if (a === undefined || p === undefined) continue
    M[col] = p
    M[pivot] = a
    const head = M[col]
    if (head === undefined) continue
    const d = head[col] ?? 0
    if (Math.abs(d) < 1e-12) {
      throw new Error(
        `effect-price fit is singular at feature ${String(col)} — the ridge term is not conditioning it`,
      )
    }
    for (let j = col; j <= n; j++) head[j] = (head[j] ?? 0) / d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const target = M[r]
      if (target === undefined) continue
      const f = target[col] ?? 0
      if (f === 0) continue
      for (let j = col; j <= n; j++) target[j] = (target[j] ?? 0) - f * (head[j] ?? 0)
    }
  }
  return M.map((row) => row[n] ?? 0)
}

/** `(XᵀX + λI)β = Xᵀy`, accumulated sparsely so 31,782 × 81 never materialises. */
const ridgeFit = (
  design: readonly DesignRow[],
  y: readonly number[],
  p: number,
  lambda: number,
): number[] => {
  const XtX = Array.from({ length: p }, () => new Float64Array(p))
  const Xty = new Float64Array(p)
  design.forEach((row, i) => {
    const target = y[i] ?? 0
    row.idx.forEach((ja, a) => {
      const va = row.val[a] ?? 0
      Xty[ja] = (Xty[ja] ?? 0) + va * target
      const acc = XtX[ja]
      if (acc === undefined) return
      row.idx.forEach((jb, b) => {
        acc[jb] = (acc[jb] ?? 0) + va * (row.val[b] ?? 0)
      })
    })
  })
  for (let j = 0; j < p; j++) {
    const acc = XtX[j]
    if (acc !== undefined) acc[j] = (acc[j] ?? 0) + lambda
  }
  return solve(
    XtX.map((row) => Array.from(row)),
    Array.from(Xty),
  )
}

const dot = (row: DesignRow, beta: readonly number[]): number =>
  row.idx.reduce((sum, j, k) => sum + (beta[j] ?? 0) * (row.val[k] ?? 0), 0)

export interface FitResult {
  readonly roles: Record<string, number>
  readonly produces: Record<string, number>
  readonly rate: Record<string, number>
  readonly body: { hasBody: number; power: number; toughness: number }
  readonly fit: EffectPrices['fit']
}

const round = (n: number, places = 4): number => {
  const scale = 10 ** places
  return Math.round(n * scale) / scale
}

/**
 * Fit every effect's marginal mana price over a whole corpus.
 *
 * PURE, and exported for that reason: the arithmetic is the part worth testing
 * and the part a reader has to be able to reproduce, and neither should need a
 * Postgres to run. `main` below is the thin shell that fetches rows.
 *
 * The design has no separate intercept column. The four Rate tiers partition
 * the corpus, so they span the constant already, and letting them carry it is
 * what makes the fit unbiased — the mean prediction lands on the corpus mean
 * exactly, which is the 1.21x inflation of the naive model being removed.
 */
/**
 * The feature space, chosen from a set of cards.
 *
 * SEPARATED OUT SO CROSS-VALIDATION CAN REBUILD IT PER FOLD. Which produced
 * tags clear `MIN_PRODUCE_SUPPORT` is itself a decision made from data, so
 * choosing them once over the whole corpus and then "holding out" a fifth of it
 * leaks: the held-out cards helped decide which of their own features exist.
 * The leak is small at a threshold of 50 over 31,782 rows, and it is the
 * difference between a number that means what it says and one that flatters.
 */
const featureSpace = (
  cards: readonly EfficiencyInput[],
): {
  names: readonly string[]
  featurise: (card: EfficiencyInput) => DesignRow
  pricedTags: readonly string[]
} => {
  const support = new Map<string, number>()
  for (const card of cards) {
    for (const tag of new Set(card.synergyProduces)) {
      support.set(tag, (support.get(tag) ?? 0) + 1)
    }
  }
  const pricedTags = [...support]
    .filter(([tag, n]) => n >= MIN_PRODUCE_SUPPORT && !MEMBERSHIP_TAGS.has(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)

  const names: string[] = []
  const index = new Map<string, number>()
  const add = (name: string): number => {
    const at = names.length
    index.set(name, at)
    names.push(name)
    return at
  }
  for (const role of ROLE_PRECEDENCE) add(`role:${role}`)
  for (const tag of pricedTags) add(`produces:${tag}`)
  for (const tier of RATE_TIERS) add(`rate:${tier}`)
  const hasBodyAt = add('body:hasBody')
  const powerAt = add('body:power')
  const toughnessAt = add('body:toughness')

  const featurise = (card: EfficiencyInput): DesignRow => {
    const idx: number[] = []
    const val: number[] = []
    const push = (name: string, value = 1): void => {
      const at = index.get(name)
      if (at !== undefined) {
        idx.push(at)
        val.push(value)
      }
    }
    // Through a `Set`, so a row that somehow carried a duplicate is counted
    // once — `ridgeFit` accumulates `x_a·x_b` over the index list and a repeat
    // would square that feature's own contribution.
    for (const role of new Set(card.roles)) push(`role:${role}`)
    for (const tag of new Set(card.synergyProduces)) push(`produces:${tag}`)
    push(`rate:${cardImpact(card).persistence}`)
    // The domain's own reader, not a copy of it. The fit must define a body by
    // exactly the rule `cardEfficiency` applies, or it prices coefficients
    // against one definition and they are spent against another.
    const body = efficiencyBody(card)
    if (body !== null) {
      idx.push(hasBodyAt, powerAt, toughnessAt)
      val.push(1, body.power, body.toughness)
    }
    return { idx, val }
  }
  return { names, featurise, pricedTags }
}

export const fitEffectPrices = (cards: readonly EfficiencyInput[]): FitResult => {
  const { names, featurise, pricedTags } = featureSpace(cards)
  const index = new Map(names.map((name, at) => [name, at]))

  const design = cards.map(featurise)
  const y = cards.map((c) => c.manaValue)
  const beta = ridgeFit(design, y, names.length, RIDGE_LAMBDA)

  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  const meanManaValue = mean(y)
  let sae = 0
  let sse = 0
  let sumPred = 0
  design.forEach((row, i) => {
    const predicted = dot(row, beta)
    sumPred += predicted
    sae += Math.abs(predicted - (y[i] ?? 0))
    sse += (predicted - (y[i] ?? 0)) ** 2
  })
  const sst = y.reduce((a, b) => a + (b - meanManaValue) ** 2, 0)

  /*
   * Five-fold, by index rather than at random, so the figure a reader
   * reproduces is the figure that was published. It is the number that chose
   * `MIN_PRODUCE_SUPPORT`, so it has to be in the file.
   *
   * THE FEATURE SPACE IS REBUILT FROM THE TRAINING FOLD, not reused from the
   * full corpus — see `featureSpace`. A held-out card carrying a tag the
   * training fold could not price contributes nothing from it, which is exactly
   * what would happen to a card the corpus has never seen.
   */
  const K = 5
  let cvSae = 0
  for (let k = 0; k < K; k++) {
    const trainCards: EfficiencyInput[] = []
    const trainY: number[] = []
    const test: EfficiencyInput[] = []
    cards.forEach((card, i) => {
      if (i % K === k) test.push(card)
      else {
        trainCards.push(card)
        trainY.push(card.manaValue)
      }
    })
    const fold = featureSpace(trainCards)
    const foldBeta = ridgeFit(
      trainCards.map(fold.featurise),
      trainY,
      fold.names.length,
      RIDGE_LAMBDA,
    )
    for (const card of test) {
      cvSae += Math.abs(dot(fold.featurise(card), foldBeta) - card.manaValue)
    }
  }

  const priceOf = (name: string): number => round(beta[index.get(name) ?? -1] ?? 0)
  return {
    roles: Object.fromEntries(ROLE_PRECEDENCE.map((r) => [r, priceOf(`role:${r}`)])),
    produces: Object.fromEntries(pricedTags.map((t) => [t, priceOf(`produces:${t}`)])),
    rate: Object.fromEntries(RATE_TIERS.map((t) => [t, priceOf(`rate:${t}`)])),
    body: {
      hasBody: priceOf('body:hasBody'),
      power: priceOf('body:power'),
      toughness: priceOf('body:toughness'),
    },
    fit: {
      ridgeLambda: RIDGE_LAMBDA,
      minProduceSupport: MIN_PRODUCE_SUPPORT,
      features: names.length,
      meanManaValue: round(meanManaValue),
      meanPredictedManaValue: round(sumPred / cards.length),
      meanAbsoluteError: round(sae / cards.length),
      crossValidatedMeanAbsoluteError: round(cvSae / cards.length),
      rootMeanSquaredError: round(Math.sqrt(sse / cards.length)),
      r2: round(1 - sse / sst),
    },
  }
}

/** The docblock the generated file carries, so the file explains itself. */
export const FILE_COMMENT: readonly string[] = [
  'GENERATED. Do not edit by hand — run `pnpm --filter @roundtable/ingest effect-prices`',
  'against a corpus database and commit what it writes (ADR-0070).',
  '',
  'The marginal mana price of every effect a card can carry, measured from the',
  'whole commander-legal corpus by one least-squares fit of mana value on the',
  "card's roles, the events it produces, its Rate, and its body.",
  '',
  'MARGINAL, not a group of averages. Summing the mean mana value of each effect',
  'double-counts, because the mean of the `draw` bucket already contains the',
  'cards that also ramp: it predicts a mean mana value of 3.99 against an actual',
  '3.29, and misses by 1.69 mana per card. A fit asks what an effect adds to a',
  'card that already has the others, which is what "the average cost of an',
  'effect" has to mean once a card can have several.',
  '',
  'Regenerated rather than frozen in TypeScript because power creep is real and',
  'continuing: a constant written today is a lie in eighteen months with nothing',
  'to make it fail. `fit` carries the error figures so a reader can see how well',
  'these prices describe the corpus rather than trusting that they do.',
  '',
  '`rate` is the `persistence` axis of the impact model in `impact.ts` — the one',
  'thing efficiency takes from it. The composite impact SCORE is not an input.',
]
