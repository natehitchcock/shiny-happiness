#!/usr/bin/env node
/**
 * Regenerate `packages/domain/src/efficiency/baseline.data.json` (doc 18 §18.6).
 *
 * `pnpm --filter @roundtable/ingest baseline [outPath]`
 *
 * What the corpus says a mana value buys before any rules text, and the rate at
 * which the format trades stat points for text. Both are MEASURED, not asserted,
 * and both are regenerated rather than frozen in TypeScript because power creep
 * is real and continuing — a constant written today is a lie in eighteen months
 * with nothing to make it fail.
 *
 * READ-ONLY against the database. It runs no ingest, writes no card, and touches
 * nothing but one file in the repository. It is safe to run against production
 * data and is not part of the scheduled worker in `main.ts`.
 *
 * It imports `cardImpact` from the domain package rather than reimplementing the
 * classifier: `statPointsPerImpactPoint` is defined against THAT model, and two
 * copies of it would drift the day either changed.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv, createPool } from '@roundtable/db'
import { cardImpact } from '@roundtable/domain'
import type { CardType, EfficiencyInput } from '@roundtable/domain'

interface Row {
  readonly name: string
  readonly mana_cost: string | null
  readonly mana_value: number
  readonly type_line: string
  readonly oracle_text: string | null
  readonly types: string[]
  readonly power_num: number | null
  readonly toughness_num: number | null
}

/**
 * Only the fields the metrics read.
 *
 * Selected straight from `cards` rather than loaded through the repository:
 * the generator needs all 31,782 rows and the repository's full hydration would
 * carry roles, synergy tags and printing joins that no part of this calculation
 * looks at. `EfficiencyInput` is the narrow type that makes that safe — no cast
 * to `Card` and no fourteen invented fields.
 */
const asCard = (row: Row): EfficiencyInput => ({
  name: row.name,
  manaCost: row.mana_cost,
  manaValue: row.mana_value,
  typeLine: row.type_line,
  oracleText: row.oracle_text ?? '',
  types: row.types as CardType[],
  power: row.power_num === null ? null : String(row.power_num),
  toughness: row.toughness_num === null ? null : String(row.toughness_num),
})

/**
 * Below this many samples a mana value's mean is not worth publishing as a
 * measurement — the same threshold `vanillaStatline` applies on read.
 */
const MIN_SAMPLE = 10

/** Mana values the exchange rate is fitted over: where the vanilla sample is real. */
const FIT_RANGE = [1, 6] as const

const round = (n: number, places = 4): number => {
  const scale = 10 ** places
  return Math.round(n * scale) / scale
}

const main = async (): Promise<number> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    return 1
  }
  const pool = createPool(config)
  try {
    const { rows } = await pool.query<Row>(
      `SELECT name, mana_cost, mana_value, type_line, oracle_text, types, power_num, toughness_num
         FROM cards WHERE legality_commander = 'legal'`,
    )
    if (rows.length === 0) {
      // Refusing rather than writing a baseline of zeroes. An empty corpus would
      // produce a file in which every card is infinitely efficient, and nothing
      // downstream would fail to tell us — the same argument `loadBracketRules`
      // makes about an empty Game Changers set.
      console.error('corpus is empty — run the ingest before regenerating the baseline')
      return 1
    }

    const creatures = rows.filter(
      (r) => r.types.includes('creature') && r.power_num !== null && r.toughness_num !== null,
    )
    const vanilla = creatures.filter((r) => (r.oracle_text ?? '').trim() === '')
    const statline = (r: Row): number => (r.power_num ?? 0) + (r.toughness_num ?? 0)
    const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

    const vanillaStatlineByManaValue: Record<string, { n: number; statline: number }> = {}
    for (let mv = 0; mv <= 8; mv++) {
      const at = vanilla.filter((r) => Math.round(r.mana_value) === mv)
      if (at.length > 0) {
        vanillaStatlineByManaValue[String(mv)] = {
          n: at.length,
          statline: round(mean(at.map(statline)), 3),
        }
      }
    }

    // Ordinary least squares over the individual vanilla creatures in range, not
    // over the six bucket means: fitting the means would weight a bucket of 25
    // the same as one of 75 and let the thin rows drag the line.
    const fitted = vanilla.filter(
      (r) => r.mana_value >= FIT_RANGE[0] && r.mana_value <= FIT_RANGE[1],
    )
    const n = fitted.length
    const sx = fitted.reduce((a, r) => a + r.mana_value, 0)
    const sy = fitted.reduce((a, r) => a + statline(r), 0)
    const sxy = fitted.reduce((a, r) => a + r.mana_value * statline(r), 0)
    const sxx = fitted.reduce((a, r) => a + r.mana_value * r.mana_value, 0)
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    const intercept = (sy - slope * sx) / n

    // The exchange rate. The gap between "what a body costs when it is the whole
    // card" and "what a body costs when the card also has text" IS the price of
    // text; fitting it against mean impact through the origin says what one
    // impact point is worth in stat points. Weighted by card count, because a
    // mana value with 4,344 creatures in it is better evidence than one with
    // 1,193 — and through the origin, because zero impact must cost zero stats
    // or a vanilla creature would be paying for text it does not have.
    const exchangeRateByManaValue: {
      manaValue: number
      creatures: number
      vanilla: number
      all: number
      gap: number
      meanImpact: number
    }[] = []
    let numerator = 0
    let denominator = 0
    for (let mv = FIT_RANGE[0]; mv <= FIT_RANGE[1]; mv++) {
      const at = creatures.filter((r) => Math.round(r.mana_value) === mv)
      const van = vanillaStatlineByManaValue[String(mv)]
      if (at.length === 0 || van === undefined || van.n < MIN_SAMPLE) continue
      const all = mean(at.map(statline))
      const meanImpact = mean(at.map((r) => cardImpact(asCard(r)).score))
      const gap = van.statline - all
      numerator += at.length * gap * meanImpact
      denominator += at.length * meanImpact * meanImpact
      exchangeRateByManaValue.push({
        manaValue: mv,
        creatures: at.length,
        vanilla: round(van.statline, 2),
        all: round(all, 2),
        gap: round(gap, 2),
        meanImpact: round(meanImpact, 3),
      })
    }

    const data = {
      $comment: [
        'GENERATED. Do not edit by hand — run `pnpm --filter @roundtable/ingest baseline`',
        'against a corpus database and commit what it writes (doc 18 §18.6).',
        '',
        'What a mana value buys before any rules text, measured from the only cards',
        'whose whole contribution is their body: commander-legal creatures with',
        'literally no oracle text. And the rate at which the format trades stat',
        'points for text, measured as the gap between those cards and all creatures.',
        '',
        'Regenerated rather than frozen in TypeScript because power creep is real',
        'and continuing: a constant written today is a lie in eighteen months with',
        'nothing to make it fail. The sample counts are carried so a reader can see',
        'which rows are thin rather than trusting all of them equally.',
        '',
        '`statPointsPerImpactPoint` is defined against the impact model in',
        '`impact.ts` — the generator imports `cardImpact` rather than reimplementing',
        'it, because two copies would drift the day either changed.',
      ],
      generatedAt: new Date().toISOString().slice(0, 10),
      corpus: { commanderLegal: rows.length, vanillaCreatures: vanilla.length },
      vanillaStatlineByManaValue,
      vanillaStatlineFit: {
        slope: round(slope),
        intercept: round(intercept),
        n,
        overManaValues: [FIT_RANGE[0], FIT_RANGE[1]],
      },
      statPointsPerImpactPoint: round(numerator / denominator),
      exchangeRateByManaValue,
    }

    const here = dirname(fileURLToPath(import.meta.url))
    const out =
      process.argv[2] ??
      join(here, '..', '..', '..', 'packages', 'domain', 'src', 'efficiency', 'baseline.data.json')
    writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    console.error(`wrote ${out}`)
    console.error(
      `  ${rows.length} commander-legal cards, ${vanilla.length} vanilla creatures,`,
      `r = ${String(data.statPointsPerImpactPoint)}`,
    )
    return 0
  } finally {
    await pool.end()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
